// 機能仕様書 4.2.4「レイアウト」の描画ルールを実装する。
// DOM操作は security/dom.ts の安全ヘルパーのみを経由する（6.2/詳細設計書7.1）。
import { createSvgElement } from "../security/dom";
import type { Project } from "../types";
import { colorFor } from "../workspace/colorPalette";
import type { ProjectLayout, WorkspaceLayout } from "../layout/layoutWorkspace";

export interface DiagramConfig {
  pixelsPerDay: number;
  rowHeight: number;
  nodeRadius: number;
  mergeBufferRadius: number;
  normalStrokeWidth: number;
  criticalStrokeWidth: number;
  padding: number;
  axisHeight: number;
}

export const DEFAULT_DIAGRAM_CONFIG: DiagramConfig = {
  pixelsPerDay: 48,
  rowHeight: 56,
  nodeRadius: 9,
  mergeBufferRadius: 13,
  normalStrokeWidth: 1.5,
  criticalStrokeWidth: 3.5,
  padding: 24,
  axisHeight: 28,
};

const DUMMY_COLOR = "#9aa0a6"; // 無彩色（4.2.4「ダミー」）
const BOUNDARY_COLOR = "#c4c7cc"; // プロジェクト境界のグレーの水平線（4.2.4）
const NODE_FILL = "#ffffff";
const NODE_STROKE = "#4b5563";
const GRID_COLOR = "#eef0f2"; // 背景の縦グリッド（営業日の目盛り）
const AXIS_TEXT_COLOR = "#6b7280";
const AXIS_LINE_COLOR = "#c4c7cc";
const NODE_LABEL_COLOR = "#4b5563";
const TASK_LABEL_FONT_SIZE = 10;

/** 読み込み済み全プロジェクトを1つのSVGにレンダリングする（4.2.4）。 */
export function renderDiagram(
  workspace: WorkspaceLayout,
  projects: readonly Project[],
  colorPalette: ReadonlyMap<string, string>,
  config: DiagramConfig = DEFAULT_DIAGRAM_CONFIG,
): SVGSVGElement {
  const projectByKey = new Map(projects.map((p) => [p.key, p]));

  let minX = Infinity;
  let maxX = -Infinity;
  for (const pl of workspace.projects) {
    for (const pos of pl.positions.values()) {
      if (pos.x < minX) minX = pos.x;
      if (pos.x > maxX) maxX = pos.x;
    }
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    maxX = 0;
  }

  const totalRows = workspace.projects.reduce((sum, pl) => sum + pl.rowCount, 0);
  const width = (maxX - minX) * config.pixelsPerDay + config.padding * 2 + config.nodeRadius * 2;
  const height = Math.max(totalRows, 1) * config.rowHeight + config.padding * 2 + config.axisHeight;

  const svg = createSvgElement("svg", {
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
  });

  const toPixelX = (x: number): number => config.padding + (x - minX) * config.pixelsPerDay;
  const toPixelY = (pl: ProjectLayout, row: number): number =>
    config.axisHeight +
    config.padding +
    (pl.topRow + row) * config.rowHeight +
    config.rowHeight / 2;

  const firstDay = Math.floor(minX);
  const lastDay = Math.ceil(maxX);
  for (let day = firstDay; day <= lastDay; day++) {
    const x = toPixelX(day);
    svg.appendChild(
      createSvgElement("line", {
        x1: x,
        y1: config.axisHeight,
        x2: x,
        y2: height,
        stroke: GRID_COLOR,
        "stroke-width": 1,
      }),
    );
    svg.appendChild(
      createSvgElement(
        "text",
        {
          x,
          y: config.axisHeight - 10,
          "text-anchor": "middle",
          "font-size": 10,
          fill: AXIS_TEXT_COLOR,
        },
        String(day),
      ),
    );
  }
  svg.appendChild(
    createSvgElement("line", {
      x1: 0,
      y1: config.axisHeight,
      x2: width,
      y2: config.axisHeight,
      stroke: AXIS_LINE_COLOR,
      "stroke-width": 1,
    }),
  );

  for (const pl of workspace.projects) {
    const project = projectByKey.get(pl.projectKey);
    if (!project) continue;

    if (pl.topRow > 0) {
      const y = config.axisHeight + config.padding + pl.topRow * config.rowHeight;
      svg.appendChild(
        createSvgElement("line", {
          x1: 0,
          y1: y,
          x2: width,
          y2: y,
          stroke: BOUNDARY_COLOR,
          "stroke-width": 1,
        }),
      );
    }

    const mergeBufferEventIds = new Set(project.mergeBufferCandidates.map((c) => c.eventId));
    const taskById = new Map(project.tasks.map((t) => [t.id, t]));

    for (const timing of project.arrowTimings) {
      const fromPos = pl.positions.get(timing.arrow.from);
      const toPos = pl.positions.get(timing.arrow.to);
      if (!fromPos || !toPos) continue;

      const x1 = toPixelX(fromPos.x);
      const y1 = toPixelY(pl, fromPos.row);
      const x2 = toPixelX(toPos.x);
      const y2 = toPixelY(pl, toPos.row);

      const points = timing.arrow.placeholder
        ? zigzagPoints(x1, y1, x2, y2)
        : elbowPoints(x1, y1, x2, y2);
      const isDummy = timing.arrow.kind === "dummy";
      const strokeColor = isDummy ? DUMMY_COLOR : colorFor(colorPalette, timing.arrow.assignee);

      const attrs: Record<string, string | number> = {
        points: points.map(([x, y]) => `${x},${y}`).join(" "),
        fill: "none",
        stroke: strokeColor,
        "stroke-width": timing.isCritical ? config.criticalStrokeWidth : config.normalStrokeWidth,
      };
      if (isDummy) {
        attrs["stroke-dasharray"] = "5 4";
      }
      svg.appendChild(createSvgElement("polyline", attrs));

      const task = timing.arrow.taskId ? taskById.get(timing.arrow.taskId) : undefined;
      if (task && task.name) {
        // ラベルはエッジの水平区間（折れ線の最後の線分）の上に配置する。ジグザグ（仮置き）は
        // 始点・終点を結ぶ直線の中点上に置く。
        const [sx, sy] = timing.arrow.placeholder
          ? [x1, Math.min(y1, y2)]
          : points[points.length - 2]!;
        const [ex] = timing.arrow.placeholder ? [x2] : points[points.length - 1]!;
        const labelX = (sx + ex) / 2;
        const labelY = sy - 6;
        const label = truncateLabel(Math.abs(ex - sx), task.name);
        if (label) {
          svg.appendChild(
            createSvgElement(
              "text",
              {
                x: labelX,
                y: labelY,
                "text-anchor": "middle",
                "font-size": TASK_LABEL_FONT_SIZE,
                fill: strokeColor,
              },
              label,
            ),
          );
        }
      }
    }

    for (const event of project.events) {
      const pos = pl.positions.get(event.id);
      if (!pos) continue;
      const cx = toPixelX(pos.x);
      const cy = toPixelY(pl, pos.row);
      const isMergeBuffer = mergeBufferEventIds.has(event.id);
      svg.appendChild(
        createSvgElement("circle", {
          cx,
          cy,
          r: isMergeBuffer ? config.mergeBufferRadius : config.nodeRadius,
          fill: NODE_FILL,
          stroke: NODE_STROKE,
          "stroke-width": isMergeBuffer ? 2.5 : 1.5,
        }),
      );
      svg.appendChild(
        createSvgElement(
          "text",
          {
            x: cx,
            y: cy,
            "text-anchor": "middle",
            "dominant-baseline": "central",
            "font-size": isMergeBuffer ? 10 : 9,
            fill: NODE_LABEL_COLOR,
          },
          String(event.number),
        ),
      );
    }
  }

  return svg;
}

