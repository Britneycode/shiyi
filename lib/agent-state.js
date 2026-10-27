// 幕间状态（养成改造批 3）：每助手一个 JSON 文件 <dataDir>/agent-state/<agentId>.json。
// 字段：{ mood, dwelling, lastEvolvedAt }。演化是规则驱动（不用模型），冷却见 STATE_EVOLVE_COOLDOWN_MS。

import fs from "node:fs";
import path from "node:path";
import { ensureDir, writeJsonAtomic } from "./atomic.js";
import { STATE_EVOLVE_COOLDOWN_MS } from "./config.js";

// 心情池 / 正在做的事池：演化时在各自池内轮换（简单、可解释）
const MOODS = ["平静", "闲适", "专注", "轻快", "有点困", "若有所思"];
const DWELLINGS = ["翻聊天记录", "整理记忆", "发呆", "看点东西", "等你回来"];

export function createAgentState({ dir, clock = () => Date.now() }) {
  const root = path.join(dir, "agent-state");
  const fileOf = (agentId) => path.join(root, `${encodeURIComponent(String(agentId))}.json`);

  function read(agentId) {
    try {
      const j = JSON.parse(fs.readFileSync(fileOf(agentId), "utf8"));
      return {
        mood: typeof j.mood === "string" ? j.mood : null,
        dwelling: typeof j.dwelling === "string" ? j.dwelling : null,
        lastEvolvedAt: typeof j.lastEvolvedAt === "string" ? j.lastEvolvedAt : null,
      };
    } catch {
      return null;
    }
  }

  function write(agentId, state) {
    ensureDir(root);
    writeJsonAtomic(fileOf(agentId), state);
  }

  /**
   * 低频演化：距上次演化超过冷却才动；每次心情和手头事各往下轮一个。
   * 初始（无文件）：mood=平静, dwelling=等你回来。
   * @returns 最新状态（未演化则返回原样；首次则落初始值）
   */
  function evolve(agentId) {
    const cur = read(agentId);
    const now = new Date(clock());
    if (!cur) {
      const init = { mood: MOODS[0], dwelling: DWELLINGS[DWELLINGS.length - 1], lastEvolvedAt: now.toISOString() };
      write(agentId, init);
      return init;
    }
    const last = cur.lastEvolvedAt ? new Date(cur.lastEvolvedAt).getTime() : 0;
    if (now.getTime() - last < STATE_EVOLVE_COOLDOWN_MS) return cur;
    const next = {
      mood: MOODS[(MOODS.indexOf(cur.mood) + 1 + MOODS.length) % MOODS.length],
      dwelling: DWELLINGS[(DWELLINGS.indexOf(cur.dwelling) + 1 + DWELLINGS.length) % DWELLINGS.length],
      lastEvolvedAt: now.toISOString(),
    };
    // 池外取值（手改文件）时回到池首
    if (!MOODS.includes(cur.mood)) next.mood = MOODS[0];
    if (!DWELLINGS.includes(cur.dwelling)) next.dwelling = DWELLINGS[0];
    write(agentId, next);
    return next;
  }

  return { read, write, evolve };
}
