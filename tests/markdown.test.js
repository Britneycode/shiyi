import test from "node:test";
import assert from "node:assert/strict";
import { serializeThing, parseThing, serializeNote, parseNote, normalizeThing, normalizeNote } from "../lib/memory/markdown.js";

test("thing: 序列化→解析 往返一致（含 frontmatter 与三段正文）", () => {
  const t = normalizeThing({
    id: "t_0303_k3", title: "季度汇报", area: "work", status: "active",
    followUp: "auto", followUpAt: "2025-03-06T10:00:00+08:00", dueAt: "2025-03-07T18:00:00+08:00",
    snoozedUntil: null, owner: "hana", agents: ["hana"], tags: ["汇报"],
    keywords: ["季度汇报", "Q1 汇报"], related: ["t_x"],
    createdAt: "2025-03-03T14:20:00+08:00", updatedAt: "2025-03-03T14:20:00+08:00",
    lastMentionedAt: "2025-03-03T14:20:00+08:00", lastFollowedAt: null, source: "chat",
    now: "初稿写了一半，数据部分还没拉。",
    next: ["找财务要 Q1 数据", "周四前给老板初稿"],
    logs: ["2025-03-03 14:20 · 拾遗聊天（小花）· 季度汇报周五 18 点前要交"],
  });
  const md = serializeThing(t);
  const back = parseThing(md);
  assert.equal(back.id, "t_0303_k3");
  assert.equal(back.title, "季度汇报");
  assert.equal(back.area, "work");
  assert.equal(back.status, "active");
  assert.equal(back.followUp, "auto");
  assert.equal(back.followUpAt, "2025-03-06T10:00:00+08:00");
  assert.equal(back.dueAt, "2025-03-07T18:00:00+08:00");
  assert.equal(back.snoozedUntil, null);
  assert.deepEqual(back.keywords, ["季度汇报", "Q1 汇报"]);
  assert.deepEqual(back.related, ["t_x"]);
  assert.equal(back.now, "初稿写了一半，数据部分还没拉。");
  assert.deepEqual(back.next, ["找财务要 Q1 数据", "周四前给老板初稿"]);
  assert.equal(back.logs.length, 1);
  assert.match(back.logs[0], /季度汇报/);
});

test("thing: 非法字段被纠正（area/status/followUp 枚举外 → 默认）", () => {
  const t = normalizeThing({ id: "t_x", title: "x", area: "space", status: "flying", followUp: "hard" });
  assert.equal(t.area, "work");
  assert.equal(t.status, "active");
  assert.equal(t.followUp, "auto");
});

test("note: 序列化→解析 往返一致（question 可选）", () => {
  const n = normalizeNote({
    id: "n_0220_a8", kind: "knowledge", title: "二分查找的循环不变量",
    tags: ["算法"], keywords: ["二分", "binary search"], thing: "t_0225_p1",
    source: "main", createdAt: "2025-02-20T21:03:00+08:00", updatedAt: "2025-02-20T21:03:00+08:00",
    content: "区间按左闭右开 `[l, r)` 理解。",
    question: "为什么 while 条件是 left < right？",
    sources: ["2025-02-20 · Hana 主对话「刷题」"],
  });
  const back = parseNote(serializeNote(n));
  assert.equal(back.id, "n_0220_a8");
  assert.equal(back.kind, "knowledge");
  assert.equal(back.content, "区间按左闭右开 `[l, r)` 理解。");
  assert.equal(back.question, "为什么 while 条件是 left < right？");
  assert.deepEqual(back.keywords, ["二分", "binary search"]);
  assert.equal(back.thing, "t_0225_p1");
  assert.equal(back.sources.length, 1);
});

test("note: 无 question 时不渲染「## 问题」", () => {
  const n = normalizeNote({ id: "n_x", kind: "howto", title: "t", content: "c" });
  const md = serializeNote(n);
  assert.ok(!md.includes("## 问题"));
  assert.equal(parseNote(md).question, null);
});

test("note: 非法 kind → knowledge", () => {
  assert.equal(normalizeNote({ id: "n_x", kind: "weird" }).kind, "knowledge");
});
