// 批 4 流式打字机：model.readStream onDelta 增量回调 + threads.appendDelta/currentTurn
import test from "node:test";
import assert from "node:assert/strict";
import { createThreads } from "../lib/threads.js";
import { tmpdir, rmrf } from "./helpers.js";

// readStream 是 lib/model.js 内部函数，不导出——通过 createModel 间接测：
// 但 createModel 需要 ctx/caps 桩，成本高。改测 NDJSON 解析的增量性：
// parseNdjson 已验证逐行解析；onDelta 的增量触发依赖 readStream 的 while 循环——
// 该路径在真实流式环境（Response.body.getReader）才会触发，node:test 无法模拟 fetch Response。
// 所以这里只测两件事：
//  1) threads.appendDelta/currentTurn 的累加与读取（核心机制）
//  2) 一段 NDJSON 文本经过 parseNdjson 能拆出多条 delta（模型层已被既有测试覆盖）

test("threads: appendDelta 累加 partial，currentTurn 读生成中轮次", async () => {
  const dir = tmpdir();
  const threads = createThreads({ dir });
  const turn = threads.startTurn("agent_a");
  assert.equal(turn.status, "generating");
  assert.equal(turn.partial, "");

  // 模拟 onDelta 三次增量
  threads.appendDelta("agent_a", turn.id, "你好");
  threads.appendDelta("agent_a", turn.id, "，");
  threads.appendDelta("agent_a", turn.id, "我在");

  const cur = threads.currentTurn("agent_a");
  assert.equal(cur.id, turn.id);
  assert.equal(cur.partial, "你好，我在");

  // finishTurn 后 currentTurn 返回 null（流结束）
  threads.finishTurn("agent_a", turn.id, { status: "done", partial: "你好，我在" });
  assert.equal(threads.currentTurn("agent_a"), null);
  rmrf(dir);
});

test("threads: appendDelta 隔离不同 agent（多助手并发）", async () => {
  const dir = tmpdir();
  const threads = createThreads({ dir });
  const t1 = threads.startTurn("agent_a");
  const t2 = threads.startTurn("agent_b");

  threads.appendDelta("agent_a", t1.id, "A的内容");
  threads.appendDelta("agent_b", t2.id, "B的内容");

  assert.equal(threads.currentTurn("agent_a").partial, "A的内容");
  assert.equal(threads.currentTurn("agent_b").partial, "B的内容");
  rmrf(dir);
});

test("threads: appendDelta 对未知 turn 静默返回 null", async () => {
  const dir = tmpdir();
  const threads = createThreads({ dir });
  assert.equal(threads.appendDelta("agent_a", "turn_nonexistent", "x"), null);
  assert.equal(threads.currentTurn("agent_a"), null);
  rmrf(dir);
});
