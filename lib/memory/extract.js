// 记忆提取流水线（§4.4）：两来源同一条流水线。
// 串行队列并发 1、最多 20 溢出丢最旧；L0 window_key、排除记录、开关与记忆守卫、
// L1 长度与日上限、models.utility、宽松解析逐条校验、L2/L3/L3.5 去重、repo 落盘。

import { sha1, bigrams, parseTime, localISO, inQuietHours, quietEndAfter, isObj, clampInt } from "../util.js";
import { EXTRACT_SYSTEM, extractUserPrompt } from "../prompts.js";
import { matchThing, hasConflict, matchNote, isNearDuplicateUpdate } from "./dedupe.js";
import {
  EXTRACT_MAX_TOKENS, EXTRACT_RETRY_MAX_TOKENS, EXTRACT_QUEUE_MAX,
  DONE_WORDS, DROPPED_WORDS, SECRET_PATTERNS, EVIDENCE_MAX_CHARS,
} from "../config.js";

const MAX_NEW_THING = 3;
const MAX_UPDATE = 5;
const MAX_NEW_NOTE = 3;
const WINDOW_MSG_LIMIT_A = 12;  // 来源 A：最多 12 条 / 4000 字
const WINDOW_CHAR_LIMIT_A = 4000;
const WINDOW_MSG_LIMIT_B = 8;   // 来源 B：最多 8 条 / 5000 字
const WINDOW_CHAR_LIMIT_B = 5000;
const MIN_USER_CHARS = 20;

