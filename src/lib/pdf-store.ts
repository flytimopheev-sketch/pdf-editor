import { create } from "zustand";
import { uint8ArrayToBase64, base64ToUint8Array } from "./pdf-utils";

export type ToolType = "select" | "text" | "eyedropper" | "crop" | "pan" | "paste" | "eraser" | "pen" | "highlight" | "underline" | "strikethrough" | "sticky" | null;

export interface TextAnnotation {
  id: string;
  source: "primary" | "secondary";
  pageIndex: number;
  x: number;
  y: number;
  text: string;
  font: string;
  fontSize: number;
  color: string;
}

export interface FragmentData {
  imageData: string;
  x: number;
  y: number;
  width: number;
  height: number;
  sourceFileName: string;
  sourcePageIndex: number;
  sourcePageWidth: number;
  sourcePageHeight: number;
}

export interface PlacedFragment {
  id: string;
  source: "primary" | "secondary";
  pageIndex: number;
  fragment: FragmentData;
  x: number;
  y: number;
  width: number;
  height: number;
  placedRotation: number; // rotation angle at time of placement (viewport degrees)
}

export interface EraserStroke {
  id: string;
  source: "primary" | "secondary";
  pageIndex: number;
  points: Array<{ x: number; y: number }>;  // PDF units
  brushSize: number;  // in PDF units
}

export interface DrawingStroke {
  id: string;
  source: "primary" | "secondary";
  pageIndex: number;
  points: Array<{ x: number; y: number }>;
  color: string;
  width: number;
}

export interface StickyNote {
  id: string;
  source: "primary" | "secondary";
  pageIndex: number;
  x: number;
  y: number;
  text: string;
  color: "yellow" | "green" | "pink" | "blue" | "orange";
  width: number;
  height: number;
}

export interface MarkAnnotation {
  id: string;
  source: "primary" | "secondary";
  pageIndex: number;
  tool: "highlight" | "underline" | "strikethrough";
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

export interface SignatureTemplate {
  id: string;
  name: string;
  fragment: FragmentData;
  createdAt: number;
}

export interface OcrWordItem {
  text: string;
  x: number;      // PDF units, left edge
  y: number;      // PDF units, bottom edge (same convention as pdfjs text items)
  width: number;
  height: number;
}

export interface SearchMatch {
  pageIndex: number;
  items: TextLineItem[];
}

export interface TextLineItem {
  pageIndex: number;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FlatSearchItem {
  pageIndex: number;
  itemIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
}

export interface PageAdjustment {
  brightness: number;  // -100 to 100, default 0
  contrast: number;    // -100 to 100, default 0
}

/** Snapshot of every "layer" — captured BEFORE a mutation is applied */
export interface UndoSnapshot {
  placedFragments: PlacedFragment[];
  textAnnotations: TextAnnotation[];
  eraserStrokes: EraserStroke[];
  pageRotations: Record<number, number>;
  drawingStrokes: DrawingStroke[];
  stickyNotes: StickyNote[];
  markAnnotations: MarkAnnotation[];
  pageAdjustments: Record<number, PageAdjustment>;
  pageOrder: number[];
  totalPages: number;
  pdfFile: Uint8Array | null;
  pdfJsDoc: any | null;
}

/** One history entry ("layer") — stores the state before the mutation.
 *  `after` is captured lazily when the entry is undone (needed for redo). */
export interface HistoryEntry {
  id: string;
  label: string;
  time: number;
  key?: string;          // coalescing key — consecutive related ops merge into one layer
  before: UndoSnapshot;
  after?: UndoSnapshot;
}

export interface PushHistoryOptions {
  /** Coalescing key: if the last applied entry has the same key and is younger
   *  than COALESCE_MS, the new op merges into it (no extra layer). */
  key?: string;
}

export interface PdfEditorState {
  pdfFile: Uint8Array | null;
  fileName: string;
  totalPages: number;
  currentPage: number;
  pdfJsDoc: any | null;
  docVersion: number; // bumped on any document bytes replacement (cache invalidation)
  pageOrder: number[];
  pageSelections: number[];
  pageRotations: Record<number, number>;
  activeTool: ToolType;
  textAnnotations: TextAnnotation[];
  currentFont: string;
  currentFontSize: number;
  currentTextColor: string;
  penColor: string;      // цвет пера (инструмент «Перо»)
  penThickness: number;  // толщина пера, в единицах PDF
  eraserSize: number;    // размер ластика, в единицах PDF
  pickedColor: string;
  selectedFragment: FragmentData | null;
  clipboardFragment: FragmentData | null;
  placedFragments: PlacedFragment[];
  eraserStrokes: EraserStroke[];
  drawingStrokes: DrawingStroke[];
  stickyNotes: StickyNote[];
  markAnnotations: MarkAnnotation[];
  pageAdjustments: Record<number, PageAdjustment>;
  secondaryPdfFile: Uint8Array | null;
  secondaryFileName: string;
  secondaryPdfJsDoc: any | null;
  secondaryTotalPages: number;
  secondaryCurrentPage: number;
  secondaryPageSelections: number[];
  showSecondary: boolean;
  zoomLevel: number;
  isProcessing: boolean;
  secondaryPanelWidth: number;
  // ── History ("layers") ──
  historyStack: HistoryEntry[];
  historyIndex: number;   // how many entries are applied (0..historyStack.length)
  canUndo: boolean;
  canRedo: boolean;
  signatureTemplates: SignatureTemplate[];
  searchQuery: string;
  searchMatches: SearchMatch[];
  flatSearchItems: FlatSearchItem[];
  searchCurrentMatchIndex: number;
  // ── OCR (распознавание сканов для поиска) ──
  ocrResults: Record<number, OcrWordItem[]>;
  ocrDocVersion: number;

