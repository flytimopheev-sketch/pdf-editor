"use client";

import React, { useEffect, useRef, useCallback } from "react";
import { PDFDocument, rgb, StandardFonts, degrees } from "pdf-lib";
import { usePdfEditorStore, type PlacedFragment, type EraserStroke, type DrawingStroke, type TextAnnotation, type MarkAnnotation, type StickyNote, type PageAdjustment, type OcrWordItem } from "@/lib/pdf-store";
import { ocrPage } from "@/lib/ocr-client";
import { Toolbar } from "@/components/pdf-editor/toolbar";
import { CanvasViewer } from "@/components/pdf-editor/canvas-viewer";
import { ThumbnailSidebar } from "@/components/pdf-editor/thumbnail-sidebar";
import { SaveAsDialog } from "@/components/pdf-editor/save-as-dialog";
import { requestSaveAs } from "@/lib/save-as";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  Clipboard, Loader2, GripVertical, X, Save,
  Crop, SunMedium, Palette, Info, Mail, User, Scale, Github,
} from "lucide-react";

const FONT_MAP: Record<string, string> = {
  "Times New Roman": "TimesRoman",
  "Arial": "Helvetica",
  "Helvetica": "Helvetica",
  "Courier New": "Courier",
  "Georgia": "TimesRoman",
  "Verdana": "Helvetica",
  "Palatino": "TimesRoman",
  "Garamond": "TimesRoman",
  "Bookman": "TimesRoman",
  "Comic Sans MS": "Courier",
};

function hexToRgb(hex: string) {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!r) return { r: 0, g: 0, b: 0 };
  return { r: parseInt(r[1], 16) / 255, g: parseInt(r[2], 16) / 255, b: parseInt(r[3], 16) / 255 };
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1] || "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Auto-crop white edges from a canvas */
function autoCropCanvas(sourceCanvas: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = sourceCanvas.getContext("2d");
  if (!ctx) return sourceCanvas;

  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  if (w === 0 || h === 0) return sourceCanvas;

  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  const threshold = 248;

  // Scan from top
  let top = h;
  for (let y = 0; y < h; y++) {
    let found = false;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (data[i] < threshold || data[i + 1] < threshold || data[i + 2] < threshold) {
        top = y;
        found = true;
        break;
      }
    }
    if (found) break;
  }

  // Scan from bottom
  let bottom = 0;
  for (let y = h - 1; y >= 0; y--) {
    let found = false;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (data[i] < threshold || data[i + 1] < threshold || data[i + 2] < threshold) {
        bottom = y + 1;
        found = true;
        break;
      }
    }
    if (found) break;
  }

  // Scan from left
  let left = w;
  for (let x = 0; x < w; x++) {
    let found = false;
    for (let y = top; y < bottom; y++) {
      const i = (y * w + x) * 4;
      if (data[i] < threshold || data[i + 1] < threshold || data[i + 2] < threshold) {
        left = x;
        found = true;
        break;
      }
    }
    if (found) break;
  }

  // Scan from right
  let right = 0;
  for (let x = w - 1; x >= 0; x--) {
    let found = false;
    for (let y = top; y < bottom; y++) {
      const i = (y * w + x) * 4;
      if (data[i] < threshold || data[i + 1] < threshold || data[i + 2] < threshold) {
        right = x + 1;
        found = true;
        break;
      }
    }
    if (found) break;
  }

  if (top >= bottom || left >= right) return sourceCanvas;

  const margin = 5;
  top = Math.max(0, top - margin);
  left = Math.max(0, left - margin);
  right = Math.min(w, right + margin);
  bottom = Math.min(h, bottom + margin);

  const cropW = right - left;
  const cropH = bottom - top;

  const cropped = document.createElement("canvas");
  cropped.width = cropW;
  cropped.height = cropH;
  const cropCtx = cropped.getContext("2d")!;
  cropCtx.drawImage(sourceCanvas, left, top, cropW, cropH, 0, 0, cropW, cropH);

  return cropped;
}

