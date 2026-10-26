// 记忆守卫（沿用 v7）：agent:profile → memoryPolicy.enabled，60s 缓存。
// 返回 on | off | unknown；off/unknown 时后台提取与记录工具都停（§4.11）。

import { MEMORY_POLICY_CACHE_MS } from "./config.js";

export function createAgentPolicy({ ctx, caps, agents }) {
  const cache = new Map(); // agentId -> { at, state }

  async function memoryState(agentId, { force = false } = {}) {
    const c = cache.get(agentId);
    if (!force && c && Date.now() - c.at < MEMORY_POLICY_CACHE_MS) return c.state;
    let state = "unknown";
    try {
      const p = agents
        ? await agents.profile(agentId)
        : (await caps.call("agents.read", () => ctx.bus.request("agent:profile", { agentId })))?.profile;
      if (p?.memoryPolicy && typeof p.memoryPolicy.enabled === "boolean") {
        state = p.memoryPolicy.enabled ? "on" : "off";
      } else if (p) {
        state = "unknown"; // 有 profile 但没明确开关 → 确认不了
      }
    } catch {
      state = c?.state ?? "unknown";
    }
    cache.set(agentId, { at: Date.now(), state });
    return state;
  }

  return {
    memoryState,
    /** 可读记忆文件 / 可调提取 / 可用记录工具 */
    canLearn: async (agentId) => (await memoryState(agentId)) === "on",
    /** 可注入 pinned / facts（§1.3：关记忆时不注入） */
    canInjectUserMemory: async (agentId) => (await memoryState(agentId)) === "on",
    invalidate: (agentId) => cache.delete(agentId),
  };
}
