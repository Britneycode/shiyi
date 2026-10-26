import test from "node:test";
import assert from "node:assert/strict";
import { createAgentPolicy } from "../lib/agent-policy.js";
import { createCaps } from "../lib/caps.js";
import { createAgents } from "../lib/agents.js";
import { fakeCtx } from "./helpers.js";

function ctxWithProfile(profile) {
  return fakeCtx({
    bus: {
      subscribe: () => {},
      request: async (method, args) => {
        if (method === "agent:list") return { agents: [{ id: "hana", name: "小花" }] };
        if (method === "agent:profile") return { profile }; // 宿主契约：profile 包一层
        throw new Error("denied");
      },
    },
  });
}

test("agent-policy: memoryPolicy.enabled=false → off；true → on；缺字段 → unknown", async () => {
  const ctxOff = ctxWithProfile({ agentId: "hana", memoryPolicy: { enabled: false } });
  const p1 = createAgentPolicy({ ctx: ctxOff, caps: createCaps(ctxOff), agents: createAgents({ ctx: ctxOff, caps: createCaps(ctxOff) }) });
  assert.equal(await p1.memoryState("hana", { force: true }), "off");
  assert.equal(await p1.canLearn("hana"), false);
  assert.equal(await p1.canInjectUserMemory("hana"), false);

  const ctxOn = ctxWithProfile({ agentId: "hana", memoryPolicy: { enabled: true } });
  const p2 = createAgentPolicy({ ctx: ctxOn, caps: createCaps(ctxOn), agents: createAgents({ ctx: ctxOn, caps: createCaps(ctxOn) }) });
  assert.equal(await p2.memoryState("hana", { force: true }), "on");
  assert.equal(await p2.canLearn("hana"), true);

  const ctxUnk = ctxWithProfile({ agentId: "hana" });
  const p3 = createAgentPolicy({ ctx: ctxUnk, caps: createCaps(ctxUnk), agents: createAgents({ ctx: ctxUnk, caps: createCaps(ctxUnk) }) });
  assert.equal(await p3.memoryState("hana", { force: true }), "unknown");
  assert.equal(await p3.canLearn("hana"), false); // unknown 一律按不可学
});

test("agents: 跨分区读取 profile 显式传 scope=all，取到模型与记忆设置", async () => {
  const ctx = fakeCtx({
    bus: {
      subscribe: () => {},
      request: async (method, args) => {
        // 宿主契约：scope 缺省为 own，读取其他应用的助手会被拒绝。
        if (method === "agent:list") return { agents: [{ id: "hana", name: "小花", ownerPluginId: null }] };
        if (method === "agent:profile" && args.scope === "all") {
          return { profile: { models: { chat: { provider: "p", model: "m" } }, memoryPolicy: { enabled: false } } };
        }
        throw new Error(`agent:profile: agent "hana" does not belong to app "shiyi"`);
      },
    },
  });
  const agents = createAgents({ ctx, caps: createCaps(ctx) });
  const [overview] = await agents.overview();
  assert.equal(overview.chatModel, "p/m");
  assert.equal(overview.memoryEnabled, false);
});

test("agent-policy: profile 请求失败 → unknown（不抛）", async () => {
  const ctx = fakeCtx({
    bus: {
      subscribe: () => {},
      request: async (m) => { if (m === "agent:list") return { agents: [] }; throw new Error("denied"); },
    },
  });
  const p = createAgentPolicy({ ctx, caps: createCaps(ctx), agents: createAgents({ ctx, caps: createCaps(ctx) }) });
  assert.equal(await p.memoryState("ghost", { force: true }), "unknown");
});
