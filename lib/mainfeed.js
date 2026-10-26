// 主对话收集（§4.5）：bus message_end 过滤 → 环形缓冲（≤240 条/≤800 字）
// → 最后一条 assistant 后静 3 分钟出批 → extractor.enqueue（来源 B）。
// 只收标准主会话 agents/<agentId>/sessions/<file>.jsonl（isolated 为 false 才收）；
// 交接会话经 handoffs.thingFor 映射单独放行；ch_/dm_/bridge 路径天然被排除。

import path from "node:path";
import { writeJsonAtomic, readJsonSafe } from "./atomic.js";
import { stripModelBlocks, sha1 } from "./util.js";
import { MAINFEED_MAX_EVENTS, MAINFEED_EVENT_MAX_CHARS, MAINFEED_BATCH_QUIET_MS } from "./config.js";

export function createMainfeed({ dir, settings, extractor, policy, handoffs = null, clock = () => Date.now(), log = null }) {
  const file = path.join(dir, "mainfeed.json");
  let buffer = [];            // 环形 240 条
  const pending = new Map();  // agentId -> { timer, at }

  function pushLog(entry) { try { log?.(entry); } catch {} }

  // ── 过滤 ───────────────────────────────────────────────────────────────────
  function thingFor(sessionPath) {
    try { return handoffs?.thingFor?.(sessionPath) ?? null; } catch { return null; }
  }

  function onMessageEnd(event, sessionPath) {
    if (!settings.get().onboarded) return;
    const handoffThing = thingFor(sessionPath);
    if (!handoffThing && !settings.get().memory?.learnFromMain) return; // 伪代码 learnFromMain 实为 memory.learnFromMain
    if (event?.isolated != null && event.isolated !== false) return;   // 宿主标记的隔离回合（子任务等）
    const parts = String(sessionPath ?? "").replace(/\\/g, "/").split("/").filter(Boolean);
    const i = parts.findIndex((p) => p.toLowerCase() === "agents");
    // 只收标准主会话：.../agents/<agentId>/sessions/<file>.jsonl（agents 之后恰好 3 段）
    if (i < 0 || parts[i + 2]?.toLowerCase() !== "sessions" || parts.length !== i + 4 || !/\.jsonl$/i.test(parts[i + 3])) return;
    const agentId = String(event?.agentId ?? event?.session?.agentId ?? parts[i + 1]);
    if (agentId !== parts[i + 1]) return;
    const role = String(event?.message?.role ?? event?.role ?? "").toLowerCase();
    if (role !== "user" && role !== "assistant") return;
    const text = textFromSessionMessage(event?.message ?? event);  // 去 think 等块，≤ 800 字
    if (!text) return;
    buffer.push({ id: entryIdOr(event, agentId, text), agentId, sessionPath, role, text, at: eventTime(event) });
    if (buffer.length > MAINFEED_MAX_EVENTS) buffer.splice(0, buffer.length - MAINFEED_MAX_EVENTS);
    scheduleBatch(agentId); // 最后一条 assistant 后 3 分钟无新事件 → 出批
  }

  /** 去 think 等块，≤ 800 字 */
  function textFromSessionMessage(msg) {
    const raw = String(msg?.content ?? msg?.text ?? "");
    return stripModelBlocks(raw).slice(0, MAINFEED_EVENT_MAX_CHARS);
  }
  function entryIdOr(event, agentId, text) {
    const e = event?.message?.entryId ?? event?.entryId;
    if (e) return String(e);
    return `mf_${sha1(`${agentId}|${eventTime(event)}|${text.slice(0, 40)}`).slice(0, 16)}`;
  }
  function eventTime(event) {
    const t = event?.message?.timestamp ?? event?.message?.at ?? event?.timestamp ?? event?.at;
    const ms = t != null ? Date.parse(t) : NaN;
    return Number.isFinite(ms) ? new Date(ms).toISOString() : new Date(clock()).toISOString();
  }

  // ── 出批 ───────────────────────────────────────────────────────────────────
  function scheduleBatch(agentId) {
    const p = pending.get(agentId) ?? { timer: null, at: 0 };
    p.at = clock();
    if (p.timer) clearTimeout(p.timer);
    p.timer = setTimeout(() => { pending.delete(agentId); flushAgent(agentId); }, MAINFEED_BATCH_QUIET_MS);
    if (typeof p.timer.unref === "function") p.timer.unref();
    pending.set(agentId, p);
  }

  async function flushAgent(agentId) {
    const batch = buffer.filter((e) => e.agentId === agentId);
    if (!batch.length) return;
    // 批次处理前查记忆守卫；记忆关 → 丢弃该批（缓冲里也删掉）
    const st = await policy.memoryState(agentId);
    if (st !== "on") {
      buffer = buffer.filter((e) => e.agentId !== agentId);
      pushLog({ agentId, outcome: "memory_off" });
      return;
    }
    extractor.enqueue({ source: "main", agentId, ref: agentId, messages: batch.map((e) => ({ role: e.role, text: e.text, at: e.at, id: e.id })) });
    pushLog({ agentId, outcome: "batched", count: batch.length });
  }

  // ── 缓冲维护 ───────────────────────────────────────────────────────────────
  /** 删除联动（§4.4.4）：按消息 id 从缓冲移除 */
  function removeByMessageIds(ids) {
    const set = new Set([...(ids ?? [])].map(String));
    const before = buffer.length;
    buffer = buffer.filter((e) => !set.has(String(e.id)));
    return before - buffer.length;
  }
  /** 关掉「从主对话学习」→ 立即清空非交接会话条目 */
  function clearNonHandoff() {
    const keep = (e) => !!thingFor(e.sessionPath);
    buffer = buffer.filter(keep);
  }
  async function clearAll() {
    buffer = [];
    for (const [, p] of pending) if (p.timer) clearTimeout(p.timer);
    pending.clear();
    await save();
  }

  // ── 持久化 ─────────────────────────────────────────────────────────────────
  async function save() {
    await writeJsonAtomic(file, { events: buffer });
  }
  async function restore() {
    const data = await readJsonSafe(file, () => ({ events: [] }));
    buffer = Array.isArray(data?.events) ? data.events.slice(-MAINFEED_MAX_EVENTS) : [];
  }

  /** 聊天 prompt「主对话近况」：该助手最近 limit 条 */
  function recent(agentId, limit = 6) {
    return buffer.filter((e) => e.agentId === agentId).slice(-limit);
  }
  function list() { return [...buffer]; }

  return {
    onMessageEnd, removeByMessageIds, clearNonHandoff, clearAll,
    recent, list, save, restore, flushAgent,
    _pending: pending,
  };
}
