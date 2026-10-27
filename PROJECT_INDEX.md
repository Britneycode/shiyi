# PROJECT_INDEX — Hana-plugin

> 全局路由表。所有接手本项目的 AI 模型：先读本文件，再按 AGENTS.md 的检索协议定位目标文档。**禁止遍历 history/。**

## 项目定位

**拾遗（shiyi）**— HanaAgent v2 app：聊天 + 记事（事/知卡片）+ 主动跟进 + 一键交给 Hana 主对话。
宿主：[openhanako (HanaAgent)](https://github.com/liliMozi/openhanako)，v2 app 格式（manifestVersion: 2）。
PLAN.md（v9，1162 行）为后端逻辑、存储、API 与验收用例的唯一真相源。

## 当前核心状态

- 阶段：v1.0.0 已交付（4 个里程碑全落地，135/135 pass）
- 进度焦点：见 [NOW.md](NOW.md)
- 阻塞点：无（前端无自动化测试为已知限制，见 CHANGELOG §Step 4）

## 文档路由表

| 文档 | 职责 | 何时读 |
|---|---|---|
| [AGENTS.md](AGENTS.md) | 交接协议与检索铁律 | **每次接手必读** |
| [NOW.md](NOW.md) | 当前进度 / 待办 / 阻塞 | 接续开发、核对排期时 |
| [PLAN.md](PLAN.md) | 拾遗 v9 规格（后端唯一真相源） | 写代码前 |
| [MAP.md](MAP.md) | 目录映射 / 同步边界 | 找不到代码位置时 |
| [RUNBOOK.md](RUNBOOK.md) | 运行 / 测试命令 | 执行验收前 |
| DECISIONS.md | 设计取舍（存在时再读） | 改架构、遇设计冲突前 |
| RISKS.md | 高危红线（存在时再读） | 执行敏感操作前 |
| docs/CDS-BRIDGE-P1/P2.md | CDS 桥接改造阶段规范（P0 在 docs/CDS-P0-验收指南.md） | 继续 CDS 改造或追溯已落地令牌时 |
| docs/COMPANION-PLAN.md | 养成感改造规划（17 轮 grill 收敛：叙事派+幕间生活+信念标记+软删，四批落地） | 做养成/助手管理/流式改造前 |
| history/ | 迭代复盘归档（冷数据） | 关键词搜索命中后局部读 |

## 核心模块路由

| 模块 | 路径 | 一句话职责 |
|---|---|---|
| 应用清单 | `manifest.json` | realization:page、siteNavEntry、panel.html 路由 |
| REST 路由 | `routes/ui.js` | 35 端点，`BASE=/api/apps/shiyi/routes`，统一 {ok,code,message} |
| 设置 | `lib/settings.js` | settings.json 原子写（tmp→rename + .bak） |
| 会话历史 | `lib/threads.js` | append/list/read/clear，meta 存 proactive/handoff |
| 记忆仓库 | `lib/memory/repo.js` | Markdown 真相源 + index.json 缓存 + reconcile 对账 |
| 提取 | `lib/memory/extract.js` | prompt 带 [MM-DD HH:mm]，L3.5 冲突不合并 |
| 排除 | `lib/memory/exclusions.js` | 删除写 exclusions.json 防回填 |
| 检索 | `lib/memory/recall.js` | 情境检索 |
| 主动引擎 | `lib/proactive/engine.js` | 5min tick、7 由头、分项预算、停机补发 |
| 护栏 | `lib/proactive/gate.js` | 10 道护栏 |
| 横幅 | `lib/proactive/banner.js` | turn_start 租约、75s、回执 |
| 交接 | `lib/handoff.js` | session:create/update/send，失败退化复制 |
| 主对话工具 | `lib/tools-host.js` | main 放行；ch_/dm_/外部拒绝不泄密 |
| 面板 | `ui/panel.html|.css|.js` | 三栏整页 / `?form=mini` 小窗，v9 原型改造 |

## 参考仓库（已对照实现）

| 仓库 | 用途 |
|---|---|
| [拾光记](https://github.com/moononnn/hanako-shiguangji-app) | routes/UI/面板会话头模式 |
| [茶话会](https://github.com/moononnn/Hanako-chahuahui) | bus.subscribe/models.utility/主动推送模式 |

## 防膨胀规则

- 本文件 ≤ 4KB。状态、架构、路由无实质变化时，**禁止改本文件（含日期）**。
- 新增文档 → 必须在此注册一行路由，否则视为不存在。
