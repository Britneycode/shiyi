// 主动引擎（§4.8.3–4.8.5）：tick 串行、候选打分、护栏、生成、投递前重查、横幅。
// 状态文件 <dataDir>/proactive-state.json；诊断日志内存环形 200 条。

import path from "node:path";
import { localISO, jaccard, clipText, truncate, isSameLocalDay } from "../util.js";
import { readJsonSafe, writeJsonAtomic } from "../atomic.js";
import {
  PROACTIVE_TICK_MS, BUDGET_EVALUATED_MULT, BUDGET_GENERATED_MULT,
  SKIP_COOLDOWN_MS, MISSED_MERGE_WINDOW_MS, CHAT_MAX_TOKENS, CHAT_TEMPERATURE,
} from "../config.js";
import { collect } from "./reasons.js";
import { check } from "./gate.js";

const REASON_LABEL = {
  remind_due: "到时提醒", followup_due: "工作跟进", handoff_result: "交接结果",
  recent_work: "主对话近况", followup_stale: "久未提起", study_review: "学习回顾", chitchat: "闲聊",
};

function emptyState() {
  return {
    today: { date: "", count: 0 },
    lastProactiveAt: 0,
    perThing: {},          // thingId -> { lastFollowedAt, unanswered, snoozedUntil }
    lastChitchatDate: "",
    studyNextAt: 0,
    studyAsked: {},        // noteId -> ts
    budget: { date: "", evaluated: 0, generated: 0, sent: 0 },
    candidates: {},        // topicKey -> { lastEvaluatedAt, lastSkipAt, skipCount }
    globalSnoozeUntil: 0,
    handoffResults: {},    // sessionPath -> { thingId, agentId, title, summary, at, area }
    consecutiveFailures: {}, // agentId -> { count, pausedUntil }
  };
}

