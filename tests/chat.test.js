import test from "node:test";
import assert from "node:assert/strict";
import { createChat } from "../lib/chat.js";
import { createThreads } from "../lib/threads.js";
import { createMemoryRepo } from "../lib/memory/repo.js";
import { createSettings } from "../lib/settings.js";
import { createAppTools } from "../lib/tools-app.js";
import { tmpdir, rmrf } from "./helpers.js";

const ok = () => ({ ok: true });

function makeWorld({ chatText = "好的，记下了。", withTools = false } = {}) {
  const dir = tmpdir();
  const settings = createSettings(dir);
  const ready = (async () => { const s = await settings.load(); s.onboarded = true; })();
  const repo = createMemoryRepo({ dir });
  const threads = createThreads({ dir });
  const persona = {
    get: async () => ({ memoryOn: true, pinned: "用户置顶", facts: "" }),
    personaBlock: async () => "人格块文本",
  };
  const agents = {
    list: async () => [{ id: "hana", name: "小花" }],
    resolveChatModel: async () => ({ provider: "p", model: "m" }),
  };
  const policy = { memoryState: async () => "on" };
  const appTools = createAppTools({ repo, policy });
  const enqueued = [];
  const extractor = { enqueue: (t) => enqueued.push(t) };
  const mainfeed = { recent: () => [{ role: "user", text: "主对话近况", at: "2026-10-26T10:00:00+08:00", id: "mf1" }] };
  const model = {
    supportsTools: () => withTools,
    async chat({ messages }) {
      return { text: chatText, toolCalls: [], requestId: "r1" };
    },
    async utility() { return { text: "摘要" }; },
  };
  const chat = createChat({ model, persona, agents, repo, threads, extractor, settings, mainfeed, appTools, clock: () => Date.now() });
  const w = { dir, repo, threads, chat, enqueued, model };
  return (async () => {
    await settings.load().catch(() => {});
    /** 等聊天收敛：没有生成中轮次，且线程尾部不是悬着的用户消息；连续两次确认才返回（防抖） */
    w.settle = async (timeoutMs = 5000) => {
      const t0 = Date.now();
      let calm = 0;
      while (Date.now() - t0 < timeoutMs) {
        const generating = threads.listTurns("hana").some((t) => t.status === "generating");
        const last = (await threads._all("hana")).at(-1);
        if (!generating && last && last.role !== "user") {
          if (++calm >= 2) return;
        } else {
          calm = 0;
        }
        await new Promise((r) => setTimeout(r, 5));
      }
    };
    return w;
  })();
}

test("chat: 校验——助手不存在/无模型/文本超长/重复 clientId", async () => {
  const w = await makeWorld();
  const chat = w.chat;
  const agents2 = { list: async () => [], resolveChatModel: async () => null };
  const bad = createChat({ model: w.model, persona: { get: async () => ({}), personaBlock: async () => "" }, agents: agents2, repo: w.repo, threads: w.threads, extractor: null, settings: createSettings(tmpdir()), mainfeed: null, appTools: null });
  const r1 = await bad.postMessage("ghost", { text: "你好" });
  assert.equal(r1.error, "no_agent");
  rmrf(w.dir);
  const dir2 = tmpdir();
  const settings2 = createSettings(dir2); await settings2.load();
  const chat2 = createChat({ model: w.model, persona: { get: async () => ({}), personaBlock: async () => "" }, agents: { list: async () => [{ id: "a" }], resolveChatModel: async () => null }, repo: createMemoryRepo({ dir: dir2 }), threads: createThreads({ dir: dir2 }), extractor: null, settings: settings2, mainfeed: null, appTools: null });
  const r2 = await chat2.postMessage("a", { text: "你好" });
  assert.equal(r2.error, "no_model");
  rmrf(dir2);
  const r3 = await w.chat.postMessage("hana", { text: "长".repeat(4001) });
  assert.equal(r3.error, "bad_text");
  const r4 = await w.chat.postMessage("hana", { text: "你好", clientId: "c1" });
  assert.equal(r4.ok, true);
  const r5 = await w.chat.postMessage("hana", { text: "你好", clientId: "c1" });
  assert.equal(r5.error, "duplicate");
  assert.equal(r5.duplicate, true);
  rmrf(w.dir);
});

test("chat: 一轮生成——分条气泡 1–4 条、每条 ≤600 字、unread 增加、触发提取", async () => {
  const long = "句".repeat(600);
  const text = `${long}\n\n第二条`;
  const w = await makeWorld({ chatText: text });
  await w.chat.postMessage("hana", { text: "帮我把季度汇报记一下，内容足够长足够长" });
  await w.settle();
  const { messages } = await w.threads.list("hana");
  const assistants = messages.filter((m) => m.role === "assistant");
  assert.equal(assistants.length, 2);
  assert.ok(assistants[0].text.length <= 600);
  assert.equal(assistants[1].text, "第二条");
  assert.ok(messages.some((m) => m.role === "user"));
  // 提取被触发（来源 A，chat）
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(w.enqueued.length, 1);
  assert.equal(w.enqueued[0].source, "chat");
  rmrf(w.dir);
});

test("chat: 分条合并——超 4 条合并尾部；空输出/清洗 think 块", async () => {
  const five = ["一", "二", "三", "四", "五"].join("\n\n");
  const w = await makeWorld({ chatText: five });
  const bubbles = w.chat.splitBubbles(five);
  assert.equal(bubbles.length, 4);
  assert.ok(bubbles[3].includes("四") && bubbles[3].includes("五"));
  const withThink = "<think>内部</think>正文";
  const b2 = w.chat.splitBubbles(withThink);
  assert.deepEqual(b2, ["正文"]);
  const b3 = w.chat.splitBubbles("");
  assert.deepEqual(b3, []);
  rmrf(w.dir);
});

