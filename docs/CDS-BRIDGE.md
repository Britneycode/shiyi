# CDS-BRIDGE — 拾遗 × CDS 设计令牌桥接规范（P0 唯一真相源）

> 本文件是 P0 改造的**唯一事实来源**。subagent 严格按此实现，不自由发挥。
> 设计溯源：github.com/Caho1/open-claude-ui（Claude Design System 逆向）。
> 桥接策略：保留拾遗品牌配色（米色纸张 + 青石蓝 + 衬线标题），引入 CDS 的**结构骨架**（表面阶梯 / alpha 边框 / 阴影分档 / 发丝补偿 / 动效令牌 / 排版修正）。
> 红线：零业务逻辑改动；不动 `panel.html`；`panel.js` 仅允许 IME 一处；所有值收敛为 CSS 变量，禁魔法值。

---

## 1. 表面阶梯（新增，语义层）

浅色映射到既有 `--bg`/`--bg-card` 体系，深色复用 `prefers-color-scheme` 那套 midnight 值的基底，用 `color-mix` 在两条 ramp 上补出中间档。插入位置：`panel.css` 第 2 节（拾遗语义 token）的 `html {}` 块内追加。

```css
/* 浅色：基于现有 --bg #F8F4ED / --bg-card #FCFAF5 的等距阶梯 */
--sy-surface-0: var(--bg);                                       /* 页面基底 / 三栏底层 */
--sy-surface-1: color-mix(in srgb, var(--bg) 55%, var(--bg-card)); /* 侧栏（左/右栏现在的 mix 态） */
--sy-surface-2: var(--bg-card);                                  /* 卡片 / 气泡 / 输入框 */
--sy-surface-3: #ffffff;                                         /* 浮起态 / hover 填充 */
--sy-surface-popover: var(--bg-card);                            /* 抽屉 / 模态 / toast */
```

深色（追加到 `html[data-tone="dark"]`，并同步进 `@media (prefers-color-scheme: dark)` 的兜底块）：

```css
--sy-surface-0: var(--bg);        /* #3B4A54 */
--sy-surface-1: color-mix(in srgb, var(--bg) 55%, var(--bg-card));
--sy-surface-2: var(--bg-card);   /* #445560 */
--sy-surface-3: color-mix(in srgb, var(--bg-card) 82%, #fff);
--sy-surface-popover: var(--bg-card);
```

> 注意：`:where(html)` 兜底块**不动**（那是宿主可覆盖区）。sy-* 阶梯只加在 `html {}` 与两个深色块。

---

## 2. 边框 alpha 化（新增 + 别名桥接，不改既有引用）

CDS 的边框不是颜色而是**透明度叠加**：浅 10% 黑、深 9% 白，同一条边在任何表面上一致。拾遗现有 `--border: rgba(122,96,88,.18)` 是暖褐色调、深色是粉色调 `rgba(170,121,141,.18)`——都偏离中性。桥接做法：新增中性 alpha 边，`--border` 重新指向它（既有 100+ 处引用零改动，视觉自动切换）。

`html {}` 追加：
```css
--sy-alpha-1: rgba(59,61,63,.05);   /* ghost hover 填充 */
--sy-alpha-2: rgba(59,61,63,.10);   /* 标准边 */
--sy-alpha-3: rgba(59,61,63,.18);   /* 强边（hover/强调） */
--sy-border-alpha: var(--sy-alpha-2);
--sy-border-strong-alpha: var(--sy-alpha-3);
```

`html {}` 内**修改**一行（把 `--sy-` 桥接进既有 `--border`）：
```css
/* 原样保留在 html{} —— 但 panel.css 的 --border 定义在 :where(html) 兜底块，不动它。
   桥接做法：在 html{} 重新声明 --border，覆盖兜底。 */
--border: var(--sy-border-alpha);
```

深色两块（`html[data-tone="dark"]` + `prefers-color-scheme` 兜底）追加：
```css
--sy-alpha-1: rgba(255,255,255,.05);
--sy-alpha-2: rgba(255,255,255,.09);
--sy-alpha-3: rgba(255,255,255,.16);
--sy-border-alpha: var(--sy-alpha-2);
--sy-border-strong-alpha: var(--sy-alpha-3);
--border: var(--sy-border-alpha);   /* 深色覆盖 */
```