  pushHistory: (label: string, opts?: PushHistoryOptions) => void;
  undo: () => void;
  redo: () => void;
  jumpToHistory: (position: number) => void;
  clearHistory: () => void;

  loadPdf: (file: ArrayBuffer, fileName: string) => Promise<void>;
  appendImagesAsPages: (newBytes: Uint8Array, addedPages: number, firstNewPage: number) => Promise<void>;
  setCurrentPage: (page: number) => void;
  rotatePage: (degrees: number) => void;
  setActiveTool: (tool: ToolType) => void;
  setFont: (font: string) => void;
  setFontSize: (size: number) => void;
  setTextColor: (color: string) => void;
  setPenColor: (color: string) => void;
  setPenThickness: (width: number) => void;
  setEraserSize: (size: number) => void;
  addTextAnnotation: (annotation: TextAnnotation) => void;
  updateTextAnnotation: (id: string, updates: Partial<TextAnnotation>) => void;
  removeTextAnnotation: (id: string) => void;
  setPickedColor: (color: string) => void;
  setSelectedFragment: (fragment: FragmentData | null) => void;
  copyFragment: () => void;
  setClipboardFragment: (fragment: FragmentData | null) => void;
  addPlacedFragment: (fp: PlacedFragment) => void;
  updatePlacedFragment: (id: string, updates: Partial<PlacedFragment>, opts?: { silent?: boolean; key?: string }) => void;
  removePlacedFragment: (id: string) => void;
  bringFragmentToFront: (id: string) => void;
  addEraserStroke: (stroke: EraserStroke) => void;
  removeLastEraserStroke: (source: string, pageIndex: number) => void;
  clearEraserStrokes: (source: string) => void;
  setPageAdjustment: (pageIndex: number, adjustment: PageAdjustment) => void;
  clearPageAdjustment: (pageIndex: number) => void;
  openSecondaryPdf: (file: ArrayBuffer, fileName: string) => Promise<void>;
  closeSecondaryPdf: () => void;
  setSecondaryCurrentPage: (page: number) => void;
  setShowSecondary: (show: boolean) => void;
  setZoomLevel: (zoom: number) => void;
  setIsProcessing: (p: boolean) => void;
  setSecondaryPanelWidth: (w: number) => void;
  togglePageSelection: (page: number) => void;
  toggleSecondaryPageSelection: (page: number) => void;
  selectAllPages: () => void;
  clearPageSelections: () => void;
  clearSecondaryPageSelections: () => void;
  deletePages: (pages: number[]) => Promise<void>;
  extractPages: (pages: number[]) => Promise<void>;
  movePage: (from: number, to: number) => void;
  addDrawingStroke: (stroke: DrawingStroke) => void;
  removeDrawingStroke: (id: string) => void;
  clearDrawingStrokes: (source: string) => void;
  addStickyNote: (note: StickyNote) => void;
  updateStickyNote: (id: string, updates: Partial<StickyNote>, opts?: { silent?: boolean; key?: string }) => void;
  removeStickyNote: (id: string) => void;
  addMarkAnnotation: (mark: MarkAnnotation) => void;
  removeMarkAnnotation: (id: string) => void;
  saveSignatureTemplate: (template: SignatureTemplate) => void;
  removeSignatureTemplate: (id: string) => void;
  setSearchQuery: (query: string) => void;
  setSearchMatches: (matches: SearchMatch[]) => void;
  setFlatSearchItems: (items: FlatSearchItem[]) => void;
  setSearchCurrentMatchIndex: (index: number) => void;
  setOcrResults: (version: number, results: Record<number, OcrWordItem[]>) => void;
}

// ── Геометрия ластика: он стирает и нарисованное пером ─────────────────

/** Плечо интерполяции: густой след кисти ластика для точного попадания */
function densifyEraserPoints(
  points: Array<{ x: number; y: number }>,
  spacing: number,
): Array<{ x: number; y: number }> {
  if (points.length < 2) return [...points];
  const out: Array<{ x: number; y: number }> = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(dist / spacing));
    for (let s = 1; s <= steps; s++) {
      out.push({ x: a.x + ((b.x - a.x) * s) / steps, y: a.y + ((b.y - a.y) * s) / steps });
    }
  }
  return out;
}

function distPointToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Убирает сегменты штрихов пера, попавшие под кисть ластика (та же страница/документ) */
function erasePenStrokesUnderEraser(
  strokes: DrawingStroke[],
  eraser: { source: string; pageIndex: number; points: Array<{ x: number; y: number }>; brushSize: number },
): DrawingStroke[] {
  const dense = densifyEraserPoints(eraser.points, eraser.brushSize / 3);
  const result: DrawingStroke[] = [];
  for (const stroke of strokes) {
    if (
      stroke.source !== eraser.source ||
      stroke.pageIndex !== eraser.pageIndex ||
      stroke.points.length < 2
    ) {
      result.push(stroke);
      continue;
    }
    const eraseR = eraser.brushSize / 2 + stroke.width / 2;
    // Решаем для каждого сегмента штриха — стёрт он или нет
    const segErased: boolean[] = [];
    for (let i = 0; i < stroke.points.length - 1; i++) {
      const p1 = stroke.points[i];
      const p2 = stroke.points[i + 1];
      let hit = false;
      for (const ep of dense) {
        if (distPointToSegment(ep.x, ep.y, p1.x, p1.y, p2.x, p2.y) <= eraseR) {
          hit = true;
          break;
        }
      }
      segErased.push(hit);
    }
    // Пересобираем штрих из нестёртых подряд идущих сегментов
    let cur: Array<{ x: number; y: number }> = [];
    const flush = () => {
      if (cur.length >= 2) {
        result.push({ ...stroke, id: genId(), points: cur });
      }
      cur = [];
    };
    for (let i = 0; i < segErased.length; i++) {
      if (!segErased[i]) {
        if (cur.length === 0) cur.push(stroke.points[i]);
        cur.push(stroke.points[i + 1]);
      } else {
        flush();
      }
    }
    flush();
  }
  return result;
}

const FONT_LIST = [
  "Times New Roman", "Arial", "Helvetica", "Courier New",
  "Georgia", "Verdana", "Palatino", "Garamond", "Bookman", "Comic Sans MS",
];
export { FONT_LIST };

const HISTORY_LIMIT = 60;
const COALESCE_MS = 1500;

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function initPdfJs() {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();
  return pdfjsLib;
}

function loadSignatureTemplates(): SignatureTemplate[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem("pdf-signature-templates");
    return raw ? JSON.parse(raw as string) : [];
  } catch {
    return [];
  }
}

function saveSignatureTemplatesToStorage(templates: SignatureTemplate[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem("pdf-signature-templates", JSON.stringify(templates));
  } catch {
    // ignore storage errors
  }
}

/** Fast snapshot: shallow item copies (base64 image data is shared by reference) */
function captureSnapshot(s: PdfEditorState): UndoSnapshot {
  return {
    placedFragments: s.placedFragments.map((f) => ({ ...f })),
    textAnnotations: s.textAnnotations.map((a) => ({ ...a })),
    eraserStrokes: s.eraserStrokes.map((st) => ({ ...st, points: [...st.points] })),
    pageRotations: { ...s.pageRotations },
    drawingStrokes: s.drawingStrokes.map((st) => ({ ...st, points: [...st.points] })),
    stickyNotes: s.stickyNotes.map((n) => ({ ...n })),
    markAnnotations: s.markAnnotations.map((m) => ({ ...m })),
    pageAdjustments: { ...s.pageAdjustments },
    pageOrder: [...s.pageOrder],
    totalPages: s.totalPages,
    pdfFile: s.pdfFile,
    pdfJsDoc: s.pdfJsDoc,
  };
}

function applySnapshot(snapshot: UndoSnapshot): Partial<PdfEditorState> {
  return {
    placedFragments: snapshot.placedFragments,
    textAnnotations: snapshot.textAnnotations,
    eraserStrokes: snapshot.eraserStrokes,
    pageRotations: snapshot.pageRotations,
    drawingStrokes: snapshot.drawingStrokes,
    stickyNotes: snapshot.stickyNotes,
    markAnnotations: snapshot.markAnnotations,
    pageAdjustments: snapshot.pageAdjustments,
    pageOrder: snapshot.pageOrder,
    totalPages: snapshot.totalPages,
    pdfFile: snapshot.pdfFile,
    pdfJsDoc: snapshot.pdfJsDoc,
  };
}

