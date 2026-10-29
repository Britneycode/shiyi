// REST API（§4.13）：唯一真相源 routes/ui.js，自动扫描加载。
// export default function registerRoutes(app, ctx)；不同时调用 ctx.routes.register。
// 返回统一 { ok:true, … } 或 { ok:false, code, message }。
// 注意：app 是宿主创建的 Hono 子 app（带 .get/.post/.patch/.delete），不是 ctx。
// 宿主契约（HanaAgent 1.2.1-beta APPS.md「应用自带后端路由」）：
// handler 只收一个 Hono context c，响应走 c.json()；路径参数 c.req.param()、
// 查询参数 c.req.query()、请求体 await c.req.json()。

import { wire } from "../lib/wire.js";

const DAY_MS = 24 * 3600_000;

function bad(code, message) { return { ok: false, code, message }; }

/** 读请求体：GET/HEAD 无体；解析失败（空体 / 非 JSON）当空对象，不让端点崩。 */
async function readBody(c) {
  const method = String(c?.req?.method ?? "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") return {};
  try { return (await c.req.json()) ?? {}; } catch { return {}; }
}

/** 统一包装：把 Hono context 归一成 {params,query,body}，捕获异常，返回 ok:false。 */
function h(fn) {
  return async (c) => {
    try {
      const req = { params: c.req.param(), query: c.req.query(), body: await readBody(c) };
      const out = await fn(req);
      return c.json({ ok: true, ...out });
    } catch (err) {
      return c.json(bad("error", String(err?.message ?? err).slice(0, 200)));
    }
  };
}

