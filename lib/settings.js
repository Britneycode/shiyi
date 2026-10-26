// settings.json 读写与校验。PATCH 走 validatePatch（字段校验，非法即拒）。

import path from "node:path";
import { readJsonSafe, writeJsonAtomic, withFileLock } from "./atomic.js";
import { defaultSettings, PRESETS, AREAS, NOTE_KINDS } from "./config.js";
import { clampInt, isObj } from "./util.js";

export function createSettings(dataDir) {
  const file = path.join(dataDir, "settings.json");
  /** @type {ReturnType<typeof defaultSettings>} */
  let cache = null;

  function normalize(s) {
    const d = defaultSettings();
    const out = { ...d, ...(isObj(s) ? s : {}) };
    out.proactive = { ...d.proactive, ...(isObj(s?.proactive) ? s.proactive : {}) };
    out.proactive.quiet = { ...d.proactive.quiet, ...(isObj(s?.proactive?.quiet) ? s.proactive.quiet : {}) };
    out.proactive.categories = { ...d.proactive.categories, ...(isObj(s?.proactive?.categories) ? s.proactive.categories : {}) };
    out.proactive.agents = isObj(s?.proactive?.agents) ? { ...s.proactive.agents } : {};
    out.memory = { ...d.memory, ...(isObj(s?.memory) ? s.memory : {}) };
    out.onboarded = !!out.onboarded;
    // 档位：改了任何一项即 custom（由调用方判断，这里只做范围规整）
    if (!PRESETS[out.proactive.preset]) out.proactive.preset = "custom";
    out.proactive.dailyCap = clampInt(out.proactive.dailyCap, 1, 30, 3);
    out.proactive.minGapMinutes = clampInt(out.proactive.minGapMinutes, 15, 720, 120);
    out.proactive.studyEveryDays = [1, 2, 3, 7].includes(out.proactive.studyEveryDays) ? out.proactive.studyEveryDays : 2;
    if (!["shared", "per-agent"].includes(out.memory.scope)) out.memory.scope = "shared";
    out.memory.extractDailyCap = clampInt(out.memory.extractDailyCap, 20, 500, 120);
    return out;
  }

  async function load() {
    if (cache) return cache;
    cache = normalize(await readJsonSafe(file, () => defaultSettings()));
    return cache;
  }

  async function save(next) {
    cache = normalize(next);
    await withFileLock(file, () => writeJsonAtomic(file, cache));
    return cache;
  }

  return {
    file,
    load,
    /** 同步取（需先 load 过一次） */
    get: () => cache ?? defaultSettings(),
    /** 完成引导：onboarded + learnFromMain + preset */
    async completeOnboarding({ learnFromMain, preset, proactiveEnabled }) {
      const cur = await load();
      cur.onboarded = true;
      cur.memory.learnFromMain = !!learnFromMain;
      cur.proactive.enabled = proactiveEnabled != null ? !!proactiveEnabled : preset !== "off";
      if (preset && preset !== "off") {
        const p = PRESETS[preset] ?? PRESETS.restrained;
        cur.proactive.preset = preset in PRESETS ? preset : "restrained";
        cur.proactive.dailyCap = p.dailyCap;
        cur.proactive.minGapMinutes = p.minGapMinutes;
      } else if (preset === "off") {
        cur.proactive.enabled = false;
      }
      return save(cur);
    },
    /** PATCH 字段校验：返回 { ok, value? , error? }。只接受白名单键。 */
    async patch(patch) {
      const cur = await load();
      const next = JSON.parse(JSON.stringify(cur));
      const err = applyPatch(next, patch);
      if (err) return { ok: false, error: err };
      // 改了 dailyCap/minGapMinutes → preset 视为 custom
      if (patch.proactive && ("dailyCap" in patch.proactive || "minGapMinutes" in patch.proactive)) {
        const p = patch.proactive;
        const matches = Object.entries(PRESETS).find(([, v]) => v.dailyCap === next.proactive.dailyCap && v.minGapMinutes === next.proactive.minGapMinutes);
        next.proactive.preset = matches ? matches[0] : "custom";
        void p;
      }
      await save(next);
      return { ok: true, value: next };
    },
  };
}

function applyPatch(s, patch) {
  if (!isObj(patch)) return "bad_patch";
  if ("onboarded" in patch) s.onboarded = !!patch.onboarded;
  if (isObj(patch.proactive)) {
    const p = patch.proactive, t = s.proactive;
    if ("enabled" in p) t.enabled = !!p.enabled;
    if ("preset" in p) {
      if (!PRESETS[p.preset]) return "bad_preset";
      t.preset = p.preset;
      t.dailyCap = PRESETS[p.preset].dailyCap;
      t.minGapMinutes = PRESETS[p.preset].minGapMinutes;
    }
    if ("dailyCap" in p) t.dailyCap = clampInt(p.dailyCap, 1, 30, t.dailyCap);
    if ("minGapMinutes" in p) t.minGapMinutes = clampInt(p.minGapMinutes, 15, 720, t.minGapMinutes);
    if ("noChaseUnanswered" in p) t.noChaseUnanswered = !!p.noChaseUnanswered;
    if (isObj(p.quiet)) {
      if ("enabled" in p.quiet) t.quiet.enabled = !!p.quiet.enabled;
      if ("start" in p.quiet && /^\d{1,2}:\d{2}$/.test(p.quiet.start)) t.quiet.start = p.quiet.start;
      if ("end" in p.quiet && /^\d{1,2}:\d{2}$/.test(p.quiet.end)) t.quiet.end = p.quiet.end;
    }
    if (isObj(p.categories)) {
      for (const k of ["work", "life", "study", "recentWork", "chitchat"]) {
        if (k in p.categories) t.categories[k] = !!p.categories[k];
      }
    }
    if ("studyEveryDays" in p) t.studyEveryDays = [1, 2, 3, 7].includes(p.studyEveryDays) ? p.studyEveryDays : t.studyEveryDays;
    if (isObj(p.agents)) {
      for (const [id, v] of Object.entries(p.agents)) if (typeof v === "boolean") t.agents[id] = v;
    }
  }
  if (isObj(patch.memory)) {
    const m = patch.memory, t = s.memory;
    if ("learnFromChat" in m) t.learnFromChat = !!m.learnFromChat;
    if ("learnFromMain" in m) t.learnFromMain = !!m.learnFromMain;
    if ("scope" in m) {
      if (!["shared", "per-agent"].includes(m.scope)) return "bad_scope";
      t.scope = m.scope;
    }
    if ("extractDailyCap" in m) t.extractDailyCap = clampInt(m.extractDailyCap, 20, 500, t.extractDailyCap);
  }
  return null;
}
