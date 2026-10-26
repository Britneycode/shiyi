// 主动由头收集（§4.8.1）：每次 tick 收集候选，按分数取一条投递。
// 每个候选带 reason / thingId? / basis / topicKey / createdAt / expiresAt / score / area / owner。

import { sha1, localISO, isObj } from "../util.js";

const DAY_MS = 24 * 60 * 60_000;

/** 久未提起的天数阈值（§4.8.1 followup_stale） */
const STALE_DAYS = { work: 3, study: 4, life: 7 };

function thingBasis(t, full, nowMs) {
  const parts = [];
  const status = full?.status ?? t.status;
  const area = full?.area ?? t.area;
  const now = full?.now ?? "";
  const dueAt = full?.dueAt ?? t.dueAt ?? null;
  const last = Array.isArray(full?.logs) && full.logs.length ? full.logs[full.logs.length - 1] : null;
  parts.push(`（${area === "work" ? "工作" : area === "study" ? "学习" : "生活"}·${status === "active" ? "进行中" : status === "waiting" ? "等待" : status === "done" ? "完成" : "放下"}）`);
  if (dueAt) parts.push(`截止 ${dueAt.slice(5, 16).replace("T", " ")}`);
  if (now) parts.push(`现状：${String(now).slice(0, 60)}`);
  if (last) parts.push(`最近记录：${String(last).slice(0, 80)}`);
  const lastFollowed = t.lastFollowedAt ?? full?.lastFollowedAt ?? null;
  if (lastFollowed) parts.push(`上次跟进 ${lastFollowed.slice(5, 16).replace("T", " ")}`);
  return parts.join("；");
}

/**
 * 收集候选。deps: { repo, threads?, mainfeed?, settings, now, st, ownerOf }
 * st: engine state（见 engine.js）。
 */
