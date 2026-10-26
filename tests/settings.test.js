import test from "node:test";
import assert from "node:assert/strict";
import { createSettings } from "../lib/settings.js";
import { tmpdir, rmrf } from "./helpers.js";

test("settings: 首次加载返回默认值（onboarded=false, learnFromMain=false）", async () => {
  const dir = tmpdir();
  const s = createSettings(dir);
  const v = await s.load();
  assert.equal(v.onboarded, false);
  assert.equal(v.proactive.enabled, false);
  assert.equal(v.memory.learnFromMain, false);
  assert.equal(v.proactive.dailyCap, 3);
  assert.equal(v.proactive.minGapMinutes, 120);
  rmrf(dir);
});

test("settings: completeOnboarding 设 preset=restrained 应用档位置", async () => {
  const dir = tmpdir();
  const s = createSettings(dir);
  await s.completeOnboarding({ learnFromMain: true, preset: "moderate" });
  const v = s.get();
  assert.equal(v.onboarded, true);
  assert.equal(v.memory.learnFromMain, true);
  assert.equal(v.proactive.enabled, true);
  assert.equal(v.proactive.dailyCap, 6);
  assert.equal(v.proactive.minGapMinutes, 60);
  rmrf(dir);
});

test("settings: completeOnboarding preset=off → proactive 关闭", async () => {
  const dir = tmpdir();
  const s = createSettings(dir);
  await s.completeOnboarding({ learnFromMain: false, preset: "off" });
  assert.equal(s.get().proactive.enabled, false);
  rmrf(dir);
});

test("settings: patch 校验非法 preset 被拒", async () => {
  const dir = tmpdir();
  const s = createSettings(dir);
  await s.load();
  const r = await s.patch({ proactive: { preset: "extreme" } });
  assert.equal(r.ok, false);
  assert.equal(r.error, "bad_preset");
  rmrf(dir);
});

test("settings: patch dailyCap 超出范围被钳制", async () => {
  const dir = tmpdir();
  const s = createSettings(dir);
  await s.load();
  await s.patch({ proactive: { dailyCap: 999 } });
  assert.equal(s.get().proactive.dailyCap, 30);
  rmrf(dir);
});

test("settings: 手动改 dailyCap 后 preset 变 custom", async () => {
  const dir = tmpdir();
  const s = createSettings(dir);
  await s.load();
  await s.patch({ proactive: { dailyCap: 5 } });
  assert.equal(s.get().proactive.preset, "custom");
  rmrf(dir);
});

test("settings: patch memory.scope 非法值被拒", async () => {
  const dir = tmpdir();
  const s = createSettings(dir);
  await s.load();
  const r = await s.patch({ memory: { scope: "everywhere" } });
  assert.equal(r.ok, false);
  rmrf(dir);
});
