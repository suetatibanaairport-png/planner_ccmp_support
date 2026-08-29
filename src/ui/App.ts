// 機能仕様書 1.4「画面構成」の組み立て：ヘッダー・メイン領域（図＋ズーム／パン＋パネル）・
// フッター（担当者凡例／依存関係編集／エラー表示／休日設定ファイルの各ボタン、著作権表示）。
import { parseHolidayFile } from "../calendar/holidayFile";
import { layoutWorkspace } from "../layout/layoutWorkspace";
import { DEFAULT_DIAGRAM_CONFIG, renderDiagram } from "../render/renderDiagram";
import { renderErrorPanel, renderWarningList, updateErrorBadge } from "../render/renderErrorPanel";
import { renderLegend } from "../render/renderLegend";
import {
  appendChildren,
  clearChildren,
  createHtmlElement,
  downloadTextFile,
  setSafeAttribute,
} from "../security/dom";
import { EditSession } from "../edit/EditSession";
import { successorsCsvText } from "../edit/editEdges";
import type { FatalErrorInfo, TaskId, WarningInfo } from "../types";
import { selectFilesWithinLimits } from "../validate/selectFilesWithinLimits";
import { Workspace } from "../workspace/Workspace";
import { computeFitScale } from "./fitScale";
import { renderEditPanel, type EditPanelHandlers } from "./renderEditPanel";

const ADD_EDGE_ERROR: Record<"self" | "duplicate" | "cycle", string> = {
  self: "自分自身を先行・後続タスクに指定することはできません。",
  duplicate: "その後続タスクは既に登録されています。",
  cycle: "この追加を行うと依存関係が循環します。追加は行いません。",
};

const ZOOM_MIN = 0.2;
const ZOOM_MAX = 5;
const ZOOM_STEP = 1.2;

export class App {
  private workspace: Workspace;
  private allErrors: FatalErrorInfo[] = [];
  private allWarnings: WarningInfo[] = [];

  private scale = 1;
  private translateX = 0;
  private translateY = 0;
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragStartTranslateX = 0;
  private dragStartTranslateY = 0;

  private diagramLayer!: HTMLDivElement;
  private diagramViewport!: HTMLDivElement;
  private errorPanel!: HTMLDivElement;
  private warningPanel!: HTMLDivElement;
  private legendPanel!: HTMLDivElement;
  private editPanel!: HTMLDivElement;
  private errorBadge!: HTMLElement;
  private taskFileInput!: HTMLInputElement;
  private holidayFileInput!: HTMLInputElement;

  // 機能仕様書 4.3: 依存関係の手動編集。編集状態はプロジェクト（ファイル）ごとに独立して保持する。
  private editSessions = new Map<string, EditSession>();
  private selectedEditFile: string | null = null;
  private editSelecting: { originTaskId: TaskId; kind: "pred" | "succ" } | null = null;
  private layoutShiftNoticeShown = false;

  constructor(root: HTMLElement, defaultHolidayCsvText: string) {
    const defaultHolidays = parseHolidayFile(defaultHolidayCsvText);
    this.workspace = new Workspace(defaultHolidays.dateKeys);
    this.buildDom(root);
    this.rerender();
  }

  private buildDom(root: HTMLElement): void {
    clearChildren(root);

    const header = this.buildHeader();
    const main = this.buildMain();
    const footer = this.buildFooter();

    appendChildren(root, [header, main, footer]);
  }

  private buildHeader(): HTMLElement {
    const title = createHtmlElement("span", { class: "app-title" }, "Planner CCMP Support");

    const openButton = createHtmlElement("button", { type: "button" }, "ファイルを開く");
    openButton.addEventListener("click", () => this.taskFileInput.click());

    const resetButton = createHtmlElement("button", { type: "button" }, "リセット");
    resetButton.addEventListener("click", () => this.handleReset());

    this.taskFileInput = createHtmlElement("input", {
      type: "file",
      accept: ".csv",
      multiple: "multiple",
      hidden: "hidden",
    });
    this.taskFileInput.addEventListener("change", () => {
      const files = this.taskFileInput.files;
      if (files && files.length > 0) void this.handleFilesSelected(files);
      this.taskFileInput.value = "";
    });

    const header = createHtmlElement("header", { class: "app-header" });
    appendChildren(header, [title, openButton, resetButton, this.taskFileInput]);
    return header;
  }

