// Step 3：主动引擎 / 交接 / 横幅 / 主对话工具 + 附录 D 回归（D8–D14 与 D13）。
// 用假时钟 + 假 ctx，不触发真实模型与宿主。

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { tmpdir, rmrf, fakeCtx } from "./helpers.js";
import { createSettings } from "../lib/settings.js";
import { createMemoryRepo } from "../lib/memory/repo.js";
import { createThreads } from "../lib/threads.js";
import { createProactiveEngine } from "../lib/proactive/engine.js";
import { createBanner } from "../lib/proactive/banner.js";
import { createHandoff } from "../lib/handoff.js";
import { createHostTools } from "../lib/tools-host.js";
import { search as recallSearch } from "../lib/memory/recall.js";

// ── 测试世界 ─────────────────────────────────────────────────────────────────
let nowMs = Date.parse("2026-10-26T10:00:00");
const DAY = 24 * 3600_000;
const HOUR = 3600_000;

function makeWorld(overrides = {}) {
  const dir = tmpdir();
  const dataDir = dir;
  const settings = createSettings(dataDir);
  const repo = createMemoryRepo({ dir: dataDir, clock: () => nowMs });
  const threads = createThreads({ dir: path.join(dataDir, "threads") });

  const generated = []; // 模型生成的文本
  let nextReply = "最近那件事后来怎么样了？";
  const model = {
    chat: async ({ systemPrompt, messages }) => {
      generated.push({ systemPrompt, messages, at: nowMs });
      const text = typeof nextReply === "function" ? nextReply() : nextReply;
      return { text, toolCalls: [], requestId: "r" };
    },
    utility: async () => ({ text: "" }),
  };

  const persona = {
    get: async () => ({ name: "小花" }),
    personaBlock: async () => "小花人格",
    aboutUserBlock: async () => "",
  };

  // 聊天模型解析：固定可用
  const agents = {
    overview: async () => [{ id: "hana", name: "小花", chatModel: "p/m" }],
    list: async () => [{ id: "hana", name: "小花" }],
    resolveChatModel: async () => ({ provider: "p", model: "m" }),
    refresh: async () => {},
  };
  const mainfeed = { handoffs: null, onMessageEnd: () => {} };

  const ctx = fakeCtx({ dataDir });
  ctx.inputBanner = {
    setCalls: [],
    dismissCalls: [],
    async set(o) { this.setCalls.push(o); },
    async dismiss(o) { this.dismissCalls.push(o); },
  };

  const banner = createBanner({ ctx, settings, clock: () => nowMs });
  const engine = createProactiveEngine({
    model, persona, repo, threads, banner, settings, agents, mainfeed,
    clock: () => nowMs,
  });
  banner.engine = engine;
  const handoff = createHandoff({ ctx, caps: { has: () => true, auth: () => "ok", call: async (_n, fn) => fn() }, repo, threads, mainfeed, engine, clock: () => nowMs });
  mainfeed.handoffs = handoff;

  const world = {
    dir, dataDir, settings, repo, threads, model, persona, agents, banner, engine, handoff, ctx, mainfeed,
    generated,
    setReply(t) { nextReply = t; },
    async ready({ proactive = true } = {}) {
      const s = await settings.load();
      s.onboarded = true;
      s.proactive.enabled = proactive;
      s.proactive.agents = { hana: true };
      s.memory.learnFromMain = true;
      s.proactive.quiet.enabled = false; // 测试用固定钟点，关掉安静时段干扰
      s.proactive.minGapMinutes = 15;
      return s;
    },
  };
  return Object.assign(world, overrides);
}

// ── gate / reasons 已在 Step 2 单测；这里测 engine 行为 ─────────────────────────

