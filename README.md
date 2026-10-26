# 拾遗 (shiyi) — HanaAgent v2 应用

> HanaAgent v2 的记忆应用：在拾遗里与你的 Hana 助手聊天，助手记下你手上的事与知，到期**主动**来问一句进度；真要动手时，一键交接给 Hana 主对话。

[![status](https://img.shields.io/badge/tests-135%2F135-brightgreen)]() [![node](https://img.shields.io/badge/node-%E2%89%A522-blue)](https://nodejs.org)

---

## 目录

- [这是什么](#这是什么)
- [架构总览](#架构总览唯一真相源见-planmd)
- [快速开始](#快速开始)
- [目录结构](#目录结构)
- [核心机制](#核心机制)
- [API 一览](#api-一览)
- [设计红线](#设计红线)
- [开发与测试](#开发与测试)
- [文档路由](#文档路由)

---

## 这是什么

拾遗是一个 HanaAgent v2 **应用**（HanaAgent v2 应用格式），核心三件事：

1. **记事与知识卡片**（事/知模型）：从拾遗内聊天、（授权后）Hana 主对话提取事件与知识；Markdown 真相源 + index.json 派生缓存 + reconcile 对账。
2. **主动跟进引擎**（7 由头、10 道护栏）：到期自动问一句「那件事后来怎么样了？」——分项预算防烧钱、没回不追、安静时段顺延、stale_dropped 重查防打扰；「到时提醒」是准点承诺（remind），「看着办」给模糊窗口（auto），两者严格分离。
3. **交接给主对话**（handoff）：面板内一键交给 Hana 主对话开新会话，`session:create → update → send`，结果回流；**必须用户点确认**才发。

## 架构总览（唯一真相源见 PLAN.md）

```
                        ┌──────────────────┐
                        │   HanaAgent v2   │
                        │  (app manifest)  │
                        └────────┬─────────┘
                                 │ ctx{dataDir, logger, bus, models, inputBanner…}
                                 ▼
   ui/panel.html + panel.css + panel.js    ← 三栏整页 / 并排小窗（视口 ≤ 640px 自动切小窗）
                                 │ REST + X-Hana-App-Surface-Session
                                 ▼
                         routes/ui.js (35 端点)
                                 │
        ┌───────────┬────────────┼───────────────┬─────────────┐
        ▼           ▼            ▼               ▼             ▼
  lib/settings  lib/memory/*  lib/threads   lib/proactive/*  lib/handoff.js
  (持久化)      (事/知提取+reconcile) (会话历史) (主动引擎+gate+banner)  (交接卡)
        │
        └─ lib/tools-host.js ← 主对话工具（main 会话放行，ch_/dm_/外部一律拒绝不泄密）
```

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

预期输出：**135 pass**（见 CHANGELOG 的分步里程碑）。

### 配置

首开面板自动弹 3 步引导（学习来源 → 主动程度档位 → 完成）。设置面板可随时调整：

| 设置项 | 默认 | 说明 |
|---|---|---|
| `proactive.enabled` | `true` | 主动关心总开关（关闭不影响 remind 准点提醒） |
| `proactive.preset` | `restrained` | 克制/适中/积极（dailyCap 3/6/12，minGap 120/60/30 分钟） |
| `memory.learnFromMain` | `false` | 是否从 Hana 主对话提取（引导里明示，默认关） |
| `memory.learnFromChat` | `提取 prompt` 控制 | 每条消息带原始时间换算相对日期；数字/否定/日期/版本冲突不合并（L3.5） |
| `proactive.quiet` | `23:00–08:00` | 安静时段（remind 仅顺延到次日允许时段） |
| `proactive.noChaseUnanswered` | `unanswered>=2 → off` | 没回不追 |
| `proactive.dailyCap` | `3` | 「实际投递」日上限 |

## 目录结构

```
shiyi/
├── manifest.json            # HanaAgent v2 app 清单（realization:"page"、siteNavEntry）
├── routes/ui.js             # 34 REST 端点（{ ok, code, message } 统一信封）
├── lib/
│   ├── settings.js          # settings.json 原子写（tmp→rename + .bak）
│   ├── threads.js           # 会话历史（append/list/read/clear，消息形状 {seq,role,text,at,meta?}）
│   ├── handoff.js           # 交接卡：createCard/confirm/cancel → session:create/update/send
│   ├── tools-host.js        # 主对话工具（main 放行；ch_/dm_/外部拒绝不泄密）
│   ├── memory/
│   │   ├── extract.js       # 提取 prompt（每条消息带 [MM-DD HH:mm] 原始时间）
│   │   ├── prompt.js        # L3.5 冲突不合并规则
│   │   ├── repo.js          # Markdown 真相源 + index.json 缓存 + reconcile
│   │   ├── reconcile.js     # 启动对账
│   │   ├── exclusions.js    # 删除写排除记录，防回填
│   │   └── recall.js        # 情境检索（FP 防错）
│   └── proactive/
│       ├── engine.js        # 主动引擎（5min tick、停机补发、分项预算）
│       ├── gate.js          # 10 道护栏
│       └── banner.js        # 输入框横幅（在场租约 75s、30s 批次、回执摘横幅）
├── ui/
│   ├── panel.html / panel.css / panel.js   # 三栏整页 | 窄窗自动切小窗
├── tests/                   # node:test；helpers.js 提供 fakeCtx/tmpdir
├── PLAN.md                  # v9 规格（唯一真相源，1162 行）
└── AGENTS.md                # AI 接手协议
```

## 核心机制

### 事/知双模型

- **事 (thing)**：手上的事。`{id, title, area, status, followUp, followUpAt, dueAt, snoozedUntil, owner, now, next, logs, source…}`
- **知 (note)**：知识卡片。`{id, title, kind, content, tags, keywords, related, source…}`
- L3.5 冲突不合并：数字/否定/日期/版本冲突 → 新建互记 related。
- 删除写 `exclusions.json`，重启或回填不会再提取回来。

### 主动引擎（PLAN §4.8）

- 5 分钟 tick（boot 后 90s 首检），分项预算 `evaluated(×4)/generated(×2)/sent`；SKIP 冷却 2h。
- 7 由头：`remind_due / followup_due / handoff_result / recent_work / followup_stale / study_review / chitchat`。
- 10 面护栏（gate.js）：禁总开关/类别开关/预算/冷却/quiet/没回不追/在场（75s 租约 + 回执）/snooze（全局 4h、事项 3 天）/stale_dropped 投递前重查。
- 停机补发：boot 时合并逾期 ≤24h 事项为**一条**（按 owner 分组）。
- 「没回不追」：第 2 次投递后 `unanswered>=2` → 该事项转 `followUp: off`。

### 交接（handoff）

- 面板聊天里产出的交接卡：`pending → sending → sent | failed | cancelled`。
- `confirm` 才发：`session:create`（必须返回 sessionId+sessionPath）→ `session:update`（失败忽略）→ `session:send`。
- 失败退化为「复制需求」，denied 文案区分。

### 主对话工具（tools-host）

`shiyi.search / shiyi.track`——main 会话放行；`ch_`/`dm_` 前缀、外部访客一律「这里不能使用拾遗。」不泄密。

## API 一览

所有端点挂 `/api/apps/shiyi/routes`，返回 `{ ok:true, … }` 或 `{ ok:false, code, message }`；请求带 `X-Hana-App-Surface-Session` 头。

| 分组 | 端点 |
|---|---|
| 总览 | `GET /api/overview`（agents+settings+caps+budget+justNow+upcoming） |
| 线程 | `GET/POST /api/threads/:agentId(+/messages|/read|DELETE)`、retry/cancel |
| 事 | `GET/POST /api/things`，`GET/PATCH/DELETE /api/things/:id`，`POST /api/things/:id/ask-now`、`/snooze` |
| 知 | `GET/POST /api/notes`，`GET/PATCH/DELETE /api/notes/:id` |
| 检索 | `GET /api/recent`、`GET /api/upcoming`、`GET /api/search?q=` |
| 交接 | `POST /api/handoffs/:id/confirm`、`/cancel` |
| 系统 | `GET/PATCH /api/settings`、`POST /api/onboarding`、`POST /api/presence`、`GET/DELETE /api/mainfeed`、`POST /api/memory/clear`、`POST /api/reindex`、`GET /api/diagnostics` |

## 设计红线（摘自 PLAN.md）

1. 装载期隔离：apply 只做 typeof 探测+注册+unref 定时器；受保护调用全在异步 boot()，try/catch 入口 caps 降级。
2. 存储原子写（tmp→rename + .bak），Markdown 真相源 + index.json 派生缓存 + reconcile 对账，证据 ≤60 字。
3. 提取 prompt 每条消息带原始时间 [MM-DD HH:mm]。
4. L3.5 冲突不合并，新建互记 related。
5. 删除写 exclusions.json 防回填。
6. followUp="remind"（准点必发，仅安静时段顺延）与 followUp="auto"（10 道护栏、模糊窗口）严格分离。
7. 分项预算 evaluated(×4)/generated(×2)/sent；SKIP 冷却 2h；禁止责备语气。
8. 投递前重查 stale_dropped；「稍后再说」全局 snooze 4h、「这件先不问了」事项 snooze 3 天，只作用 auto。
9. handoff 必须用户点确认；失败退化复制。
10. 主对话工具对 ch_/dm_/外部访客一律拒绝不泄密。

## 开发与测试

```bash
node --test tests/*.test.js
```

按 PLAN 的 4 个里程碑分步交付：

| 里程碑 | 内容 | 测试 |
|---|---|---|
| Step 1 | P1+存储层（settings/threads/repo/exclusions） | 46/46 |
| Step 2 | P2+P3+P4（提取/reconcile/recall/threads/主对话工具） | 116/116 |
| Step 3 | P5+P6+P7（主动引擎/gate/banner/handoff） | 135/135 |
| Step 4 | P8+P9（前端 panel + 文档 + 验收） | 135/135（前端无自动化测试，见 §4.14） |

前端不引入构建链，原生 ES Module + 事件委托。前端行为验收方式见 `PLAN.md §4.14`。

## 文档路由

- `PLAN.md`：规格唯一真相源（后端逻辑、数据模型、API、验收用例）。
- `AGENTS.md`：AI 接手协议（检索优先，禁全量读 history/）。
- `NOW.md`：当前状态、停留位置与 Next Steps。
- `MAP.md`：目录结构映射（存在时）。
- `RUNBOOK.md`：可跑命令（存在时）。
- `PROJECT_INDEX.md`：入口路由（≤4KB）。
- `CHANGELOG.md`：里程碑与变更记录。
