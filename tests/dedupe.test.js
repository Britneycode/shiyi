import test from "node:test";
import assert from "node:assert/strict";
import { matchThing, hasConflict, decideThing, matchNote, subjectOf, isNearDuplicateUpdate } from "../lib/memory/dedupe.js";

test("dedupe: L3 事——同 area 标题相似 ≥0.6 → 命中", () => {
  const m = matchThing(
    { area: "work", title: "季度汇报初稿" },
    { area: "work", title: "季度汇报" },
  );
  assert.equal(m.l3, true);
  assert.ok(m.titleSim >= 0.6);
});

test("dedupe: L3 事——keywords 交集 ≥2 且标题 ≥0.4 → 命中；area 不同不命中", () => {
  const m1 = matchThing(
    { area: "work", title: "季度汇报PPT", keywords: ["季度汇报", "PPT", "演示"] },
    { area: "work", title: "季度汇报", keywords: ["季度汇报", "PPT"] },
  );
  assert.equal(m1.l3, true);
  const m2 = matchThing(
    { area: "life", title: "季度汇报PPT", keywords: ["季度汇报", "PPT"] },
    { area: "work", title: "季度汇报", keywords: ["季度汇报", "PPT"] },
  );
  assert.equal(m2.l3, false); // area 不同
});

test("dedupe: L3.5——否定冲突不合并（「不去了」vs「去爬山」）", () => {
  const c = hasConflict("周末不去爬山了", "周末去爬山");
  assert.equal(c.conflict, true);
  assert.equal(c.kind, "negation");
});

test("dedupe: L3.5——日期词冲突（「周五交」vs「下周三交」）", () => {
  const c = hasConflict("季度汇报周五交", "季度汇报下周三交");
  assert.equal(c.conflict, true);
  assert.equal(c.kind, "date");
});

test("dedupe: L3.5——版本冲突（v1.2 vs v1.3）与无冲突放行", () => {
  assert.equal(hasConflict("迁移到 v1.2", "迁移到 v1.3").conflict, true);
  assert.equal(hasConflict("季度汇报", "季度汇报").conflict, false);
});

test("dedupe: decideThing 三态——same/conflict/none", () => {
  const same = decideThing(
    { area: "work", title: "季度汇报", now: "初稿写了一半" },
    { area: "work", title: "季度汇报", now: "初稿动笔" },
  );
  assert.equal(same.verdict, "same");
  const conflict = decideThing(
    { area: "work", title: "季度汇报", now: "改到下周五交" },
    { area: "work", title: "季度汇报", now: "本周五交" },
  );
  assert.equal(conflict.verdict, "conflict");
  const none = decideThing(
    { area: "life", title: "买牛奶" },
    { area: "work", title: "季度汇报", now: "" },
  );
  assert.equal(none.verdict, "none");
});

test("dedupe: L3 知——同 kind 同主体、标题≥0.6 且内容≥0.5 → dup", () => {
  assert.equal(subjectOf("妈妈：不吃香菜"), "妈妈");
  assert.equal(subjectOf("二分查找"), "");
  const dup = matchNote(
    { kind: "person", title: "妈妈：不吃香菜", content: "妈妈对香菜完全不能接受，做菜一点都不要放" },
    { kind: "person", title: "妈妈：不吃香菜", content: "妈妈对香菜完全不能接受，做菜别放" },
  );
  assert.equal(dup.dup, true);
  // kind 不同 → 不算重
  assert.equal(matchNote(
    { kind: "life", title: "妈妈：不吃香菜", content: "x" },
    { kind: "person", title: "妈妈：不吃香菜", content: "x" },
  ).dup, false);
  // 主体不同 → 不算重
  assert.equal(matchNote(
    { kind: "person", title: "爸爸：不吃香菜", content: "爸爸不能吃香菜" },
    { kind: "person", title: "妈妈：不吃香菜", content: "妈妈不能吃香菜" },
  ).dup, false);
});

test("dedupe: update 近重复——≥0.8 且 24h 内 → 只碰 lastMentionedAt", () => {
  const thing = { logs: [{ at: new Date(Date.now() - 3600e3).toISOString(), text: "初稿写了一半，明天继续" }] };
  assert.equal(isNearDuplicateUpdate({ log: "初稿写了一半，明天继续写" }, thing), true);
  assert.equal(isNearDuplicateUpdate({ log: "完全不同的进展：已经交了" }, thing), false);
  const old = { logs: [{ at: new Date(Date.now() - 48 * 3600e3).toISOString(), text: "初稿写了一半" }] };
  assert.equal(isNearDuplicateUpdate({ log: "初稿写了一半" }, old), false); // 超 24h
});
