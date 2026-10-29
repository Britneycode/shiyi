# 拾遗 (shiyi) — HanaAgent v2 应用

> HanaAgent v2 的记忆应用：在拾遗里和你的 Hana 助手聊天，助手自己记下你手上的事，到期**主动**来问一句进度；真要动手时，一键把上下文交给 Hana 主对话。

[![status](https://img.shields.io/badge/tests-147%2F147-brightgreen)]() [![node](https://img.shields.io/badge/node-%E2%89%A522-blue)](https://nodejs.org)

---

## 目录

- [这是什么](#这是什么)
- [面板长什么样](#面板长什么样)
- [快速开始](#快速开始)
- [目录结构](#目录结构)
- [核心机制](#核心机制)
- [API 一览](#api-一览)
- [设计红线](#设计红线)
- [开发与测试](#开发与测试)
- [文档路由](#文档路由)

---

## 这是什么

拾遗是一个 HanaAgent v2 **应用**（HanaAgent v2 应用格式），只做三件事：

1. **陪聊，并自己记**：面板里只有「左助手 + 中聊天」。对话中助手按提取 prompt 把你手上的事与知识记进 Markdown 真相源（index.json 派生缓存 + 启动对账）。没有手动建卡片的列表，也不需要你整理——记什么、记多少由助手判断。
2. **主动跟进**（7 由头、10 道护栏）：到期问一句「那件事后来怎么样了？」——分项预算防烧钱、没回不追、安静时段顺延、投递前重查防打扰；「到时提醒」是准点承诺（remind），「看着办」给模糊窗口（auto），两者严格分离。
3. **交接给主对话**（handoff）：面板内一键交给 Hana 主对话开新会话，`session:create → update → send`，结果回流；**必须用户点确认**才发。

另有一层养成感：顶栏的「认识 N 天 · 聊 M 条 · 记 K 条」、助手的心情与「幕间生活」、拿不准的记忆标「（猜测）」、回复逐字流式出现。

## 面板长什么样

```
┌──────────────┬───────────────────────────────────────────────┐
│ 助手列表 216px │  助手名 · 模型 · 心情 · 认识 N 天 · 聊 M 条 · 记 K 条 │
│              │                                               │
│  ● 小满       │  对话（助手气泡融入画布，用户气泡浅底）           │
│  ○ 阿澈       │                                               │
│              │                                               │
│              ├───────────────────────────────────────────────┤
│              │  [ 输入框 ]                         [发送]      │
└──────────────┴───────────────────────────────────────────────┘
```

- 视口 ≤900px 左栏收窄、≤640px 切单栏小窗（宿主 route 不接受 query，小窗形态按视口宽度判定，`?form=mini` 仍兼容）。
- 齿轮打开设置页 `ui/settings.html`：iframe 内嵌，主题走 `?hana-theme`、会话走 `?appSurfaceSession`，关闭由页内 `postMessage({type:'shiyi:close-settings'})` 回传，面板据此整页刷新。
- 输入框 `field-sizing: content` 自适应高度，Enter 发送、Shift+Enter 换行，IME 合成期不误发。
- 滚动容器边缘挂 7 档非线性渐隐；加载态用三点跳跃（面板）与骨架屏（设置页）。

## 快速开始

### 前置

- Node ≥ 22（开发验证用 Node 24）。
- HanaAgent v2 宿主会扫描 `apps/` 并以 `ctx` 注入数据目录、bus、模型与横幅。

### 安装（无需构建）

零外部依赖，原生 ES Module。把整个 `shiyi/` 目录放到 HanaAgent v2 的 `apps/` 下即可（若以独立仓库分发，`git clone` 到 `apps/shiyi`）。

### 从宿主市场安装（可自动提示更新）

HanaAgent 设置 → 扩展 → 浏览市场 → 来源 → 添加来源，填：

| 字段 | 值 |
|---|---|
| 名称 | 拾遗 |
| 地址 | `https://raw.githubusercontent.com/Britneycode/shiyi/main/market/index.v2.json` |

（raw 取不到时改用 `https://cdn.jsdelivr.net/gh/Britneycode/shiyi@main/market/index.v2.json`。）

然后在市场里装拾遗：宿主里若已有本地装的同名应用，页面上会出现「用市场版本替换」，用它替换；没有就点「安装」，只需一次确认。

**从市场源装过之后**，以后发新版本时宿主会在市场页提示「可更新」，点更新、确认一次即就地覆盖安装（失败自动回滚），用户数据不受影响。纯本地 zip 安装的实例没有这条通道 —— 宿主的更新只认市场来源的安装记录。

### 启动与验收

```bash
node --test tests/*.test.js
```

预期输出：**147 pass**。

### 配置

首开面板自动弹 3 步引导（学习来源 → 主动程度档位 → 完成）。设置页可随时调整，写 `PATCH /api/settings`（支持点号键）：

| 设置项 | 默认 | 说明 |
|---|---|---|
| `proactive.enabled` | `true` | 主动关心总开关（关闭不影响 remind 准点提醒） |
| `proactive.preset` | `restrained` | 克制 / 适中 / 积极（dailyCap 3/6/12，minGap 120/60/30 分钟；手改这两项后 preset 记为 `custom`） |
| `proactive.dailyCap` | `3` | 「实际投递」日上限 |
| `proactive.quiet` | `23:00–08:00` | 安静时段（remind 仅顺延到次日允许时段） |
| `proactive.noChaseUnanswered` | `true` | 没回不追（第 2 次投递后 `unanswered>=2` → 该事项转 off） |
| `memory.learnFromMain` | `false` | 是否从 Hana 主对话提取（引导里明示，默认关） |
| `hiddenAgentIds` | `[]` | 收起的助手；不动宿主 profile 与记忆，设置页可恢复 |

## 目录结构

```
shiyi/
├── manifest.json            # HanaAgent v2 app 清单（realization:"page"、siteNavEntry）
├── routes/ui.js             # 24 REST 端点（{ ok, code, message } 统一信封）
├── lib/
│   ├── settings.js          # settings.json 原子写（tmp→rename + .bak）
│   ├── threads.js           # 会话历史（含流式增量 appendDelta / currentTurn）
│   ├── chat.js              # 一轮对话：buildSystem → 模型 → 工具往返 → 落盘
│   ├── model.js             # 模型调用；NDJSON 流式 onDelta 增量回调
│   ├── prompts.js           # 系统提示分块（人设 / 记忆 / 预算 / 幕间状态）
│   ├── agent-state.js       # 每助手 mood / dwelling 规则演化（冷却 6h）
│   ├── handoff.js           # 交接卡：createCard/confirm/cancel → session:create/update/send
│   ├── tools-host.js        # 主对话工具（main 放行；ch_/dm_/外部拒绝不泄密）
│   ├── memory/
│   │   ├── extract.js       # 提取（每条消息带 [MM-DD HH:mm] 原始时间）
│   │   ├── markdown.js      # 事 / 知 的 Markdown 真相源编解码（含 belief）
│   │   ├── repo.js          # Markdown + index.json 派生缓存
│   │   ├── dedupe.js        # L3.5 冲突不合并
│   │   └── recall.js        # 情境检索
│   └── proactive/
│       ├── engine.js        # 主动引擎（5min tick、停机补发、分项预算）
│       ├── gate.js          # 10 道护栏
│       └── banner.js        # 输入框横幅（在场租约 75s、30s 批次、回执摘横幅）
├── ui/
│   ├── panel.html / panel.css / panel.js   # 两栏整页 | 窄窗自动切小窗
│   └── settings.html        # 设置页（面板齿轮 iframe 打开）
├── tests/                   # node:test；helpers.js 提供 fakeCtx/tmpdir
├── PLAN.md                  # 规格（后端逻辑、数据模型、API、验收用例）
└── AGENTS.md                # AI 接手协议
```

## 核心机制

### 记忆：事 / 知

- **事 (thing)**：手上的事。`{id, title, area, status, followUp, followUpAt, dueAt, snoozedUntil, owner, now, next, logs, source…}`
- **知 (note)**：知识卡片。`{id, title, kind, content, tags, keywords, related, source…}`
- `belief: stated | inferred`——拿不准的不硬记，标 `inferred`，「（猜测）」，之后被明确说法覆盖时只许 stated 升级 inferred，反向不动。
- L3.5 冲突不合并：数字 / 否定 / 日期 / 版本冲突 → 新建互记 related。
- 删除写 `exclusions.json`，重启或回填不会再提取回来。
- 证据 ≤60 字；提取 prompt 每条消息带原始时间，相对日期按消息自身时间换算。

### 主动引擎（PLAN §4.8）

- 5 分钟 tick（boot 后 90s 首检），分项预算 `evaluated(×4)/generated(×2)/sent`；SKIP 冷却 2h。
- 7 由头：`remind_due / followup_due / handoff_result / recent_work / followup_stale / study_review / chitchat`。
- 10 面护栏（gate.js）：禁总开关 / 类别开关 / 预算 / 冷却 / quiet / 没回不追 / 在场（75s 租约 + 回执）/ snooze / stale_dropped 投递前重查。
- 停机补发：boot 时合并逾期 ≤24h 事项为**一条**（按 owner 分组）。
- snooze 都有 REST 且落盘：全局「稍后再说」→ `POST /api/proactive/snooze`（写 `proactive-state.json` 的 `globalSnoozeUntil`，`hours<=0` 即恢复）；对话内「这件先不问了」→ `POST /api/things/:id/snooze`。只作用于 auto，不影响 remind。

### 交接（handoff）

- 面板聊天里产出的交接卡：`pending → sending → sent | failed | cancelled`。
- `confirm` 才发：`session:create`（必须返回 sessionId+sessionPath）→ `session:update`（失败忽略）→ `session:send`。
- 失败退化为「复制需求」，denied 文案区分。

### 养成感

- 顶栏统计行：认识多久（首条消息起）+ 现存与归档消息数 + 归属于该助手的记忆条数。
- 幕间生活：`lib/agent-state.js` 给每个助手维护 `{mood, dwelling, lastEvolvedAt}`，规则演化冷却 6h，挂在 engine tick 上。
- 流式打字机：模型增量（`model.js` 的 `onDelta`）→ `threads.appendDelta` 累加瞬态 → 面板 700ms 轮询 `GET /api/threads/:agentId` 的 `generating` 字段做局部 DOM 更新。非 SSE（SSE 需宿主 `c.stream()` 支持，待真机 PoC）。

### 主对话工具（tools-host）

`shiyi.search / shiyi.track`——main 会话放行；`ch_`/`dm_` 前缀、外部访客一律「这里不能使用拾遗。」不泄密。

## API 一览

所有端点挂 `/api/apps/shiyi/routes`，返回 `{ ok:true, … }` 或 `{ ok:false, code, message }`；请求带 `X-Hana-App-Surface-Session` 头。共 24 个端点。

| 分组 | 端点 |
|---|---|
| 总览 | `GET /api/overview`（agents + hiddenAgents + settings + caps + onboarded + budget + snoozedUntil） |
| 助手 | `GET /api/agents/:id/avatar`（占位）、`POST /api/agents/:id/refresh`、`/hide`、`/unhide` |
| 线程 | `GET /api/threads/:agentId`（含 `generating`）、`POST …/messages`、`…/retry`、`…/cancel`、`…/read`、`DELETE` |
| 事 | `POST /api/things/:id/snooze`（对话内「这件先不问了」） |
| 主动 | `POST /api/proactive/snooze`（全局「稍后再说 / 恢复」） |
| 交接 | `POST /api/handoffs/:id/confirm`、`/cancel` |
| 系统 | `GET/PATCH /api/settings`、`POST /api/onboarding`、`/presence`、`/memory/clear`、`/reindex`、`GET/DELETE /api/mainfeed`、`GET /api/diagnostics` |

v0.1.6 起移除手动增删改查：`/api/things` 写操作、`/api/notes`、`/api/search`、`/api/recent`、`/api/upcoming`。记忆写入只剩「模型自己记」一条路径（`lib/*` 直连 `repo.*`，不依赖 HTTP 路由）。

## 设计红线（摘自 PLAN.md）

1. 装载期隔离：apply 只做 typeof 探测 + 注册 + unref 定时器；受保护调用全在异步 boot()，try/catch 入口 caps 降级。
2. 存储原子写（tmp→rename + .bak），Markdown 真相源 + index.json 派生缓存 + 对账，证据 ≤60 字。
3. 提取 prompt 每条消息带原始时间 [MM-DD HH:mm]。
4. L3.5 冲突不合并，新建互记 related；`inferred` 只在被明确说法覆盖时升级为 `stated`。
5. 删除写 exclusions.json 防回填。
6. followUp="remind"（准点必发，仅安静时段顺延）与 followUp="auto"（10 道护栏、模糊窗口）严格分离。
7. 分项预算 evaluated(×4)/generated(×2)/sent；SKIP 冷却 2h；禁止责备语气。
8. 投递前重查 stale_dropped；「稍后再说」全局 snooze、「这件先不问了」事项 snooze，都只作用 auto。
9. handoff 必须用户点确认；失败退化复制。
10. 主对话工具对 ch_/dm_/外部访客一律拒绝不泄密。

## 开发与测试

```bash
node --test tests/*.test.js
```

`node --test` → **147/147 pass**（覆盖存储 / 提取 / 检索 / 主动引擎与护栏 / 路由契约 / 流式增量 / 宿主契约）。前端不引入构建链，原生 ES Module + 事件委托，行为验收方式见 `PLAN.md §4.14`；发版与市场索引流程见 `RUNBOOK.md`。

## 文档路由

- `PLAN.md`：规格（后端逻辑、数据模型、API、验收用例）。
- `AGENTS.md`：AI 接手协议（检索优先，禁全量读 history/）。
- `NOW.md`：当前状态、停留位置与 Next Steps。
- `RUNBOOK.md`：可跑命令（打包、发版、市场索引）。
- `PROJECT_INDEX.md`：入口路由（≤4KB）。
- `CHANGELOG.md`：里程碑与变更记录。