export default function registerRoutes(app, ctx) {
  // app 可能是宿主 surface app；ctx 可能未传（测试）。允许只传 ctx。
  const deps = ctx && ctx.dataDir ? wire(ctx) : null;
  const d = deps;
  const repo = d?.repo, threads = d?.threads, settings = d?.settings, agents = d?.agents;
  const chat = d?.chat, engine = d?.engine, handoff = d?.handoff, banner = d?.banner;
  const mainfeed = d?.mainfeed, extractor = d?.extractor, caps = d?.caps, persona = d?.persona;
  const agentState = d?.agentState;

  if (!app || typeof app.get !== "function") return; // 无宿主路由时静默（单测里手调 handler）

  // ── overview ─────────────────────────────────────────────────────────────
  app.get("/api/overview", h(async () => {
    const ovAll = agents ? await agents.overview() : [];
    const s = settings.get();
    // 软删：拆可见 / 已收起。隐藏项不进 stats 循环（省 IO），以 hiddenAgents 轻量返回供设置管理。
    const hiddenSet = new Set(s.hiddenAgentIds ?? []);
    const ov = ovAll.filter((a) => !hiddenSet.has(a.id));
    const hiddenAgents = ovAll.filter((a) => hiddenSet.has(a.id)).map((a) => ({ id: a.id, name: a.name, yuan: a.yuan }));
    const recentThings = repo ? await repo.listThings({}) : [];
    // 关系统计：每助手"认识 N 天 · 聊 M 条 · 记 K 条"。note 无 agent 归属，只数 thing。
    if (threads?._stats) {
      for (const a of ov) {
        const st = await threads._stats(a.id);
        const knownDays = st.firstAt ? Math.max(0, Math.floor((Date.now() - Date.parse(st.firstAt)) / DAY_MS)) : 0;
        const memoryCount = recentThings.filter((r) => (r.agents || []).includes(a.id) || r.owner === a.id).length;
        a.stats = { knownDays, msgCount: st.msgCount, memoryCount };
        a.life = agentState?.read(a.id) ?? null; // 幕间状态：{ mood, dwelling }
      }
    }
    return {
      agents: ov,
      hiddenAgents,
      settings: s,
      caps: caps?.snapshot?.() ?? {},
      onboarded: !!s.onboarded,
      budget: engine?.budget?.() ?? null,
      snoozedUntil: (await engine?.snoozedUntil?.()) ?? 0,
    };
  }));

  // ── agents ───────────────────────────────────────────────────────────────
  app.get("/api/agents/:id/avatar", h(async () => bad("unsupported", "头像暂不可用")));
  app.post("/api/agents/:id/refresh", h(async (req) => {
    await agents?.refresh?.();
    await persona?.invalidate?.(req.params.id);
    return { refreshed: true };
  }));
  // 软删（收起）：写 settings.hiddenAgentIds，不动宿主 profile、不动记忆数据
  app.post("/api/agents/:id/hide", h(async (req) => {
    const cur = settings.get().hiddenAgentIds ?? [];
    const out = await settings.patch({ hiddenAgentIds: [...new Set([...cur, req.params.id])] });
    if (!out.ok) return bad(out.error ?? "bad_patch", "设置校验失败");
    return { hiddenAgentIds: out.value.hiddenAgentIds };
  }));
  app.post("/api/agents/:id/unhide", h(async (req) => {
    const cur = settings.get().hiddenAgentIds ?? [];
    const out = await settings.patch({ hiddenAgentIds: cur.filter((x) => x !== req.params.id) });
    if (!out.ok) return bad(out.error ?? "bad_patch", "设置校验失败");
    return { hiddenAgentIds: out.value.hiddenAgentIds };
  }));

  // ── threads ──────────────────────────────────────────────────────────────
  app.get("/api/threads/:agentId", h(async (req) => {
    const { after = 0, before, limit = 100 } = req.query ?? {};
    let list = await threads.list(req.params.agentId, { after: +after || 0, limit: +limit || 100 });
    if (before != null) {
      const earlier = await threads.loadEarlier(req.params.agentId, { beforeSeq: +before, limit: 50 });
      list = { ...list, earlier };
    }
    // 批 4 流式：附当前生成中的轮次（面板轮询渲染打字机）
    const cur = threads.currentTurn?.(req.params.agentId);
    if (cur) list = { ...list, generating: { turnId: cur.id, partial: cur.partial ?? "", startedAt: cur.startedAt } };
    return list;
  }));
  app.post("/api/threads/:agentId/messages", h(async (req) => {
    const { text, clientId } = req.body ?? {};
    const out = await chat.postMessage(req.params.agentId, { text, clientId });
    return out ?? { posted: true };
  }));
  app.post("/api/threads/:agentId/retry", h(async (req) => {
    // 重试 = 重跑最后一轮：把尾部 assistant 去掉后重排一次生成
    const agentId = req.params.agentId;
    const hist = await threads._all(agentId);
    const lastUser = [...hist].reverse().find((m) => m.role === "user");
    if (!lastUser) return bad("nothing_to_retry", "还没有可重试的消息");
    chat.schedule?.(agentId, null);
    return { retried: true };
  }));
  app.post("/api/threads/:agentId/cancel", h(async (req) => {
    chat.cancel(req.params.agentId);
    return { cancelled: true };
  }));
  app.post("/api/threads/:agentId/read", h(async (req) => {
    const { uptoSeq } = req.body ?? {};
    const out = await threads.markRead(req.params.agentId, +uptoSeq || 0);
    banner?.clearArrivals?.();
    return out ?? { unread: 0 };
  }));
  app.delete("/api/threads/:agentId", h(async (req) => {
    await threads.clear(req.params.agentId);
    return { cleared: true };
  }));

  // ── things ───────────────────────────────────────────────────────────────
  // 记忆只有「模型自己记」这一条写入路径，面板不再提供手动增删改查；
  // 仅保留对话内的主动联系控制（这条线索先不问了）。
  app.post("/api/things/:id/snooze", h(async (req) => {
    const { hours = 72 } = req.body ?? {};
    const out = await engine.snoozeThing(req.params.id, +hours);
    if (!out.ok) return bad(out.code ?? "failed", "snooze 失败");
    return out;
  }));

  // ── proactive ────────────────────────────────────────────────────────────
  // 全局「稍后再说」：落 proactive-state.json 的 globalSnoozeUntil，刷新不丢；
  // hours <= 0 即恢复。只停 auto，remind_due 不受影响（见 gate 第 9 道）。
  app.post("/api/proactive/snooze", h(async (req) => {
    const hours = +(req.body?.hours ?? 4);
    const out = await engine.snoozeAll(hours);
    return { until: out.until };
  }));

  // ── handoffs ─────────────────────────────────────────────────────────────
  app.post("/api/handoffs/:id/confirm", h(async (req) => {
    // 找该交接卡所在线程
    for (const agentId of await threads.agentIds()) {
      const hist = await threads._all(agentId);
      if (hist.some((m) => m.meta?.handoff?.id === req.params.id)) {
        const out = await handoff.confirm(agentId, req.params.id, req.body ?? {});
        if (out.ok) return out;
        return bad(out.code ?? "failed", out.code === "denied" ? "需要「开启对话」权限，已改为复制需求" : "交给 Hana 失败");
      }
    }
    return bad("not_found", "没找到这张交接卡");
  }));
  app.post("/api/handoffs/:id/cancel", h(async (req) => {
    for (const agentId of await threads.agentIds()) {
      const hist = await threads._all(agentId);
      if (hist.some((m) => m.meta?.handoff?.id === req.params.id)) {
        await handoff.cancel(agentId, req.params.id);
        return { cancelled: true };
      }
    }
    return bad("not_found", "没找到这张交接卡");
  }));

  // ── settings / onboarding / presence ─────────────────────────────────────
  app.get("/api/settings", h(async () => ({ settings: settings.get() })));
  app.patch("/api/settings", h(async (req) => {
    const out = await settings.patch(req.body ?? {});
    if (!out.ok) return bad(out.error ?? "bad_patch", "设置校验失败");
    return { settings: out.value };
  }));
  app.post("/api/onboarding", h(async (req) => {
    const { learnFromMain, preset } = req.body ?? {};
    const out = await settings.completeOnboarding({ learnFromMain: !!learnFromMain, preset });
    return { settings: out };
  }));
  app.post("/api/presence", h(async (req) => {
    banner?.notePanelOpen?.(req.body?.sessionPath ?? null);
    return { ok: true };
  }));

  // ── mainfeed / memory / diagnostics ──────────────────────────────────────
  app.get("/api/mainfeed", h(async () => ({ items: mainfeed?.recent?.() ?? mainfeed?.list?.() ?? [] })));
  app.delete("/api/mainfeed", h(async () => {
    await mainfeed?.clearAll?.();
    return { cleared: true };
  }));
  app.post("/api/memory/clear", h(async (req) => {
    const { includeChats } = req.body ?? {};
    await repo.clearAll({ includeChats: !!includeChats });
    return { cleared: true };
  }));
  app.post("/api/reindex", h(async () => {
    const out = await repo.reconcile({ force: true });
    return out ?? { reindexed: true };
  }));
  app.get("/api/diagnostics", h(async () => ({
    extractLog: extractor?.logs?.() ?? [],
    proactiveSkips: engine?.skipLog?.() ?? [],
    budget: engine?.budget?.() ?? null,
    caps: caps?.snapshot?.() ?? {},
  })));
}