> 风险自查：`--border` 从暖褐 rgba(122,96,88,.18) 换成中性 rgba(59,61,63,.10)，浅色下边框会**略浅**——这正是 CDS 的克制感，属于预期视觉变化，不是回归。

---

## 3. 阴影分档（新增五档，深色带内高光）

`html {}` 追加：
```css
--sy-shadow-sm: 0 1px 2px 0 rgba(59,61,63,.05), 0 2px 8px 0 rgba(59,61,63,.06);
--sy-shadow-md: 0 2px 4px 0 rgba(59,61,63,.05), 0 6px 16px 0 rgba(59,61,63,.08);
--sy-shadow-lg: 0 4px 8px 0 rgba(59,61,63,.06), 0 12px 28px -2px rgba(59,61,63,.10);
/* 双环 popover：0px 内环 + 1px 外环 + 两层弥散 */
--sy-shadow-popover: inset 0 0 0 0 var(--sy-border-alpha),
                     0 0 0 1px var(--sy-border-alpha),
                     0 8px 24px rgba(59,61,63,.12), 0 2px 6px rgba(59,61,63,.08);
/* composer 三态 */
--sy-shadow-composer:       0 4px 20px rgba(59,61,63,.035), inset 0 0 0 1px var(--sy-border-alpha);
--sy-shadow-composer-hover: 0 4px 24px rgba(59,61,63,.06),  inset 0 0 0 1px var(--sy-border-strong-alpha);
--sy-shadow-composer-focus: 0 4px 24px rgba(59,61,63,.08),  inset 0 0 0 1px var(--sy-border-strong-alpha), 0 0 0 1px var(--sy-border-strong-alpha);
```

深色两块追加（内高光替代外轮廓，通透感关键）：
```css
--sy-shadow-sm: 0 1px 2px 0 rgba(0,0,0,.4), 0 2px 8px 0 rgba(0,0,0,.4);
--sy-shadow-md: 0 2px 4px 0 rgba(0,0,0,.4), 0 6px 16px 0 rgba(0,0,0,.4);
--sy-shadow-lg: 0 4px 8px 0 rgba(0,0,0,.5), 0 16px 36px -2px rgba(0,0,0,.4);
--sy-shadow-popover: inset 0 0 0 1px rgba(255,255,255,.10),
                     0 8px 28px rgba(0,0,0,.65), 0 2px 8px rgba(0,0,0,.45);
--sy-shadow-composer:       0 4px 20px rgba(0,0,0,.4),  inset 0 0 0 1px var(--sy-border-alpha);
--sy-shadow-composer-hover: 0 4px 24px rgba(0,0,0,.55), inset 0 0 0 1px var(--sy-border-strong-alpha);
--sy-shadow-composer-focus: 0 4px 24px rgba(0,0,0,.65), inset 0 0 0 1px rgba(255,255,255,.22), 0 0 0 1px rgba(255,255,255,.22);
```

> 旧 `--shadow` 单参数**保留不删**（既有引用继续有效），新代码用 `--sy-shadow-*`。

---

## 4. 发丝补偿（新增，文件顶层独立媒体查询块，紧跟第 2 节之后）

```css
/* 高分屏视网膜发丝细线补偿 */
@media (-webkit-min-device-pixel-ratio: 2), (min-resolution: 2dppx), (resolution >= 2x) {
  html { --sy-hairline: 0.5px; }
}
@media (-webkit-min-device-pixel-ratio: 3), (min-resolution: 3dppx), (resolution >= 3x) {
  html { --sy-hairline: calc(1px / 3); }
}
```
并在 `html {}` 加默认值 `--sy-hairline: 1px;`。

---

## 5. 动效令牌 + 按压弹簧（新增）