/** 宽松解析：去代码块 → 首个 { 到末个 } → JSON.parse（§4.4.2） */
export function parseOpsLoose(text) {
  const s = String(text ?? "").replace(/```(?:json)?/gi, "");
  const i = s.indexOf("{");
  const j = s.lastIndexOf("}");
  if (i < 0 || j <= i) return null;
  try {
    const v = JSON.parse(s.slice(i, j + 1));
    return isObj(v) && Array.isArray(v.ops) ? v.ops : null;
  } catch {
    return null;
  }
}

/** 校验并换算日期：可解析、不早于对应消息时间 24h、180 天以内；落安静时段顺延；不合格置 null */
export function sanitizeTime(iso, { refAt, quiet } = {}) {
  const t = parseTime(iso);
  if (t == null) return null;
  const ref = refAt != null ? new Date(refAt).getTime() : Date.now();
  if (t < ref - 24 * 3600e3) return null;
  if (t > ref + 180 * 24 * 3600e3) return null;
  if (quiet && inQuietHours(t, quiet)) return localISO(quietEndAfter(t, quiet));
  return localISO(t);
}

/** evidence 的 bigram 有 ≥ 0.5 命中窗口里某条用户消息（来源 B 允许助手消息） */
export function evidenceOk(evidence, messages, { allowAssistant = false } = {}) {
  const ev = String(evidence ?? "").trim();
  if (!ev) return false;
  const evBigrams = new Set(bigrams(ev));
  if (!evBigrams.size) return false;
  for (const m of messages) {
    if (m.role !== "user" && !(allowAssistant && m.role === "assistant")) continue;
    const msgBigrams = new Set(bigrams(String(m.text ?? "")));
    let hit = 0;
    for (const b of evBigrams) if (msgBigrams.has(b)) hit++;
    if (hit / evBigrams.size >= 0.5) return true;
  }
  return false;
}

function hitsSecret(s) {
  const text = String(s ?? "");
  return SECRET_PATTERNS.some((re) => re.test(text));
}

export function createExtractor({ repo, model, settings, policy, agents, clock = () => Date.now(), extractModel = null, log = null }) {
  const queue = [];
  let running = false;
  const windowKeysDone = new Set();
  const logLines = []; // extract_log（内存环形 200 条）
  const dayCount = new Map(); // "YYYY-MM-DD" -> 提取调用次数

  function pushLog(entry) {
    logLines.push({ at: localISO(new Date(clock())), ...entry });
    if (logLines.length > 200) logLines.shift();
    try { log?.(entry); } catch {}
  }

  function dayKey() {
    const d = new Date(clock());
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function overDailyCap() {
    const cap = settings.get()?.memory?.extractDailyCap ?? 120;
    return (dayCount.get(dayKey()) ?? 0) >= cap;
  }

  /**
   * 入队一个窗口。task = { source:"chat"|"main", agentId, ref, messages:[{role,text,at,id?}] }
   * 并发 1，最多 20，溢出丢最旧。
   */
  function enqueue(task) {
    if (queue.length >= EXTRACT_QUEUE_MAX) queue.shift();
    queue.push(task);
    void drain();
  }

  async function drain() {
    if (running) return;
    running = true;
    try {
      while (queue.length) {
        const task = queue.shift();
        try { await processOne(task); } catch (err) {
          pushLog({ source: task.source, outcome: "error", reason: String(err?.message ?? err).slice(0, 120) });
        }
      }
    } finally {
      running = false;
    }
  }

  async function processOne(task) {
    const { source, agentId } = task;
    const limit = source === "chat" ? WINDOW_MSG_LIMIT_A : WINDOW_MSG_LIMIT_B;
    const charLimit = source === "chat" ? WINDOW_CHAR_LIMIT_A : WINDOW_CHAR_LIMIT_B;
    let messages = (task.messages ?? []).filter((m) => m && m.text);
    // 窗口裁剪：最多 N 条 / 字符上限
    while (messages.length > limit) messages.shift();
    let chars = messages.reduce((a, m) => a + String(m.text).length, 0);
    while (chars > charLimit && messages.length > 1) {
      chars -= String(messages[0].text).length;
      messages.shift();
    }
    if (!messages.length) return pushLog({ source, agentId, outcome: "skipped_short" });

    // L0 window_key = sha1(source + ref + 末条 id)
    const lastId = String(messages[messages.length - 1].id ?? messages[messages.length - 1].at ?? "");
    const windowKey = sha1(`${source}:${task.ref ?? ""}:${lastId}`);
    if (windowKeysDone.has(windowKey)) return pushLog({ source, agentId, outcome: "duplicate", windowKey });

    // 排除记录：全命中 → dropped_excluded 不调模型；部分命中 → 不出现在 prompt
    const msgIds = messages.map((m) => String(m.id ?? "")).filter(Boolean);
    const hits = [];
    for (const id of msgIds) if (await repo.isExcluded(id)) hits.push(id);
    if (await repo.isExcluded(windowKey) || (msgIds.length && hits.length === msgIds.length)) {
      windowKeysDone.add(windowKey);
      return pushLog({ source, agentId, outcome: "dropped_excluded", windowKey });
    }
    if (hits.length) {
      const excl = new Set(hits);
      messages = messages.filter((m) => !excl.has(String(m.id ?? "")));
      if (!messages.length) {
        windowKeysDone.add(windowKey);
        return pushLog({ source, agentId, outcome: "dropped_excluded", windowKey });
      }
    }

    // 开关：learnFromChat / learnFromMain
    const s = settings.get();
    if (source === "chat" && s.memory?.learnFromChat === false) return pushLog({ source, agentId, outcome: "off" });
    if (source === "main") {
      if (s.memory?.learnFromMain === false) return pushLog({ source, agentId, outcome: "off" });
      if (!s.onboarded) return pushLog({ source, agentId, outcome: "off" });
    }

    // 记忆守卫
    const mem = await policy.memoryState(agentId);
    if (mem === "off") return pushLog({ source, agentId, outcome: "memory_off" });
    if (mem === "unknown") return pushLog({ source, agentId, outcome: "memory_unknown" });

    // L1：没有用户消息或用户文字合计 < 20 字
    const userChars = messages.filter((m) => m.role === "user").reduce((a, m) => a + String(m.text).length, 0);
    if (userChars < MIN_USER_CHARS) return pushLog({ source, agentId, outcome: "skipped_short", userChars });
    // 日上限
    if (overDailyCap()) return pushLog({ source, agentId, outcome: "capped" });

    // 组 prompt：已有事（进行中/等待，≤30 条）+ 最近 30 条知标题 + 对话窗口
    const [things, notes] = await Promise.all([
      repo.listThings({}).then((rows) => rows.filter((r) => r.status === "active" || r.status === "waiting").slice(0, 30)),
      repo.listNotes({}).then((rows) => rows.slice(0, 30)),
    ]);
    const agentName = (await agents?.overview?.())?.find?.((a) => a.id === agentId)?.name ?? agentId;
    const sourceLabel = source === "chat" ? `应用内聊天（助手：${agentName}）` : "Hana 主对话";
    const user = extractUserPrompt({
      sourceLabel, now: new Date(clock()), things,
      noteTitles: notes.map((n) => n.title),
      messages: messages.map((m) => ({ role: m.role, text: m.text, at: m.at })),
    });

    dayCount.set(dayKey(), (dayCount.get(dayKey()) ?? 0) + 1);
    const mp = extractModel ?? await resolveExtractModel();
    if (!mp) return pushLog({ source, agentId, outcome: "no_model" });
    let text = "";
    try {
      const r = await model.utility({
        provider: mp.provider, model: mp.model,
        systemPrompt: EXTRACT_SYSTEM, user, maxTokens: EXTRACT_MAX_TOKENS,
      });
      text = String(r?.text ?? "");
      if (!text.trim()) {
        const r2 = await model.utility({
          provider: mp.provider, model: mp.model,
          systemPrompt: EXTRACT_SYSTEM, user, maxTokens: EXTRACT_RETRY_MAX_TOKENS,
        });
        text = String(r2?.text ?? "");
      }
    } catch (err) {
      return pushLog({ source, agentId, outcome: "model_error", reason: String(err?.message ?? err).slice(0, 120) });
    }

    const ops = parseOpsLoose(text);
    if (!ops) return pushLog({ source, agentId, outcome: "parse_failed" });
    const applied = await applyOps(ops, { source, agentId, messages, windowKey, task });
    windowKeysDone.add(windowKey);
    pushLog({ source, agentId, outcome: "ok", windowKey, ...applied });
  }

  async function resolveExtractModel() {
    // 提取用当前助手聊天模型（轻量、已在线），拿不到就取 overview 第一个可用的。
    // overview 是异步的，chatModel 可能是 "provider/model" 字符串，也可能是 {provider,model}
    const ov = (await agents?.overview?.()) ?? [];
    for (const a of ov) {
      const m = a.chatModel;
      if (typeof m === "string" && m.includes("/")) {
        const i = m.indexOf("/");
        return { provider: m.slice(0, i), model: m.slice(i + 1) };
      }
      if (m?.provider && (m.model || m.id)) return { provider: m.provider, model: m.model ?? m.id };
    }
    return null;
  }

  /** 逐条校验（§4.4.2）+ L2/L3/L3.5（§4.4.3）→ repo 落盘 */
  async function applyOps(ops, { source, agentId, messages, windowKey, task }) {
    const stats = { applied: 0, dropped: [] };
    let nNew = 0, nUpd = 0, nNote = 0;
    const allowAssistantEvidence = source === "main";
    const quiet = settings.get()?.proactive?.quiet ?? null;
    const refAt = task.refAt ?? messages[messages.length - 1]?.at ?? null;
    const existingThings = await repo.listThings({});
    const existingNotes = await repo.listNotes({});

    for (const raw of ops) {
      if (!isObj(raw)) { stats.dropped.push({ reason: "bad_op" }); continue; }
      const op = String(raw.op ?? "");
      if (op === "new_thing") {
        if (++nNew > MAX_NEW_THING) { stats.dropped.push({ op, reason: "too_many" }); continue; }
        const title = String(raw.title ?? "").trim();
        if (!title || title.length > 30 || !["work", "study", "life"].includes(raw.area)) {
          stats.dropped.push({ op, title, reason: "bad_field" }); continue;
        }
        if (!evidenceOk(raw.evidence, messages, { allowAssistant: allowAssistantEvidence })) {
          stats.dropped.push({ op, title, reason: "no_evidence" }); continue;
        }
        if (hitsSecret(title) || hitsSecret(raw.now)) {
          stats.dropped.push({ op, title, reason: "sensitive" }); continue;
        }
        const status = ["active", "waiting", "done", "dropped"].includes(raw.status) ? raw.status : "active";
        const item = {
          title, area: raw.area, status,
          now: String(raw.now ?? ""), next: Array.isArray(raw.next) ? raw.next.slice(0, 3).map(String) : [],
          followUpAt: sanitizeTime(raw.followUpAt, { refAt, quiet }),
          dueAt: sanitizeTime(raw.dueAt, { refAt }),
          keywords: (raw.keywords ?? []).map(String).slice(0, 8),
          evidence: String(raw.evidence ?? "").slice(0, EVIDENCE_MAX_CHARS),
        };
        // L3 · 事：同 area 相似 → 改写 update
        let target = null, conflict = false;
        for (const row of existingThings) {
          if (row.status === "done" || row.status === "dropped") continue;
          const m = matchThing(item, row);
          if (m.l3) {
            // L3.5 冲突不合并
            if (hasConflict(`${item.title} ${item.now}`, `${row.title} ${row.now ?? ""}`).conflict) { conflict = true; target = row; break; }
            target = row; break;
          }
        }
        if (target && !conflict) {
          await repo.updateThing(target.id, {
            now: item.now || undefined, next: item.next.length ? item.next : undefined,
            followUpAt: item.followUpAt ?? undefined, dueAt: item.dueAt ?? undefined,
            log: item.evidence ? { at: localISO(clock()), text: item.evidence, source } : undefined,
          });
          stats.applied++;
        } else {
          const created = await repo.createThing({
            ...item, owner: agentId, source,
            sourceRef: { windowKey, messageIds: messages.map((m) => String(m.id ?? "")).filter(Boolean) },
            log: item.evidence ? { at: localISO(clock()), text: item.evidence, source } : undefined,
          });
          if (conflict && target) {
            await repo.updateThing(created.id, { related: [target.id], touchOnly: true });
            await repo.updateThing(target.id, { related: [created.id], touchOnly: true });
          }
          existingThings.push({ ...created });
          stats.applied++;
        }
      } else if (op === "update_thing") {
        if (++nUpd > MAX_UPDATE) { stats.dropped.push({ op, reason: "too_many" }); continue; }
        const id = String(raw.id ?? "");
        const row = existingThings.find((r) => r.id === id);
        if (!row) { stats.dropped.push({ op, id, reason: "unknown_id" }); continue; }
        if (raw.evidence != null && !evidenceOk(raw.evidence, messages, { allowAssistant: allowAssistantEvidence })) {
          stats.dropped.push({ op, id, reason: "no_evidence" }); continue;
        }
        if (hitsSecret(raw.now) || hitsSecret(raw.log)) {
          stats.dropped.push({ op, id, reason: "sensitive" }); continue;
        }
        // 状态改 done/dropped：evidence 里需出现完成/放弃类词，否则只追加记录
        let status = ["active", "waiting", "done", "dropped"].includes(raw.status) ? raw.status : undefined;
        if ((status === "done" || status === "dropped")) {
          const evText = `${raw.evidence ?? ""} ${raw.log ?? ""}`;
          const ok = status === "done" ? DONE_WORDS.test(evText) : DROPPED_WORDS.test(evText);
          if (!ok) {
            status = undefined; // weak_status：只追加记录
            stats.dropped.push({ op, id, reason: "weak_status" });
          }
        }
        const full = await repo.getThing(id);
        if (full && isNearDuplicateUpdate(raw, full, { nowMs: clock() })) {
          await repo.updateThing(id, { touchOnly: true });
          stats.applied++;
          continue;
        }
        await repo.updateThing(id, {
          status,
          now: raw.now != null ? String(raw.now) : undefined,
          next: Array.isArray(raw.next) ? raw.next.slice(0, 3).map(String) : undefined,
          followUpAt: raw.followUpAt != null ? sanitizeTime(raw.followUpAt, { refAt, quiet }) : undefined,
          dueAt: raw.dueAt != null ? sanitizeTime(raw.dueAt, { refAt }) : undefined,
          log: raw.log ? { at: localISO(clock()), text: String(raw.log).slice(0, EVIDENCE_MAX_CHARS), source } : undefined,
        });
        stats.applied++;
      } else if (op === "new_note") {
        if (++nNote > MAX_NEW_NOTE) { stats.dropped.push({ op, reason: "too_many" }); continue; }
        const title = String(raw.title ?? "").trim();
        const content = String(raw.content ?? "").trim();
        const kind = String(raw.kind ?? "");
        if (!title || !content || !["knowledge", "howto", "experience", "life", "idea", "person"].includes(kind)) {
          stats.dropped.push({ op, title, reason: "bad_field" }); continue;
        }
        if (content.length > 1600) { stats.dropped.push({ op, title, reason: "too_long" }); continue; }
        if (hitsSecret(title) || hitsSecret(content)) {
          stats.dropped.push({ op, title, reason: "sensitive" }); continue;
        }
        // L3 · 知：同 kind 同主体 标题≥0.6 内容≥0.5 → 丢弃
        let dup = false;
        for (const row of existingNotes) {
          if (matchNote({ kind, title, content }, row).dup) { dup = true; break; }
        }
        if (dup) { stats.dropped.push({ op, title, reason: "duplicate" }); continue; }
        const created = await repo.createNote({
          kind, title, content,
          question: kind === "knowledge" && raw.question ? String(raw.question) : null,
          tags: (raw.tags ?? []).map(String).slice(0, 8),
          keywords: (raw.keywords ?? []).map(String).slice(0, 8),
          source,
          sourceRef: { windowKey, messageIds: messages.map((m) => String(m.id ?? "")).filter(Boolean) },
        });
        existingNotes.push({ ...created });
        stats.applied++;
      } else {
        stats.dropped.push({ op: op || "?", reason: "bad_op" });
      }
    }
    return stats;
  }

  return {
    enqueue,
    /** 测试用：等队列清空 */
    async idle() { while (running || queue.length) await new Promise((r) => setTimeout(r, 5)); },
    logs: () => [...logLines],
    _windowKeys: windowKeysDone,
  };
}
