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
pwsh -NoProfile -File tools/pack.ps1
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

## 市场索引与更新（宿主提示更新 → 覆盖安装）

更新能力不在应用里，在宿主里：应用挂到一份**市场索引**上，宿主比对版本、提示「可更新」、确认一次后**就地覆盖安装**（失败自动把旧目录搬回来）。拾遗走这条宿主原生路径，应用代码零改动。

读宿主 APPS.md 与 `bundle/index.js` 源码确认的约束：

- 只有**从市场源安装**的记录能更新。本地 zip 装的记录调 `registry.update()` 会报 `EXTENSION_UPDATE_SOURCE_UNSUPPORTED`（"was not installed from a market source; remove and reinstall it instead"）。
- 宿主去「当初装它的那一个源」的索引里查同 kind+id 的最新版本 —— 自定义源同样适用，所以加一次源就够。
- 覆盖安装的动作（app kind，源码 `bundle/index.js` 的 app 安装分支）：停用旧应用 → 旧目录改名成 `<id>.update-backup-<rand>` → 写新包 → 成功删备份、失败删新包并把备份改回原名并重新加载旧应用。`{HANA_HOME}/app-data/shiyi` 里的用户数据不受影响。
- 安装包本身仍走宿主的暂存 → 审查卡 → 确认，与本地 zip 安装同一条路径，只需一次确认。

### 生成索引

```powershell
pwsh -NoProfile -File tools/pack.ps1
node tools/market-index.mjs
```

产出 `market/app-shiyi-<版本>.entry.json`（单条条目）和 `market/index.v2.json`（整份索引），提交后即可按 URL 取到。

### 在宿主里添加源（一次性）

设置 → 扩展 → 浏览市场 → 来源 → 添加来源

- 名称：拾遗
- 地址：`https://raw.githubusercontent.com/Britneycode/shiyi/main/market/index.v2.json`

（raw 取不到时改用 `https://cdn.jsdelivr.net/gh/Britneycode/shiyi@main/market/index.v2.json`。）

然后在市场里装拾遗：若宿主里已有本地装的同名应用，页面上会出现「用市场版本替换」，用它替换即可（替换后记录来源变成市场源，更新通道才打通）；没有就点「安装」。

### 每次发版

1. 改 `manifest.json` 的 `version`。
2. `pwsh -NoProfile -File tools/pack.ps1` → `shiyi-v<版本>.zip`。
3. 发 GitHub Release 并把 zip 挂成资产（资产名不能与已有资产重复；发布后不可替换同名资产，只能加新版本）。
4. `node tools/market-index.mjs` —— `archive.url` 指向该 release 的下载地址，`sha256`/`size` 取自本地包，宿主安装时会逐字节核对。
5. 提交并推送 `market/` 下的两份文件。
6. 宿主市场页刷新 → 出现「可更新」→ 点更新 → 一次确认 → 覆盖安装完成。

### 交叉校验索引（用宿主官方工具）

```bash
node ~/.hanako/artifacts/server/<宿主版本>/scripts/extension-index-build.mjs \
  --entries market --base-url https://github.com/Britneycode/shiyi/releases/download/v<版本> \
  --source-id shiyi --name "拾遗 · 私有源" --out ./market.index.check.json
```

该脚本用宿主权威校验器 `validateMarketIndexV2` 自检：不合法条目会被整条丢弃并直接报错退出。它生成的 `items` 应与 `market/index.v2.json` 完全一致（`publishedAt` 除外）。

### 想进官方市场（可选，需维护者审核）

向 [liliMozi/hana-marketplace](https://github.com/liliMozi/hana-marketplace) 提 PR，同时改两个文件：

- `registry.json`：`{ "kind": "app", "id": "shiyi", "repository": "Britneycode/shiyi", "publisher": "Britneycode" }`
- `approvals.json`：`{ "kind": "app", "id": "shiyi", "tag": "v<版本>", "sha256": "<条目 JSON 里 archive.sha256 的值>", "readme": "…" }`

同步器只按批准记录里的 tag 读那个 Release，核对附件、大小与 SHA-256；目录更新不会自动安装，用户在市场里点一次更新才会覆盖安装。审核不通过也不影响上面的自定义源。
