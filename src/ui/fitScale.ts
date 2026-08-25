/** 読み込み直後に図全体がビューポートに収まる拡大率を計算する（UI・UX仕様書 4.2.4 ズーム操作）。 */
export function computeFitScale(
  contentWidth: number,
  contentHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  minScale: number,
): number {
  if (contentWidth <= 0 || contentHeight <= 0 || viewportWidth <= 0 || viewportHeight <= 0) {
    return 1;
  }
  return Math.max(
    minScale,
    Math.min(1, viewportWidth / contentWidth, viewportHeight / contentHeight),
  );
}
