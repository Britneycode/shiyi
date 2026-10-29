# UI 差距审计与改造计划（拾遗 × CDS 第二轮）

> 审计时间：2026-10-27。基准：Caho1/open-claude-ui `cds-theme.css`（986 行，183 令牌）+ `AGENTS.md`。
> 前提事实：本项目已完成 CDS 桥接 P0+P1+P2（commit `95c6843`），`docs/CDS-BRIDGE.md` 是当时决策：**保留拾遗品牌色（米色纸张 + 青石蓝 + 衬线标题），只引入 CDS 结构骨架**。本次审计在此决策基础上做差距对照。

## 落地状态（2026-10-29 复核，commit `6cd0a61`）

| 项 | 状态 | 位置 |
|---|---|---|
| D1 品牌色 | ✅ 执行 C：保留米色纸底，主色换陶土橙（浅 `#d97757` / 深 `#cc6b49`）；决策见 DECISIONS D-004 | panel.css:5,28,39 |
| D2 滚动遮罩 | ✅ 7 档非线性；`.d-body` 随右栏删除 | panel.css:357,445,665 |
| D3 消息气泡 | ✅ 用户 18px 圆角 + `--sy-primary` 底；助手透明零边框 | panel.css:458-472 |
| D4 按钮体系 | ✅ XS 24 / SM 28 / MD 32 / LG 40 + 五变体（补了 Outline、Danger） | panel.css:210-233 |
| D5 Composer | ✅ `field-sizing: content`，min/max-height 硬编码已去 | panel.css:544 |
| D6 Seg 滑块 | ⚠️ 走「退一步」方案：选中态 120ms 背景/阴影过渡，无滑块位移 | panel.css:268-280 |
| D7 单闭合边框 | ✅ `.quick-chip` 去边框；`.strip-trigger`/`.area-chip` 随右栏删除 | panel.css:557 |
| D8 加载态标准件 | ⚠️ 类已入库（`.sy-skeleton`/`.sy-dots`/`.sy-breathe-dot`），全仓 0 引用，未接任何加载态 | panel.css:693-730 |
| D9 卡片 hover | — 随右栏删除失效（`.thing-card` 不再存在） | — |
| D10 设置页 | ✅ `ui/settings.html`，面板齿轮 iframe 打开 | ui/settings.html |

> 下文为 2026-10-27 审计基线的诊断：行号与 `.thing-card`/`.d-body`/`.strip-trigger`/`.area-chip` 等选择器已随两栏化变动，保留作决策依据，不再逐条维护。

---

## 0. 已落地清单（不做重复工作）

| CDS 规范 | 拾遗现状 | 位置 |
|---|---|---|
| Surface 0-3 表面阶梯 | ✅ 已有 `--sy-surface-0..3` + popover，浅色基于 `--bg`/`--bg-card` mix，深色 midnight 基底 | panel.css:92-96, 152-156 |
| 中性 alpha 边框 | ✅ `--sy-alpha-1/2/3` + `--border` 桥接覆盖 | panel.css:99-104, 159-164 |
| 阴影五档 + 双环 popover + composer 三态 | ✅ `--sy-shadow-sm/md/lg/popover/composer*` 全套，深色内高光 | panel.css:107-117, 167-174 |
| 发丝细线高分屏补偿 | ✅ `--sy-hairline` 1px/0.5px/0.33px 三档媒体查询 | panel.css:190-195 |
| 动效时间常数（60/120/200/300/450ms） | ✅ `--sy-dur-fast/snap/base/sheet/slow` | panel.css:123-127 |
| 非对称贝塞尔曲线 | ✅ `--sy-ease-swift/enter/snap/pop` 四条 | panel.css:128-131 |
| 15 阶物理弹簧回弹 | ✅ `--sy-btn-spring` + `.sy-squish` 按压类 | panel.css:133, 315-322 |
| 深色字重逆补偿 600→565 | ✅ 八个选择器已挂 | panel.css:178-187 |
| 行内图标 -0.125em 光学对齐 | ✅ `svg.i` | panel.css:214 |
| 等宽数字 tabular-nums | ✅ `.num` + 多处 | panel.css:209-211 |
| 系统字体回退栈（CJK 链） | ✅ `--font-ui` 纯系统链 | panel.css:20-21 |
| 滚动边缘渐隐遮罩 | ⚠️ 有，但是**两段线性**（12px/24px），不是 CDS 的 7 档非线性 | panel.css:361-362, 565-566, 713-714 |

