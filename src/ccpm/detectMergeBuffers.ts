// 機能仕様書 4.1.3（クリティカルチェーン＝クリティカルパス、リソースレベリングなし）
// 4.1.4「合流バッファ候補の検出」の実装。
import type { Arrow, ArrowTiming, EventId, MergeBufferCandidate } from "../types";

/**
 * 合流バッファ候補を検出する。
 * 条件: (1) 入次数が2以上 (2) 入辺の少なくとも1本がクリティカルチェーン（=クリティカルパス）に属さない。
 */
export function detectMergeBufferCandidates(arrowTimings: ArrowTiming[]): MergeBufferCandidate[] {
  const incomingByEvent = new Map<EventId, Arrow[]>();
  const criticalIncomingCount = new Map<EventId, number>();

  for (const t of arrowTimings) {
    const list = incomingByEvent.get(t.arrow.to) ?? [];
    list.push(t.arrow);
    incomingByEvent.set(t.arrow.to, list);
    if (t.isCritical) {
      criticalIncomingCount.set(t.arrow.to, (criticalIncomingCount.get(t.arrow.to) ?? 0) + 1);
    }
  }

  const candidates: MergeBufferCandidate[] = [];
  for (const [eventId, arrows] of incomingByEvent) {
    if (arrows.length < 2) continue;
    const criticalCount = criticalIncomingCount.get(eventId) ?? 0;
    if (criticalCount >= arrows.length) continue; // 全入辺がクリティカルなら候補ではない

    const feedingArrows = arrows.filter((a) => {
      const timing = arrowTimings.find((t) => t.arrow === a);
      return !(timing?.isCritical ?? false);
    });
    candidates.push({ eventId, feedingArrows });
  }

  return candidates;
}
