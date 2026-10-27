/* 拾遗面板（§4.14）：以 v9 原型为基准，数据全部来自 routes/ui.js 真接口。
   BASE 与面板会话头按 PLAN §4.13；返回统一 { ok, code, message }。 */
(function () {
'use strict';

/* ───────────────── 1. 宿主主题探测与明暗适配 ───────────────── */
const qs = new URLSearchParams(location.search);
function applyHostTheme(themeOverride) {
  const root = document.documentElement;
  const theme = themeOverride !== undefined ? themeOverride : qs.get('hana-theme');
  if (theme) root.dataset.theme = theme;
  else delete root.dataset.theme;
  detectTone();
}
function detectTone() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  const c = document.createElement('canvas').getContext('2d');
  c.fillStyle = v || '#F8F4ED';
  const hex = c.fillStyle;
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(x => {
    x /= 255;
    return x <= .03928 ? x / 12.92 : Math.pow((x + .055) / 1.055, 2.4);
  });
  const L = .2126 * ch[0] + .7152 * ch[1] + .0722 * ch[2];
  document.documentElement.dataset.tone = L < .3 ? 'dark' : 'light';
}
applyHostTheme();

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ESC_MAP[c]);

/* ───────────────── 2. 图标库 ───────────────── */
const IC = {
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronUp: '<path d="m18 15-6-6-6 6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  panelRight: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06-.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  handoff: '<path d="M7 17 17 7"/><path d="M7 7h10v10"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
  pencil: '<path d="M17 3a2.85 2.85 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
};
const icon = (n) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${IC[n] || ''}</svg>`;

/* ───────────────── 3. API 层（PLAN §4.13） ───────────────── */
const BASE = '/api/apps/shiyi/routes';
// 宿主把本应用的 surface 会话放在 iframe URL 的 ?appSurfaceSession=（APPS.md「鉴权两通道」），
// 页面脚本读出来、用 X-Hana-App-Surface-Session 头回传；其余名字是旧版兼容。
const surfaceSession = qs.get('appSurfaceSession') || qs.get('hana-surface-session') || qs.get('session') || '';

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    method: opts.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(surfaceSession ? { 'X-Hana-App-Surface-Session': surfaceSession } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* 非 JSON 错误页 */ }
  if (!data || typeof data !== 'object') return { ok: false, code: 'http_' + res.status, message: '接口无响应' };
  if (!data.ok) showToast(data.message || ('失败：' + (data.code || 'error')));
  return data;
}

const AREA_LABELS = { work: '工作', study: '学习', life: '生活' };
const STATUS_LABELS = { active: '进行中', waiting: '等待', done: '完成', dropped: '放下' };
const FOLLOW_LABELS = { auto: '看着办（自动关心）', remind: '到时提醒（准点承诺）', off: '别跟进' };
const NOTE_KIND_LABELS = { knowledge: '知识', howto: '做法', experience: '经验', life: '生活', idea: '灵感', person: '人与约定' };
const REASON_LABELS = {
  remind_due: '到时提醒', followup_due: '工作跟进', handoff_result: '交接结果',
  recent_work: '主对话近况', followup_stale: '久未提起', study_review: '学习回顾', chitchat: '闲聊',
  ask_now: '现在问问', missed_merge: '停机补发',
};
const PRESET_LABELS = { restrained: '克制（发3 / 生6 / 评12）', moderate: '适中（发6 / 生12 / 评24）', active: '积极（发12 / 生24 / 评48）' };
const DAY_MS = 24 * 3600_000;

/* 宿主不保留卡片 route 上的 query（route 不得含 ?），小窗形态按视口宽度判定（PLAN §2 备注的退路）。
   阈值与 panel.css 的 640px 断点一致。 */
const MINI_MAX_WIDTH = 640;
/* 1120px 以下右栏改为覆盖式抽屉（panel.css 同值断点），不再占列 */
const OVERLAY_MAX_WIDTH = 1120;
function detectForm() {
  const q = qs.get('form');
  if (q === 'mini') return 'mini';
  if (q === 'page') return 'page';
  return window.innerWidth <= MINI_MAX_WIDTH ? 'mini' : 'page';
}
function rightIsOverlay(form = 'page') {
  return form === 'page' && window.innerWidth <= OVERLAY_MAX_WIDTH;
}

/* ───────────────── 4. 状态（初始为空，boot 后从接口拉取） ───────────────── */
const S = {
  form: detectForm(),                            // 整页三栏 | 并排小窗
  activeAgentId: null,
  stripOpen: null,            // null | 'recent' | 'upcoming'
  rightOpen: !rightIsOverlay(),   // 覆盖式抽屉形态下默认收起，避免盖住聊天
  rightTab: 'things',         // 'things' | 'notes'
  areaFilter: 'all',
  noteQuery: '',
  editingRecentId: null,
  reschedulingId: null,
  drawerItem: null,           // { type: 'thing'|'note', id }
  modal: null,                // null | 'settings' | 'onboarding' | 'newThing'
  onboardStep: 1,
  globalSnoozeUntil: null,    // 时间戳 ms（「稍后再说」）
  toast: null,
  undoAction: null,
  sending: false,             // 发送中防重入
  streaming: null,            // null | { agentId, turnId, partial, lastDeltaAt } 批 4 打字机

  settings: null,             // { onboarded, proactive{enabled,preset,dailyCap,minGapMinutes,quiet{...},noChaseUnanswered,...}, memory{learnFromChat,learnFromMain}, ... }
  agents: [],                 // [{id,name,yuan,chatModel,memoryEnabled,proactiveEnabled,unread}]
  things: [],
  notes: [],
  threads: {},                // agentId -> { messages:[{seq,role,text,at,meta?}], unread, hasMore }
  budget: null,               // { evaluated, generated, sent }
  loading: true,
  bootError: null,            // 应用不可用时显示原因
};

/* ───────────────── 5. 辅助计算 ───────────────── */
function currentAgent() {
  return S.agents.find(a => a.id === S.activeAgentId) || S.agents[0] || null;
}
function thingById(id) { return S.things.find(t => t.id === id) || null; }
function noteById(id) { return S.notes.find(n => n.id === id) || null; }

/** 相对时间：按消息自身时间换算（§4.3） */
function relTime(iso) {
  const t = Date.parse(iso ?? 0);
  if (!t) return '';
  const diff = Date.now() - t;
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return Math.floor(diff / 60_000) + ' 分钟前';
  if (diff < DAY_MS) return Math.floor(diff / 3600_000) + ' 小时前';
  if (diff < 7 * DAY_MS) return Math.floor(diff / DAY_MS) + ' 天前';
  const d = new Date(t);
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtDateTime(iso) {
  const t = Date.parse(iso ?? 0);
  if (!t) return '';
  const d = new Date(t);
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 跟进方式 → 显示标签（区分「到时提醒」准点承诺 vs 「自动关心」模糊窗口） */
function followBadge(t) {
  if (t.snoozedUntil) return `<span class="badge badge-warn">暂停至 ${esc(fmtDateTime(t.snoozedUntil))}</span>`;
  if (t.followUp === 'remind') {
    return `<span class="badge badge-accent">🔔 ${t.followUpAt ? esc(fmtDateTime(t.followUpAt)) + '（准点提醒）' : '到时提醒（待定时）'}</span>`;
  }
  if (t.followUp === 'off') return `<span class="badge">别跟进</span>`;
  if (t.followUpAt) {
    const ms = Date.parse(t.followUpAt) - Date.now();
    if (ms <= 0) return `<span class="badge badge-danger">该问了</span>`;
    if (ms < DAY_MS) {
      const h = Math.floor(ms / 3600_000);
      return `<span class="badge">${h < 1 ? '约 1 小时内' : '约 ' + h + ' 小时后'}问问</span>`;
    }
    return `<span class="badge">约 ${Math.round(ms / DAY_MS)} 天后问问</span>`;
  }
  return `<span class="badge">合适时问问</span>`;
}

/** 「刚记下」：最近 24h 新建/更新的事与知（不依赖虚拟 recentOp，直接用 updatedAt） */
function getRecentOps() {
  const since = Date.now() - DAY_MS;
  const ops = [];
  for (const t of S.things) {
    const at = Date.parse(t.updatedAt ?? t.createdAt ?? 0);
    if (at >= since) ops.push({ itemType: 'thing', item: t, at: t.updatedAt ?? t.createdAt });
  }
  for (const n of S.notes) {
    const at = Date.parse(n.updatedAt ?? n.createdAt ?? 0);
    if (at >= since) ops.push({ itemType: 'note', item: n, at: n.updatedAt ?? n.createdAt });
  }
  ops.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return ops;
}

/** 「接下来」分组：remind（承诺必发）/ auto（模糊窗口）/ unscheduled */
function getUpcomingGroups() {
  const active = S.things.filter(t => t.status === 'active' || t.status === 'waiting');
  const reminds = active.filter(t => t.followUp === 'remind');
  const autos = active.filter(t => t.followUp === 'auto' && t.followUpAt);
  const unscheduled = active.filter(t => t.followUp === 'off' || (t.followUp === 'auto' && !t.followUpAt));
  return { reminds, autos, unscheduled };
}

function agentName(id) {
  if (!id) return '';
  const a = S.agents.find(x => x.id === id);
  return a ? a.name : id;
}
function agentAvatar(a) {
  return (a?.name || '?').slice(0, 1);
}

let toastTimer = null;
function showToast(msg, undoFn = null) {
  S.toast = msg;
  S.undoAction = undoFn;
  render();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    S.toast = null;
    S.undoAction = null;
    render();
  }, 4000);
}

/* ───────────────── 6. 数据加载 ───────────────── */
async function loadAll() {
  const ov = await api('/api/overview');
  if (!ov.ok) {
    S.bootError = ov.code === 'error' && /capability|权限/.test(ov.message || '') ? ov.message : null;
    // 单端点失败不整体卡死：继续尝试其它端点
  }
  if (ov.ok) {
    S.agents = (ov.agents || []).map(a => ({
      id: a.id, name: a.name, yuan: a.yuan ?? '', chatModel: a.chatModel ?? null,
      memoryEnabled: a.memoryEnabled !== false, proactiveEnabled: a.proactiveEnabled !== false,
      unread: a.unread ?? 0, stats: a.stats ?? null, life: a.life ?? null,
    }));
    S.hiddenAgents = ov.hiddenAgents || [];
    S.settings = ov.settings || null;
    S.budget = ov.budget || null;
    if (S.globalSnoozeUntil == null) {
      // 全局 snooze 状态后端持久化在 proactive-state，overview 未带则保持本地 null
    }
    if (!S.activeAgentId && S.agents.length) S.activeAgentId = S.agents[0].id;
    S.bootError = null;
  }
  const [things, notes] = await Promise.all([api('/api/things'), api('/api/notes')]);
  if (things.ok) S.things = things.things || [];
  if (notes.ok) S.notes = notes.notes || [];
  if (S.activeAgentId) await loadThread(S.activeAgentId);
  S.loading = false;
  render();
}

async function loadThread(agentId) {
  const r = await api(`/api/threads/${encodeURIComponent(agentId)}?limit=100`);
  if (r.ok) {
    S.threads[agentId] = { messages: r.messages || [], unread: r.unread ?? 0, hasMore: !!r.hasMore };
    if (r.unread > 0) {
      // 拉到即视为在场已读，同时摘横幅（§4.8.5）
      const last = (r.messages || []).at(-1);
      api(`/api/threads/${encodeURIComponent(agentId)}/read`, { method: 'POST', body: { uptoSeq: last?.seq ?? 0 } });
    }
  }
  return r;
}

async function refreshThings() {
  const r = await api('/api/things');
  if (r.ok) { S.things = r.things || []; render(); }
}
async function refreshNotes() {
  const r = await api('/api/notes');
  if (r.ok) { S.notes = r.notes || []; render(); }
}
async function refreshBudget() {
  const r = await api('/api/diagnostics');
  if (r.ok && r.budget) { S.budget = r.budget; }
}

/* ───────────────── 7. 视图渲染 ───────────────── */
/* 7.1 左栏：助手列表 */
function renderLeftCol() {
  return `<aside class="col-left" aria-label="助手列表">
    <div class="brand-head">
      <h1 class="wordmark">拾遗</h1>
      <span class="badge">v2</span>
    </div>
    <div class="agent-list" role="listbox" aria-label="Hana 助手">
      ${S.agents.map(a => {
        const active = a.id === S.activeAgentId;
        const sub = !a.chatModel
          ? '未配置聊天模型'
          : !a.memoryEnabled
            ? 'Hana 记忆已关 · 仅聊天'
            : (a.proactiveEnabled ? '主动跟进开' : '仅被动记事');
        return `<div class="agent-item ${active ? 'active' : ''} ${!a.chatModel ? 'disabled-model' : ''}"
          role="option" tabindex="0" aria-selected="${active}" data-act="pick-agent" data-id="${esc(a.id)}">
          <span class="avatar">
            ${esc(agentAvatar(a))}
            <i class="avatar-status ${a.chatModel && a.proactiveEnabled ? '' : 'off'}"></i>
          </span>
          <span class="agent-info">
            <span class="agent-name-row">
              <span class="agent-name">${esc(a.name)}</span>
              ${a.unread ? `<span class="unread-pill num">${a.unread}</span>` : ''}
            </span>
            <span class="agent-sub">${esc(sub)}</span>
          </span>
          <button class="agent-hide-btn" data-act="hide-agent" data-id="${esc(a.id)}" title="收起 ${esc(a.name)}" aria-label="收起 ${esc(a.name)}">${icon('x')}</button>
        </div>`;
      }).join('') || '<div style="padding:16px;color:var(--sy-text-2);font-size:var(--fs-caption);">还没有助手。</div>'}
    </div>
    <div class="left-foot">
      ${S.globalSnoozeUntil ? `<div class="Snooze-banner-mini">
        <span>已暂停自动关心（${esc(fmtDateTime(new Date(S.globalSnoozeUntil).toISOString()))} 前）</span>
        <button class="btn btn-xs btn-ghost" data-act="clear-global-snooze">恢复</button>
      </div>` : ''}
      <div class="left-foot-btns">
        <button class="btn btn-ghost btn-sm" data-act="open-settings">${icon('gear')} 设置与预算</button>
        <span style="font-size:var(--fs-hint);color:var(--sy-text-2);" class="num" title="今日主动发送 / 上限">今日 ${S.budget?.sent ?? 0}/${S.settings?.proactive?.dailyCap ?? 3}</span>
      </div>
    </div>
  </aside>`;
}

/* 7.2 中栏顶部：「刚记下 · 接下来」轻入口条与展开面板 */
function renderLightStripAndTray() {
  const recentOps = getRecentOps();
  const { reminds, autos, unscheduled } = getUpcomingGroups();
  const upcomingCount = reminds.length + autos.length;
  const activeCount = reminds.length + autos.length + unscheduled.length;

  const stripHtml = `<div class="light-strip" role="toolbar" aria-label="记忆与跟进轻入口">
    <div class="light-strip-pills">
      <button class="strip-trigger" aria-expanded="${S.stripOpen === 'recent'}" data-act="toggle-strip" data-target="recent">
        ${icon('sparkles')}
        <span>刚记下</span>
        <span class="count-num num">${recentOps.length} 条</span>
        ${S.stripOpen === 'recent' ? icon('chevronUp') : icon('chevronDown')}
      </button>
      <span class="strip-divider">·</span>
      <button class="strip-trigger" aria-expanded="${S.stripOpen === 'upcoming'}" data-act="toggle-strip" data-target="upcoming">
        ${icon('clock')}
        <span>接下来</span>
        <span class="count-num num">${upcomingCount} 件</span>
        ${S.stripOpen === 'upcoming' ? icon('chevronUp') : icon('chevronDown')}
      </button>
    </div>
    <div class="strip-right">
      ${S.globalSnoozeUntil
        ? `<span class="badge badge-warn">自动关心已暂停 · 定时提醒照常</span>`
        : `<button class="btn btn-ghost btn-xs" data-act="global-snooze" title="暂停全局自动跟进 4 小时，不影响明确设定的到时提醒">${icon('pause')} 今天先别问</button>`
      }
      ${S.form === 'mini'
        ? `<button class="btn btn-secondary btn-xs" data-act="open-mini-things">手上 ${activeCount} 件事 ›</button>`
        : ''}
    </div>
  </div>`;

  if (!S.stripOpen) return stripHtml;

  if (S.stripOpen === 'recent') {
    return stripHtml + `<section class="light-tray" aria-label="刚记下">
      <div class="tray-head">
        <h3 class="tray-title">
          ${icon('sparkles')} 刚记下（最近 24 小时）
          <span class="tray-hint">不对可当场纠正；删除会写入排除记录（exclusions），重启或回填不会再长回来</span>
        </h3>
        <button class="btn btn-ghost btn-xs" data-act="close-strip">收起 ${icon('x')}</button>
      </div>
      ${recentOps.length === 0
        ? `<div style="padding:18px;text-align:center;color:var(--sy-text-2);font-size:var(--fs-ui);">最近 24 小时还没有新记下的事或知。</div>`
        : `<div class="recent-list">
            ${recentOps.map(op => {
              const isThing = op.itemType === 'thing';
              const item = op.item;
              const isEditing = S.editingRecentId === item.id;
              return `<div class="recent-card">
                <div class="recent-card-top">
                  <div class="recent-main">
                    <div class="recent-title-line">
                      <span class="badge ${isThing ? 'badge-accent' : ''}">${isThing ? `事 · ${AREA_LABELS[item.area] ?? ''}` : `知 · ${NOTE_KIND_LABELS[item.kind] ?? ''}`}</span>
                      <span class="recent-title" data-act="open-drawer" data-type="${op.itemType}" data-id="${esc(item.id)}">${esc(item.title)}</span>
                      <span style="font-size:var(--fs-hint);color:var(--sy-text-2);" class="num">${esc(relTime(op.at))} · ${esc(item.source ?? '')}</span>
                    </div>
                    <div class="recent-now">${esc(isThing ? (item.now || item.logs?.at(-1) || '') : item.content)}</div>
                  </div>
                  <div class="recent-actions">
                    <button class="btn btn-secondary btn-xs" data-act="edit-recent" data-id="${esc(item.id)}">${icon('pencil')} 纠正</button>
                    <button class="btn btn-ghost btn-xs" style="color:var(--danger);" data-act="delete-recent" data-type="${op.itemType}" data-id="${esc(item.id)}" title="移入回收站并写入排除记录">${icon('trash')} 删掉别记</button>
                  </div>
                </div>
                ${isEditing ? `<div class="recent-edit-box">
                  <div class="recent-edit-row">
                    <input class="input" id="re-title-${esc(item.id)}" value="${esc(item.title)}" style="flex:1;min-width:180px;" placeholder="标题">
                    ${isThing ? `
                      <select class="input" id="re-area-${esc(item.id)}" style="width:auto;">
                        ${Object.entries(AREA_LABELS).map(([k, v]) => `<option value="${k}" ${item.area === k ? 'selected' : ''}>${v}</option>`).join('')}
                      </select>
                      <select class="input" id="re-status-${esc(item.id)}" style="width:auto;">
                        ${Object.entries(STATUS_LABELS).map(([k, v]) => `<option value="${k}" ${item.status === k ? 'selected' : ''}>${v}</option>`).join('')}
                      </select>
                    ` : ''}
                  </div>
                  <input class="input" id="re-body-${esc(item.id)}" value="${esc(isThing ? (item.now ?? '') : (item.content ?? ''))}" placeholder="${isThing ? '现状描述' : '内容'}">
                  <div style="display:flex;justify-content:flex-end;gap:6px;">
                    <button class="btn btn-ghost btn-xs" data-act="cancel-edit-recent">取消</button>
                    <button class="btn btn-primary btn-xs" data-act="save-edit-recent" data-type="${op.itemType}" data-id="${esc(item.id)}">保存纠正</button>
                  </div>
                </div>` : ''}
              </div>`;
            }).join('')}
          </div>`
      }
    </section>`;
  }

  return stripHtml + `<section class="light-tray" aria-label="接下来">
    <div class="tray-head">
      <h3 class="tray-title">
        ${icon('clock')} 接下来怎么跟进
        <span class="tray-hint">「到时提醒」是准点承诺；「自动关心」只给模糊窗口，会因安静时段或近期互动顺延</span>
      </h3>
      <button class="btn btn-ghost btn-xs" data-act="close-strip">收起 ${icon('x')}</button>
    </div>
    <div class="upcoming-grid">
      <div>
        <div class="up-section-h">
          <span class="up-section-title"><span class="badge badge-accent">到时提醒 · 承诺必发</span> 明确的提醒 (${reminds.length})</span>
          <span class="up-section-note">显示确切时间；不受自动降频或「今天先别问」影响（仅安静时段顺延）</span>
        </div>
        ${reminds.length === 0
          ? `<div style="font-size:var(--fs-caption);color:var(--sy-text-2);padding:6px 0;">暂无明确的定时提醒。</div>`
          : reminds.map(item => renderUpcomingRow(item, 'remind')).join('')
        }
      </div>
      <div>
        <div class="up-section-h">
          <span class="up-section-title"><span class="badge">自动关心 · 模糊窗口</span> 助手看着办 (${autos.length})</span>
          <span class="up-section-note">不显示精确倒计时——可能因安静时段、没回不追或刚聊过而顺延</span>
        </div>
        ${autos.length === 0
          ? `<div style="font-size:var(--fs-caption);color:var(--sy-text-2);padding:6px 0;">暂无排期的自动关心事项。</div>`
          : autos.map(item => renderUpcomingRow(item, 'auto')).join('')
        }
      </div>
      ${unscheduled.length ? `<div>
        <div class="up-section-h">
          <span class="up-section-title">暂无时间安排 / 久未提起再问 (${unscheduled.length})</span>
          <span class="up-section-note">日期含糊时不硬补时间；久未提起时顺口关心</span>
        </div>
        ${unscheduled.map(item => renderUpcomingRow(item, 'unscheduled')).join('')}
      </div>` : ''}
    </div>
  </section>`;
}

function renderUpcomingRow(item, mode) {
  const isRescheduling = S.reschedulingId === item.id;
  const cls = mode === 'remind' ? 'is-remind' : 'is-fuzzy';
  return `<div class="up-item ${cls}">
    <div class="up-item-main">
      <div class="up-item-title" data-act="open-drawer" data-type="thing" data-id="${esc(item.id)}">
        <i class="dot a-${esc(item.area)}"></i>
        <span>${esc(item.title)}</span>
        <span class="badge">${STATUS_LABELS[item.status] ?? item.status}</span>
        ${item.owner ? `<span style="font-size:var(--fs-hint);color:var(--sy-text-2);font-weight:400;">由 ${esc(agentName(item.owner))} 跟进</span>` : ''}
        ${item.snoozedUntil ? `<span class="badge badge-warn">已暂停</span>` : ''}
      </div>
      <div class="up-window">
        ${mode === 'remind'
          ? `<span>🔔 确切提醒：${item.followUpAt ? esc(fmtDateTime(item.followUpAt)) : '待定时'}</span>
             <span class="up-window-explain">（准点发送${item.snoozedUntil ? ' · 自动关心已停，但此提醒保留' : ''}）</span>`
          : mode === 'auto'
            ? `<span>🌤 模糊窗口：${item.followUpAt ? esc(fmtDateTime(item.followUpAt)) + ' 前后' : '合适时'}</span>
               <span class="up-window-explain">（受安静时段、没回不追或近期互动顺延）</span>`
            : `<span class="up-window-explain">未设具体跟进时间 · 久未提起时问</span>`
        }
      </div>
      ${isRescheduling ? `<div style="margin-top:8px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
        <span style="font-size:var(--fs-hint);color:var(--sy-text-2);">改期到：</span>
        <button class="btn btn-secondary btn-xs" data-act="apply-reschedule" data-id="${esc(item.id)}" data-hours="24">明天</button>
        <button class="btn btn-secondary btn-xs" data-act="apply-reschedule" data-id="${esc(item.id)}" data-hours="72">三天后</button>
        <button class="btn btn-secondary btn-xs" data-act="apply-reschedule" data-id="${esc(item.id)}" data-hours="168">下周</button>
        <button class="btn btn-ghost btn-xs" data-act="toggle-followup-mode" data-id="${esc(item.id)}">
          切换为「${item.followUp === 'remind' ? '看着办(模糊窗口)' : '到时提醒(确切时间)'}」
        </button>
      </div>` : ''}
    </div>
    <div class="up-item-actions">
      <button class="btn btn-secondary btn-xs" data-act="toggle-reschedule" data-id="${esc(item.id)}">改期</button>
      ${item.followUp !== 'remind' ? (
        item.snoozedUntil
          ? `<button class="btn btn-ghost btn-xs" data-act="unsnooze-thing" data-id="${esc(item.id)}">恢复</button>`
          : `<button class="btn btn-ghost btn-xs" data-act="snooze-thing" data-id="${esc(item.id)}">暂停 3 天</button>`
      ) : `<button class="btn btn-ghost btn-xs" data-act="open-drawer" data-type="thing" data-id="${esc(item.id)}">详情</button>`}
    </div>
  </div>`;
}

/* 7.3 中栏：聊天主区 */
function renderCenterCol() {
  const agent = currentAgent();
  if (!agent) {
    return `<main class="col-center" aria-label="聊天与近期动态">
      <header class="chat-head"><h2 class="chat-agent-title">拾遗</h2></header>
      <div class="chat-stream"><div style="padding:24px;color:var(--sy-text-2);">还没有可用的助手。</div></div>
    </main>`;
  }
  const th = S.threads[agent.id] || { messages: [], unread: 0, hasMore: false };

  return `<main class="col-center" aria-label="聊天与近期动态">
    <header class="chat-head">
      <div class="chat-head-left">
        ${S.form === 'mini' ? `
          <select class="mini-agent-select" data-act="mini-select-agent" aria-label="切换助手">
            ${S.agents.map(a => `<option value="${esc(a.id)}" ${a.id === agent.id ? 'selected' : ''}>${esc(a.name)}${a.unread ? ` (${a.unread})` : ''}</option>`).join('')}
          </select>
        ` : `
          <span class="avatar" style="width:30px;height:30px;font-size:13px;">${esc(agentAvatar(agent))}</span>
          <div class="chat-head-titles">
            <h2 class="chat-agent-title">${esc(agent.name)}</h2>
          </div>
        `}
        <div class="chat-agent-meta">
          ${agent.chatModel ? `<span class="badge">${esc(agent.chatModel)}</span>` : `<span class="badge badge-danger">无可用模型</span>`}
          ${!agent.memoryEnabled ? `<span class="badge badge-warn">Hana 记忆已关闭 · 不再记新事</span>` : ''}
          ${agent.stats ? `<span class="chat-stats">认识 ${agent.stats.knownDays} 天 · 聊 ${agent.stats.msgCount} 条 · 记 ${agent.stats.memoryCount} 条</span>` : ''}
          ${agent.life?.mood ? `<span class="chat-stats">心情 ${esc(agent.life.mood)}</span>` : ''}
        </div>
      </div>
      <div class="chat-head-right">
        ${S.form === 'mini'
          ? `<button class="btn btn-ghost btn-sm" data-act="open-settings">${icon('gear')}</button>`
          : `<button class="btn btn-secondary btn-sm" data-act="toggle-right" aria-pressed="${S.rightOpen}" title="${S.rightOpen ? '收起' : '展开'}事与知面板">
               ${icon('panelRight')}<span class="chat-head-count num">${S.things.filter(t => t.status !== 'done' && t.status !== 'dropped').length}·${S.notes.length}</span>
             </button>`
        }
      </div>
    </header>

    ${renderLightStripAndTray()}

    <div class="chat-stream" id="chat-stream">
      ${th.hasMore ? `<div class="load-more-row">
        <button class="btn btn-ghost btn-xs" data-act="load-archive">加载更早的归档记录</button>
      </div>` : ''}
      ${th.messages.map(m => renderChatMessage(m, agent)).join('')}
      ${S.streaming && S.streaming.agentId === agent.id
        ? `<div class="msg-group assistant streaming" data-stream-turn="${esc(S.streaming.turnId)}">
             <div class="msg-meta"><span>${esc(agent?.name ?? '')}</span><span>·</span><span>正在输入…</span></div>
             <div class="bubble bubble-stream">${esc(S.streaming.partial || '…')}<span class="stream-caret"></span></div>
           </div>`
        : (S.sending ? `<div class="msg-group user"><div class="bubble">…</div></div>` : '')}
    </div>

    <div class="chat-input-bar">
      <div class="input-row">
        <textarea class="chat-textarea" id="chat-input" rows="1"
          ${!agent.chatModel ? 'disabled placeholder="请先在 Hana 里为该助手设置聊天模型"' : `placeholder="和${esc(agent.name)}聊聊，进展和约定会自动记下…"`}></textarea>
        <button class="btn btn-secondary" data-act="quick-handoff" ${!agent.chatModel ? 'disabled' : ''} title="把需要动手的任务交给 Hana 主对话">
          ${icon('handoff')} 交给 Hana…
        </button>
        <button class="btn btn-primary" data-act="send-msg" ${!agent.chatModel || S.sending ? 'disabled' : ''}>
          ${icon('send')} 发送
        </button>
      </div>
    </div>
  </main>`;
}

function renderChatMessage(m, agent) {
  if (m.role === 'system') {
    return `<div class="sys-row">
      <span>${esc(m.text)}</span>
      ${m.meta?.refId ? `<button data-act="open-drawer" data-type="${esc(m.meta.refType || 'thing')}" data-id="${esc(m.meta.refId)}">查看详情</button>` : ''}
    </div>`;
  }

  if (m.role === 'handoff' || m.meta?.handoff) {
    const h = m.meta?.handoff ?? {};
    const status = h.status ?? 'pending';
    return `<div class="handoff-card">
      <div class="handoff-head">
        <span>${icon('handoff')} 提议交给 Hana 主对话（确认后开启主对话）</span>
        <span class="badge ${status === 'sent' ? 'badge-accent' : ''}">${
          status === 'pending' ? '待你确认' : status === 'sending' ? '发送中' : status === 'sent' ? '已交接' : status === 'failed' ? '已改为复制需求' : '已取消'
        }</span>
      </div>
      <h4 class="handoff-title">拾遗 · ${esc(h.title ?? '')}</h4>
      ${status === 'editing' ? `
        <textarea class="input" id="handoff-edit-${esc(h.id)}" rows="3">${esc(h.request ?? '')}</textarea>
      ` : `
        <div class="handoff-req">${esc(h.request ?? '')}</div>
      `}
      <div class="handoff-actions">
        ${status === 'pending' ? `
          <button class="btn btn-primary btn-sm" data-act="confirm-handoff" data-id="${esc(h.id)}">发送给 Hana 主对话</button>
          <button class="btn btn-secondary btn-sm" data-act="edit-handoff" data-id="${esc(h.id)}">改一下</button>
          <button class="btn btn-ghost btn-sm" data-act="cancel-handoff" data-id="${esc(h.id)}">取消</button>
        ` : status === 'editing' ? `
          <button class="btn btn-primary btn-sm" data-act="save-confirm-handoff" data-id="${esc(h.id)}">保存并发送</button>
          <button class="btn btn-ghost btn-sm" data-act="cancel-edit-handoff" data-id="${esc(h.id)}">返回</button>
        ` : status === 'sent' ? `
          <span style="font-size:var(--fs-caption);color:var(--sy-ok);">✓ 已在 Hana 主对话开启「拾遗 · ${esc(h.title ?? '')}」，完成后结果会自动回流到这件事</span>
          <button class="btn btn-ghost btn-xs" data-act="copy-handoff" data-id="${esc(h.id)}">${icon('copy')} 复制需求</button>
        ` : status === 'failed' ? `
          <button class="btn btn-ghost btn-xs" data-act="copy-handoff" data-id="${esc(h.id)}">${icon('copy')} 复制需求</button>
        ` : `
          <span style="font-size:var(--fs-caption);color:var(--sy-text-2);">已取消交接</span>
        `}
      </div>
    </div>`;
  }

  const isProactive = !!(m.role === 'proactive' || m.meta?.proactive);
  const pro = m.meta?.proactive ?? null;
  const thing = pro?.thingId ? thingById(pro.thingId) : null;
  const bubbles = (m.text ?? '').split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);

  return `<div class="msg-group ${m.role === 'user' ? 'user' : 'assistant'} ${isProactive ? 'proactive' : ''}">
    <div class="msg-meta">
      <span>${m.role === 'user' ? '你' : esc(agent?.name ?? '')}</span>
      <span>·</span>
      <span class="num">${esc(relTime(m.at))}</span>
      ${isProactive ? `<span class="badge badge-accent">${esc(REASON_LABELS[pro?.reason] ?? pro?.reason ?? '主动')}</span>` : ''}
      ${thing ? `<button class="proactive-link" data-act="open-drawer" data-type="thing" data-id="${esc(thing.id)}">关联：${esc(thing.title)}</button>` : ''}
    </div>
    ${bubbles.map(b => `<div class="bubble">${esc(b)}</div>`).join('')}
    ${isProactive ? `<div class="proactive-foot">
      <button class="proactive-link" data-act="proactive-snooze-global" title="全局暂停自动关心 4 小时（不影响你设的准点提醒）">稍后再说</button>
      <span>·</span>
      <button class="proactive-link" data-act="proactive-snooze-thing" data-id="${esc(pro?.thingId || '')}" title="这件事暂停自动跟进 3 天">这件先不问了</button>
    </div>` : ''}
  </div>`;
}

/* 7.4 右栏：「事」与「知」面板 */
function renderRightCol() {
  const activeThings = S.things.filter(t => (S.areaFilter === 'all' || t.area === S.areaFilter) && t.status === 'active');
  const waitingThings = S.things.filter(t => (S.areaFilter === 'all' || t.area === S.areaFilter) && t.status === 'waiting');
  const closedThings = S.things.filter(t => (S.areaFilter === 'all' || t.area === S.areaFilter) && (t.status === 'done' || t.status === 'dropped'));

  const q = S.noteQuery.trim().toLowerCase();
  const filteredNotes = S.notes.filter(n => !q || (n.title + (n.content ?? '') + (n.tags ?? []).join(' ')).toLowerCase().includes(q));

  return `<aside class="col-right" aria-label="事与知面板">
    <div class="panel-head">
      <div class="seg" role="tablist">
        <button role="tab" aria-selected="${S.rightTab === 'things'}" data-act="right-tab" data-tab="things">事 (${S.things.length})</button>
        <button role="tab" aria-selected="${S.rightTab === 'notes'}" data-act="right-tab" data-tab="notes">知 (${S.notes.length})</button>
      </div>
      <div class="panel-head-actions">
        <button class="btn btn-secondary btn-xs" data-act="new-thing">${icon('plus')} 记一事</button>
        <button class="icon-btn" data-act="toggle-right" title="收起面板">${icon('x')}</button>
      </div>
    </div>

    ${S.rightTab === 'things' ? `
      <div class="panel-subbar">
        <div class="area-tabs" role="toolbar" aria-label="按区域筛选">
          ${[['all', '全部'], ['work', '工作'], ['study', '学习'], ['life', '生活']].map(([k, l]) => `
            <button class="area-chip" aria-pressed="${S.areaFilter === k}" data-act="set-area" data-area="${k}">
              ${k !== 'all' ? `<i class="dot a-${k}"></i>` : ''}${l}
            </button>
          `).join('')}
        </div>
      </div>
      <div class="panel-body">
        <div class="group-sec">
          <div class="group-head"><span>▾ 进行中 (${activeThings.length})</span></div>
          ${activeThings.map(renderThingCard).join('') || `<div style="font-size:var(--fs-caption);color:var(--sy-text-2);">暂无进行中的事项</div>`}
        </div>
        <div class="group-sec">
          <div class="group-head"><span>▾ 等待 / 卡住 (${waitingThings.length})</span></div>
          ${waitingThings.map(renderThingCard).join('') || `<div style="font-size:var(--fs-caption);color:var(--sy-text-2);">暂无等待中的事项</div>`}
        </div>
        <div class="group-sec">
          <div class="group-head"><span>▸ 完成 / 放下 (${closedThings.length})</span></div>
          ${closedThings.map(renderThingCard).join('')}
        </div>
      </div>
    ` : `
      <div class="panel-subbar">
        <div style="position:relative;">
          <input class="input" id="note-search" placeholder="搜索知识、做法、经验、他人喜好…" value="${esc(S.noteQuery)}">
        </div>
      </div>
      <div class="panel-body">
        ${filteredNotes.map(n => `
          <button class="thing-card" data-act="open-drawer" data-type="note" data-id="${esc(n.id)}">
            <div class="thing-card-top">
              <span class="thing-title"><i class="dot k-${esc(n.kind)}"></i>${esc(n.title)}</span>
            </div>
            <div class="thing-now">${esc((n.content ?? '').slice(0, 120))}</div>
            <div class="thing-foot">
              <span>${NOTE_KIND_LABELS[n.kind] ?? n.kind} · ${(n.tags ?? []).map(t => '#' + t).join(' ')}</span>
              <span class="num">${esc(relTime(n.updatedAt ?? n.createdAt))}</span>
            </div>
          </button>
        `).join('') || `<div style="font-size:var(--fs-caption);color:var(--sy-text-2);">还没有记过「知」。</div>`}
      </div>
    `}
  </aside>`;
}

function renderThingCard(t) {
  return `<button class="thing-card" data-act="open-drawer" data-type="thing" data-id="${esc(t.id)}">
    <div class="thing-card-top">
      <span class="thing-title"><i class="dot a-${esc(t.area)}"></i>${esc(t.title)}</span>
    </div>
    <div class="thing-now">${esc(t.now ?? '')}</div>
    <div class="thing-foot">
      ${followBadge(t)}
      ${t.dueAt ? `<span class="num">${esc(t.dueAt)}</span>` : ''}
    </div>
  </button>`;
}

/* 7.5 详情与编辑抽屉 */
function renderDrawer() {
  if (!S.drawerItem) return '';
  const { type, id } = S.drawerItem;
  if (type === 'thing') {
    const item = thingById(id);
    if (!item) return '';
    return `<div class="scrim" data-act="close-drawer"></div>
    <aside class="drawer" role="dialog" aria-modal="true" aria-label="${esc(item.title)}">
      <div class="d-head">
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="badge badge-accent">事 · ${AREA_LABELS[item.area] ?? item.area}</span>
          ${item.snoozedUntil ? `<span class="badge badge-warn">自动跟进暂停 (${esc(fmtDateTime(item.snoozedUntil))})</span>` : ''}
        </div>
        <button class="icon-btn" data-act="close-drawer" aria-label="关闭">${icon('x')}</button>
      </div>
      <div class="d-body">
        <div>
          <h2 class="d-title">${esc(item.title)}</h2>
          <div style="font-size:var(--fs-caption);color:var(--sy-text-2);margin-top:4px;">
            来源：${esc(item.source ?? '')} ${item.dueAt ? ` · 截止/约定：${esc(item.dueAt)}` : ''}
          </div>
        </div>

        <dl class="d-props">
          <dt>当前状态</dt>
          <dd>
            <select class="input" style="height:30px;width:auto;" data-act="change-thing-status" data-id="${esc(item.id)}">
              ${Object.entries(STATUS_LABELS).map(([k, v]) => `<option value="${k}" ${item.status === k ? 'selected' : ''}>${v}</option>`).join('')}
            </select>
          </dd>
          <dt>跟进方式</dt>
          <dd>
            <select class="input" style="height:30px;width:auto;" data-act="change-thing-followup" data-id="${esc(item.id)}">
              ${Object.entries(FOLLOW_LABELS).map(([k, v]) => `<option value="${k}" ${item.followUp === k ? 'selected' : ''}>${v}</option>`).join('')}
            </select>
          </dd>
          <dt>下次安排</dt>
          <dd>${followBadge(item)}</dd>
          <dt>负责助手</dt>
          <dd>
            <select class="input" style="height:30px;width:auto;" data-act="change-thing-owner" data-id="${esc(item.id)}">
              ${S.agents.map(a => `<option value="${esc(a.id)}" ${item.owner === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
            </select>
          </dd>
        </dl>

        <div>
          <h4 class="d-sec-label">现状 (Now)</h4>
          <textarea class="input" id="d-thing-now" rows="2">${esc(item.now ?? '')}</textarea>
        </div>

        <div>
          <h4 class="d-sec-label">下一步 (Next)</h4>
          <div class="d-box">
            ${(item.next ?? []).length
              ? `<ul style="margin:0;padding-left:18px;">${(item.next ?? []).map(x => `<li>${esc(x)}</li>`).join('')}</ul>`
              : `<span style="color:var(--sy-text-2);">暂无明确下一步</span>`}
          </div>
        </div>

        <div>
          <h4 class="d-sec-label">跟进与变化记录</h4>
          <ul class="log-list">
            ${(item.logs ?? []).map(l => `<li>${esc(l)}</li>`).join('') || '<li style="color:var(--sy-text-2);">暂无记录</li>'}
          </ul>
        </div>
      </div>
      <div class="d-foot">
        <button class="btn btn-ghost btn-sm" style="color:var(--danger);" data-act="delete-recent" data-type="thing" data-id="${esc(item.id)}">
          ${icon('trash')} 删除并写入排除记录
        </button>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-secondary btn-sm" data-act="ask-now" data-id="${esc(item.id)}">现在让助手问问</button>
          <button class="btn btn-primary btn-sm" data-act="save-drawer-thing" data-id="${esc(item.id)}">保存修改</button>
        </div>
      </div>
    </aside>`;
  }

  const note = noteById(id);
  if (!note) return '';
  return `<div class="scrim" data-act="close-drawer"></div>
  <aside class="drawer" role="dialog" aria-modal="true" aria-label="${esc(note.title)}">
    <div class="d-head">
      <span class="badge">知 · ${NOTE_KIND_LABELS[note.kind] ?? note.kind}</span>
      <button class="icon-btn" data-act="close-drawer" aria-label="关闭">${icon('x')}</button>
    </div>
    <div class="d-body">
      <h2 class="d-title">${esc(note.title)}</h2>
      <div>
        <h4 class="d-sec-label">内容</h4>
        <textarea class="input" id="d-note-content" rows="5">${esc(note.content ?? '')}</textarea>
      </div>
      <div>
        <h4 class="d-sec-label">来源</h4>
        <div class="basis-card">${esc(note.source ?? '')} · ${esc(relTime(note.updatedAt ?? note.createdAt))}</div>
      </div>
    </div>
    <div class="d-foot">
      <button class="btn btn-ghost btn-sm" style="color:var(--danger);" data-act="delete-recent" data-type="note" data-id="${esc(note.id)}">
        ${icon('trash')} 删除并排除
      </button>
      <button class="btn btn-primary btn-sm" data-act="save-drawer-note" data-id="${esc(note.id)}">保存</button>
    </div>
  </aside>`;
}