export function createProactiveEngine({
  model, persona, repo, threads, banner, settings, agents, mainfeed, chat,
  clock = () => Date.now(), log = null,
}) {
  const stateFile = settings.file ? path.join(path.dirname(settings.file), "proactive-state.json") : path.join("proactive-state.json");
  let state = emptyState();
  let stateLoaded = false; // 内存状态一旦被外部改过（snooze/askNow），本轮不再从磁盘覆盖
  let running = false;
  const skipLog = []; // 诊断用，最近 200 条
  const arrivalBatch = []; // 待挂横幅的这批消息 { agentId, reason }

  function pushSkip(entry) {
    skipLog.push({ at: localISO(new Date(clock())), ...entry });
    if (skipLog.length > 200) skipLog.shift();
  }

  async function loadState() {
    if (stateLoaded) return state; // 内存里已有（且可能刚被 snooze/askNow 改过），不覆盖
    const raw = await readJsonSafe(stateFile, () => emptyState());
    state = { ...emptyState(), ...raw };
    stateLoaded = true;
    // 自然日清零
    const date = localISO(new Date(clock())).slice(0, 10);
    if (state.budget?.date !== date) state.budget = { date, evaluated: 0, generated: 0, sent: 0 };
    if (state.today?.date !== date) state.today = { date, count: 0 };
    return state;
  }
  async function saveState() { await writeJsonAtomic(stateFile, state); }

  function budgetCap() {
    const cap = settings.get()?.proactive?.dailyCap ?? 3;
    return { evaluated: cap * BUDGET_EVALUATED_MULT, generated: cap * BUDGET_GENERATED_MULT, sent: cap };
  }

  /** 是否在 SKIP 冷却中且无新证据 */
  function inSkipCooldown(c, now) {
    const rec = state.candidates[c.topicKey];
    if (!rec?.lastSkipAt) return false;
    if (now - rec.lastSkipAt >= SKIP_COOLDOWN_MS) return false;
    // 有新证据（事项 updatedAt / lastMentionedAt 变了）→ 允许重评
    if (c.thingId) {
      const per = state.perThing[c.thingId];
      if (per?.lastFollowedAt && per.lastFollowedAt > rec.lastSkipAt) return false;
    }
    return true;
  }

  // ── 生成 ───────────────────────────────────────────────────────────────────
  async function buildPrompt(c, agentId) {
    const p = await persona.get(agentId);
    const personaBlock = await persona.personaBlock(agentId);
    const about = await persona.aboutUserBlock(agentId);
    const hist = await threads._all(agentId);
    const recent = hist.slice(-8).map((m) => `${m.role === "user" ? "用户" : "助手"}：${truncate(String(m.text ?? ""), 200)}`).join("\n");
    const system = [
      "你是「拾遗」里的助手，正在主动给用户发消息。",
      `现在是 ${new Date(clock()).toLocaleString("zh-CN")}。`,
      personaBlock ? `【你的人格】\n${personaBlock}` : "",
      about ? `【关于用户】\n${about}` : "",
      `【这次为什么找用户】${c.basis}`,
      `【你们最近的聊天】\n${recent || "（还没聊过）"}`,
      [
        "请你主动给用户发一条消息：",
        "- 1–2 条短消息（空行隔开），像朋友顺口一问，自然提到这件具体的事，只问一个问题；",
        "- 只基于上面给出的信息，不要编造进度，不要说你做了什么；",
        "- 用户没回不代表做错了什么——不许责备、不许撒娇索取关注、不许表现出失落；",
        "- 如果觉得现在不适合提（比如最近的聊天里用户已经说过了），只输出 [SKIP]。",
      ].join("\n"),
    ].filter(Boolean).join("\n\n");
    return { system, about, name: p?.name ?? agentId };
  }

  async function generate(c, agentId) {
    const cap = budgetCap();
    if (state.budget.generated >= cap.generated) return { skip: "generated_budget" };
    const chatModel = await agents.resolveChatModel(agentId);
    if (!chatModel) return { skip: "no_model" };
    const { system } = await buildPrompt(c, agentId);
    state.budget.generated++;
    try {
      const r = await model.chat({
        provider: chatModel.provider, model: chatModel.model,
        systemPrompt: system,
        messages: [{ role: "user", text: `（系统提示：现在轮到你先开口。为什么找用户：${c.basis}）` }],
        maxTokens: CHAT_MAX_TOKENS, temperature: CHAT_TEMPERATURE,
        tools: [], toolRunner: null,
      });
      if (r?.error) return { skip: "model_error", error: r.error };
      const text = String(r?.text ?? "").trim();
      if (!text) return { skip: "empty" };
      if (/\[SKIP\]/i.test(text)) return { skip: "skipped_model" };
      if (text.length > 400) return { skip: "too_long" };
      // 与上一条主动消息 Jaccard ≥ 0.7 → 放弃
      const lastProactive = (await threads._all(agentId)).filter((m) => m.role === "assistant" && m.meta?.proactive).at(-1);
      if (lastProactive && jaccard(text, String(lastProactive.text ?? "")) >= 0.7) return { skip: "too_similar" };
      return { text };
    } catch (err) {
      return { skip: "model_error", error: String(err?.message ?? err).slice(0, 120) };
    }
  }

  // ── 投递 ───────────────────────────────────────────────────────────────────
  /** 投递前重查（§4.8.5.1）：事项变了/状态变了/线程有新用户消息 → 丢弃 */
  async function staleDropped(c, agentId) {
    if (c.reason === "remind_due") return false; // 提醒不丢
    if (c.thingId) {
      const full = await repo.getThing(c.thingId);
      if (!full) return true;
      if (full.status === "done" || full.status === "dropped") return true;
      const upd = Date.parse(full.updatedAt ?? 0);
      if (upd > c.createdAt) {
        // 只算用户/提取造成的更新（主动引擎自己写的 lastFollowedAt 也会更新 updatedAt，用 at 比较）
        const lastFollowed = Date.parse(full.lastFollowedAt ?? 0);
        if (!lastFollowed || upd > c.createdAt + 1000) return true;
      }
    }
    // 线程里生成期间有更新用户消息
    const hist = await threads._all(agentId);
    const newerUser = hist.some((m) => m.role === "user" && Date.parse(m.at ?? 0) > c.createdAt);
    if (newerUser) return true;
    return false;
  }

  async function deliver(c, agentId, text) {
    const bubbles = String(text).split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean).slice(0, 2);
    for (const b of bubbles) {
      await threads.append(agentId, { role: "assistant", text: b, meta: { proactive: { reason: c.reason, thingId: c.thingId ?? null } } });
    }
    // 事项：lastFollowedAt、followUpAt 清空、记录追加
    if (c.thingId) {
      await repo.updateThing(c.thingId, {
        lastFollowedAt: localISO(new Date(clock())),
        followUpAt: null,
        log: `· 拾遗主动问了进度（${REASON_LABEL[c.reason] ?? c.reason}）`,
      });
      state.perThing[c.thingId] = {
        ...(state.perThing[c.thingId] ?? {}),
        lastFollowedAt: clock(),
        unanswered: (state.perThing[c.thingId]?.unanswered ?? 0) + 1,
      };
    }
    // 连续 2 次没回 → followUp=off（remind 不受限）
    if (c.thingId && state.perThing[c.thingId].unanswered >= 2 && c.reason !== "remind_due") {
      await repo.updateThing(c.thingId, { followUp: "off", log: "· 问了两次没回，先不问了" });
    }
    if (c.reason === "study_review" && c.noteId) state.studyAsked[c.noteId] = clock();
    if (c.reason === "study_review") {
      state.studyNextAt = clock() + (settings.get()?.proactive?.studyEveryDays ?? 2) * 24 * 3600_000;
    }
    if (c.reason === "chitchat") state.lastChitchatDate = localISO(new Date(clock())).slice(0, 10);
    if (c.reason === "handoff_result" && c.sessionPath) delete state.handoffResults[c.sessionPath];

    // 计数（remind_due 不计 today.count，但仍计 budget.sent）
    if (c.reason !== "remind_due") state.today.count = (state.today.count ?? 0) + 1;
    state.budget.sent = (state.budget.sent ?? 0) + 1;
    state.lastProactiveAt = clock();
    state.candidates[c.topicKey] = { ...(state.candidates[c.topicKey] ?? {}), lastEvaluatedAt: clock() };

    arrivalBatch.push({ agentId, reason: c.reason });
    await banner?.arrive?.({ agentId, reason: c.reason, thingId: c.thingId, text: bubbles.join("\n\n") });
    return { ok: true, bubbles: bubbles.length };
  }

  // ── 停机补发（§4.8.3）─────────────────────────────────────────────────────
  async function collectMissed() {
    const now = clock();
    const things = await repo.listThings({});
    const missed = [];
    for (const row of things) {
      if (row.status === "done" || row.status === "dropped") continue;
      const full = await repo.getThing(row.id);
      const followUpAt = full?.followUpAt ?? row.followUpAt;
      if (!followUpAt) continue;
      const at = Date.parse(followUpAt);
      if (!(at <= now)) continue;
      const overdue = now - at;
      if (overdue <= MISSED_MERGE_WINDOW_MS && (full?.followUp ?? row.followUp) !== "off") {
        missed.push({ ...row, ...full, owner: full?.owner ?? row.owner ?? null });
      }
    }
    return missed;
  }

  // ── tick ───────────────────────────────────────────────────────────────────
  async function tick(trigger = "interval") {
    if (running) return { running: true };
    running = true;
    try {
      await loadState();
      const now = clock();
      const s = settings.get();
      const cap = budgetCap();

      // 全部主动关闭 → 不评估、不生成、不发送（附录 D-13）
      if (!s.onboarded || !s.proactive?.enabled) {
        pushSkip({ outcome: "disabled" });
        await saveState();
        return { ok: true, skipped: "disabled" };
      }

      // 停机补发：逾期 ≤24h 的合并成一条（算一次额度）
      if (trigger === "boot") {
        const missed = await collectMissed();
        if (missed.length) {
          const byOwner = new Map();
          for (const t of missed) {
            const owner = t.owner ?? null;
            if (!byOwner.has(owner)) byOwner.set(owner, []);
            byOwner.get(owner).push(t);
          }
          for (const [owner, list] of byOwner) {
            if (!owner) continue;
            if (state.budget.sent >= cap.sent) break;
            const names = list.slice(0, 3).map((t) => t.title).join("和");
            const text = list.length === 1
              ? `「${names}」昨天说的那件事，后来怎么样了？`
              : `${names}，后来怎么样了？`;
            await deliver({
              reason: "followup_due", thingId: list[0].id, area: list[0].area ?? "work",
              topicKey: `missed:${list.map((t) => t.id).join(",")}`, createdAt: now, basis: "停机期间的跟进",
            }, owner, text);
            state.budget.generated++;
            // 其余几件也只清 followUpAt，避免下一轮重复补发
            for (const t of list.slice(1)) await repo.updateThing(t.id, { followUpAt: null });
          }
        }
      }

      const candidates = await collect({ repo, threads, mainfeed, settings, now, st: state });
      candidates.sort((a, b) => b.score - a.score);

      for (const c of candidates) {
        if (state.budget.evaluated >= cap.evaluated) { pushSkip({ outcome: "skip_all", reason: "budget" }); break; }
        if (inSkipCooldown(c, now)) { pushSkip({ outcome: "skip_cooldown", topicKey: c.topicKey }); continue; }

        // 助手归属：没有 owner 的候选（chitchat/study 无主）用第一个可用助手
        const agentId = c.owner ?? (await firstAgentId());
        if (!agentId) { pushSkip({ outcome: "skip", reason: "no_agent", topicKey: c.topicKey }); continue; }
        c.owner = agentId;

        state.budget.evaluated++;
        const verdict = await check(c, {
          settings, st: state, threads, repo, now,
          agentHasModel: (id) => agents.resolveChatModel(id).then(Boolean),
          modelsInferOk: true,
        });
        if (!verdict.ok) {
          pushSkip({ outcome: "skip", reason: verdict.reason, topicKey: c.topicKey });
          if (verdict.reason === "quiet_defer") continue;
          continue;
        }

        const gen = await generate(c, agentId);
        if (gen.skip) {
          pushSkip({ outcome: "skip_generate", reason: gen.skip, topicKey: c.topicKey });
          if (gen.skip === "skipped_model") {
            state.candidates[c.topicKey] = { ...(state.candidates[c.topicKey] ?? {}), lastSkipAt: now, skipCount: (state.candidates[c.topicKey]?.skipCount ?? 0) + 1 };
          }
          continue;
        }

        if (await staleDropped(c, agentId)) {
          pushSkip({ outcome: "stale_dropped", topicKey: c.topicKey });
          continue; // 不计额度、不进 SKIP 冷却
        }

        await deliver(c, agentId, gen.text);
        await saveState();
        return { ok: true, delivered: { reason: c.reason, agentId } };
      }

      await saveState();
      return { ok: true, delivered: null };
    } finally {
      running = false;
    }
  }

  async function firstAgentId() {
    const ov = (await agents.overview?.()) ?? [];
    for (const a of ov) {
      if (await agents.resolveChatModel(a.id)) return a.id;
    }
    return null;
  }

  return {
    tick,
    /** 「现在问问」：不受上限，仍走护栏 1、2、10 */
    async askNow(thingId) {
      await loadState();
      const full = await repo.getThing(thingId);
      if (!full) return { ok: false, code: "not_found" };
      const s = settings.get();
      if (!s.onboarded || !s.proactive?.enabled) return { ok: false, code: "disabled", message: "主动关心是关着的。" };
      const agentId = full.owner ?? (await firstAgentId());
      if (!agentId) return { ok: false, code: "no_agent" };
      if (!(await agents.resolveChatModel(agentId))) return { ok: false, code: "no_model" };
      const c = {
        reason: full.followUp === "remind" ? "remind_due" : "followup_due",
        thingId, area: full.area, topicKey: `thing:${thingId}`,
        basis: `用户点了「现在问问」（${full.area}·${full.status}；现状：${clipText(full.now, 60)}）`,
        createdAt: clock(), expiresAt: clock() + 24 * 3600_000, score: 100, owner: agentId,
      };
      const gen = await generate(c, agentId);
      if (gen.skip) return { ok: false, code: gen.skip };
      await deliver(c, agentId, gen.text);
      await saveState();
      return { ok: true };
    },
    /** 全局 snooze（「稍后再说」） */
    async snoozeAll(hours = 4) {
      await loadState();
      state.globalSnoozeUntil = clock() + hours * 3600_000;
      await saveState();
      return { ok: true, until: state.globalSnoozeUntil };
    },
    /** 事项级 snooze（「这件先不问了」） */
    async snoozeThing(thingId, hours = 72) {
      await loadState();
      if (hours <= 0) {
        delete state.perThing[thingId];
        await repo.updateThing(thingId, { snoozedUntil: null });
        await saveState();
        return { ok: true, until: null };
      }
      const until = clock() + hours * 3600_000;
      state.perThing[thingId] = { ...(state.perThing[thingId] ?? {}), snoozedUntil: until };
      await repo.updateThing(thingId, { snoozedUntil: localISO(new Date(until)) });
      await saveState();
      return { ok: true, until };
    },
    /** 交接结果回流：mainfeed 提取出更新后调用 */
    async noteHandoffResult(sessionPath, info) {
      await loadState();
      state.handoffResults[sessionPath] = { ...info, at: clock() };
      await saveState();
    },
    /** 用户读了线程 → 清掉这批到达记录 */
    clearArrivals() { arrivalBatch.length = 0; },
    state: () => state,
    skipLog: () => [...skipLog],
    budget: () => ({ ...state.budget, cap: budgetCap() }),
    _loadState: loadState,
    _saveState: saveState,
  };
}
