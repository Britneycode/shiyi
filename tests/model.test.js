import test from "node:test";
import assert from "node:assert/strict";
import { createModel, parseNdjson, normalizeToolId } from "../lib/model.js";
import { createCaps } from "../lib/caps.js";
import { fakeCtx } from "./helpers.js";

function ctxWithStream(streamImpl, extra = {}) {
  return fakeCtx({
    models: {
      stream: streamImpl,
      cancel: extra.cancel ?? (async () => {}),
      utility: extra.utility,
    },
  });
}

const nd = (lines) => lines.map((l) => JSON.stringify(l)).join("\n") + "\n";

test("model: NDJSON 解析 text-delta/done/usage；reasoning 丢弃", async () => {
  const p = parseNdjson(nd([
    { type: "text-delta", delta: "你" },
    { type: "reasoning-delta", delta: "（思考）" },
    { type: "text-delta", delta: "好" },
    { type: "done", stopReason: "end_turn", usage: { input: 10, output: 2 } },
  ]));
  assert.equal(p.text, "你好");
  assert.equal(p.done.usage.output, 2);
  assert.equal(p.toolCalls.length, 0);
});

test("model: 假时钟聊天正文 = 两次 text-delta 拼接；requestId 一次性且收到 cancel", async () => {
  const seen = [];
  const canceled = [];
  const ctx = ctxWithStream(async (req) => {
    seen.push(req.requestId);
    return nd([{ type: "text-delta", delta: "在的" }, { type: "done", stopReason: "end_turn" }]);
  }, { cancel: async (id) => { canceled.push(id); } });
  const m = createModel({ ctx, caps: createCaps(ctx) });
  const r = await m.chat({ provider: "p", model: "x", systemPrompt: "s", messages: [] });
  assert.equal(r.text, "在的");
  assert.equal(seen.length, 1);
  assert.deepEqual(canceled, seen); // finally 里按 requestId 取消
});

test("model: 空输出 → maxTokens 加倍重试一次", async () => {
  const calls = [];
  const ctx = ctxWithStream(async (req) => {
    calls.push(req.maxTokens);
    if (calls.length === 1) return nd([{ type: "done", stopReason: "end_turn" }]); // 空
    return nd([{ type: "text-delta", delta: "有了" }, { type: "done", stopReason: "end_turn" }]);
  });
  const m = createModel({ ctx, caps: createCaps(ctx) });
  const r = await m.chat({ provider: "p", model: "x", systemPrompt: "s", messages: [], maxTokens: 900 });
  assert.equal(r.text, "有了");
  assert.deepEqual(calls, [900, 1800]);
});

test("model: 工具循环——tool-call 交回应用，toolResult 回喂，≤3 调用 ≤2 轮", async () => {
  const rounds = [];
  const ctx = ctxWithStream(async (req) => {
    const round = rounds.length;
    rounds.push(req);
    if (round === 0) {
      return nd([
        { type: "tool-call", toolCall: { id: "call:1/bad id", name: "search_memory", input: { q: "汇报" } } },
        { type: "done", stopReason: "tool_use" },
      ]);
    }
    // 第二轮：消息里应带着上一轮 assistant(toolCall) + toolResult
    const last = req.messages[req.messages.length - 1];
    if (last.role !== "toolResult") return nd([{ type: "text-delta", delta: "BAD" }, { type: "done" }]);
    return nd([{ type: "text-delta", delta: "查到了：周五 18 点" }, { type: "done", stopReason: "end_turn" }]);
  });
  const m = createModel({ ctx, caps: createCaps(ctx) });
  const ran = [];
  const r = await m.chat({
    provider: "p", model: "x", systemPrompt: "s",
    messages: [{ role: "user", content: [{ type: "text", text: "汇报什么时候交？" }] }],
    tools: [{ name: "search_memory" }],
    toolRunner: async (name, input) => { ran.push([name, input]); return { text: "结果：周五 18 点" }; },
  });
  assert.equal(r.text, "查到了：周五 18 点");
  assert.deepEqual(ran, [["search_memory", { q: "汇报" }]]);
  assert.equal(r.toolResults.length, 1);
  // 第二轮消息序列含 assistant 回放与 toolResult
  const msgs = rounds[1].messages;
  const asst = msgs.find((x) => x.role === "assistant");
  const tr = msgs.find((x) => x.role === "toolResult");
  assert.ok(asst && tr);
  assert.equal(tr.toolName, "search_memory");
  // id 已规整为合法字符
  assert.match(tr.toolCallId, /^[A-Za-z0-9_-]{1,128}$/);
  assert.equal(r.toolCalls[0].id, tr.toolCallId);
});