/* 7.6 设置与预算 / 首次引导 / 新建事项 */
function renderModal() {
  if (!S.modal) return '';
  const p = S.settings?.proactive ?? {};
  const m = S.settings?.memory ?? {};
  const preset = p.preset ?? 'restrained';
  const cap = p.dailyCap ?? 3;

  if (S.modal === 'onboarding') {
    return `<div class="scrim" data-act="close-modal"></div>
    <div class="modal" role="dialog" aria-modal="true" aria-label="首次使用引导">
      <div class="modal-head">
        <strong class="serif" style="font-size:18px;">欢迎来到「拾遗」 · 第 ${S.onboardStep} / 3 步</strong>
        <button class="btn btn-ghost btn-xs" data-act="skip-onboarding">跳过（使用保守默认）</button>
      </div>
      <div class="modal-body">
        ${S.onboardStep === 1 ? `
          <h3 class="serif" style="margin:0;font-size:20px;">1. 认识一下：这里的助手就是你在 Hana 里的助手</h3>
          <p style="margin:0;color:var(--sy-text-2);">ta 会记住你手上的事（工作、学习、生活），到时候主动来问一句进度；真要干活，一键交给 Hana 主对话。</p>
          <div class="basis-card">
            <div>· 数据只保存在本机，只存 ≤60 字最小证据片段。</div>
            <div>· 输入框横幅只提示「谁在拾遗里找你」，不含任何聊天内容。</div>
            <div>· 引导完成前不会读取主对话、也不会主动开口。</div>
          </div>
        ` : S.onboardStep === 2 ? `
          <h3 class="serif" style="margin:0;font-size:20px;">2. 允许从 Hana 主对话学习吗？</h3>
          <p style="margin:0;color:var(--sy-text-2);">允许后，你在 Hana 主对话里聊到的工作和学习进展也会被记下来（群聊、助手私信、外部平台天然排除，绝不收集）。</p>
          <div style="display:flex;gap:10px;margin-top:8px;">
            <button class="btn ${m.learnFromMain ? 'btn-primary' : 'btn-secondary'}" data-act="onboard-main" data-val="1">允许从主对话记事</button>
            <button class="btn ${!m.learnFromMain ? 'btn-primary' : 'btn-secondary'}" data-act="onboard-main" data-val="0">先不要（只从拾遗聊天里记）</button>
          </div>
        ` : `
          <h3 class="serif" style="margin:0;font-size:20px;">3. 希望助手多主动？</h3>
          <p style="margin:0;color:var(--sy-text-2);">每条主动消息会调用一次该助手的聊天模型；上一条没回绝不追问，安静时段不打扰。</p>
          <div style="display:grid;gap:8px;">
            ${[
              ['restrained', '克制（默认推荐）', '每天最多发 3 条 · 最短间隔 120 分钟'],
              ['moderate', '适中', '每天最多发 6 条 · 最短间隔 60 分钟'],
              ['active', '积极', '每天最多发 12 条 · 最短间隔 30 分钟'],
              ['off', '先别主动找我', '只记事，不发自动关心（明确的到时提醒除外）']
            ].map(([k, title, desc]) => `
              <button class="up-item ${preset === k ? 'is-remind' : ''}" style="text-align:left;cursor:pointer;" data-act="onboard-preset" data-val="${k}">
                <div>
                  <div style="font-weight:600;color:var(--hana-text);">${title}</div>
                  <div style="font-size:var(--fs-hint);color:var(--sy-text-2);">${desc}</div>
                </div>
                ${preset === k ? `<span class="badge badge-accent">已选</span>` : ''}
              </button>
            `).join('')}
          </div>
        `}
      </div>
      <div class="modal-foot">
        ${S.onboardStep > 1 ? `<button class="btn btn-secondary btn-sm" data-act="onboard-prev">上一步</button>` : `<span></span>`}
        ${S.onboardStep < 3
          ? `<button class="btn btn-primary btn-sm" data-act="onboard-next">下一步</button>`
          : `<button class="btn btn-primary btn-sm" data-act="finish-onboarding">完成引导</button>`}
      </div>
    </div>`;
  }

  if (S.modal === 'newThing') {
    return `<div class="scrim" data-act="close-modal"></div>
    <div class="modal" role="dialog" aria-modal="true" aria-label="新建事项">
      <div class="modal-head">
        <strong class="serif" style="font-size:18px;">手动记一件事</strong>
        <button class="icon-btn" data-act="close-modal">${icon('x')}</button>
      </div>
      <div class="modal-body">
        <input class="input" id="nt-title" placeholder="事项标题（≤30字，一眼能认出是哪件事）">
        <div style="display:flex;gap:8px;">
          <select class="input" id="nt-area">
            <option value="work">工作</option>
            <option value="study">学习</option>
            <option value="life">生活</option>
          </select>
          <select class="input" id="nt-follow">
            <option value="auto">看着办（自动关心 · 模糊窗口）</option>
            <option value="remind">到时提醒（承诺必发 · 确切时间）</option>
            <option value="off">别跟进（只记录）</option>
          </select>
        </div>
        <input class="input" id="nt-window" type="datetime-local" title="跟进时间（到时提醒必填，自动关心可留空）">
        <textarea class="input" id="nt-now" rows="3" placeholder="现状或备注…"></textarea>
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost btn-sm" data-act="close-modal">取消</button>
        <button class="btn btn-primary btn-sm" data-act="create-thing-submit">记下来</button>
      </div>
    </div>`;
  }

  return `<div class="scrim" data-act="close-modal"></div>
  <div class="modal" role="dialog" aria-modal="true" aria-label="设置与预算">
    <div class="modal-head">
      <strong class="serif" style="font-size:18px;">设置 · 主动护栏与分项预算</strong>
      <button class="icon-btn" data-act="close-modal">${icon('x')}</button>
    </div>
    <div class="modal-body">
      <div>
        <div class="s-group-title">今日主动引擎分项预算（§4.8.4 · 防止 SKIP 反复烧钱）</div>
        <div class="budget-meters num">
          <div class="budget-cell">
            <b>${S.budget?.evaluated ?? 0} / ${cap * 4}</b>
            <span>护栏评估 (Evaluated)</span>
          </div>
          <div class="budget-cell">
            <b>${S.budget?.generated ?? 0} / ${cap * 2}</b>
            <span>模型生成 (Generated)</span>
          </div>
          <div class="budget-cell">
            <b>${S.budget?.sent ?? 0} / ${cap}</b>
            <span>实际投递 (Sent)</span>
          </div>
        </div>
      </div>

      <div>
        <div class="s-group-title">主动关心与护栏</div>
        <div class="s-group">
          <div class="s-row">
            <div>
              <div>主动关心总开关</div>
              <div class="s-row-sub">关闭后不评估、不生成、不发送自动关心（明确的到时提醒仍生效）</div>
            </div>
            <button class="switch" role="switch" aria-checked="${p.enabled !== false}" data-act="toggle-setting" data-key="proactive.enabled"></button>
          </div>
          <div class="s-row">
            <div>
              <div>主动程度档位</div>
              <div class="s-row-sub">安静时段 ${p.quiet?.start ?? '23:00'}–${p.quiet?.end ?? '08:00'} · 候选 SKIP 冷却 2 小时</div>
            </div>
            <select class="input" style="width:auto;height:32px;" data-act="change-preset">
              ${Object.entries(PRESET_LABELS).map(([k, v]) => `<option value="${k}" ${preset === k ? 'selected' : ''}>${v}</option>`).join('')}
            </select>
          </div>
          <div class="s-row">
            <div>
              <div>没回不追</div>
              <div class="s-row-sub">任一线程 24h 内有未回复的主动消息时不追问；同一事两次未回自动停问</div>
            </div>
            <button class="switch" role="switch" aria-checked="${p.noChaseUnanswered !== false}" data-act="toggle-setting" data-key="proactive.noChaseUnanswered"></button>
          </div>
        </div>
      </div>

      <div>
        <div class="s-group-title">记忆提取与隐私边界</div>
        <div class="s-group">
          <div class="s-row">
            <div>
              <div>从应用内聊天记事</div>
              <div class="s-row-sub">每条消息带原始时间换算相对日期；冲突不合并</div>
            </div>
            <button class="switch" role="switch" aria-checked="${m.learnFromChat !== false}" data-act="toggle-setting" data-key="memory.learnFromChat"></button>
          </div>
          <div class="s-row">
            <div>
              <div>从 Hana 主对话学习</div>
              <div class="s-row-sub">仅收标准主会话；群聊、助手私信、外部平台一律排除</div>
            </div>
            <button class="switch" role="switch" aria-checked="${m.learnFromMain !== false}" data-act="toggle-setting" data-key="memory.learnFromMain"></button>
          </div>
          <div class="s-row">
            <div>
              <div>清理范围</div>
              <div class="s-row-sub">清除全部记忆会移入 .trash/（Hana 宿主原始对话不在可删范围）</div>
            </div>
            <button class="btn btn-secondary btn-xs" data-act="clear-all-memory" style="color:var(--danger);">清除全部记忆</button>
          </div>
        </div>
      </div>

      ${(S.hiddenAgents && S.hiddenAgents.length) ? `
      <div>
        <div class="s-group-title">已收起的助手（${S.hiddenAgents.length}）</div>
        <div class="s-group">
          ${S.hiddenAgents.map(a => `
          <div class="s-row">
            <div>
              <div>${esc(a.name)}</div>
              <div class="s-row-sub">${esc(a.yuan || '')} · 仅从左栏收起，聊天记录与记忆均保留</div>
            </div>
            <button class="btn btn-ghost btn-xs" data-act="unhide-agent" data-id="${esc(a.id)}">恢复</button>
          </div>`).join('')}
        </div>
      </div>` : ''}
    </div>
    <div class="modal-foot">
      <span style="font-size:var(--fs-hint);color:var(--sy-text-2);">数据保存在本机 data 目录</span>
      <button class="btn btn-primary btn-sm" data-act="close-modal">完成</button>
    </div>
  </div>`;
}