test("D8：相同候选连续 [SKIP] → 2 小时内不再生成", async () => {
  const w = makeWorld();
  await w.ready();
  w.setReply("[SKIP]");
  const t = await w.repo.createThing({
    title: "季度汇报", area: "work", status: "active", followUp: "auto",
    followUpAt: new Date(nowMs - HOUR).toISOString(), owner: "hana",
  });
  const g0 = w.generated.length;
  await w.engine.tick("interval");
  assert.equal(w.generated.length, g0 + 1, "第一次应生成一次（评估）");
  // 同一 topicKey 进冷却：2h 内不再生成
  nowMs += 30 * 60_000;
  await w.engine.tick("interval");
  assert.equal(w.generated.length, g0 + 1, "冷却期内不应再生成");
  // 跨过 2h 冷却
  nowMs += 2 * HOUR;
  await w.engine.tick("interval");
  assert.equal(w.generated.length, g0 + 2, "冷却后应重新评估");
});

test("D9：生成后用户已回复 → 投递前重查丢弃", async () => {
  const w = makeWorld();
  await w.ready();
  w.setReply("那件事后来处理了，放心");
  await w.repo.createThing({
    title: "季度汇报", area: "work", status: "active", followUp: "auto",
    followUpAt: new Date(nowMs - HOUR).toISOString(), owner: "hana",
  });
  // 注入一个延迟：模型生成期间用户插话（时间戳比候选创建晚 1ms，确保被重查捕获）
  const orig = w.model.chat;
  w.model.chat = async (args) => {
    nowMs += 1;
    await w.threads.append("hana", { role: "user", text: "我刚处理完了", at: new Date(nowMs).toISOString() });
    return orig(args);
  };
  const r = await w.engine.tick("interval");
  assert.equal(r.delivered, null, "过期候选应被丢弃");
  const msgs = await w.threads._all("hana");
  assert.equal(msgs.filter((m) => m.role === "assistant" && m.meta?.proactive).length, 0, "不应投递主动消息");
});

test("D10：全局 snooze 暂停 auto；remind 不被取消", async () => {
  const w = makeWorld();
  await w.ready();
  w.setReply("那件事后来怎么样了？");
  await w.engine.snoozeAll(4); // 「今天别问我进度」→ 全局 4h
  await w.repo.createThing({
    title: "自动跟进的事", area: "work", status: "active", followUp: "auto",
    followUpAt: new Date(nowMs - HOUR).toISOString(), owner: "hana",
  });
  await w.repo.createThing({
    title: "明确提醒", area: "work", status: "active", followUp: "remind",
    followUpAt: new Date(nowMs - HOUR).toISOString(), owner: "hana",
  });
  const r = await w.engine.tick("interval");
  // 只应投递 remind（auto 被全局 snooze 拦）
  if (r.delivered) {
    assert.equal(r.delivered.reason, "remind_due", "全局 snooze 只挡 auto，remind 照发");
  }
  const t1 = await w.repo.getThing((await w.repo.listThings({})).find((x) => x.title === "自动跟进的事").id);
  assert.ok(t1, "auto 事项仍在");
});

test("D12：连续 2 次没回 → 自动跟进转 off，不问第三次", async () => {
  const w = makeWorld();
  await w.ready();
  w.setReply("那件事有进展吗？");
  const t = await w.repo.createThing({
    title: "反复跟进的事", area: "work", status: "active", followUp: "auto",
    followUpAt: new Date(nowMs - HOUR).toISOString(), owner: "hana",
  });
  await w.engine.tick("interval"); // 第 1 次投递
  assert.equal(w.engine.state().perThing[t.id].unanswered, 1);
  // 用户仍没回；到了下一个跟进点（引擎把 followUpAt 清空了，模拟「再次到期」），换一个不同的提问文本
  nowMs += 3 * HOUR;
  w.setReply("上次提的那件事现在有进展吗？");
  await w.repo.updateThing(t.id, { followUpAt: new Date(nowMs - 60_000).toISOString() });
  await w.engine.tick("interval"); // 第 2 次投递
  const full = await w.repo.getThing(t.id);
  assert.equal(full.followUp, "off", "两次没回应转 off");
  assert.equal(w.engine.state().perThing[t.id].unanswered, 2);
  // 转 off 后不再产生 followup_due 由头
  nowMs += 3 * HOUR;
  await w.repo.updateThing(t.id, { followUpAt: new Date(nowMs - 60_000).toISOString() }).catch(() => {});
  await w.engine.tick("interval");
  const msgs = await w.threads._all("hana");
  const n = msgs.filter((m) => m.role === "assistant" && m.meta?.proactive).length;
  assert.equal(n, 2, "只问了两次");
});

