# CHANGELOG — 拾遗 (shiyi)

## v1.0.0（2026-10-26）

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
- `ui/panel.html / panel.css / panel.js`：v9 原型改造为真接口驱动——三栏整页 + `?form=mini` 并排小窗；宿主主题接入 applyHostTheme + detectTone；明暗 token 来自 DESIGN.md。
  - 「刚记下」从 `updatedAt`（24h 内）派生，「接下来」从 `followUp/followUpAt/snoozedUntil` 派生——不依赖后端不存在的前端专用字段（fuzzyWindow/exactRemindText/recentOp/windowKey 裁决为客户端派生）。
  - 主动消息 badge 用 REASON_LABELS 客户端映射；气泡按空行拆；交接卡走 `/api/handoffs/:id/confirm|cancel`。
- README.md、CHANGELOG.md 首版；`node --test tests/*.test.js` 全量验收通过。

### 已知限制（Step 4 裁决）
- routes 未暴露全局 snooze 端点（engine.snoozeAll 存在但无 REST）：前端「稍后再说」按钮仅作本地提示态，不持久化到引擎。
- routes 未暴露 handoff 建卡端点（lib/handoff.js 的 createCard 仅 confirm/cancel 有路由）：「交给 Hana」入口退化为在聊天输入框预填指令，由提取/工具流程产生确认卡。
- 前端无 node:test 覆盖（纯 DOM），验收方式见 PLAN.md §4.14。
