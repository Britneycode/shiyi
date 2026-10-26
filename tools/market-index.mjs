// 生成市场索引 —— 宿主「设置 → 扩展 → 浏览市场 → 来源 → 添加来源」用的 index.v2.json。
//
// 用法：
//   node tools/market-index.mjs [选项]
//     --zip <路径>        要发布的安装包（默认 shiyi-v<manifest 版本>.zip）
//     --out <目录>        输出目录（默认 market/）
//     --base-url <前缀>   安装包下载地址前缀（默认 GitHub Release 的 v<版本> 目录）
//     --source-id <id>    源标识（默认 shiyi）
//     --source-name <名>  源名称（默认「拾遗 · 私有源」）
//     --publisher <名>    发布者（默认 Britneycode）
//
// 协议见宿主 APPS.md「市场索引」一节：schemaVersion 恒为 2；sourceId/name/publishedAt 缺一不可；
// items[].archive 需 https URL、64 位小写 sha256、正整数 size、format "zip"；
// items[].permissions[].capability 形如 "<命名空间>/<能力名>"；
// 单条不合法只丢那一条，不连累其余条目。
//
// 同时输出两份文件：
//   market/app-<id>-<版本>.entry.json  单条条目（宿主官方 index builder 与官方市场 PR 收录都用它）
//   market/index.v2.json                整份索引（宿主自定义源直接读它）

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) throw new Error(`unexpected argument: ${key}`);
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`${key} needs a value`);
    out[key.slice(2)] = value;
    i += 1;
  }
  return out;
}

/** 读文件为文本；不存在返回 null。 */
function readText(path) {
  return existsSync(path) ? readFileSync(path, "utf-8") : null;
}

/** 文件的 sha256（小写 hex）与字节数 —— 索引里要跟宿主逐字节核对。 */
function fileDigest(path) {
  const bytes = readFileSync(path);
  return { sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
}

function buildEntry(opts) {
  const manifest = JSON.parse(readText(join(ROOT, "manifest.json")));
  const version = manifest.version;
  const zipPath = opts.zip ? resolve(opts.zip) : join(ROOT, `shiyi-v${version}.zip`);
  if (!existsSync(zipPath)) {
    throw new Error(`package not found: ${zipPath} (run tools/pack.ps1 first)`);
  }
  const baseUrl = (opts["base-url"] ?? `https://github.com/Britneycode/shiyi/releases/download/v${version}`).replace(
    /\/+$/,
    "",
  );
  const archive = {
    url: `${baseUrl}/${basename(zipPath)}`,
    ...fileDigest(zipPath),
    format: "zip",
  };

  const iconPath = join(ROOT, "ui", "assets", "icon.svg");
  const icon = existsSync(iconPath)
    ? `data:image/svg+xml;base64,${readFileSync(iconPath).toString("base64")}`
    : undefined;

  const entry = {
    kind: "app",
    id: manifest.id,
    name: manifest.name,
    publisher: opts.publisher ?? "Britneycode",
    description: manifest.description ?? "",
    version,
    // 索引里的 permissions 只用于安装前审查卡展示；真正授予的权限以包内 manifest 为准。
    permissions: (manifest.capabilities ?? []).map((capability) => ({ capability })),
    compatibility: manifest.minAppVersion ? { minAppVersion: manifest.minAppVersion } : undefined,
    icon,
    archive,
    repository: "https://github.com/Britneycode/shiyi",
    homepage: "https://github.com/Britneycode/shiyi",
    readme: readText(join(ROOT, "README.md")) ?? undefined,
    categories: ["productivity"],
    keywords: ["拾遗", "记忆", "助手"],
  };
  for (const key of Object.keys(entry)) {
    if (entry[key] === undefined) delete entry[key];
  }
  return { entry, zipPath };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { entry, zipPath } = buildEntry(opts);
  const outDir = resolve(opts.out ?? join(ROOT, "market"));
  mkdirSync(outDir, { recursive: true });

  const entryPath = join(outDir, `app-${entry.id}-${entry.version}.entry.json`);
  const indexPath = join(outDir, "index.v2.json");
  writeFileSync(entryPath, `${JSON.stringify(entry, null, 2)}\n`, "utf-8");

  const index = {
    schemaVersion: 2,
    sourceId: opts["source-id"] ?? "shiyi",
    name: opts["source-name"] ?? "拾遗 · 私有源",
    publishedAt: new Date().toISOString(),
    items: [entry],
  };
  writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf-8");

  console.log(`zip=${zipPath} (${statSync(zipPath).size} bytes)`);
  console.log(`archive.url=${entry.archive.url}`);
  console.log(`archive.sha256=${entry.archive.sha256}`);
  console.log(`out=${entryPath}`);
  console.log(`out=${indexPath}`);
}

main();