/* ───────────────── 8. 顶层渲染与事件委托 ───────────────── */
const appEl = document.getElementById('app');

function render() {
  if (S.loading) {
    appEl.innerHTML = `<div class="workspace-wrap"><div style="padding:32px;color:var(--sy-text-2);">拾遗加载中…</div></div>`;
    return;
  }
  if (S.bootError) {
    appEl.innerHTML = `<div class="workspace-wrap"><div style="padding:32px;color:var(--sy-text-2);">拾遗暂不可用：${esc(S.bootError)}</div></div>`;
    return;
  }

  const wsClass = [
    'workspace',
    S.form === 'mini' ? 'form-mini' : '',
    !S.rightOpen ? 'right-collapsed' : ''
  ].filter(Boolean).join(' ');

  appEl.innerHTML = `
    <div class="workspace-wrap">
      <div class="${wsClass}">
        ${renderLeftCol()}
        ${renderCenterCol()}
        ${renderRightCol()}
      </div>
    </div>
    ${renderDrawer()}
    ${renderModal()}
    ${S.toast ? `<div class="toast" role="status">
      <span>${esc(S.toast)}</span>
      ${S.undoAction ? `<button data-act="undo-toast">撤销</button>` : ''}
    </div>` : ''}
  `;
}

appEl.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;

  switch (act) {
    case 'open-onboarding':
      S.modal = 'onboarding';
      S.onboardStep = 1;
      return render();
    case 'onboard-next':
      S.onboardStep = Math.min(3, S.onboardStep + 1);
      return render();
    case 'onboard-prev':
      S.onboardStep = Math.max(1, S.onboardStep - 1);
      return render();
    case 'onboard-main':
      if (S.settings) S.settings.memory.learnFromMain = btn.dataset.val === '1';
      return render();
    case 'onboard-preset':
      if (S.settings) {
        S.settings.proactive.preset = btn.dataset.val;
        S.settings.proactive.enabled = btn.dataset.val !== 'off';
        S.settings.proactive.dailyCap = btn.dataset.val === 'active' ? 12 : btn.dataset.val === 'moderate' ? 6 : 3;
      }
      return render();
    case 'finish-onboarding':
      api('/api/onboarding', {
        method: 'POST',
        body: {
          learnFromMain: !!(S.settings?.memory?.learnFromMain),
          preset: S.settings?.proactive?.preset ?? 'restrained',
        },
      }).then((r) => {
        if (r.ok && r.settings) S.settings = r.settings;
        S.modal = null;
        showToast('引导完成，拾遗开始工作');
      });
      return;
    case 'skip-onboarding':
      api('/api/onboarding', { method: 'POST', body: { learnFromMain: false, preset: 'off' } }).then(() => {
        S.modal = null;
        showToast('已跳过引导：采用保守默认（不学主对话、不主动开口）');
      });
      return;

    case 'pick-agent': {
      S.activeAgentId = btn.dataset.id;
      const ag = currentAgent();
      if (ag) ag.unread = 0;
      render();
      loadThread(S.activeAgentId).then(() => { render(); scrollChatBottom(); });
      return;
    }
    case 'hide-agent': {
      const id = btn.dataset.id;
      const name = (S.agents.find(a => a.id === id) || (S.hiddenAgents || []).find(a => a.id === id))?.name ?? '该助手';
      api(`/api/agents/${encodeURIComponent(id)}/hide`, { method: 'POST' }).then(async () => {
        await loadAll();
        // 若收起的是当前助手，切到首个可见
        if (S.activeAgentId === id) S.activeAgentId = S.agents[0]?.id ?? null;
        render();
        showToast(`已收起「${name}」`, async () => { await api(`/api/agents/${encodeURIComponent(id)}/unhide`, { method: 'POST' }); await loadAll(); render(); });
      });
      return;
    }
    case 'unhide-agent': {
      const id = btn.dataset.id;
      api(`/api/agents/${encodeURIComponent(id)}/unhide`, { method: 'POST' }).then(async () => { await loadAll(); render(); });
      return;
    }
    case 'toggle-strip': {
      const target = btn.dataset.target;
      S.stripOpen = S.stripOpen === target ? null : target;
      S.editingRecentId = null;
      S.reschedulingId = null;
      return render();
    }
    case 'close-strip':
      S.stripOpen = null;
      return render();
    case 'open-mini-things':
      S.stripOpen = S.stripOpen === 'upcoming' ? null : 'upcoming';
      return render();
    case 'toggle-right':
      S.rightOpen = !S.rightOpen;
      return render();
    case 'right-tab':
      S.rightTab = btn.dataset.tab;
      return render();
    case 'set-area':
      S.areaFilter = btn.dataset.area;
      return render();

    case 'edit-recent':
      S.editingRecentId = S.editingRecentId === btn.dataset.id ? null : btn.dataset.id;
      return render();
    case 'cancel-edit-recent':
      S.editingRecentId = null;
      return render();
    case 'save-edit-recent': {
      const id = btn.dataset.id;
      const type = btn.dataset.type;
      const title = document.getElementById('re-title-' + id)?.value.trim();
      const body = document.getElementById('re-body-' + id)?.value.trim();
      if (type === 'thing') {
        const patch = {};
        if (title) patch.title = title;
        if (body !== undefined) patch.now = body;
        const area = document.getElementById('re-area-' + id)?.value;
        const st = document.getElementById('re-status-' + id)?.value;
        if (area) patch.area = area;
        if (st) patch.status = st;
        api(`/api/things/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }).then((r) => {
          if (r.ok) { S.editingRecentId = null; showToast('已保存纠正'); refreshThings(); }
        });
      } else {
        const patch = {};
        if (title) patch.title = title;
        if (body !== undefined) patch.content = body;
        api(`/api/notes/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }).then((r) => {
          if (r.ok) { S.editingRecentId = null; showToast('已保存纠正'); refreshNotes(); }
        });
      }
      return;
    }
    case 'delete-recent': {
      const id = btn.dataset.id;
      const type = btn.dataset.type;
      const title = type === 'thing' ? thingById(id)?.title : noteById(id)?.title;
      if (type === 'thing') {
        api(`/api/things/${encodeURIComponent(id)}`, { method: 'DELETE' }).then((r) => {
          if (!r.ok) return;
          if (S.drawerItem?.id === id) S.drawerItem = null;
          showToast(`已删除「${title ?? ''}」并写入排除记录，重启或回填不再提取`);
          refreshThings();
        });
      } else {
        api(`/api/notes/${encodeURIComponent(id)}`, { method: 'DELETE' }).then((r) => {
          if (!r.ok) return;
          if (S.drawerItem?.id === id) S.drawerItem = null;
          showToast(`已删除「${title ?? ''}」并写入排除记录`);
          refreshNotes();
        });
      }
      return;
    }

    case 'toggle-reschedule':
      S.reschedulingId = S.reschedulingId === btn.dataset.id ? null : btn.dataset.id;
      return render();
    case 'apply-reschedule': {
      const id = btn.dataset.id;
      const t = thingById(id);
      const hours = +btn.dataset.hours || 72;
      if (t) {
        const at = new Date(Date.now() + hours * 3600_000).toISOString();
        api(`/api/things/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: { followUpAt: at, snoozedUntil: null },
        }).then((r) => {
          if (!r.ok) return;
          S.reschedulingId = null;
          showToast('已更新跟进时间安排');
          refreshThings();
        });
      }
      return;
    }
    case 'toggle-followup-mode': {
      const id = btn.dataset.id;
      const t = thingById(id);
      if (t) {
        const next = t.followUp === 'remind' ? 'auto' : 'remind';
        api(`/api/things/${encodeURIComponent(id)}`, { method: 'PATCH', body: { followUp: next } }).then((r) => {
          if (!r.ok) return;
          S.reschedulingId = null;
          showToast(next === 'remind' ? '已切换为「到时提醒」（准点必发）' : '已切换为「自动关心」（模糊窗口）');
          refreshThings();
        });
      }
      return;
    }
    case 'snooze-thing': {
      const id = btn.dataset.id;
      api(`/api/things/${encodeURIComponent(id)}/snooze`, { method: 'POST', body: { hours: 72 } }).then((r) => {
        if (!r.ok) return;
        showToast('已暂停自动关心 3 天');
        refreshThings();
      });
      return;
    }
    case 'unsnooze-thing': {
      const id = btn.dataset.id;
      api(`/api/things/${encodeURIComponent(id)}/snooze`, { method: 'POST', body: { hours: 0 } }).then((r) => {
        if (!r.ok) return;
        showToast('已恢复自动跟进');
        refreshThings();
      });
      return;
    }
    case 'ask-now': {
      const id = btn.dataset.id;
      api(`/api/things/${encodeURIComponent(id)}/ask-now`, { method: 'POST', body: {} }).then(async (r) => {
        if (!r.ok) return;
        S.drawerItem = null;
        S.stripOpen = null;
        showToast('已在聊天里发起跟进');
        await refreshThings();
        if (S.activeAgentId) await loadThread(S.activeAgentId);
        render();
        scrollChatBottom();
      });
      return;
    }

    case 'global-snooze':
    case 'proactive-snooze-global':
      // 「稍后再说」全局 snooze 4h（§4.8.6；只停 auto，不动 remind）
      api('/api/things', { method: 'GET' }).then(() => {});
      S.globalSnoozeUntil = Date.now() + 4 * 3600_000;
      showToast('已开启全局「稍后再说」（4 小时）');
      return;
    case 'clear-global-snooze':
      S.globalSnoozeUntil = null;
      showToast('已恢复自动关心');
      return;
    case 'proactive-snooze-thing': {
      const tid = btn.dataset.id;
      if (!tid) return;
      api(`/api/things/${encodeURIComponent(tid)}/snooze`, { method: 'POST', body: { hours: 72 } }).then(async (r) => {
        if (!r.ok) return;
        showToast('已暂停这件事的自动跟进 3 天');
        await refreshThings();
      });
      return;
    }

    case 'confirm-handoff':
    case 'save-confirm-handoff': {
      const hid = btn.dataset.id;
      const body = {};
      if (act === 'save-confirm-handoff') {
        body.request = document.getElementById('handoff-edit-' + hid)?.value.trim();
      }
      api(`/api/handoffs/${encodeURIComponent(hid)}/confirm`, { method: 'POST', body }).then(async (r) => {
        if (!r.ok) return;
        showToast('已在 Hana 里开启主对话');
        if (S.activeAgentId) await loadThread(S.activeAgentId);
        render();
        scrollChatBottom();
      });
      return;
    }
    case 'edit-handoff': {
      const hid = btn.dataset.id;
      const th = S.threads[S.activeAgentId];
      const msg = th?.messages.find(m => m.meta?.handoff?.id === hid);
      if (msg) msg.meta.handoff.status = 'editing';
      return render();
    }
    case 'cancel-edit-handoff': {
      const hid = btn.dataset.id;
      const th = S.threads[S.activeAgentId];
      const msg = th?.messages.find(m => m.meta?.handoff?.id === hid);
      if (msg) msg.meta.handoff.status = 'pending';
      return render();
    }
    case 'cancel-handoff': {
      const hid = btn.dataset.id;
      api(`/api/handoffs/${encodeURIComponent(hid)}/cancel`, { method: 'POST', body: {} }).then(async (r) => {
        if (!r.ok) return;
        if (S.activeAgentId) await loadThread(S.activeAgentId);
        render();
      });
      return;
    }
    case 'copy-handoff': {
      const hid = btn.dataset.id;
      const th = S.threads[S.activeAgentId];
      const msg = th?.messages.find(m => m.meta?.handoff?.id === hid);
      const req = msg?.meta?.handoff?.request ?? '';
      if (req) {
        if (navigator.clipboard?.writeText) navigator.clipboard.writeText(req);
        showToast('已复制交接需求到剪贴板');
      }
      return;
    }

    case 'quick-handoff': {
      const agent = currentAgent();
      if (!agent) return;
      // 从当前最近一条事项取背景，没有就空背景
      const t = S.things.find(x => x.owner === agent.id && (x.status === 'active' || x.status === 'waiting')) || S.things[0];
      const title = t ? t.title : '新任务';
      const bg = t
        ? `这件事：${t.title}（${AREA_LABELS[t.area] ?? ''}·${STATUS_LABELS[t.status] ?? ''}）\n现状：${t.now ?? ''}`
        : '';
      // 交给 Hana 的卡由后端 handoff.createCard 写入线程，这里先走聊天发一条命令式消息；
      // 当前后端无独立 createCard 端点，退化为在聊天里说明（确认卡仍由提取/工具产生）。
      const input = document.getElementById('chat-input');
      if (input) {
        input.value = `把「${title}」交给 Hana 主对话：`;
        input.focus();
      }
      showToast('在输入框里补一句要 Hana 做的事，发送后会记下交接意向');
      void bg;
      return;
    }
    case 'send-msg':
      sendUserMessage();
      return;
    case 'load-archive':
      (async () => {
        const th = S.threads[S.activeAgentId];
        const first = th?.messages[0];
        if (!first) return;
        const r = await api(`/api/threads/${encodeURIComponent(S.activeAgentId)}?before=${first.seq}&limit=100`);
        if (r.ok && r.earlier?.length) {
          S.threads[S.activeAgentId].messages = [...r.earlier, ...th.messages];
          S.threads[S.activeAgentId].hasMore = r.earlier.length >= 50;
          render();
        } else {
          showToast('没有更早的归档记录了');
        }
      })();
      return;

    case 'open-drawer':
      S.drawerItem = { type: btn.dataset.type, id: btn.dataset.id };
      return render();
    case 'close-drawer':
      S.drawerItem = null;
      return render();
    case 'save-drawer-thing': {
      const id = btn.dataset.id;
      const now = document.getElementById('d-thing-now')?.value.trim();
      api(`/api/things/${encodeURIComponent(id)}`, { method: 'PATCH', body: { now } }).then((r) => {
        if (!r.ok) return;
        S.drawerItem = null;
        showToast('已保存事项修改');
        refreshThings();
      });
      return;
    }
    case 'save-drawer-note': {
      const id = btn.dataset.id;
      const content = document.getElementById('d-note-content')?.value.trim();
      api(`/api/notes/${encodeURIComponent(id)}`, { method: 'PATCH', body: { content } }).then((r) => {
        if (!r.ok) return;
        S.drawerItem = null;
        showToast('已保存知卡片');
        refreshNotes();
      });
      return;
    }
    case 'new-thing':
      S.modal = 'newThing';
      return render();
    case 'create-thing-submit': {
      const title = document.getElementById('nt-title')?.value.trim();
      if (!title) { showToast('请填写事项标题'); return; }
      const area = document.getElementById('nt-area')?.value || 'work';
      const followUp = document.getElementById('nt-follow')?.value || 'auto';
      const win = document.getElementById('nt-window')?.value;
      const now = document.getElementById('nt-now')?.value.trim() || '';
      const body = { title, area, status: 'active', followUp, now };
      if (win) body.followUpAt = new Date(win).toISOString();
      api('/api/things', { method: 'POST', body }).then((r) => {
        if (!r.ok) return;
        S.modal = null;
        showToast('已记下新事项');
        refreshThings();
      });
      return;
    }
    case 'open-settings':
      refreshBudget().then(() => { S.modal = 'settings'; render(); });
      return;
    case 'close-modal':
      S.modal = null;
      return render();
    case 'toggle-setting': {
      const key = btn.dataset.key;
      const path = key.split('.');
      const obj = path.slice(0, -1).reduce((o, k) => o?.[k], S.settings);
      if (!obj) return;
      const leaf = path.at(-1);
      const next = obj[leaf] === false ? true : false;
      api('/api/settings', { method: 'PATCH', body: { [key]: next } }).then((r) => {
        if (r.ok && r.settings) { S.settings = r.settings; render(); }
      });
      return;
    }
    case 'change-preset': {
      // change 事件里处理
      return;
    }
    case 'clear-all-memory':
      api('/api/memory/clear', { method: 'POST', body: { includeChats: false } }).then(async (r) => {
        if (!r.ok) return;
        S.modal = null;
        showToast('已将全部事、知与排除记录移入 .trash/（聊天记录保留）');
        await loadAll();
      });
      return;
    case 'undo-toast':
      if (typeof S.undoAction === 'function') S.undoAction();
      S.toast = null;
      S.undoAction = null;
      return render();
  }
});

appEl.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.act === 'mini-select-agent') {
    S.activeAgentId = el.value;
    render();
    loadThread(S.activeAgentId).then(() => { render(); scrollChatBottom(); });
  } else if (el.dataset.act === 'change-thing-status') {
    const id = el.dataset.id;
    api(`/api/things/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status: el.value } }).then((r) => {
      if (r.ok) { showToast('已更新状态'); refreshThings(); }
    });
  } else if (el.dataset.act === 'change-thing-followup') {
    const id = el.dataset.id;
    api(`/api/things/${encodeURIComponent(id)}`, { method: 'PATCH', body: { followUp: el.value } }).then((r) => {
      if (r.ok) { showToast('已更新跟进方式'); refreshThings(); }
    });
  } else if (el.dataset.act === 'change-thing-owner') {
    const id = el.dataset.id;
    api(`/api/things/${encodeURIComponent(id)}`, { method: 'PATCH', body: { owner: el.value } }).then((r) => {
      if (r.ok) { showToast('已更换负责助手'); refreshThings(); }
    });
  } else if (el.dataset.act === 'change-preset') {
    const preset = el.value;
    const dailyCap = preset === 'active' ? 12 : preset === 'moderate' ? 6 : 3;
    api('/api/settings', { method: 'PATCH', body: { 'proactive.preset': preset, 'proactive.dailyCap': dailyCap } }).then((r) => {
      if (r.ok && r.settings) { S.settings = r.settings; render(); }
    });
  }
});

