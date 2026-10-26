import test from "node:test";
import assert from "node:assert/strict";
import { search } from "../lib/memory/recall.js";

const things = [
  { id: "t_1", title: "季度汇报", area: "work", status: "active", keywords: ["PPT", "演示"], tags: ["工作"], now: "初稿写了一半", lastMentionedAt: new Date().toISOString() },
  { id: "t_2", title: "日语 N2 备考", area: "study", status: "active", keywords: ["日语", "考试"], tags: [], now: "背到第 3 单元", lastMentionedAt: new Date(Date.now() - 30 * 24 * 3600e3).toISOString() },
  { id: "t_3", title: "买牛奶", area: "life", status: "done", keywords: [], tags: [], now: "", lastMentionedAt: new Date().toISOString() },
];
const notes = [
  { id: "n_1", kind: "person", title: "妈妈：不吃香菜", content: "妈妈完全不能吃香菜，做菜别放", keywords: ["忌口"], tags: [] },
  { id: "n_2", kind: "howto", title: "git rebase 冲突处理", content: "冲突时逐个文件解决后 git rebase --continue", keywords: ["git"], tags: ["工具"] },
];

test("recall: 标题命中权重最高，未完成的事有加分", () => {
  const r = search({ things, notes: [], query: "季度汇报", limit: 8 });
  assert.equal(r[0].id, "t_1");
  assert.equal(r[0].type, "thing");
  // done 的事可被搜到但排后
  const r2 = search({ things, notes: [], query: "牛奶 汇报", limit: 8 });
  assert.ok(r2.find((x) => x.id === "t_1").score > r2.find((x) => x.id === "t_3")?.score || !r2.find((x) => x.id === "t_3"));
});

test("recall: keywords ×2 命中；内容 bigram ×0.5 兜底", () => {
  const r = search({ things: [], notes, query: "忌口", limit: 8 });
  assert.equal(r[0].id, "n_1");
  const r2 = search({ things: [], notes, query: "香菜 做菜", limit: 8 });
  assert.equal(r2[0].id, "n_1"); // 内容命中
});

test("recall: types 过滤与 limit；空查询返回空", () => {
  const r = search({ things, notes, query: "汇报 香菜", types: ["note"], limit: 8 });
  assert.ok(r.every((x) => x.type === "note"));
  assert.equal(search({ things, notes, query: "", limit: 8 }).length, 0);
  const r3 = search({ things, notes, query: "汇报 日语 香菜", limit: 2 });
  assert.ok(r3.length <= 2);
});

test("recall: 近 7 天提到的事 +1（与未提到对比）", () => {
  const a = { id: "t_a", title: "交作业", area: "study", status: "active", keywords: [], tags: [], now: "", lastMentionedAt: new Date().toISOString() };
  const b = { id: "t_b", title: "交作业", area: "study", status: "active", keywords: [], tags: [], now: "", lastMentionedAt: new Date(Date.now() - 30 * 24 * 3600e3).toISOString() };
  const r = search({ things: [b, a], notes: [], query: "交作业", limit: 8 });
  assert.equal(r[0].id, "t_a");
});
