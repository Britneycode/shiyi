# CDS-BRIDGE-P2 — 原子组件改造规范（P2 唯一真相源）

> P1 已落地（布局容器）。P2 只做**原子组件**：按钮按压、分段控件、状态点、消息入场动画、数字对齐。
> 红线：零业务逻辑改动；**不改 panel.js / panel.html**；不新增硬编码颜色（rgba 仅在 keyframes 内部作为动画帧可豁免）；不动既有选择器的非目标属性。

---

## 1. `.btn` 挂按压弹簧（.sy-squish）

P0 已备 `.sy-squish` 类。P2 把它**直接挂到 `.btn`**，不用改 HTML 加类名——CSS 选择器合并即可。

`ui/panel.css` 修改：

```css
/* 在 .btn 规则（214 行）的 transition 最后追加 transform：*/
.btn {
  /* 既有属性不动 */
  transition: background var(--duration-fast) var(--ease-out),
              border-color var(--duration-fast) var(--ease-out),
              color var(--duration-fast) var(--ease-out),
              transform var(--sy-dur-slow) var(--sy-btn-spring);  /* P2 新增 */
}

/* P2 新增——按压塌陷（60ms 快塌陷，松手弹簧回弹） */
.btn:active:not(:disabled) {
  transform: scale(.975);
  transition: transform var(--sy-dur-fast) ease-out;
}
```

**保留** `.sy-squish` 类（P2 起即废弃别名，但暂保留不删，避免外部引用）。

---

## 2. `.seg` 分段控件 CDS 规格

**当前**：`border-radius: var(--radius-md)`（8px）轨道 + `var(--radius-sm)`（5px）按钮。

CDS 分段控件是 **9999px pill 轨道 + pill 按钮**：

```css
/* .seg（261 行）*/
.seg {
  position: relative; display: inline-grid; grid-auto-flow: column; grid-auto-columns: 1fr;
  gap: 2px; padding: 2px;
  border-radius: 9999px;                                   /* P2：pill 轨道 */
  background: var(--overlay-light);
}
.seg button {
  position: relative; z-index: 1; height: 26px; padding: 0 10px;
  border: 0; background: none;
  border-radius: 9999px;                                   /* P2：pill 按钮 */
  font-size: var(--fs-caption); color: var(--sy-text-2); white-space: nowrap;
  transition: color var(--sy-dur-snap) var(--sy-ease-swift);  /* P2 新增过渡 */
}
.seg button[aria-selected="true"] {
  background: var(--sy-surface-3);                          /* P2：原 var(--bg-card)，升到阶梯顶 */
  color: var(--text); font-weight: 600;
  box-shadow: var(--sy-shadow-sm);                          /* P2：原 0 1px 2px var(--shadow) */
}
```

---

## 3. `.dot` 状态点呼吸 / 脉冲

新增两个关键帧，挂到 `.dot`（240 行）与 `.avatar-status`（约 363 行）：

```css
/* P2 新增——状态点呼吸（在岗）与脉冲（活跃） */
@keyframes sy-dot-breathe {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: .65; transform: scale(.92); }
}
@keyframes sy-dot-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(255, 255, 255, .35); }
  50%      { box-shadow: 0 0 0 3px transparent; }
}

/* .dot 规则追加（240 行末尾） */
.dot {
  /* 既有属性不动 */
  animation: sy-dot-breathe 2.4s var(--sy-ease-swift) infinite;  /* P2 新增 */
}

/* 头像角标（.avatar-status）活跃脉冲 */
.avatar-status:not(.off) {
  animation: sy-dot-pulse 2.4s var(--sy-ease-swift) infinite;    /* P2 新增 */
}
```

> `.avatar-status` 在 panel.css 里搜索定位，是助手头像右下角的小圆点。如果没有此类名，跳过本条。

---

## 4. 消息气泡入场动画（message-fade-up）

新增关键帧，挂到 `.msg-group` 与 `.handoff-card`：

```css
/* P2 新增——消息入场：下往上浮 + 渐入 */
@keyframes sy-msg-fade-up {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: none; }
}

/* .msg-group（551 行）与 .handoff-card（603 行）规则末尾追加 */
.msg-group {
  /* 既有属性不动 */
  animation: sy-msg-fade-up var(--sy-dur-sheet) var(--sy-ease-enter);  /* P2 新增 */
}
.handoff-card {
  /* 既有属性不动 */
  animation: sy-msg-fade-up var(--sy-dur-sheet) var(--sy-ease-enter);  /* P2 新增 */
}
```

不挂：`.sys-row`（系统提示不需要入场感）、`.thing-card`（卡片列表更新频繁，动画会闪烁）。

---

## 5. 数字 tabular-nums 补挂

`.num`（209 行）已有 `font-variant-numeric: tabular-nums lining-nums`。补挂到所有显示数字的组件：

```css
/* P2 新增——数字对齐补挂 */
.chat-head-count,   /* 已有，确认即可 */
.unread-pill,
.count-num,
.budget-cell b,
.d-props dd,
.up-window,
.recent-title-line .num,
.thing-foot .num {
  font-variant-numeric: tabular-nums lining-nums;
}
```

> 若某选择器不存在跳过即可；`.chat-head-count` 已在 416 行有 `tabular-nums`，确认。

---

## 6. 验收清单（subagent 自查）

1. `git diff --stat` 只触及 `ui/panel.css`
2. `.btn` 的 `:active` 按压已挂（scale .975 + 60ms 塌陷 + 450ms 弹簧）
3. `.seg` 轨道与按钮均为 9999px pill
4. `.dot` 有 `sy-dot-breathe` 动画；`.avatar-status` 有 `sy-dot-pulse`（若类名存在）
5. `.msg-group` 与 `.handoff-card` 有 `sy-msg-fade-up` 入场
6. 数字组件 `tabular-nums` 补挂到位
7. 无新增硬编码颜色（keyframes 里的 rgba 用于动画帧可豁免）

---

## 7. 验收后预期视觉变化

- 按钮：按下轻微塌陷（scale .975），松手弹簧回弹，有"触觉"感
- 分段控件（事/知 tab、筛选 chip）：轨道与按钮变 pill 形，选中态浮起（sm 阴影）
- 状态点：`.dot` 缓慢呼吸（不刺眼，2.4s 周期）；头像角标有脉冲光晕
- 消息流：新消息从下往上浮入 + 渐入（300ms），不再生硬跳出
- 数字：预算表、未读计数、时间戳的数字等宽对齐
