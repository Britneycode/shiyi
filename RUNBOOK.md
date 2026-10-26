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

**shell 选择**：脚本存为 UTF-8 with BOM，Windows PowerShell 5.1 与 PowerShell 7 都能跑（5.1 读无 BOM 的 UTF-8 脚本会按 ANSI 解码，中文注释会变乱码、here-string 里的中文会直接把脚本解析炸掉）。

**不要用 `Compress-Archive`**：它写入的条目名用 `\` 分隔，宿主解包的 `yauzl` 开启了 `strictFileNames:true`，会判为非法路径并报 `INSTALL_ARCHIVE_INVALID`「Archive could not be read safely.」。`tools/pack.ps1` 用 .NET `ZipArchive` 显式写 `/`，并在打包后自检条目名与 manifest 位置。

## 发布到 GitHub Release

- 令牌只从环境变量 `GITHUB_TOKEN_BRITNEYCODE` 读，不写进仓库、git config 或 remote URL。
- **提交含中文的正文，用 UTF-8 的 JSON 文件 + `curl --data-binary @file`**（`Content-Type: application/json; charset=utf-8`）。已实测：PowerShell 5.1 的 `Invoke-RestMethod` 传字符串 body 时不按 UTF-8 发出，中文会变成一串 `?`（release 说明就是这个坑）；改用 curl + UTF-8 JSON 文件后正常。
- 同一 release 下的资产名不可重复；要出新版就升 manifest 版本、加法发新 release，不要替换已发布资产。

## 面板

- 整页：`/panel.html`（realization:page、siteNavEntry、detached 同路由 1080×760）。
- 小窗：同一路由 `/panel.html`（cardForm:"edge-to-edge"），形态由视口宽度 ≤640px 判定（宿主 route 不接受 query）。
- 主题：`?hana-theme=<theme>&hana-css=<url>`。
