// repo 单测：CRUD、索引重建、对账、排除记录、删除与清除全部。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createMemoryRepo } from "../lib/memory/repo.js";
import { tmpdir, rmrf } from "./helpers.js";
import { localISO } from "../lib/util.js";

async function freshRepo() {
  const dir = tmpdir();
  const repo = createMemoryRepo({ dir });
  await repo.reconcile({ force: true });
  return { repo, dir };
}

test("repo: createThing 落盘 Markdown + index 行 + terms 含标题 bigram", async () => {
  const { repo, dir } = await freshRepo();
  const t = await repo.createThing({ title: "季度汇报", area: "work", owner: "hana", keywords: ["汇报"], now: "初稿一半" });
  assert.match(t.id, /^t_\d{4}_[0-9a-z]{3}$/);
  const files = fs.readdirSync(path.join(dir, "things")).filter((f) => f.endsWith(".md"));
  assert.equal(files.length, 1);
  const idx = await repo.loadIndex();
  const row = idx.things[t.id];
  assert.equal(row.title, "季度汇报");
  assert.equal(row.status, "active");
  assert.ok(row.terms.includes("季度"));
  assert.ok(row.terms.includes("汇报"));
  rmrf(dir);
});

test("repo: getThing / updateThing 追加记录并更新时间", async () => {
  const { repo, dir } = await freshRepo();
  const t = await repo.createThing({ title: "季度汇报", owner: "hana" });
  const u = await repo.updateThing(t.id, { now: "数据齐了", log: "2025-03-04 10:00 · 主对话 · 数据拉完了", status: "waiting" });
  assert.equal(u.status, "waiting");
  assert.equal(u.logs.length, 1);
  assert.equal(u.now, "数据齐了");
  const again = await repo.getThing(t.id);
  assert.equal(again.status, "waiting");
  assert.ok(again.updatedAt >= t.createdAt);
  rmrf(dir);
});

test("repo: updateThing 不存在 → null；无实质更新只动 lastMentionedAt", async () => {
  const { repo, dir } = await freshRepo();
  assert.equal(await repo.updateThing("t_0000_zzz", { now: "x" }), null);
  const t = await repo.createThing({ title: "体检预约", owner: "hana" });
  const u = await repo.updateThing(t.id, { touchOnly: true });
  assert.equal(u.logs.length, 0);
  assert.ok(u.lastMentionedAt);
  rmrf(dir);
});

test("repo: createNote / getNote / listNotes", async () => {
  const { repo, dir } = await freshRepo();
  const n = await repo.createNote({ kind: "knowledge", title: "二分查找不变量", content: "左闭右开", tags: ["算法"], keywords: ["二分"] });
  assert.match(n.id, /^n_\d{4}_[0-9a-z]{3}$/);
  const g = await repo.getNote(n.id);
  assert.equal(g.title, "二分查找不变量");
  const idx = await repo.loadIndex();
  assert.equal(idx.notes[n.id].kind, "knowledge");
  assert.ok(idx.notes[n.id].terms.includes("二分"));
  rmrf(dir);
});

test("repo: 删除事 → 文件与 index 行进 .trash/ + 排除记录（sourceRef）", async () => {
  const { repo, dir } = await freshRepo();
  const t = await repo.createThing({
    title: "季度汇报", owner: "hana",
    source: "chat", sourceRef: { windowKey: "w_abc", messageIds: ["m1", "m2"] },
  });
  await repo.deleteThing(t.id);
  assert.equal(await repo.getThing(t.id), null);
  const idx = await repo.loadIndex();
  assert.equal(idx.things[t.id], undefined);
  assert.ok(await repo.isExcluded("w_abc"));
  assert.ok(await repo.isExcluded("m1"));
  assert.ok(!(await repo.isExcluded("m3")));
  const trash = fs.readdirSync(path.join(dir, ".trash"));
  assert.equal(trash.length, 1); // 一个时间戳目录
  const inner = fs.readdirSync(path.join(dir, ".trash", trash[0]));
  assert.ok(inner.some((f) => f.endsWith(".md")));
  rmrf(dir);
});

test("repo: 删除知同样写排除记录", async () => {
  const { repo, dir } = await freshRepo();
  const n = await repo.createNote({ kind: "life", title: "妈妈生日", content: "农历八月", sourceRef: { windowKey: "w_x", messageIds: ["mm"] } });
  await repo.deleteNote(n.id);
  assert.ok(await repo.isExcluded("w_x"));
  assert.ok(await repo.isExcluded("mm"));
  rmrf(dir);
});