test("model: normalizeToolId 规整非法字符并兜底", () => {
  assert.match(normalizeToolId("call:1/bad id"), /^[A-Za-z0-9_-]{1,128}$/);
  assert.ok(normalizeToolId("", "search_memory").length >= 1);
  assert.ok(normalizeToolId("x".repeat(200)).length <= 128);
});

test("model: 只在 done.assistant.content 里的 toolCall 也能收到", async () => {
  let n = 0;
  const ctx = ctxWithStream(async () => {
    n++;
    if (n === 1) {
      return nd([
        {
          type: "done", stopReason: "tool_use",
          assistant: { content: [{ type: "toolCall", toolCall: { id: "t1", name: "note_thing", input: { title: "x" } } }] },
        },
      ]);
    }
    return nd([{ type: "text-delta", delta: "记下了" }, { type: "done", stopReason: "end_turn" }]);
  });
  const m = createModel({ ctx, caps: createCaps(ctx) });
  const ran = [];
  const r = await m.chat({
    provider: "p", model: "x", systemPrompt: "s", messages: [],
    tools: [{ name: "note_thing" }],
    toolRunner: async () => { ran.push(1); return { text: "已记下" }; },
  });
  assert.equal(ran.length, 1);
  assert.equal(r.toolCalls[0].name, "note_thing");
  assert.equal(r.text, "记下了");
});

test("model: provider 不支持工具 → 去工具重试并记忆 24h", async () => {
  let n = 0;
  const sawTools = [];
  const ctx = ctxWithStream(async (req) => {
    n++;
    sawTools.push(!!req.tools);
    if (n === 1) return nd([{ type: "error", code: "unsupported", message: "tools not supported" }]);
    return nd([{ type: "text-delta", delta: "不用工具也能答" }, { type: "done", stopReason: "end_turn" }]);
  });
  const m = createModel({ ctx, caps: createCaps(ctx) });
  const r1 = await m.chat({
    provider: "p", model: "x", systemPrompt: "s", messages: [],
    tools: [{ name: "note_thing" }], toolRunner: async () => ({ text: "ok" }),
  });
  assert.equal(r1.text, "不用工具也能答");
  assert.deepEqual(sawTools, [true, false]); // 第二次自动去工具
  assert.equal(m.supportsTools("p", "x"), false); // 24h 内记住
  // 再调一次：直接不带工具
  const r2 = await m.chat({
    provider: "p", model: "x", systemPrompt: "s", messages: [],
    tools: [{ name: "note_thing" }], toolRunner: async () => ({ text: "ok" }),
  });
  assert.equal(r2.noTools, true);
});

test("model: 工具循环轮次封顶（≤2 轮）后停在最后一次输出", async () => {
  let n = 0;
  const ctx = ctxWithStream(async () => {
    n++;
    if (n <= 3) {
      return nd([
        { type: "tool-call", toolCall: { id: `c${n}`, name: "search_memory", input: { q: "x" } } },
        { type: "done", stopReason: "tool_use" },
      ]);
    }
    return nd([{ type: "text-delta", delta: "收尾" }, { type: "done", stopReason: "end_turn" }]);
  });
  const m = createModel({ ctx, caps: createCaps(ctx) });
  const r = await m.chat({
    provider: "p", model: "x", systemPrompt: "s", messages: [],
    tools: [{ name: "search_memory" }], toolRunner: async () => ({ text: "r" }),
  });
  assert.equal(r.toolCalls.length, 2); // ≤2 轮 = 执行了 2 次工具
  assert.equal(n, 3); // 第 3 次模型调用收到的 tool-call 不再执行，循环到此为止
  assert.equal(r.text, ""); // 没有正文，封顶即返回
});

test("model: utility 透传 maxTokens，返回 {text}", async () => {
  const seen = [];
  const ctx = ctxWithStream(null, {
    utility: async (req) => { seen.push(req); return { text: "{\"ok\":true}" }; },
  });
  const m = createModel({ ctx, caps: createCaps(ctx) });
  const r = await m.utility({ provider: "p", model: "x", systemPrompt: "s", user: "u", maxTokens: 1500 });
  assert.equal(r.text, "{\"ok\":true}");
  assert.equal(seen[0].maxTokens, 1500);
  assert.equal(seen[0].messages[0].role, "user");
});
