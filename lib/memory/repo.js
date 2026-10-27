// 记忆仓库（§4.12）：things/notes Markdown 真相源 + index.json 派生缓存 + 对账 + exclusions.json。
// 所有写操作经同一把锁串行；Markdown 原子写；删除进 .trash/ 并按 §4.4.4 写排除记录（只存 key 与 id，不存内容）。

import fs from "node:fs";
import path from "node:path";
import { ensureDir, writeFileAtomic, writeJsonAtomic, readJsonSafe, withFileLock } from "../atomic.js";
import { shortId, localISO, parseTime, norm, tokens, bigrams, nonEmptyStr } from "../util.js";
import { serializeThing, parseThing, normalizeThing, serializeNote, parseNote, normalizeNote } from "./markdown.js";
import { AREAS, THING_STATUS, NOTE_KINDS } from "../config.js";

const INDEX_VERSION = 1;
const ILLEGAL_FS = /[\u0000-\u001f<>:"/\\|?*]/g;

function safeName(s) {
  return String(s ?? "").replace(ILLEGAL_FS, "").replace(/\s+/g, "").slice(0, 30) || "未命名";
}
function fileDate(iso) {
  const d = iso ? new Date(iso) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function emptyExclusions() {
  return { windowKeys: [], messageIds: [] };
}

// index 行的检索词（§4.6）：标题 + keywords + tags 的 NFKC 小写分词 + 中文 bigram
function buildTerms(title, keywords, tags) {
  const out = new Set();
  for (const s of [title, ...(keywords ?? []), ...(tags ?? [])]) {
    for (const t of tokens(s)) out.add(t);
    for (const b of bigrams(s)) out.add(b);
  }
  return [...out];
}

function thingRow(t, file, fp) {
  return {
    id: t.id, file, title: t.title, area: t.area, status: t.status, followUp: t.followUp,
    followUpAt: t.followUpAt, dueAt: t.dueAt, snoozedUntil: t.snoozedUntil,
    owner: t.owner, agents: t.agents, tags: t.tags, keywords: t.keywords, related: t.related,
    createdAt: t.createdAt, updatedAt: t.updatedAt, lastMentionedAt: t.lastMentionedAt, lastFollowedAt: t.lastFollowedAt,
    source: t.source, belief: t.belief, terms: buildTerms(t.title, t.keywords, t.tags), fp,
  };
}
function noteRow(n, file, fp) {
  return {
    id: n.id, file, kind: n.kind, title: n.title, tags: n.tags, keywords: n.keywords, thing: n.thing,
    source: n.source, createdAt: n.createdAt, updatedAt: n.updatedAt, belief: n.belief,
    terms: buildTerms(n.title, n.keywords, n.tags), fp,
  };
}

function fingerprint(file) {
  try {
    const st = fs.statSync(file);
    return { m: st.mtimeMs, s: st.size };
  } catch {
    return null;
  }
}
function fpSame(a, b) {
  return !!a && !!b && a.m === b.m && a.s === b.s;
}

export function createMemoryRepo({ dir, clock = () => Date.now() }) {
  const nowISO = () => localISO(new Date(clock()));
  const root = dir;
  const thingsDir = path.join(root, "things");
  const notesDir = path.join(root, "notes");
  const trashRoot = path.join(root, ".trash");
  const indexFile = path.join(root, "index.json");
  const exclusionsFile = path.join(root, "exclusions.json");
  const lockFile = path.join(root, "index.json"); // 一把锁管全部记忆写操作（PLAN：事/知的写统一经 repo 的锁串行）
  const writeLock = (fn) => withFileLock(lockFile, fn);

  let idxCache = null; // { things, notes, version }
  let exclCache = null;
  const sourceRefs = new Map(); // id -> { windowKey, messageIds }，仅内存（§4.12 证据最小化：不落盘）

  const fileOf = (kind, id) => {
    const row = idxCache?.[kind === "thing" ? "things" : "notes"]?.[id];
    return row ? path.join(kind === "thing" ? thingsDir : notesDir, row.file) : null;
  };

  // ── index ─────────────────────────────────────────────────────────────
  async function loadIndex() {
    if (idxCache) return idxCache;
    idxCache = await readJsonSafe(indexFile, () => ({ version: INDEX_VERSION, things: {}, notes: {} }));
    idxCache.things ??= {};
    idxCache.notes ??= {};
    return idxCache;
  }
  async function saveIndex() {
    const idx = await loadIndex();
    await writeJsonAtomic(indexFile, idx);
  }

  // ── exclusions（§4.4.4）────────────────────────────────────────────────
  async function loadExclusions() {
    if (exclCache) return exclCache;
    const raw = await readJsonSafe(exclusionsFile, emptyExclusions);
    exclCache = {
      windowKeys: [...new Set((raw.windowKeys ?? []).map(String))],
      messageIds: [...new Set((raw.messageIds ?? []).map(String))],
    };
    return exclCache;
  }
  async function saveExclusions() {
    const e = await loadExclusions();
    await writeJsonAtomic(exclusionsFile, e);
  }
  async function addExclusion({ windowKey, messageIds } = {}) {
    await writeLock(async () => {
      const e = await loadExclusions();
      if (nonEmptyStr(windowKey) && !e.windowKeys.includes(windowKey)) e.windowKeys.push(windowKey);
      for (const id of messageIds ?? []) {
        if (nonEmptyStr(id) && !e.messageIds.includes(id)) e.messageIds.push(id);
      }
      await saveExclusions();
    });
  }
  async function isExcluded(key) {
    const e = await loadExclusions();
    const k = String(key ?? "");
    return e.windowKeys.includes(k) || e.messageIds.includes(k);
  }

  // ── 写文件（锁内调用）─────────────────────────────────────────────────
  async function writeThingLocked(t, oldFile) {
    const file = `${fileDate(t.createdAt)}-${safeName(t.title)}-${t.id.slice(-3)}.md`;
    const target = path.join(thingsDir, file);
    await writeFileAtomic(target, serializeThing(t));
    const idx = await loadIndex();
    idx.things[t.id] = thingRow(t, file, fingerprint(target));
    if (oldFile && oldFile !== file) {
      try { fs.rmSync(path.join(thingsDir, oldFile), { force: true }); } catch {}
    }
    await saveIndex();
    return file;
  }
  async function writeNoteLocked(n, oldFile) {
    const file = `${fileDate(n.createdAt)}-${safeName(n.title)}-${n.id.slice(-3)}.md`;
    const target = path.join(notesDir, file);
    await writeFileAtomic(target, serializeNote(n));
    const idx = await loadIndex();
    idx.notes[n.id] = noteRow(n, file, fingerprint(target));
    if (oldFile && oldFile !== file) {
      try { fs.rmSync(path.join(notesDir, oldFile), { force: true }); } catch {}
    }
    await saveIndex();
    return file;
  }

  // ── CRUD：事 ────────────────────────────────────────────────────────────
  async function createThing(input) {
    return writeLock(async () => {
      const at = input.at ?? nowISO();
      const t = normalizeThing({
        id: shortId("t", at), title: input.title, area: input.area, status: input.status,
        followUp: input.followUp, followUpAt: input.followUpAt, dueAt: input.dueAt,
        owner: input.owner, agents: input.agents, tags: input.tags ?? [], keywords: input.keywords ?? [],
        related: input.related ?? [], createdAt: at, updatedAt: at, lastMentionedAt: at,
        lastFollowedAt: null, source: input.source ?? "chat", belief: input.belief,
        now: input.now ?? "", next: input.next ?? [],
        logs: input.log ? [input.log] : (input.logs ?? []),
      });
      // sourceRef 只用于排除记录（证据最小化：不存进 Markdown）
      if (input.sourceRef) sourceRefs.set(t.id, input.sourceRef);
      const file = await writeThingLocked(t, null);
      return { ...t, file };
    });
  }

  async function readThingById(id) {
    const idx = await loadIndex();
    const row = idx.things[id];
    if (!row) return null;
    try {
      const text = fs.readFileSync(path.join(thingsDir, row.file), "utf8");
      const t = parseThing(text);
      if (!t) return null;
      return { ...t, file: row.file };
    } catch {
      return null;
    }
  }

  async function updateThing(id, patch) {
    return writeLock(async () => {
      const cur = await readThingById(id);
      if (!cur) return null;
      const at = patch.at ?? nowISO();
      const next = { ...cur };
      if (patch.title !== undefined) next.title = patch.title;
      if (patch.area !== undefined) next.area = patch.area;
      if (patch.status !== undefined) next.status = patch.status;
      if (patch.followUp !== undefined) next.followUp = patch.followUp;
      if (patch.followUpAt !== undefined) next.followUpAt = patch.followUpAt;
      if (patch.dueAt !== undefined) next.dueAt = patch.dueAt;
      if (patch.snoozedUntil !== undefined) next.snoozedUntil = patch.snoozedUntil;
      if (patch.owner !== undefined) next.owner = patch.owner;
      if (patch.agents !== undefined) next.agents = patch.agents;
      if (patch.tags !== undefined) next.tags = patch.tags;
      if (patch.keywords !== undefined) next.keywords = patch.keywords;
      if (patch.related !== undefined) next.related = [...new Set([...next.related, ...patch.related])];
      if (patch.now !== undefined) next.now = patch.now;
      if (patch.next !== undefined) next.next = patch.next;
      if (nonEmptyStr(patch.log)) next.logs = [...next.logs, patch.log];
      if (patch.lastFollowedAt !== undefined) next.lastFollowedAt = patch.lastFollowedAt;
      // 信念升级：stated（用户亲口说过）可覆盖 inferred（推断）；反向不动
      if (patch.belief === "stated") next.belief = "stated";
      next.lastMentionedAt = at;
      if (!patch.touchOnly) next.updatedAt = at;
      const fixed = normalizeThing(next);
      await writeThingLocked(fixed, cur.file);
      return { ...fixed, file: fileOf("thing", id) ?? cur.file };
    });
  }

  async function moveToTrashDir(srcFile) {
    const stamp = nowISO().replace(/[:+]/g, "-");
    const destDir = path.join(trashRoot, stamp);
    ensureDir(destDir);
    const dest = path.join(destDir, path.basename(srcFile));
    await fs.promises.rename(srcFile, dest);
  }

  async function deleteThing(id) {
    return writeLock(async () => {
      const cur = await readThingById(id);
      if (!cur) return false;
      await moveToTrashDir(path.join(thingsDir, cur.file));
      const idx = await loadIndex();
      delete idx.things[id];
      await saveIndex();
      await excludeRefLocked(sourceRefs.get(id));
      sourceRefs.delete(id);
      return true;
    });
  }

  async function excludeRefLocked(ref) {
    if (!ref) return;
    if (!nonEmptyStr(ref.windowKey) && !(ref.messageIds ?? []).length) return;
    const e = await loadExclusions();
    if (nonEmptyStr(ref.windowKey) && !e.windowKeys.includes(ref.windowKey)) e.windowKeys.push(ref.windowKey);
    for (const m of ref.messageIds ?? []) {
      if (nonEmptyStr(m) && !e.messageIds.includes(m)) e.messageIds.push(m);
    }
    await saveExclusions();
  }

  // ── CRUD：知 ────────────────────────────────────────────────────────────
  async function createNote(input) {
    return writeLock(async () => {
      const at = input.at ?? nowISO();
      const n = normalizeNote({
        id: shortId("n", at), kind: input.kind, title: input.title,
        tags: input.tags ?? [], keywords: input.keywords ?? [], thing: input.thing ?? null,
        source: input.source ?? "chat", createdAt: at, updatedAt: at, lastAskedAt: null,
        belief: input.belief,
        content: input.content ?? "", question: input.question ?? null, sources: input.sources ?? [],
      });
      if (input.sourceRef) sourceRefs.set(n.id, input.sourceRef);
      const file = await writeNoteLocked(n, null);
      return { ...n, file };
    });
  }

  async function readNoteById(id) {
    const idx = await loadIndex();
    const row = idx.notes[id];
    if (!row) return null;
    try {
      const text = fs.readFileSync(path.join(notesDir, row.file), "utf8");
      const n = parseNote(text);
      if (!n) return null;
      return { ...n, file: row.file };
    } catch {
      return null;
    }
  }

  async function updateNote(id, patch) {
    return writeLock(async () => {
      const cur = await readNoteById(id);
      if (!cur) return null;
      const at = patch.at ?? nowISO();
      const next = { ...cur };
      if (patch.kind !== undefined) next.kind = patch.kind;
      if (patch.title !== undefined) next.title = patch.title;
      if (patch.tags !== undefined) next.tags = patch.tags;
      if (patch.keywords !== undefined) next.keywords = patch.keywords;
      if (patch.thing !== undefined) next.thing = patch.thing;
      if (patch.content !== undefined) next.content = patch.content;
      if (patch.question !== undefined) next.question = patch.question;
      if (patch.sources !== undefined) next.sources = patch.sources;
      if (patch.lastAskedAt !== undefined) next.lastAskedAt = patch.lastAskedAt;
      if (patch.belief === "stated") next.belief = "stated"; // stated 可升级 inferred，反向不动
      next.updatedAt = at;
      const fixed = normalizeNote(next);
      await writeNoteLocked(fixed, cur.file);
      return { ...fixed, file: fileOf("note", id) ?? cur.file };
    });
  }

  async function deleteNote(id) {
    return writeLock(async () => {
      const cur = await readNoteById(id);
      if (!cur) return false;
      await moveToTrashDir(path.join(notesDir, cur.file));
      const idx = await loadIndex();
      delete idx.notes[id];
      await saveIndex();
      await excludeRefLocked(sourceRefs.get(id));
      sourceRefs.delete(id);
      return true;
    });
  }

  // ── 列表（走 index 行，不读 Markdown 全文）──────────────────────────────
  async function listThings({ area, status, q } = {}) {
    const idx = await loadIndex();
    let rows = Object.entries(idx.things).map(([id, r]) => ({ id, ...r }));
    if (area && AREAS.includes(area)) rows = rows.filter((r) => r.area === area);
    if (status && THING_STATUS.includes(status)) rows = rows.filter((r) => r.status === status);
    if (nonEmptyStr(q)) {
      const nq = norm(q);
      rows = rows.filter((r) =>
        norm(r.title).includes(nq) || r.terms.some((t) => t.includes(nq)) || r.tags.some((t) => norm(t).includes(nq)));
    }
    rows.sort((a, b) => (b.lastMentionedAt ?? "").localeCompare(a.lastMentionedAt ?? ""));
    return rows;
  }
  async function listNotes({ kind, q } = {}) {
    const idx = await loadIndex();
    let rows = Object.entries(idx.notes).map(([id, r]) => ({ id, ...r }));
    if (kind && NOTE_KINDS.includes(kind)) rows = rows.filter((r) => r.kind === kind);
    if (nonEmptyStr(q)) {
      const nq = norm(q);
      rows = rows.filter((r) =>
        norm(r.title).includes(nq) || r.terms.some((t) => t.includes(nq)) || r.tags.some((t) => norm(t).includes(nq)));
    }
    rows.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
    return rows;
  }

  // ── 对账（沿用 v7 §4.6）：指纹没变跳过；变了重解析；缺 id 补、重复 id 换、非法纠正；文件没了删行 ──
  async function reconcile({ force = false } = {}) {
    return writeLock(async () => {
      const idx = await loadIndex();
      const result = { scanned: 0, fixed: 0, broken: [], removed: 0 };
      const seenIds = new Map(); // id -> file

      const scan = async (kind, dirPath, parse, normalize, mkId, rowFn) => {
        const bucket = kind === "thing" ? "things" : "notes";
        ensureDir(dirPath);
        const files = fs.readdirSync(dirPath).filter((f) => f.endsWith(".md"));
        const live = new Set(files);
        // 文件删了 → 删索引行
        for (const [id, row] of Object.entries(idx[bucket])) {
          if (!live.has(row.file)) {
            delete idx[bucket][id];
            result.removed++;
          }
        }
        for (const file of files) {
          result.scanned++;
          const full = path.join(dirPath, file);
          const fp = fingerprint(full);
          const existing = Object.entries(idx[bucket]).find(([, r]) => r.file === file);
          if (!force && existing && fpSame(existing[1].fp, fp)) {
            seenIds.set(existing[0], file);
            continue;
          }
          let parsed = null;
          try {
            parsed = parse(fs.readFileSync(full, "utf8"));
          } catch {
            parsed = null;
          }
          if (!parsed || !nonEmptyStr(parsed.title)) {
            result.broken.push(`${bucket}/${file}`);
            if (existing) delete idx[bucket][existing[0]];
            continue;
          }
          let id = parsed.id;
          const needNewId = !nonEmptyStr(id) || (seenIds.has(id) && seenIds.get(id) !== file);
          if (needNewId) {
            id = mkId();
            result.fixed++;
          }
          if (existing && existing[0] !== id) delete idx[bucket][existing[0]];
          const fixed = normalize({ ...parsed, id });
          // 非法字段被纠正或换 id → 回写 Markdown（真相源与索引一致）
          const changed =
            needNewId ||
            fixed.title !== parsed.title || fixed.area !== parsed.area || fixed.status !== parsed.status ||
            fixed.followUp !== parsed.followUp || fixed.kind !== parsed.kind;
          if (changed) {
            await writeFileAtomic(full, kind === "thing" ? serializeThing(fixed) : serializeNote(fixed));
            result.fixed++;
          }
          idx[bucket][id] = rowFn(fixed, file, fingerprint(full));
          seenIds.set(id, file);
        }
      };

      await scan("thing", thingsDir, parseThing, normalizeThing, () => shortId("t"),
        (t, file, fp) => thingRow(t, file, fp));
      await scan("note", notesDir, parseNote, normalizeNote, () => shortId("n"),
        (n, file, fp) => noteRow(n, file, fp));

      await saveIndex();
      return result;
    });
  }

  // ── 清除全部记忆（§4.11）：事/知/索引/排除记录移入 .trash/<ts>/ ─────────
  async function clearAll() {
    return writeLock(async () => {
      const stamp = nowISO().replace(/[:+]/g, "-");
      const destDir = path.join(trashRoot, stamp);
      ensureDir(destDir);
      for (const [id, row] of Object.entries((await loadIndex()).things)) {
        try { await fs.promises.rename(path.join(thingsDir, row.file), path.join(destDir, row.file)); } catch {}
        delete idxCache.things[id];
      }
      for (const [id, row] of Object.entries(idxCache.notes)) {
        try { await fs.promises.rename(path.join(notesDir, row.file), path.join(destDir, row.file)); } catch {}
        delete idxCache.notes[id];
      }
      for (const f of [indexFile, exclusionsFile]) {
        try { await fs.promises.rename(f, path.join(destDir, path.basename(f))); } catch {}
      }
      exclCache = emptyExclusions();
      await saveIndex();
      await saveExclusions();
    });
  }

  // 诊断用：.trash 概览
  async function trashInfo() {
    try {
      return fs.readdirSync(trashRoot).map((name) => {
        let count = 0;
        try { count = fs.readdirSync(path.join(trashRoot, name)).length; } catch {}
        return { at: name, count };
      });
    } catch {
      return [];
    }
  }

  return {
    thingsDir, notesDir,
    loadIndex,
    createThing, getThing: readThingById, updateThing, deleteThing, listThings,
    createNote, getNote: readNoteById, updateNote, deleteNote, listNotes,
    addExclusion, isExcluded,
    reconcile, clearAll, trashInfo,
  };
}