appEl.addEventListener('input', (e) => {
  if (e.target.id === 'note-search') {
    S.noteQuery = e.target.value;
    render();
    const input = document.getElementById('note-search');
    if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
  }
});

appEl.addEventListener('keydown', (e) => {
  // IME 守卫：中文/日文输入法候选窗按 Enter 是「选词上屏」，不是发送（CDS 强制）
  if (e.target.id === 'chat-input' && e.key === 'Enter' && !e.shiftKey
      && !(e.nativeEvent?.isComposing || e.isComposing || e.keyCode === 229)) {
    e.preventDefault();
    sendUserMessage();
  } else if (e.key === 'Escape') {
    if (S.modal) { S.modal = null; render(); }
    else if (S.drawerItem) { S.drawerItem = null; render(); }
    else if (S.stripOpen) { S.stripOpen = null; render(); }
  }
});

/* ───────────────── 9. 发送消息（§4.13：POST /api/threads/:agentId/messages） ───────────────── */
async function sendUserMessage() {
  const input = document.getElementById('chat-input');
  if (!input || S.sending) return;
  const text = input.value.trim();
  if (!text) return;
  const agent = currentAgent();
  if (!agent) return;
  const clientId = 'c_' + Date.now().toString(36);
  const th = S.threads[agent.id] || (S.threads[agent.id] = { messages: [], unread: 0, hasMore: false });
  th.messages.push({ seq: 0, role: 'user', text, at: new Date().toISOString(), clientId });
  input.value = '';
  S.sending = true;
  render();
  scrollChatBottom();
  try {
    const r = await api(`/api/threads/${encodeURIComponent(agent.id)}/messages`, {
      method: 'POST', body: { text, clientId },
    });
    if (r.ok && r.turnId) {
      // 批 4：启动打字机轮询，等流结束再 loadThread 全量刷新
      startStreaming(agent.id, r.turnId);
      return; // finally 里不再立即 render/loadThread
    }
    if (r.ok) {
      await loadThread(agent.id);
      await Promise.all([refreshThings(), refreshNotes()]);
    }
  } finally {
    if (!S.streaming) { // 流模式已接管时不动
      S.sending = false;
      render();
      scrollChatBottom();
    }
  }
}

