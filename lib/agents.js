// agent:list / agent:profile / 头像 / 聊天模型解析（缓存）。全部经 caps.call 包装，失败只降级。

import { AGENT_LIST_CACHE_MS, PROFILE_CACHE_MS } from "./config.js";
import { nonEmptyStr } from "./util.js";

export function createAgents({ ctx, caps }) {
  const listCache = { at: 0, items: [] };
  const profileCache = new Map(); // agentId -> { at, profile }
  const modelListCache = { at: 0, set: null };

  async function list({ force = false } = {}) {
    if (!force && Date.now() - listCache.at < AGENT_LIST_CACHE_MS) return listCache.items;
    if (!caps.has("bus.request")) return listCache.items;
    try {
      const res = await caps.call("agents.read", () =>
        ctx.bus.request("agent:list", { scope: "all", lifecycle: "active" }));
      const rows = res?.agents ?? res?.items ?? [];
      listCache.items = rows.map((r) => ({
        id: String(r.id ?? ""),
        name: String(r.name ?? r.id ?? ""),
        yuan: String(r.yuan ?? ""),
        isCurrent: !!r.isCurrent,
        state: String(r.state ?? ""),
      })).filter((r) => r.id);
      listCache.at = Date.now();
    } catch {}
    return listCache.items;
  }

  async function profile(agentId, { force = false } = {}) {
    const c = profileCache.get(agentId);
    if (!force && c && Date.now() - c.at < PROFILE_CACHE_MS) return c.profile;
    if (!caps.has("bus.request")) return c?.profile ?? null;
    try {
      // 列表跨分区，profile 也必须跨分区；宿主缺省 own 会拒绝其他助手。
      const res = await caps.call("agents.read", () => ctx.bus.request("agent:profile", { agentId, scope: "all" }));
      const p = res?.profile ?? null;
      if (p) profileCache.set(agentId, { at: Date.now(), profile: p });
      return p;
    } catch {
      return c?.profile ?? null;
    }
  }

  // 聊天模型：profile.models.chat，兼容 {provider,model} 与 {provider,id} 两种形状。
  function chatModelFromProfile(p) {
    const chat = p?.models?.chat;
    if (!chat) return null;
    const provider = nonEmptyStr(chat.provider);
    const model = nonEmptyStr(chat.model) ?? nonEmptyStr(chat.id);
    if (!provider || !model) return null;
    return { provider, model };
  }

  // 与 ctx.models.list() 对照（🧪 形状），确认模型真实存在。
  async function modelAvailable({ provider, model }) {
    if (!caps.has("models.list")) return true; // 不能确认时按可用，让调用方报真实错误
    try {
      if (Date.now() - modelListCache.at > PROFILE_CACHE_MS || !modelListCache.set) {
        const res = await caps.call("models.read", () => ctx.models.list());
        const rows = res?.models ?? res?.items ?? (Array.isArray(res) ? res : []);
        modelListCache.set = new Set(rows.map((r) => `${r.provider ?? ""}/${r.id ?? r.model ?? ""}`));
        modelListCache.at = Date.now();
      }
      return modelListCache.set.has(`${provider}/${model}`);
    } catch {
      return true;
    }
  }

  async function resolveChatModel(agentId) {
    const p = await profile(agentId);
    const m = chatModelFromProfile(p);
    if (!m) return null;
    return (await modelAvailable(m)) ? m : null;
  }

  return {
    list,
    profile,
    chatModelFromProfile,
    resolveChatModel,
    /** 启动 / 刷新（页面打开时 overview 触发 30s 节流由路由层控制） */
    async refresh() { await list({ force: true }); },
    /** 概览用的合并视图 */
    async overview() {
      const agents = await list();
      const out = [];
      for (const a of agents) {
        const p = await profile(a.id);
        const chatModel = chatModelFromProfile(p);
        out.push({
          id: a.id, name: a.name, yuan: a.yuan, isCurrent: a.isCurrent,
          chatModel: chatModel ? `${chatModel.provider}/${chatModel.model}` : null,
          memoryEnabled: p?.memoryPolicy?.enabled !== false,
        });
      }
      return out;
    },
  };
}
