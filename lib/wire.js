// 装配（§3）：把全部模块按依赖顺序拼起来。index.js 与 routes/ui.js 共用，避免循环依赖。

import path from "node:path";
import { createCaps } from "./caps.js";
import { createSettings } from "./settings.js";
import { createMemoryRepo } from "./memory/repo.js";
import { createAgents } from "./agents.js";
import { createPersona } from "./persona.js";
import { createAgentPolicy } from "./agent-policy.js";
import { createMainfeed } from "./mainfeed.js";
import { createModel } from "./model.js";
import { createThreads } from "./threads.js";
import { createAgentState } from "./agent-state.js";
import { createChat } from "./chat.js";
import { createExtractor } from "./memory/extract.js";
import { createHandoff } from "./handoff.js";
import { createProactiveEngine } from "./proactive/engine.js";
import { createBanner } from "./proactive/banner.js";
import { createHostTools } from "./tools-host.js";
import { search as recallSearch } from "./memory/recall.js";

const cache = new WeakMap(); // ctx -> deps（同一 ctx 只装配一次）

/** 装配全部依赖。装载期安全：全是构造函数，无受保护调用。 */
export function wire(ctx) {
  const hit = cache.get(ctx);
  if (hit) return hit;

  const caps = createCaps(ctx);
  const settings = createSettings(ctx.dataDir);
  const repo = createMemoryRepo({ dir: ctx.dataDir });
  const agents = createAgents({ ctx, caps });
  const policy = createAgentPolicy({ ctx, caps, agents });
  const persona = createPersona({ ctx, caps, agents, policy });
  const model = createModel({ ctx, caps });
  const threads = createThreads({ dir: path.join(ctx.dataDir, "threads") });
  const agentState = createAgentState({ dir: ctx.dataDir });
  const extractor = createExtractor({ repo, model, settings, policy, agents });
  const mainfeed = createMainfeed({ dir: ctx.dataDir, settings, extractor, policy });
  const banner = createBanner({ ctx, settings, clock: () => Date.now() });
  const engine = createProactiveEngine({
    model, persona, repo, threads, banner, settings, agents, mainfeed, agentState, clock: () => Date.now(),
  });
  const handoff = createHandoff({ ctx, caps, repo, threads, mainfeed, engine });
  // 交接会话的结果回流：mainfeed 通过 handoffs.thingFor 放行该会话
  mainfeed.handoffs = handoff;
  const chat = createChat({
    model, persona, agents, repo, threads, extractor, settings, mainfeed, agentState,
    clock: () => Date.now(),
  });
  const hostTools = createHostTools({ ctx, caps, repo, recallSearch });

  const deps = {
    ctx, caps, settings, repo, threads, agents, persona, policy, agentState,
    model, extractor, chat, engine, handoff, banner, mainfeed, hostTools, recallSearch,
  };
  cache.set(ctx, deps);
  return deps;
}
