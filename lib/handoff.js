// 交给 Hana（§4.9）：先在线程里插一张待确认卡；用户点「发送」才走 session:create → update → send。
// 结果经主对话回流：mainfeed 提取出更新后产生 handoff_result 由头。

import { randToken, localISO } from "./util.js";

const REPEAT_WINDOW_MS = 10 * 60_000; // 同一事项 10 分钟内重复交接 → 二次确认

export function createHandoff({ ctx, caps, repo, threads, mainfeed, engine, clock = () => Date.now() }) {
  /** sessionPath -> { thingId, agentId, title, at }（只放已发送的交接） */
  const handoffs = new Map();
  /** 卡 id -> { thingId, title, at }（含未发送的，用于 10 分钟重复判定） */
  const cards = new Map();

  function lastCardOf({ thingId, title }) {
    let best = null;
    for (const v of cards.values()) {
      const match = (thingId && v.thingId === thingId) || (!thingId && v.title === title);
      if (match && (!best || v.at > best.at)) best = v;
    }
    return best;
  }

  /** 在线程里插入待确认交接卡（工具或界面按钮都走这里） */
  async function createCard(agentId, { title, request, thingId }) {
    const id = `h_${randToken(8)}`;
    const recent = lastCardOf({ thingId, title });
    const repeated = !!recent && clock() - recent.at < REPEAT_WINDOW_MS;
    await threads.append(agentId, {
      role: "handoff",
      text: `（提议交给 Hana：${title}，状态：待确认）`,
      meta: { handoff: { id, title, request, thingId: thingId ?? null, status: "pending", repeated } },
    });
    // 记一张卡（10 分钟内再交同一事项 → 提示二次确认）
    cards.set(id, { thingId: thingId ?? null, agentId, title, at: clock() });
    return { id, repeated };
  }

  async function thingFor(sessionPath) { return handoffs.get(sessionPath)?.thingId ?? null; }
  async function infoFor(sessionPath) { return handoffs.get(sessionPath) ?? null; }
  function all() { return [...handoffs.entries()].map(([sessionPath, v]) => ({ sessionPath, ...v })); }

  /** 用户点「发送」：session:create → update → send；失败退化为复制需求 */
  async function confirm(agentId, id, { request } = {}) {
    const hist = await threads._all(agentId);
    const cardMsg = [...hist].reverse().find((m) => m.meta?.handoff?.id === id);
    if (!cardMsg) return { ok: false, code: "not_found" };
    const card = cardMsg.meta.handoff;
    const finalRequest = request ?? card.request;
    const title = card.title;

    // 先翻成 sending，避免重复点击
    card.status = "sending";
    await threads.append(agentId, {
      role: "system", text: `（正在交给 Hana：${title}…）`,
      meta: { handoff: { ...card, status: "sending" } },
    });

    try {
      if (!caps.has("bus.request")) throw Object.assign(new Error("bus.request unsupported"), { code: "unsupported" });
      const created = await caps.call("bus.request", () =>
        ctx.bus.request("session:create", { agentId: cardMsg.agentId ?? agentId }));
      const sessionId = created?.sessionId ?? created?.id ?? null;
      const sessionPath = created?.sessionPath ?? created?.path ?? null;
      if (!sessionId || !sessionPath) throw new Error("session:create 未返回 sessionId/sessionPath");

      try {
        await caps.call("bus.request", () =>
          ctx.bus.request("session:update", { sessionId, sessionPath, title: "拾遗 · " + title }));
      } catch { /* 改名失败忽略（PLAN §4.9） */ }

      await caps.call("bus.request", () =>
        ctx.bus.request("session:send", { sessionId, sessionPath, text: finalRequest }));

      card.status = "sent";
      card.sessionPath = sessionPath;
      await threads.append(agentId, {
        role: "system", text: `（提议交给 Hana：${title}，状态：已发送）`,
        meta: { handoff: { ...card, status: "sent", sessionPath } },
      });
      handoffs.set(sessionPath, {
        thingId: card.thingId ?? null, agentId, title, at: clock(), sessionId,
      });
      if (card.thingId) {
        await repo.updateThing(card.thingId, { log: "· 已交给 Hana 主对话" });
      }
      return { ok: true, sessionPath, sessionId };
    } catch (err) {
      const auth = caps.auth("bus.request");
      card.status = "failed";
      await threads.append(agentId, {
        role: "system",
        text: auth === "denied"
          ? `（交给 Hana 需要「开启对话」权限，已改为复制需求：${finalRequest}）`
          : `（交给 Hana 失败，已改为复制需求：${finalRequest}）`,
        meta: { handoff: { ...card, status: "failed", error: String(err?.message ?? err).slice(0, 120) } },
      });
      return { ok: false, code: auth === "denied" ? "denied" : "failed", fallback: "copy", request: finalRequest };
    }
  }

  /** 用户点「取消」 */
  async function cancel(agentId, id) {
    const hist = await threads._all(agentId);
    const cardMsg = [...hist].reverse().find((m) => m.meta?.handoff?.id === id);
    if (!cardMsg) return { ok: false, code: "not_found" };
    cardMsg.meta.handoff.status = "cancelled";
    await threads.append(agentId, {
      role: "system", text: `（提议交给 Hana：${cardMsg.meta.handoff.title}，状态：已取消）`,
      meta: { handoff: { ...cardMsg.meta.handoff, status: "cancelled" } },
    });
    return { ok: true };
  }

  /** mainfeed 从交接会话提取出更新后调用 → 产生 handoff_result 由头 */
  async function noteResult(sessionPath, { summary }) {
    const info = handoffs.get(sessionPath);
    if (!info) return { ok: false };
    await engine?.noteHandoffResult?.(sessionPath, {
      thingId: info.thingId, agentId: info.agentId, title: info.title,
      summary: String(summary ?? "").slice(0, 80), area: "work",
    });
    if (info.thingId) {
      await repo.updateThing(info.thingId, { log: "· Hana 那边有结果了" });
    }
    return { ok: true };
  }

  return { createCard, confirm, cancel, thingFor, infoFor, all, noteResult, _map: handoffs };
}
