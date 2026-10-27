# CDS-BRIDGE-P1 — 布局容器改造规范（P1 唯一真相源）

> P0 已落地（令牌桥接）。P1 只做**布局容器**层面：三栏底色归位到 surface 阶梯、四个滚动容器加 CDS 滚动渐隐、chat-textarea 升级 composer 三态、抽屉/模态/toast 切 popover 双环阴影与圆角。
> 红线：零业务逻辑改动；**不改 panel.js**；不改 panel.html；不新增硬编码颜色；不动既有选择器的非目标属性；保留 `--radius-*` 既有变量名。

---

## 1. 三栏底色归位到 surface 阶梯

**当前**：`.col-left` 用 `color-mix(in srgb, var(--bg) 60%, var(--bg-card))`、`.col-right` 用 45%。P0 已引入 `--sy-surface-1: color-mix(in srgb, var(--bg) 55%, var(--bg-card))`，把这两个手工比例统一到阶梯。

`ui/panel.css` 修改：

```css
/* .col-left (339 行附近) */
background: var(--sy-surface-1);   /* 原：color-mix(in srgb, var(--bg) 60%, var(--bg-card)) */

/* .col-right (650 行附近) */
background: var(--sy-surface-1);   /* 原：color-mix(in srgb, var(--bg) 45%, var(--bg-card)) */
```

**不改**：`.col-center`（保持默认，中栏基座即页面底色）。

---

## 2. 滚动渐隐（CDS 15 段 mask）

四个滚动容器加顶部+底部渐隐遮罩，CSS 原生 mask，不动 JS。这是 CDS 标志性的"内容融入背景"感。

### 2.1 新增工具类（追加到文件末尾）

```css
/* CDS 滚动渐隐：15 段非线性 mask，顶部 0→1 快、底部 1→0 缓 */
.sy-scroll-fade {
  -webkit-mask-image:
    linear-gradient(to bottom, transparent 0%, black 12px, black calc(100% - 24px), transparent 100%),
    linear-gradient(to bottom, black, black);
  -webkit-mask-composite: source-in;
  mask-image:
    linear-gradient(to bottom, transparent 0%, black 12px, black calc(100% - 24px), transparent 100%);
}
```

> 不用 `animation-timeline: scroll()`（浏览器兼容与复杂度超 P1 范围）；固定 12px/24px 双边渐隐，对 90% 场景已够。

### 2.2 挂到四个滚动容器

```css
.chat-stream  { /* 在现有规则追加 */ }
.panel-body   { /* 在现有规则追加 */ }
.agent-list   { /* 在现有规则追加 */ }
.d-body       { /* 在现有规则追加 */ }
```

做法：在每个选择器已有规则的**最后**加一行 `/* P1 */ mask-image: ...`（具体值见 2.1，可直接 `-webkit-mask-image` + `mask-image` 双写）。

不挂：`.modal-body`（模态内容通常不超一屏，渐隐意义不大）。

---

## 3. chat-textarea 升级 composer 三态

**当前**（630-637 行）：`border-radius: var(--radius-card)`(8px)、`border: 1px solid var(--border)`、`box-shadow` 仅 focus 时一道 `0 0 0 3px var(--accent-light)`。

替换为 CDS composer 规格：

```css
.chat-textarea {
  flex: 1 1 0; min-width: 0; min-height: 38px; max-height: 110px; padding: 8px 12px;
  border-radius: 20px;                                     /* P1：composer 专属圆角 */
  border: 0;                                               /* P1：取消显式边框，由阴影内环承担 */
  background: var(--sy-surface-2);                         /* P1：阶梯第 2 档 */
  color: var(--text); font-size: var(--fs-body);
  line-height: 1.45; resize: none; outline: none;
  box-shadow: var(--sy-shadow-composer);                   /* P1：常态阴影 */
  transition: box-shadow var(--sy-dur-snap) var(--sy-ease-swift);
}
.chat-textarea:hover {
  box-shadow: var(--sy-shadow-composer-hover);             /* P1：悬停 */
}
.chat-textarea:focus {
  box-shadow: var(--sy-shadow-composer-focus);             /* P1：聚焦 */
}
.chat-textarea:disabled { opacity: .6; cursor: not-allowed; }
```