  private buildMain(): HTMLElement {
    const main = createHtmlElement("main", { class: "app-main" });

    this.diagramViewport = createHtmlElement("div", { class: "diagram-viewport" });
    this.diagramLayer = createHtmlElement("div", { class: "diagram-layer" });
    this.diagramViewport.appendChild(this.diagramLayer);
    this.wireZoomPan();

    const zoomIn = createHtmlElement("button", { type: "button" }, "+");
    zoomIn.addEventListener("click", () => this.applyZoom(ZOOM_STEP, null));
    const zoomOut = createHtmlElement("button", { type: "button" }, "−");
    zoomOut.addEventListener("click", () => this.applyZoom(1 / ZOOM_STEP, null));
    const zoomControls = createHtmlElement("div", { class: "zoom-controls" });
    appendChildren(zoomControls, [zoomIn, zoomOut]);

    this.errorPanel = createHtmlElement("div", { class: "panel error-panel", hidden: "hidden" });
    this.warningPanel = createHtmlElement("div", {
      class: "panel warning-panel",
      hidden: "hidden",
    });
    this.legendPanel = createHtmlElement("div", { class: "panel legend-panel", hidden: "hidden" });
    this.editPanel = createHtmlElement("div", { class: "panel edit-panel", hidden: "hidden" });

    appendChildren(main, [
      this.diagramViewport,
      zoomControls,
      this.errorPanel,
      this.warningPanel,
      this.legendPanel,
      this.editPanel,
    ]);
    return main;
  }

  private buildFooter(): HTMLElement {
    const holidayButton = createHtmlElement("button", { type: "button" }, "休日設定ファイル");
    holidayButton.addEventListener("click", () => this.holidayFileInput.click());

    this.holidayFileInput = createHtmlElement("input", {
      type: "file",
      accept: ".csv",
      hidden: "hidden",
    });
    this.holidayFileInput.addEventListener("change", () => {
      const file = this.holidayFileInput.files?.[0];
      if (file) void this.handleHolidayFileSelected(file);
      this.holidayFileInput.value = "";
    });

    this.errorBadge = createHtmlElement("span", { class: "error-badge", hidden: "hidden" });
    const errorButton = createHtmlElement("button", { type: "button" }, "エラー表示");
    errorButton.addEventListener("click", () => this.togglePanel(this.errorPanel));

    const legendButton = createHtmlElement("button", { type: "button" }, "担当者凡例");
    legendButton.addEventListener("click", () => this.togglePanel(this.legendPanel));

    const editButton = createHtmlElement("button", { type: "button" }, "依存関係編集");
    editButton.addEventListener("click", () => {
      this.togglePanel(this.editPanel);
      this.rerenderEditPanel();
    });

    // フッター左のボタン並び（UI・UX仕様書 1.4）: 担当者凡例・依存関係編集・エラー表示・休日設定ファイル。
    const footerLeft = createHtmlElement("div", { class: "footer-left" });
    appendChildren(footerLeft, [
      legendButton,
      editButton,
      errorButton,
      this.errorBadge,
      holidayButton,
      this.holidayFileInput,
    ]);

    const footerRight = createHtmlElement(
      "div",
      { class: "footer-right" },
      "© Planner CCMP Support / MIT License / Third-party licenses: PapaParse (MIT License)",
    );

    const footer = createHtmlElement("footer", { class: "app-footer" });
    appendChildren(footer, [footerLeft, footerRight]);
    return footer;
  }

  private togglePanel(panel: HTMLElement): void {
    const isHidden = panel.hasAttribute("hidden");
    for (const p of [this.errorPanel, this.warningPanel, this.legendPanel, this.editPanel]) {
      setSafeAttribute(p, "hidden", "hidden");
    }
    if (isHidden) {
      panel.removeAttribute("hidden");
    }
  }

  /**
   * ステージ[0]: 選択ファイル数・各ファイルのサイズのみで事前検証する（機能仕様書 4.1 ステージ[0]）。
   * FileReader による内容読み込みより前に、E402（ファイル数上限）・E404（サイズ上限）を判定する。
   */
  private async handleFilesSelected(fileList: FileList): Promise<void> {
    if (!this.confirmDiscardEditsIfNeeded()) return;

    const files = [...fileList].sort((a, b) => a.name.localeCompare(b.name, "en"));
    const existingFileCount = this.workspace.getLoadedFileCount();

    const { accepted: readable, rejected: preRejected } = selectFilesWithinLimits(
      existingFileCount,
      files,
    );

    const texts = await Promise.all(readable.map((file) => readFileAsText(file)));
    const entries = readable.map((file, i) => ({ name: file.name, text: texts[i]! }));

    const result = this.workspace.addFiles(entries);
    const batchErrors = [...preRejected, ...result.rejectedFiles];

    this.allErrors.push(...batchErrors);
    this.allWarnings.push(...result.warnings);

    this.rerender();

    if (batchErrors.length === 1) {
      const e = batchErrors[0]!;
      alert(`${e.fileName ?? ""} - ${e.code}: ${e.message}`);
    }
  }

