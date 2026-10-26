import test from "node:test";
import assert from "node:assert/strict";
import { createExtractor, parseOpsLoose, sanitizeTime, evidenceOk } from "../lib/memory/extract.js";
import { createMemoryRepo } from "../lib/memory/repo.js";
import { createSettings } from "../lib/settings.js";
import { defaultSettings } from "../lib/config.js";
import { tmpdir, rmrf } from "./helpers.js";

function makeWorld({ memState = "on", utilityText = null, settingsPatch = {} } = {}) {
  const dir = tmpdir();
  const repo = createMemoryRepo({ dir });
  const settings = createSettings(dir);
  // 用 load() 预热缓存，再原地改（测试辅助，绕开 patch 白名单）
  const ready = (async () => {
    const s = await settings.load();
    s.onboarded = true;
    s.memory.learnFromMain = true;
    Object.assign(s.memory, settingsPatch.memory ?? {});
  })();
  const utilityCalls = [];
  const model = {
    async utility(req) {
      utilityCalls.push(req);
      return { text: typeof utilityText === "function" ? utilityText(req) : (utilityText ?? "{\"ops\":[]}") };
    },
  };
  const policy = { async memoryState() { return memState; } };
  const agents = { overview: () => [{ id: "hana", name: "小花", chatModel: { provider: "p", model: "x" } }] };
  const ex = createExtractor({ repo, model, settings, policy, agents, clock: () => Date.now() });
  return { dir, repo, settings, model, ex, utilityCalls, ready };
}

const userMsg = (text, at = "2026-10-25T14:00:00+08:00", id = null) => ({ role: "user", text, at, id: id ?? `m_${Math.random().toString(36).slice(2, 8)}` });

test("extract: 宽松解析——去代码块、首个{到末个}", () => {
  assert.deepEqual(parseOpsLoose("```json\n{\"ops\":[]}\n```"), []);
  assert.deepEqual(parseOpsLoose("前言 {\"ops\":[{\"op\":\"new_thing\"}]} 后记"), [{ op: "new_thing" }]);
  assert.equal(parseOpsLoose("没有 json"), null);
  assert.equal(parseOpsLoose("{\"nope\":1}"), null);
});

test("extract: sanitizeTime——早于消息时间 24h / 超 180 天置空；安静时段顺延", () => {
  const refAt = "2026-10-25T14:00:00+08:00";
  assert.equal(sanitizeTime("2020-01-01T00:00:00+08:00", { refAt }), null);
  assert.equal(sanitizeTime("2027-10-01T00:00:00+08:00", { refAt }), null);
  const ok = sanitizeTime("2026-10-30T10:00:00+08:00", { refAt });
  assert.match(ok, /^2026-10-30T10:00/);
  const quiet = { enabled: true, start: "23:00", end: "08:00" };
  const shifted = sanitizeTime("2026-10-26T23:30:00+08:00", { refAt, quiet });
  assert.match(shifted, /^2026-10-27T08:00/);
});

test("extract: evidenceOk——与某条用户消息 bigram ≥0.5；来源 B 才许助手消息", () => {
  const msgs = [
    { role: "user", text: "季度汇报改到周五交了" },
    { role: "assistant", text: "周报改成下周一交" },
  ];
  assert.equal(evidenceOk("季度汇报改到周五交了", msgs), true);
  assert.equal(evidenceOk("周报改成下周一交", msgs), false);
  assert.equal(evidenceOk("周报改成下周一交", msgs, { allowAssistant: true }), true);
  assert.equal(evidenceOk("", msgs), false);
});

