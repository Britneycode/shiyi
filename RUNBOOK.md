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

**官方市场条目必须用宿主自带的打包器**（市场校验要求条目里的 `archive.url` 是 `{{BASE_URL}}/…` 占位，自产的条目通不过）：

```bash
node ~/.hanako/artifacts/server/<宿主版本>/scripts/extension-pack.mjs \
  --kind app --dir <app 目录> --publisher "Britneycode" --out ./out
```

产出 `app-shiyi-<版本>.zip` 与 `app-shiyi-<版本>.entry.json`。`--dir` 指向的目录名必须等于 manifest 的 `id`（否则报 `id "shiyi" does not match its directory name`），所以先按「打包」那节的清单把 `index.js / manifest.json / package.json / lib / routes / ui` 复制进一个叫 `shiyi` 的目录再打包。

**shell 选择**：脚本存为 UTF-8 with BOM，Windows PowerShell 5.1 与 PowerShell 7 都能跑（5.1 读无 BOM 的 UTF-8 脚本会按 ANSI 解码，中文注释会变乱码、here-string 里的中文会直接把脚本解析炸掉）。

**不要用 `Compress-Archive`**：它写入的条目名用 `\` 分隔，宿主解包的 `yauzl` 开启了 `strictFileNames:true`，会判为非法路径并报 `INSTALL_ARCHIVE_INVALID`「Archive could not be read safely.」。`tools/pack.ps1` 用 .NET `ZipArchive` 显式写 `/`，并在打包后自检条目名与 manifest 位置。

## 发布到 GitHub Release

- 令牌只从环境变量 `GITHUB_TOKEN_BRITNEYCODE` 读，不写进仓库、git config 或 remote URL。
- **`git push` 必须显式带凭证**：remote 是纯 https，本机没有缓存凭证，直接 `git push` 会挂在交互式账号密码提示上直到超时（不报错、也不推进）。正确写法是走一次性 credential helper 从环境变量取，令牌不落盘、不进 config：

  ```bash
  GIT_TERMINAL_PROMPT=0 git -c credential.helper='!f() { echo username=x-access-token; echo password=$GITHUB_TOKEN_BRITNEYCODE; }; f' push origin main
  ```

  `GIT_TERMINAL_PROMPT=0` 保证万一凭证不对时立刻失败，而不是再次挂起。`gh api` / `curl` 同样用 `-H "Authorization: Bearer $GITHUB_TOKEN_BRITNEYCODE"`。
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

```bash
# 1) 用官方打包器出包（与市场收录同一份字节），产物名 app-shiyi-<版本>.zip
node ~/.hanako/artifacts/server/<宿主版本>/scripts/extension-pack.mjs \
  --kind app --dir <含 shiyi/ 的暂存目录>/shiyi --publisher "Britneycode" --out <输出目录>

# 2) 按这个 zip 生成索引
node tools/market-index.mjs --zip <输出目录>/app-shiyi-<版本>.zip
```

产出 `market/app-shiyi-<版本>.entry.json`（单条条目）和 `market/index.v2.json`（整份索引），提交后即可按 URL 取到。

`market/` 下**只留最新一版的 entry 文件**：宿主 builder 会把目录里所有 `*.entry.json` 合并成同一 id 的 `versions` 数组，旧条目留着会让索引多出一个指向旧 zip 的版本项（实测 0.1.2 条目残留时 `items` 交叉校验不相等）。

### 在宿主里添加源（一次性）

设置 → 扩展 → 浏览市场 → 来源 → 添加来源

- 名称：拾遗
- 地址：`https://raw.githubusercontent.com/Britneycode/shiyi/main/market/index.v2.json`

（raw 取不到时改用 `https://cdn.jsdelivr.net/gh/Britneycode/shiyi@main/market/index.v2.json`。）

然后在市场里装拾遗：若宿主里已有本地装的同名应用，页面上会出现「用市场版本替换」，用它替换即可（替换后记录来源变成市场源，更新通道才打通）；没有就点「安装」。

### 每次发版

1. 改 `manifest.json` 的 `version`（`package.json` 一并改）。
2. 官方打包器出包 → `app-shiyi-<版本>.zip` + `app-shiyi-<版本>.entry.json`（见「打包」）。
3. 发 GitHub Release `v<版本>`，把上面**两个**资产都挂上（资产名不能与已有资产重复；发布后不可替换同名资产，只能加新版本）。
4. `node tools/market-index.mjs --zip <输出目录>/app-shiyi-<版本>.zip` —— `archive.url` 指向该 release 的下载地址，`sha256`/`size` 取自本地包，宿主安装时会逐字节核对。删掉上一版的 `market/app-*.entry.json`。
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

官方市场是**目录登记**：客户端只读 `liliMozi/hana-marketplace` 自动生成的 `index.v2.json`，而 `index.v2.json` 由该仓库的 `registry.json`（登记）+ `approvals.json`（批准的具体安装包）算出。收录 = 向上游提一个 PR，同时改这两个文件；维护者审核合并后，工作流重新生成索引，客户端才能发现。

登记前必须先满足（逐条对应市场同步器的校验）：

1. 自己的仓库有一个**正式 Release**（非草稿、非预发布），同一 Release 里带两个资产：
   - `app-shiyi-<版本>.entry.json`（app 类固定命名；Release 里必须**恰好一个**匹配 `app-shiyi-*.entry.json` 的资产）
   - ZIP 资产，**文件名必须等于**条目里 `archive.url` 指向的名字（即 `app-shiyi-<版本>.zip`）
2. 条目由官方打包器产出：`kind`/`id`/`publisher` 必须与登记一致，`version` 是语义化版本，`archive.sha256` 是 64 位小写 hex。
3. `registry.json` 的条目字段只能是 `kind` / `id` / `repository` / `publisher`，`repository` 写 `owner/repository`（不是 URL）。
4. `approvals.json` 的记录字段只能是 `kind` / `id` / `tag` / `sha256` / `readme`（`readme` 可选但建议给：非空 Markdown、≤2 MiB，随 PR 审核后写进索引，商店不再活取作者仓库的 URL）。

写法：

```json
// registry.json → entries
{ "kind": "app", "id": "shiyi", "repository": "Britneycode/shiyi", "publisher": "Britneycode" }
// approvals.json → approvals
{ "kind": "app", "id": "shiyi", "tag": "v<版本>", "sha256": "<条目 JSON 里 archive.sha256 的值>", "readme": "…" }
```

一次 PR 只登记一个扩展；不要手改 `index.v2.json`。发布是整批原子更新：任一新批准包校验失败，整批不发布。

以后每次更新都是同一个流程：发新 Release（带新的 entry JSON 与 ZIP）→ 提 PR 改 `approvals.json` 里的 `tag` 与 `sha256` → 审核合并后上架。市场不会自动发现新版本，目录更新也不会自动替用户安装。审核不通过不影响上面的自定义源。
