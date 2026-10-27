// 聊天线程：消息序列化、未读、轮次状态、滚动摘要、归档（§4.2 / §4.12）。
// 文件：<dataDir>/threads/<agentId>.json  { agentId, summary, summarizedUpto, nextSeq, messages[] }
//      <dataDir>/threads/<agentId>.archive.jsonl  （更早的消息，appendLine）

import fs from "node:fs";
import path from "node:path";
import { ensureDir, writeJsonAtomic, readJsonSafe, appendLine, withFileLock } from "./atomic.js";
import { SUMMARY_TRIGGER_MSGS, SUMMARY_BATCH_MSGS, THREAD_KEEP_MSGS, BUDGET_SUMMARY } from "./config.js";

function emptyThread(agentId) {
  return { agentId, summary: "", summarizedUpto: 0, nextSeq: 1, messages: [], unread: 0 };
}

export function createThreads({ dir }) {
  const root = dir;

  const fileOf = (agentId) => path.join(root, `${agentId}.json`);
  const archiveOf = (agentId) => path.join(root, `${agentId}.archive.jsonl`);
  const lockOf = (agentId) => fileOf(agentId);

  async function load(agentId) {
    return readJsonSafe(fileOf(agentId), () => emptyThread(agentId));
  }
  async function save(agentId, t) {
    await writeJsonAtomic(fileOf(agentId), t);
  }

  // 一轮的轮次状态机：generating → done | failed | interrupted
  function newTurn(agentId, turnId) {
    return { id: turnId, agentId, status: "generating", startedAt: new Date().toISOString(), finishedAt: null, partial: "", error: null, toolCalls: [] };
  }

  /**
   * 追加消息。
   * msg: { role:"user"|"assistant"|"system"|"proactive"|"handoff", text, at?, clientId?, meta? }
   * opts: { turnId?, silentUnread? }  — silentUnread: true 时不增加未读（自己写的行）
   * 返回 { message（带 seq）, turnId }
   */
  async function append(agentId, msg, opts = {}) {
    return withFileLock(lockOf(agentId), async () => {
      const t = await load(agentId);
      const seq = t.nextSeq++;
      const at = msg.at ?? new Date().toISOString();
      const message = { seq, role: msg.role, text: String(msg.text ?? ""), at, ...(msg.clientId ? { clientId: msg.clientId } : {}), ...(msg.meta ? { meta: msg.meta } : {}) };
      t.messages.push(message);
      if (!opts.silentUnread && (msg.role === "assistant" || msg.role === "proactive")) t.unread += 1;
      // 归档：超 THREAD_KEEP_MSGS 时把最老的移走
      if (t.messages.length > THREAD_KEEP_MSGS) {
        const overflow = t.messages.splice(0, t.messages.length - THREAD_KEEP_MSGS);
        for (const m of overflow) await appendLine(archiveOf(agentId), JSON.stringify(m));
      }
      await save(agentId, t);
      return { message, turnId: opts.turnId ?? null };
    });
  }

  async function list(agentId, { after = 0, limit = 100 } = {}) {
    const t = await load(agentId);
    const msgs = t.messages.filter((m) => m.seq > after).slice(-limit);
    return { agentId, summary: t.summary, summarizedUpto: t.summarizedUpto, messages: msgs, unread: t.unread, hasMore: t.messages.length > THREAD_KEEP_MSGS };
  }

  async function markRead(agentId, uptoSeq) {
    return withFileLock(lockOf(agentId), async () => {
      const t = await load(agentId);
      t.unread = t.messages.filter((m) => m.seq > uptoSeq && (m.role === "assistant" || m.role === "proactive")).length;
      await save(agentId, t);
      return { unread: t.unread };
    });
  }

  async function clear(agentId) {
    return withFileLock(lockOf(agentId), async () => {
      const t = emptyThread(agentId);
      await save(agentId, t);
      return true;
    });
  }

  // ── 轮次状态（生成中/失败/中断）──────────────────────────────────────────
  const turns = new Map(); // `${agentId}:${turnId}` -> turn
  function startTurn(agentId) {
    const turnId = `turn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const turn = newTurn(agentId, turnId);
    turns.set(`${agentId}:${turnId}`, turn);
    return turn;
  }
  function getTurn(agentId, turnId) {
    return turns.get(`${agentId}:${turnId}`) ?? null;
  }
  function updateTurn(agentId, turnId, patch) {
    const t = turns.get(`${agentId}:${turnId}`);
    if (!t) return null;
    Object.assign(t, patch);
    return t;
  }
  /** 流式增量：把 NDJSON 一段 delta 累加进 turn.partial（不落盘，瞬态） */
  function appendDelta(agentId, turnId, delta) {
    const t = turns.get(`${agentId}:${turnId}`);
    if (!t) return null;
    t.partial = (t.partial ?? "") + String(delta ?? "");
    return t;
  }
  /** 当前生成中的轮次（流式面板读取用） */
  function currentTurn(agentId) {
    for (const t of turns.values()) {
      if (t.agentId === agentId && t.status === "generating") return t;
    }
    return null;
  }
  function finishTurn(agentId, turnId, { status = "done", error = null, partial = "" } = {}) {
    const t = turns.get(`${agentId}:${turnId}`);
    if (!t) return null;
    t.status = status;
    t.finishedAt = new Date().toISOString();
    t.error = error;
    t.partial = partial;
    return t;
  }
  function listTurns(agentId, { activeOnly = false } = {}) {
    const out = [];
    for (const t of turns.values()) {
      if (t.agentId !== agentId) continue;
      if (activeOnly && t.status !== "generating") continue;
      out.push(t);
    }
    return out;
  }

  // 重启恢复：上次还在 generating 的轮次 → interrupted
  async function recoverInterrupted() {
    for (const t of turns.values()) {
      if (t.status === "generating") t.status = "interrupted";
    }
    // 同时清掉线程文件里残留的 generating 轮次（只影响内存表，文件里没有）
    return true;
  }

  // ── 滚动摘要（§4.2）：未摘要消息超 40 条 → 把最旧 20 条并入摘要（≤ 600 字）────────
  async function needsSummary(agentId) {
    const t = await load(agentId);
    const unsummarized = t.messages.filter((m) => m.seq > t.summarizedUpto);
    return unsummarized.length > SUMMARY_TRIGGER_MSGS;
  }
  /** 把最旧 SUMMARY_BATCH_MSGS 条未摘要消息并入摘要文本（由 chat 调 utility 生成 summaryText） */
  async function foldSummary(agentId, summaryText) {
    return withFileLock(lockOf(agentId), async () => {
      const t = await load(agentId);
      const batch = t.messages.filter((m) => m.seq > t.summarizedUpto).slice(0, SUMMARY_BATCH_MSGS);
      if (batch.length === 0) return { folded: 0, summary: t.summary };
      const rangeNote = `【${batch[0].seq}–${batch[batch.length - 1].seq}】`;
      t.summary = (t.summary ? t.summary + "\n" : "") + rangeNote + summaryText;
      if (t.summary.length > BUDGET_SUMMARY) t.summary = t.summary.slice(-BUDGET_SUMMARY);
      t.summarizedUpto = batch[batch.length - 1].seq;
      await save(agentId, t);
      return { folded: batch.length, summary: t.summary, summarizedUpto: t.summarizedUpto };
    });
  }

  async function loadEarlier(agentId, { beforeSeq, limit = 50 } = {}) {
    // 从 archive.jsonl 按需读更早消息（按 seq < beforeSeq 过滤）
    try {
      const raw = fs.readFileSync(archiveOf(agentId), "utf8").trim();
      const lines = raw ? raw.split("\n") : [];
      const msgs = [];
      for (let i = lines.length - 1; i >= 0 && msgs.length < limit; i--) {
        try {
          const m = JSON.parse(lines[i]);
          if (beforeSeq == null || m.seq < beforeSeq) msgs.unshift(m);
        } catch {}
      }
      return msgs;
    } catch {
      return [];
    }
  }

  return {
    append, list, markRead, clear, load,
    startTurn, getTurn, updateTurn, finishTurn, listTurns, recoverInterrupted,
    appendDelta, currentTurn,
    needsSummary, foldSummary, loadEarlier,
    /** 供 chat 组 prompt 取全部（会再裁剪） */
    _all: async (agentId) => (await load(agentId)).messages,
    _summary: async (agentId) => (await load(agentId)).summary,
    /** 列出所有有线程文件的 agentId（供主动引擎扫描未回复） */
    async agentIds() {
      try {
        ensureDir(root);
        return fs.readdirSync(root)
          .filter((f) => f.endsWith(".json") && !f.endsWith(".archive.jsonl"))
          .map((f) => f.replace(/\.json$/, ""));
      } catch { return []; }
    },
    /** 关系统计：首条时间 + 消息总数（含归档）。供面板"认识 N 天 · 聊 M 条"。 */
    async _stats(agentId) {
      const t = await load(agentId);
      const live = t.messages;
      let archived = 0, firstAt = live[0]?.at ?? null;
      try {
        const raw = fs.readFileSync(archiveOf(agentId), "utf8").trim();
        const lines = raw ? raw.split("\n") : [];
        archived = lines.length;
        if (!firstAt && lines.length) { try { firstAt = JSON.parse(lines[0])?.at ?? null; } catch {} }
      } catch {}
      if (!firstAt) { try { firstAt = new Date(fs.statSync(fileOf(agentId)).birthtimeMs).toISOString(); } catch {} }
      return { firstAt, msgCount: live.length + archived };
    },
  };
}