  private async handleHolidayFileSelected(file: File): Promise<void> {
    if (!this.confirmDiscardEditsIfNeeded()) return;

    const text = await readFileAsText(file);
    const parsed = parseHolidayFile(text);

    if (parsed.unreadable) {
      this.allWarnings.push({
        code: "W314",
        fileName: file.name,
        message: "休日設定ファイルを読み込めませんでした。従来の内容のまま継続します。",
      });
      this.rerender();
      return;
    }

    if (parsed.invalidRowCount > 0) {
      this.allWarnings.push({
        code: "W313",
        fileName: file.name,
        message: `日付形式が不正な行を ${parsed.invalidRowCount} 件無視しました。`,
      });
    }

    const warnings = this.workspace.setHolidayKeys(parsed.dateKeys);
    this.allWarnings.push(...warnings);
    this.rerender();
  }

  private handleReset(): void {
    this.workspace.reset();
    this.allErrors = [];
    this.allWarnings = [];
    this.editSessions.clear();
    this.selectedEditFile = null;
    this.editSelecting = null;
    this.layoutShiftNoticeShown = false;
    this.rerender();
  }

  private rerender(): void {
    const projects = this.workspace.getProjects();
    const layout = layoutWorkspace(projects);
    const palette = this.workspace.getColorPalette();

    clearChildren(this.diagramLayer);
    const svg = renderDiagram(layout, projects, palette, DEFAULT_DIAGRAM_CONFIG);
    this.diagramLayer.appendChild(svg);
    this.fitToView(svg);

    renderErrorPanel(this.errorPanel, this.allErrors);
    renderWarningList(this.warningPanel, this.allWarnings);
    renderLegend(this.legendPanel, palette);
    updateErrorBadge(this.errorBadge, this.allErrors.length);
    this.rerenderEditPanel();
  }

  // ── 機能仕様書 4.3: 依存関係の手動編集 ───────────────────────────────

  private confirmDiscardEditsIfNeeded(): boolean {
    let hasEdits = false;
    for (const session of this.editSessions.values()) {
      if (session.hasChanges()) {
        hasEdits = true;
        break;
      }
    }
    if (!hasEdits) return true;

    const ok = window.confirm(
      "未反映の手動編集があります。続行すると手動編集の内容は破棄されます。よろしいですか？",
    );
    if (ok) {
      this.editSessions.clear();
      this.selectedEditFile = null;
      this.editSelecting = null;
    }
    return ok;
  }

  private sessionFor(fileName: string): EditSession {
    let session = this.editSessions.get(fileName);
    if (!session) {
      const model = this.workspace.getModel(fileName);
      session = new EditSession(model?.edges ?? []);
      this.editSessions.set(fileName, session);
    }
    return session;
  }

  private editHandlers(): EditPanelHandlers {
    return {
      onSelectFile: (name) => {
        this.selectedEditFile = name;
        this.editSelecting = null;
        this.rerenderEditPanel();
      },
      onStartAdd: (originTaskId, kind) => {
        this.editSelecting = { originTaskId, kind };
        this.rerenderEditPanel();
      },
      onCancelAdd: () => {
        this.editSelecting = null;
        this.rerenderEditPanel();
      },
      onPickCounterpart: (otherTaskId) => {
        const selecting = this.editSelecting;
        const file = this.selectedEditFile;
        this.editSelecting = null;
        if (!selecting || file === null) {
          this.rerenderEditPanel();
          return;
        }
        const [from, to] =
          selecting.kind === "pred"
            ? [otherTaskId, selecting.originTaskId]
            : [selecting.originTaskId, otherTaskId];
        const result = this.sessionFor(file).add(from, to);
        if (!result.ok) window.alert(ADD_EDGE_ERROR[result.reason]);
        this.rerenderEditPanel();
      },
      onDeleteEdge: (from, to) => {
        if (this.selectedEditFile === null) return;
        this.sessionFor(this.selectedEditFile).remove(from, to);
        this.rerenderEditPanel();
      },
      onUndo: () => {
        if (this.selectedEditFile === null) return;
        this.sessionFor(this.selectedEditFile).undo();
        this.rerenderEditPanel();
      },
      onRedo: () => {
        if (this.selectedEditFile === null) return;
        this.sessionFor(this.selectedEditFile).redo();
        this.rerenderEditPanel();
      },
      onUpdateGraph: () => {
        const file = this.selectedEditFile;
        if (file === null) return;
        if (!this.layoutShiftNoticeShown) {
          window.alert("「グラフを更新」すると図のレイアウトが大きく変わる場合があります。");
          this.layoutShiftNoticeShown = true;
        }
        const warnings = this.workspace.applyManualEdits(file, this.sessionFor(file).edges);
        this.allWarnings = this.allWarnings.filter((w) => w.fileName !== file).concat(warnings);
        this.rerender();
      },
      onExport: () => {
        const file = this.selectedEditFile;
        if (file === null) return;
        const model = this.workspace.getModel(file);
        if (!model) return;
        const session = this.sessionFor(file);
        const text = successorsCsvText(model.tasks, session.changedIds(), session.edges);
        downloadTextFile("後続タスク変更.csv", "text/csv", text);
      },
    };
  }

