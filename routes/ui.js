// REST API（§4.13）：唯一真相源 routes/ui.js，自动扫描加载。
// export default function registerRoutes(app, ctx)；不同时调用 ctx.routes.register。
// 返回统一 { ok:true, … } 或 { ok:false, code, message }。
// 注意：app 是宿主创建的 Hono 子 app（带 .get/.post/.patch/.delete），不是 ctx。
// 宿主契约（HanaAgent 1.2.1-beta APPS.md「应用自带后端路由」）：
// handler 只收一个 Hono context c，响应走 c.json()；路径参数 c.req.param()、
// 查询参数 c.req.query()、请求体 await c.req.json()。

import { wire } from "../lib/wire.js";
import { localISO, isSameLocalDay } from "../lib/util.js";

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

function statusLabel(s) {
  return { active: "进行中", waiting: "等待", done: "完成", dropped: "放下" }[s] ?? s;
}
function followUpLabel(t, nowMs) {
  const fu = t.followUp ?? "auto";
  if (fu === "remind" && t.followUpAt) {
    const d = new Date(t.followUpAt);
    return `提醒 ${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  if (fu === "remind") return "提醒（待定时）";
  if (fu === "off") return "不跟进";
  if (t.followUpAt) {
    const ms = Date.parse(t.followUpAt);
    const inMs = ms - nowMs;
    if (inMs > 0 && inMs < DAY_MS) {
      const h = Math.floor(inMs / 3600_000);
      return h < 1 ? "约 1 小时内问问" : `约 ${h} 小时后问问`;
    }
    if (inMs > 0) {
      const d = Math.round(inMs / DAY_MS);
      return `约 ${d} 天后问问`;
    }
    return "该问了";
  }
  return "合适时问问";
}

export default function registerRoutes(app, ctx) {
  // app 可能是宿主 surface app；ctx 可能未传（测试）。允许只传 ctx。
  const deps = ctx && ctx.dataDir ? wire(ctx) : null;
  const d = deps;
  const repo = d?.repo, threads = d?.threads, settings = d?.settings, agents = d?.agents;
  const chat = d?.chat, engine = d?.engine, handoff = d?.handoff, banner = d?.banner;
  const mainfeed = d?.mainfeed, extractor = d?.extractor, caps = d?.caps, persona = d?.persona;

  if (!app || typeof app.get !== "function") return; // 无宿主路由时静默（单测里手调 handler）

  // ── overview ─────────────────────────────────────────────────────────────
  app.get("/api/overview", h(async () => {
    const ov = agents ? await agents.overview() : [];
    const s = settings.get();
    const recentThings = repo ? await repo.listThings({}) : [];
    const nowMs = Date.now();
    const upcoming = recentThings
      .filter((t) => t.status !== "done" && t.status !== "dropped")
      .map((t) => ({ ...t, when: followUpLabel(t, nowMs) }))
      .slice(0, 6);
    const recentNotes = repo ? await repo.listNotes({}) : [];
    return {
      agents: ov,
      settings: s,
      caps: caps?.snapshot?.() ?? {},
      onboarded: !!s.onboarded,
      budget: engine?.budget?.() ?? null,
      justNow: {
        things: recentThings.filter((t) => nowMs - Date.parse(t.createdAt ?? 0) < DAY_MS).slice(0, 5),
        notes: recentNotes.filter((n) => nowMs - Date.parse(n.createdAt ?? 0) < DAY_MS).slice(0, 5),
      },
      upcoming,
    };
  }));

  // ── agents ───────────────────────────────────────────────────────────────
  app.get("/api/agents/:id/avatar", h(async () => bad("unsupported", "头像暂不可用")));
  app.post("/api/agents/:id/refresh", h(async (req) => {
    await agents?.refresh?.();
    await persona?.invalidate?.(req.params.id);
    return { refreshed: true };
  }));

  // ── threads ──────────────────────────────────────────────────────────────
  app.get("/api/threads/:agentId", h(async (req) => {
    const { after = 0, before, limit = 100 } = req.query ?? {};
    let list = await threads.list(req.params.agentId, { after: +after || 0, limit: +limit || 100 });
    if (before != null) {
      const earlier = await threads.loadEarlier(req.params.agentId, { beforeSeq: +before, limit: 50 });
      list = { ...list, earlier };
    }
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
  app.get("/api/things", h(async (req) => {
    const { area, status, q } = req.query ?? {};
    const list = await repo.listThings({ area, status, q });
    return { things: list };
  }));
  app.post("/api/things", h(async (req) => {
    const t = await repo.createThing(req.body ?? {});
    return { thing: t };
  }));
  app.get("/api/things/:id", h(async (req) => {
    const t = await repo.getThing(req.params.id);
    if (!t) return bad("not_found", "没找到这件事");
    return { thing: t };
  }));
  app.patch("/api/things/:id", h(async (req) => {
    const t = await repo.updateThing(req.params.id, req.body ?? {});
    if (!t) return bad("not_found", "没找到这件事");
    return { thing: t };
  }));
  app.delete("/api/things/:id", h(async (req) => {
    await repo.deleteThing(req.params.id);
    return { deleted: true };
  }));
  app.post("/api/things/:id/ask-now", h(async (req) => {
    const out = await engine.askNow(req.params.id);
    if (!out.ok) return bad(out.code ?? "failed", out.message ?? "现在问问失败");
    return out;
  }));
  app.post("/api/things/:id/snooze", h(async (req) => {
    const { hours = 72 } = req.body ?? {};
    const out = await engine.snoozeThing(req.params.id, +hours);
    if (!out.ok) return bad(out.code ?? "failed", "snooze 失败");
    return out;
  }));

  // ── notes ────────────────────────────────────────────────────────────────
  app.get("/api/notes", h(async (req) => {
    const { kind, q } = req.query ?? {};
    const list = await repo.listNotes({ kind, q });
    return { notes: list };
  }));
  app.post("/api/notes", h(async (req) => {
    const n = await repo.createNote(req.body ?? {});
    return { note: n };
  }));
  app.get("/api/notes/:id", h(async (req) => {
    const n = await repo.getNote(req.params.id);
    if (!n) return bad("not_found", "没找到这条知");
    return { note: n };
  }));
  app.patch("/api/notes/:id", h(async (req) => {
    const n = await repo.updateNote(req.params.id, req.body ?? {});
    if (!n) return bad("not_found", "没找到这条知");
    return { note: n };
  }));
  app.delete("/api/notes/:id", h(async (req) => {
    await repo.deleteNote(req.params.id);
    return { deleted: true };
  }));

  // ── search / recent / upcoming ───────────────────────────────────────────
  app.get("/api/search", h(async (req) => {
    const q = String(req.query?.q ?? "").trim();
    if (!q) return bad("bad_query", "给个关键词");
    const things = await repo.listThings({});
    const notes = await repo.listNotes({});
    const hits = d.recallSearch({ things, notes, query: q, limit: 12, nowMs: Date.now() });
    return { results: hits };
  }));
  app.get("/api/recent", h(async () => {
    const nowMs = Date.now();
    const things = (await repo.listThings({})).filter((t) => nowMs - Date.parse(t.createdAt ?? 0) < DAY_MS);
    const notes = (await repo.listNotes({})).filter((n) => nowMs - Date.parse(n.createdAt ?? 0) < DAY_MS);
    return {
      things: things.map((t) => ({ ...t, sourceText: t.logs?.[t.logs.length - 1] ?? "" })),
      notes: notes.map((n) => ({ ...n, sourceText: n.content?.slice(0, 80) ?? "" })),
    };
  }));
  app.get("/api/upcoming", h(async () => {
    const nowMs = Date.now();
    const things = (await repo.listThings({})).filter((t) => t.status !== "done" && t.status !== "dropped");
    const upcoming = things
      .map((t) => ({ ...t, when: followUpLabel(t, nowMs), exact: (t.followUp === "remind" && t.followUpAt) ? t.followUpAt : null }))
      .sort((a, b) => (Date.parse(a.followUpAt ?? a.dueAt ?? 0) - Date.parse(b.followUpAt ?? b.dueAt ?? 0)));
    return { upcoming };
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
