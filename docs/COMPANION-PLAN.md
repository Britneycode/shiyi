# COMPANION-PLAN — 拾遗"养成感"改造规划

> 经 /grill-me 17 轮收敛。目标：在 HanaAgent 框架内、走宿主模型通道，把拾遗养成"一个活着的助手"。
> 参照系：HDS-Interlude（叙事派：角色有自己的幕间生活）+ dsh 养成插件系（人格/记忆/关系/信念闭环）。
> 红线不变：零业务逻辑破坏、不引依赖、不动品牌色、模型推理走宿主。

---

## 已锁定的设计决策

| 编号 | 决策 | 结论 |
|---|---|---|
| Q2/Q3 | 能力 vs 形态 / 模型通道 | 只做能力；模型走宿主，不自建 key |
| Q7 | 单/多助手 | 延续多助手，关系/记忆 per-agent 隔离 |
| Q9 | 删助手 | **软删**：settings.hiddenAgentIds 隐藏，可恢复；记忆清除走独立按钮，不捆绑 |
| Q10 | 关系进度 | **叙事派为主**：统计行（认识 N 天·聊 M 条·记 K 条）为辅，不做好感度数值条 |
| Q11 | 关系演化驱动 | 互动驱动，不用模型自评 |
| Q12 | 呈现层活物感 | prompt 层拟人（模型自加语气/表情）+ 头像状态视觉暗示；流式打字机独立阶段 |
| Q14 | 数值 vs 叙事 | 叙事派（HDS 路线），数值只保留统计行 |
| Q15 | 幕间生活 | **落地极轻量**：每助手存 `state:{mood, dwelling}`，proactive tick 慢演化，注入 prompt |
| Q16/Q17 | 信念层 | **只做推断标记，不做数值**：memory 区分「用户说的」/「它推断的（猜测）」，无 confidence、无衰减 |

---

## 四批落地（顺序已定，逐批浏览器实测）

### 批 1 · 关系统计行 ✅ 已落地（2026-10-27）
- 面板 chat-head `.chat-agent-meta` 末尾加 `.chat-stats`：`认识 N 天 · 聊 M 条 · 记 K 条`（fs-hint + text-2 + tabular-nums）
- 数据源：新增 `threads._stats(agentId)`（lib/threads.js，首条 `at` 含归档首行、msgCount=现存+归档行数）；`routes/ui.js` `/api/overview` 循环注入 `a.stats`（knownDays 由 firstAt 推，memoryCount 过滤 thing 的 owner/agents，note 无归属不计）
- 前端：`panel.js` loadAll map 多拷 `stats`、renderCenterCol 渲染 span
- 纯展示，零行为改动；已浏览器实测（stats 渲染/tabular-nums/排版完好）

### 批 2 · 助手软删 ✅ 已落地（2026-10-27）
- `settings.hiddenAgentIds: []`（config.js 默认值 + settings.js normalize 数组规整 + applyPatch 白名单）
- `/api/overview` 拆 `agents`（可见）+ `hiddenAgents`（已收起轻量 {id,name,yuan}）；隐藏项不进 stats 循环省 IO
- 端点：`POST /api/agents/:id/hide` / `unhide`（内部 settings.patch 整体改数组）
- 前端：agent-item 外层 button→div[role=option]，name-row 右侧 hover 显示 `.agent-hide-btn`（icon x）；hide 后 toast 带撤销（undoFn 调 unhide）；hide 当前 active 则切首个可见；设置模态加"已收起的助手（N）"组，每行恢复按钮
- 不动宿主 profile、不动记忆数据；已浏览器实测（收起/过滤/撤销/管理区/恢复全链路）

### 批 3 · 幕间生活 + 信念标记 ✅ 已落地（2026-10-27）
- **幕间生活**：新建 `lib/agent-state.js`——每助手 `<dataDir>/agent-state/<agentId>.json`（抄 threads per-agent 模式），字段 `{mood, dwelling, lastEvolvedAt}`；MOODS/DWELLINGS 轮换池，规则演化（不用模型），冷却 6h（`STATE_EVOLVE_COOLDOWN_MS`）；演化挂载 `engine.tick()` 的 `loadState` 后、`proactive.enabled` 检查**之前**（关主动也演化）；`prompts.js` 加第 4.5 块 `stateBlock`（nowBlock 后，`BUDGET_STATE=120`）；`chat.js buildSystem` 传 `agentState?.read(agentId)`；主动消息 `buildPrompt` 加【你此刻的状态】开场允许带"我刚才在……"
- **信念标记**：字段叫 `belief`（**不叫 kind**，note 的 kind 已占为分类）；`markdown.js` THING/NOTE_FM_ORDER 加 `belief`、normalizeThing/normalizeNote 兜底 `stated`、serialize 入参；`repo.js` thingRow/noteRow 索引行加 belief、createThing/createNote 透传、updateThing/updateNote 加 `belief==="stated"` 才升级（反向不动）；`prompts.js` EXTRACT_SYSTEM 加"三、来源标注"段+JSON 示例加 `"belief"`、"一律不记"的"助手不确定或在猜"放宽为"拿不准标 inferred，瞎猜不记"；`extract.js` new_thing/new_note/update_thing 三分支白名单读 belief（默认 stated）、new_note L3 去重时 `belief==="stated" && row.belief==="inferred"` 调 `repo.updateNote` 升级；`prompts.js` thingsBlock/notesBlock inferred 行加"（猜测）"后缀
- **前端透出**：`/api/overview` stats 循环同处加 `a.life = agentState?.read(a.id)`；`panel.js` loadAll map 加 `life`、chat-head stats 旁 `心情 ${mood}`（life null 时不渲染）
- **无 confidence、无衰减**（Q17-A 砍掉的）
- 149/149 全绿；已浏览器实测（chat-head 心情行渲染、life null 容错、stats 不被挤掉）

### 批 4 · 流式打字机（独立攻坚）
- 现状：POST messages 只回 {ok,turnId}，后台 schedule 生成，面板 loadThread 重拉
- 目标：面板边收边渲染（NDJSON/SSE 或轮询 turnId 增量）
- 涉及后端推流改造 + panel.js 渲染循环重写，**独立阶段，不裹进批 3**
- **改**：lib/chat.js 流式透出、routes/ui.js 推流端点、panel.js 渲染

---

## 明确不做

- 好感度数值条 / 等级 / 喂食 / 金币商城（dsh 游戏化路线，破坏沉浸感）
- confidence 数值与衰减（Q17-A 砍掉）
- Live2D/桌宠/语音（超宿主能力边界）
- 自建 LLM 通道 / 存 API key
- HDS 的日程系统/Alter 情绪氛围全家桶（只要 mood+dwelling 两字段）

## 验收锚点（每批做完核对）

- 批 1：统计行数字与实际数据一致；新助手显示"认识 0 天"不报错
- 批 2：软删后列表不显示、记忆仍在、可恢复；宿主 profile 无变化
- 批 3：聊几轮后助手状态有演化痕迹；推断记忆带"（猜测）"且与事实记忆冲突时让位；主动发言偶带幕间开场
- 批 4：回复逐字/逐段出现，无整段等待；中断重连不丢字