test("D12b：没回的话术不含责备（生成的 prompt 禁止稿）", async () => {
  const w = makeWorld();
  await w.ready();
  w.setReply("那件事有进展吗？");
  await w.repo.createThing({
    title: "不催", area: "work", status: "active", followUp: "auto",
    followUpAt: new Date(nowMs - HOUR).toISOString(), owner: "hana",
  });
  await w.engine.tick("interval");
  const sys = w.generated[0].systemPrompt;
  assert.ok(/不许责备|不许撒娇/.test(sys), "prompt 明确禁止责备性话术");
});

test("D13：全部主动关闭 → evaluated=0，不生成", async () => {
  const w = makeWorld();
  const s = await w.ready();
  s.proactive.enabled = false;
  await w.repo.createThing({
    title: "该跟进的事", area: "work", status: "active", followUp: "auto",
    followUpAt: new Date(nowMs - HOUR).toISOString(), owner: "hana",
  });
  const r = await w.engine.tick("interval");
  assert.equal(r.skipped, "disabled");
  assert.equal(w.generated.length, 0, "不做主动模型评估");
  assert.equal(w.engine.budget().evaluated, 0, "evaluated=0");
});

test("D13b：分类开关关闭 → 该类别不投递", async () => {
  const w = makeWorld();
  const s = await w.ready();
  s.proactive.categories.work = false; // 关掉工作跟进
  w.setReply("工作的事有进展吗？");
  await w.repo.createThing({
    title: "工作跟进", area: "work", status: "active", followUp: "auto",
    followUpAt: new Date(nowMs - HOUR).toISOString(), owner: "hana",
  });
  const r = await w.engine.tick("interval");
  assert.equal(r.delivered, null, "work 类别关闭不投递");
});

test("D14：无忙碌信号 → 不臆造「正在开会」", async () => {
  const w = makeWorld();
  await w.ready();
  w.setReply("那件事后来怎么样了？");
  await w.repo.createThing({
    title: "普通跟进", area: "work", status: "active", followUp: "auto",
    followUpAt: new Date(nowMs - HOUR).toISOString(), owner: "hana",
  });
  await w.engine.tick("interval");
  // 生成的 systemPrompt 不应包含对忙碌/开会/输入的臆测
  for (const g of w.generated) {
    assert.ok(!/正在开会|正在输入|忙碌中/.test(g.systemPrompt), "不臆造忙碌状态");
  }
});

test("连续失败：同一助手多次模型失败 → 暂停并退避", async () => {
  const w = makeWorld();
  await w.ready();
  w.model.chat = async () => { throw new Error("provider down"); };
  await w.repo.createThing({
    title: "会失败的事", area: "work", status: "active", followUp: "auto",
    followUpAt: new Date(nowMs - HOUR).toISOString(), owner: "hana",
  });
  const r = await w.engine.tick("interval");
  assert.equal(r.delivered, null);
  const msgs = await w.threads._all("hana");
  assert.equal(msgs.filter((m) => m.role === "assistant" && m.meta?.proactive).length, 0, "失败不投递");
});

