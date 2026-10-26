// 主动护栏（§4.8.2）：纯函数按顺序判断。返回 { ok:true } 或 { ok:false, reason }。

import { inQuietHours, quietEndAfter } from "../util.js";

const REASON_CATEGORY = {
  remind_due: null,            // 提醒不属类别开关
  followup_due: "work",        // 按事项 area 覆盖
  handoff_result: null,
  recent_work: "recentWork",
  followup_stale: "work",
  study_review: "study",
  chitchat: "chitchat",
};

/**
 * c: 候选；deps: { settings, st, threads, repo, now, agentHasModel, modelsInferOk }
 */
export async function check(c, { settings, st, threads, repo, now, agentHasModel, modelsInferOk }) {
  const s = settings.get();
  const p = s.proactive ?? {};

  // 1 总开关（引导完成前视为关）
  if (!s.onboarded || !p.enabled) return { ok: false, reason: "disabled" };

  // 2 按助手开关（聊过默认开；没聊过不主动；remind_due 例外照发）
  const agentOn = c.owner ? (p.agents?.[c.owner] ?? false) : false;
  if (!agentOn && c.reason !== "remind_due") return { ok: false, reason: "agent_off" };

  // 3 安静时段（remind_due 顺延到安静时段结束后首个 tick）
  const quiet = p.quiet;
  if (quiet?.enabled && inQuietHours(now, quiet)) {
    if (c.reason === "remind_due") return { ok: false, reason: "quiet_defer", deferUntil: quietEndAfter(now, quiet) };
    return { ok: false, reason: "quiet" };
  }

  // 4 每日上限（发送条数；remind_due 不计）
  const today = st.today;
  const date = new Date(now).toISOString().slice(0, 10);
  const sentToday = today?.date === date ? today.count : 0;
  if (c.reason !== "remind_due" && sentToday >= (p.dailyCap ?? 3)) return { ok: false, reason: "daily_cap" };

  // 5 最短间隔（全局；remind_due 不受限）
  const gapMs = (p.minGapMinutes ?? 120) * 60_000;
  if (c.reason !== "remind_due" && st.lastProactiveAt && now - st.lastProactiveAt < gapMs) {
    return { ok: false, reason: "min_gap" };
  }

  // 6 没回不追：任一线程 24h 内有未回复的主动消息（remind_due / handoff_result 不受限）
  if (p.noChaseUnanswered !== false && c.reason !== "remind_due" && c.reason !== "handoff_result") {
    const per = c.thingId ? st.perThing?.[c.thingId] : null;
    const unanswered = per?.unanswered ?? 0;
    // 同一事问到 2 次还没回 → 不再问第三次（引擎在第 2 次投递后已把 followUp 改 off，这里兜底）
    if (c.thingId && unanswered >= 2) return { ok: false, reason: "already_followed_twice" };
    // 「到点跟进」由头放行：同事第一次没回，到期再问一次（这是第二次也是最后一次）
    const dueKind = c.reason === "followup_due" || c.reason === "recent_work";
    if (!(c.thingId && dueKind && unanswered === 1) && await hasUnansweredProactive(threads, now)) {
      return { ok: false, reason: "no_chase" };
    }
  }

  // 7 用户正在拾遗里聊（10 分钟内发过消息）
  if (await userActiveRecently(threads, now, 10 * 60_000)) return { ok: false, reason: "user_active" };

  // 8 类别开关
  const cat = c.reason === "followup_due" || c.reason === "followup_stale" ? c.area : REASON_CATEGORY[c.reason];
  if (cat && p.categories?.[cat] === false) return { ok: false, reason: "category_off" };
  if (c.reason === "recent_work" && !s.memory?.learnFromMain) return { ok: false, reason: "learn_main_off" };

  // 9 事项级 snooze / 全局 snooze（remind_due 不受限）
  if (c.reason !== "remind_due") {
    if (st.globalSnoozeUntil && now < st.globalSnoozeUntil) return { ok: false, reason: "global_snooze" };
    const per = c.thingId ? st.perThing?.[c.thingId] : null;
    if (per?.snoozedUntil && now < per.snoozedUntil) return { ok: false, reason: "thing_snooze" };
    if (c.thingId && repo) {
      const full = await repo.getThing(c.thingId);
      if (full?.snoozedUntil && now < Date.parse(full.snoozedUntil)) return { ok: false, reason: "thing_snooze" };
    }
  }

  // 10 模型可用
  if (c.owner && !(await agentHasModel(c.owner))) return { ok: false, reason: "no_model" };
  if (modelsInferOk === false) return { ok: false, reason: "infer_denied" };

  return { ok: true };
}

async function hasUnansweredProactive(threads, now) {
  // 任一助手线程：最后一条 proactive 之后没有 user 消息 → 未回复
  const agentIds = await threads?.agentIds?.() ?? [];
  for (const id of agentIds) {
    const msgs = await threads._all(id);
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      const at = Date.parse(m.at ?? 0);
      if (now - at > 24 * 3600_000) break;
      if (m.role === "user") break; // 用户已回
      if (m.role === "assistant" && m.meta?.proactive) return true;
    }
  }
  return false;
}

async function userActiveRecently(threads, now, windowMs) {
  const agentIds = await threads?.agentIds?.() ?? [];
  for (const id of agentIds) {
    const msgs = await threads._all(id);
    const last = msgs[msgs.length - 1];
    if (last?.role === "user" && now - Date.parse(last.at ?? 0) < windowMs) return true;
  }
  return false;
}