`html {}` 追加（不删旧 `--duration-*`，新代码用新令牌）：
```css
--sy-dur-fast: 60ms;
--sy-dur-snap: .12s;
--sy-dur-base: .2s;
--sy-dur-sheet: .3s;
--sy-dur-slow: .45s;
--sy-ease-swift: cubic-bezier(.16, 1, .3, 1);
--sy-ease-enter: cubic-bezier(.22, 1, .36, 1);
--sy-ease-snap:  cubic-bezier(.32, .72, 0, 1);
--sy-ease-pop:   cubic-bezier(.34, 1.56, .64, 1);
/* 15 阶物理弹簧回弹（松手复位用） */
--sy-btn-spring: linear(0,.2459,.6526,.9468,1.0764,1.0915,1.0585,1.0219,.9993,.9914,.9921,.9957,.9988,1.0004,1);
```

新增通用按压类（放到第 3 节控件区末尾）：
```css
/* CDS 触觉按压：压下 60ms 塌陷，松手 450ms 弹簧回弹 */
.sy-squish {
  transform-origin: 50%;
  transition: transform var(--sy-dur-slow) var(--sy-btn-spring);
}
.sy-squish:active, :active > .sy-squish {
  transform: scale(.975);
  transition: transform var(--sy-dur-fast) ease-out;
}
```

---

## 6. 排版修正（三处小改 + 一处新增）

a) **字体栈替换**——`:where(html)` 兜底块里 `--font-ui` 那一行**替换**为纯系统 CJK 链（删除假装引用的 Inter；EB Garamond/PT Serif/JetBrains Mono 保留在 serif/mono 栈里作为首选装饰字体，因为面板标题确实想用衬线——但补上系统回退）。只改 `--font-ui`：
```css
--font-ui: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial,
  'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif;
```

b) **深色字重逆补偿**（新增独立块，防深色光渗发胀）：
```css
html[data-tone="dark"] .btn,
html[data-tone="dark"] .wordmark,
html[data-tone="dark"] .thing-title,
html[data-tone="dark"] .chat-agent-title,
html[data-tone="dark"] .d-title,
html[data-tone="dark"] .tray-title,
html[data-tone="dark"] .recent-title,
html[data-tone="dark"] .up-item-title {
  font-variation-settings: "wght" 565;  /* 600 → 565 逆补偿 */
}
```

c) **行内图标光学对齐**：`svg.i` 规则追加 `vertical-align: -0.125em;`

d) **等宽数字兜底**：`.num` 已有；无需动。

---

## 7. IME 修复（panel.js 唯一一处）

[panel.js:1474](ui/panel.js:1474) 的 keydown 处理器，在 `e.key === 'Enter' && !e.shiftKey` 分支前加守卫：

```js
// 原:
if (e.target.id === 'chat-input' && e.key === 'Enter' && !e.shiftKey) {
// 改为:
if (e.target.id === 'chat-input' && e.key === 'Enter' && !e.shiftKey
    && !(e.nativeEvent?.isComposing || e.isComposing || e.keyCode === 229)) {
```

理由：中文/日文输入法候选窗按 Enter 是"选词上屏"，不是"发送"。无守卫会把半成品拼音直接发出去。CDS 强制此守卫。

---

## P0 验收清单（subagent 自查项）

1. `git diff --stat` 只触及 `ui/panel.css` 与 `ui/panel.js`，且 panel.js 仅 1 处改动（IME）
2. `panel.css` 无新增硬编码颜色——所有新值都是 `var(--*)` 或本文件内已声明的阶梯成员（`#ffffff` 仅允许出现在 surface-3 / surface-3 深色 mix 两处）
3. 既有 `--bg/--bg-card/--border/--shadow/--radius-*/--duration-*` 变量**全部保留**（零删除，只做新增 + `--border` 桥接覆盖 + `--font-ui` 替换）
4. 浏览器打开 `ui/panel.html?form=mini` 与整页模式，浅色/深色（devTools 模拟 `prefers-color-scheme: dark`）各看一遍：边框变细但更中性、卡片浮层有分层阴影、按钮按下有微缩放
5. 聊天输入框在中文输入法下打字选词按 Enter **不发送**，上屏后再按 Enter 才发送