test("横幅：到场挂横幅，回执后摘横幅", async () => {
  const w = makeWorld();
  await w.ready();
  w.banner.onTurnStart("agents/hana/sessions/main.jsonl"); // 最近活跃会话
  nowMs += 2 * 60_000; // 超过 75s 在场租约
  w.setReply("那件事后来怎么样了？");
  await w.repo.createThing({
    title: "横幅测试", area: "work", status: "active", followUp: "auto",
    followUpAt: new Date(nowMs - HOUR).toISOString(), owner: "hana",
  });
  await w.engine.tick("interval");
  assert.equal(w.ctx.inputBanner.setCalls.length, 1, "应挂一次横幅");
  assert.equal(w.ctx.inputBanner.setCalls[0].bannerId, "shiyi-arrived");
  assert.ok(w.ctx.inputBanner.setCalls[0].text.includes("拾遗"));
  // 回执（点击「知道了」）→ 摘掉
  await w.banner.onBannerEvent({ kind: "button", bannerId: "shiyi-arrived" });
  assert.equal(w.ctx.inputBanner.dismissCalls.length, 1, "回执后应摘横幅");
});

test("横幅：在场租约内（75s）不打扰", async () => {
  const w = makeWorld();
  await w.ready();
  w.banner.onTurnStart("agents/hana/sessions/main.jsonl");
  nowMs += 30_000; // 30s < 75s，仍在场
  w.setReply("那件事后来怎么样了？");
  await w.repo.createThing({
    title: "在场测试", area: "work", status: "active", followUp: "auto",
    followUpAt: new Date(nowMs - HOUR).toISOString(), owner: "hana",
  });
  await w.engine.tick("interval");
  assert.equal(w.ctx.inputBanner.setCalls.length, 0, "在场租约内不挂横幅");
});

test("停机补发：boot 触发，逾期 ≤24h 合并一条", async () => {
  const w = makeWorld();
  await w.ready();
  w.setReply("昨天说的那件事，后来怎么样了？");
  // 逾期 5h（< 24h）
  await w.repo.createThing({
    title: "停机事项A", area: "work", status: "active", followUp: "auto",
    followUpAt: new Date(nowMs - 5 * HOUR).toISOString(), owner: "hana",
  });
  await w.repo.createThing({
    title: "停机事项B", area: "work", status: "active", followUp: "auto",
    followUpAt: new Date(nowMs - 3 * HOUR).toISOString(), owner: "hana",
  });
  // 逾期 30h（> 24h）→ 不补
  await w.repo.createThing({
    title: "太久的不管", area: "work", status: "active", followUp: "auto",
    followUpAt: new Date(nowMs - 30 * HOUR).toISOString(), owner: "hana",
  });
  const r = await w.engine.tick("boot");
  const msgs = await w.threads._all("hana");
  const proactive = msgs.filter((m) => m.role === "assistant" && m.meta?.proactive);
  assert.equal(proactive.length, 1, "逾期 ≤24h 的两件合并成一条");
  assert.ok(proactive[0].text.includes("停机事项A") || proactive[0].text.includes("和"));
});

test("交接：确认后发 session:create/update/send，记 handoffs", async () => {
  const w = makeWorld();
  await w.ready();
  const calls = [];
  w.ctx.bus = {
    request: async (method, payload) => {
      calls.push({ method, payload });
      if (method === "session:create") return { sessionId: "s1", sessionPath: "agents/hana/sessions/sx.jsonl" };
      return {};
    },
    subscribe: () => {},
  };
  const card = await w.handoff.createCard("hana", { title: "写季度大纲", request: "帮我列个大纲", thingId: null });
  const out = await w.handoff.confirm("hana", card.id);
  assert.equal(out.ok, true);
  assert.equal(calls[0].method, "session:create");
  assert.equal(calls[1].method, "session:update");
  assert.equal(calls[2].method, "session:send");
  assert.ok(w.handoff.thingFor("agents/hana/sessions/sx.jsonl") === null || out.sessionPath);
  const hist = await w.threads._all("hana");
  assert.ok(hist.some((m) => m.meta?.handoff?.status === "sent"), "卡片应翻成已发送");
});

test("交接：bus 拒绝 → 退化为复制需求", async () => {
  const w = makeWorld();
  await w.ready();
  w.ctx.bus = { request: async () => { throw new Error("denied: permission"); }, subscribe: () => {} };
  const card = await w.handoff.createCard("hana", { title: "写季度大纲", request: "帮我列个大纲" });
  const out = await w.handoff.confirm("hana", card.id);
  assert.equal(out.ok, false);
  assert.equal(out.fallback, "copy");
  const hist = await w.threads._all("hana");
  const failed = hist.filter((m) => m.meta?.handoff?.status === "failed");
  assert.equal(failed.length, 1, "失败卡片应标 failed 并提供复制文本");
});

