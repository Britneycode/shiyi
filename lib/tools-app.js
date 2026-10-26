// 应用内工具（§4.7）：聊天模型经 tool-call 调用，由拾遗自己执行。
// note_thing / update_thing / note_fact / search_memory / handoff_to_hana；
// 记忆守卫对写工具同样生效（off/unknown → 拒记并如实告知）。

import { createMemoryRepo } from "./memory/repo.js";
import { matchThing, hasConflict, matchNote } from "./memory/dedupe.js";
import { search as recallSearch } from "./memory/recall.js";
import { shortId, clipText, isObj } from "./util.js";
import { AREA_LABELS, THING_STATUS_LABELS, EVIDENCE_MAX_CHARS } from "./config.js";

const AREAS = ["work", "study", "life"];
const STATUSES = ["active", "waiting", "done", "dropped"];
const NOTE_KINDS = ["knowledge", "howto", "experience", "life", "idea", "person"];

/** JSON Schema 声明（宿主 AppModelToolV2 契约） */
export function appToolSchemas() {
  return [
    {
      name: "note_thing",
      description: "记下一件新的事（用户自己要做、在做、在等、在学、答应了别人的）。",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "≤30 字，一眼认出是哪件事" },
          area: { type: "string", enum: AREAS },
          status: { type: "string", enum: STATUSES },
          now: { type: "string", description: "一两句现状" },
          next: { type: "array", items: { type: "string" }, maxItems: 3 },
          followUpAt: { type: "string", description: "ISO 8601 带时区；到时提醒/跟进" },
          dueAt: { type: "string", description: "明确截止/约定时间" },
        },
        required: ["title", "area"],
      },
    },
    {
      name: "update_thing",
      description: "更新已有的事（进展、状态、时间变化），id 用手上事列表里的。",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          status: { type: "string", enum: STATUSES },
          now: { type: "string" },
          next: { type: "array", items: { type: "string" }, maxItems: 3 },
          followUpAt: { type: "string" },
          dueAt: { type: "string" },
          log: { type: "string", description: "这次发生了什么（≤60 字）" },
        },
        required: ["id"],
      },
    },
    {
      name: "note_fact",
      description: "记下一条值得长期留下的知（知识、做法、经验、生活常识、灵感、他人喜好）。",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", enum: NOTE_KINDS },
          title: { type: "string" },
          content: { type: "string", description: "≤400 字，只写对话里能确认的内容" },
          question: { type: "string", description: "knowledge 专用：检验是否掌握的具体问题" },
          tags: { type: "array", items: { type: "string" }, maxItems: 8 },
        },
        required: ["kind", "title", "content"],
      },
    },
    {
      name: "search_memory",
      description: "查已记下的事和知。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          type: { type: "string", enum: ["thing", "note", "all"] },
        },
        required: ["query"],
      },
    },
    {
      name: "handoff_to_hana",
      description: "提议把需要真正动手的任务交给 Hana 主对话（只在用户有明确任务意图时用；调用后等用户点确认）。",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          request: { type: "string", description: "交给 Hana 做的事，说清目标与约束" },
          thingId: { type: "string", description: "关联的事（可选）" },
        },
        required: ["title", "request"],
      },
    },
  ];
}

const GUARD_MSG = {
  off: "这个助手的记忆已关闭，没有记下。",
  unknown: "暂时确认不了记忆设置，没有记下。",
};

