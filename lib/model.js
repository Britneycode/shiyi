// models.stream / models.utility 封装（§4.2 / §4.7）：
// NDJSON 增量解析、正文清洗、空输出加倍重试、取消、requestId 一次性、工具循环（≤3 调用 / ≤2 轮）、id 规整。
// 宿主不执行工具：tool-call 事件交回应用，结果以 role:"toolResult" 回喂。

import { stripModelBlocks, withTimeout, randToken } from "./util.js";
import { CHAT_MAX_TOKENS, CHAT_RETRY_MAX_TOKENS, CHAT_TEMPERATURE, CHAT_TIMEOUT_MS, EXTRACT_MAX_TOKENS, EXTRACT_TIMEOUT_MS, TOOL_SUPPORT_FORGET_MS } from "./config.js";

const TOOL_ID_RE = /[^A-Za-z0-9_-]/g;
const MAX_TOOL_CALLS_PER_ROUND = 3;
const MAX_TOOL_ROUNDS = 2;

// NDJSON error 事件包装成异常，让 chat() 能区分「provider 不支持工具」
class ToolStreamError extends Error {
  constructor(code, message) {
    super(`${code}: ${message ?? ""}`);
    this.code = code;
  }
}
function isToolUnsupported(err) {
  const msg = `${err?.code ?? ""} ${err?.message ?? ""}`;
  return /tool|function.?call/i.test(msg) && /support|invalid|unknown|unavailable|not.?allow/i.test(msg);
}

// 工具调用 id 规整为 ^[A-Za-z0-9_-]{1,128}$（宿主会校验）
export function normalizeToolId(id, fallbackSeed = "") {
  let s = String(id ?? "").replace(TOOL_ID_RE, "_").slice(0, 128);
  if (!s) s = `tool_${randToken(8)}${String(fallbackSeed).replace(TOOL_ID_RE, "").slice(0, 12)}`.slice(0, 128);
  return s;
}

/** 解析 NDJSON 文本（整段或增量）。返回 { text, reasoning, toolCalls[], done, error } */
export function parseNdjson(raw) {
  const out = { text: "", reasoning: "", toolCalls: [], done: null, error: null };
  for (const line of String(raw ?? "").split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    let ev;
    try { ev = JSON.parse(s); } catch { continue; }
    const type = String(ev?.type ?? ev?.event ?? "");
    if (type === "text-delta" || type === "text_delta") out.text += String(ev.delta ?? ev.text ?? "");
    else if (type === "reasoning-delta" || type === "reasoning_delta") out.reasoning += String(ev.delta ?? ev.text ?? "");
    else if (type === "tool-call" || type === "tool_call") out.toolCalls.push(normalizeToolCall(ev));
    else if (type === "done") {
      out.done = ev;
      // 有的 provider 只在 done.assistant.content 里带 toolCall
      for (const part of ev?.assistant?.content ?? []) {
        if (part?.type === "toolCall" || part?.type === "tool-call") out.toolCalls.push(normalizeToolCall(part));
      }
      if (!out.text && typeof ev?.assistant?.text === "string") out.text = ev.assistant.text;
    } else if (type === "error") out.error = { code: String(ev?.code ?? ""), message: String(ev?.message ?? "") };
  }
  return out;
}

function normalizeToolCall(ev) {
  const src = ev?.toolCall ?? ev ?? {};
  const name = String(src.name ?? src.toolName ?? ev?.toolName ?? "");
  const rawId = src.id ?? src.toolCallId ?? ev?.toolCallId;
  let input = src.input ?? src.arguments ?? src.args ?? {};
  if (typeof input === "string") { try { input = JSON.parse(input); } catch { input = {}; } }
  return { id: normalizeToolId(rawId, name), name, input };
}

/** 读 Response（NDJSON 增量，读不到就整段）→ { text, toolCalls, usage, stopReason, raw }
 *  可选 onDelta：每解析出一条 text-delta 时实时回调（批 4 流式打字机用） */
