// 機能仕様書 4.2.4「色分け」: 固定パレットを持たず、担当者数に応じて色相環を均等分割し、
// 都度動的に生成する。ファイルの追加・解除で担当者数が変わるたびに再生成される。
export const UNASSIGNED_COLOR = "hsl(0 0% 55%)"; // 3.6: 「未アサイン」用の色（無彩色）

const SATURATION = 62;
const LIGHTNESS = 63;

/** 担当者名一覧（重複なし）から、氏名の完全一致で色を割り当てる（3.5.3）。 */
export function generateColorPalette(assigneeNames: readonly string[]): Map<string, string> {
  const unique = [...new Set(assigneeNames)].sort(); // 決定的な順序（都度再生成での安定性のため）
  const palette = new Map<string, string>();
  const n = unique.length;
  unique.forEach((name, index) => {
    const hue = n === 0 ? 0 : Math.round((360 * index) / n);
    palette.set(name, `hsl(${hue} ${SATURATION}% ${LIGHTNESS}%)`);
  });
  return palette;
}

export function colorFor(palette: ReadonlyMap<string, string>, assignee: string | undefined): string {
  if (assignee === undefined) return UNASSIGNED_COLOR;
  return palette.get(assignee) ?? UNASSIGNED_COLOR;
}