---

## 1. 差距诊断（按优先级）

### P0 —— 阻断级差距（影响「像不像 Claude」的第一观感）

**D1. 品牌色系不符**
- 现状：`--accent: #537D96`（青石蓝），米色纸底 `#F8F4ED`
- CDS：陶土橙 `#d97757`（浅）/ `#cc6b49`（深），Surface 底 `#f9f9f7`/`#0b0b0b`
- 性质：这是**设计决策**，不是缺陷。CDS-BRIDGE.md 明确写了「保留拾遗品牌配色」
- 问题：本轮改造要求「参考 CDS 系统性升级」——是继续保留青石蓝，还是切换到陶土橙？**需用户裁决**（见 Q25）

**D2. 滚动渐隐遮罩是线性两段，CDS 要求 7 档非线性**
- 现状：`linear-gradient(to bottom, transparent 0%, black 12px, black calc(100% - 24px), transparent 100%)`
- CDS：7 档非线性（0%→0.05→0.18→0.38→0.64→0.88→1.0，近似 x^1.5 曲线）
- 影响：滚动时内容消失在边缘的「空气感」差异明显，线性遮罩有生硬的 cutoff 感
- 修法：替换 `.agent-list`、`.chat-stream`、`.panel-body`、`.d-body` 四处 mask，或统一抽 `.sy-scroll-fade` 类（已有但实现是线性的）

### P1 —— 结构级差距（布局/组件骨架）

**D3. 消息气泡形态不符**
- 现状：用户气泡 `border-radius: 12px` + 右下直角 4px；助手气泡有 `border: 1px solid`
- CDS：用户气泡 18px 圆角 + 软 tint 底（`--cds-bg-user-message`），助手气泡**零边框零背景**（透明融入画布）
- 影响：助手消息的「边界框感」是 CDS 刻意消除的——助手的话应该像「印在纸上」，不像「装在盒子里」
- 修法：`.msg-group.assistant .bubble` 去 border 去背景；`.msg-group.user .bubble` 圆角改 18px 并换 tint 底

**D4. 按钮体系不符**
- 现状：`.btn` 高度 36px、圆角 8px、无明确 4 级梯度；`.btn-xs` 26px / `.btn-sm` 30px
- CDS：4 级梯度 XS 24px / SM 28px / MD 32px / LG 40px，5 变体（Primary/Secondary/Ghost/Outline/Danger）
- 修法：重排高度梯度，补 Outline 变体（描边不透明填充）

**D5. 输入框（Composer）不符**
- 现状：`.chat-textarea` 圆角 20px ✅ 已对，但高度 min 38px / max 110px，无 `field-sizing: content` 自适应
- CDS：20px 圆角 + `field-sizing: content` 自适应高度 + 双环 focus 阴影
- 差距：高度硬编码范围，自适应靠 JS（如果有的话）；focus 阴影已有 `--sy-shadow-composer-focus` ✅
- 修法：加 `field-sizing: content`（Chromium 123+ 支持），去掉 min/max-height 硬编码

**D6. 缺少 SegmentedControl 滑块动效**
- 现状：`.seg` 有结构（9999px 轨道 + 2px padding），选中项有背景+阴影 ✅，但**没有滑块移动动画**（选中态切换是瞬间跳变）
- CDS：CSS & Framer Motion 双模式滑块，`--sy-dur-snap` (120ms) 几何吸附
- 修法：纯 CSS 可用 `transition` + `transform: translateX()` 实现滑块移动；或退一步，选中项背景加 120ms 淡入

### P2 —— 精修级差距（细节质感）

**D7. 单闭合边框原则未执行**
- CDS 规则：在有边框的容器内部（如卡片、输入栏），次级按钮和 chips 不得有冗余边框（`border-none`）
- 现状：`.quick-chip`、`.strip-trigger`、`.area-chip` 在 `bg-card` 容器内仍有 `1px solid var(--border)`
- 修法：这些 chips 去掉边框，用 `background: var(--overlay-light)` 区分

**D8. 空态/加载态缺 CDS 标准件**
- CDS 有：骨架屏扫光（`cds-skeleton-sweep`）、三点波浪跳跃（`timeline-quiet-dot`）、陶土呼吸灯（`dframe-clay-breathe`）
- 现状：无骨架屏；加载态未知
- 修法：`.sy-skeleton` 类 + `timeline-quiet-dots` 结构

