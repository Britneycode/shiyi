// 检索与注入（§4.6）：无向量。terms = 标题+keywords+tags 的 NFKC 小写分词 + 中文 bigram。
// 得分 = 标题命中 ×3 + keywords ×2 + tags ×1.5 + 内容 bigram ×0.5；事额外加未完成 +2、近 7 天提到 +1。

import { tokens, bigrams, jaccard } from "../util.js";

const W_TITLE = 3;
const W_KEYWORDS = 2;
const W_TAGS = 1.5;
const W_CONTENT = 0.5;
const BONUS_UNDONE = 2;
const BONUS_RECENT = 1;
const RECENT_MS = 7 * 24 * 3600e3;

function termSet(s) {
  return new Set([...tokens(s), ...bigrams(s)]);
}
function hitScore(queryTerms, targetTerms) {
  if (!queryTerms.size || !targetTerms.size) return 0;
  let hit = 0;
  for (const t of queryTerms) if (targetTerms.has(t)) hit++;
  return hit / queryTerms.size; // 归一化到查询侧，避免长内容稀释
}

/**
 * @param {object} o { things: index 行或完整对象[], notes: 同, query, types?: ("thing"|"note")[], limit?: number, nowMs? }
 * index 行带 terms 字段（repo 建的），若没有则现场算。
 */
export function search({ things = [], notes = [], query = "", types = ["thing", "note"], limit = 8, nowMs } = {}) {
  const qTitle = termSet(query);
  if (!qTitle.size) return [];
  const qContent = new Set(bigrams(query));
  const now = nowMs ?? Date.now();
  const out = [];

  if (types.includes("thing")) {
    for (const t of things) {
      if (t.status === "done" || t.status === "dropped") { /* 完成/放下的事仍可被搜到，但不加权 */ }
      const titleScore = hitScore(qTitle, termSet(t.title ?? "")) * W_TITLE;
      const kwScore = hitScore(qTitle, termSet((t.keywords ?? []).join(" "))) * W_KEYWORDS;
      const tagScore = hitScore(qTitle, termSet((t.tags ?? []).join(" "))) * W_TAGS;
      const contentScore = jaccard(qContent, new Set(bigrams(`${t.now ?? ""} ${(t.next ?? []).join(" ")}`))) * W_CONTENT;
      let score = titleScore + kwScore + tagScore + contentScore;
      if (score <= 0) continue;
      if (t.status !== "done" && t.status !== "dropped") score += BONUS_UNDONE;
      const mentioned = new Date(t.lastMentionedAt ?? t.updatedAt ?? 0).getTime();
      if (Number.isFinite(mentioned) && now - mentioned < RECENT_MS) score += BONUS_RECENT;
      out.push({ type: "thing", id: t.id, title: t.title, score, item: t });
    }
  }
  if (types.includes("note")) {
    for (const n of notes) {
      const titleScore = hitScore(qTitle, termSet(n.title ?? "")) * W_TITLE;
      const kwScore = hitScore(qTitle, termSet((n.keywords ?? []).join(" "))) * W_KEYWORDS;
      const tagScore = hitScore(qTitle, termSet((n.tags ?? []).join(" "))) * W_TAGS;
      const contentScore = jaccard(qContent, new Set(bigrams(n.content ?? ""))) * W_CONTENT;
      const score = titleScore + kwScore + tagScore + contentScore;
      if (score <= 0) continue;
      out.push({ type: "note", id: n.id, title: n.title, score, item: n });
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}
