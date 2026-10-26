// 横幅（§4.8.5）：挂在用户最近开口的会话上，在场租约防打扰，这批翻篇才摘。

import { PANEL_OPEN_MS } from "../config.js";

const BANNER_ID = "shiyi-arrived";
const REASON_LABEL = {
  remind_due: "到时提醒", followup_due: "工作跟进", handoff_result: "交接有结果了",
  recent_work: "主对话近况", followup_stale: "久未提起", study_review: "学习回顾", chitchat: "闲聊",
};

export function createBanner({ ctx, settings, engine, clock = () => Date.now() }) {
  let activeSessionPath = null;
  let lastUserSpokeAt = 0;   // 在场租约起点（turn_start 或 banner 事件携带的会话活动时间）
  let current = null;        // { batchKey, agentIds:Set, reason, thingIds:Set }

  function textOf() {
    const reasons = [...new Set(current.reasons)];
    const names = [...current.agentNames];
    const who = names.length ? `${names.join("、")}：` : "";
    if (reasons.length === 1) return `${who}拾遗主动来消息了（${reasons[0]}）`;
    return `${who}拾遗主动来消息了（${reasons.join("、")}）`;
  }

  async function setBanner() {
    if (!activeSessionPath || !current) return;
    try {
      await ctx.inputBanner?.set?.({
        sessionPath: activeSessionPath,
        bannerId: BANNER_ID,
        text: textOf(),
        buttons: [{ id: "ok", title: "知道了", action: { kind: "notify-plugin" } }],
      });
    } catch { /* 横幅失败不影响投递 */ }
  }

  async function dismissBanner() {
    if (!activeSessionPath) return;
    try { await ctx.inputBanner?.dismiss?.({ sessionPath: activeSessionPath, bannerId: BANNER_ID }); } catch {}
  }

  return {
    /** engine 投递后调用：登记这批到达，尝试挂横幅 */
    async arrive({ agentId, reason, thingId, text }) {
      const batchKey = `${Math.floor(clock() / 30000)}`; // 30s 内算一批
      if (!current || current.batchKey !== batchKey) {
        current = { batchKey, agentIds: new Set(), agentNames: new Set(), reasons: [], thingIds: new Set() };
      }
      current.agentIds.add(agentId);
      current.reasons.push(REASON_LABEL[reason] ?? reason);
      if (thingId) current.thingIds.add(thingId);
      // 在场租约内（75s）不打扰
      if (clock() - lastUserSpokeAt < PANEL_OPEN_MS) return { banner: false, lease: true };
      await setBanner();
      return { banner: true };
    },
    /** turn_start 事件：更新活跃会话 + 刷新在场租约 */
    async onTurnStart(sessionPath) {
      if (!sessionPath) return;
      activeSessionPath = sessionPath;
      lastUserSpokeAt = clock();
    },
    /** 回执：kind ∈ dismissed|button 且 bannerId 匹配 → 这批翻篇并摘掉 */
    async onBannerEvent(event, sessionPath) {
      const payload = event?.payload ?? event?.data ?? event ?? {};
      if (payload?.bannerId !== BANNER_ID) return;
      if (payload?.kind !== "dismissed" && payload?.kind !== "button") return;
      current = null;
      await dismissBanner();
      engine?.clearArrivals?.();
    },
    /** 面板打开（有会话在活动）→ 刷新租约；用于 POST /api/panel/open */
    notePanelOpen(sessionPath) {
      if (sessionPath) activeSessionPath = sessionPath;
      lastUserSpokeAt = clock();
    },
    activeSessionPath: () => activeSessionPath,
    currentBatch: () => current,
  };
}
