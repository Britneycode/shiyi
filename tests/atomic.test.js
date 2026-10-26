import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic, readJsonSafe, appendLine, writeFileAtomic } from "../lib/atomic.js";
import { tmpdir, rmrf } from "./helpers.js";

test("writeJsonAtomic: 写入并可读回", async () => {
  const dir = tmpdir();
  const f = path.join(dir, "a.json");
  await writeJsonAtomic(f, { x: 1 });
  assert.deepEqual(JSON.parse(fs.readFileSync(f, "utf8")), { x: 1 });
  rmrf(dir);
});

test("writeJsonAtomic: 重写前备份 .bak", async () => {
  const dir = tmpdir();
  const f = path.join(dir, "a.json");
  await writeJsonAtomic(f, { v: 1 });
  await writeJsonAtomic(f, { v: 2 });
  assert.deepEqual(JSON.parse(fs.readFileSync(`${f}.bak`, "utf8")), { v: 1 });
  rmrf(dir);
});

test("readJsonSafe: 坏文件回退 .bak", async () => {
  const dir = tmpdir();
  const f = path.join(dir, "a.json");
  await writeJsonAtomic(f, { ok: 1 });   // 产生 .bak 为不存在 → 先手动造一个
  await writeJsonAtomic(f, { ok: 2 });   // 现在 .bak = {ok:1}
  fs.writeFileSync(f, "{ 坏掉 ");        // 写坏
  const v = await readJsonSafe(f, () => ({ empty: true }));
  assert.deepEqual(v, { ok: 1 });        // 回退到 .bak
  rmrf(dir);
});

test("readJsonSafe: 不存在 → fallback", async () => {
  const dir = tmpdir();
  const v = await readJsonSafe(path.join(dir, "none.json"), () => ({ d: 1 }));
  assert.deepEqual(v, { d: 1 });
  rmrf(dir);
});

test("appendLine: 追加多行", async () => {
  const dir = tmpdir();
  const f = path.join(dir, "a.jsonl");
  await appendLine(f, '{"a":1}');
  await appendLine(f, '{"b":2}');
  const lines = fs.readFileSync(f, "utf8").trim().split("\n");
  assert.equal(lines.length, 2);
  rmrf(dir);
});

test("writeFileAtomic: 不产生残留 tmp 文件", async () => {
  const dir = tmpdir();
  const f = path.join(dir, "x.txt");
  await writeFileAtomic(f, "hello");
  const names = fs.readdirSync(dir);
  assert.deepEqual(names, ["x.txt"]);
  rmrf(dir);
});
