import test from "node:test";
import assert from "node:assert/strict";
import { createMainfeed } from "../lib/mainfeed.js";
import { createSettings } from "../lib/settings.js";
import { tmpdir, rmrf } from "./helpers.js";
import fs from "node:fs";
import path from "node:path";
// 假时钟：把 3 分钟静默定时器提前触发（不依赖真实等待）
const fireBatch = async (mf, agentId = "hana") => {
  const p = mf._pending.get(agentId);
  if (!p?.timer) return;
  clearTimeout(p.timer);
  mf._pending.delete(agentId);
  await mf.flushAgent(agentId);
};

const MAIN = (f) => `C:/hana/agents/hana/sessions/${f}.jsonl`;
const MSG = (role, text, extra = {}) => ({
  message: { role, content: text, entryId: extra.entryId ?? null, timestamp: extra.at },
  agentId: extra.agentId ?? "hana", isolated: extra.isolated,
});

function makeWorld({ onboarded = true, learnFromMain = true, memState = "on", handoffs = null, dir = null } = {}) {
  dir = dir ?? tmpdir();
  const settings = createSettings(dir);
  const ready = (async () => {
    const s = await settings.load();
    s.onboarded = onboarded;
    s.memory.learnFromMain = learnFromMain;
  })();
  const enqueued = [];
  const extractor = { enqueue: (t) => enqueued.push(t) };
  const policy = { async memoryState() { return memState; } };
  const logs = [];
  const mf = createMainfeed({ dir, settings, extractor, policy, handoffs, clock: () => Date.now(), log: (e) => logs.push(e) });
  return { dir, mf, enqueued, logs, ready };
}

test("mainfeed: 过滤——非标准主会话路径（ch_/dm_/bridge、深一层目录）一律不收", async () => {
  const w = makeWorld(); await w.ready;
  w.mf.onMessageEnd(MSG("user", "群聊里说了句足够长的内容内容内容", { agentId: "phone" }), "phone/sessions/ch_abc.jsonl");
  w.mf.onMessageEnd(MSG("user", "助手私信里的内容内容内容内容", { agentId: "dm_xyz" }), "phone/sessions/dm_xyz.jsonl");
  w.mf.onMessageEnd(MSG("user", "外部平台的内容内容内容内容"), "bridge/discord/sessions/main.jsonl");
  w.mf.onMessageEnd(MSG("user", "目录多了一层的内容内容内容内容"), "agents/hana/sessions/sub/main.jsonl");
  assert.equal(w.mf.list().length, 0);
  rmrf(w.dir);
});

test("mainfeed: isolated 为 false 才收；true/缺字段丢", async () => {
  const w = makeWorld(); await w.ready;
  w.mf.onMessageEnd(MSG("user", "隔离回合的子任务内容内容内容内容", { isolated: true }), MAIN("a"));
  w.mf.onMessageEnd(MSG("user", "正常主会话回合的内容内容内容内容", { isolated: false }), MAIN("a"));
  assert.equal(w.mf.list().length, 1);
  assert.equal(w.mf.list()[0].text.startsWith("正常主会话"), true);
  rmrf(w.dir);
});

test("mainfeed: learnFromMain 关 → 不收；交接会话单独放行；未 onboarded 不收", async () => {
  const w = makeWorld({ learnFromMain: false, handoffs: { thingFor: (p) => (p === MAIN("hand") ? "t_1025_aaa" : null) } });
  await w.ready;
  w.mf.onMessageEnd(MSG("user", "普通主会话的内容内容内容内容"), MAIN("a"));
  assert.equal(w.mf.list().length, 0);
  w.mf.onMessageEnd(MSG("user", "交接会话里的内容内容内容内容"), MAIN("hand"));
  assert.equal(w.mf.list().length, 1);

  const w2 = makeWorld({ onboarded: false }); await w2.ready;
  w2.mf.onMessageEnd(MSG("user", "未引导时的内容内容内容内容"), MAIN("a"));
  assert.equal(w2.mf.list().length, 0);
  rmrf(w.dir); rmrf(w2.dir);
});

test("mainfeed: 文本清洗（去 think 块）与 800 字截断、角色只收 user/assistant", async () => {
  const w = makeWorld(); await w.ready;
  w.mf.onMessageEnd(MSG("user", "<think>内部思考不要收</think>正文内容内容"), MAIN("a"));
  w.mf.onMessageEnd(MSG("tool", "工具调用行不要收内容内容内容内容"), MAIN("a"));
  const long = "长".repeat(900);
  w.mf.onMessageEnd(MSG("assistant", long), MAIN("a"));
  const list = w.mf.list();
  assert.equal(list.length, 2);
  assert.equal(list[0].text, "正文内容内容");
  assert.equal(list[1].text.length, 800);
  rmrf(w.dir);
});

