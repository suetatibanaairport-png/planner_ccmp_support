// 機能仕様書 4.1.2「時刻計算」/ 4.1.3「クリティカルパス」の実装。
import type { Arrow, ArrowTiming, Event, EventId, EventTiming } from "../types";

export interface ScheduleResult {
  eventTimings: EventTiming[];
  arrowTimings: ArrowTiming[];
  criticalPaths: Arrow[][]; // N0→Nz のクリティカルパス（複数存在しうる）
}

export function computeSchedule(events: Event[], arrows: Arrow[]): ScheduleResult {
  const byNumber = [...events].sort((a, b) => a.number - b.number);

  const outgoing = new Map<EventId, Arrow[]>();
  const incoming = new Map<EventId, Arrow[]>();
  for (const e of events) {
    outgoing.set(e.id, []);
    incoming.set(e.id, []);
  }
  for (const a of arrows) {
    outgoing.get(a.from)?.push(a);
    incoming.get(a.to)?.push(a);
  }

  // 前進計算: ES(j) = max(ES(i) + d(i,j))、プロジェクト開始イベントの ES = 0
  const es = new Map<EventId, number>();
  for (const e of byNumber) {
    const ins = incoming.get(e.id) ?? [];
    if (ins.length === 0) {
      es.set(e.id, 0);
      continue;
    }
    let max = 0;
    for (const a of ins) {
      const candidate = (es.get(a.from) ?? 0) + a.durationBusinessDays;
      if (candidate > max) max = candidate;
    }
    es.set(e.id, max);
  }

  const projectEnd = byNumber[byNumber.length - 1];
  const projectDuration = projectEnd ? (es.get(projectEnd.id) ?? 0) : 0;

  // 後進計算: LS(i) = min(LS(j) - d(i,j))、終了イベントの LS = プロジェクト完了時刻
  const ls = new Map<EventId, number>();
  for (let i = byNumber.length - 1; i >= 0; i--) {
    const e = byNumber[i]!;
    const outs = outgoing.get(e.id) ?? [];
    if (outs.length === 0) {
      ls.set(e.id, projectDuration);
      continue;
    }
    let min = Infinity;
    for (const a of outs) {
      const candidate = (ls.get(a.to) ?? projectDuration) - a.durationBusinessDays;
      if (candidate < min) min = candidate;
    }
    ls.set(e.id, min);
  }

  const eventTimings: EventTiming[] = events.map((e) => ({
    eventId: e.id,
    es: es.get(e.id) ?? 0,
    ls: ls.get(e.id) ?? 0,
  }));

  const arrowTimings: ArrowTiming[] = arrows.map((a) => {
    const arrowEs = es.get(a.from) ?? 0;
    const arrowEf = arrowEs + a.durationBusinessDays;
    const arrowLf = ls.get(a.to) ?? 0;
    const arrowLs = arrowLf - a.durationBusinessDays;
    const totalFloat = arrowLf - arrowEs - a.durationBusinessDays;
    return {
      arrow: a,
      es: arrowEs,
      ef: arrowEf,
      ls: arrowLs,
      lf: arrowLf,
      totalFloat,
      isCritical: totalFloat === 0,
    };
  });

  const criticalPaths = findCriticalPaths(events, arrowTimings);

  return { eventTimings, arrowTimings, criticalPaths };
}

/** TF=0 の矢線からなる、開始イベントから終了イベントまでの経路をすべて列挙する（4.1.3）。 */
function findCriticalPaths(events: Event[], arrowTimings: ArrowTiming[]): Arrow[][] {
  if (events.length === 0) return [];
  const byNumber = [...events].sort((a, b) => a.number - b.number);
  const start = byNumber[0]!;
  const end = byNumber[byNumber.length - 1]!;

  const criticalOutgoing = new Map<EventId, Arrow[]>();
  for (const t of arrowTimings) {
    if (!t.isCritical) continue;
    criticalOutgoing.set(t.arrow.from, [...(criticalOutgoing.get(t.arrow.from) ?? []), t.arrow]);
  }

  const paths: Arrow[][] = [];
  const MAX_PATHS = 1000; // 病的なケースでの爆発を避ける安全弁

  function dfs(eventId: EventId, path: Arrow[]): void {
    if (paths.length >= MAX_PATHS) return;
    if (eventId === end.id) {
      if (path.length > 0) paths.push([...path]);
      return;
    }
    for (const arrow of criticalOutgoing.get(eventId) ?? []) {
      path.push(arrow);
      dfs(arrow.to, path);
      path.pop();
    }
  }

  dfs(start.id, []);
  return paths;
}
