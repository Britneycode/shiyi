// 常量、默认设置、预设档位、敏感信息正则。只读，不写。

export const APP_ID = "shiyi";
export const APP_NAME = "拾遗";

// ── 预设档位（§5）：发送 / 生成 / 评估 / 最短间隔（分钟）──────────────────────
export const PRESETS = {
  restrained: { label: "克制", dailyCap: 3, minGapMinutes: 120 },
  moderate:   { label: "适中", dailyCap: 6, minGapMinutes: 60 },
  active:     { label: "积极", dailyCap: 12, minGapMinutes: 30 },
};
// 预算分项倍数（§4.8.4）：evaluated = 发送×4；generated = 发送×2
export const BUDGET_EVALUATED_MULT = 4;
export const BUDGET_GENERATED_MULT = 2;
// SKIP 冷却（§4.8.3）：同一候选 2 小时内无新变化不重评
export const SKIP_COOLDOWN_MS = 2 * 60 * 60_000;
// 全局/事项级 snooze（§4.8.6）
export const GLOBAL_SNOOZE_MS = 4 * 60 * 60_000;      // 稍后再说：全局 4h
export const THING_SNOOZE_MS = 3 * 24 * 60 * 60_000;  // 这件先不问了：3 天
// 主动引擎
export const PROACTIVE_TICK_MS = 5 * 60_000;          // 5 分钟一轮
export const PROACTIVE_BOOT_DELAY_MS = 90_000;        // 启动 90s 首检
export const MISSED_MERGE_WINDOW_MS = 24 * 60 * 60_000; // 停机补发：逾期 ≤24h 合并为一条
// 提取
export const EXTRACT_MAX_TOKENS = 1500;
export const EXTRACT_RETRY_MAX_TOKENS = 3000;
export const EXTRACT_TIMEOUT_MS = 60_000;
export const EXTRACT_QUEUE_MAX = 20;
// 聊天
export const CHAT_MAX_TOKENS = 900;
export const CHAT_RETRY_MAX_TOKENS = 1800;
export const CHAT_TEMPERATURE = 0.8;
export const CHAT_TIMEOUT_MS = 90_000;
export const CHAT_HISTORY_MAX_MSGS = 24;
export const CHAT_HISTORY_MAX_CHARS = 6000;
export const SUMMARY_TRIGGER_MSGS = 40;   // 未摘要消息超此数触发滚动摘要
export const SUMMARY_BATCH_MSGS = 20;     // 每次并入最旧 20 条
export const THREAD_KEEP_MSGS = 1000;     // 线程文件保留最近条数，更早归档
export const EVIDENCE_MAX_CHARS = 60;     // 证据片段上限（§4.12 证据最小化）
// 主对话缓冲（§4.5）
export const MAINFEED_MAX_EVENTS = 240;
export const MAINFEED_EVENT_MAX_CHARS = 800;
export const MAINFEED_BATCH_QUIET_MS = 3 * 60_000; // 最后一条 assistant 后静 3 分钟出批
// 在场租约 / 横幅
export const PANEL_OPEN_MS = 75_000;      // 在场租约 75s
export const PRESENCE_HEARTBEAT_MS = 30_000;
// 聊天注入预算（字符）
export const BUDGET_PERSONA = 6000;       // 人格块
export const BUDGET_ABOUT_USER = 2700;    // 关于用户（pinned+facts，记忆关时省略）
export const BUDGET_THINGS = 1500;        // 手上的事
export const BUDGET_NOTES = 1200;         // 相关的知
export const BUDGET_MAINFEED = 800;       // 主对话近况
export const BUDGET_SUMMARY = 800;        // 滚动摘要
export const PROMPT_FRAME_CHARS = 500;    // 框架（固定）
// 人格文件预算（§4.1）
export const PERSONA_FILE_BUDGETS = {
  "identity.md": 2000,
  "description.md": 600,
  "AGENTS.public.md": 1500,
  "pinned.md": 1200,          // 记忆关闭时不读
  "memory/facts.md": 1500,    // 记忆关闭时不读
  "experience.md": 600,
};
// 缓存
export const AGENT_LIST_CACHE_MS = 10 * 60_000;
export const PROFILE_CACHE_MS = 10 * 60_000;
export const MEMORY_POLICY_CACHE_MS = 60_000;
export const PERSONA_CACHE_MS = 10 * 60_000;
export const OVERVIEW_RECONCILE_THROTTLE_MS = 30_000; // GET /api/overview 触发对账节流
export const TOOL_SUPPORT_FORGET_MS = 24 * 60 * 60_000; // 记住「该 provider+model 不支持工具」24h