/** タスク名がエッジの表示幅に収まらない場合、末尾を省略する（和欧混在を考慮した概算幅）。 */
function truncateLabel(availableWidthPx: number, name: string): string {
  const avgCharWidthPx = TASK_LABEL_FONT_SIZE * 0.9;
  const maxChars = Math.floor(availableWidthPx / avgCharWidthPx);
  if (maxChars <= 0) return "";
  if (name.length <= maxChars) return name;
  if (maxChars === 1) return "…";
  return `${name.slice(0, maxChars - 1)}…`;
}

const DIAGONAL_RUN = 24; // 分岐部の斜め線がX方向に進む長さ（px）

/** 折れ線（ノード→斜め線→水平線→ノード）で2点を結ぶ（4.2.4「矢線の描画」）。 */
function elbowPoints(x1: number, y1: number, x2: number, y2: number): Array<[number, number]> {
  if (y1 === y2)
    return [
      [x1, y1],
      [x2, y2],
    ];
  const run = Math.min(DIAGONAL_RUN, Math.abs(x2 - x1) / 2);
  const kinkX = x1 + run;
  return [
    [x1, y1],
    [kinkX, y2],
    [x2, y2],
  ];
}

/** 所要日数が仮置きのタスク用、ジグザグの実線（3.6/4.2.4）。 */
function zigzagPoints(x1: number, y1: number, x2: number, y2: number): Array<[number, number]> {
  const SEGMENTS = 6;
  const AMPLITUDE = 4;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;

  const points: Array<[number, number]> = [[x1, y1]];
  for (let i = 1; i < SEGMENTS; i++) {
    const t = i / SEGMENTS;
    const px = x1 + dx * t;
    const py = y1 + dy * t;
    const offset = (i % 2 === 0 ? 1 : -1) * AMPLITUDE;
    points.push([px + nx * offset, py + ny * offset]);
  }
  points.push([x2, y2]);
  return points;
}