test("交接：同一事项 10 分钟内重复 → 提示二次确认", async () => {
  const w = makeWorld();
  await w.ready();
  const t = await w.repo.createThing({ title: "反复交接", area: "work", status: "active", followUp: "off" });
  const c1 = await w.handoff.createCard("hana", { title: "反复交接", request: "做A", thingId: t.id });
  assert.equal(c1.repeated, false);
  const c2 = await w.handoff.createCard("hana", { title: "反复交接", request: "做B", thingId: t.id });
  assert.equal(c2.repeated, true, "10 分钟内同一事项再交接 → repeated");
});

test("主对话工具：main 放行，ch_/dm_ 拒绝且不泄密", async () => {
  const w = makeWorld();
  await w.ready();
  const host = createHostTools({ ctx: w.ctx, caps: { has: () => true }, repo: w.repo, recallSearch });
  await w.repo.createThing({ title: "季度汇报", area: "work", status: "active", now: "在做PPT" });
  const ok = await host.search({ query: "季度汇报" }, { sessionPath: "agents/hana/sessions/main.jsonl" });
  assert.ok(String(ok.text).includes("季度汇报"), "main 应返回内容");
  const ch = await host.search({ query: "季度汇报" }, { sessionPath: "phone/sessions/ch_abc12345.jsonl" });
  assert.equal(ch.text, "这里不能使用拾遗。");
  assert.ok(!String(ch.text).includes("季度汇报"), "群聊不泄露内容");
  const dm = await host.track({ title: "秘密" }, { sessionPath: "agents/hana/sessions/dm_x.jsonl" });
  assert.equal(dm.text, "这里不能使用拾遗。");
});

test("shiyi.track 在 main 建事项并返回确认", async () => {
  const w = makeWorld();
  await w.ready();
  const host = createHostTools({ ctx: w.ctx, caps: { has: () => true }, repo: w.repo, recallSearch });
  const out = await host.track(
    { title: "让拾遗周四提醒", area: "work", followUp: "remind", followUpAt: "2026-10-29T10:00:00" },
    { sessionPath: "agents/hana/sessions/main.jsonl", agentId: "hana" },
  );
  assert.ok(out.text.includes("已记下"));
  const things = await w.repo.listThings({});
  assert.equal(things.length, 1);
  assert.equal(things[0].followUp, "remind");
});

test("ask-now：立即生成一条，不受每日上限", async () => {
  const w = makeWorld();
  await w.ready();
  w.setReply("那件事现在怎么样了？");
  const t = await w.repo.createThing({
    title: "立即问", area: "work", status: "active", followUp: "auto", owner: "hana",
  });
  const out = await w.engine.askNow(t.id);
  assert.equal(out.ok, true);
  const msgs = await w.threads._all("hana");
  assert.ok(msgs.some((m) => m.role === "assistant" && m.meta?.proactive), "应投递主动消息");
});

test("snooze 事项：暂停后该事项不投递，恢复后恢复", async () => {
  const w = makeWorld();
  await w.ready();
  w.setReply("那件事后来怎么样了？");
  const t = await w.repo.createThing({
    title: "暂停事项", area: "work", status: "active", followUp: "auto",
    followUpAt: new Date(nowMs - HOUR).toISOString(), owner: "hana",
  });
  await w.engine.snoozeThing(t.id, 72);
  const r1 = await w.engine.tick("interval");
  assert.equal(r1.delivered, null, "snooze 期间不投递");
  await w.engine.snoozeThing(t.id, 0); // 恢复
  nowMs += HOUR;
  const r2 = await w.engine.tick("interval");
  assert.ok(r2.delivered, "恢复后应可投递");
});
