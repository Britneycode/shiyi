// 测试公共工具：临时目录、假 ctx。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function tmpdir(prefix = "shiyi-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
export function rmrf(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

/** 最小假 ctx：dataDir + 可挂 bus/models/resources/inputBanner 桩。 */
export function fakeCtx(overrides = {}) {
  const dataDir = tmpdir();
  const ctx = {
    dataDir,
    logger: { warn() {}, info() {}, error() {} },
    bus: { request: async () => { throw new Error("denied"); }, subscribe: () => {} },
    models: undefined,
    resources: undefined,
    inputBanner: undefined,
    tools: undefined,
    clipboard: undefined,
    ...overrides,
  };
  return ctx;
}