test("extract: 端到端——utility 返回 new_thing → 落盘进 repo", async () => {
  const w = makeWorld({
    utilityText: JSON.stringify({ ops: [
      { op: "new_thing", area: "work", title: "季度汇报", status: "active", now: "改到周五交",
        evidence: "季度汇报改到周五交了，我还得再补", keywords: ["汇报", "PPT"] },
    ] }),
  }); await w.ready;
  w.ex.enqueue({ source: "chat", agentId: "hana", ref: "t1", messages: [userMsg("季度汇报改到周五交了，我还得再补两页内容才行")] });
  await w.ex.idle();
  const lastLog = w.ex.logs().at(-1);
  const things = await w.repo.listThings({});
  assert.equal(things.length, 1, `log: ${JSON.stringify(lastLog)}`);
  assert.equal(things[0].title, "季度汇报");
  assert.equal(things[0].status, "active");
  assert.equal(lastLog.outcome, "ok");
  assert.equal(lastLog.applied, 1);
  assert.equal(w.utilityCalls.length, 1);
  rmrf(w.dir);
});

test("extract: L1——用户文字 <20 字 → skipped_short 不调模型；日上限 → capped", async () => {
  const w = makeWorld(); await w.ready;
  w.ex.enqueue({ source: "chat", agentId: "hana", ref: "s1", messages: [userMsg("好的")] });
  await w.ex.idle();
  assert.equal(w.utilityCalls.length, 0);
  assert.equal(w.ex.logs().at(-1).outcome, "skipped_short");

  const w2 = makeWorld({ settingsPatch: { memory: { extractDailyCap: 20 } } }); await w2.ready;
  for (let i = 0; i < 20; i++) {
    // 直接打满计数：每条 ref 不同且消息 id 不同（windowKey 不复用）
    w2.ex.enqueue({ source: "chat", agentId: "hana", ref: `cap${i}`, messages: [userMsg(`第${i}条足够长的用户消息内容内容内容很多字${i}`, undefined, `cap_m${i}`)] });
  }
  await w2.ex.idle();
  w2.ex.enqueue({ source: "chat", agentId: "hana", ref: "cap-over", messages: [userMsg("这一条超出日上限了，内容足够长足够长很多字", undefined, "cap_over_m")] });
  await w2.ex.idle();
  const outcomes = w2.ex.logs().map((l) => l.outcome);
  assert.ok(outcomes.includes("capped"), `outcomes: ${JSON.stringify(outcomes)}`);
  rmrf(w.dir); rmrf(w2.dir);
});

test("extract: 记忆守卫 off/unknown → 不调模型", async () => {
  const w = makeWorld({ memState: "off" }); await w.ready;
  w.ex.enqueue({ source: "chat", agentId: "hana", ref: "g1", messages: [userMsg("这是一条足够长的用户消息，用来测试记忆守卫的拦截行为")] });
  await w.ex.idle();
  assert.equal(w.utilityCalls.length, 0);
  assert.equal(w.ex.logs().at(-1).outcome, "memory_off");
  rmrf(w.dir);

  const w2 = makeWorld({ memState: "unknown" }); await w2.ready;
  w2.ex.enqueue({ source: "chat", agentId: "hana", ref: "g2", messages: [userMsg("这是一条足够长的用户消息，用来测试记忆守卫的拦截行为")] });
  await w2.ex.idle();
  assert.equal(w2.ex.logs().at(-1).outcome, "memory_unknown");
  rmrf(w2.dir);
});

test("extract: 排除记录——窗口全部命中 → dropped_excluded 不调模型", async () => {
  const w = makeWorld(); await w.ready;
  const m1 = userMsg("这条消息之后会被整体排除掉，内容足够长", undefined, "excl_1");
  await w.repo.addExclusion({ windowKey: null, messageIds: ["excl_1"] });
  w.ex.enqueue({ source: "chat", agentId: "hana", ref: "e1", messages: [m1] });
  await w.ex.idle();
  assert.equal(w.utilityCalls.length, 0);
  assert.equal(w.ex.logs().at(-1).outcome, "dropped_excluded");
  rmrf(w.dir);
});

