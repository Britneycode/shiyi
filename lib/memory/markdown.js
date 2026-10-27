// 事 / 知 的 Markdown 读写。Markdown 是真相源（§4.12），index.json 是派生缓存。
// 事模板与知模板见 PLAN §4.12。

import { THING_STATUS, FOLLOW_UP, AREAS, NOTE_KINDS } from "../config.js";

// ── frontmatter 编解码（极简 YAML 子集：标量 / [行内数组] / 空值）────────────
function encodeValue(v) {
  if (v == null || v === "") return "";
  if (Array.isArray(v)) return `[${v.map((x) => String(x)).join(", ")}]`;
  return String(v);
}
function decodeValue(raw) {
  const s = raw.trim();
  if (s === "") return null;
  if (s.startsWith("[") && s.endsWith("]")) {
    const inner = s.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((x) => x.trim()).filter(Boolean);
  }
  return s;
}

export function encodeFrontmatter(fields, order) {
  const keys = order ?? Object.keys(fields);
  const lines = ["---"];
  for (const k of keys) {
    if (!(k in fields)) continue;
    lines.push(`${k}: ${encodeValue(fields[k])}`);
  }
  lines.push("---");
  return lines.join("\n");
}

export function parseMarkdown(text) {
  const s = String(text ?? "");
  if (!s.startsWith("---")) return { fields: {}, body: s };
  const end = s.indexOf("\n---", 3);
  if (end < 0) return { fields: {}, body: s };
  const fm = s.slice(3, end).trim();
  const body = s.slice(end + 4).replace(/^\r?\n/, "");
  const fields = {};
  for (const line of fm.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (m) fields[m[1]] = decodeValue(m[2]);
  }
  return { fields, body };
}

function section(body, name) {
  const re = new RegExp(`## ${name}\\n([\\s\\S]*?)(?=\\n## |$)`);
  const m = body.match(re);
  return m ? m[1].trim() : "";
}

// ── 事（thing）─────────────────────────────────────────────────────────────────
const THING_FM_ORDER = ["id", "type", "title", "area", "status", "followUp", "followUpAt", "dueAt", "snoozedUntil", "owner", "agents", "tags", "keywords", "related", "createdAt", "updatedAt", "lastMentionedAt", "lastFollowedAt", "source", "belief"];

export function serializeThing(t) {
  const fm = encodeFrontmatter({
    id: t.id, type: "thing", title: t.title, area: t.area, status: t.status,
    followUp: t.followUp, followUpAt: t.followUpAt, dueAt: t.dueAt, snoozedUntil: t.snoozedUntil,
    owner: t.owner, agents: t.agents, tags: t.tags, keywords: t.keywords, related: t.related,
    createdAt: t.createdAt, updatedAt: t.updatedAt, lastMentionedAt: t.lastMentionedAt,
    lastFollowedAt: t.lastFollowedAt, source: t.source, belief: t.belief,
  }, THING_FM_ORDER);
  const nextLines = (t.next ?? []).map((x) => `- ${x}`).join("\n");
  const logLines = (t.logs ?? []).map((l) => `- ${l}`).join("\n");
  return `${fm}
## 现状
${t.now ?? ""}

## 下一步
${nextLines}

## 记录
${logLines}
`;
}

export function parseThing(text) {
  const { fields, body } = parseMarkdown(text);
  if (!fields.title) return null; // 连标题都没有才算无法解析（对账会补 id）
  const now = section(body, "现状");
  const nextRaw = section(body, "下一步");
  const logsRaw = section(body, "记录");
  const next = nextRaw.split(/\r?\n/).map((l) => l.replace(/^-\s*/, "").trim()).filter(Boolean);
  const logs = logsRaw.split(/\r?\n/).map((l) => l.replace(/^-\s*/, "").trim()).filter(Boolean);
  return normalizeThing({
    ...fields,
    agents: fields.agents ?? (fields.owner ? [fields.owner] : []),
    tags: fields.tags ?? [], keywords: fields.keywords ?? [], related: fields.related ?? [],
    now, next, logs,
  });
}