test("repo: addExclusion 幂等且可手动调用（这段别记）", async () => {
  const { repo, dir } = await freshRepo();
  await repo.addExclusion({ windowKey: "w_manual", messageIds: ["a", "b"] });
  await repo.addExclusion({ windowKey: "w_manual", messageIds: ["a", "b", "c"] });
  assert.ok(await repo.isExcluded("w_manual"));
  assert.ok(await repo.isExcluded("c"));
  const raw = JSON.parse(fs.readFileSync(path.join(dir, "exclusions.json"), "utf8"));
  assert.equal(raw.windowKeys.filter((k) => k === "w_manual").length, 1);
  assert.equal(raw.messageIds.filter((m) => m === "a").length, 1);
  rmrf(dir);
});

test("repo: 对账补 id / 纠正非法字段 / 重复 id 换新 / 文件删了删索引行", async () => {
  const { repo, dir } = await freshRepo();
  // 手改一份无 id 的 Markdown（用户直编场景）
  const thingsDir = path.join(dir, "things");
  fs.mkdirSync(thingsDir, { recursive: true });
  fs.writeFileSync(path.join(thingsDir, "2025-03-05-手写的.md"),
    "---\ntitle: 手写的事\narea: space\nstatus: flying\n---\n## 现状\n手写内容\n\n## 下一步\n\n## 记录\n");
  // 再放一份与现存 id 重复的
  const a = await repo.createThing({ title: "重复 id 甲", owner: "hana" });
  const dup = path.join(thingsDir, "2025-03-06-重复id乙.md");
  fs.writeFileSync(dup, fs.readFileSync(path.join(thingsDir, a.file), "utf8"));
  const r = await repo.reconcile({ force: true });
  assert.ok(r.fixed >= 2);
  const idx = await repo.loadIndex();
  const titles = Object.values(idx.things).map((x) => x.title);
  assert.ok(titles.includes("手写的事"));
  const handRow = Object.values(idx.things).find((x) => x.title === "手写的事");
  assert.equal(handRow.area, "work");    // 非法 area 被纠正
  assert.equal(handRow.status, "active"); // 非法 status 被纠正
  // 重复 id：两份文件保留不同 id（dup 文件内容复制自甲，标题同为「重复 id 甲」）
  const ids = Object.values(idx.things).filter((x) => x.title === "重复 id 甲").map((x) => x.id);
  assert.equal(new Set(ids).size, 2);
  // 文件删了 → 下次对账删索引行
  fs.rmSync(dup);
  await repo.reconcile({ force: true });
  const idx2 = await repo.loadIndex();
  assert.equal(Object.values(idx2.things).filter((x) => x.title === "重复 id 甲").length, 1);
  rmrf(dir);
});

test("repo: 坏 Markdown（无 id 且无法解析）进诊断，不崩溃", async () => {
  const { repo, dir } = await freshRepo();
  fs.writeFileSync(path.join(dir, "things", "bad.md"), "这根本不是 frontmatter");
  const r = await repo.reconcile({ force: true });
  assert.ok(r.broken.some((f) => f.includes("bad.md")));
  rmrf(dir);
});

test("repo: clearAll 把 things/notes/index/exclusions 移入 .trash/<ts>/", async () => {
  const { repo, dir } = await freshRepo();
  await repo.createThing({ title: "要清的", owner: "hana", sourceRef: { windowKey: "w_c", messageIds: [] } });
  await repo.clearAll();
  assert.equal(fs.readdirSync(path.join(dir, "things")).filter((f) => f.endsWith(".md")).length, 0);
  const idx = await repo.loadIndex();
  assert.deepEqual(idx.things, {});
  assert.equal(await repo.isExcluded("w_c"), false); // 排除记录一并清掉
  const trash = fs.readdirSync(path.join(dir, ".trash"));
  assert.ok(trash.length >= 1);
  rmrf(dir);
});

test("repo: listThings 过滤 area/status/q", async () => {
  const { repo, dir } = await freshRepo();
  await repo.createThing({ title: "季度汇报", area: "work", owner: "hana" });
  await repo.createThing({ title: "游泳课", area: "life", owner: "hana", status: "done" });
  const work = await repo.listThings({ area: "work" });
  assert.equal(work.length, 1);
  const done = await repo.listThings({ status: "done" });
  assert.equal(done.length, 1);
  const q = await repo.listThings({ q: "游泳" });
  assert.equal(q.length, 1);
  rmrf(dir);
});

test("repo: shortId 日期来自 now 参数（假时钟友好）", async () => {
  const { repo, dir } = await freshRepo();
  const at = localISO(new Date(2025, 2, 3, 10, 0, 0));
  const t = await repo.createThing({ title: "假时钟", owner: "hana", now: "", at });
  assert.match(t.id, /^t_0303_[0-9a-z]{3}$/);
  assert.equal(t.createdAt, at);
  rmrf(dir);
});