**D9. 面板卡片缺 hover 浮起**
- CDS：`.cds-card-interactive` hover 时 `translateY(-1.5px)` + 阴影加深 + 边框变强
- 现状：`.thing-card:hover` 只有边框和背景变化，无位移无阴影变化
- 修法：加 transform + shadow 过渡

**D10. 设置页不存在**
- 茶话会做法：iframe 嵌入式设置视图，齿轮在聊天头右上
- 现状：无设置页
- 这是新增功能，不是差距修复

---

## 2. 接入策略判断

**结论：不引入 cds-theme.css，继续映射到本地 `--sy-*` 体系。**

理由：
1. 第一轮桥接已建立 `--sy-*` 语义层，所有新代码已在用（`--sy-shadow-composer`、`--sy-dur-*`、`--sy-ease-*`）
2. 直接引入 cds-theme.css 会覆盖拾遗品牌色（`--bg`、`--accent`），违背 CDS-BRIDGE.md 的既定决策
3. 拾遗是 Hana v2 插件（iframe 嵌入式），不是独立桌面应用——不需要 CDS 的桌面端专属令牌（毛玻璃、窗口拖拽区）
4. cds-theme.css 有 986 行，拾遗只需要其中约 200 行的核心令牌；全量引入是冗余

**具体做法**：缺什么补什么——把差距项对应的 CDS 令牌/规则**增补进 panel.css 的 `--sy-*` 体系**，保持单一文件、单一真相源。

---

## 3. 分步改造清单

### P0（全局令牌修正）
1. **裁决品牌色**：保留青石蓝 vs 切陶土橙（Q25）
2. **滚动渐隐 7 档非线性**：重写 `.sy-scroll-fade`，替换 4 处线性 mask
3. **消息气泡形态**：助手气泡零边框零背景；用户气泡 18px 圆角 + tint 底

### P1（布局与核心组件）
4. **按钮 4 级梯度重排** + 补 Outline 变体
5. **输入框自适应高度**（`field-sizing: content`）
6. **SegmentedControl 滑块动效**（120ms 几何吸附）
7. **单闭合边框原则**：chips/触发器去冗余边框

### P2（精修）
8. **骨架屏扫光 + 三点跳跃** 加载态
9. **卡片 hover 浮起**（translateY + 阴影）
10. **设置页**（新增，iframe 嵌入式）

---

## 4. 红线自查

- ✅ 零业务逻辑破坏：所有改动在 panel.css + panel.js 的渲染函数（模板字符串），不碰数据流/API/路由
- ✅ 杜绝魔法值：所有新值收敛为 `--sy-*` CSS 变量
- ✅ 高分屏兼容：发丝细线已有三档补偿
- ✅ 暗色模式：已有 `data-tone="dark"` + `prefers-color-scheme` 双通道

---

❓ **Q25 - 品牌色裁决**

- **A. 保留青石蓝 + 米色底**（拾遗品牌色，继续只引入 CDS 结构骨架）
- **B. 切换到陶土橙 + CDS 灰阶底**（完全对标 Claude 视觉）
- **C. 折中**：保留米色纸底但主色换陶土橙（暖纸 + 暖橙，比青石蓝更和谐）

➡️ 推荐 A 或 C。青石蓝 `#537D96` 配米色 `#F8F4ED` 是拾遗的独特气质；陶土橙配米色也和谐（都是暖调），但会丢失品牌辨识度。

❓ **Q26 - 滚动渐隐遮罩**

确认要换成 CDS 7 档非线性 mask？（视觉差异：内容消失在边缘更柔和，像「淡出到空气中」而不是「被一条线裁掉」）

➡️ 推荐换。这是低成本高感知的改动。

❓ **Q27 - 助手气泡零边框**

CDS 的做法是助手消息完全透明融入画布，只有用户消息有气泡。拾遗目前助手消息有卡片边框+背景。确认要改？

➡️ 推荐改。这是「像 Claude」的第一观感差异。

---

> Q25/Q26/Q27 已由落地结果回答（见顶部状态表）：D1 执行 C（米色底 + 陶土橙），D2 换 7 档，D3 助手气泡零边框。
