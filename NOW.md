# NOW — 当前进度与焦点

> 接续开发前先读本文件。只记当前迭代的活信息，过期细节归档到 history/ 后从这里删除。

## 当前迭代

**面板砍成两栏纯聊天（已发 v0.1.6）**：删掉「事/知」右栏、顶部「刚记下 · 接下来」轻入口条与手动 CRUD API，工作区只剩 左助手 + 中聊天。记忆写入只剩「模型自己记」一条路径（`lib/*` 全部直连 `repo.*`，删 HTTP 路由不影响提取/主动联系）；`POST /api/things/:id/snooze` 保留给对话内「这件先不问了」。147/147 pass；浏览器 mock（1280/900/600px）实测两栏与窄屏降级。

## 已完成

- v0.1.6 发版：manifest/package 升 0.1.6 + CHANGELOG；官方打包器出 `app-shiyi-0.1.6.zip`（113690 B，sha256 `f440e126…`），宿主 `validate-app.mjs --archive` 0 error / 1 warning；Release `v0.1.6` 挂 zip + entry 两份资产（重下复算 sha256 与条目一致）；`market/index.v2.json` 由 `tools/market-index.mjs` 重建，与宿主 `extension-index-build.mjs` 结果 items 完全相等。
- 面板加载态接线 + 右栏遗留死 CSS 清理：面板启动态改用 `.sy-dots`（三点跳跃）、设置页初始加载改用三行 `.sy-skeleton` 扫光；删除两栏化后失效的 `.dot`/`.a-*`/`.k-*` 规则、`--sy-k-*` 浅/深两套令牌、`@keyframes sy-dot-breathe`、`.sy-breathe-dot` + `sy-clay-breathe`；去掉助手主动消息气泡在 `border: none` 下不生效的 `border-color`。147/147 pass；浏览器 mock 实测两处加载态确实出现（面板 3 点、设置页 3 骨架行→真实卡片），两页无控制台报错。
- CDS 第二轮样式落地（随 `6cd0a61` 提交）：`.agent-list`/`.chat-stream`/`.sy-scroll-fade` 换 7 档非线性遮罩；用户气泡 18px 圆角 + `--sy-primary`（=`--accent`）底、助手气泡零边框零背景；按钮 24/28/40 三级 + `.btn-outline`/`.btn-danger`；`.chat-textarea` 加 `field-sizing: content`；`.quick-chip` 去冗余边框；`.sy-skeleton`/`.sy-dots` 标准件入库，已接面板启动态与设置页加载态（见下条清理记录）。主色由青石蓝 `#537D96` 切陶土橙（浅 `#d97757` / 深 `#cc6b49`），决策记 DECISIONS D-004。逐项对照见 `docs/UI-AUDIT-CDS-ROUND2.md` 顶部状态表。
- 设置页接进面板（P2-3）：`ui/settings.html` 由骨架改为真页面，承接原面板设置模态的全部控件（分项预算 / 主动总开关·档位·没回不追 / 已收起助手 / 记忆与隐私·清除 / 搜索与 Bilibili 仍占位），自己取 `/api/overview`，写 `PATCH /api/settings`（点号键）、`POST /api/memory/clear`、`POST /api/agents/:id/unhide`；主题走 `?hana-theme` + 明暗探测，会话走 `?appSurfaceSession`。面板齿轮改开 `.settings-view` iframe（挂 body 上，不被 `render()` 重载），关闭由页内 `postMessage({type:'shiyi:close-settings'})` 回传并 `loadAll()` 刷新。删除面板内设置模态、`toggle-setting`/`change-preset`/`clear-all-memory`/`unhide-agent` 处理与 `refreshBudget`/`PRESET_LABELS`，首次引导模态保留。147/147 pass；`.preview/mock-api.py` 假后端实测「齿轮→改开关/档位→关闭→重开状态仍在」「收起助手→设置页恢复→关闭后面板回填」「midnight/light 两套令牌」。
- 全局「稍后再说」接后端：新增 `POST /api/proactive/snooze`（`hours<=0` 即恢复）→ `engine.snoozeAll()` 写 `proactive-state.json` 的 `globalSnoozeUntil`；引擎加 `snoozedUntil()` 读前确保磁盘状态已加载；`/api/overview` 带 `snoozedUntil`，`panel.js` 的 `loadAll()` 回填 `S.globalSnoozeUntil`，「稍后再说 / 恢复」改走接口。路由 24 端点，147/147 pass；浏览器 mock 实测「点击 → 刷新 → 横幅仍在 → 恢复」全链路。
- 面板两栏化 · 删除事/知面板 + 手动 CRUD：`routes/ui.js` 23 端点（删 `/api/things` 增删改查、`/api/notes` 全组、`/api/search`、`/api/recent`、`/api/upcoming`；`/api/overview` 不再返回 `justNow`/`upcoming`）；`ui/panel.js` 1671→~985 行（删右栏/抽屉/轻入口/新建事模态及其 30+ 点击分支、状态与 helper）；`ui/panel.css` 删右栏·轻入口·抽屉·`right-collapsed`·1120px 覆盖层规则，`.workspace` 改 `216px minmax(0,1fr)`；`tests/routes.test.js` 同步删 9 例增删改查契约（端点契约明确变更）。主动消息 `meta` 只有 `{reason,thingId}` 无标题，`关联：xxx` 链接一并移除，不为此留 things 端点。已浏览器 mock 实测（`.preview/panel-mock.html`）。
- 养成改造批 4 · 流式打字机（COMPANION-PLAN 批 4）：后端推流改造 + 前端渲染循环重写。`lib/model.js` `readStream` 加 `onDelta` 增量回调（NDJSON text-delta 边读边抛，`parsedSoFar` 跟踪行界，非流路径整段回放一次）；`chat.js runTurn/processTurn` 透传 → `threads.appendDelta`（累加 `turn.partial`，不落盘瞬态）+ `threads.currentTurn`；`GET /api/threads/:agentId` 附 `generating:{turnId,partial,startedAt}`；panel.js `S.streaming` + 700ms 轮询 + `updateStreamingBubble` 局部 DOM 更新（不整页 render，避免重置输入框）；`stream-caret` 光标动画 CSS。选型 Plan B（轮询）——SSE 需宿主 Hono `c.stream()` 支持，留真机 PoC。154/154 全绿（新增 tests/stream.test.js），浏览器实测端到端通过。
- 养成改造批 3 · 幕间生活 + 信念标记（COMPANION-PLAN 批 3）：新建 `lib/agent-state.js`（per-agent `{mood,dwelling,lastEvolvedAt}` JSON，MOODS/DWELLINGS 轮换池，规则演化冷却 6h）；演化挂 `engine.tick()` 的 enabled 检查之前；`prompts.js` 加第 4.5 块 `stateBlock`（`BUDGET_STATE=120`）+ thingsBlock/notesBlock inferred 加"（猜测）"；`chat.js buildSystem` 传 agentState；engine `buildPrompt` 主动消息带状态开场。信念 `belief`（不叫 kind，note kind 已占）：`markdown.js` FM_ORDER/serialize/normalize + `repo.js` thingRow/noteRow/createThing/createNote/updateThing/updateNote（stated 可升级 inferred，反向不动）+ `prompts.js` EXTRACT_SYSTEM 加标注规则（"不确定不记"放宽为"拿不准标 inferred"）+ `extract.js` 三分支白名单读 + new_note L3 去重时 stated 升级 inferred。`/api/overview` 加 `a.life`；panel.js chat-head 加 `心情 X`。149/149 全绿，已浏览器实测。
- 养成改造批 1 · 关系统计行（COMPANION-PLAN 批 1）：chat-head 显示「认识 N 天 · 聊 M 条 · 记 K 条」。新增 `threads._stats`（首条 at + 现存/归档消息总数）；`/api/overview` 给每助手注入 `stats`（memoryCount 只数 thing 的 owner/agents，note 无归属不计）；panel.js loadAll+renderCenterCol、panel.css `.chat-stats`（fs-hint+tabular-nums）。纯展示零行为改动；已浏览器实测。规划见 docs/COMPANION-PLAN.md。
- 养成改造批 2 · 助手软删（COMPANION-PLAN 批 2）：`settings.hiddenAgentIds` 收起助手，左栏过滤、可恢复，不动宿主 profile/记忆。config 默认值 + settings normalize/applyPatch 白名单；`/api/overview` 拆 `agents`+`hiddenAgents`；`POST /api/agents/:id/hide|unhide`；agent-item 改 div+hover 显示 `.agent-hide-btn`、hide 带 toast 撤销、active 被收切首个可见；设置模态加"已收起的助手"管理组。已浏览器实测全链路。