  private rerenderEditPanel(): void {
    if (this.editPanel.hasAttribute("hidden")) return;

    const fileNames = this.workspace.getLoadedFileNames();
    if (this.selectedEditFile === null || !fileNames.includes(this.selectedEditFile)) {
      this.selectedEditFile = fileNames[0] ?? null;
      this.editSelecting = null;
    }

    const handlers = this.editHandlers();
    const file = this.selectedEditFile;
    const model = file === null ? undefined : this.workspace.getModel(file);

    if (file === null || !model) {
      renderEditPanel(this.editPanel, {
        fileNames,
        selectedFileName: null,
        tasks: [],
        edges: [],
        changedIds: new Set(),
        canUndo: false,
        canRedo: false,
        hasChanges: false,
        selecting: null,
        handlers,
      });
      return;
    }

    const session = this.sessionFor(file);
    renderEditPanel(this.editPanel, {
      fileNames,
      selectedFileName: file,
      tasks: model.tasks,
      edges: session.edges,
      changedIds: session.changedIds(),
      canUndo: session.canUndo(),
      canRedo: session.canRedo(),
      hasChanges: session.hasChanges(),
      selecting: this.editSelecting,
      handlers,
    });
  }

  /** 読み込み直後に図全体が収まるよう、拡大率をビューポートに合わせ直す。 */
  private fitToView(svg: SVGSVGElement): void {
    this.scale = computeFitScale(
      Number(svg.getAttribute("width")),
      Number(svg.getAttribute("height")),
      this.diagramViewport.clientWidth,
      this.diagramViewport.clientHeight,
      ZOOM_MIN,
    );
    this.translateX = 0;
    this.translateY = 0;
    this.applyTransform();
  }

  private wireZoomPan(): void {
    this.diagramViewport.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
        const rect = this.diagramViewport.getBoundingClientRect();
        this.applyZoom(factor, {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        });
      },
      { passive: false },
    );

    this.diagramViewport.addEventListener("pointerdown", (event) => {
      this.isDragging = true;
      this.diagramViewport.classList.add("dragging");
      this.dragStartX = event.clientX;
      this.dragStartY = event.clientY;
      this.dragStartTranslateX = this.translateX;
      this.dragStartTranslateY = this.translateY;
      this.diagramViewport.setPointerCapture(event.pointerId);
    });

    this.diagramViewport.addEventListener("pointermove", (event) => {
      if (!this.isDragging) return;
      this.translateX = this.dragStartTranslateX + (event.clientX - this.dragStartX);
      this.translateY = this.dragStartTranslateY + (event.clientY - this.dragStartY);
      this.applyTransform();
    });

    const endDrag = (): void => {
      this.isDragging = false;
      this.diagramViewport.classList.remove("dragging");
    };
    this.diagramViewport.addEventListener("pointerup", endDrag);
    this.diagramViewport.addEventListener("pointercancel", endDrag);
  }

  private applyZoom(factor: number, origin: { x: number; y: number } | null): void {
    const nextScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, this.scale * factor));
    const appliedFactor = nextScale / this.scale;
    const pivot = origin ?? {
      x: this.diagramViewport.clientWidth / 2,
      y: this.diagramViewport.clientHeight / 2,
    };

    this.translateX = pivot.x - (pivot.x - this.translateX) * appliedFactor;
    this.translateY = pivot.y - (pivot.y - this.translateY) * appliedFactor;
    this.scale = nextScale;
    this.applyTransform();
  }

  private applyTransform(): void {
    this.diagramLayer.style.transform = `translate(${this.translateX}px, ${this.translateY}px) scale(${this.scale})`;
    this.diagramLayer.style.transformOrigin = "0 0";
  }
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("ファイルの読み込みに失敗しました。"));
    reader.readAsText(file);
  });
}
