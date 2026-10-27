// 一轮聊天（§4.2）：校验 → append → schedule（latest-wins）→ 组 9 块 prompt
// → model.chat（工具循环见 model.js）→ 分条 1–4 气泡（每条 ≤600 字）→ append
// → extractor 通知；失败写系统行；cancel 保留已生成部分标「已停止」。

import { chatSystemPrompt, summarizePrompt } from "./prompts.js";
import { search as recallSearch } from "./memory/recall.js";
import { stripModelBlocks, truncate, clipText } from "./util.js";
import {
  CHAT_HISTORY_MAX_MSGS, CHAT_HISTORY_MAX_CHARS, CHAT_MAX_TOKENS, CHAT_RETRY_MAX_TOKENS,
  CHAT_TEMPERATURE,
} from "./config.js";

const MAX_BUBBLES = 4;
const BUBBLE_MAX_CHARS = 600;
const TEXT_LIMIT = { min: 1, max: 4000 };

export function createChat({ model, persona, agents, repo, threads, extractor, settings, mainfeed, appTools, agentState = null, clock = () => Date.now(), log = null }) {
  const inflight = new Map();   // agentId -> Promise（latest-wins：同线程只排一轮）
  const cancelFlags = new Map(); // agentId -> { cancelled: bool }
  const seenClientIds = new Set();

  function pushLog(entry) { try { log?.(entry); } catch {} }

  // ── 校验 ───────────────────────────────────────────────────────────────────
  async function validate(agentId, text, clientId) {
    const list = await agents.list();
    const agent = list.find((a) => a.id === agentId);
    if (!agent) return { error: "no_agent", message: "没有这个助手。" };
    const chatModel = await agents.resolveChatModel(agentId);
    if (!chatModel) return { error: "no_model", message: "这个助手还没有可用的聊天模型。" };
    const t = String(text ?? "");
    if (t.length < TEXT_LIMIT.min || t.length > TEXT_LIMIT.max) {
      return { error: "bad_text", message: `消息长度需在 ${TEXT_LIMIT.min}–${TEXT_LIMIT.max} 字之间。` };
    }
    if (clientId && seenClientIds.has(String(clientId))) {
      return { error: "duplicate", message: "duplicate", duplicate: true };
    }
    return { ok: true, agent, chatModel };
  }

  // ── 组 prompt ──────────────────────────────────────────────────────────────
  async function buildSystem(agentId, { withTools }) {
    const list = await agents.list();
    const agent = list.find((a) => a.id === agentId);
    const p = await persona.get(agentId);
    const [things, notes] = await Promise.all([repo.listThings({}), repo.listNotes({})]);
    // 手上的事：未完成优先 + 最近更新；第 5 块需要 now（索引行没有）→ 逐条补（≤8 条，开销可控）
    const activeThings = things
      .filter((t) => t.status === "active" || t.status === "waiting")
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .slice(0, 8);
    const thingsWithNow = [];
    for (const t of activeThings) {
      const full = await repo.getThing(t.id);
      thingsWithNow.push({ ...t, now: full?.now ?? "" });
    }
    // 相关的知：recall 最近 2 条用户消息
    const hist = await threads._all(agentId);
    const userTexts = hist.filter((m) => m.role === "user").slice(-2).map((m) => m.text).join(" ");
    const noteHits = userTexts ? recallSearch({ things: [], notes, query: userTexts, limit: 4, nowMs: clock() }) : [];
    // 主对话近况：「从主对话学习」开才注入（记忆守卫由 persona/aboutUserBlock 处理置顶与事实）
    const s = settings.get();
    const mainfeedEvents = s.memory?.learnFromMain ? (mainfeed?.recent?.(agentId, 6) ?? []) : [];
    return chatSystemPrompt({
      name: agent?.name ?? agentId,
      persona: { block: await persona.personaBlock(agentId), pinned: p.pinned, facts: p.facts, memoryOn: p.memoryOn },
      agentState: agentState?.read(agentId) ?? null,
      things: thingsWithNow,
      notes: noteHits.map((h) => h.item),
      mainfeedEvents,
      summary: await threads._summary(agentId),
      withTools,
      at: new Date(clock()),
    });
  }

  /** messages：线程最近原话 ≤24 条或 ≤6000 字（取先到者） */
  function buildMessages(hist) {
    let msgs = hist.slice(-CHAT_HISTORY_MAX_MSGS);
    let chars = msgs.reduce((a, m) => a + String(m.text).length, 0);
    while (chars > CHAT_HISTORY_MAX_CHARS && msgs.length > 1) {
      chars -= String(msgs[0].text).length;
      msgs.shift();
    }
    return msgs.map((m) => ({ role: m.role === "user" ? "user" : "assistant", text: String(m.text) }));
  }

  // ── 分条 ───────────────────────────────────────────────────────────────────
  /** 按空行切成 1–4 个气泡；超 4 条合并尾部；每条 ≤600 字 */
  function splitBubbles(raw) {
    const text = stripModelBlocks(raw);
    if (!text) return [];
    let parts = text.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
    if (parts.length > MAX_BUBBLES) {
      const head = parts.slice(0, MAX_BUBBLES - 1);
      const tail = parts.slice(MAX_BUBBLES - 1).join("\n\n");
      parts = [...head, tail];
    }
    return parts.map((p) => truncate(p, BUBBLE_MAX_CHARS));
  }

  // ── 滚动摘要 ───────────────────────────────────────────────────────────────
  async function maybeFoldSummary(agentId) {
    if (!(await threads.needsSummary(agentId))) return;
    const t = await threads.load(agentId);
    const batch = t.messages.filter((m) => m.seq > t.summarizedUpto).slice(0, 20);
    if (!batch.length) return;
    try {
      const { system, user } = summarizePrompt(batch);
      const r = await model.utility({ systemPrompt: system, user, maxTokens: 800 });
      const summaryText = String(r?.text ?? "").trim();
      if (summaryText) await threads.foldSummary(agentId, summaryText);
    } catch (err) {
      pushLog({ agentId, outcome: "summary_failed", reason: String(err?.message ?? err).slice(0, 120) });
    }
  }

  // ── 一轮 ───────────────────────────────────────────────────────────────────
  async function runTurn(agentId, chatModel, system, userMessages, turn, { onDelta } = {}) {
    const tools = appTools ? appTools.schemas : [];
    const flag = cancelFlags.get(agentId) ?? { cancelled: false };
    cancelFlags.set(agentId, flag);
    const toolCtx = { agentId, userText: userMessages.length ? String(userMessages[userMessages.length - 1].text ?? "") : "", messageIds: [] };
    const r = await model.chat({
      provider: chatModel.provider, model: chatModel.model,
      systemPrompt: system, messages: userMessages,
      maxTokens: CHAT_MAX_TOKENS, temperature: CHAT_TEMPERATURE,
      tools,
      toolRunner: appTools
        ? async (name, args) => {
            const out = await appTools.execute(name, args, toolCtx);
            if (out.line) await threads.append(agentId, { role: "system", text: out.line }, { turnId: turn.id, silentUnread: true });
            return out.text;
          }
        : null,
      isCancelled: () => flag.cancelled,
      onDelta,
    });
    return { ...r, cancelled: flag.cancelled };
  }

  /** 后台跑一轮：失败写系统行；分条 append；触发提取 */
  async function processTurn(agentId, chatModel) {
    const turn = threads.startTurn(agentId);
    try {
      const withTools = !!(appTools && model.supportsTools?.());
      const system = await buildSystem(agentId, { withTools });
      const hist = await threads._all(agentId);
      const userMessages = buildMessages(hist);
      // 流式：每个 text-delta 实时累加进 turn.partial（不落盘，瞬态），供面板轮询渲染
      const r = await runTurn(agentId, chatModel, system, userMessages, turn, {
        onDelta: (d) => threads.appendDelta(agentId, turn.id, d),
      });
      // 取消：保留已生成部分并标「已停止」
      if (r.cancelled) {
        const partial = stripModelBlocks(r.text ?? "");
        if (partial) await threads.append(agentId, { role: "assistant", text: partial }, { turnId: turn.id });
        await threads.append(agentId, { role: "system", text: "已停止" }, { turnId: turn.id, silentUnread: true });
        threads.finishTurn(agentId, turn.id, { status: "interrupted", partial });
        return { turnId: turn.id, status: "interrupted" };
      }
      // 失败：空输出已重试一次；仍失败 → 系统行 + failed
      if (r.error || !stripModelBlocks(r.text ?? "")) {
        const reason = r.error ? clipText(r.error, 80) : "空输出";
        await threads.append(agentId, { role: "system", text: `没回上来：${reason}` }, { turnId: turn.id, silentUnread: true });
        threads.finishTurn(agentId, turn.id, { status: "failed", error: reason, partial: stripModelBlocks(r.text ?? "") });
        return { turnId: turn.id, status: "failed", error: reason };
      }
      // 分条 1–4 气泡
      const bubbles = splitBubbles(r.text);
      for (const b of bubbles) {
        threads.updateTurn(agentId, turn.id, { partial: b });
        await threads.append(agentId, { role: "assistant", text: b }, { turnId: turn.id });
      }
      threads.finishTurn(agentId, turn.id, { status: "done", partial: "" });
      // 滚动摘要 + 提取（来源 A）
      void maybeFoldSummary(agentId);
      if (extractor?.enqueue) {
        const hist2 = await threads._all(agentId);
        const windowMsgs = hist2.slice(-12).map((m) => ({ role: m.role, text: m.text, at: m.at, id: `seq_${m.seq}` }));
        extractor.enqueue({ source: "chat", agentId, ref: turn.id, messages: windowMsgs });
      }
      return { turnId: turn.id, status: "done", bubbles: bubbles.length };
    } catch (err) {
      const reason = String(err?.message ?? err).slice(0, 120);
      try {
        await threads.append(agentId, { role: "system", text: `没回上来：${reason}` }, { turnId: turn.id, silentUnread: true });
      } catch {}
      threads.finishTurn(agentId, turn.id, { status: "failed", error: reason });
      return { turnId: turn.id, status: "failed", error: reason };
    }
  }

  // ── 对外 ───────────────────────────────────────────────────────────────────
  /** POST /api/threads/:agentId/messages：校验 → append → schedule */
  async function postMessage(agentId, { text, clientId }) {
    const v = await validate(agentId, text, clientId);
    if (!v.ok) return v;
    if (clientId) seenClientIds.add(String(clientId));
    const { message, turnId } = await threads.append(agentId, { role: "user", text: String(text), clientId });
    schedule(agentId, v.chatModel);
    return { ok: true, message, turnId };
  }

  /** latest-wins：同一线程同时只有一轮在生成；再来消息不打断，本轮结束若有新消息自动续一轮 */
  function schedule(agentId, chatModel) {
    if (inflight.has(agentId)) return inflight.get(agentId);
    const p = (async () => {
      try {
        while (true) {
          const before = await threads._all(agentId);
          const lastSeq = before.length ? before[before.length - 1].seq : 0;
          await processTurn(agentId, chatModel);
          const after = await threads._all(agentId);
          const newUser = after.filter((m) => m.seq > lastSeq && m.role === "user");
          if (!newUser.length) break; // 没有新消息 → 收工
          // 生成中来了新消息 → 合并成下一轮
        }
      } finally {
        inflight.delete(agentId);
        cancelFlags.delete(agentId);
      }
    })();
    inflight.set(agentId, p);
    return p;
  }

  /** POST /api/threads/:agentId/cancel */
  function cancel(agentId) {
    const flag = cancelFlags.get(agentId);
    if (flag) flag.cancelled = true;
    return { ok: true };
  }

  /** 重启恢复：把 generating 的轮次标 interrupted，追加系统行「重试」由界面决定 */
  async function recoverInterrupted() {
    await threads.recoverInterrupted();
    return { ok: true };
  }

  return { postMessage, cancel, schedule, recoverInterrupted, splitBubbles, buildMessages, buildSystem, processTurn, validate };
}
