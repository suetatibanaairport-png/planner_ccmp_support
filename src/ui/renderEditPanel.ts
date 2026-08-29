// 機能仕様書 4.3 / UI・UX仕様書 4.3: 依存関係の手動編集ペインの描画。
// DOM 書き込みは security/dom.ts のヘルパーのみ。CSV 由来のタスク ID は属性に出さず、
// 各セルのイベントリスナのクロージャで捕捉する。
import type { Edge, Task, TaskId } from "../types";
import { appendChildren, clearChildren, createHtmlElement, setText } from "../security/dom";
import { closeContextMenu, openContextMenu } from "./contextMenu";

export interface EditPanelHandlers {
  onSelectFile: (fileName: string) => void;
  onUpdateGraph: () => void;
  onExport: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onStartAdd: (originTaskId: TaskId, kind: "pred" | "succ") => void;
  onCancelAdd: () => void;
  onPickCounterpart: (otherTaskId: TaskId) => void;
  onDeleteEdge: (from: TaskId, to: TaskId) => void;
}

export interface EditPanelArgs {
  fileNames: readonly string[];
  selectedFileName: string | null;
  tasks: readonly Task[]; // 対象プロジェクトの全タスク（定期的タスクを含む）
  edges: readonly Edge[];
  changedIds: ReadonlySet<TaskId>;
  canUndo: boolean;
  canRedo: boolean;
  hasChanges: boolean;
  selecting: { originTaskId: TaskId; kind: "pred" | "succ" } | null;
  handlers: EditPanelHandlers;
}

const shortId = (id: TaskId): string => id.slice(0, 4);

export function renderEditPanel(container: HTMLElement, args: EditPanelArgs): void {
  closeContextMenu();
  clearChildren(container);

  container.appendChild(createHtmlElement("div", { class: "panel-title" }, "依存関係編集"));

  if (args.fileNames.length === 0) {
    container.appendChild(
      createHtmlElement("div", { class: "edit-empty" }, "CSV ファイルを読み込むと編集できます。"),
    );
    return;
  }

  const disabledBySelecting = args.selecting !== null;

  container.appendChild(buildProjectRow(args, disabledBySelecting));
  container.appendChild(buildButtonRow(args, disabledBySelecting));
  container.appendChild(buildTable(args, disabledBySelecting));
}

function buildProjectRow(args: EditPanelArgs, disabled: boolean): HTMLElement {
  const row = createHtmlElement("div", { class: "edit-toolbar" });
  const select = createHtmlElement("select", { class: "edit-project-select" });
  for (const name of args.fileNames) {
    // value 属性は使わず、option のテキスト＝値（select.value がテキストを返す）とする。
    select.appendChild(createHtmlElement("option", {}, name));
  }
  if (args.selectedFileName !== null) select.value = args.selectedFileName;
  if (disabled) select.disabled = true;
  select.addEventListener("change", () => args.handlers.onSelectFile(select.value));
  row.appendChild(select);
  return row;
}

function buildButtonRow(args: EditPanelArgs, disabled: boolean): HTMLElement {
  const row = createHtmlElement("div", { class: "edit-toolbar" });
  const make = (label: string, onClick: () => void, enabled: boolean): HTMLButtonElement => {
    const button = createHtmlElement("button", { type: "button" }, label);
    if (!enabled || disabled) button.disabled = true;
    button.addEventListener("click", onClick);
    return button;
  };
  appendChildren(row, [
    make("グラフを更新", args.handlers.onUpdateGraph, true),
    make("変更内容を出力", args.handlers.onExport, args.hasChanges),
    make("元に戻す", args.handlers.onUndo, args.canUndo),
    make("やり直し", args.handlers.onRedo, args.canRedo),
  ]);
  return row;
}

function buildTable(args: EditPanelArgs, selecting: boolean): HTMLElement {
  const nameById = new Map(args.tasks.map((t) => [t.id, t.name]));
  const label = (id: TaskId): string => `(${shortId(id)})${nameById.get(id) ?? id}`;

  const wrap = createHtmlElement("div", { class: "edit-table-wrap" });
  const table = createHtmlElement("table", { class: "edit-table" });

  const thead = createHtmlElement("thead");
  const headRow = createHtmlElement("tr");
  for (const text of ["先行タスク", "タスク", "後続タスク"]) {
    headRow.appendChild(createHtmlElement("th", {}, text));
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = createHtmlElement("tbody");
  const editableTasks = args.tasks.filter((t) => !t.isRecurring);

  for (const task of editableTasks) {
    const predIds = args.edges.filter((e) => e.to === task.id).map((e) => e.from);
    const succIds = args.edges.filter((e) => e.from === task.id).map((e) => e.to);

    const tr = createHtmlElement("tr");

    tr.appendChild(
      buildSideCell("edit-col-pred", predIds, label, selecting, (predId) =>
        args.handlers.onDeleteEdge(predId, task.id),
      ),
    );
    tr.appendChild(buildMidCell(task, label(task.id), args, selecting));
    tr.appendChild(
      buildSideCell("edit-col-succ", succIds, label, selecting, (succId) =>
        args.handlers.onDeleteEdge(task.id, succId),
      ),
    );

    tbody.appendChild(tr);

    if (args.selecting && args.selecting.originTaskId === task.id) {
      const cancelRow = createHtmlElement("tr", { class: "edit-cancel-row" });
      const cell = createHtmlElement("td", { colspan: "3" });
      const button = createHtmlElement("button", { type: "button" }, "追加をキャンセルする");
      button.addEventListener("click", () => args.handlers.onCancelAdd());
      cell.appendChild(button);
      cancelRow.appendChild(cell);
      tbody.appendChild(cancelRow);
    }
  }

  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function buildSideCell(
  className: string,
  ids: readonly TaskId[],
  label: (id: TaskId) => string,
  selecting: boolean,
  onDelete: (id: TaskId) => void,
): HTMLElement {
  const cell = createHtmlElement("td", {
    class: selecting ? `${className} edit-disabled` : className,
  });
  for (const id of ids) {
    const chip = createHtmlElement("span", { class: "edit-chip" });
    setText(chip, label(id));
    if (!selecting) {
      chip.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        openContextMenu(event.clientX, event.clientY, [
          { label: "タスクを削除する", onSelect: () => onDelete(id) },
        ]);
      });
    }
    cell.appendChild(chip);
  }
  return cell;
}

function buildMidCell(
  task: Task,
  text: string,
  args: EditPanelArgs,
  selecting: boolean,
): HTMLElement {
  const classes = ["edit-col-mid"];
  if (args.changedIds.has(task.id)) classes.push("edit-changed");
  if (selecting) classes.push("edit-selectable");
  const cell = createHtmlElement("td", { class: classes.join(" ") });
  setText(cell, text);

  if (selecting) {
    cell.addEventListener("click", () => args.handlers.onPickCounterpart(task.id));
  } else {
    cell.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      openContextMenu(event.clientX, event.clientY, [
        {
          label: "先行タスクを追加する",
          onSelect: () => args.handlers.onStartAdd(task.id, "pred"),
        },
        {
          label: "後続タスクを追加する",
          onSelect: () => args.handlers.onStartAdd(task.id, "succ"),
        },
      ]);
    });
  }
  return cell;
}
