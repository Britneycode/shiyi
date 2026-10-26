import test from "node:test";
import assert from "node:assert/strict";
import { createCaps } from "../lib/caps.js";
import { fakeCtx } from "./helpers.js";

test("caps: typeof 探测——has() 反映函数存在与否；auth 未调用时 unknown", () => {
  const ctx = fakeCtx({ models: { stream: async () => {}, utility: async () => {} } });
  const caps = createCaps(ctx);
  assert.equal(caps.auth("models.stream"), "unknown");
  assert.equal(caps.has("models.stream"), true);
  assert.equal(caps.has("models.list"), false);
  assert.equal(caps.has("inputBanner.set"), false);
});

test("caps: call 成功 → ok", async () => {
  const ctx = fakeCtx({ models: { stream: async () => ({ ok: 1 }) } });
  const caps = createCaps(ctx);
  const v = await caps.call("models.stream", () => ctx.models.stream());
  assert.equal(v.ok, 1);
  assert.equal(caps.auth("models.stream"), "ok");
});

test("caps: call 报权限错 → denied；不支持 → unsupported", async () => {
  const ctx = fakeCtx({
    models: {
      stream: async () => { throw new Error("permission denied"); },
      utility: async () => { throw new Error("method unsupported"); },
    },
  });
  const caps = createCaps(ctx);
  await assert.rejects(caps.call("models.stream", () => ctx.models.stream()));
  await assert.rejects(caps.call("models.utility", () => ctx.models.utility({})));
  assert.equal(caps.auth("models.stream"), "denied");
  assert.equal(caps.auth("models.utility"), "unsupported");
});

test("caps: 未知错误 → unknown 保持", async () => {
  const ctx = fakeCtx({ models: { stream: async () => { throw new Error("network boom"); } } });
  const caps = createCaps(ctx);
  await assert.rejects(caps.call("models.stream", () => ctx.models.stream()));
  assert.equal(caps.auth("models.stream"), "unknown");
});

test("caps: snapshot 输出状态表", () => {
  const ctx = fakeCtx({ bus: { subscribe: () => {}, request: async () => {} } });
  const caps = createCaps(ctx);
  const snap = caps.snapshot();
  assert.equal(snap["bus.subscribe"].feature, true);
  assert.equal(snap["inputBanner.set"].feature, false);
  assert.equal(snap["bus.request"].auth, "unknown");
});
