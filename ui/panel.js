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

const REASON_LABELS = {
  remind_due: '到时提醒', followup_due: '工作跟进', handoff_result: '交接结果',
  recent_work: '主对话近况', followup_stale: '久未提起', study_review: '学习回顾', chitchat: '闲聊',
  ask_now: '现在问问', missed_merge: '停机补发',
};
const DAY_MS = 24 * 3600_000;

/* 宿主不保留卡片 route 上的 query（route 不得含 ?），小窗形态按视口宽度判定（PLAN §2 备注的退路）。
   阈值与 panel.css 的 640px 断点一致。 */
const MINI_MAX_WIDTH = 640;
function detectForm() {
  const q = qs.get('form');
  if (q === 'mini') return 'mini';
  if (q === 'page') return 'page';
  return window.innerWidth <= MINI_MAX_WIDTH ? 'mini' : 'page';
}

/* ───────────────── 4. 状态（初始为空，boot 后从接口拉取） ───────────────── */
const S = {
  form: detectForm(),                            // 整页两栏 | 并排小窗
  activeAgentId: null,
  modal: null,                // null | 'onboarding'（设置已迁至 settings.html）
  onboardStep: 1,
  globalSnoozeUntil: null,    // 时间戳 ms（「稍后再说」）
  toast: null,
  undoAction: null,
  sending: false,             // 发送中防重入
  streaming: null,            // null | { agentId, turnId, partial, lastDeltaAt } 批 4 打字机

  settings: null,             // { onboarded, proactive{enabled,preset,dailyCap,minGapMinutes,quiet{...},noChaseUnanswered,...}, memory{learnFromChat,learnFromMain}, ... }
  agents: [],                 // [{id,name,yuan,chatModel,memoryEnabled,proactiveEnabled,unread}]
  threads: {},                // agentId -> { messages:[{seq,role,text,at,meta?}], unread, hasMore }
  budget: null,               // { evaluated, generated, sent }
  loading: true,
  bootError: null,            // 应用不可用时显示原因
};

/* ───────────────── 5. 辅助计算 ───────────────── */
function currentAgent() {
  return S.agents.find(a => a.id === S.activeAgentId) || S.agents[0] || null;
}
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
    S.globalSnoozeUntil = ov.snoozedUntil || null; // 后端持久化在 proactive-state，刷新回填
    if (!S.activeAgentId && S.agents.length) S.activeAgentId = S.agents[0].id;
    S.bootError = null;
  }
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
          : `<button class="btn btn-ghost btn-sm" data-act="open-settings" title="设置">${icon('gear')}</button>`
        }
      </div>
    </header>

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
    return `<div class="sys-row"><span>${esc(m.text)}</span></div>`;
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
  const bubbles = (m.text ?? '').split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);

  return `<div class="msg-group ${m.role === 'user' ? 'user' : 'assistant'} ${isProactive ? 'proactive' : ''}">
    <div class="msg-meta">
      <span>${m.role === 'user' ? '你' : esc(agent?.name ?? '')}</span>
      <span>·</span>
      <span class="num">${esc(relTime(m.at))}</span>
      ${isProactive ? `<span class="badge badge-accent">${esc(REASON_LABELS[pro?.reason] ?? pro?.reason ?? '主动')}</span>` : ''}
    </div>
    ${bubbles.map(b => `<div class="bubble">${esc(b)}</div>`).join('')}
    ${isProactive ? `<div class="proactive-foot">
      <button class="proactive-link" data-act="proactive-snooze-global" title="全局暂停自动关心 4 小时（不影响你设的准点提醒）">稍后再说</button>
      <span>·</span>
      <button class="proactive-link" data-act="proactive-snooze-thing" data-id="${esc(pro?.thingId || '')}" title="这件事暂停自动跟进 3 天">这件先不问了</button>
    </div>` : ''}
  </div>`;
}

/* 7.4 首次引导（设置与预算已迁至 settings.html） */
function renderModal() {
  if (!S.modal) return '';
  const m = S.settings?.memory ?? {};
  const preset = S.settings?.proactive?.preset ?? 'restrained';

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
}

/* 7.5 设置页（iframe 嵌入式）：齿轮打开 settings.html，页内改完自己 postMessage 关闭。
   视图挂在 body 上而非 #app 内，改设置引发的 render() 不会重载 iframe。 */
let settingsViewEl = null;
function settingsSrc() {
  const p = new URLSearchParams();
  if (surfaceSession) p.set('appSurfaceSession', surfaceSession);
  const theme = qs.get('hana-theme');
  if (theme) p.set('hana-theme', theme);
  return `settings.html?${p}`;
}
function openSettings() {
  if (!settingsViewEl) {
    settingsViewEl = document.createElement('div');
    settingsViewEl.className = 'settings-view';
    const frame = document.createElement('iframe');
    frame.className = 'settings-frame';
    frame.title = '拾遗设置';
    settingsViewEl.appendChild(frame);
    document.body.appendChild(settingsViewEl);
  }
  settingsViewEl.querySelector('iframe').src = settingsSrc();
  settingsViewEl.classList.add('open');
}
function closeSettings() {
  settingsViewEl?.classList.remove('open');
  loadAll(); // 设置页可能改过开关 / 收起助手，回到面板时刷新
}
window.addEventListener('message', (e) => {
  if (e.data?.type === 'shiyi:close-settings'
      && settingsViewEl && e.source === settingsViewEl.querySelector('iframe')?.contentWindow) {
    closeSettings();
  }
});

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

  const wsClass = ['workspace', S.form === 'mini' ? 'form-mini' : ''].filter(Boolean).join(' ');

  appEl.innerHTML = `
    <div class="workspace-wrap">
      <div class="${wsClass}">
        ${renderLeftCol()}
        ${renderCenterCol()}
      </div>
    </div>
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
    case 'proactive-snooze-global':
      // 「稍后再说」全局 snooze 4h（§4.8.6；只停 auto，不动 remind）
      api('/api/proactive/snooze', { method: 'POST', body: { hours: 4 } }).then((r) => {
        if (!r.ok) return;
        S.globalSnoozeUntil = r.until || null;
        showToast('已开启全局「稍后再说」（4 小时）');
      });
      return;
    case 'clear-global-snooze':
      api('/api/proactive/snooze', { method: 'POST', body: { hours: 0 } }).then((r) => {
        if (!r.ok) return;
        S.globalSnoozeUntil = null;
        showToast('已恢复自动关心');
      });
      return;
    case 'proactive-snooze-thing': {
      const tid = btn.dataset.id;
      if (!tid) return;
      api(`/api/things/${encodeURIComponent(tid)}/snooze`, { method: 'POST', body: { hours: 72 } }).then((r) => {
        if (!r.ok) return;
        showToast('已暂停这件事的自动跟进 3 天');
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
      if (!currentAgent()) return;
      // 交给 Hana 的卡由后端 handoff.createCard 写入线程，这里先走聊天发一条命令式消息；
      // 当前后端无独立 createCard 端点，退化为在聊天里说明（确认卡仍由提取/工具产生）。
      const input = document.getElementById('chat-input');
      if (input) {
        input.value = '交给 Hana 主对话：';
        input.focus();
      }
      showToast('在输入框里补一句要 Hana 做的事，发送后会记下交接意向');
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

    case 'open-settings':
      openSettings();
      return;
    case 'close-modal':
      S.modal = null;
      return render();
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
    if (r.ok) await loadThread(agent.id);
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
  if (next !== S.form) {
    S.form = next;
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