/** Rotate a canvas by given degrees */
function rotateCanvas(sourceCanvas: HTMLCanvasElement, angleDeg: number): HTMLCanvasElement {
  const ctx = sourceCanvas.getContext("2d");
  if (!ctx) return sourceCanvas;

  const radians = (angleDeg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const newW = Math.ceil(sourceCanvas.width * cos + sourceCanvas.height * sin);
  const newH = Math.ceil(sourceCanvas.width * sin + sourceCanvas.height * cos);

  const rotCanvas = document.createElement("canvas");
  rotCanvas.width = newW;
  rotCanvas.height = newH;
  const rotCtx = rotCanvas.getContext("2d")!;
  rotCtx.fillStyle = "#ffffff";
  rotCtx.fillRect(0, 0, newW, newH);
  rotCtx.translate(newW / 2, newH / 2);
  rotCtx.rotate(radians);
  rotCtx.drawImage(sourceCanvas, -sourceCanvas.width / 2, -sourceCanvas.height / 2);

  return rotCanvas;
}

/** Render a single pdfjs page at high resolution */
async function renderPageHighRes(
  pdfJsDoc: any,
  pageNum: number,
  renderScale: number
): Promise<HTMLCanvasElement> {
  const page = await pdfJsDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale: renderScale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Cannot get 2d context");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

/** Render text annotation to PNG bytes (supports Cyrillic and any font) */
function renderTextToPng(annotation: { text: string; font: string; fontSize: number; color: string }): Uint8Array {
  // Measure text width with estimated metrics
  const padding = 4;
  const textWidth = annotation.text.length * annotation.fontSize * 0.55;
  const textHeight = annotation.fontSize * 1.3;
  const canvasW = Math.ceil(textWidth + padding * 2);
  const canvasH = Math.ceil(textHeight + padding * 2);

  const canvas = document.createElement("canvas");
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new Uint8Array(0);

  // Transparent background, text with specified color
  ctx.font = `${annotation.fontSize}px ${annotation.font}, sans-serif`;
  ctx.fillStyle = annotation.color;
  ctx.textBaseline = "top";
  ctx.fillText(annotation.text, padding, padding + annotation.fontSize * 0.15);

  const dataUrl = canvas.toDataURL("image/png");
  return dataUrlToBytes(dataUrl);
}

/** Transform fragment coordinates between rotation spaces (for save) */
function transformCoordsForSave(
  fx: number, fy: number, fw: number, fh: number,
  fromRot: number, toRot: number,
  pw: number, ph: number
): { x: number; y: number; w: number; h: number } {
  if (fromRot === toRot) return { x: fx, y: fy, w: fw, h: fh };

  // Convert from viewport coords at fromRot to canonical PDF coords (TL origin, scale 1)
  let cx: number, cy: number;
  switch (fromRot) {
    case 0: cx = fx + fw / 2; cy = fy + fh / 2; break;
    case 90: cx = fy + fh / 2; cy = pw - (fx + fw / 2); break;
    case 180: cx = pw - (fx + fw / 2); cy = ph - (fy + fh / 2); break;
    case 270: cx = ph - (fy + fh / 2); cy = fx + fw / 2; break;
    default: return { x: fx, y: fy, w: fw, h: fh };
  }

  // Convert from canonical PDF coords to viewport coords at toRot
  let newX: number, newY: number, newW: number, newH: number;
  switch (toRot) {
    case 0: newX = cx - fw / 2; newY = cy - fh / 2; newW = fw; newH = fh; break;
    case 90: newX = ph - cy - fh / 2; newY = cx - fw / 2; newW = fh; newH = fw; break;
    case 180: newX = pw - cx - fw / 2; newY = ph - cy - fh / 2; newW = fw; newH = fh; break;
    case 270: newX = cy - fh / 2; newY = pw - cx - fw / 2; newW = fh; newH = fw; break;
    default: return { x: fx, y: fy, w: fw, h: fh };
  }

  return { x: newX, y: newY, w: newW, h: newH };
}

const STICKY_FILL_MAP: Record<StickyNote["color"], string> = {
  yellow: "#fef08a",
  green: "#bbf7d0",
  pink: "#fecdd3",
  blue: "#bfdbfe",
  orange: "#fed7aa",
};

const STICKY_HEAD_MAP: Record<StickyNote["color"], string> = {
  yellow: "#facc15",
  green: "#4ade80",
  pink: "#fb7185",
  blue: "#60a5fa",
  orange: "#fb923c",
};

function wrapStickyText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const rawLine of text.split("\n")) {
    if (!rawLine) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of rawLine.split(/\s+/)) {
      const test = line ? line + " " + word : word;
      if (ctx.measureText(test).width <= maxWidth || !line) {
        line = test;
      } else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

/** Draw a sticky note onto a canvas (same look as the editor overlay) */
function drawStickyOnCanvas(ctx: CanvasRenderingContext2D, note: StickyNote, renderScale: number) {
  const x = note.x * renderScale;
  const y = note.y * renderScale;
  const w = note.width * renderScale;
  const h = Math.max(note.height, 80) * renderScale;
  const headerH = 14 * renderScale;
  const radius = 4 * renderScale;
  const pad = 6 * renderScale;

  const path = new Path2D();
  path.moveTo(x + radius, y);
  path.arcTo(x + w, y, x + w, y + h, radius);
  path.arcTo(x + w, y + h, x, y + h, radius);
  path.arcTo(x, y + h, x, y, radius);
  path.arcTo(x, y, x + w, y, radius);
  path.closePath();

  ctx.save();
  ctx.fillStyle = STICKY_FILL_MAP[note.color] || STICKY_FILL_MAP.yellow;
  ctx.fill(path);
  ctx.clip(path);
  ctx.fillStyle = STICKY_HEAD_MAP[note.color] || STICKY_HEAD_MAP.yellow;
  ctx.fillRect(x, y, w, headerH);
  ctx.restore();

  ctx.save();
  ctx.fillStyle = "#1f2937";
  ctx.font = `${11 * renderScale}px Arial, sans-serif`;
  ctx.textBaseline = "top";
  const lines = wrapStickyText(ctx, note.text || "", w - pad * 2);
  let ty = y + headerH + pad * 0.5;
  for (const ln of lines) {
    if (ty > y + h - pad) break;
    ctx.fillText(ln, x + pad, ty);
    ty += 13 * renderScale;
  }
  ctx.restore();
}

interface CompositePageOptions {
  renderScale: number;
  rotation: number; // normalized total rotation for the viewport
  adjustment?: PageAdjustment | null;
  fragments?: PlacedFragment[];
  eraserStrokes?: EraserStroke[];
  drawingStrokes?: DrawingStroke[];
  textAnnotations?: TextAnnotation[];
  marks?: MarkAnnotation[];
  stickyNotes?: StickyNote[];
}

/**
 * Renders one PDF page and bakes every annotation "layer" onto it:
 * brightness/contrast → eraser → pen → marks → fragments → text → sticky notes.
 * Used by save, compress, auto-crop and crop-to-selection.
 */
async function compositePageCanvas(
  pdfJsDoc: any,
  pageNum: number,
  opts: CompositePageOptions
): Promise<HTMLCanvasElement> {
  const {
    renderScale, rotation,
    adjustment = null,
    fragments = [], eraserStrokes = [], drawingStrokes = [],
    textAnnotations = [], marks = [], stickyNotes = [],
  } = opts;

  const pdfjsPage = await pdfJsDoc.getPage(pageNum);
  const viewport = pdfjsPage.getViewport({ scale: renderScale, rotation });
  const origViewport = pdfjsPage.getViewport({ scale: 1, rotation: 0 });

  const pageCanvas = document.createElement("canvas");
  pageCanvas.width = Math.round(viewport.width);
  pageCanvas.height = Math.round(viewport.height);
  const pageCtx = pageCanvas.getContext("2d")!;
  pageCtx.fillStyle = "#ffffff";
  pageCtx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
  await pdfjsPage.render({ canvasContext: pageCtx, viewport }).promise;

  const compCanvas = document.createElement("canvas");
  compCanvas.width = pageCanvas.width;
  compCanvas.height = pageCanvas.height;
  const ctx = compCanvas.getContext("2d")!;

  // 1. Page with brightness/contrast
  if (adjustment && (adjustment.brightness !== 0 || adjustment.contrast !== 0)) {
    ctx.filter = `brightness(${1 + adjustment.brightness / 100}) contrast(${1 + adjustment.contrast / 100})`;
  }
  ctx.drawImage(pageCanvas, 0, 0);
  ctx.filter = "none";

  // 2. Eraser strokes — opaque white, interpolated for smooth coverage
  for (const stroke of eraserStrokes) {
    if (stroke.points.length === 0) continue;
    ctx.fillStyle = "white";
    const halfBrush = (stroke.brushSize / 2) * renderScale;
    for (let j = 0; j < stroke.points.length; j++) {
      const px = stroke.points[j].x * renderScale;
      const py = stroke.points[j].y * renderScale;
      ctx.beginPath();
      ctx.arc(px, py, halfBrush, 0, Math.PI * 2);
      ctx.fill();
      if (j < stroke.points.length - 1) {
        const p1x = stroke.points[j].x * renderScale;
        const p1y = stroke.points[j].y * renderScale;
        const p2x = stroke.points[j + 1].x * renderScale;
        const p2y = stroke.points[j + 1].y * renderScale;
        const dist = Math.sqrt((p2x - p1x) ** 2 + (p2y - p1y) ** 2);
        const step = Math.max(halfBrush * 0.3, 1);
        const steps = Math.ceil(dist / step);
        for (let si = 1; si < steps; si++) {
          const t = si / steps;
          ctx.beginPath();
          ctx.arc(p1x + (p2x - p1x) * t, p1y + (p2y - p1y) * t, halfBrush, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  // 3. Pen strokes
  for (const stroke of drawingStrokes) {
    if (stroke.points.length < 2) continue;
    ctx.save();
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width * renderScale;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x * renderScale, stroke.points[0].y * renderScale);
    for (let j = 1; j < stroke.points.length; j++) {
      ctx.lineTo(stroke.points[j].x * renderScale, stroke.points[j].y * renderScale);
    }
    ctx.stroke();
    ctx.restore();
  }

  // 4. Marks (highlight / underline / strikethrough)
  for (const mark of marks) {
    const mx = mark.x * renderScale;
    const my = mark.y * renderScale;
    const mw = mark.width * renderScale;
    const mh = mark.height * renderScale;
    ctx.save();
    if (mark.tool === "highlight") {
      ctx.fillStyle = mark.color || "rgba(250, 204, 21, 0.4)";
      ctx.globalAlpha = 0.4;
      ctx.fillRect(mx, my, mw, mh);
    } else if (mark.tool === "underline") {
      ctx.strokeStyle = mark.color || "#000000";
      ctx.lineWidth = 2 * renderScale;
      ctx.beginPath();
      ctx.moveTo(mx, my + mh);
      ctx.lineTo(mx + mw, my + mh);
      ctx.stroke();
    } else if (mark.tool === "strikethrough") {
      ctx.strokeStyle = mark.color || "#000000";
      ctx.lineWidth = 2 * renderScale;
      ctx.beginPath();
      ctx.moveTo(mx, my + mh / 2);
      ctx.lineTo(mx + mw, my + mh / 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 5. Fragments — position transformed + image rotated to match page rotation
  const pw = origViewport.width;
  const ph = origViewport.height;
  for (const fp of fragments) {
    try {
      const img = new Image();
      img.src = fp.fragment.imageData;
      await new Promise<void>((res) => {
        img.onload = () => res();
        img.onerror = () => res();
      });
      if (img.naturalWidth === 0) continue;

      const placedRot = ((fp.placedRotation || 0) % 360 + 360) % 360;
      let drawX = fp.x;
      let drawY = fp.y;
      let drawW = fp.width;
      let drawH = fp.height;

      if (placedRot !== rotation) {
        const t = transformCoordsForSave(fp.x, fp.y, fp.width, fp.height, placedRot, rotation, pw, ph);
        drawX = t.x;
        drawY = t.y;
        drawW = t.w;
        drawH = t.h;
      }

      const deltaRot = ((rotation - placedRot) % 360 + 360) % 360;
      if (deltaRot !== 0 && deltaRot % 90 === 0) {
        ctx.save();
        ctx.translate(
          drawX * renderScale + (drawW * renderScale) / 2,
          drawY * renderScale + (drawH * renderScale) / 2
        );
        ctx.rotate((deltaRot * Math.PI) / 180);
        ctx.drawImage(
          img,
          -(drawW * renderScale) / 2,
          -(drawH * renderScale) / 2,
          drawW * renderScale,
          drawH * renderScale
        );
        ctx.restore();
      } else {
        ctx.drawImage(
          img,
          drawX * renderScale,
          drawY * renderScale,
          drawW * renderScale,
          drawH * renderScale
        );
      }
    } catch (err) {
      console.warn("Не удалось встроить фрагмент:", err);
    }
  }

  // 6. Text annotations
  for (const a of textAnnotations) {
    ctx.save();
    ctx.font = `${a.fontSize * renderScale}px ${a.font}, sans-serif`;
    ctx.fillStyle = a.color;
    ctx.globalAlpha = 0.8;
    ctx.fillText(a.text, a.x * renderScale, a.y * renderScale);
    ctx.restore();
  }

  // 7. Sticky notes
  for (const note of stickyNotes) {
    drawStickyOnCanvas(ctx, note, renderScale);
  }

  return compCanvas;
}

/**
 * Сборка итогового PDF: все слои (рисунок, текст, ластик, повороты и т.д.)
 * вшиваются в документ. Файл собирается ЛЕНИВО — только после того,
 * как пользователь подтвердил сохранение в диалоге «Сохранить как».
 */
async function buildPdfBlob(targetSource: "primary" | "secondary"): Promise<Blob> {
  const s = usePdfEditorStore.getState();
  const pdfBytes = targetSource === "primary" ? s.pdfFile : s.secondaryPdfFile;
  const rotations = targetSource === "primary" ? s.pageRotations : {};
  const annotations = s.textAnnotations.filter((a) => a.source === targetSource);
  const fragments = s.placedFragments.filter((f) => f.source === targetSource);
  const eraserStrokes = s.eraserStrokes.filter((st) => st.source === targetSource);
  const drawingStrokes = s.drawingStrokes.filter((st) => st.source === targetSource);
  const markAnnotations = s.markAnnotations.filter((m) => m.source === targetSource);
  const stickyNotes = s.stickyNotes.filter((n) => n.source === targetSource);
  const adjustments = targetSource === "primary" ? s.pageAdjustments : {};
  const pdfJsDoc = targetSource === "primary" ? s.pdfJsDoc : s.secondaryPdfJsDoc;

  if (!pdfBytes || !pdfJsDoc) throw new Error("Документ не открыт");

  try {
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const newDoc = await PDFDocument.create();
    const renderScale = 3; // High quality (~216 DPI)
    const pageCount = pdfJsDoc.numPages;
    // Respect manual page order for the primary document
    const order =
      targetSource === "primary" && s.pageOrder.length === pageCount
        ? s.pageOrder
        : Array.from({ length: pageCount }, (_, i) => i + 1);

    for (const i of order) {
      const rot = rotations[i] || 0;
      const normalizedRot = ((rot % 360) + 360) % 360;
      const pageFragments = fragments.filter((f) => f.pageIndex === i);
      const pageEraserStrokes = eraserStrokes.filter((st) => st.pageIndex === i);
      const pageDrawingStrokes = drawingStrokes.filter((st) => st.pageIndex === i);
      const pageAnnotations = annotations.filter((a) => a.pageIndex === i);
      const pageMarks = markAnnotations.filter((m) => m.pageIndex === i);
      const pageStickyNotes = stickyNotes.filter((n) => n.pageIndex === i);
      const pageAdj = adjustments[i];

      const hasModifications =
        pageFragments.length > 0 ||
        pageEraserStrokes.length > 0 ||
        pageDrawingStrokes.length > 0 ||
        pageAnnotations.length > 0 ||
        pageMarks.length > 0 ||
        pageStickyNotes.length > 0 ||
        normalizedRot !== 0 ||
        !!pageAdj;

      if (hasModifications) {
        // === IMAGE MODE: render page and bake all annotation layers ===
        const compCanvas = await compositePageCanvas(pdfJsDoc, i, {
          renderScale,
          rotation: normalizedRot,
          adjustment: pageAdj || null,
          fragments: pageFragments,
          eraserStrokes: pageEraserStrokes,
          drawingStrokes: pageDrawingStrokes,
          textAnnotations: pageAnnotations,
          marks: pageMarks,
          stickyNotes: pageStickyNotes,
        });

        // Auto-crop white edges (useful for rotated pages)
        const finalCanvas = normalizedRot !== 0 ? autoCropCanvas(compCanvas) : compCanvas;

        const jpgDataUrl = finalCanvas.toDataURL("image/jpeg", 0.92);
        const jpgBytes = dataUrlToBytes(jpgDataUrl);
        const pageW = finalCanvas.width / renderScale;
        const pageH = finalCanvas.height / renderScale;
        const newPage = newDoc.addPage([pageW, pageH]);
        const img = await newDoc.embedJpg(jpgBytes);
        newPage.drawImage(img, { x: 0, y: 0, width: pageW, height: pageH });
      } else {
        // No modifications — copy page as-is from original PDF (preserves vector content)
        const [copiedPage] = await newDoc.copyPages(pdfDoc, [i - 1]);
        newDoc.addPage(copiedPage);
      }
    }

    const saved = await newDoc.save();
    return new Blob([saved as unknown as BlobPart], { type: "application/pdf" });
  } catch (err) {
    console.error("Ошибка сохранения:", err);
    throw new Error("Не удалось собрать PDF: " + String(err));
  }
}

/** Список страниц для экспорта: выделенные (в порядке документа) или все */
function getExportPages(s: {
  pdfJsDoc: { numPages: number } | null;
  totalPages: number;
  pageOrder: number[];
  pageSelections: number[];
}): { pages: number[]; hint: string } {
  const pageCount = s.pdfJsDoc?.numPages ?? s.totalPages;
  const order =
    s.pageOrder.length === pageCount
      ? s.pageOrder
      : Array.from({ length: pageCount }, (_, i) => i + 1);
  if (s.pageSelections.length > 0) {
    const sel = new Set(s.pageSelections);
    const pages = order.filter((p) => sel.has(p));
    return { pages, hint: `выбранные страницы: ${pages.join(", ")}` };
  }
  return { pages: order, hint: `все страницы (${pageCount})` };
}

/** Visual auto-crop: apply rotation + crop, then replace the PDF bytes.
 *  Pushes a history layer — fully reversible via Undo. */
async function autoCropCurrentPage() {
  const s = usePdfEditorStore.getState();
  const { pdfFile, pdfJsDoc, currentPage, pageRotations } = s;
  if (!pdfFile || !pdfJsDoc) return;

  const rot = pageRotations[currentPage] || 0;
  const normalizedRot = ((rot % 360) + 360) % 360;

  if (normalizedRot === 0) {
    alert("Нет поворота на текущей странице. Сначала поверните страницу на 1° или больше.");
    return;
  }

  // Layer BEFORE the destructive operation (includes old pdf bytes)
  s.pushHistory("Обрезка краёв страницы");
  s.setIsProcessing(true);
  try {
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url
    ).toString();

    const origPdfLib = await PDFDocument.load(pdfFile);
    const renderScale = 3;
    const newDoc = await PDFDocument.create();
    const st = usePdfEditorStore.getState();

    for (let i = 1; i <= pdfJsDoc.numPages; i++) {
      const normRot = (((st.pageRotations[i] || 0) % 360) + 360) % 360;

      if (i === currentPage) {
        // Bake all annotation layers, then crop white edges
        const compCanvas = await compositePageCanvas(pdfJsDoc, i, {
          renderScale,
          rotation: normRot,
          adjustment: st.pageAdjustments[i] || null,
          fragments: st.placedFragments.filter((f) => f.source === "primary" && f.pageIndex === i),
          eraserStrokes: st.eraserStrokes.filter((e) => e.source === "primary" && e.pageIndex === i),
          drawingStrokes: st.drawingStrokes.filter((d) => d.source === "primary" && d.pageIndex === i),
          textAnnotations: st.textAnnotations.filter((a) => a.source === "primary" && a.pageIndex === i),
          marks: st.markAnnotations.filter((m) => m.source === "primary" && m.pageIndex === i),
          stickyNotes: st.stickyNotes.filter((n) => n.source === "primary" && n.pageIndex === i),
        });
        const cropped = autoCropCanvas(compCanvas);

        const jpgDataUrl = cropped.toDataURL("image/jpeg", 0.92);
        const jpgBytes = dataUrlToBytes(jpgDataUrl);
        const pageW = cropped.width / renderScale;
        const pageH = cropped.height / renderScale;
        const newPage = newDoc.addPage([pageW, pageH]);
        const img = await newDoc.embedJpg(jpgBytes);
        newPage.drawImage(img, { x: 0, y: 0, width: pageW, height: pageH });
      } else if (normRot !== 0 && normRot % 90 !== 0) {
        // Non-90 rotated page — render as image
        const compCanvas = await compositePageCanvas(pdfJsDoc, i, {
          renderScale,
          rotation: normRot,
          adjustment: st.pageAdjustments[i] || null,
        });
        const cropped = autoCropCanvas(compCanvas);
        const jpgDataUrl = cropped.toDataURL("image/jpeg", 0.92);
        const jpgBytes = dataUrlToBytes(jpgDataUrl);
        const pageW = cropped.width / renderScale;
        const pageH = cropped.height / renderScale;
        const newPage = newDoc.addPage([pageW, pageH]);
        const img = await newDoc.embedJpg(jpgBytes);
        newPage.drawImage(img, { x: 0, y: 0, width: pageW, height: pageH });
      } else {
        // Copy page from original PDF
        const [copiedPage] = await newDoc.copyPages(origPdfLib, [i - 1]);
        const newPage = newDoc.addPage(copiedPage);
        if (normRot !== 0) {
          const curRot = newPage.getRotation().angle;
          newPage.setRotation(degrees(curRot + normRot));
        }
      }
    }

    const saved = await newDoc.save();
    const newBytes = new Uint8Array(saved);

    // Reload the PDF
    const doc = await pdfjsLib.getDocument({ data: newBytes.slice() }).promise;
    const totalPages = doc.numPages;
    const pageOrder = Array.from({ length: totalPages }, (_, i) => i + 1);
    const cur = usePdfEditorStore.getState();
    const cropPage = currentPage;

    // Clear only the cropped page's annotations (they are baked into the image now);
    // other pages keep their layers
    const keepPrimary = <T extends { source: string; pageIndex: number }>(arr: T[]) =>
      arr.filter((a) => a.source !== "primary" || a.pageIndex !== cropPage);

    const newAdjustments = { ...cur.pageAdjustments };
    delete newAdjustments[cropPage];
    const newRotations = { ...cur.pageRotations };
    delete newRotations[cropPage];

    usePdfEditorStore.setState({
      pdfFile: newBytes,
      pdfJsDoc: doc,
      totalPages,
      docVersion: cur.docVersion + 1,
      pageOrder,
      currentPage: Math.min(cur.currentPage, totalPages),
      pageRotations: newRotations,
      textAnnotations: keepPrimary(cur.textAnnotations),
      placedFragments: keepPrimary(cur.placedFragments),
      eraserStrokes: keepPrimary(cur.eraserStrokes),
      drawingStrokes: keepPrimary(cur.drawingStrokes),
      markAnnotations: keepPrimary(cur.markAnnotations),
      stickyNotes: keepPrimary(cur.stickyNotes),
      pageAdjustments: newAdjustments,
      isProcessing: false,
    });
  } catch (err) {
    console.error("Ошибка обрезки:", err);
    alert("Ошибка при обрезке краёв: " + String(err));
    s.setIsProcessing(false);
  }
}

/** Crop the current page to the captured fragment selection.
 *  Pushes a history layer — fully reversible via Undo. */
async function cropToSelection() {
  const s = usePdfEditorStore.getState();
  const frag = s.selectedFragment;
  if (!frag || !s.pdfFile || !s.pdfJsDoc) return;

  const pageIdx = frag.sourcePageIndex;
  if (!pageIdx || pageIdx < 1 || pageIdx > s.totalPages) {
    alert("Фрагмент относится к другой странице или документу.");
    return;
  }

  s.pushHistory("Обрезка до выделения");
  s.setIsProcessing(true);
  try {
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url
    ).toString();

    const origPdfLib = await PDFDocument.load(s.pdfFile);
    const renderScale = 3;
    const newDoc = await PDFDocument.create();
    const st = usePdfEditorStore.getState();

    for (let i = 1; i <= s.pdfJsDoc.numPages; i++) {
      const normRot = (((st.pageRotations[i] || 0) % 360) + 360) % 360;

      if (i === pageIdx) {
        // Bake annotation layers, then slice to the selected rect
        const compCanvas = await compositePageCanvas(s.pdfJsDoc, i, {
          renderScale,
          rotation: normRot,
          adjustment: st.pageAdjustments[i] || null,
          fragments: st.placedFragments.filter((f) => f.source === "primary" && f.pageIndex === i),
          eraserStrokes: st.eraserStrokes.filter((e) => e.source === "primary" && e.pageIndex === i),
          drawingStrokes: st.drawingStrokes.filter((d) => d.source === "primary" && d.pageIndex === i),
          textAnnotations: st.textAnnotations.filter((a) => a.source === "primary" && a.pageIndex === i),
          marks: st.markAnnotations.filter((m) => m.source === "primary" && m.pageIndex === i),
          stickyNotes: st.stickyNotes.filter((n) => n.source === "primary" && n.pageIndex === i),
        });

        const sx = Math.max(0, Math.round(frag.x * renderScale));
        const sy = Math.max(0, Math.round(frag.y * renderScale));
        const sw = Math.min(compCanvas.width - sx, Math.round(frag.width * renderScale));
        const sh = Math.min(compCanvas.height - sy, Math.round(frag.height * renderScale));

        if (sw <= 0 || sh <= 0) {
          alert("Область выделения некорректна.");
          s.setIsProcessing(false);
          return;
        }

        const sliced = document.createElement("canvas");
        sliced.width = sw;
        sliced.height = sh;
        sliced.getContext("2d")!.drawImage(compCanvas, sx, sy, sw, sh, 0, 0, sw, sh);

        const jpgDataUrl = sliced.toDataURL("image/jpeg", 0.92);
        const jpgBytes = dataUrlToBytes(jpgDataUrl);
        const pageW = sw / renderScale;
        const pageH = sh / renderScale;
        const newPage = newDoc.addPage([pageW, pageH]);
        const img = await newDoc.embedJpg(jpgBytes);
        newPage.drawImage(img, { x: 0, y: 0, width: pageW, height: pageH });
      } else if (normRot !== 0 && normRot % 90 !== 0) {
        const compCanvas = await compositePageCanvas(s.pdfJsDoc, i, {
          renderScale,
          rotation: normRot,
          adjustment: st.pageAdjustments[i] || null,
        });
        const jpgDataUrl = compCanvas.toDataURL("image/jpeg", 0.92);
        const jpgBytes = dataUrlToBytes(jpgDataUrl);
        const pageW = compCanvas.width / renderScale;
        const pageH = compCanvas.height / renderScale;
        const newPage = newDoc.addPage([pageW, pageH]);
        const img = await newDoc.embedJpg(jpgBytes);
        newPage.drawImage(img, { x: 0, y: 0, width: pageW, height: pageH });
      } else {
        const [copiedPage] = await newDoc.copyPages(origPdfLib, [i - 1]);
        const newPage = newDoc.addPage(copiedPage);
        if (normRot !== 0) {
          const curRot = newPage.getRotation().angle;
          newPage.setRotation(degrees(curRot + normRot));
        }
      }
    }

    const saved = await newDoc.save();
    const newBytes = new Uint8Array(saved);
    const doc = await pdfjsLib.getDocument({ data: newBytes.slice() }).promise;
    const totalPages = doc.numPages;
    const pageOrder = Array.from({ length: totalPages }, (_, i) => i + 1);
    const cur = usePdfEditorStore.getState();
    const cropPage = pageIdx;

    const keepPrimary = <T extends { source: string; pageIndex: number }>(arr: T[]) =>
      arr.filter((a) => a.source !== "primary" || a.pageIndex !== cropPage);

    const newAdjustments = { ...cur.pageAdjustments };
    delete newAdjustments[cropPage];
    const newRotations = { ...cur.pageRotations };
    delete newRotations[cropPage];

    usePdfEditorStore.setState({
      pdfFile: newBytes,
      pdfJsDoc: doc,
      totalPages,
      docVersion: cur.docVersion + 1,
      pageOrder,
      currentPage: Math.min(cur.currentPage, totalPages),
      pageRotations: newRotations,
      textAnnotations: keepPrimary(cur.textAnnotations),
      placedFragments: keepPrimary(cur.placedFragments),
      eraserStrokes: keepPrimary(cur.eraserStrokes),
      drawingStrokes: keepPrimary(cur.drawingStrokes),
      markAnnotations: keepPrimary(cur.markAnnotations),
      stickyNotes: keepPrimary(cur.stickyNotes),
      pageAdjustments: newAdjustments,
      selectedFragment: null,
      isProcessing: false,
    });
  } catch (err) {
    console.error("Ошибка обрезки до выделения:", err);
    alert("Ошибка при обрезке до выделения: " + String(err));
    s.setIsProcessing(false);
  }
}

/** Apply brightness/contrast to an offscreen canvas */
function applyBrightnessContrast(
  sourceCanvas: HTMLCanvasElement,
  brightness: number,
  contrast: number
): HTMLCanvasElement {
  if (brightness === 0 && contrast === 0) return sourceCanvas;

  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  const result = document.createElement("canvas");
  result.width = w;
  result.height = h;
  const ctx = result.getContext("2d")!;

  // Use CSS filter string for fast processing
  const filterStr = `brightness(${1 + brightness / 100}) contrast(${1 + contrast / 100})`;
  ctx.filter = filterStr;
  ctx.drawImage(sourceCanvas, 0, 0);
  ctx.filter = "none";

  return result;
}

/** Analyze page brightness/contrast and return computed adjustments */
function analyzePageBrightness(
  imageData: ImageData
): { brightnessAdjust: number; contrastAdjust: number; info: string } {
  const data = imageData.data;
  const step = 4;
  let totalBrightness = 0;
  let minVal = 255;
  let maxVal = 0;
  let darkCount = 0;
  let midCount = 0;
  let lightCount = 0;
  let sampleCount = 0;

  // Build a simple histogram (10 bins)
  const histogram = new Array(10).fill(0);

  for (let i = 0; i < data.length; i += 4 * step) {
    const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    totalBrightness += gray;
    if (gray < minVal) minVal = gray;
    if (gray > maxVal) maxVal = gray;
    if (gray < 80) darkCount++;
    else if (gray > 200) lightCount++;
    else midCount++;
    histogram[Math.min(9, Math.floor(gray / 26))]++;
    sampleCount++;
  }

  const avgBrightness = totalBrightness / sampleCount;
  const darkRatio = darkCount / sampleCount;
  const lightRatio = lightCount / sampleCount;
  const midRatio = midCount / sampleCount;
  const dynamicRange = maxVal - minVal;

  // --- Smart detection: white-background vs dark scan ---
  // White-background documents: most pixels are white (lightRatio > 0.5)
  // Dark scans: most pixels are dark (darkRatio > 0.3)
  const isWhiteBg = lightRatio > 0.45;
  const isDarkScan = darkRatio > 0.3 && lightRatio < 0.2;

  let brightnessAdjust = 0;
  let contrastAdjust = 0;
  let info = "";

  if (isWhiteBg) {
    // --- White background document ---
    // Target average: ~225 (mostly white with dark text)
    // Only adjust if significantly off
    if (avgBrightness < 180) {
      // Grayish / yellowed scan — needs brightening
      brightnessAdjust = Math.min(60, (225 - avgBrightness) * 0.5);
      info = "Обнаружен светлый документ — повышение яркости";
    } else if (avgBrightness > 245) {
      // Almost pure white — already perfect
      brightnessAdjust = 0;
      contrastAdjust = 0;
      info = "Документ в хорошем состоянии";
    } else {
      // 180-245 range — slightly adjust
      brightnessAdjust = Math.min(15, Math.max(-10, (225 - avgBrightness) * 0.15));
      info = "Минимальная коррекция яркости";
    }

    // Contrast: for white bg, check if text is readable
    if (dynamicRange < 120) {
      contrastAdjust = Math.min(40, (160 - dynamicRange) * 0.4);
      info += ", усиление контраста";
    } else {
      contrastAdjust = 0; // Good contrast already
    }
  } else if (isDarkScan) {
    // --- Dark scan (inverted text, dark background) ---
    // Target average: ~160-180 (visible but not blown out)
    if (avgBrightness < 100) {
      brightnessAdjust = Math.min(80, (160 - avgBrightness) * 0.7);
      info = "Обнаружен тёмный скан — значительное повышение яркости";
    } else if (avgBrightness < 140) {
      brightnessAdjust = Math.min(50, (165 - avgBrightness) * 0.5);
      info = "Тёмный скан — повышение яркости";
    } else {
      brightnessAdjust = Math.min(20, (170 - avgBrightness) * 0.3);
      info = "Тёмный скан — лёгкая коррекция";
    }

    // Contrast for dark scans
    if (dynamicRange < 100) {
      contrastAdjust = Math.min(50, (150 - dynamicRange) * 0.5);
      info += ", усиление контраста";
    }
  } else {
    // --- Mixed or mid-tone document ---
    // Target average: ~170
    if (avgBrightness < 120) {
      brightnessAdjust = Math.min(60, (170 - avgBrightness) * 0.6);
      info = "Документ затемнён — повышение яркости";
    } else if (avgBrightness > 200) {
      brightnessAdjust = Math.max(-40, (170 - avgBrightness) * 0.4);
      info = "Документ слишком светлый — снижение яркости";
    } else {
      brightnessAdjust = Math.round((170 - avgBrightness) * 0.2);
      info = "Минимальная коррекция";
    }

    // Contrast
    if (dynamicRange < 120) {
      contrastAdjust = Math.min(45, (150 - dynamicRange) * 0.45);
      info += ", усиление контраста";
    } else if (dynamicRange > 230) {
      contrastAdjust = 0;
    } else {
      contrastAdjust = Math.min(10, Math.round((180 - dynamicRange) * 0.1));
    }
  }

  // Clamp values
  brightnessAdjust = Math.round(Math.max(-100, Math.min(100, brightnessAdjust)));
  contrastAdjust = Math.round(Math.max(-100, Math.min(100, contrastAdjust)));

  // If both near zero, nothing to do
  if (Math.abs(brightnessAdjust) < 2 && Math.abs(contrastAdjust) < 2) {
    brightnessAdjust = 0;
    contrastAdjust = 0;
    info = "Коррекция не требуется — документ уже в хорошем состоянии";
  }

  return { brightnessAdjust, contrastAdjust, info };
}

/** Auto-correct a page: analyze brightness/contrast and apply optimal values */
async function autoCorrectCurrentPage() {
  const s = usePdfEditorStore.getState();
  const { pdfFile, pdfJsDoc, currentPage, pageRotations, pageAdjustments } = s;
  if (!pdfFile || !pdfJsDoc) return;

  s.setIsProcessing(true);
  try {
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url
    ).toString();

    // Render page at high resolution
    const renderScale = 2;
    const page = await pdfJsDoc.getPage(currentPage);
    const rot = pageRotations[currentPage] || 0;
    const normalizedRot = ((rot % 360) + 360) % 360;
    const viewport = page.getViewport({ scale: renderScale, rotation: normalizedRot });

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const { brightnessAdjust, contrastAdjust, info } = analyzePageBrightness(imageData);

    if (brightnessAdjust === 0 && contrastAdjust === 0) {
      alert(info);
      s.setIsProcessing(false);
      return;
    }

    // Store the adjustment (additive to existing)
    const existing = pageAdjustments[currentPage] || { brightness: 0, contrast: 0 };
    s.setPageAdjustment(currentPage, {
      brightness: Math.max(-100, Math.min(100, existing.brightness + brightnessAdjust)),
      contrast: Math.max(-100, Math.min(100, existing.contrast + contrastAdjust)),
    });

    s.setIsProcessing(false);
  } catch (err) {
    console.error("Ошибка автокоррекции:", err);
    alert("Ошибка при автокоррекции: " + String(err));
    s.setIsProcessing(false);
  }
}

/** Сборка сжатого PDF (страницы → изображения с заданным DPI) */
async function buildCompressedPdfBlob(dpi: number): Promise<Blob> {
  const s = usePdfEditorStore.getState();
  const { pdfFile, pdfJsDoc } = s;
  if (!pdfFile || !pdfJsDoc) throw new Error("Документ не открыт");

  try {
    const newDoc = await PDFDocument.create();
    const scaleFactor = dpi / 72;
    const pageCount = pdfJsDoc.numPages;
    const st = usePdfEditorStore.getState();
    const order =
      s.pageOrder.length === pageCount
        ? s.pageOrder
        : Array.from({ length: pageCount }, (_, i) => i + 1);

    for (const i of order) {
      const rot = st.pageRotations[i] || 0;
      const normalizedRot = ((rot % 360) + 360) % 360;

      // Bake all annotation layers so compression never loses edits
      let finalCanvas = await compositePageCanvas(pdfJsDoc, i, {
        renderScale: scaleFactor,
        rotation: normalizedRot,
        adjustment: st.pageAdjustments[i] || null,
        fragments: st.placedFragments.filter((f) => f.source === "primary" && f.pageIndex === i),
        eraserStrokes: st.eraserStrokes.filter((e) => e.source === "primary" && e.pageIndex === i),
        drawingStrokes: st.drawingStrokes.filter((d) => d.source === "primary" && d.pageIndex === i),
        textAnnotations: st.textAnnotations.filter((a) => a.source === "primary" && a.pageIndex === i),
        marks: st.markAnnotations.filter((m) => m.source === "primary" && m.pageIndex === i),
        stickyNotes: st.stickyNotes.filter((n) => n.source === "primary" && n.pageIndex === i),
      });

      if (normalizedRot !== 0 && normalizedRot % 90 !== 0) {
        finalCanvas = autoCropCanvas(finalCanvas);
      }

      const jpegDataUrl = finalCanvas.toDataURL("image/jpeg", 0.85);
      const jpegBytes = dataUrlToBytes(jpegDataUrl);

      const pageW = finalCanvas.width / scaleFactor;
      const pageH = finalCanvas.height / scaleFactor;
      const newPage = newDoc.addPage([pageW, pageH]);
      const image = await newDoc.embedJpg(jpegBytes);
      newPage.drawImage(image, {
        x: 0,
        y: 0,
        width: pageW,
        height: pageH,
      });
    }

    const saved = await newDoc.save();
    return new Blob([saved as unknown as BlobPart], { type: "application/pdf" });
  } catch (err) {
    console.error("Ошибка сжатия:", err);
    throw new Error("Не удалось сжать PDF: " + String(err));
  }
}

/** Экспорт страниц (с вшитыми слоями) как PNG/JPG внутри ZIP.
 *  Если страницы выделены в панели миниатюр — экспортируются только они. */
async function buildImagesZipBlob(format: "png" | "jpg"): Promise<Blob> {
  const s = usePdfEditorStore.getState();
  const { pdfJsDoc } = s;
  if (!pdfJsDoc) throw new Error("Документ не открыт");
  try {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    const base = (s.fileName || "документ").replace(/\.pdf$/i, "");
    const { pages } = getExportPages(s);
    const st = usePdfEditorStore.getState();

    for (let idx = 0; idx < pages.length; idx++) {
      const phys = pages[idx];
      const rot = st.pageRotations[phys] || 0;
      const normalizedRot = ((rot % 360) + 360) % 360;
      const canvas = await compositePageCanvas(pdfJsDoc, phys, {
        renderScale: 2,
        rotation: normalizedRot,
        adjustment: st.pageAdjustments[phys] || null,
        fragments: st.placedFragments.filter((f) => f.source === "primary" && f.pageIndex === phys),
        eraserStrokes: st.eraserStrokes.filter((e) => e.source === "primary" && e.pageIndex === phys),
        drawingStrokes: st.drawingStrokes.filter((d) => d.source === "primary" && d.pageIndex === phys),
        textAnnotations: st.textAnnotations.filter((a) => a.source === "primary" && a.pageIndex === phys),
        marks: st.markAnnotations.filter((m) => m.source === "primary" && m.pageIndex === phys),
        stickyNotes: st.stickyNotes.filter((n) => n.source === "primary" && n.pageIndex === phys),
      });
      const blob = await new Promise<Blob | null>((res) =>
        canvas.toBlob(res, format === "png" ? "image/png" : "image/jpeg", 0.92)
      );
      if (blob) {
        zip.file(`${base}_стр_${String(phys).padStart(2, "0")}.${format}`, blob);
      }
    }

    return await zip.generateAsync({ type: "blob" });
  } catch (err) {
    console.error("Ошибка экспорта изображений:", err);
    throw new Error("Не удалось экспортировать изображения: " + String(err));
  }
}

/**
 * Строки текста страницы (сверху вниз): из текстового слоя pdfjs,
 * а для страниц-сканов — из OCR (распознаётся автоматически и кэшируется).
 * Используется экспортом Word / Excel.
 */
async function getPageTextLinesOrdered(
  pdfJsDoc: { getPage: (n: number) => Promise<any> },
  pageNum: number,
): Promise<string[]> {
  const page = await pdfJsDoc.getPage(pageNum);
  const tc = await page.getTextContent();

  const lines = new Map<number, Array<{ x: number; str: string }>>();
  let hasText = false;
  for (const raw of tc.items as any[]) {
    const str: string = raw.str || "";
    if (!str.trim()) continue;
    hasText = true;
    const x = raw.transform?.[4] ?? 0;
    const y = raw.transform?.[5] ?? 0;
    const key = Math.round(y / 2) * 2;
    if (!lines.has(key)) lines.set(key, []);
    lines.get(key)!.push({ x, str });
  }

  // Нет текстового слоя — подключаем OCR (кэш store или распознавание сейчас)
  if (!hasText) {
    const st = usePdfEditorStore.getState();
    let ocr: Record<number, OcrWordItem[]> =
      st.ocrDocVersion === st.docVersion ? { ...st.ocrResults } : {};

    if (!(pageNum in ocr)) {
      try {
        const words = await ocrPage(pdfJsDoc, pageNum);
        ocr = { ...ocr, [pageNum]: words };
        const cur = usePdfEditorStore.getState();
        cur.setOcrResults(cur.docVersion, ocr);
      } catch (err) {
        console.error("OCR (экспорт) ошибка:", err);
        ocr = { ...ocr, [pageNum]: [] };
      }
    }

    for (const w of ocr[pageNum] ?? []) {
      const key = Math.round(w.y / 2) * 2;
      if (!lines.has(key)) lines.set(key, []);
      lines.get(key)!.push({ x: w.x, str: w.text });
    }
  }

  const sortedKeys = Array.from(lines.keys()).sort((a, b) => b - a);
  return sortedKeys
    .map((key) => {
      const items = lines.get(key)!.sort((a, b) => a.x - b.x);
      return items.map((it) => it.str).join(" ").replace(/\s+/g, " ").trim();
    })
    .filter(Boolean);
}

/** Экспорт текста (постранично, построчно) в Word .docx.
 *  Если страницы выделены — экспортируются только они. Для сканов используется OCR. */
async function buildWordBlob(): Promise<Blob> {
  const s = usePdfEditorStore.getState();
  const { pdfJsDoc } = s;
  if (!pdfJsDoc) throw new Error("Документ не открыт");
  try {
    const { Document, Packer, Paragraph, TextRun, PageBreak } = await import("docx");
    const children: Array<InstanceType<typeof Paragraph>> = [];
    const { pages } = getExportPages(s);

    for (let idx = 0; idx < pages.length; idx++) {
      const i = pages[idx];
      const lineTexts = await getPageTextLinesOrdered(pdfJsDoc, i);

      if (lineTexts.length === 0) {
        children.push(new Paragraph({ children: [new TextRun({ text: `[Страница ${i}: нет текста]`, italics: true, color: "888888" })] }));
      }
      for (const text of lineTexts) {
        children.push(new Paragraph({ children: [new TextRun(text)] }));
      }

      if (idx < pages.length - 1) {
        children.push(new Paragraph({ children: [new PageBreak()] }));
      }
    }

    const doc = new Document({ sections: [{ children }] });
    return await Packer.toBlob(doc);
  } catch (err) {
    console.error("Ошибка экспорта Word:", err);
    throw new Error("Не удалось экспортировать в Word: " + String(err));
  }
}

/** Экспорт текста (постранично) в Excel .xlsx.
 *  Если страницы выделены — экспортируются только они. Для сканов используется OCR. */
async function buildExcelBlob(): Promise<Blob> {
  const s = usePdfEditorStore.getState();
  const { pdfJsDoc } = s;
  if (!pdfJsDoc) throw new Error("Документ не открыт");
  try {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const { pages } = getExportPages(s);

    for (const i of pages) {
      const lineTexts = await getPageTextLinesOrdered(pdfJsDoc, i);

      const rows: string[][] = [[`Страница ${i}`], [""]];
      for (const text of lineTexts) {
        rows.push([text]);
      }

      const ws = XLSX.utils.aoa_to_sheet(rows);
      const safeName = `Стр ${i}`.slice(0, 31);
      XLSX.utils.book_append_sheet(wb, ws, safeName);
    }

    const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    return new Blob([wbout as unknown as BlobPart], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  } catch (err) {
    console.error("Ошибка экспорта Excel:", err);
    throw new Error("Не удалось экспортировать в Excel: " + String(err));
  }
}

/** Detect blank pages (no annotations, almost no ink) and delete them */
async function deleteBlankPages() {
  const s = usePdfEditorStore.getState();
  const { pdfJsDoc } = s;
  if (!pdfJsDoc) return;
  s.setIsProcessing(true);
  try {
    const blank: number[] = [];
    const st = usePdfEditorStore.getState();
    // Pixel darker than 200 = real ink (text/lines). A truly blank/scan-noise page
    // has almost none; even a single short title line exceeds this ratio.
    const inkThreshold = 0.0005; // < 0.05% dark pixels → blank
    const renderScale = 1;

    for (let i = 1; i <= pdfJsDoc.numPages; i++) {
      // Pages with annotation layers are never considered blank
      const hasLayers =
        st.placedFragments.some((f) => f.source === "primary" && f.pageIndex === i) ||
        st.eraserStrokes.some((e) => e.source === "primary" && e.pageIndex === i) ||
        st.drawingStrokes.some((d) => d.source === "primary" && d.pageIndex === i) ||
        st.textAnnotations.some((a) => a.source === "primary" && a.pageIndex === i) ||
        st.markAnnotations.some((m) => m.source === "primary" && m.pageIndex === i) ||
        st.stickyNotes.some((n) => n.source === "primary" && n.pageIndex === i);
      if (hasLayers) continue;

      const canvas = await renderPageHighRes(pdfJsDoc, i, renderScale);
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let dark = 0;
      const total = canvas.width * canvas.height;
      for (let p = 0; p < data.length; p += 4) {
        if (data[p] < 200 || data[p + 1] < 200 || data[p + 2] < 200) dark++;
      }
      if (dark / total < inkThreshold) blank.push(i);
    }

    s.setIsProcessing(false);

    if (blank.length === 0) {
      alert("Пустых страниц не найдено.");
      return;
    }
    const ok = confirm(
      `Найдено пустых страниц: ${blank.length}\n\nНомера: ${blank.join(", ")}\n\nУдалить их?`
    );
    if (ok) {
      await usePdfEditorStore.getState().deletePages(blank);
    }
  } catch (err) {
    console.error("Ошибка поиска пустых страниц:", err);
    alert("Ошибка при поиске пустых страниц: " + String(err));
    s.setIsProcessing(false);
  }
}

async function handlePrint() {
  const s = usePdfEditorStore.getState();
  const { pdfJsDoc, currentPage, zoomLevel, pageRotations } = s;
  if (!pdfJsDoc) return;

  try {
    const rotation = ((pageRotations[currentPage] || 0) % 360 + 360) % 360;
    const page = await pdfJsDoc.getPage(currentPage);
    const scale = 2;
    const viewport = page.getViewport({ scale, rotation });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;

    const dataUrl = canvas.toDataURL("image/png");
    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) return;
    win.document.write(`
      <html><head><title>Печать — ${s.fileName}</title>
      <style>@page{margin:10mm}body{margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#fff}img{max-width:100%;max-height:95vh;object-fit:contain}</style>
      </head><body><img src="${dataUrl}" onload="window.print();window.close()"/></body></html>
    `);
    win.document.close();
  } catch (err) {
    console.error("Ошибка печати:", err);
  }
}

export default function HomePage() {
  const store = usePdfEditorStore();
  const {
    pdfFile, fileName, totalPages, currentPage, setCurrentPage,
    clipboardFragment, selectedFragment, pickedColor,
    isProcessing,
    showSecondary, secondaryTotalPages, secondaryCurrentPage,
    secondaryPanelWidth, setSecondaryPanelWidth,
    pageRotations, pageAdjustments, clearPageAdjustment,
  } = store;

  const isDragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    const container = containerRef.current;
    const onMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current || !container) return;
      const rect = container.getBoundingClientRect();
      const newW = rect.right - ev.clientX;
      // Позволяем двигать панль от 200 до 80% ширины контейнера
      setSecondaryPanelWidth(Math.max(200, Math.min(rect.width * 0.8, newW)));
    };
    const onMouseUp = () => {
      isDragging.current = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [setSecondaryPanelWidth]);

  // Event listeners for save / compress / crop / exports
  // Все операции с файлом на выходе проходят через диалог «Сохранить как» —
  // пользователь всегда указывает имя и место сохранения перед записью файла.
  useEffect(() => {
    const stripPdf = (name: string) => (name || "документ").replace(/\.pdf$/i, "");

    const handleSave = () => {
      const s = usePdfEditorStore.getState();
      if (!s.pdfFile || !s.pdfJsDoc) return;
      requestSaveAs({
        title: "Сохранить PDF-документ",
        defaultName: `${stripPdf(s.fileName)}_редактированный.pdf`,
        accept: { "application/pdf": [".pdf"] },
        typeLabel: "PDF документ",
        scopeHint: `все слои изменений будут вшиты в PDF · ${s.totalPages} стр.`,
        getBlob: () => buildPdfBlob("primary"),
      });
    };
    const handleSaveSecondary = () => {
      const s = usePdfEditorStore.getState();
      if (!s.secondaryPdfFile || !s.secondaryPdfJsDoc) return;
      requestSaveAs({
        title: "Сохранить PDF (источник)",
        defaultName: `${stripPdf(s.secondaryFileName)}_редактированный.pdf`,
        accept: { "application/pdf": [".pdf"] },
        typeLabel: "PDF документ",
        scopeHint: `все слои изменений будут вшиты в PDF · ${s.secondaryTotalPages} стр.`,
        getBlob: () => buildPdfBlob("secondary"),
      });
    };
    const handleCompress = (e: Event) => {
      const dpi = (e as CustomEvent).detail?.dpi || 150;
      const s = usePdfEditorStore.getState();
      if (!s.pdfFile || !s.pdfJsDoc) return;
      requestSaveAs({
        title: `Сжать PDF (${dpi} DPI)`,
        defaultName: `${stripPdf(s.fileName)}_${dpi}dpi.pdf`,
        accept: { "application/pdf": [".pdf"] },
        typeLabel: "PDF документ",
        scopeHint: "страницы будут преобразованы в изображения со слоями",
        getBlob: () => buildCompressedPdfBlob(dpi),
      });
    };
    const handleCrop = () => autoCropCurrentPage();
    const handleAutoCorrect = () => autoCorrectCurrentPage();
    const handlePrintEv = () => handlePrint();
    const handleExportImage = (e: Event) => {
      const format = (e as CustomEvent).detail?.format === "jpg" ? "jpg" : "png";
      const s = usePdfEditorStore.getState();
      if (!s.pdfJsDoc) return;
      const { hint } = getExportPages(s);
      requestSaveAs({
        title: "Экспорт страниц в изображения",
        defaultName: `${stripPdf(s.fileName)}_изображения.zip`,
        accept: { "application/zip": [".zip"] },
        typeLabel: "ZIP архив",
        scopeHint: `${hint} · формат ${format.toUpperCase()}`,
        getBlob: () => buildImagesZipBlob(format),
      });
    };
    const handleExportWordEv = () => {
      const s = usePdfEditorStore.getState();
      if (!s.pdfJsDoc) return;
      const { hint } = getExportPages(s);
      requestSaveAs({
        title: "Экспорт текста в Word",
        defaultName: `${stripPdf(s.fileName)}.docx`,
        accept: {
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
        },
        typeLabel: "Документ Word (.docx)",
        scopeHint: hint,
        getBlob: () => buildWordBlob(),
      });
    };
    const handleExportExcelEv = () => {
      const s = usePdfEditorStore.getState();
      if (!s.pdfJsDoc) return;
      const { hint } = getExportPages(s);
      requestSaveAs({
        title: "Экспорт текста в Excel",
        defaultName: `${stripPdf(s.fileName)}.xlsx`,
        accept: {
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
        },
        typeLabel: "Книга Excel (.xlsx)",
        scopeHint: `${hint} · каждая страница — отдельный лист`,
        getBlob: () => buildExcelBlob(),
      });
    };
    const handleDeleteBlank = () => deleteBlankPages();
    const handleCropToSelectionEv = () => cropToSelection();

    window.addEventListener("pdf-save", handleSave);
    window.addEventListener("pdf-save-secondary", handleSaveSecondary);
    window.addEventListener("pdf-compress", handleCompress);
    window.addEventListener("pdf-autocrop", handleCrop);
    window.addEventListener("pdf-autocorrect", handleAutoCorrect);
    window.addEventListener("pdf-print", handlePrintEv);
    window.addEventListener("pdf-export-image", handleExportImage);
    window.addEventListener("pdf-export-word", handleExportWordEv);
    window.addEventListener("pdf-export-excel", handleExportExcelEv);
    window.addEventListener("pdf-auto-delete-blank", handleDeleteBlank);
    window.addEventListener("pdf-crop-to-selection", handleCropToSelectionEv);
    return () => {
      window.removeEventListener("pdf-save", handleSave);
      window.removeEventListener("pdf-save-secondary", handleSaveSecondary);
      window.removeEventListener("pdf-compress", handleCompress);
      window.removeEventListener("pdf-autocrop", handleCrop);
      window.removeEventListener("pdf-autocorrect", handleAutoCorrect);
      window.removeEventListener("pdf-print", handlePrintEv);
      window.removeEventListener("pdf-export-image", handleExportImage);
      window.removeEventListener("pdf-export-word", handleExportWordEv);
      window.removeEventListener("pdf-export-excel", handleExportExcelEv);
      window.removeEventListener("pdf-auto-delete-blank", handleDeleteBlank);
      window.removeEventListener("pdf-crop-to-selection", handleCropToSelectionEv);
    };
  }, []);

  // Init pdfjs worker
  useEffect(() => {
    import("pdfjs-dist").then((pdfjsLib) => {
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url
      ).toString();
    });
  }, []);

  const goToPage = (p: number) => { if (p >= 1 && p <= totalPages) setCurrentPage(p); };

  const currentRotation = pageRotations[currentPage] || 0;
  const normRotation = ((currentRotation % 360) + 360) % 360;
  const hasRotation = normRotation !== 0;
  const currentAdj = pageAdjustments[currentPage] || null;

  return (
    <div className="h-screen flex flex-col bg-slate-50" ref={containerRef}>
      {/* ─── Header ─── */}
      <header className="relative flex items-center justify-between px-4 py-2.5 border-b border-slate-200/60 bg-gradient-to-r from-white via-emerald-50/50 to-white shrink-0 overflow-hidden">
        {/* Decorative glow */}
        <div className="pointer-events-none absolute -top-20 left-1/3 h-40 w-80 rounded-full bg-emerald-300/15 blur-3xl" />
        <div className="relative flex items-center gap-3">
          {/* Logo icon — beautiful generated artwork */}
          <div className="relative group">
            <div className="h-10 w-10 rounded-xl overflow-hidden shadow-lg shadow-emerald-500/25 ring-1 ring-black/10 transition-transform duration-200 group-hover:scale-105">
              <img src="/logo-new2.png" alt="Логотип Редактор PDF" className="h-full w-full object-cover scale-[1.14]" />
            </div>
            <div className="absolute inset-0 rounded-xl ring-1 ring-inset ring-white/25 pointer-events-none" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-slate-800 tracking-tight">Редактор PDF</h1>
            <p className="text-[10px] text-slate-400 font-medium leading-tight hidden sm:block">
              Профессиональное редактирование документов
            </p>
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="Настройки темы"
                className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-emerald-700 px-2 py-1.5 rounded-lg hover:bg-emerald-50/80 transition-colors"
              >
                <Palette className="h-3 w-3" />
                <span className="hidden md:inline">Тема</span>
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-48 p-1" side="bottom" align="start">
              {[
                { name: "Светлая", value: "light" },
                { name: "Тёмная", value: "dark" },
                { name: "Системная", value: "system" },
              ].map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => {
                    if (t.value === "dark") {
                      document.documentElement.classList.add("dark");
                    } else if (t.value === "light") {
                      document.documentElement.classList.remove("dark");
                    } else {
                      if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
                        document.documentElement.classList.add("dark");
                      } else {
                        document.documentElement.classList.remove("dark");
                      }
                    }
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs rounded-md hover:bg-slate-100 text-slate-700 transition-colors"
                >
                  {t.name}
                </button>
              ))}
            </PopoverContent>
          </Popover>
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="О программе"
                className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-emerald-700 px-2 py-1.5 rounded-lg hover:bg-emerald-50/80 transition-colors"
              >
                <Info className="h-3 w-3" />
                <span className="hidden md:inline">О программе</span>
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0 overflow-hidden rounded-2xl border-slate-200/80 shadow-2xl" side="bottom" align="start">
              {/* Banner */}
              <div className="relative h-24 bg-gradient-to-br from-emerald-500 via-teal-500 to-teal-600">
                <div
                  className="absolute inset-0 opacity-[0.18]"
                  style={{
                    backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
                    backgroundSize: "16px 16px",
                  }}
                />
                <div className="absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/10 blur-xl" />
                <div className="absolute -bottom-6 left-4">
                  <div className="h-16 w-16 rounded-2xl overflow-hidden ring-4 ring-white shadow-xl">
                    <img src="/logo-new2.png" alt="Редактор PDF" className="h-full w-full object-cover scale-[1.14]" />
                  </div>
                </div>
                <div className="absolute right-4 top-4 text-right text-white">
                  <p className="text-[9px] uppercase tracking-[0.2em] opacity-80 font-semibold">Версия</p>
                  <p className="text-xl font-bold leading-none drop-shadow-sm">2.0.0</p>
                </div>
              </div>
              {/* Body */}
              <div className="px-4 pb-4 pt-8 space-y-3">
                <div>
                  <p className="text-base font-bold text-slate-800 tracking-tight">Редактор PDF</p>
                  <p className="text-[11px] font-semibold text-emerald-600">
                    Профессиональный редактор документов
                  </p>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Всё для работы с PDF в одном окне: слои изменений с мгновенной отменой,
                  текст и подписи, фрагменты между документами, сжатие и экспорт —
                  а ещё изображения JPEG и PNG превращаются в PDF в один клик.
                </p>
                {/* Контакт разработчика */}
                <a
                  href="mailto:flytimopheev@gmail.com"
                  className="flex items-center gap-2 bg-slate-50 border border-slate-100 rounded-lg px-2.5 py-2 hover:bg-emerald-50 hover:border-emerald-200/70 transition-colors group"
                >
                  <span className="h-6 w-6 rounded-md bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0 group-hover:bg-emerald-200 transition-colors">
                    <Mail className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[9px] uppercase tracking-wider text-slate-400 font-semibold">Обратная связь · разработчик</span>
                    <span className="block text-xs font-medium text-slate-700 truncate">flytimopheev@gmail.com</span>
                  </span>
                </a>
                {/* Автор и лицензия */}
                <div className="grid grid-cols-2 gap-1.5">
                  <a
                    href="https://github.com/flytimopheev-sketch"
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 bg-slate-50 border border-slate-100 rounded-lg px-2.5 py-2 hover:bg-emerald-50 hover:border-emerald-200/70 transition-colors"
                  >
                    <span className="h-6 w-6 rounded-md bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                      <User className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[9px] uppercase tracking-wider text-slate-400 font-semibold">Автор</span>
                      <span className="block text-xs font-medium text-slate-700 truncate">flytimopheev</span>
                    </span>
                  </a>
                  <div className="flex items-center gap-2 bg-slate-50 border border-slate-100 rounded-lg px-2.5 py-2">
                    <span className="h-6 w-6 rounded-md bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                      <Scale className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[9px] uppercase tracking-wider text-slate-400 font-semibold">Лицензия</span>
                      <span className="block text-xs font-medium text-slate-700 truncate">MIT</span>
                    </span>
                  </div>
                </div>
                <a
                  href="https://github.com/flytimopheev-sketch/pdf-editor"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 bg-slate-50 border border-slate-100 rounded-lg px-2.5 py-2 hover:bg-emerald-50 hover:border-emerald-200/70 transition-colors group"
                >
                  <span className="h-6 w-6 rounded-md bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0 group-hover:bg-emerald-200 transition-colors">
                    <Github className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[9px] uppercase tracking-wider text-slate-400 font-semibold">Исходный код</span>
                    <span className="block text-xs font-medium text-slate-700 truncate">github.com/flytimopheev-sketch/pdf-editor</span>
                  </span>
                </a>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { dot: "bg-emerald-400", label: "Слои и история" },
                    { dot: "bg-amber-400", label: "JPEG / PNG → PDF" },
                    { dot: "bg-violet-400", label: "Текст и заметки" },
                    { dot: "bg-sky-400", label: "Сжатие и экспорт" },
                  ].map((f) => (
                    <div
                      key={f.label}
                      className="flex items-center gap-1.5 bg-slate-50 border border-slate-100 rounded-lg px-2 py-1.5"
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${f.dot} shrink-0`} />
                      <span className="text-[10px] font-medium text-slate-600 truncate">{f.label}</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between border-t border-slate-100 pt-2.5">
                  <p className="text-[10px] text-slate-400">© 2026 flytimopheev · РЕД ОС (x86_64)</p>
                  <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200/60 px-2 py-0.5 rounded-full">
                    Работает офлайн
                  </span>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <div className="flex items-center gap-2">
          {isProcessing && (
            <div className="flex items-center gap-1.5 text-xs text-emerald-600 bg-emerald-50 px-2.5 py-1.5 rounded-lg border border-emerald-200/60">
              <Loader2 className="h-3 w-3 animate-spin" /> Обработка...
            </div>
          )}
          {clipboardFragment && (
            <Badge variant="secondary" className="text-[10px] px-2.5 py-0.5 bg-violet-50 text-violet-700 border-violet-200/80 rounded-full font-medium">
              <Clipboard className="h-3 w-3 mr-1" /> В буфере
            </Badge>
          )}
          {hasRotation && (
            <Badge variant="secondary" className="text-[10px] px-2.5 py-0.5 bg-amber-50 text-amber-700 border-amber-200/80 rounded-full font-medium">
              <Crop className="h-3 w-3 mr-1" /> {normRotation}°
            </Badge>
          )}
          {currentAdj && (
            <Badge
              variant="secondary"
              className="text-[10px] px-2.5 py-0.5 bg-sky-50 text-sky-700 border-sky-200/80 rounded-full font-medium cursor-pointer hover:bg-sky-100 transition-colors"
              onClick={() => clearPageAdjustment(currentPage)}
              title="Нажмите для сброса"
            >
              <SunMedium className="h-3 w-3 mr-1" /> Ярк:{currentAdj.brightness > 0 ? "+" : ""}{currentAdj.brightness} Конт:{currentAdj.contrast > 0 ? "+" : ""}{currentAdj.contrast}
            </Badge>
          )}
          {pickedColor && pdfFile && (
            <div className="flex items-center gap-1.5 bg-white px-2 py-1 rounded-lg border border-slate-200/60 shadow-sm">
              <div className="w-4 h-4 rounded-md shadow-sm ring-1 ring-black/10" style={{ backgroundColor: pickedColor }} />
              <span className="text-[10px] font-mono text-slate-500 font-medium">{pickedColor}</span>
            </div>
          )}
          {fileName && <span className="text-[11px] text-slate-500 truncate max-w-[200px] font-medium bg-white px-2.5 py-1 rounded-lg border border-slate-200/60 shadow-sm">{fileName}</span>}
        </div>
      </header>

      {/* Toolbar */}
      <Toolbar />

      {/* ─── Main content area ─── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Thumbnails sidebar */}
        {pdfFile && (
          <div className="w-[120px] border-r border-slate-200/60 bg-white flex flex-col shrink-0">
            <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest px-2.5 py-2 border-b border-slate-100">
              Страницы
            </div>
            <ThumbnailSidebar target="primary" />
          </div>
        )}

        {/* Main viewer */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0 bg-slate-100">
          <CanvasViewer source="primary" />
          {pdfFile && (
            <div className="flex items-center justify-between px-4 py-2 border-t border-slate-200/60 bg-white shrink-0">
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-lg text-slate-500 hover:text-emerald-600 hover:bg-emerald-50"
                  onClick={() => goToPage(1)}
                  disabled={currentPage <= 1}
                >
                  <ChevronsLeft className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-lg text-slate-500 hover:text-emerald-600 hover:bg-emerald-50"
                  onClick={() => goToPage(currentPage - 1)}
                  disabled={currentPage <= 1}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span className="text-xs text-slate-600 min-w-[80px] text-center font-medium">
                  Стр. <input
                    type="number"
                    min={1}
                    max={totalPages}
                    value={currentPage}
                    onChange={(e) => goToPage(parseInt(e.target.value) || 1)}
                    className="w-10 text-center border-b-2 border-emerald-300 outline-none text-xs font-bold bg-transparent focus:border-emerald-500 transition-colors"
                  /> из {totalPages}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-lg text-slate-500 hover:text-emerald-600 hover:bg-emerald-50"
                  onClick={() => goToPage(currentPage + 1)}
                  disabled={currentPage >= totalPages}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-lg text-slate-500 hover:text-emerald-600 hover:bg-emerald-50"
                  onClick={() => goToPage(totalPages)}
                  disabled={currentPage >= totalPages}
                >
                  <ChevronsRight className="h-3.5 w-3.5" />
                </Button>
              </div>
              {selectedFragment && (
                <div className="flex items-center gap-2 text-[10px] text-slate-500 bg-slate-50 px-2 py-1 rounded-md">
                  <span className="font-medium">Фрагмент: {Math.round(selectedFragment.width)}×{Math.round(selectedFragment.height)}</span>
                  <Separator orientation="vertical" className="h-3" />
                  <span>{selectedFragment.sourceFileName} — стр. {selectedFragment.sourcePageIndex}</span>
                </div>
              )}
              {hasRotation && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-3 text-xs gap-1.5 text-amber-700 border-amber-200 bg-amber-50/50 hover:bg-amber-100 rounded-lg transition-colors"
                  onClick={() => window.dispatchEvent(new CustomEvent("pdf-autocrop"))}
                  disabled={isProcessing}
                >
                  <Crop className="h-3 w-3" />
                  Обрезать края
                </Button>
              )}
              <div className="text-[10px] text-slate-400 font-medium hidden md:block">
                T — текст &middot; E — ластик &middot; I — пипетка &middot; S — выделить &middot; V — вставить &middot; ←→ — переместить фрагмент
              </div>
            </div>
          )}
        </div>

        {/* Resizable divider */}
        {showSecondary && pdfFile && (
          <div
            className="w-1.5 bg-slate-200/80 hover:bg-violet-400 cursor-col-resize shrink-0 flex items-center justify-center transition-colors duration-200 active:bg-violet-500"
            onMouseDown={handleMouseDown}
          >
            <GripVertical className="h-3 w-3 text-slate-400" />
          </div>
        )}

        {/* Secondary PDF panel */}
        {showSecondary && pdfFile && (
          <div className="flex flex-col bg-white shrink-0" style={{ width: secondaryPanelWidth }}>
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200/60 bg-gradient-to-r from-violet-50/50 to-white">
              <div className="flex items-center gap-2">
                <div className="h-5 w-5 rounded-md bg-violet-100 flex items-center justify-center">
                  <span className="text-[9px] font-bold text-violet-600">SRC</span>
                </div>
                <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                  Источник
                </span>
                <span className="text-[10px] text-slate-400 truncate max-w-[100px]">
                  {store.secondaryFileName}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 rounded-md text-violet-500 hover:bg-violet-100"
                  onClick={() => window.dispatchEvent(new CustomEvent("pdf-save-secondary"))}
                  disabled={isProcessing}
                  title="Сохранить второй PDF"
                >
                  <Save className="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  onClick={() => store.setSecondaryCurrentPage(Math.max(1, secondaryCurrentPage - 1))}
                  disabled={secondaryCurrentPage <= 1}
                >
                  <ChevronLeft className="h-3 w-3" />
                </Button>
                <span className="text-[10px] text-slate-500 font-medium">{secondaryCurrentPage}/{secondaryTotalPages}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  onClick={() => store.setSecondaryCurrentPage(Math.min(secondaryTotalPages, secondaryCurrentPage + 1))}
                  disabled={secondaryCurrentPage >= secondaryTotalPages}
                >
                  <ChevronRight className="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                  onClick={store.closeSecondaryPdf}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            </div>
            <div className="flex flex-1 overflow-hidden">
              <div className="w-[80px] border-r border-slate-200/60 shrink-0">
                <ThumbnailSidebar target="secondary" />
              </div>
              <div className="flex-1 overflow-auto relative bg-slate-100">
                <CanvasViewer source="secondary" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Диалог «Сохранить как» — спрашивает имя/место перед сохранением и экспортом */}
      <SaveAsDialog />

      {/* Processing overlay */}
      {isProcessing && (
        <div className="fixed inset-0 bg-black/10 backdrop-blur-[2px] z-50 flex items-center justify-center">
          <div className="bg-white rounded-2xl shadow-2xl p-8 flex flex-col items-center gap-4 border border-slate-200/50">
            <div className="relative">
              <div className="h-12 w-12 rounded-full border-4 border-emerald-200 border-t-emerald-500 animate-spin" />
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-slate-700">Обработка PDF</p>
              <p className="text-xs text-slate-400 mt-0.5">Пожалуйста, подождите...</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