export const usePdfEditorStore = create<PdfEditorState>((set, get) => ({
  pdfFile: null, fileName: "", totalPages: 0, currentPage: 1, pdfJsDoc: null,
  docVersion: 0,
  pageOrder: [], pageSelections: [], pageRotations: {},
  activeTool: null,
  textAnnotations: [], currentFont: "Times New Roman", currentFontSize: 14, currentTextColor: "#000000",
  penColor: "#000000", penThickness: 2, eraserSize: 25,
  pickedColor: "#000000",
  selectedFragment: null, clipboardFragment: null,
  placedFragments: [],
  eraserStrokes: [],
  drawingStrokes: [],
  stickyNotes: [],
  markAnnotations: [],
  pageAdjustments: {},
  secondaryPdfFile: null, secondaryFileName: "", secondaryPdfJsDoc: null,
  secondaryTotalPages: 0, secondaryCurrentPage: 1, secondaryPageSelections: [], showSecondary: false,
  zoomLevel: 1.0, isProcessing: false, secondaryPanelWidth: 400,
  historyStack: [], historyIndex: 0, canUndo: false, canRedo: false,
  signatureTemplates: loadSignatureTemplates(),
  searchQuery: "", searchMatches: [], flatSearchItems: [], searchCurrentMatchIndex: -1,
  ocrResults: {}, ocrDocVersion: -1,

  // ── History ("layers") engine ────────────────────────────────────────

  pushHistory: (label, opts = {}) => set((s) => {
    // Coalescing: merge related consecutive ops into a single layer
    const last = s.historyStack[s.historyIndex - 1];
    if (
      opts.key &&
      last &&
      last.key === opts.key &&
      Date.now() - last.time < COALESCE_MS
    ) {
      return s;
    }
    // Kill redo branch: a new mutation after undo discards the future
    const entries = s.historyStack.slice(0, s.historyIndex);
    entries.push({
      id: genId(),
      label,
      time: Date.now(),
      key: opts.key,
      before: captureSnapshot(s),
    });
    if (entries.length > HISTORY_LIMIT) entries.splice(0, entries.length - HISTORY_LIMIT);
    return {
      historyStack: entries,
      historyIndex: entries.length,
      canUndo: true,
      canRedo: false,
    };
  }),

  undo: () => {
    const s = get();
    if (s.historyIndex <= 0) return;
    const entry = s.historyStack[s.historyIndex - 1];
    const after = captureSnapshot(s);
    const docChanged = entry.before.pdfFile !== s.pdfFile;
    set({
      ...applySnapshot(entry.before),
      // Clamp: слот страницы мог исчезнуть (например, отмена добавленных страниц)
      currentPage: Math.max(1, Math.min(s.currentPage, entry.before.totalPages || 1)),
      historyStack: s.historyStack.map((e, i) => (i === s.historyIndex - 1 ? { ...e, after } : e)),
      historyIndex: s.historyIndex - 1,
      canUndo: s.historyIndex - 1 > 0,
      canRedo: true,
      docVersion: docChanged ? s.docVersion + 1 : s.docVersion,
      selectedFragment: null,
    });
  },

  redo: () => {
    const s = get();
    if (s.historyIndex >= s.historyStack.length) return;
    const entry = s.historyStack[s.historyIndex];
    if (!entry.after) return; // nothing to redo
    const docChanged = entry.after.pdfFile !== s.pdfFile;
    set({
      ...applySnapshot(entry.after),
      currentPage: Math.max(1, Math.min(s.currentPage, entry.after.totalPages || 1)),
      historyIndex: s.historyIndex + 1,
      canUndo: true,
      canRedo: s.historyIndex + 1 < s.historyStack.length,
      docVersion: docChanged ? s.docVersion + 1 : s.docVersion,
      selectedFragment: null,
    });
  },

  jumpToHistory: (position) => {
    const s = get();
    const target = Math.max(0, Math.min(s.historyStack.length, position));
    // Undo/redo step by step until reaching the target position
    let guard = 0;
    while (get().historyIndex > target && guard < HISTORY_LIMIT + 1) {
      get().undo();
      guard++;
    }
    guard = 0;
    while (get().historyIndex < target && guard < HISTORY_LIMIT + 1) {
      get().redo();
      guard++;
    }
  },

  clearHistory: () => set({
    historyStack: [],
    historyIndex: 0,
    canUndo: false,
    canRedo: false,
  }),

  // ── Document ─────────────────────────────────────────────────────────

  loadPdf: async (file: ArrayBuffer, fileName: string) => {
    const pdfjsLib = await initPdfJs();
    const bytes = new Uint8Array(file);
    const doc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    const totalPages = doc.numPages;
    const pageOrder = Array.from({ length: totalPages }, (_, i) => i + 1);
    set({
      pdfFile: bytes, fileName, pdfJsDoc: doc, totalPages,
      docVersion: get().docVersion + 1,
      currentPage: 1, pageOrder, pageSelections: [],
      pageRotations: {}, textAnnotations: get().textAnnotations.filter((a) => a.source !== "primary"),
      selectedFragment: null, clipboardFragment: null,
      activeTool: null, zoomLevel: 1.0,
      pageAdjustments: get().pageAdjustments,
      placedFragments: get().placedFragments.filter((f) => f.source !== "primary"),
      eraserStrokes: get().eraserStrokes.filter((s) => s.source !== "primary"),
      drawingStrokes: get().drawingStrokes.filter((s) => s.source !== "primary"),
      stickyNotes: get().stickyNotes.filter((n) => n.source !== "primary"),
      markAnnotations: get().markAnnotations.filter((m) => m.source !== "primary"),
      searchQuery: "", searchMatches: [], flatSearchItems: [], searchCurrentMatchIndex: -1,
      ocrResults: {}, ocrDocVersion: -1,
      historyStack: [], historyIndex: 0, canUndo: false, canRedo: false,
    });
  },

  /** Страницы из изображений: замена байтов документа на готовую версию
   *  (старые страницы + добавленные). Отдельный слой истории — Ctrl+Z
   *  полностью возвращает прежний документ. */
  appendImagesAsPages: async (newBytes: Uint8Array, addedPages: number, firstNewPage: number) => {
    get().pushHistory(
      addedPages === 1
        ? "Страница из изображения"
        : `Страницы из изображений (+${addedPages})`,
    );
    const pdfjsLib = await initPdfJs();
    const doc = await pdfjsLib.getDocument({ data: newBytes.slice() }).promise;
    const pageOrder = Array.from({ length: doc.numPages }, (_, i) => i + 1);
    set({
      pdfFile: newBytes,
      pdfJsDoc: doc,
      totalPages: doc.numPages,
      pageOrder,
      currentPage: Math.min(Math.max(1, firstNewPage), doc.numPages),
      pageSelections: [],
      docVersion: get().docVersion + 1,
    });
  },

  setCurrentPage: (page) => {
    const { totalPages } = get();
    if (page >= 1 && page <= totalPages) {
      set({ currentPage: page, selectedFragment: null });
    }
  },

  rotatePage: (degrees) => {
    get().pushHistory(degrees > 0 ? `Поворот +${degrees}°` : `Поворот ${degrees}°`);
    const { currentPage, pageRotations } = get();
    const cur = pageRotations[currentPage] || 0;
    set({ pageRotations: { ...pageRotations, [currentPage]: (cur + degrees + 360) % 360 } });
  },

  setActiveTool: (tool) => set((s) => ({
    activeTool: s.activeTool === tool ? null : tool,
    selectedFragment: tool === "crop" ? null : s.selectedFragment,
  })),

  setFont: (f) => set({ currentFont: f }),
  setFontSize: (s) => set({ currentFontSize: s }),
  setTextColor: (c) => set({ currentTextColor: c, pickedColor: c }),
  setPenColor: (c) => set({ penColor: c }),
  setPenThickness: (w) => set({ penThickness: w }),
  setEraserSize: (size) => set({ eraserSize: size }),

  addTextAnnotation: (a) => {
    get().pushHistory("Добавление текста");
    set((s) => ({ textAnnotations: [...s.textAnnotations, a] }));
  },
  updateTextAnnotation: (id, u) => {
    get().pushHistory("Изменение текста", { key: `text-${id}` });
    set((s) => ({
      textAnnotations: s.textAnnotations.map((a) => a.id === id ? { ...a, ...u } : a),
    }));
  },
  removeTextAnnotation: (id) => {
    get().pushHistory("Удаление текста");
    set((s) => ({
      textAnnotations: s.textAnnotations.filter((a) => a.id !== id),
    }));
  },

  setPickedColor: (c) => set({ pickedColor: c, currentTextColor: c, penColor: c }),
  setSelectedFragment: (f) => set({ selectedFragment: f }),

  copyFragment: () => {
    const { selectedFragment } = get();
    if (selectedFragment) {
      set({ clipboardFragment: { ...selectedFragment } });
    }
  },

  setClipboardFragment: (f) => set({ clipboardFragment: f }),

  addPlacedFragment: (fp) => {
    get().pushHistory("Вставка фрагмента");
    set((s) => ({ placedFragments: [...s.placedFragments, fp] }));
  },
  updatePlacedFragment: (id, updates, opts) => {
    if (!opts?.silent) {
      get().pushHistory("Изменение фрагмента", { key: opts?.key });
    }
    set((s) => ({
      placedFragments: s.placedFragments.map((f) => f.id === id ? { ...f, ...updates } : f),
    }));
  },
  removePlacedFragment: (id) => {
    get().pushHistory("Удаление фрагмента");
    set((s) => ({
      placedFragments: s.placedFragments.filter((f) => f.id !== id),
    }));
  },
  bringFragmentToFront: (id) => set((s) => {
    const idx = s.placedFragments.findIndex((f) => f.id === id);
    if (idx === -1) return s;
    const updated = [...s.placedFragments];
    const [moved] = updated.splice(idx, 1);
    updated.push(moved);
    return { placedFragments: updated };
  }),

  addEraserStroke: (stroke) => {
    get().pushHistory("Ластик");
    set((s) => ({
      eraserStrokes: [...s.eraserStrokes, stroke],
      // Ластик стирает и нарисованное пером: сегменты штрихов под кистью удаляются
      drawingStrokes: erasePenStrokesUnderEraser(s.drawingStrokes, stroke),
    }));
  },
  removeLastEraserStroke: (source, pageIndex) => {
    const s = get();
    const idx = s.eraserStrokes.findLastIndex((st) => st.source === source && st.pageIndex === pageIndex);
    if (idx === -1) return;
    get().pushHistory("Отмена ластика");
    set((cur) => {
      const updated = [...cur.eraserStrokes];
      const i = updated.findLastIndex((st) => st.source === source && st.pageIndex === pageIndex);
      if (i !== -1) updated.splice(i, 1);
      return { eraserStrokes: updated };
    });
  },
  clearEraserStrokes: (source) => {
    get().pushHistory("Очистка ластика");
    set((s) => ({
      eraserStrokes: s.eraserStrokes.filter((st) => st.source !== source),
    }));
  },
  setPageAdjustment: (pageIndex, adjustment) => {
    get().pushHistory("Яркость / контраст");
    set((s) => ({
      pageAdjustments: { ...s.pageAdjustments, [pageIndex]: adjustment },
    }));
  },
  clearPageAdjustment: (pageIndex) => {
    if (!get().pageAdjustments[pageIndex]) return;
    get().pushHistory("Сброс яркости / контраста");
    set((s) => {
      const adj = { ...s.pageAdjustments };
      delete adj[pageIndex];
      return { pageAdjustments: adj };
    });
  },

  openSecondaryPdf: async (file: ArrayBuffer, fileName: string) => {
    const pdfjsLib = await initPdfJs();
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(file).slice() }).promise;
    set({
      secondaryPdfFile: new Uint8Array(file), secondaryFileName: fileName,
      secondaryPdfJsDoc: doc, secondaryTotalPages: doc.numPages,
      secondaryCurrentPage: 1, showSecondary: true, activeTool: "crop",
      placedFragments: get().placedFragments.filter((f) => f.source !== "secondary"),
      docVersion: get().docVersion + 1,
    });
  },

  closeSecondaryPdf: () => {
    get().pushHistory("Закрытие источника фрагментов");
    set({
      secondaryPdfFile: null, secondaryFileName: "", secondaryPdfJsDoc: null,
      secondaryTotalPages: 0, secondaryCurrentPage: 1, secondaryPageSelections: [], showSecondary: false,
      placedFragments: get().placedFragments.filter((f) => f.source !== "secondary"),
      activeTool: null,
    });
  },

  setSecondaryCurrentPage: (page) => {
    const { secondaryTotalPages } = get();
    if (page >= 1 && page <= secondaryTotalPages) set({ secondaryCurrentPage: page, selectedFragment: null });
  },

  setShowSecondary: (s) => set({ showSecondary: s }),
  setZoomLevel: (z) => set({ zoomLevel: Math.max(0.25, Math.min(3, z)) }),
  setIsProcessing: (p) => set({ isProcessing: p }),
  setSecondaryPanelWidth: (w) => set({ secondaryPanelWidth: Math.max(200, Math.min(1200, w)) }),

  togglePageSelection: (page) => set((s) => ({
    pageSelections: s.pageSelections.includes(page)
      ? s.pageSelections.filter((p) => p !== page)
      : [...s.pageSelections, page],
  })),

  selectAllPages: () => set((s) => ({
    pageSelections: Array.from({ length: s.totalPages }, (_, i) => i + 1),
  })),
  clearPageSelections: () => set({ pageSelections: [] }),
  toggleSecondaryPageSelection: (page) => set((s) => ({
    secondaryPageSelections: s.secondaryPageSelections.includes(page)
      ? s.secondaryPageSelections.filter((p) => p !== page)
      : [...s.secondaryPageSelections, page],
  })),
  clearSecondaryPageSelections: () => set({ secondaryPageSelections: [] }),

  deletePages: async (pages) => {
    const {
      pdfFile, pageOrder, pageRotations, textAnnotations, currentPage,
      placedFragments, drawingStrokes, stickyNotes, markAnnotations,
    } = get();
    if (!pdfFile || pages.length === 0) return;
    // Layer: captured BEFORE deletion (includes old pdfFile → fully reversible)
    get().pushHistory(`Удаление страниц (${pages.length})`);
    set({ isProcessing: true });
    try {
      // Client-side: use pdf-lib directly (no server API)
      const { PDFDocument } = await import('pdf-lib');
      const srcDoc = await PDFDocument.load(pdfFile);
      const newDoc = await PDFDocument.create();
      const remove = new Set(pages);

      for (const pp of pageOrder) {
        if (!remove.has(pp)) {
          const [copied] = await newDoc.copyPages(srcDoc, [pp - 1]);
          newDoc.addPage(copied);
        }
      }

      const newBytes = new Uint8Array(await newDoc.save());
      const newTotal = newDoc.getPageCount();

      const oldToNew: Record<number, number> = {};
      let ni = 0;
      for (const pp of pageOrder) {
        if (!remove.has(pp)) { ni++; oldToNew[pp] = ni; }
      }

      const newAnnotations = textAnnotations
        .filter((a) => a.source === "primary" && !remove.has(a.pageIndex))
        .map((a) => ({ ...a, pageIndex: oldToNew[a.pageIndex] ?? a.pageIndex }));
      const newRotations: Record<number, number> = {};
      for (const [k, v] of Object.entries(pageRotations)) {
        const p = parseInt(k);
        if (oldToNew[p]) newRotations[oldToNew[p]] = v;
      }
      const newPlaced = placedFragments
        .filter((f) => f.source === "primary" && !remove.has(f.pageIndex))
        .map((f) => ({ ...f, pageIndex: oldToNew[f.pageIndex] ?? f.pageIndex }));
      const newDrawingStrokes = drawingStrokes
        .filter((s) => s.source === "primary" && !remove.has(s.pageIndex))
        .map((s) => ({ ...s, pageIndex: oldToNew[s.pageIndex] ?? s.pageIndex }));
      const newEraserStrokes = get().eraserStrokes
        .filter((s) => s.source === "primary" && !remove.has(s.pageIndex))
        .map((s) => ({ ...s, pageIndex: oldToNew[s.pageIndex] ?? s.pageIndex }));
      const newStickyNotes = stickyNotes
        .filter((n) => n.source === "primary" && !remove.has(n.pageIndex))
        .map((n) => ({ ...n, pageIndex: oldToNew[n.pageIndex] ?? n.pageIndex }));
      const newMarkAnnotations = markAnnotations
        .filter((m) => m.source === "primary" && !remove.has(m.pageIndex))
        .map((m) => ({ ...m, pageIndex: oldToNew[m.pageIndex] ?? m.pageIndex }));
      const newAdjustments: Record<number, PageAdjustment> = {};
      const oldAdjustments = get().pageAdjustments;
      for (const [k, v] of Object.entries(oldAdjustments)) {
        const p = parseInt(k);
        if (oldToNew[p]) newAdjustments[oldToNew[p]] = v;
      }

      const pdfjsLib = await initPdfJs();
      const doc = await pdfjsLib.getDocument({ data: newBytes.slice() }).promise;

      set({
        pdfFile: newBytes, pdfJsDoc: doc, totalPages: newTotal,
        docVersion: get().docVersion + 1,
        pageOrder: Array.from({ length: newTotal }, (_, i) => i + 1),
        pageSelections: [], pageRotations: newRotations,
        textAnnotations: [...get().textAnnotations.filter((a) => a.source !== "primary"), ...newAnnotations],
        placedFragments: [...get().placedFragments.filter((f) => f.source !== "primary"), ...newPlaced],
        eraserStrokes: [...get().eraserStrokes.filter((s) => s.source !== "primary"), ...newEraserStrokes],
        drawingStrokes: [...get().drawingStrokes.filter((s) => s.source !== "primary"), ...newDrawingStrokes],
        stickyNotes: [...get().stickyNotes.filter((n) => n.source !== "primary"), ...newStickyNotes],
        markAnnotations: [...get().markAnnotations.filter((m) => m.source !== "primary"), ...newMarkAnnotations],
        pageAdjustments: newAdjustments,
        currentPage: Math.min(currentPage, newTotal),
        isProcessing: false,
      });
    } catch (err) {
      console.error('deletePages error:', err);
      alert('Ошибка при удалении страниц: ' + String(err));
      set({ isProcessing: false });
    }
  },

  extractPages: async (pages) => {
    const { pdfFile, pageOrder, pageRotations, fileName } = get();
    if (!pdfFile || pages.length === 0) return;
    set({ isProcessing: true });
    try {
      // Клиентская сборка через pdf-lib
      const { PDFDocument, degrees } = await import('pdf-lib');
      const srcDoc = await PDFDocument.load(pdfFile);
      const newDoc = await PDFDocument.create();
      const extract = new Set(pages);

      let idx = 0;
      for (const pp of pageOrder) {
        if (extract.has(pp)) {
          const [copied] = await newDoc.copyPages(srcDoc, [pp - 1]);
          newDoc.addPage(copied);
          const rot = pageRotations[pp] || 0;
          if (rot !== 0) {
            const page = newDoc.getPages()[idx];
            const curRot = page.getRotation().angle;
            page.setRotation(degrees(curRot + rot));
          }
          idx++;
        }
      }

      const savedBytes = await newDoc.save();
      set({ isProcessing: false });

      // Спрашиваем, куда сохранить извлечённые страницы
      const { requestSaveAs } = await import('./save-as');
      requestSaveAs({
        title: 'Извлечь страницы',
        defaultName:
          (fileName || 'документ').replace(/\.pdf$/i, '') + '_извлечено.pdf',
        accept: { 'application/pdf': ['.pdf'] },
        typeLabel: 'PDF документ',
        scopeHint: `выбранные страницы: ${[...pages].sort((a, b) => a - b).join(', ')}`,
        getBlob: async () =>
          new Blob([savedBytes as unknown as BlobPart], { type: 'application/pdf' }),
      });
    } catch (err) {
      console.error('extractPages error:', err);
      alert('Ошибка при извлечении страниц: ' + String(err));
      set({ isProcessing: false });
    }
  },

  movePage: (from, to) => {
    get().pushHistory("Перемещение страницы");
    set((s) => {
      const o = [...s.pageOrder];
      if (from < 0 || from >= o.length || to < 0 || to >= o.length) return s;
      const [m] = o.splice(from, 1);
      o.splice(to, 0, m);
      return { pageOrder: o };
    });
  },

  addDrawingStroke: (stroke) => {
    get().pushHistory("Рисование пером");
    set((s) => ({ drawingStrokes: [...s.drawingStrokes, stroke] }));
  },

  removeDrawingStroke: (id) => {
    get().pushHistory("Удаление штриха");
    set((s) => ({
      drawingStrokes: s.drawingStrokes.filter((st) => st.id !== id),
    }));
  },

  clearDrawingStrokes: (source) => {
    get().pushHistory("Очистка рисования");
    set((s) => ({
      drawingStrokes: s.drawingStrokes.filter((st) => st.source !== source),
    }));
  },

  addStickyNote: (note) => {
    get().pushHistory("Добавление заметки");
    set((s) => ({ stickyNotes: [...s.stickyNotes, note] }));
  },

  updateStickyNote: (id, updates, opts) => {
    if (!opts?.silent) {
      get().pushHistory("Изменение заметки", { key: opts?.key ?? `sticky-${id}` });
    }
    set((s) => ({
      stickyNotes: s.stickyNotes.map((n) => n.id === id ? { ...n, ...updates } : n),
    }));
  },

  removeStickyNote: (id) => {
    get().pushHistory("Удаление заметки");
    set((s) => ({
      stickyNotes: s.stickyNotes.filter((n) => n.id !== id),
    }));
  },

  addMarkAnnotation: (mark) => {
    const label = mark.tool === "highlight" ? "Выделение маркером" : mark.tool === "underline" ? "Подчёркивание" : "Зачёркивание";
    get().pushHistory(label);
    set((s) => ({ markAnnotations: [...s.markAnnotations, mark] }));
  },

  removeMarkAnnotation: (id) => {
    get().pushHistory("Удаление пометки");
    set((s) => ({
      markAnnotations: s.markAnnotations.filter((m) => m.id !== id),
    }));
  },

  saveSignatureTemplate: (template) => {
    set((s) => {
      const updated = [...s.signatureTemplates, template];
      saveSignatureTemplatesToStorage(updated);
      return { signatureTemplates: updated };
    });
  },

  removeSignatureTemplate: (id) => {
    set((s) => {
      const updated = s.signatureTemplates.filter((t) => t.id !== id);
      saveSignatureTemplatesToStorage(updated);
      return { signatureTemplates: updated };
    });
  },

  setSearchQuery: (query) => set({
    searchQuery: query,
    searchMatches: [],
    flatSearchItems: [],
    searchCurrentMatchIndex: -1,
  }),

  setSearchMatches: (matches) => set({ searchMatches: matches }),

  setFlatSearchItems: (items) => set({
    flatSearchItems: items,
    searchCurrentMatchIndex: items.length > 0 ? 0 : -1,
  }),

  setSearchCurrentMatchIndex: (index) => set({ searchCurrentMatchIndex: index }),

  setOcrResults: (version, results) => set({ ocrDocVersion: version, ocrResults: results }),
}));