async function readStream(res, { onDelta } = {}) {
  if (!res) return { text: "", toolCalls: [], usage: null, stopReason: "", raw: "" };
  let raw = "";
  let parsedSoFar = 0;
  if (res.body && typeof res.body.getReader === "function") {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      raw += dec.decode(value, { stream: true });
      // 增量解析：每读一段就找出完整 NDJSON 行，把 text-delta 实时上抛
      if (onDelta) {
        while (true) {
          const nl = raw.indexOf("\n", parsedSoFar);
          if (nl < 0) break;
          const line = raw.slice(parsedSoFar, nl).trim();
          parsedSoFar = nl + 1;
          if (!line) continue;
          let ev;
          try { ev = JSON.parse(line); } catch { continue; }
          const type = String(ev?.type ?? ev?.event ?? "");
          if (type === "text-delta" || type === "text_delta") {
            const d = String(ev.delta ?? ev.text ?? "");
            if (d) { try { onDelta(d); } catch {} }
          }
        }
      }
    }
    raw += dec.decode();
    // 尾段（可能少个 \n）
    if (onDelta && parsedSoFar < raw.length) {
      const line = raw.slice(parsedSoFar).trim();
      if (line) {
        try {
          const ev = JSON.parse(line);
          const type = String(ev?.type ?? ev?.event ?? "");
          if (type === "text-delta" || type === "text_delta") {
            const d = String(ev.delta ?? ev.text ?? "");
            if (d) { try { onDelta(d); } catch {} }
          }
        } catch {}
      }
    }
  } else if (typeof res.text === "function") {
    raw = await res.text();
    if (onDelta) {
      // 无流读的退化路径：整段解析后回放一遍 delta（前端依然能打字机，只是节奏靠前端自己控制）
      const p = parseNdjson(raw);
      if (p.text) { try { onDelta(p.text); } catch {} }
    }
  } else if (typeof res === "string") {
    raw = res;
    if (onDelta) {
      const p = parseNdjson(raw);
      if (p.text) { try { onDelta(p.text); } catch {} }
    }
  }
  const p = parseNdjson(raw);
  return {
    text: stripModelBlocks(p.text),
    toolCalls: p.toolCalls,
    usage: p.done?.usage ?? null,
    stopReason: String(p.done?.stopReason ?? ""),
    error: p.error,
    raw,
  };
}