export async function collect({ repo, threads, mainfeed, settings, now, st }) {
  const out = [];
  const s = settings.get();
  const things = await repo.listThings({});

  for (const row of things) {
    if (row.status === "done" || row.status === "dropped") continue;
    const full = await repo.getThing(row.id);
    const followUp = full?.followUp ?? row.followUp ?? "auto";
    const followUpAt = full?.followUpAt ?? row.followUpAt ?? null;
    const lastMentioned = full?.lastMentionedAt ?? row.lastMentionedAt ?? null;
    const area = full?.area ?? row.area;
    const updatedAt = full?.updatedAt ?? row.updatedAt ?? null;
    const lastFollowedAt = full?.lastFollowedAt ?? row.lastFollowedAt ?? null;

    // remind_due：到时提醒（remind 且到点，未完成）
    if (followUp === "remind" && followUpAt && Date.parse(followUpAt) <= now) {
      out.push({
        reason: "remind_due", thingId: row.id, area,
        topicKey: `thing:${row.id}`,
        basis: thingBasis(row, full, now),
        createdAt: now, expiresAt: now + DAY_MS,
        score: 100,
        owner: full?.owner ?? row.owner ?? null,
      });
      continue; // remind 命中就提醒，不再评别的由头
    }

    // followup_due：到期跟进（auto 且到点）
    if (followUp === "auto" && followUpAt && Date.parse(followUpAt) <= now) {
      const overdueH = Math.min(10, Math.floor((now - Date.parse(followUpAt)) / 3600_000));
      out.push({
        reason: "followup_due", thingId: row.id, area,
        topicKey: `thing:${row.id}`,
        basis: thingBasis(row, full, now),
        createdAt: now, expiresAt: now + DAY_MS,
        score: 80 + overdueH,
        owner: full?.owner ?? row.owner ?? null,
      });
      continue;
    }

    // followup_stale：久未提起（auto、无 followUpAt、未完成）
    if (followUp === "auto" && !followUpAt && lastMentioned) {
      const gapDays = (now - Date.parse(lastMentioned)) / DAY_MS;
      const th = STALE_DAYS[area] ?? 7;
      if (gapDays > th) {
        out.push({
          reason: "followup_stale", thingId: row.id, area,
          topicKey: `thing:${row.id}`,
          basis: thingBasis(row, full, now),
          createdAt: now, expiresAt: now + 2 * DAY_MS,
          score: 40 + Math.min(10, Math.floor(gapDays)),
          owner: full?.owner ?? row.owner ?? null,
        });
      }
    }

    // recent_work：主对话近况（来自主对话的事处于 waiting，4h+ 没再提）
    if ((full?.source ?? row.source) === "main" && (row.status === "waiting" || full?.status === "waiting")) {
      const lastAt = Date.parse(lastMentioned ?? updatedAt ?? 0);
      if (now - lastAt > 4 * 3600_000 && s.memory?.learnFromMain) {
        out.push({
          reason: "recent_work", thingId: row.id, area,
          topicKey: `thing:${row.id}`,
          basis: thingBasis(row, full, now),
          createdAt: now, expiresAt: now + DAY_MS,
          score: 60,
          owner: full?.owner ?? row.owner ?? null,
        });
      }
    }
  }

  // handoff_result：交接会话里有新提取出的更新（engine 直接注入）
  for (const [sessionPath, info] of Object.entries(st.handoffResults ?? {})) {
    out.push({
      reason: "handoff_result", thingId: info.thingId ?? null,
      area: info.area ?? "work",
      topicKey: `handoff:${sessionPath}`,
      basis: `「${info.title ?? "交接"}」有结果了：${String(info.summary ?? "").slice(0, 80)}`,
      createdAt: info.at ?? now, expiresAt: now + DAY_MS,
      score: 70,
      owner: info.agentId ?? null,
      sessionPath,
    });
  }

  // study_review：学习回顾（有进行中的学习区事；按 studyEveryDays 轮换）
  const studyActive = things.filter((t) => t.area === "study" && t.status !== "done" && t.status !== "dropped");
  if (studyActive.length) {
    const every = (s.proactive?.studyEveryDays ?? 2) * DAY_MS;
    const next = st.studyNextAt ?? 0;
    if (now >= next) {
      // 取一个关联或同标签、有 question 的知（最近 7 天没问过的）
      const notes = await repo.listNotes({});
      const candidates = [];
      for (const n of notes) {
        if (n.kind !== "knowledge" || !n.question) continue;
        const asked = st.studyAsked?.[n.id] ?? 0;
        if (now - asked < 7 * DAY_MS) continue;
        candidates.push(n);
      }
      const note = candidates[0] ?? null;
      const topicKey = note ? `study:${note.id}` : `study:${sha1(studyActive.map((t) => t.id).join(",")).slice(0, 12)}`;
      out.push({
        reason: "study_review", thingId: studyActive[0].id, area: "study",
        topicKey,
        basis: note
          ? `学过的「${note.title}」：${note.question}`
          : `学习区有进行中的事：${studyActive.map((t) => t.title).slice(0, 2).join("、")}`,
        createdAt: now, expiresAt: now + DAY_MS,
        score: 30,
        noteId: note?.id ?? null,
        owner: studyActive[0].owner ?? null,
      });
    }
  }

  // chitchat：闲聊（当天还没主动聊过，随机 10:00–21:00）
  if (s.proactive?.categories?.chitchat) {
    const today = localISO(new Date(now)).slice(0, 10);
    if (st.lastChitchatDate !== today) {
      const h = new Date(now).getHours();
      if (h >= 10 && h < 21) {
        const topicKey = `chitchat:${today}`;
        out.push({
          reason: "chitchat", thingId: null, area: "life",
          topicKey, basis: "今天还没主动打招呼",
          createdAt: now, expiresAt: now + 12 * 3600_000,
          score: 10, owner: null,
        });
      }
    }
  }

  return out;
}
