// 人格与记忆文件读取 + 字数预算（§4.1）。只读注入；记忆关闭时不读 pinned/facts。
// resources.read 被拒 → 退回 profile.identity / description / yuan。

import path from "node:path";
import { PERSONA_FILE_BUDGETS, PERSONA_CACHE_MS } from "./config.js";
import { truncateByParagraph } from "./util.js";

// HANA_HOME = dirname(dirname(ctx.dataDir))（dataDir = <HANA_HOME>/app-data/shiyi/）
function hanaHome(dataDir) {
  return path.dirname(path.dirname(dataDir));
}

export function createPersona({ ctx, caps, agents, policy }) {
  const dataDir = ctx.dataDir;
  const cache = new Map(); // agentId -> { at, persona }

  async function readAgentFile(agentId, rel) {
    if (!caps.has("resources.read")) return null;
    const p = path.join(hanaHome(dataDir), "agents", agentId, rel);
    try {
      const res = await caps.call("resources.read", () =>
        ctx.resources.read({ kind: "local-file", path: p }));
      const text = typeof res === "string" ? res : res?.text ?? res?.content ?? null;
      return typeof text === "string" ? text : null;
    } catch {
      return null;
    }
  }

  async function build(agentId) {
    const prof = await agents.profile(agentId);
    const memoryOn = policy ? (await policy.memoryState(agentId)) === "on" : true;
    const parts = { identity: "", description: "", publicDoc: "", pinned: "", facts: "", experience: "" };

    // 人格主体：优先文件，失败退回 profile
    parts.identity = (await readAgentFile(agentId, "identity.md")) ?? String(prof?.identity ?? "");
    parts.description = (await readAgentFile(agentId, "description.md")) ?? String(prof?.description ?? "");
    parts.publicDoc = (await readAgentFile(agentId, "AGENTS.public.md")) ?? "";
    parts.experience = (await readAgentFile(agentId, "experience.md")) ?? "";
    // 记忆关闭时不读 pinned / facts（§1.3）
    if (memoryOn) {
      parts.pinned = (await readAgentFile(agentId, "pinned.md")) ?? "";
      parts.facts = (await readAgentFile(agentId, "memory/facts.md")) ?? "";
    }
    const budgets = PERSONA_FILE_BUDGETS;
    return {
      memoryOn,
      yuan: String(prof?.yuan ?? ""),
      identity: truncateByParagraph(parts.identity, budgets["identity.md"]),
      description: truncateByParagraph(parts.description, budgets["description.md"]),
      publicDoc: truncateByParagraph(parts.publicDoc, budgets["AGENTS.public.md"]),
      pinned: truncateByParagraph(parts.pinned, budgets["pinned.md"]),
      facts: truncateByParagraph(parts.facts, budgets["memory/facts.md"]),
      experience: truncateByParagraph(parts.experience, budgets["experience.md"]),
    };
  }

  return {
    /** 组装人格块（≤ BUDGET_PERSONA）与「关于用户」（记忆关时为空） */
    async get(agentId, { force = false } = {}) {
      const c = cache.get(agentId);
      if (!force && c && Date.now() - c.at < PERSONA_CACHE_MS) return c.persona;
      const persona = await build(agentId);
      cache.set(agentId, { at: Date.now(), persona });
      return persona;
    },
    /** 人格块文本（注入聊天 system prompt 第 2 项） */
    async personaBlock(agentId, opts) {
      const p = await this.get(agentId, opts);
      const chunks = [];
      if (p.yuan) chunks.push(`【一句话】${p.yuan}`);
      if (p.identity) chunks.push(`【人格】\n${p.identity}`);
      if (p.description) chunks.push(`【简介】\n${p.description}`);
      if (p.publicDoc) chunks.push(`【公开设定】\n${p.publicDoc}`);
      if (p.experience) chunks.push(`【协作经验】\n${p.experience}`);
      return chunks.join("\n\n");
    },
    /** 「关于用户」块（pinned + facts；记忆关时省略） */
    async aboutUserBlock(agentId, opts) {
      const p = await this.get(agentId, opts);
      if (!p.memoryOn) return "";
      const chunks = [];
      if (p.pinned) chunks.push(p.pinned);
      if (p.facts) chunks.push(p.facts);
      return chunks.join("\n\n");
    },
    invalidate: (agentId) => cache.delete(agentId),
  };
}
