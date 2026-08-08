// 機能仕様書 4.1.5「共通時間軸への変換」の実装。CPM計算（ES/LS）は相対値のまま保ち、
// 表示位置用のオフセットのみここで求める。
import { businessDayOffset, nextOrSameBusinessDay } from "../calendar/businessDays";
import { parseTaskDate, toDateKey } from "../calendar/parseDate";
import type { Edge, Task } from "../types";

export interface BasisDateResult {
  date: Date | null;
  raw: string | null; // YYYY-MM-DD（内部正規化済み）。基準日なし（W315）の場合は null。
}

/**
 * プロジェクトの基準日を求める（4.1.5）。
 * 1. 先行タスクを持たないタスク（エントリタスク）のうち、有効な開始日を持つものの最早値。
 * 2. 該当がなければ、プロジェクト内の全タスクのうち有効な開始日を持つものの最早値。
 * 3. それでもなければ基準日なし（呼び出し側で W315 を発報し、オフセット0とする）。
 */
export function computeBasisDate(tasks: readonly Task[], edges: readonly Edge[]): BasisDateResult {
  const hasIncoming = new Set(edges.map((e) => e.to));
  const entryTasks = tasks.filter((t) => !hasIncoming.has(t.id));

  const earliest = (pool: readonly Task[]): Date | null => {
    let best: Date | null = null;
    for (const t of pool) {
      if (t.startDate === null) continue;
      const parsed = parseTaskDate(t.startDate);
      if (parsed === null) continue;
      if (best === null || parsed.getTime() < best.getTime()) best = parsed;
    }
    return best;
  };

  const fromEntry = earliest(entryTasks);
  const date = fromEntry ?? earliest(tasks);
  return { date, raw: date === null ? null : toDateKey(date) };
}

export interface TimelineResult {
  originDate: Date | null; // 全体原点（実日付を持たない場合は仮想原点＝null）
  offsetsByProjectKey: Map<string, number>;
}

/**
 * 全プロジェクトの基準日から共通の原点を求め、各プロジェクトの営業日オフセットを算出する（4.1.5）。
 * いずれのプロジェクトも基準日を持たない場合は、全プロジェクトのオフセットを0とする仮想原点を用いる。
 */
export function computeTimeline(
  basisDatesByProjectKey: ReadonlyMap<string, Date | null>,
  holidayKeys: ReadonlySet<string>,
): TimelineResult {
  let earliestBasisDate: Date | null = null;
  for (const date of basisDatesByProjectKey.values()) {
    if (date === null) continue;
    if (earliestBasisDate === null || date.getTime() < earliestBasisDate.getTime()) {
      earliestBasisDate = date;
    }
  }

  const offsetsByProjectKey = new Map<string, number>();

  if (earliestBasisDate === null) {
    for (const key of basisDatesByProjectKey.keys()) {
      offsetsByProjectKey.set(key, 0);
    }
    return { originDate: null, offsetsByProjectKey };
  }

  const origin = nextOrSameBusinessDay(earliestBasisDate, holidayKeys);
  for (const [key, date] of basisDatesByProjectKey) {
    if (date === null) {
      offsetsByProjectKey.set(key, 0);
      continue;
    }
    const snapped = nextOrSameBusinessDay(date, holidayKeys);
    offsetsByProjectKey.set(key, businessDayOffset(origin, snapped, holidayKeys));
  }

  return { originDate: origin, offsetsByProjectKey };
}