test("extract: L0——同一窗口重放丢弃（duplicate）", async () => {
  const w = makeWorld(); await w.ready;
  const msg = userMsg("这是足够长的用户消息，用来测试窗口重放去重的行为", undefined, "dup_m1");
  w.ex.enqueue({ source: "chat", agentId: "hana", ref: "r1", messages: [msg] });
  await w.ex.idle();
  w.ex.enqueue({ source: "chat", agentId: "hana", ref: "r1", messages: [msg] });
  await w.ex.idle();
  const outcomes = w.ex.logs().map((l) => l.outcome);
  assert.deepEqual(outcomes, ["ok", "duplicate"]);
  assert.equal(w.utilityCalls.length, 1);
  rmrf(w.dir);
});

test("extract: unknown_id / bad_op / sensitive / 无 evidence 逐条丢弃", async () => {
  const w = makeWorld({
    utilityText: JSON.stringify({ ops: [
      { op: "update_thing", id: "t_ghost", now: "不存在的 id" },
      { op: "fly_to_moon" },
      { op: "new_thing", area: "work", title: "银行卡号 6222020200112233", evidence: "用户消息里有" },
      { op: "new_thing", area: "work", title: "没证据的事", evidence: "窗口里根本没说过这个话呀" },
    ] }),
  }); await w.ready;
  w.ex.enqueue({ source: "chat", agentId: "hana", ref: "v1", messages: [userMsg("这条用户消息只是闲聊，没有提到任何实际的事情哦")] });
  await w.ex.idle();
  const log = w.ex.logs().at(-1);
  const reasons = log.dropped.map((d) => d.reason).sort();
  // sensitive（银行卡号）与 no_evidence 各报各的；sensitive 优先于证据检查被记录
  assert.deepEqual(reasons, ["bad_op", "no_evidence", "sensitive", "unknown_id"]);
  assert.equal((await w.repo.listThings({})).length, 0);
  rmrf(w.dir);
});

test("extract: L3 判重——相似 new_thing 改写为 update（不新建）", async () => {
  const w = makeWorld(); await w.ready;
  await w.repo.createThing({ title: "季度汇报", area: "work", status: "active", now: "初稿写了一半" });
  const newTitle = "季度汇报初稿"; // 与「季度汇报」标题 bigram Jaccard = 0.6，达到 L3 阈值
  w.ex.__utility = JSON.stringify({ ops: [
    { op: "new_thing", area: "work", title: newTitle, now: "初稿写完了", evidence: "季度汇报初稿写完了，明天给老板看", keywords: [] },
  ] });
  w.model.utility = async () => ({ text: w.ex.__utility });
  w.ex.enqueue({ source: "chat", agentId: "hana", ref: "l3", messages: [userMsg("季度汇报初稿写完了，明天给老板看，这下总算松口气了")] });
  await w.ex.idle();
  const things = await w.repo.listThings({});
  assert.equal(things.length, 1, `logs: ${JSON.stringify(w.ex.logs().at(-1))}`);
  const full = await w.repo.getThing(things[0].id);
  assert.equal(full.now, "初稿写完了");
  rmrf(w.dir);
});

test("extract: weak_status——done 无完成类词 → 只追加记录不改状态", async () => {
  const w = makeWorld(); await w.ready;
  const t = await w.repo.createThing({ title: "季度汇报", area: "work", status: "active" });
  w.model.utility = async () => ({ text: JSON.stringify({ ops: [
    { op: "update_thing", id: t.id, status: "done", log: "还在写", evidence: "季度汇报还在写，别急" },
  ] }) });
  w.ex.enqueue({ source: "chat", agentId: "hana", ref: "ws", messages: [userMsg("季度汇报还在写，别急，我快写完了，这周内肯定能交给你")] });
  await w.ex.idle();
  const full = await w.repo.getThing(t.id);
  assert.equal(full.status, "active", `logs: ${JSON.stringify(w.ex.logs().at(-1))}`);
  const log = w.ex.logs().at(-1);
  assert.ok(log.dropped.some((d) => d.reason === "weak_status"));
  rmrf(w.dir);
});
