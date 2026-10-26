# CHANGELOG — 拾遗 (shiyi)

## v0.1.5（2026-10-26）

- 面板布局修复（真机约 936 CSS px 视口下三栏被挤坏）：
  - 右栏原在 >900px 时占 328px 固定列，中栏只剩约 390px。改为 **1120px 以下右栏不再占列**，而是按需展开的覆盖式抽屉；默认收起，`resize` 跨断点时联动。1440px 及以上仍是 v9 的三栏。
  - 顶栏助手名加 `white-space: nowrap`，模型 badge 限宽省略号，不再把助手名压成竖排；顶栏按钮从「事 (N) · 知 (M)」长文案改为图标 + 计数，去掉与右栏分段标签的重复。
  - 「刚记下 / 接下来」轻入口 pills 不再内部换行，整条轻入口允许换行，右侧「今天先别问」不再被挤出可视区。
  - 输入框补 `min-width: 0`（flex 子项默认 `min-width:auto` 会把 min-content 当下限），placeholder 缩短，不再被竖切。
- 验证：浏览器 mock 接口实测 936 / 1100 / 1440 CSS px 与 `?form=mini` 的排版；`node --test tests/*.test.js` → 149/149。真机窗口复验待新包安装。

## v0.1.4（2026-10-26）

- 修复宿主内助手信息读取：`agent:profile` 补 `scope: "all"`。此前只传 `agentId`，宿主默认按本 App 的 `own` 范围查找，其他助手会报「does not belong to app shiyi」，模型与记忆设置因此读不到。新增宿主契约回归测试，`node --test tests/*.test.js` → **149/149 pass**。
- 真机若仍显示「还没有助手」，先确认安装版本：v0.1.0 的路由按 Express 写，宿主日志为 `res.json is not a function`，`/api/overview` 无有效响应；v0.1.1 起已修复，本版包含全部相关修正。

## v0.1.3（2026-10-26）

- 出包方式改为宿主自带的官方打包器 `extension-pack.mjs`，产物 `app-shiyi-0.1.3.zip` 与官方市场收录要求的条目格式一致；自定义源索引与未来市场收录因此共用同一份字节（同一个 sha256）。
- 包内代码与 v0.1.2 相同，仅 `manifest.json` 的 `version` 变更为 `0.1.3`（另同步 `package.json`）。v0.1.2 的资产保留，与 v0.1.1 一样作废，请用本版本。
- 宿主 `validate-app.mjs --archive` → **0 error**（1 warning：动态依赖无法静态证明，属已知）；`node --test tests/*.test.js` → **148/148 pass**。

## v0.1.2（2026-10-26）

- 前端会话凭证：宿主把本应用的 surface 会话放在 iframe URL 的 `appSurfaceSession` 参数里（`X-Hana-App-Surface-Session` 头回传），原代码只认 `hana-surface-session`/`session`，面板拿不到凭证。已按宿主 APPS.md「鉴权两通道」修正。
- v0.1.1 的包不含此修正，请用本版本。

## v0.1.1（2026-10-26）

- 路由契约修复：`routes/ui.js` 原按 Express 形状写（`req`/`res` + `res.json`），宿主是 Hono（handler 只收一个 context，响应走 `c.json`），真机上全部端点 500（`res.json is not a function`）。改写后 35 个端点行为不变。
- 新增 `tests/routes.test.js`（13 例）：按宿主同款 Hono 契约覆盖路由层，填补装配层测试盲区。`node --test tests/*.test.js` → **148/148 pass**。
- 打包脚本产出的包名跟随 manifest 版本，不再手写文件名。

## v0.1.0（2026-10-26）

首版交付，按 PLAN.md v9 的 4 个里程碑全量落地。`node --test tests/*.test.js` → **135/135 pass**。

### Step 1 · P1 + 存储层（46/46）
- `lib/settings.js`：settings.json 原子写（tmp→rename + .bak）。
- `lib/threads.js`：会话历史 append/list/read/clear；消息形状 `{seq, role, text, at, clientId?, meta?}`；unread 只计 assistant/proactive。
- `lib/memory/repo.js` + `exclusions.js`：Markdown 真相源 + index.json 派生缓存；删除写排除记录防回填；证据 ≤60 字。

