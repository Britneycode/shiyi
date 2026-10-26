// 原子写 / .bak 恢复 / 每文件互斥锁。沙箱禁用 fsync（不调用）。
// 规则：tmp-<rand> → rename；写 JSON 前把旧文件拷为 .bak；读坏改名 *.broken-<ts> → 回退 .bak → 空结构。

import fs from "node:fs";
import path from "node:path";
import { randToken } from "./util.js";

const locks = new Map(); // file -> Promise 链尾

export async function withFileLock(file, fn) {
  const key = path.resolve(file);
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn); // 前一个失败也继续
  locks.set(key, next.catch(() => {}));
  try {
    return await next;
  } finally {
    if (locks.get(key) === next) locks.delete(key);
  }
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// 原子写任意内容（文本/Buffer）。写 JSON 用 writeJsonAtomic。
// Windows 下并发 rename 偶发 EPERM/EBUSY/ENOTEMPTY（杀软/索引短暂占用句柄），重试几次。
export async function writeFileAtomic(file, data) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp-${randToken(6)}`;
  await fs.promises.writeFile(tmp, data);
  let lastErr = null;
  for (let i = 0; i < 6; i++) {
    try {
      await fs.promises.rename(tmp, file);
      return;
    } catch (e) {
      lastErr = e;
      if (!["EPERM", "EBUSY", "ENOTEMPTY", "EACCES"].includes(e?.code)) break;
      await new Promise((r) => setTimeout(r, 10 * (i + 1)));
    }
  }
  try { fs.unlinkSync(tmp); } catch {}
  throw lastErr;
}

// JSON 原子写：先把旧文件备份为 .bak，再 tmp→rename。
export async function writeJsonAtomic(file, obj) {
  ensureDir(path.dirname(file));
  try {
    if (fs.existsSync(file)) await fs.promises.copyFile(file, `${file}.bak`);
  } catch {}
  await writeFileAtomic(file, JSON.stringify(obj, null, 2));
}

// 读 JSON：坏 → 改名 broken-<ts> → 回退 .bak → 再坏用 fallback()。
export async function readJsonSafe(file, fallback) {
  const fb = typeof fallback === "function" ? fallback : () => fallback;
  const tryRead = async (f) => {
    const raw = await fs.promises.readFile(f, "utf8");
    return JSON.parse(raw);
  };
  try {
    return await tryRead(file);
  } catch (e) {
    if (e.code === "ENOENT") return fb();
    // 坏文件：改名存档
    try { await fs.promises.rename(file, `${file}.broken-${Date.now()}`); } catch {}
  }
  try {
    const v = await tryRead(`${file}.bak`);
    try { await fs.promises.copyFile(`${file}.bak`, file); } catch {}
    return v;
  } catch {
    return fb();
  }
}

// 追加一行到 jsonl（归档用），每文件互斥。
export async function appendLine(file, line) {
  await withFileLock(file, async () => {
    ensureDir(path.dirname(file));
    await fs.promises.appendFile(file, line + "\n");
  });
}

// 递归把 src 目录/文件移入 trashDir/<ts>/ 下（清除全部记忆 / 删除事项用）。
export async function moveToTrash(src, trashRoot) {
  if (!fs.existsSync(src)) return false;
  const dest = path.join(trashRoot, `${Date.now()}-${path.basename(src)}`);
  ensureDir(path.dirname(dest));
  await fs.promises.rename(src, dest);
  return true;
}