test("mainfeed: 环形 240 条；entryId 缺失时合成 id；带时间", async () => {
  const w = makeWorld(); await w.ready;
  for (let i = 0; i < 260; i++) w.mf.onMessageEnd(MSG("user", `第${i}条内容`, { entryId: `e${i}`, at: `2026-10-26T10:${String(i % 60).padStart(2, "0")}:00+08:00` }), MAIN("a"));
  const list = w.mf.list();
  assert.equal(list.length, 240);
  assert.equal(list[0].id, "e20");
  const w2 = makeWorld(); await w2.ready;
  w2.mf.onMessageEnd({ message: { role: "user", content: "没有 entryId 的内容内容内容" } }, MAIN("a"));
  assert.match(w2.mf.list()[0].id, /^mf_/);
  assert.ok(w2.mf.list()[0].at);
  rmrf(w.dir); rmrf(w2.dir);
});

test("mainfeed: 出批——静 3 分钟后整批进 extractor；记忆关 → 丢弃并清缓冲", async () => {
  const w = makeWorld(); await w.ready;
  w.mf.onMessageEnd(MSG("user", "第一句内容内容内容内容", { entryId: "u1" }), MAIN("a"));
  w.mf.onMessageEnd(MSG("assistant", "第二句内容内容内容内容", { entryId: "a1" }), MAIN("a"));
  assert.equal(w.enqueued.length, 0);
  await fireBatch(w.mf); // 假时钟：直接触发到期
  assert.equal(w.enqueued.length, 1);
  assert.equal(w.enqueued[0].source, "main");
  assert.equal(w.enqueued[0].messages.length, 2);
  assert.equal(w.enqueued[0].messages[0].id, "u1");
  assert.equal(w.enqueued[0].messages[1].id, "a1");
  rmrf(w.dir);

  const w2 = makeWorld({ memState: "off" }); await w2.ready;
  w2.mf.onMessageEnd(MSG("user", "记忆关时的内容内容内容内容"), MAIN("a"));
  await fireBatch(w2.mf);
  assert.equal(w2.enqueued.length, 0);
  assert.equal(w2.mf.list().length, 0);
  assert.equal(w2.logs.at(-1).outcome, "memory_off");
  rmrf(w2.dir);
});

test("mainfeed: removeByMessageIds 与 clearNonHandoff（关闭学习清非交接条目）", async () => {
  const handoffs = { thingFor: (p) => (p === MAIN("hand") ? "t_1" : null) };
  const w = makeWorld({ handoffs }); await w.ready;
  w.mf.onMessageEnd(MSG("user", "普通条目一内容内容内容", { entryId: "x1" }), MAIN("a"));
  w.mf.onMessageEnd(MSG("user", "普通条目二内容内容内容", { entryId: "x2" }), MAIN("b"));
  w.mf.onMessageEnd(MSG("user", "交接条目内容内容内容内容", { entryId: "h1" }), MAIN("hand"));
  assert.equal(w.mf.removeByMessageIds(["x1", "h1"]), 2);
  assert.equal(w.mf.list().length, 1);
  w.mf.clearNonHandoff();
  assert.equal(w.mf.list().length, 0); // 仅剩的 x2 是非交接 → 被清
  rmrf(w.dir);

  const w2 = makeWorld({ handoffs }); await w2.ready;
  w2.mf.onMessageEnd(MSG("user", "交接条目内容内容内容内容", { entryId: "h1" }), MAIN("hand"));
  w2.mf.clearNonHandoff();
  assert.equal(w2.mf.list().length, 1); // 交接条目保留
  rmrf(w2.dir);
});

test("mainfeed: save/restore 落盘 mainfeed.json；clearAll 清空并持久化；recent 取该助手近条", async () => {
  const w = makeWorld(); await w.ready;
  w.mf.onMessageEnd(MSG("user", "条目甲内容内容内容内容", { entryId: "r1" }), MAIN("a"));
  w.mf.onMessageEnd(MSG("user", "条目乙内容内容内容内容", { entryId: "r2", agentId: "other", at: "2026-10-26T11:00:00+08:00" }), "C:/hana/agents/other/sessions/o.jsonl");
  await w.mf.save();
  assert.ok(fs.existsSync(path.join(w.dir, "mainfeed.json")));

  // 用带跨盘路径的 dir 选项重建：makeWorld 内部自建临时目录，这里换到同一目录做 restore
  const w2 = makeWorld({ dir: w.dir }); await w2.ready;
  await w2.mf.restore();
  assert.equal(w2.mf.list().length, 2);
  assert.deepEqual(w2.mf.recent("hana").map((e) => e.id), ["r1"]);

  await w2.mf.clearAll();
  assert.equal(w2.mf.list().length, 0);
  const { readFileSync } = await import("node:fs");
  assert.equal(JSON.parse(readFileSync(path.join(w.dir, "mainfeed.json"), "utf8")).events.length, 0);
  rmrf(w.dir); rmrf(w2.dir);
});
