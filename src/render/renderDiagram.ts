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
  labelFontSize: number;
  axisHeight: number;
}

export const DEFAULT_DIAGRAM_CONFIG: DiagramConfig = {
  pixelsPerDay: 24,
  rowHeight: 84,
  nodeRadius: 6,
  mergeBufferRadius: 11,
  normalStrokeWidth: 1.5,
  criticalStrokeWidth: 5,
  padding: 24,
  labelFontSize: 10,
  axisHeight: 28,
};

const DUMMY_COLOR = "#9aa0a6"; // 無彩色（4.2.4「ダミー」）
const BOUNDARY_COLOR = "#c4c7cc"; // プロジェクト境界のグレーの水平線（4.2.4）
const PROJECT_LABEL_FONT_SIZE = 11; // AOA左上のプロジェクト名ラベル（機能仕様書 3.5.4 / UI・UX仕様書 4.2.4）
const PROJECT_LABEL_COLOR = "#4b5563";
const NODE_FILL = "#ffffff";
const NODE_STROKE = "#4b5563";
const LABEL_OFFSET_Y = 4; // タスク名ラベルと矢線の間の余白（px）
const GRID_COLOR = "#eef0f2"; // 背景の縦グリッド（営業日の目盛り）
const AXIS_TEXT_COLOR = "#6b7280";
const AXIS_LINE_COLOR = "#c4c7cc";

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

    // 機能仕様書 3.5.4: 各プロジェクトの先頭タスクの上部・左詰めにプロジェクト名（ファイル名）を表示する。
    // 孤立タスクの独立プロジェクトには表示しない。先頭行の中心が +rowHeight/2 にあり上部に余白があるため、
    // 追加の行確保はしない。
    if (!pl.isolated) {
      const bandTop = config.axisHeight + config.padding + pl.topRow * config.rowHeight;
      svg.appendChild(
        createSvgElement(
          "text",
          {
            class: "project-label",
            x: config.padding,
            y: bandTop + PROJECT_LABEL_FONT_SIZE + 2,
            "font-size": PROJECT_LABEL_FONT_SIZE,
            "font-weight": "600",
            fill: PROJECT_LABEL_COLOR,
          },
          pl.fileName,
        ),
      );
    }

    const mergeBufferEventIds = new Set(project.mergeBufferCandidates.map((c) => c.eventId));
    const taskNameById = new Map(project.tasks.map((t) => [t.id, t.name]));

    for (const timing of project.arrowTimings) {
      const fromPos = pl.positions.get(timing.arrow.from);
      const toPos = pl.positions.get(timing.arrow.to);
      if (!fromPos || !toPos) continue;

      const x1 = toPixelX(fromPos.x);
      const y1 = toPixelY(pl, fromPos.row);
      const x2 = toPixelX(toPos.x);
      const y2 = toPixelY(pl, toPos.row);

      const isDummy = timing.arrow.kind === "dummy";
      const points = timing.arrow.placeholder
        ? zigzagPoints(x1, y1, x2, y2)
        : elbowPoints(x1, y1, x2, y2, isDummy);
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

      const taskName = timing.arrow.taskId ? taskNameById.get(timing.arrow.taskId) : undefined;
      if (taskName) {
        const [labelX, labelY] = labelAnchor(points);
        svg.appendChild(
          createSvgElement(
            "text",
            {
              x: labelX,
              y: labelY - LABEL_OFFSET_Y,
              "text-anchor": "middle",
              "font-size": config.labelFontSize,
              fill: NODE_STROKE,
            },
            taskName,
          ),
        );
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
    }
  }

  return svg;
}

/**
 * タスク名ラベルの位置を、矢線の末尾区間（折れ線なら合流先の行に落ち着いた水平区間）の
 * 中点から求める。始点・終点だけから中点を取ると、行の高さが離れているほど実際の線から
 * 離れた位置に浮いてしまうため、実際に描画される区間を使う。
 */
function labelAnchor(points: ReadonlyArray<[number, number]>): [number, number] {
  const [ex1, ey1] = points[points.length - 2] ?? points[0]!;
  const [ex2, ey2] = points[points.length - 1]!;
  return [(ex1 + ex2) / 2, Math.min(ey1, ey2)];
}

const DIAGONAL_RUN = 24; // 分岐部の斜め線がX方向に進む長さ（px）

/**
 * 折れ線で2点を結ぶ（4.2.4「矢線の描画」）。通常の矢線はノード→斜め線→水平線→ノードの順
 * （終点の行に早く合流し、大半を終点側の行で水平に進む）。ダミー矢線（isDummy）は逆に
 * ノード→水平線→斜め線→ノードの順とし、合流イベントの直前まで先行タスクと同じ行を保つ。
 */
function elbowPoints(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  isDummy = false,
): Array<[number, number]> {
  if (y1 === y2)
    return [
      [x1, y1],
      [x2, y2],
    ];
  const run = Math.min(DIAGONAL_RUN, Math.abs(x2 - x1) / 2);
  if (isDummy) {
    const kinkX = x2 - run;
    return [
      [x1, y1],
      [kinkX, y1],
      [x2, y2],
    ];
  }
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
