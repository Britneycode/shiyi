// 去重：L2/L3/L3.5（§4.4.3）。纯函数 + repo 查询，供 extract 流水线与 chat 工具调用复用。

import { bigramOverlap, tokens, norm } from "../util.js";
import { NEGATION_WORDS, VERSION_RE, NUMBER_RE, DATE_WORDS } from "../config.js";

// ── L3 · 事：new_thing 与未完成事项比较 ─────────────────────────────────────
// 同 area，标题 bigram Jaccard ≥ 0.6，或 keywords 交集 ≥ 2 且标题 ≥ 0.4 → 命中（改写 update）
export function matchThing(op, existing) {
  const titleSim = bigramOverlap(String(op.title ?? ""), String(existing.title ?? ""));
  const kwA = new Set((op.keywords ?? []).map(norm));
  const kwB = new Set((existing.keywords ?? []).map(norm));
  let kwHit = 0;
  for (const k of kwA) if (kwB.has(k)) kwHit++;
  const sameArea = op.area === existing.area;
  const l3 = sameArea && (titleSim >= 0.6 || (kwHit >= 2 && titleSim >= 0.4));
  return { l3, titleSim, kwHit };
}

// ── L3.5 · 冲突不合并：相似度够 L3，但数字/否定/日期/版本冲突 → 视为两件事 ──
export function hasConflict(a, b) {
  const ta = conflictTokens(a);
  const tb = conflictTokens(b);
  // 数字冲突：两边都有数字且集合不相交（「周五 18 点」vs「下周三 9 点」之类）
  if (ta.numbers.size && tb.numbers.size && !intersects(ta.numbers, tb.numbers)) return { conflict: true, kind: "number" };
  // 版本冲突
  if (ta.versions.size && tb.versions.size && !intersects(ta.versions, tb.versions)) return { conflict: true, kind: "version" };
  // 否定冲突：一边含否定词一边不含（「不做了」vs「继续」）
  if (ta.negated !== tb.negated) return { conflict: true, kind: "negation" };
  // 日期词冲突：两边都点了日期词且不相交（「周五」vs「下周三」）
  if (ta.dates.size && tb.dates.size && !intersects(ta.dates, tb.dates)) return { conflict: true, kind: "date" };
  return { conflict: false };
}

function conflictTokens(s) {
  const text = String(s ?? "");
  const numbers = new Set((text.match(NUMBER_RE) ?? []).filter((n) => n.length >= 1));
  const versions = new Set(text.match(VERSION_RE) ?? []);
  const dates = new Set(text.match(DATE_WORDS) ?? []);
  const negated = NEGATION_WORDS.some((w) => text.includes(w));
  return { numbers, versions, dates, negated };
}
function intersects(a, b) {
  for (const x of a) if (b.has(x)) return true;
  return false;
}

/** 综合判定：same=改写 update / conflict=新建并互记 related / none=无关 */
export function decideThing(op, existing) {
  const m = matchThing(op, existing);
  if (!m.l3) return { verdict: "none", ...m };
  const combined = `${op.title ?? ""} ${op.now ?? ""} ${(op.next ?? []).join(" ")}`;
  const combinedOld = `${existing.title ?? ""} ${existing.now ?? ""}`;
  const c = hasConflict(combined, combinedOld);
  if (c.conflict) return { verdict: "conflict", ...m, conflictKind: c.kind };
  return { verdict: "same", ...m };
}

// ── L3 · 知：同 kind、同主体前缀、标题 ≥0.6 且内容 ≥0.5 → 丢弃 ──────────────
export function matchNote(op, existing) {
  if (op.kind !== existing.kind) return { dup: false };
  const subjA = subjectOf(op.title);
  const subjB = subjectOf(existing.title);
  if (subjA !== subjB) return { dup: false };
  const titleSim = bigramOverlap(String(op.title ?? ""), String(existing.title ?? ""));
  const contentSim = bigramOverlap(String(op.content ?? ""), String(existing.content ?? ""));
  return { dup: titleSim >= 0.6 && contentSim >= 0.5, titleSim, contentSim };
}
/** 「妈妈：不吃香菜」→ 主体「妈妈」；无冒号前缀 → 空串 */
export function subjectOf(title) {
  const m = /^([^：:]{1,12})[：:]/.exec(String(title ?? "").trim());
  return m ? norm(m[1]) : "";
}

// ── update 近重复：log/now 与最近一条记录 Jaccard ≥ 0.8 且 24h 内 → 只碰 lastMentionedAt ──
export function isNearDuplicateUpdate(op, thing, { nowMs } = {}) {
  const logs = thing?.logs ?? [];
  const last = logs[logs.length - 1];
  if (!last) return false;
  const t = new Date(last.at ?? 0).getTime();
  const now = nowMs ?? Date.now();
  if (!Number.isFinite(t) || now - t > 24 * 3600e3) return false;
  const a = String(op.log ?? op.now ?? "");
  const b = String(last.text ?? last.log ?? "");
  if (!a || !b) return false;
  return bigramOverlap(a, b) >= 0.8;
}