export function createAppTools({ repo, policy, handoff = null, clock = () => Date.now() }) {
  /** 供执行结果系统行展示的一行摘要 */
  function lineFor(t) {
    const bits = [t.title];
    if (t.dueAt) bits.push(`截止 ${clipText(t.dueAt, 16)}`);
    if (t.followUpAt) bits.push(`${clipText(t.followUpAt, 16)} 跟进`);
    return bits.join(" · ");
  }

  async function guard(agentId) {
    const st = await policy.memoryState(agentId);
    return st === "on" ? null : (GUARD_MSG[st] ?? GUARD_MSG.unknown);
  }

  /** 记录行是纯文本（Markdown 记录段逐行存）：YYYY-MM-DD HH:mm · 来源 · 内容 */
  function logLine(text, source) {
    const d = new Date(clock());
    const p = (n) => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    return `${stamp} · ${source} · ${text}`;
  }

  async function noteThing(args, ctx2) {
    const g = await guard(ctx2.agentId);
    if (g) return { text: g, line: null };
    const title = String(args.title ?? "").trim();
    if (!title || title.length > 30 || !AREAS.includes(args.area)) {
      return { text: "没记下：title 或 area 不对（title ≤30 字，area ∈ work/study/life）。", line: null };
    }
    const status = STATUSES.includes(args.status) ? args.status : "active";
    const item = {
      title, area: args.area, status,
      now: String(args.now ?? ""), next: Array.isArray(args.next) ? args.next.slice(0, 3).map(String) : [],
      followUpAt: args.followUpAt ? String(args.followUpAt) : null,
      dueAt: args.dueAt ? String(args.dueAt) : null,
    };
    // L3 判重：同 area 相似 → 转为更新
    const existing = await repo.listThings({});
    for (const row of existing) {
      if (row.status === "done" || row.status === "dropped") continue;
      const m = matchThing(item, row);
      if (!m.l3) continue;
      if (hasConflict(`${item.title} ${item.now}`, `${row.title} ${row.now ?? ""}`).conflict) continue; // L3.5 不合并
      await repo.updateThing(row.id, {
        status: item.status !== "active" ? item.status : undefined,
        now: item.now || undefined,
        next: item.next.length ? item.next : undefined,
        followUpAt: item.followUpAt ?? undefined,
        dueAt: item.dueAt ?? undefined,
        log: logLine(clipText(ctx2.userText ?? "", EVIDENCE_MAX_CHARS) || "应用内工具更新", "聊天工具"),
      });
      return { text: `更新了已有的事：${lineFor({ ...row, ...item })}`, line: `更新：${lineFor({ ...row, ...item })}`, updated: row.id };
    }
    const created = await repo.createThing({
      ...item, owner: ctx2.agentId, source: "chat-tool",
      sourceRef: { windowKey: null, messageIds: ctx2.messageIds ?? [] },
      log: logLine(clipText(ctx2.userText ?? "", EVIDENCE_MAX_CHARS) || "应用内工具记录", "聊天工具"),
    });
    return { text: `记下了：${lineFor(created)}`, line: `记下了：${lineFor(created)}`, created: created.id };
  }

  async function updateThing(args, ctx2) {
    const g = await guard(ctx2.agentId);
    if (g) return { text: g, line: null };
    const id = String(args.id ?? "");
    const full = await repo.getThing(id);
    if (!full) return { text: `没找到这件事（${id}）。`, line: null };
    if (full.status === "done" || full.status === "dropped") {
      return { text: "这件事已经结束或放下了，不再更新；如要重开请直接说。", line: null };
    }
    await repo.updateThing(id, {
      status: STATUSES.includes(args.status) ? args.status : undefined,
      now: args.now != null ? String(args.now) : undefined,
      next: Array.isArray(args.next) ? args.next.slice(0, 3).map(String) : undefined,
      followUpAt: args.followUpAt != null ? String(args.followUpAt) : undefined,
      dueAt: args.dueAt != null ? String(args.dueAt) : undefined,
      log: args.log ? logLine(clipText(String(args.log), EVIDENCE_MAX_CHARS), "聊天工具") : undefined,
    });
    const after = await repo.getThing(id);
    return { text: `更新了：${lineFor(after)}`, line: `更新：${lineFor(after)}`, updated: id };
  }

  async function noteFact(args, ctx2) {
    const g = await guard(ctx2.agentId);
    if (g) return { text: g, line: null };
    const kind = String(args.kind ?? "");
    const title = String(args.title ?? "").trim();
    const content = String(args.content ?? "").trim();
    if (!NOTE_KINDS.includes(kind) || !title || !content) {
      return { text: "没记下：kind / title / content 不对。", line: null };
    }
    if (content.length > 1600) return { text: "没记下：content 太长（≤1600 字）。", line: null };
    // L3 判重需要 content（索引行没有），逐条取全文
    const rows = await repo.listNotes({});
    for (const row of rows) {
      const full = await repo.getNote(row.id);
      if (full && matchNote({ kind, title, content }, full).dup) {
        return { text: "这条知已经记过了，没重复记。", line: null };
      }
    }
    const created = await repo.createNote({
      kind, title, content,
      question: kind === "knowledge" && args.question ? String(args.question) : null,
      tags: Array.isArray(args.tags) ? args.tags.map(String).slice(0, 8) : [],
      source: "chat-tool",
      sourceRef: { windowKey: null, messageIds: ctx2.messageIds ?? [] },
    });
    return { text: `记下了：${created.title}`, line: `记下了知：${created.title}`, created: created.id };
  }

  async function searchMemory(args) {
    const query = String(args.query ?? "").trim();
    if (!query) return { text: "想查什么？", line: null };
    const type = args.type === "thing" || args.type === "note" ? args.type : "all";
    const things = type !== "note" ? await repo.listThings({}) : [];
    const notes = type !== "thing" ? await repo.listNotes({}) : [];
    const hits = recallSearch({ things, notes, query, limit: 6, nowMs: clock() });
    if (!hits.length) return { text: "没查到相关的记录。", line: null };
    const lines = hits.map((h) => {
      if (h.type === "thing") {
        const t = h.item;
        return `- ${t.id}：${t.title}（${t.status}${t.now ? `；现状：${clipText(t.now, 40)}` : ""}${t.followUpAt ? `；下次跟进 ${clipText(t.followUpAt, 16)}` : ""}）`;
      }
      const n = h.item;
      return `- ${n.id}：【${n.kind}】${n.title} — ${clipText(n.content, 120)}`;
    });
    return { text: `查到 ${hits.length} 条：\n${lines.join("\n")}`, line: null };
  }

  async function handoffToHana(args, ctx2) {
    const title = String(args.title ?? "").trim();
    const request = String(args.request ?? "").trim();
    if (!title || !request) return { text: "没创建交接：title 和 request 都要有。", line: null };
    let thing = null;
    if (args.thingId) thing = await repo.getThing(String(args.thingId));
    if (!handoff) return { text: "已向用户展示确认卡，等待用户决定。", line: `交接：${title}` };
    const card = await handoff.createCard({
      id: shortId("h", new Date(clock())),
      agentId: ctx2.agentId, title, request, thingId: thing?.id ?? null,
    });
    return { text: "已向用户展示确认卡，等待用户决定。", line: `交接：${card.title}`, card };
  }

  const handlers = { note_thing: noteThing, update_thing: updateThing, note_fact: noteFact, search_memory: searchMemory, handoff_to_hana: handoffToHana };

  /** 模型 tool-call 入口：返回回喂模型的文本 + 界面系统行 */
  async function execute(name, args, ctx2 = {}) {
    const fn = handlers[name];
    if (!fn) return { text: `未知工具：${name}`, line: null };
    try {
      return await fn(isObj(args) ? args : {}, ctx2);
    } catch (err) {
      return { text: `工具执行失败：${String(err?.message ?? err).slice(0, 120)}`, line: null };
    }
  }

  return { schemas: appToolSchemas(), execute, lineFor };
}

// 重新导出 createMemoryRepo（PLAN §3 目录标注 tools-app 依赖 repo；测试里直接从这里建）
export { createMemoryRepo };
