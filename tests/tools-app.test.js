import test from "node:test";
import assert from "node:assert/strict";
import { createAppTools, appToolSchemas } from "../lib/tools-app.js";
import { createMemoryRepo } from "../lib/memory/repo.js";
import { tmpdir, rmrf } from "./helpers.js";

function makeWorld({ memState = "on" } = {}) {
  const dir = tmpdir();
  const repo = createMemoryRepo({ dir });
  const policy = { async memoryState() { return memState; } };
  const cards = [];
  const handoff = { createCard: async (c) => { cards.push(c); return c; } };
  const tools = createAppTools({ repo, policy, handoff });
  return { dir, repo, tools, cards };
}
const CTX = { agentId: "hana", userText: "用户说要把季度汇报周五交，内容足够长", messageIds: ["m1"] };

test("tools-app: 五个工具 schema 齐备，循环限制由 model.chat 负责", () => {
  const names = appToolSchemas().map((s) => s.name);
  assert.deepEqual(names, ["note_thing", "update_thing", "note_fact", "search_memory", "handoff_to_hana"]);
});

test("tools-app: note_thing 新建事；记忆关/未知 → 拒记并返回提示", async () => {
  const w = makeWorld();
  const r = await w.tools.execute("note_thing", { title: "季度汇报", area: "work", now: "初稿写了一半" }, CTX);
  assert.match(r.text, /记下了/);
  assert.match(r.line, /季度汇报/);
  const things = await w.repo.listThings({});
  assert.equal(things.length, 1);
  assert.equal(things[0].source, "chat-tool");
  const full0 = await w.repo.getThing(things[0].id);
  assert.equal(full0.logs.length, 1); // 带了用户消息做记录
  assert.match(full0.logs[0], /聊天工具 · 用户说要把季度汇报周五交，内容足够长/);
  rmrf(w.dir);

  const w2 = makeWorld({ memState: "off" });
  const r2 = await w2.tools.execute("note_thing", { title: "X", area: "work" }, CTX);
  assert.match(r2.text, /记忆已关闭/);
  assert.equal((await w2.repo.listThings({})).length, 0);
  rmrf(w2.dir);

  const w3 = makeWorld({ memState: "unknown" });
  const r3 = await w3.tools.execute("note_thing", { title: "X", area: "work" }, CTX);
  assert.match(r3.text, /确认不了/);
  assert.equal((await w3.repo.listThings({})).length, 0);
  rmrf(w3.dir);
});

test("tools-app: note_thing L3 判重——相似事转为更新而非新建；字段非法拒记", async () => {
  const w = makeWorld();
  await w.repo.createThing({ title: "季度汇报", area: "work", status: "active", now: "初稿写了一半" });
  const r = await w.tools.execute("note_thing", { title: "季度汇报初稿", area: "work", now: "初稿写完了", dueAt: "2026-10-30T18:00:00+08:00" }, CTX);
  assert.match(r.text, /更新了/);
  const things = await w.repo.listThings({});
  assert.equal(things.length, 1);
  const full = await w.repo.getThing(things[0].id);
  assert.equal(full.now, "初稿写完了");
  assert.ok(full.dueAt);
  const bad = await w.tools.execute("note_thing", { title: "长".repeat(40), area: "work" }, CTX);
  assert.match(bad.text, /没记下/);
  rmrf(w.dir);
});

test("tools-app: update_thing 追加记录；unknown_id 如实告知", async () => {
  const w = makeWorld();
  const t = await w.repo.createThing({ title: "季度汇报", area: "work" });
  const r = await w.tools.execute("update_thing", { id: t.id, status: "done", log: "已经交了最终版" }, CTX);
  assert.match(r.text, /更新了/);
  const full = await w.repo.getThing(t.id);
  assert.equal(full.status, "done");
  assert.ok(full.logs.length >= 1);
  const miss = await w.tools.execute("update_thing", { id: "t_ghost", log: "x" }, CTX);
  assert.match(miss.text, /没找到/);
  rmrf(w.dir);
});

test("tools-app: note_fact 新建知；重复知不重复记", async () => {
  const w = makeWorld();
  const r = await w.tools.execute("note_fact", { kind: "person", title: "妈妈：不吃香菜", content: "妈妈对香菜完全不能接受，做菜别放" }, CTX);
  assert.match(r.text, /记下了/);
  const dup = await w.tools.execute("note_fact", { kind: "person", title: "妈妈：不吃香菜", content: "妈妈对香菜完全不能接受，做菜一点都不要放" }, CTX);
  assert.match(dup.text, /已经记过/);
  assert.equal((await w.repo.listNotes({})).length, 1);
  rmrf(w.dir);
});

test("tools-app: search_memory 返回前 6 条摘要（标题/状态/现状/id）", async () => {
  const w = makeWorld();
  await w.repo.createThing({ title: "季度汇报", area: "work", status: "active", now: "初稿写了一半" });
  await w.repo.createNote({ kind: "howto", title: "git rebase 冲突处理", content: "冲突时逐个文件解决后 git rebase --continue" });
  const r = await w.tools.execute("search_memory", { query: "季度汇报" }, CTX);
  assert.match(r.text, /季度汇报/);
  assert.match(r.text, /t_/);
  const r2 = await w.tools.execute("search_memory", { query: "rebase" }, CTX);
  assert.match(r2.text, /git rebase/);
  const none = await w.tools.execute("search_memory", { query: "完全不相关的东西" }, CTX);
  assert.match(none.text, /没查到/);
  rmrf(w.dir);
});

test("tools-app: handoff_to_hana 只插确认卡，返回「等待用户决定」", async () => {
  const w = makeWorld();
  const t = await w.repo.createThing({ title: "季度汇报", area: "work" });
  const r = await w.tools.execute("handoff_to_hana", { title: "写季度汇报初稿", request: "按大纲写初稿 1500 字", thingId: t.id }, CTX);
  assert.equal(r.text, "已向用户展示确认卡，等待用户决定。");
  assert.equal(w.cards.length, 1);
  assert.equal(w.cards[0].thingId, t.id);
  const miss = await w.tools.execute("handoff_to_hana", { title: "x", request: "y", thingId: "t_ghost" }, CTX);
  assert.equal(miss.card.thingId, null); // 关联不上的事不阻塞
  rmrf(w.dir);
});
