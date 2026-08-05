// 機能仕様書 1.4「画面構成」の組み立て。ヘッダー・メイン領域（図＋ズーム／パン＋パネル）・
// フッター（休日設定ファイル／エラー表示／凡例ボタン、著作権表示）を構築する。
import { parseHolidayFile } from "../calendar/holidayFile";
import { layoutWorkspace } from "../layout/layoutWorkspace";
import { DEFAULT_DIAGRAM_CONFIG, renderDiagram } from "../render/renderDiagram";
import {
  renderErrorPanel,
  renderWarningList,
  updateErrorBadge,
} from "../render/renderErrorPanel";
import { renderLegend } from "../render/renderLegend";
import { appendChildren, clearChildren, createHtmlElement, setSafeAttribute } from "../security/dom";
import type { FatalErrorInfo, WarningInfo } from "../types";
import { LIMITS } from "../validate/limits";
import { Workspace } from "../workspace/Workspace";

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
  private errorBadge!: HTMLElement;
  private taskFileInput!: HTMLInputElement;
  private holidayFileInput!: HTMLInputElement;

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
    this.warningPanel = createHtmlElement("div", { class: "panel warning-panel", hidden: "hidden" });
    this.legendPanel = createHtmlElement("div", { class: "panel legend-panel", hidden: "hidden" });

    appendChildren(main, [
      this.diagramViewport,
      zoomControls,
      this.errorPanel,
      this.warningPanel,
      this.legendPanel,
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

    const legendButton = createHtmlElement("button", { type: "button" }, "凡例");
    legendButton.addEventListener("click", () => this.togglePanel(this.legendPanel));

    const footerLeft = createHtmlElement("div", { class: "footer-left" });
    appendChildren(footerLeft, [
      holidayButton,
      this.holidayFileInput,
      errorButton,
      this.errorBadge,
      legendButton,
    ]);

    const footerRight = createHtmlElement(
      "div",
      { class: "footer-right" },
      "© Planner CCMP Support / MIT License / Third-party licenses: see LICENSE",
    );

    const footer = createHtmlElement("footer", { class: "app-footer" });
    appendChildren(footer, [footerLeft, footerRight]);
    return footer;
  }

  private togglePanel(panel: HTMLElement): void {
    const isHidden = panel.hasAttribute("hidden");
    for (const p of [this.errorPanel, this.warningPanel, this.legendPanel]) {
      setSafeAttribute(p, "hidden", "hidden");
    }
    if (isHidden) {
      panel.removeAttribute("hidden");
    }
  }

  private async handleFilesSelected(fileList: FileList): Promise<void> {
    const files = [...fileList].sort((a, b) => a.name.localeCompare(b.name, "en"));

    const preRejected: FatalErrorInfo[] = [];
    const readable: File[] = [];
    for (const file of files) {
      if (file.size > LIMITS.maxFileSizeBytes) {
        preRejected.push({
          code: "E404",
          fileName: file.name,
          message: `ファイルサイズが上限（${Math.floor(LIMITS.maxFileSizeBytes / (1024 * 1024))}MB）を超えています。`,
        });
        continue;
      }
      readable.push(file);
    }

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
    const text = await readFileAsText(file);
    const rows = text.split(/\r\n|\r|\n/).filter((line) => line.trim() !== "");
    const parsed = parseHolidayFile(text);

    const totalRows = rows.length;
    const isUnreadable = totalRows === 0 || parsed.invalidRowCount >= totalRows;

    if (isUnreadable) {
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
    this.scale = 1;
    this.translateX = 0;
    this.translateY = 0;
    this.rerender();
  }

  private rerender(): void {
    const projects = this.workspace.getProjects();
    const layout = layoutWorkspace(projects);
    const palette = this.workspace.getColorPalette();

    clearChildren(this.diagramLayer);
    const svg = renderDiagram(layout, projects, palette, DEFAULT_DIAGRAM_CONFIG);
    this.diagramLayer.appendChild(svg);
    this.applyTransform();

    renderErrorPanel(this.errorPanel, this.allErrors);
    renderWarningList(this.warningPanel, this.allWarnings);
    renderLegend(this.legendPanel, palette);
    updateErrorBadge(this.errorBadge, this.allErrors.length);
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
    const pivot = origin ?? { x: this.diagramViewport.clientWidth / 2, y: this.diagramViewport.clientHeight / 2 };

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
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("ファイルの読み込みに失敗しました。"));
    reader.readAsText(file);
  });
}
