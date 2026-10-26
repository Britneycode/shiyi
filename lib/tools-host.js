// 主对话工具（§4.10）：shiyi.search / shiyi.track。
// 只对 main / bridge-owner 放行；ch_ 群聊、dm_ 私信、外部访客 → 拒绝且不泄露任何内容。

import { allowHostTool } from "./session-scope.js";
import { clipText, localISO } from "./util.js";

const DENY_TEXT = "这里不能使用拾遗。";

export function createHostTools({ ctx, caps, repo, recallSearch }) {
  async function search({ query }, { sessionPath } = {}) {
    if (!allowHostTool(sessionPath)) return { text: DENY_TEXT };
    const q = String(query ?? "").trim();
    if (!q) return { text: "要查什么？给我一个关键词。" };
    const things = await repo.listThings({});
    const notes = await repo.listNotes({});
    const hits = recallSearch({ things, notes, query: q, limit: 8 });
    if (!hits.length) return { text: `拾遗里没找到和「${q}」有关的记录。` };
    const lines = [];
    for (const h of hits.slice(0, 8)) {
      if (h.type === "thing") {
        const full = await repo.getThing(h.id);
        if (!full) continue;
        const st = full.status === "active" ? "进行中" : full.status === "waiting" ? "等待" : full.status === "done" ? "完成" : "放下";
        const next = full.followUpAt ? `；下次跟进 ${full.followUpAt.slice(5, 16).replace("T", " ")}` : "";
        lines.push(`· ${full.title}（${st}）：${clipText(full.now ?? "", 120)}${next}`);
      } else {
        const full = await repo.getNote(h.id);
        if (!full) continue;
        lines.push(`· ${full.title}：${clipText(full.content ?? "", 200)}`);
      }
    }
    return { text: lines.length ? lines.join("\n") : `拾遗里没找到和「${q}」有关的记录。` };
  }

  async function track({ title, area, followUpAt, followUp, note }, { sessionPath, agentId } = {}) {
    if (!allowHostTool(sessionPath)) return { text: DENY_TEXT };
    const t = String(title ?? "").trim();
    if (!t) return { text: "要跟进的是哪件事？给我一个标题。" };
    const a = ["work", "study", "life"].includes(area) ? area : "work";
    const fu = ["auto", "remind", "off"].includes(followUp) ? followUp : "auto";
    const due = followUpAt ? String(followUpAt) : null;

    // L3 判重：同区同名的进行中的事 → 更新而不是新建
    const existing = (await repo.listThings({ area: a })).find(
      (x) => x.status !== "done" && x.status !== "dropped" && String(x.title ?? "").trim() === t,
    );
    let id;
    if (existing) {
      id = existing.id;
      await repo.updateThing(id, {
        followUpAt: due, followUp: fu,
        log: `· ${localISO(new Date()).slice(5, 16).replace("T", " ")} · 主对话 · ${note ?? "让拾遗继续跟进"}`,
      });
    } else {
      const created = await repo.createThing({
        title: t, area: a, status: "active", followUp: fu, followUpAt: due,
        owner: agentId ?? null, source: "main",
        now: note ? String(note).slice(0, 200) : "",
        logs: [`${localISO(new Date()).slice(5, 16).replace("T", " ")} · 主对话 · 用户让拾遗跟进`],
      });
      id = created?.id;
    }
    const when = due ? due.slice(5, 16).replace("T", " ") : "该问的时候";
    return { text: `已记下，${when}会在拾遗里问你。`, thingId: id };
  }

  function register() {
    if (!caps.has("tools.register")) return { ok: false, code: "unsupported" };
    const defs = [
      {
        name: "shiyi.search",
        description: "在「拾遗」里查用户手上的事（工作、学习、生活）和记下的知识、做法、经验。用户问起之前聊过 / 在忙的事、或说「拾遗里记的…」时调用。",
        parameters: { type: "object", properties: { query: { type: "string" }, type: { type: "string", enum: ["thing", "note", "all"] } }, required: ["query"] },
        run: search,
      },
      {
        name: "shiyi.track",
        description: "用户明确要求让「拾遗」跟进或提醒某件事时调用（如「让拾遗周四提醒我问进度」）。只说「记住」而没提跟进时不要调用。",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string" }, area: { type: "string", enum: ["work", "study", "life"] },
            followUpAt: { type: "string" }, followUp: { type: "string", enum: ["auto", "remind", "off"] }, note: { type: "string" },
          },
          required: ["title"],
        },
        run: track,
      },
    ];
    try {
      for (const d of defs) {
        ctx.tools.register({
          name: d.name, description: d.description, parameters: d.parameters,
          sessionPermission: d.name === "shiyi.search" ? { readOnly: true } : undefined,
          handler: (args, meta) => d.run(args, meta),
        });
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, code: "failed", error: String(err?.message ?? err) };
    }
  }

  return { register, search, track };
}
