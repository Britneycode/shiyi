# RUNBOOK — 可跑命令

## 测试

```bash
node --test tests/*.test.js
```

预期：`pass 148` / `fail 0`（Node ≥ 22）。

## 安装

无需构建、零外部依赖。把目录放到 HanaAgent v2 的 `apps/` 下即可；宿主扫描 `manifest.json` 注册。

## 打包

```powershell
powershell -NoProfile -File tools/pack.ps1
```

产出仓库根的 `shiyi-v<manifest 版本>.zip`（manifest.json 在压缩包根级）。包名由脚本按 manifest 的 `version` 生成，改版本后不用手改文件名。

**不要用 `Compress-Archive`**：它写入的条目名用 `\` 分隔，宿主解包的 `yauzl` 开启了 `strictFileNames:true`，会判为非法路径并报 `INSTALL_ARCHIVE_INVALID`「Archive could not be read safely.」。`tools/pack.ps1` 用 .NET `ZipArchive` 显式写 `/`，并在打包后自检条目名与 manifest 位置。

## 面板

- 整页：`/panel.html`（realization:page、siteNavEntry、detached 同路由 1080×760）。
- 小窗：同一路由 `/panel.html`（cardForm:"edge-to-edge"），形态由视口宽度 ≤640px 判定（宿主 route 不接受 query）。
- 主题：`?hana-theme=<theme>&hana-css=<url>`。