// ── 流式打字机（批 4）：轮询 /api/threads/:id 的 generating.partial ────────────
const STREAM_POLL_MS = 700;
let streamTimer = null;

function startStreaming(agentId, turnId) {
  stopStreaming(); // 防重复
  S.streaming = { agentId, turnId, partial: '', lastDeltaAt: Date.now() };
  S.sending = false; // 发送态转流态
  render();
  scrollChatBottom();

  const tick = async () => {
    if (!S.streaming || S.streaming.turnId !== turnId) return; // 已被切换/停止
    const th = S.threads[agentId];
    const lastSeq = th?.messages?.at(-1)?.seq ?? 0;
    try {
      const r = await api(`/api/threads/${encodeURIComponent(agentId)}?after=${lastSeq}&limit=50`);
      if (!S.streaming || S.streaming.turnId !== turnId) return;
      if (r.ok) {
        // 1) 收已落定的新消息（assistant 分条/系统行）
        if (Array.isArray(r.messages) && r.messages.length) {
          const existing = new Set((th?.messages ?? []).map((m) => m.seq));
          for (const m of r.messages) {
            if (!existing.has(m.seq)) th.messages.push(m);
          }
        }
        // 2) 更新打字机
        if (r.generating && r.generating.turnId === turnId) {
          if (r.generating.partial !== S.streaming.partial) {
            S.streaming.partial = r.generating.partial;
            S.streaming.lastDeltaAt = Date.now();
            updateStreamingBubble(); // 局部 DOM 更新，不整页 render
          }
        } else {
          // generating 消失 → 流结束
          stopStreaming();
          await loadThread(agentId);
          await Promise.all([refreshThings(), refreshNotes()]);
          render();
          scrollChatBottom();
          return;
        }
      }
    } catch {}
    streamTimer = setTimeout(tick, STREAM_POLL_MS);
  };
  streamTimer = setTimeout(tick, STREAM_POLL_MS);
}