**删**：原 `.chat-textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-light); }` 整段（被新规则覆盖）。

---

## 4. 抽屉 / 模态 / Toast 切 popover 阴影 + 圆角矩阵

### 4.1 抽屉 .drawer（707 行）

```css
.drawer {
  position: fixed; top: 0; right: 0; bottom: 0; z-index: 31;
  width: min(480px, 100%); display: flex; flex-direction: column;
  background: var(--sy-surface-popover);                   /* P1：原 var(--bg) → popover 档 */
  border-left: 1px solid var(--border);                    /* 保留 */
  border-radius: 16px 0 0 16px;                            /* P1：新增——左侧圆角 dialog 档 */
  box-shadow: var(--sy-shadow-popover);                    /* P1：原 -12px 0 36px var(--shadow) */
  animation: slideIn var(--sy-dur-sheet) var(--sy-ease-enter);  /* P1：换动效令牌 */
}
```

### 4.2 模态 .modal（748 行）

```css
.modal {
  position: fixed; z-index: 41; left: 50%; top: 50%; transform: translate(-50%, -50%);
  width: min(620px, calc(100% - 28px)); max-height: calc(100vh - 48px);
  display: flex; flex-direction: column;
  border-radius: 16px;                                     /* P1：原 var(--radius-lg)=12px → dialog 档 */
  background: var(--sy-surface-popover);                   /* P1：原 var(--bg) */
  border: 0;                                               /* P1：取消显式边框，由阴影外环承担 */
  box-shadow: var(--sy-shadow-popover);                    /* P1：原 0 16px 48px var(--shadow) */
  overflow: hidden;
}
```

### 4.3 Toast .toast（787 行）

```css
.toast {
  position: fixed; left: 50%; bottom: 20px; z-index: 60; transform: translateX(-50%);
  padding: 9px 16px;
  border-radius: 9999px;                                   /* P1：原 var(--radius-card) → pill 档 */
  background: var(--text); color: var(--bg); font-size: var(--fs-ui);
  box-shadow: var(--sy-shadow-md);                         /* P1：原 0 6px 20px var(--shadow) */
  display: flex; align-items: center; gap: 10px;
}
```

### 4.4 scrim 保持不动

`.scrim` 背景 `var(--sy-scrim)` 已是变量，无需改。

---

## 5. 验收清单（subagent 自查）

1. `git diff --stat` 只触及 `ui/panel.css`，单文件
2. 无新增硬编码颜色（`#xxxxxx` / `rgb(...)` / `rgba(...)` 字面量）——所有色值走 `var(--sy-*)` 或 `var(--*)`
3. `--radius-*` 既有变量**保留不删**；新代码里出现的 `20px`、`16px`、`9999px` 是 P1 规范要求的字面量（它们对应 CDS 的 composer/dialog/pill 圆角档位，不走 `--radius-*` 是有意为之）
4. `.chat-textarea:focus` 的旧 `var(--accent)` 描边规则**已删除**（被 composer 三态覆盖）
5. 三栏背景统一为 `var(--sy-surface-1)`，无残留 `color-mix(in srgb, var(--bg) 60%/45%, ...)`
6. 四个滚动容器都有 `mask-image`（或 `-webkit-mask-image`）渐隐
7. 抽屉/模态/toast 的 box-shadow 全部切到 `var(--sy-shadow-*)`

---

## 6. 验收后预期视觉变化

- 三栏底色：左/右栏从"手工比例的 mix"变成"阶梯第 1 档"，与中栏/卡片形成稳定的 0→1→2→3 层级
- 聊天流/事知面板/助手列表/抽屉正文：滚动到底部或顶部时内容**渐隐融入背景**，不再被硬边裁切
- 输入框：圆角从 8px → 20px，常态有轻阴影，悬停加深，聚焦最深；去掉蓝色 focus 描边（更符合 CDS 的中性克制）
- 抽屉：左边缘圆角 16px + 双环阴影（浅色 1px 外环 + 弥散；深色白色内高光）
- 模态：圆角从 12px → 16px + 双环阴影
- Toast：圆角从 8px → 9999px pill 形 + 中档阴影