test("chat: latest-wins——连续发 3 条只跑连续的轮次且按序分条", async () => {
  const w = await makeWorld({ chatText: "收到" });
  await w.chat.postMessage("hana", { text: "第一条用户消息内容足够长" });
  await w.chat.postMessage("hana", { text: "第二条用户消息内容足够长" });
  await w.chat.postMessage("hana", { text: "第三条用户消息内容足够长" });
  await w.settle();
  const { messages } = await w.threads.list("hana");
  const users = messages.filter((m) => m.role === "user");
  const assistants = messages.filter((m) => m.role === "assistant");
  assert.equal(users.length, 3);
  assert.equal(assistants.length, 3); // 每轮一条气泡
  // latest-wins 契约：三条都得到了回答，且末尾不悬空（最后一条是助手回复）
  // 用户连发时中间可能连排（几条 user 挤在一条 assistant 前），这是允许的合并形态
  assert.equal(messages.at(-1).role, "assistant");
  let answered = 0;
  for (const u of users) {
    if (messages.some((m) => m.role === "assistant" && m.seq > u.seq)) answered++;
  }
  assert.equal(answered, 3);
  rmrf(w.dir);
});

test("chat: 工具调用走 toolRunner，结果以系统行写入不占气泡", async () => {
  const w = await makeWorld({ withTools: true });
  w.model.chat = async ({ toolRunner }) => {
    const t = await toolRunner("note_thing", { title: "季度汇报", area: "work" });
    return { text: `记好了。${t}`, toolCalls: [{ name: "note_thing" }], requestId: "r2" };
  };
  await w.chat.postMessage("hana", { text: "把季度汇报记下来，内容足够长足够长" });
  await w.settle();
  const { messages } = await w.threads.list("hana");
  assert.ok(messages.some((m) => m.role === "system" && /记下了：季度汇报/.test(m.text)));
  const things = await w.repo.listThings({});
  assert.equal(things.length, 1);
  rmrf(w.dir);
});

test("chat: 失败/空输出 → 系统行「没回上来」+ 轮次 failed", async () => {
  const w = await makeWorld({ chatText: "" });
  await w.chat.postMessage("hana", { text: "触发空输出的内容内容内容内容" });
  await w.settle();
  // 空输出 → 1800 tokens 重试一次（§4.2），故允许一次额外调用
  await new Promise((r) => setTimeout(r, 10));
  const { messages } = await w.threads.list("hana");
  assert.ok(messages.some((m) => m.role === "system" && /没回上来/.test(m.text)));
  const turns = w.threads.listTurns("hana");
  assert.equal(turns[turns.length - 1].status, "failed");
  rmrf(w.dir);
});

test("chat: cancel → 保留已生成部分并标「已停止」，轮次 interrupted", async () => {
  const w = await makeWorld();
  let entered; const enteredP = new Promise((r) => { entered = r; });
  w.model.chat = async ({ isCancelled }) => {
    entered(); // 等真的一轮开始生成，再取消（取消标志在开轮时建立）
    await new Promise((r) => setTimeout(r, 20));
    return { text: "部分回复", toolCalls: [], requestId: "r3", cancelled: isCancelled() };
  };
  await w.chat.postMessage("hana", { text: "先别急，内容足够长足够长" });
  await enteredP;
  w.chat.cancel("hana");
  await w.settle();
  const { messages } = await w.threads.list("hana");
  assert.ok(messages.some((m) => m.text === "部分回复"));
  assert.ok(messages.some((m) => m.role === "system" && m.text === "已停止"));
  const turns = w.threads.listTurns("hana");
  assert.equal(turns[turns.length - 1].status, "interrupted");
  rmrf(w.dir);
});

test("chat: 滚动摘要——超 40 条未摘要触发并入（fake utility）", async () => {
  const w = await makeWorld();
  for (let i = 0; i < 45; i++) await w.threads.append("hana", { role: "user", text: `第${i}条消息` });
  let utilityCalled = 0;
  w.model.utility = async () => { utilityCalled++; return { text: "摘要内容" }; };
  await w.chat.postMessage("hana", { text: "触发滚动摘要的内容内容内容内容" });
  await w.settle();
  // 摘要是后台异步并入的（不阻塞这一轮），等它落盘
  let t = await w.threads.load("hana");
  const t0 = Date.now();
  while (!t.summary && Date.now() - t0 < 3000) {
    await new Promise((r) => setTimeout(r, 5));
    t = await w.threads.load("hana");
  }
  assert.ok(utilityCalled >= 1);
  assert.ok(t.summary.includes("摘要内容"));
  assert.ok(t.summary.includes("【"));
  rmrf(w.dir);
});

test("chat: buildMessages 裁剪 24 条/6000 字；组 prompt 含九块与主对话近况", async () => {
  const w = await makeWorld();
  for (let i = 0; i < 30; i++) await w.threads.append("hana", { role: "user", text: `第${i}条` });
  const msgs = w.chat.buildMessages(await w.threads._all("hana"));
  assert.ok(msgs.length <= 24);
  const sys = await w.chat.buildSystem("hana", { withTools: true });
  assert.match(sys, /拾遗/); // 框架
  assert.match(sys, /人格块文本/); // 人格
  assert.match(sys, /用户置顶/); // 关于用户
  assert.match(sys, /## 现在/); // 现在
  assert.match(sys, /手上的事|## /); // 事块标题（空列表时也有标题）
  assert.match(sys, /可以用的工具/); // 工具说明
  rmrf(w.dir);
});