// 事的区域 / 状态 / 跟进方式（§4.3）
export const AREAS = ["work", "study", "life"];
export const AREA_LABELS = { work: "工作", study: "学习", life: "生活" };
export const THING_STATUS = ["active", "waiting", "done", "dropped"];
export const THING_STATUS_LABELS = { active: "进行中", waiting: "等待", done: "完成", dropped: "放下" };
export const FOLLOW_UP = ["auto", "remind", "off"];
export const FOLLOW_UP_LABELS = { auto: "看着办", remind: "到时提醒", off: "别跟进" };
// 知的六类（沿用 v7）
export const NOTE_KINDS = ["knowledge", "howto", "experience", "life", "idea", "person"];
export const NOTE_KIND_LABELS = {
  knowledge: "知识", howto: "做法", experience: "经验", life: "生活", idea: "灵感", person: "人与约定",
};
// 由头类别（§4.8.1）与设置键
export const REASONS = ["remind_due", "followup_due", "handoff_result", "recent_work", "followup_stale", "study_review", "chitchat"];
// 默认设置（§5）
export function defaultSettings() {
  return {
    onboarded: false,
    hiddenAgentIds: [],          // 软删（收起）的助手 id，面板左栏过滤，可恢复
    proactive: {
      enabled: false,           // 引导选择；跳过 = false（保守）
      preset: "restrained",
      dailyCap: PRESETS.restrained.dailyCap,
      minGapMinutes: PRESETS.restrained.minGapMinutes,
      quiet: { enabled: true, start: "23:00", end: "08:00" },
      noChaseUnanswered: true,
      categories: { work: true, life: true, study: true, recentWork: true, chitchat: false },
      studyEveryDays: 2,
      agents: {},               // <agentId>: bool，聊过天默认 true
    },
    memory: {
      learnFromChat: true,
      learnFromMain: false,     // 引导选择；未回答视为关
      scope: "shared",          // shared | per-agent
      extractDailyCap: 120,
    },
  };
}

// 敏感信息正则（沿用 v7，参照宿主 lib/pii-guard.ts）。命中即 `sensitive` 丢弃。
export const SECRET_PATTERNS = [
  /(?:password|passwd|pwd)\s*[:=]\s*\S+/i,        // 密码
  /(?:api[_-]?key|apikey|token|secret)\s*[:=]\s*\S+/i, // 密钥/令牌
  /\b(?:sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|xox[bap]-[A-Za-z0-9-]{10,})\b/, // 常见 token 形态
  /\b\d{17}[\dXx]\b/,                              // 身份证号
  /\b\d{16,19}\b/,                                 // 银行卡号
  /\b1[3-9]\d{9}\b/,                               // 手机号
  /\b(?:验证码|动态码)\s*[:：]?\s*\d{4,8}\b/,        // 验证码
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,            // 私钥
];

// 完成 / 放弃类词（§4.4.2 weak_status 判定）
export const DONE_WORDS = /(完成|做完|搞定了|交付|交了|提交了|结束了|弄好了|办好了)/;
export const DROPPED_WORDS = /(不做了|放弃|取消|算了|搁置|停了|不去了|不学了)/;

// 否定 / 版本 / 数字 / 日期冲突检查（§4.4.3 L3.5）
export const NEGATION_WORDS = ["不", "没", "别", "无", "取消", "放弃", "停止", "不做", "不再", "没有"];
export const VERSION_RE = /\bv?\d+\.\d+(?:\.\d+)?\b/gi;
export const NUMBER_RE = /\d+(?:\.\d+)?/g;
export const DATE_WORDS = /(今天|明天|后天|昨天|大后天|下周|上周|本周|周[一二三四五六日天]|星期[一二三四五六日天]|月底|月初|年末|周末|\d{1,2}月\d{1,2}[日号]?|\d{1,2}[日号])/g;
