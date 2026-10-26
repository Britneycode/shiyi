import test from "node:test";
import assert from "node:assert/strict";
import { bigrams, jaccard, bigramOverlap, inQuietHours, quietEndAfter, stripModelBlocks, localISO, msgTimePrefix, truncateByParagraph, shortId, norm, tokens } from "../lib/util.js";

test("util: bigrams 中文 bigram + 英文词", () => {
  const b = bigrams("季度汇报 report");
  assert.ok(b.has("季度"));
  assert.ok(b.has("汇报"));
  assert.ok(b.has("report"));
});

test("util: jaccard / bigramOverlap 阈值行为", () => {
  assert.ok(bigramOverlap("季度汇报初稿", "季度汇报终稿") > 0.4);
  assert.ok(bigramOverlap("季度汇报", "游泳课报名") < 0.2);
  assert.equal(jaccard([], []), 0);
});

test("util: inQuietHours 跨零点 23:00–08:00", () => {
  const quiet = { enabled: true, start: "23:00", end: "08:00" };
  assert.equal(inQuietHours(new Date(2025, 2, 3, 23, 30), quiet), true);
  assert.equal(inQuietHours(new Date(2025, 2, 3, 3, 0), quiet), true);
  assert.equal(inQuietHours(new Date(2025, 2, 3, 12, 0), quiet), false);
  assert.equal(inQuietHours(new Date(2025, 2, 3, 8, 0), quiet), false); // 结束点不含
});

test("util: quietEndAfter 给安静结束时刻", () => {
  const quiet = { start: "23:00", end: "08:00" };
  const t = new Date(2025, 2, 3, 23, 30).getTime();
  const end = quietEndAfter(t, quiet);
  assert.equal(new Date(end).getHours(), 8);
  assert.equal(new Date(end).getDate(), 4); // 跨到第二天
});

test("util: stripModelBlocks 去 think 块含未闭合尾巴", () => {
  assert.equal(stripModelBlocks("你好<think>想很多</think>世界"), "你好\n世界".replace(/\n/, "")); // trim 后拼接
  assert.equal(stripModelBlocks("正文<analysis>半截"), "正文");
});

test("util: localISO 带偏移；msgTimePrefix 格式", () => {
  const d = new Date(2025, 2, 3, 14, 20, 0);
  assert.match(localISO(d), /^2025-03-03T14:20:00[+-]\d{2}:\d{2}$/);
  assert.equal(msgTimePrefix(d), "[03-03 14:20]");
});

test("util: shortId 支持 at 参数（假时钟）", () => {
  assert.match(shortId("t", "2025-03-03T10:00:00+08:00"), /^t_0303_[0-9a-z]{3}$/);
});

test("util: truncateByParagraph 保完整段落", () => {
  const s = "第一段。\n\n第二段比较长。\n\n第三段。";
  const out = truncateByParagraph(s, 12);
  assert.ok(out.startsWith("第一段。"));
  assert.ok(!out.includes("第三段"));
});

test("util: norm/tokens NFKC 小写", () => {
  assert.equal(norm("ＡＢＣ "), "abc");
  assert.deepEqual(tokens("Hello world 世界"), ["hello", "world"]);
});