### Step 2 · P2+P3+P4（116/116）
- `lib/memory/extract.js`：提取 prompt 每条消息带 `[MM-DD HH:mm]` 原始时间，相对日期按消息自身时间换算；L3.5 数字/否定/日期/版本冲突不合并、新建互记 related。
- `lib/memory/reconcile.js`：启动对账 Markdown↔index。
- `lib/memory/recall.js`：情境检索。
- `lib/tools-host.js`：主对话工具 main 放行；ch_/dm_/外部访客一律拒绝不泄密。

### Step 3 · P5+P6+P7（135/135）
- `lib/proactive/engine.js`：5min tick + 90s 首检；7 由头；分项预算 evaluated(×4)/generated(×2)/sent；SKIP 冷却 2h；停机补发 ≤24h 按 owner 合并一条；「没回不追」第 2 次投递后 unanswered>=2 → 该事项转 off；askNow 不受上限；snoozeThing(72h/0 恢复)。
- `lib/proactive/gate.js`：10 道护栏（rule 6 语义修正：unanswered>=2 拒；followup_due/recent_work && unanswered===1 放行）。
- `lib/proactive/banner.js`：输入框横幅——activeSessionPath 跟 turn_start、75s 在场租约、`plugin-v2:shiyi:banner` 回执、30s 批次。
- `lib/handoff.js`：交接卡（createCard 即记，10 分钟重复判定）；confirm → session:create（必须 sessionId+sessionPath）→ update → send；失败退化「复制需求」，denied 文案区分。

### Step 4 · P8+P9（本步）
- `routes/ui.js`：34 个 REST 端点，统一 `{ok,code,message}` 信封，`BASE=/api/apps/shiyi/routes`，自动扫描 `registerRoutes(app, ctx)`。
- `ui/panel.html / panel.css / panel.js`：v9 原型改造为真接口驱动——三栏整页 + 并排小窗（宿主 route 不接受 query，小窗形态按视口宽度 ≤640px 判定，`?form=mini` 仍兼容）；宿主主题接入 applyHostTheme + detectTone；明暗 token 来自 DESIGN.md。
  - 「刚记下」从 `updatedAt`（24h 内）派生，「接下来」从 `followUp/followUpAt/snoozedUntil` 派生——不依赖后端不存在的前端专用字段（fuzzyWindow/exactRemindText/recentOp/windowKey 裁决为客户端派生）。
  - 主动消息 badge 用 REASON_LABELS 客户端映射；气泡按空行拆；交接卡走 `/api/handoffs/:id/confirm|cancel`。
- README.md、CHANGELOG.md 首版；`node --test tests/*.test.js` 全量验收通过。

### 宿主适配修复（安装前）
- 安装包：条目名须用 `/` 分隔。宿主解包器 `yauzl`（`strictFileNames:true`）拒绝含 `\` 的条目名，`Compress-Archive` 打的包会被判 `INSTALL_ARCHIVE_INVALID`。改用 `tools/pack.ps1`（.NET `ZipArchive`）。
- 卡片图标：宿主的 `face.image` / `pageIcon` 相对 **app 目录下的 `ui/`** 解析（应用级 `icon` 才相对包根）。图标移入 `ui/assets/`，manifest 中应用级 `icon` 改为 `ui/assets/icon.svg`。
- 卡片 route：宿主不接受含 query 的 route（`/panel.html?form=mini` 会被整卡丢弃）。两张卡统一用 `/panel.html`，小窗形态改由视口宽度判定。
- manifest 增 `minAppVersion: "0.1020.0"`：用了 `pageIcon` 与 `cardForm:"edge-to-edge"`，宿主要求声明该下限（PLAN D-003「不写 minAppVersion」据此修正）。
- 宿主自带 `scripts/validate-app.mjs` 复验：`--archive` → **0 error**（UI 冒烟需 Electron，本机不具备，未跑）。

### 已知限制（Step 4 裁决）
- routes 未暴露全局 snooze 端点（engine.snoozeAll 存在但无 REST）：前端「稍后再说」按钮仅作本地提示态，不持久化到引擎。
- routes 未暴露 handoff 建卡端点（lib/handoff.js 的 createCard 仅 confirm/cancel 有路由）：「交给 Hana」入口退化为在聊天输入框预填指令，由提取/工具流程产生确认卡。
- 前端无 node:test 覆盖（纯 DOM），验收方式见 PLAN.md §4.14。