- P0 前端令牌桥接（CDS-BRIDGE）：`ui/panel.css` 新增表面阶梯 ×2 套、`--sy-alpha-*`/`--sy-border-*-alpha` ×2 套并桥接覆盖 `--border`、阴影五档 ×2 套、`--sy-hairline` 默认值与 2x/3x 媒体查询、动效令牌与弹簧曲线、`.sy-squish` 按压类、深色字重逆补偿、`svg.i` 光学对齐、`--font-ui` 改纯系统 CJK 链；`ui/panel.js` 仅 1475 行 IME 守卫一处。既有变量零删除；`#ffffff` 仅出现在 surface-3 浅色值与深色 mix 两处。语法花括号配对校验通过；已浏览器实测（含 IME 守卫合成事件验证）。
- P1 布局容器（CDS-BRIDGE-P1）：三栏底色归位 `--sy-surface-1`；`.chat-stream`/`.panel-body`/`.agent-list`/`.d-body` 四滚动容器挂 15 段滚动渐隐 mask；`.chat-textarea` 升 composer 三态（20px 圆角 + 常态/hover/focus 三档阴影）；抽屉/模态/Toast 切 `var(--sy-shadow-popover/md)` + 16px/9999px 圆角。零业务逻辑改动；`ui/panel.css` 单文件；已浏览器实测（含滚动渐隐、composer 三态、深色 popover 白色内高光）。
- P2 原子组件（CDS-BRIDGE-P2）：`.btn` 挂按压弹簧（:active scale(.975) 60ms 塌陷 + 450ms `linear()` 弹簧回弹）；`.seg` 分段控件轨道与按钮双 9999px pill，选中态升 `--sy-surface-3`+`--sy-shadow-sm`；新增 3 个 keyframes——`sy-dot-breathe`（`.dot` 2.4s 呼吸）、`sy-dot-pulse`（`.avatar-status` 脉冲光晕）、`sy-msg-fade-up`（`.msg-group`/`.handoff-card` 300ms 上浮渐入）；`.unread-pill`/`.count-num`/`.budget-cell b`/`.d-props dd`/`.up-window` 等补挂 `tabular-nums lining-nums`。零业务逻辑、零 JS 改动；`ui/panel.css` 单文件；已浏览器实测（按钮弹簧、pill、动画名、keyframes 存在性全验证，截图确认 pill 渲染）。
- Step 1：P1 + 存储层（settings/threads/repo/exclusions）46/46
- Step 2：P2+P3+P4（extract/reconcile/recall/tools-host）116/116
- Step 3：P5+P6+P7（proactive engine/gate/banner/handoff）135/135
- Step 4：P8+P9（routes/ui.js 35 端点 + ui/panel.* + README/CHANGELOG）135/135
- 宿主适配修复：wire.js 的 createAgentPolicy 签名对齐；index.js 不再手动注册路由（宿主自动扫描 routes/）。冒烟 apply/boot 通过。
- 测试时钟修复：repo 增可选 clock 注入，step3 冻结时钟后 staleDropped 误判消除；交付包 shiyi-v0.1.0.zip 已重打（含全部修复）。
- 安装失败根因定位并修复：原交付包由 `Compress-Archive` 打出，条目名用 `\` 分隔，宿主 `yauzl`（`strictFileNames:true`）判非法 → `INSTALL_ARCHIVE_INVALID`。改用 `tools/pack.ps1`（.NET ZipArchive，条目名用 `/`）重打，宿主校验器复验通过；release v0.1.0 资产已替换。
- 宿主 manifest 校验四连修复：卡片图标移入 `ui/assets/`（宿主相对 `ui/` 解析）、两张卡 route 同用 `/panel.html`（宿主不接受 query，小窗按视口宽度 ≤640px 判定）、加 `minAppVersion:"0.1020.0"`。宿主 `validate-app.mjs --archive` → **0 error**。
- 路由契约修复（v0.1.1）：`routes/ui.js` 原按 Express 形状写（`req`/`res` + `res.json`），宿主是 Hono（handler 只收一个 context，响应走 `c.json`），真机上 35 个端点全 500（`res.json is not a function`）。改为在 `h()` 包装里把 Hono context 归一成 `{params,query,body}`，35 个处理体不动。
- 路由层测试（v0.1.1）：新增 `tests/routes.test.js`（13 例，含全端点扫描），148/148。
- 前端会话凭证（v0.1.2）：宿主把 surface 会话放在 iframe URL 的 `appSurfaceSession` 参数里，原代码只认 `hana-surface-session`/`session`，面板拿不到凭证。已按宿主 APPS.md「鉴权两通道」修正。
- 打包包名跟随 manifest 版本（v0.1.1），改版本后不必手改文件名。
- 发布：v0.1.0 / v0.1.1 / v0.1.2 三个 release。**v0.1.1 的包缺前端会话修正，可用包是 v0.1.2。**
- 市场索引与更新通道：宿主自带「提示更新 → 一次确认 → 就地覆盖安装（失败把旧目录搬回来）」，应用侧不自建检查器（生态里 `shiguangji-app` 已删掉自建检查器，`biaoqingbao-app` 只给下载链接、不装）。拾遗改为挂在市场索引上：`tools/market-index.mjs` 生成 `market/app-shiyi-<版本>.entry.json` 与 `market/index.v2.json`，用宿主官方 `extension-index-build.mjs` 交叉校验，`items` 完全一致；已发布资产的 size/sha256 与索引声明逐字节一致。约束：**只有从市场源安装的记录才有更新通道**，本地 zip 装的调 update 会报 `EXTENSION_UPDATE_SOURCE_UNSUPPORTED`。

## 停留位置

- 已发 **v0.1.6**：`f2c6dc1` + tag `v0.1.6`，Release 挂 `app-shiyi-0.1.6.zip` 与 entry JSON；`market/index.v2.json` 同版（sha256 与资产逐字节一致，宿主 index builder 交叉校验 items 相等）。
- 设置页 `ui/settings.html` 由面板齿轮 iframe 打开，manifest 无需单独路由；嵌套 iframe 的主题/会话传递只在本地 mock 验过。
- 线上 **v0.1.6**（两栏 + 设置页 iframe）；真机复验尚未做，本机只能做到 mock 级验证。
- 「稍后再说」走 `POST /api/proactive/snooze`，状态落 `proactive-state.json`，刷新回填；「这件先不问了」走 `POST /api/things/:id/snooze`。两者均未在真实宿主复验。

## Next Steps

- [x] P0 视觉复验：已在 `.preview/audit-p0.html`（假数据注入）实测，浅色/深色、抽屉/模态/Toast、IME 守卫全过；指南在 `docs/CDS-P0-验收指南.md`。
- [x] P1 布局容器复验：同环境实测滚动渐隐、composer 三态、popover 双环阴影、圆角矩阵。
- [x] P2 原子组件复验：同环境实测按钮弹簧 transition（linear() 曲线已进 computed）、`.btn:active` 塌陷规则、pill 9999px、3 个 keyframes 挂载、数字 tabular-nums；浅色截图确认。
- [x] CDS 第二轮复核：D2–D8、D10 已随 `6cd0a61` 落地，D1 执行 C（保留米色底、主色换陶土橙），D9 随右栏删除失效；明细见 `docs/UI-AUDIT-CDS-ROUND2.md` 顶部状态表。
- [x] 加载态标准件接线或删除：`.sy-dots` 接面板启动态、`.sy-skeleton` 接设置页加载态；`.sy-breathe-dot` 无消费者已删。右栏遗留死 CSS（`.dot`/`.a-*`/`.k-*` + `--sy-k-*` + `sy-dot-breathe`）一并清除。D8 由 ⚠️ 转 ✅，见 `docs/UI-AUDIT-CDS-ROUND2.md`。
- [x] 两栏化复验：`.preview/panel-mock.html`（拦 fetch 喂假数据）1280px→216+1064 两栏、900px→200+700、600px→form-mini 单栏，无横向溢出、无控制台报错；「这件先不问了」toast 正常。
- [ ] 两栏化 + 设置页 iframe 真实宿主复验（v0.1.6 已发布，装市场包即可；重点看嵌套 iframe 的主题变量与会话头）。
- [ ] 官方市场收录 PR `liliMozi/hana-marketplace#153` 已 bump 到 v0.1.6（`approvals.json` 的 tag/sha256，commit `61fbd3f`，标题同步改 v0.1.6）；工作流 `Synchronize market index` 停在 `action_required`，等维护者批准运行与审核。合并前官方市场不显示拾遗。
- [ ] 宿主 `--smoke` UI 检查（本机无 Electron，未跑）。
- [x] 全局 snooze 端点 + 持久化（`POST /api/proactive/snooze`，overview 回填）。

## 阻塞点

- 覆盖 `~/.hanako/apps/shiyi/` 下的旧包、删除已发布的 release 资产，都需用户对该目标显式授权（自动化被拒），故走加法发布 v0.1.2，v0.1.1 资产保留但作废。