export function createModel({ ctx, caps }) {
  const noTool = new Map(); // `${provider}/${model}` -> 记住到何时（不支持工具）
  const inflight = new Set(); // requestId 在途

  function supportsTools(provider, model) {
    const until = noTool.get(`${provider}/${model}`) ?? 0;
    return Date.now() >= until;
  }
  function markNoTools(provider, model) {
    noTool.set(`${provider}/${model}`, Date.now() + TOOL_SUPPORT_FORGET_MS);
  }

  async function cancel(requestId) {
    if (!requestId || !caps.has("models.cancel")) return;
    try { await caps.call("models.cancel", () => ctx.models.cancel(requestId)); } catch {}
    inflight.delete(requestId);
  }

  /** 单次生成（不含工具循环）。空正文时加倍 maxTokens 重试一次。onDelta 流式上抛。 */
  async function streamOnce({ provider, model, systemPrompt, messages, tools, maxTokens, temperature, timeoutMs, onDelta = null }) {
    const requestId = `shiyi_${Date.now().toString(36)}_${randToken(8)}`; // 每次新生成，复用会报 DUPLICATE_REQUEST
    inflight.add(requestId);
    try {
      const call = () => caps.call("models.stream", () =>
        ctx.models.stream({
          requestId, provider, model, systemPrompt, messages,
          maxTokens, temperature,
          ...(tools && tools.length ? { tools } : {}),
        }));
      let r = await withTimeout(call(), timeoutMs, () => void cancel(requestId));
      let out = await readStream(r, { onDelta });
      // 有 toolCalls 时 error 事件（如 tool_use 中止）不算失败，照常进入工具循环
      if (out.error && !out.text && !out.toolCalls.length) {
        throw new ToolStreamError(out.error.code || "model_error", out.error.message);
      }
      if (!out.text && !out.toolCalls.length) {
        // 空输出：加倍 maxTokens 重试一次
        const requestId2 = `shiyi_${Date.now().toString(36)}_${randToken(8)}`;
        inflight.add(requestId2);
        r = await withTimeout(
          caps.call("models.stream", () => ctx.models.stream({
            requestId: requestId2, provider, model, systemPrompt, messages,
            maxTokens: Math.min(maxTokens * 2, 8192), temperature,
            ...(tools && tools.length ? { tools } : {}),
          })),
          timeoutMs, () => void cancel(requestId2));
        out = await readStream(r, { onDelta });
        if (out.error && !out.text && !out.toolCalls.length) {
          throw new ToolStreamError(out.error.code || "model_error", out.error.message);
        }
        await cancel(requestId2);
      }
      return out;
    } finally {
      await cancel(requestId);
    }
  }

  /**
   * 聊天生成 + 工具循环（§4.7）。
   * @param opts { provider, model, systemPrompt, messages, tools?, toolRunner?: async (name, input) => {text, isError?} }
   * @returns { text, toolCalls, toolResults[], usage, stopReason, noTools }
   */
  async function chat({ provider, model, systemPrompt, messages, tools = [], toolRunner = null, maxTokens = CHAT_MAX_TOKENS, temperature = CHAT_TEMPERATURE, timeoutMs = CHAT_TIMEOUT_MS, onDelta = null }) {
    const useTools = tools.length > 0 && toolRunner && supportsTools(provider, model);
    const convo = [...messages];
    const allToolCalls = [];
    const allToolResults = [];

    let last = null;
    try {
      for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        last = await streamOnce({
          provider, model, systemPrompt, messages: convo,
          tools: useTools ? tools : null, maxTokens, temperature, timeoutMs, onDelta,
        });
        const calls = (last.toolCalls ?? []).slice(0, MAX_TOOL_CALLS_PER_ROUND);
        if (!useTools || calls.length === 0) break;
        if (round === MAX_TOOL_ROUNDS) break; // 轮次用完
        // 回放 assistant（含 toolCall），并把结果回喂
        convo.push({
          role: "assistant",
          content: [
            ...(last.text ? [{ type: "text", text: last.text }] : []),
            ...calls.map((c) => ({ type: "toolCall", toolCall: { id: c.id, name: c.name, input: c.input } })),
          ],
        });
        for (const c of calls) {
          let result;
          try {
            result = await toolRunner(c.name, c.input);
          } catch (err) {
            result = { text: `工具执行失败：${err?.message ?? err}`, isError: true };
          }
          const text = String(result?.text ?? "");
          allToolCalls.push(c);
          allToolResults.push({ name: c.name, id: c.id, text, isError: !!result?.isError });
          convo.push({
            role: "toolResult", toolCallId: c.id, toolName: c.name,
            content: [{ type: "text", text }], isError: !!result?.isError,
          });
        }
        // 下一轮重新请求（同一 systemPrompt）
      }
    } catch (err) {
      // 工具不支持的报错 → 去工具重试并记忆 24h
      if (useTools && err instanceof ToolStreamError && isToolUnsupported(err)) {
        markNoTools(provider, model);
        last = await streamOnce({ provider, model, systemPrompt, messages, tools: null, maxTokens, temperature, timeoutMs, onDelta });
      } else {
        throw err;
      }
    }

    return {
      text: last?.text ?? "",
      toolCalls: allToolCalls,
      toolResults: allToolResults,
      usage: last?.usage ?? null,
      stopReason: last?.stopReason ?? "",
      noTools: !supportsTools(provider, model),
    };
  }

  /** utility：提取 / 摘要用。→ { text } */
  async function utility({ provider, model, systemPrompt, user, maxTokens = EXTRACT_MAX_TOKENS, timeoutMs = EXTRACT_TIMEOUT_MS }) {
    if (!caps.has("models.utility")) throw new Error("models.utility unsupported");
    return caps.call("models.utility", () => ctx.models.utility({
      provider, model, systemPrompt,
      messages: [{ role: "user", content: [{ type: "text", text: user }] }],
      maxTokens,
    }));
  }

  return { chat, utility, streamOnce, supportsTools, markNoTools, cancel };
}
