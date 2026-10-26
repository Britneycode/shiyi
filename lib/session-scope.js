// 会话类型（沿用 v7，只给主对话工具的放行判断用，§4.10）。
// main / bridge-owner 可用；ch_ 群聊 / dm_ 私信 / bridge guests / 其他 → 拒绝且不泄密。

export function sessionScope(sessionPath) {
  const p = String(sessionPath ?? "").replace(/\\/g, "/");
  if (!p) return "unknown";
  // 先判明确的非主会话前缀，再判标准主会话（避免 dm_/ch_ 文件名被当作普通主会话）
  if (/\/bridge\/owner\//.test(p) || /bridge.*owner/i.test(p)) return "bridge-owner";
  if (/\/bridge\/guests?\//.test(p) || /bridge.*guest/i.test(p)) return "bridge-guest";
  if (/\/sessions\/ch_[^/]+\.jsonl$/i.test(p) || /\/sessions\/ch_[^/]+$/i.test(p)) return "ch";
  if (/\/sessions\/dm_[^/]+\.jsonl$/i.test(p) || /\/sessions\/dm_[^/]+$/i.test(p)) return "dm";
  // 标准主会话：agents/<id>/sessions/<file>.jsonl（file 不以 ch_/dm_ 开头）
  const parts = p.split("/").filter(Boolean);
  const i = parts.findIndex((x) => x.toLowerCase() === "agents");
  if (i >= 0 && parts[i + 2]?.toLowerCase() === "sessions" && /\.jsonl$/i.test(parts[i + 3] ?? "")
      && !/^ch_/i.test(parts[i + 3]) && !/^dm_/i.test(parts[i + 3])) return "main";
  return "other";
}

/** 主对话工具是否放行（main / bridge-owner） */
export function allowHostTool(sessionPath) {
  const s = sessionScope(sessionPath);
  return s === "main" || s === "bridge-owner";
}
