# RUNBOOK — 可跑命令

## 测试

```bash
node --test tests/*.test.js
```

预期：`pass 135` / `fail 0`（Node ≥ 22）。

## 安装

无需构建、零外部依赖。把目录放到 HanaAgent v2 的 `apps/` 下即可；宿主扫描 `manifest.json` 注册。

## 打包

```powershell
powershell -NoProfile -File tools/pack.ps1
```

产出仓库根的 `shiyi-v0.1.0.zip`（manifest.json 在压缩包根级）。

**不要用 `Compress-Archive`**：它写入的条目名用 `\` 分隔，宿主解包的 `yauzl` 开启了 `strictFileNames:true`，会判为非法路径并报 `INSTALL_ARCHIVE_INVALID`「Archive could not be read safely.」。`tools/pack.ps1` 用 .NET `ZipArchive` 显式写 `/`，并在打包后自检条目名与 manifest 位置。

## 面板

- 整页：`/panel.html`（realization:page、siteNavEntry、detached 同路由 1080×760）。
- 小窗：`/panel.html?form=mini`（cardForm:"edge-to-edge"）。
- 主题：`?hana-theme=<theme>&hana-css=<url>`。
