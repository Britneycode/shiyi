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