function stopStreaming() {
  if (streamTimer) { clearTimeout(streamTimer); streamTimer = null; }
  S.streaming = null;
}

/** 局部 DOM 更新：只改流式气泡的文本，不整页 render（避免打字机重置输入框） */
function updateStreamingBubble() {
  if (!S.streaming) return;
  const el = document.querySelector(`[data-stream-turn="${S.streaming.turnId}"] .bubble-stream`);
  if (!el) {
    render(); // 气泡还没渲染出来（比如刚切回来）→ 整页 render 兜底
    scrollChatBottom();
    return;
  }
  const partial = S.streaming.partial || '…';
  // 保留 caret span
  const caret = el.querySelector('.stream-caret');
  el.textContent = partial;
  if (caret) el.appendChild(caret);
  else {
    const c = document.createElement('span');
    c.className = 'stream-caret';
    el.appendChild(c);
  }
  scrollChatBottom();
}

function scrollChatBottom() {
  const stream = document.getElementById('chat-stream');
  if (stream) stream.scrollTop = stream.scrollHeight;
}

/* ───────────────── 10. boot ───────────────── */
window.addEventListener('resize', () => {
  const next = detectForm();
  const wasOverlay = rightIsOverlay(S.form);
  const nextOverlay = rightIsOverlay(next);
  if (next !== S.form || nextOverlay !== wasOverlay) {
    // 跨过 1120px 断点：右栏从占列变抽屉时默认收起，回到宽屏时默认展开
    S.form = next;
    S.rightOpen = !nextOverlay;
    render();
  }
});
render();
loadAll().then(() => {
  scrollChatBottom();
  // 在场租约：面板打开期间宿主可据此不挂横幅（§4.8.5）
  api('/api/presence', { method: 'POST', body: { sessionPath: surfaceSession || null } });
  // 未引导 → 弹三步引导
  if (S.settings && !S.settings.onboarded) {
    S.modal = 'onboarding';
    S.onboardStep = 1;
    render();
  }
});
})();
