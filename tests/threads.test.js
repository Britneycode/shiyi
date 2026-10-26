import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createThreads } from "../lib/threads.js";
import { tmpdir, rmrf } from "./helpers.js";

test("threads: append 递增 seq、assistant 增 unread、list(after)/markRead", async () => {
  const dir = tmpdir();
  const th = createThreads({ dir });
  const a = await th.append("hana", { role: "user", text: "在吗" });
  const b = await th.append("hana", { role: "assistant", text: "在的" });
  assert.equal(a.message.seq, 1);
  assert.equal(b.message.seq, 2);
  assert.equal(a.turnId, null);

  const l1 = await th.list("hana", { after: 0 });
  assert.equal(l1.messages.length, 2);
  assert.equal(l1.unread, 1);

  const l2 = await th.list("hana", { after: 1 });
  assert.deepEqual(l2.messages.map((m) => m.seq), [2]);

  const m = await th.markRead("hana", 2);
  assert.equal(m.unread, 0);
  rmrf(dir);
});

test("threads: 超 THREAD_KEEP_MSGS(1000) 最老消息进 archive.jsonl", async () => {
  const dir = tmpdir();
  const th = createThreads({ dir });
  for (let i = 0; i < 1005; i++) {
    await th.append("hana", { role: "user", text: `m${i}` });
  }
  const l = await th.list("hana", { after: 0, limit: 2000 });
  assert.equal(l.messages.length, 1000);
  assert.equal(l.messages[0].text, "m5"); // 前 5 条被归档
  const arch = fs.readFileSync(path.join(dir, "hana.archive.jsonl"), "utf8").trim().split("\n");
  assert.equal(arch.length, 5);
  assert.match(arch[0], /m0/);

  // loadEarlier 倒序读回
  const earlier = await th.loadEarlier("hana", { beforeSeq: 6, limit: 3 });
  assert.equal(earlier.length, 3);
  assert.deepEqual(earlier.map((m) => m.text), ["m2", "m3", "m4"]);
  rmrf(dir);
});

test("threads: 轮次状态机 startTurn/finishTurn/recoverInterrupted", async () => {
  const dir = tmpdir();
  const th = createThreads({ dir });
  const t = th.startTurn("hana");
  assert.equal(t.status, "generating");
  th.updateTurn("hana", t.id, { partial: "你好" });
  assert.equal(th.getTurn("hana", t.id).partial, "你好");
  assert.equal(th.listTurns("hana", { activeOnly: true }).length, 1);

  // 重启恢复：generating → interrupted
  await th.recoverInterrupted();
  assert.equal(th.getTurn("hana", t.id).status, "interrupted");
  assert.equal(th.listTurns("hana", { activeOnly: true }).length, 0);

  const t2 = th.startTurn("hana");
  th.finishTurn("hana", t2.id, { status: "done", partial: "完成" });
  assert.equal(th.getTurn("hana", t2.id).status, "done");
  assert.ok(th.getTurn("hana", t2.id).finishedAt);
  rmrf(dir);
});

test("threads: needsSummary >40 条触发；foldSummary 并入最旧 20 条并推进游标", async () => {
  const dir = tmpdir();
  const th = createThreads({ dir });
  for (let i = 0; i < 45; i++) await th.append("hana", { role: "user", text: `q${i}` });
  assert.equal(await th.needsSummary("hana"), true);

  const r = await th.foldSummary("hana", "前 20 条大意");
  assert.equal(r.folded, 20);
  assert.equal(r.summarizedUpto, 20);
  assert.match(r.summary, /【1–20】/);
  const l = await th.list("hana", { after: 0 });
  assert.match(l.summary, /前 20 条大意/);
  assert.equal(l.summarizedUpto, 20);
  assert.equal(await th.needsSummary("hana"), false); // 只剩 25 条未摘要
  rmrf(dir);
});

test("threads: clear 重置线程；空线程 list 安全", async () => {
  const dir = tmpdir();
  const th = createThreads({ dir });
  const empty = await th.list("nobody", { after: 0 });
  assert.equal(empty.messages.length, 0);
  await th.append("hana", { role: "user", text: "hi" });
  await th.clear("hana");
  const l = await th.list("hana", { after: 0 });
  assert.equal(l.messages.length, 0);
  assert.equal(l.unread, 0);
  rmrf(dir);
});