export function normalizeThing(t) {
  return {
    id: t.id != null && t.id !== "" ? String(t.id) : "",
    type: "thing",
    title: String(t.title ?? "").slice(0, 30),
    area: AREAS.includes(t.area) ? t.area : "work",
    status: THING_STATUS.includes(t.status) ? t.status : "active",
    followUp: FOLLOW_UP.includes(t.followUp) ? t.followUp : "auto",
    followUpAt: t.followUpAt || null,
    dueAt: t.dueAt || null,
    snoozedUntil: t.snoozedUntil || null,
    owner: String(t.owner ?? ""),
    agents: Array.isArray(t.agents) ? t.agents.map(String) : (t.owner ? [String(t.owner)] : []),
    tags: Array.isArray(t.tags) ? t.tags.map(String) : [],
    keywords: Array.isArray(t.keywords) ? t.keywords.map(String) : [],
    related: Array.isArray(t.related) ? t.related.map(String) : [],
    createdAt: t.createdAt || null,
    updatedAt: t.updatedAt || null,
    lastMentionedAt: t.lastMentionedAt || null,
    lastFollowedAt: t.lastFollowedAt || null,
    source: t.source || "chat",
    belief: t.belief === "inferred" ? "inferred" : "stated", // 用户说的 / 助手推断的（猜测）
    now: String(t.now ?? ""),
    next: Array.isArray(t.next) ? t.next.map(String).slice(0, 3) : [],
    logs: Array.isArray(t.logs) ? t.logs.map(String) : [],
  };
}

// ── 知（note）──────────────────────────────────────────────────────────────────
const NOTE_FM_ORDER = ["id", "type", "kind", "title", "tags", "keywords", "thing", "source", "createdAt", "updatedAt", "lastAskedAt", "belief"];

export function serializeNote(n) {
  const fm = encodeFrontmatter({
    id: n.id, type: "note", kind: n.kind, title: n.title, tags: n.tags, keywords: n.keywords,
    thing: n.thing, source: n.source, createdAt: n.createdAt, updatedAt: n.updatedAt, lastAskedAt: n.lastAskedAt,
    belief: n.belief,
  }, NOTE_FM_ORDER);
  const question = n.question ? `\n## 问题\n${n.question}\n` : "";
  const sources = (n.sources ?? []).map((l) => `- ${l}`).join("\n");
  return `${fm}
## 内容
${n.content ?? ""}
${question}
## 出处
${sources}
`;
}

export function parseNote(text) {
  const { fields, body } = parseMarkdown(text);
  if (!fields.title) return null; // 同上：缺 id 由对账补
  const content = section(body, "内容");
  const question = section(body, "问题") || null;
  const srcRaw = section(body, "出处");
  const sources = srcRaw.split(/\r?\n/).map((l) => l.replace(/^-\s*/, "").trim()).filter(Boolean);
  return normalizeNote({
    ...fields,
    tags: fields.tags ?? [], keywords: fields.keywords ?? [],
    content, question, sources,
  });
}

export function normalizeNote(n) {
  return {
    id: n.id != null && n.id !== "" ? String(n.id) : "",
    type: "note",
    kind: NOTE_KINDS.includes(n.kind) ? n.kind : "knowledge",
    title: String(n.title ?? "").slice(0, 60),
    tags: Array.isArray(n.tags) ? n.tags.map(String) : [],
    keywords: Array.isArray(n.keywords) ? n.keywords.map(String) : [],
    thing: n.thing || null,
    source: n.source || "chat",
    createdAt: n.createdAt || null,
    updatedAt: n.updatedAt || null,
    lastAskedAt: n.lastAskedAt || null,
    belief: n.belief === "inferred" ? "inferred" : "stated",
    content: String(n.content ?? ""),
    question: n.question ? String(n.question) : null,
    sources: Array.isArray(n.sources) ? n.sources.map(String) : [],
  };
}
