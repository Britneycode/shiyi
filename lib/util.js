// 时间、文本清洗、id、bigram、withTimeout。纯函数，无 fs / ctx 依赖。

import crypto from "node:crypto";

// ── id ───────────────────────────────────────────────────────────────────────
let randCounter = 0;
export function shortId(prefix = "x", at = null) {
  // t_<MMDD>_<base36 3位> / n_… / h_… / op_… / w_…；at 可传 ISO 串/Date（假时钟友好）
  const d = at ? new Date(at) : new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  randCounter = (randCounter + 1) % 46656; // 36^3
  const rand = (crypto.randomBytes(2).readUInt16BE(0) + randCounter) % 46656;
  const tail = rand.toString(36).padStart(3, "0");
  return `${prefix}_${mm}${dd}_${tail}`;
}
export function randToken(n = 6) {
  return crypto.randomBytes(Math.ceil(n / 2)).toString("hex").slice(0, n);
}
export function sha1(s) {
  return crypto.createHash("sha1").update(String(s), "utf8").digest("hex");
}

// ── 时间 ─────────────────────────────────────────────────────────────────────
export function pad2(n) { return String(n).padStart(2, "0"); }
// 本地时区 ISO 8601（带偏移），如 2025-03-03T14:20:00+08:00
export function localISO(d = new Date()) {
  if (!(d instanceof Date)) d = new Date(d); // 容忍时间戳/ISO 串
  const off = -d.getTimezoneOffset(); // 分钟，东八区 +480
  const sign = off >= 0 ? "+" : "-";
  const a = Math.abs(off);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}${sign}${pad2(Math.floor(a / 60))}:${pad2(a % 60)}`;
}
// 消息行前缀 [MM-DD HH:mm]
export function msgTimePrefix(d = new Date()) {
  return `[${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}]`;
}
export function parseTime(s) {
  if (s == null || s === "") return null;
  const t = s instanceof Date ? s.getTime() : Date.parse(String(s));
  return Number.isFinite(t) ? t : null;
}
export function nowMs() { return Date.now(); }
export function isSameLocalDay(a, b) {
  const x = new Date(a), y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}
// 安静时段是否覆盖某时刻（可跨零点，如 23:00–08:00）
export function inQuietHours(t, quiet) {
  if (!quiet || quiet.enabled === false) return false;
  const d = new Date(t);
  const mins = d.getHours() * 60 + d.getMinutes();
  const [sh, sm] = String(quiet.start ?? "23:00").split(":").map((x) => parseInt(x, 10) || 0);
  const [eh, em] = String(quiet.end ?? "08:00").split(":").map((x) => parseInt(x, 10) || 0);
  const start = sh * 60 + sm, end = eh * 60 + em;
  if (start === end) return false;
  if (start < end) return mins >= start && mins < end;
  return mins >= start || mins < end; // 跨零点
}
// 安静时段结束后的第一个时刻（remind 顺延目标）
export function quietEndAfter(t, quiet) {
  const [eh, em] = String(quiet?.end ?? "08:00").split(":").map((x) => parseInt(x, 10) || 0);
  const d = new Date(t);
  d.setHours(eh, em, 0, 0);
  if (d.getTime() <= t) d.setDate(d.getDate() + 1); // 已过早上的结束点 → 明天
  return d.getTime();
}

// ── 文本 ─────────────────────────────────────────────────────────────────────
// 去掉 <think>/<analysis>/<reflect>/<mood> 等块（✅ 茶话会 textFromSessionMessage 同款正则）
export function stripModelBlocks(s) {
  return String(s ?? "")
    .replace(/<(think|analysis|reflect|mood|reasoning|internal)[\s\S]*?<\/\1>/gi, "")
    .replace(/<(think|analysis|reflect|mood|reasoning|internal)[\s\S]*$/i, "") // 未闭合尾巴
    .trim();
}
// NFKC + 小写 + 去首尾
export function norm(s) {
  return String(s ?? "").normalize("NFKC").toLowerCase().trim();
}
// 分词：英文/数字按词，中文逐字入 bigram（在 bigrams() 里处理）
export function tokens(s) {
  const n = norm(s);
  const out = new Set();
  for (const m of n.matchAll(/[a-z0-9_][a-z0-9_.-]*/g)) out.add(m[0]);
  return [...out];
}
// 中文 bigram + 英文词混合集合，用于 Jaccard
export function bigrams(s) {
  const n = norm(s).replace(/\s+/g, "");
  const out = new Set(tokens(s));
  for (let i = 0; i < n.length - 1; i++) {
    const a = n[i], b = n[i + 1];
    if (/[一-鿿]/.test(a) && /[一-鿿]/.test(b)) out.add(a + b);
  }
  return out;
}
export function jaccard(a, b) {
  const A = a instanceof Set ? a : new Set(a);
  const B = b instanceof Set ? b : new Set(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}
export function bigramOverlap(a, b) { return jaccard(bigrams(a), bigrams(b)); }
// 截断到 n 字（按字符，保留开头）
export function truncate(s, n) {
  const str = String(s ?? "");
  return str.length <= n ? str : str.slice(0, n) + "…";
}
// 按段落截断到预算（保留开头完整段落）
export function truncateByParagraph(s, budget) {
  const str = String(s ?? "");
  if (str.length <= budget) return str;
  const paras = str.split(/\n{2,}/);
  let out = "";
  for (const p of paras) {
    if ((out + (out ? "\n\n" : "") + p).length > budget) break;
    out += (out ? "\n\n" : "") + p;
  }
  return out || str.slice(0, budget);
}
export function clipText(s, n) { return truncate(String(s ?? "").replace(/\s+/g, " ").trim(), n); }

// ── 异步 ─────────────────────────────────────────────────────────────────────
export function withTimeout(promise, ms, onTimeout) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      try { onTimeout?.(); } catch {}
      reject(new Error(`timeout after ${ms}ms`));
    }, ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}
export function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ── 校验 ─────────────────────────────────────────────────────────────────────
export function isObj(v) { return v != null && typeof v === "object" && !Array.isArray(v); }
export function clampInt(v, min, max, dflt) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}
export function asArray(v) { return Array.isArray(v) ? v : []; }
export function nonEmptyStr(v) { return typeof v === "string" && v.trim() ? v.trim() : null; }
