// 機能仕様書 4.2.4「レイアウト」の描画ルールを実装する。
// DOM操作は security/dom.ts の安全ヘルパーのみを経由する（6.2/詳細設計書7.1）。
import { createSvgElement } from "../security/dom";
import type { Project } from "../types";
import { colorFor } from "../workspace/colorPalette";
import type { ProjectLayout, WorkspaceLayout } from "../layout/layoutWorkspace";
import { buildCalendarAxis } from "./calendarAxis";

export interface DiagramConfig {
  pixelsPerDay: number;
  pixelsPerCalendarDay: number; // カレンダー軸モードでの1暦日あたりの幅（UI・UX仕様書 4.2.4）
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
  pixelsPerCalendarDay: 18,
  rowHeight: 84,
  nodeRadius: 6,
  mergeBufferRadius: 11,
  normalStrokeWidth: 1.5,
  criticalStrokeWidth: 5,
  padding: 24,
  labelFontSize: 10,
  axisHeight: 28,
};

/** カレンダー軸モードの入力（共通時間軸の原点日付と非営業日カレンダー）。 */
export interface CalendarAxisInput {
  originDate: Date;
  holidayKeys: ReadonlySet<string>;
}

/**
 * 描画結果。`diagram` は図本体（ノード・矢線・縦グリッド線・網掛け）、`axis` は横軸の目盛り行
 * （日付／営業日ラベル）を別 SVG に分けたもの。ui/ 側で `axis` をビューポート上端に固定し、
 * 横スクロール・ズームにのみ追従させる（UI・UX仕様書 4.2.4）。両 SVG は同じ `width`。
 */
export interface RenderedDiagram {
  diagram: SVGSVGElement;
  axis: SVGSVGElement;
}

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
const NON_BUSINESS_BAND_COLOR = "#f5f6f7"; // カレンダー軸モードで土日祝の隙間に敷く薄い網掛け

/** 読み込み済み全プロジェクトを図本体 SVG と横軸 SVG に分けてレンダリングする（4.2.4）。 */
export function renderDiagram(
  workspace: WorkspaceLayout,
  projects: readonly Project[],
  colorPalette: ReadonlyMap<string, string>,
  config: DiagramConfig = DEFAULT_DIAGRAM_CONFIG,
  calendarAxisInput?: CalendarAxisInput,
): RenderedDiagram {
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

  const firstDay = Math.floor(minX);
  const lastDay = Math.ceil(maxX);

  // カレンダー軸モード: グローバル営業日番号を実カレンダー日インデックスへ写像する（土日祝は隙間になる）。
  const calendarAxis = calendarAxisInput
    ? buildCalendarAxis(
        firstDay,
        lastDay,
        calendarAxisInput.originDate,
        calendarAxisInput.holidayKeys,
      )
    : null;
  const unitWidth = calendarAxis ? config.pixelsPerCalendarDay : config.pixelsPerDay;
  const axisSpan = calendarAxis ? calendarAxis.span : lastDay - firstDay;

  const totalRows = workspace.projects.reduce((sum, pl) => sum + pl.rowCount, 0);
  const width = axisSpan * unitWidth + config.padding * 2 + config.nodeRadius * 2;
  const height = Math.max(totalRows, 1) * config.rowHeight + config.padding * 2 + config.axisHeight;

  const svg = createSvgElement("svg", {
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
  });
  // 横軸の目盛り行は別 SVG に分け、ui/ 側でビューポート上端に固定する（UI・UX仕様書 4.2.4）。
  const axis = createSvgElement("svg", {
    width,
    height: config.axisHeight,
    viewBox: `0 0 ${width} ${config.axisHeight}`,
  });
  // 本体をスクロールしても目盛り行が透けないように不透明な背景を敷く。
  axis.appendChild(
    createSvgElement("rect", { x: 0, y: 0, width, height: config.axisHeight, fill: NODE_FILL }),
  );

  const toPixelX = (x: number): number =>
    config.padding + (calendarAxis ? calendarAxis.calendarDayOf(x) : x - minX) * unitWidth;
  const toPixelY = (pl: ProjectLayout, row: number): number =>
    config.axisHeight +
    config.padding +
    (pl.topRow + row) * config.rowHeight +
    config.rowHeight / 2;

  const nonBusinessRect = (x: number, y: number, w: number, h: number): SVGElement =>
    createSvgElement("rect", { x, y, width: w, height: h, fill: NON_BUSINESS_BAND_COLOR });

  // 目盛り1本ぶん: 本体には全高の縦グリッド線、軸 SVG には短いティックとラベルを描く。
  const emitTick = (x: number, label: string | null): void => {
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
    axis.appendChild(
      createSvgElement("line", {
        x1: x,
        y1: config.axisHeight - 6,
        x2: x,
        y2: config.axisHeight,
        stroke: AXIS_LINE_COLOR,
        "stroke-width": 1,
      }),
    );
    if (label !== null) {
      axis.appendChild(
        createSvgElement(
          "text",
          {
            x,
            y: config.axisHeight - 10,
            "text-anchor": "middle",
            "font-size": 10,
            fill: AXIS_TEXT_COLOR,
          },
          label,
        ),
      );
    }
  };

  if (calendarAxis) {
    let prev: { businessDay: number; calendarDay: number } | null = null;
    for (const tick of calendarAxis.ticks) {
      const x = toPixelX(tick.businessDay);
      if (prev && tick.calendarDay - prev.calendarDay > 1) {
        // 直前の営業日と当営業日の間の非営業日カラムを薄く網掛けする（本体は全高、軸は上端ぶん）。
        const bandX = config.padding + (prev.calendarDay + 1) * unitWidth;
        const bandW = (tick.calendarDay - prev.calendarDay - 1) * unitWidth;
        svg.appendChild(
          nonBusinessRect(bandX, config.axisHeight, bandW, height - config.axisHeight),
        );
        axis.appendChild(nonBusinessRect(bandX, 0, bandW, config.axisHeight));
      }
      emitTick(x, tick.label);
      prev = tick;
    }
  } else {
    // 営業日軸: 最終タスクの終了（右端）を 0 とし、開始方向へ残営業日数を加算する（表示のみ）。
    for (let day = firstDay; day <= lastDay; day++) {
      emitTick(toPixelX(day), String(lastDay - day));
    }
  }

  axis.appendChild(
    createSvgElement("line", {
      x1: 0,
      y1: config.axisHeight - 1,
      x2: width,
      y2: config.axisHeight - 1,
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

  return { diagram: svg, axis };
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
 * ノード→水平線→斜め線→ノードの順とし、合流イベントの直前まで先行タスクと同じ行（レーン）を保つ。
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
