"use client";

import React, {
  useRef,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from "react";
import {
  usePdfEditorStore,
  type TextAnnotation,
  type FragmentData,
  type PlacedFragment,
  type EraserStroke,
  type DrawingStroke,
  type MarkAnnotation,
  type StickyNote,
  type SearchMatch,
  type FlatSearchItem,
} from "@/lib/pdf-store";
import { captureCanvasFragment, pickColorFromCanvas } from "@/lib/pdf-utils";
import { pageCacheKey, getCachedBitmap, setCachedBitmap } from "@/lib/pdf-cache";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

interface CanvasViewerProps {
  source: "primary" | "secondary";
}

const ERASER_BRUSH_SIZE = 25;
const PEN_WIDTH = 2;
const STICKY_COLORS: StickyNote["color"][] = ["yellow", "green", "pink", "blue", "orange"];
const STICKY_COLOR_MAP: Record<StickyNote["color"], string> = {
  yellow: "#fef08a",
  green: "#bbf7d0",
  pink: "#fecdd3",
  blue: "#bfdbfe",
  orange: "#fed7aa",
};
const STICKY_HEADER_MAP: Record<StickyNote["color"], string> = {
  yellow: "#facc15",
  green: "#4ade80",
  pink: "#fb7185",
  blue: "#60a5fa",
  orange: "#fb923c",
};

export function CanvasViewer({ source }: CanvasViewerProps) {
  const store = usePdfEditorStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());

  // Lazy history push for drag-like interactions:
  // the "layer" is pushed once on the first actual move, further moves are silent
  const fragInteractionRef = useRef<{ pushed: boolean; label: string } | null>(null);
  const stickyInteractionRef = useRef<{ pushed: boolean } | null>(null);

  const [rendering, setRendering] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [pageDims, setPageDims] = useState({ width: 0, height: 0 });
  const [selectionRect, setSelectionRect] = useState<{
    startX: number;
    startY: number;
    endX: number;
    endY: number;
  } | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [textPosition, setTextPosition] = useState<{ x: number; y: number } | null>(null);
  const [editingAnnotation, setEditingAnnotation] = useState<TextAnnotation | null>(null);
  const [textInput, setTextInput] = useState("");
  const [capturing, setCapturing] = useState(false);

  // Drop-zone (empty state, primary only): PDF или изображения можно перетащить
  const isPrimary = source === "primary";
  const [dropActive, setDropActive] = useState(false);
  const { toast } = useToast();

  const handleEmptyDrop = useCallback(
    async (ev: React.DragEvent) => {
      ev.preventDefault();
      setDropActive(false);
      if (source !== "primary") return;
      const files = Array.from(ev.dataTransfer.files || []);
      if (!files.length) return;
      const images = files.filter((f) => f.type.startsWith("image/"));
      const pdf = files.find(
        (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name),
      );
      try {
        if (images.length > 0) {
          const { convertAndOpenImages } = await import("@/lib/image-to-pdf");
          const res = await convertAndOpenImages(images);
          toast({
            title: res.appended
              ? "Изображения добавлены в документ"
              : "Изображения преобразованы в PDF",
            description: `${res.pageCount} ${res.pageCount === 1 ? "страница" : "стр."} готово`,
          });
        } else if (pdf) {
          const buffer = await pdf.arrayBuffer();
          await usePdfEditorStore.getState().loadPdf(buffer, pdf.name);
        }
      } catch (err) {
        toast({
          variant: "destructive",
          title: "Не удалось открыть файл",
          description: String(err instanceof Error ? err.message : err),
        });
      }
    },
    [source, toast],
  );

  // Eraser state
  const [isErasing, setIsErasing] = useState(false);
  const [currentEraserStroke, setCurrentEraserStroke] = useState<
    Array<{ x: number; y: number }>
  >([]);

  // Pen / free drawing state
  const [isPenDrawing, setIsPenDrawing] = useState(false);
  const [currentPenStroke, setCurrentPenStroke] = useState<
    Array<{ x: number; y: number }>
  >([]);
  const [penWidth, setPenWidth] = useState(PEN_WIDTH);

  // Mark drawing state (highlight / underline / strikethrough)
  const [isMarkDrawing, setIsMarkDrawing] = useState(false);

  // Sticky note editing / drag state
  const [editingStickyId, setEditingStickyId] = useState<string | null>(null);
  const [stickyDragState, setStickyDragState] = useState<{
    id: string;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  // Fragment selection / drag / resize
  const [selectedPlacedId, setSelectedPlacedId] = useState<string | null>(null);
  const [draggingFragment, setDraggingFragment] = useState<{
    id: string;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const [resizingFragment, setResizingFragment] = useState<{
    id: string;
    handle: "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w";
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    origW: number;
    origH: number;
  } | null>(null);

  // ---------- Source-specific state ----------
  const doc = source === "primary" ? store.pdfJsDoc : store.secondaryPdfJsDoc;
  const currentPage =
    source === "primary" ? store.currentPage : store.secondaryCurrentPage;
  const zoom = store.zoomLevel;
  const activeTool = store.activeTool;
  const pageRotations = store.pageRotations;
  const pageAdjustments = store.pageAdjustments;
  const docVersion = store.docVersion;

  // ---------- Filtered arrays ----------
  const myFragments = useMemo(
    () =>
      store.placedFragments.filter(
        (f) => f.source === source && f.pageIndex === currentPage
      ),
    [store.placedFragments, source, currentPage]
  );

  const myStickyNotes = useMemo(
    () => store.stickyNotes.filter((n) => n.source === source && n.pageIndex === currentPage),
    [store.stickyNotes, source, currentPage]
  );

  const myDrawingStrokes = useMemo(
    () =>
      store.drawingStrokes.filter(
        (s) => s.source === source && s.pageIndex === currentPage
      ),
    [store.drawingStrokes, source, currentPage]
  );

  const myEraserStrokes = useMemo(
    () =>
      store.eraserStrokes.filter(
        (s) => s.source === source && s.pageIndex === currentPage
      ),
    [store.eraserStrokes, source, currentPage]
  );

  const myMarkAnnotations = useMemo(
    () => store.markAnnotations.filter((m) => m.source === source && m.pageIndex === currentPage),
    [store.markAnnotations, source, currentPage]
  );

  const mySearchItems = useMemo(
    () => store.flatSearchItems.filter((item) => item.pageIndex === currentPage),
    [store.flatSearchItems, currentPage]
  );

  // Compute global index offset for search items on this page
  const searchGlobalOffset = useMemo(() => {
    let offset = 0;
    for (const item of store.flatSearchItems) {
      if (item.pageIndex === currentPage) break;
      offset++;
    }
    return offset;
  }, [store.flatSearchItems, currentPage]);

  // ---------- Computed values ----------
  const rotation = ((pageRotations[currentPage] || 0) % 360 + 360) % 360;
  const scale = zoom * 1.5;

  const currentAdjustment =
    source === "primary" ? pageAdjustments[currentPage] || null : null;
  const cssFilter = currentAdjustment
    ? `brightness(${1 + currentAdjustment.brightness / 100}) contrast(${
        1 + currentAdjustment.contrast / 100
      })`
    : "none";

  // ---------- Preload fragment images ----------
  useEffect(() => {
    for (const fp of myFragments) {
      const src = fp.fragment.imageData;
      if (!src || imageCacheRef.current.has(src)) continue;
      const img = new Image();
      img.src = src;
      if (img.complete && img.naturalWidth > 0) {
        imageCacheRef.current.set(src, img);
      } else {
        img.onload = () => {
          imageCacheRef.current.set(src, img);
          drawOverlays();
        };
        img.onerror = () => {
          console.warn("Failed to load fragment image");
        };
      }
    }
  }, [myFragments]);

  // ---------- Render PDF page to canvas (with bitmap cache) ----------
  const renderPage = useCallback(async () => {
    if (!doc || !canvasRef.current) return;
    // Self-heal: страница вне диапазона (например, после отмены добавленных страниц)
    if (currentPage > doc.numPages || currentPage < 1) {
      const safe = Math.max(1, Math.min(currentPage, doc.numPages || 1));
      if (source === "primary") usePdfEditorStore.getState().setCurrentPage(safe);
      else usePdfEditorStore.getState().setSecondaryCurrentPage(safe);
      return;
    }
    setRendering(true);

    try {
      const page = await doc.getPage(currentPage);
      const viewport = page.getViewport({ scale: scale, rotation });
      const canvas = canvasRef.current;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      setCanvasSize({ width: viewport.width, height: viewport.height });

      // Store original page dimensions (scale=1, rotation=0)
      const origViewport = page.getViewport({ scale: 1, rotation: 0 });
      setPageDims({ width: origViewport.width, height: origViewport.height });

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Check cache (docVersion guards against stale bitmaps after document changes)
      const key = pageCacheKey(source, docVersion, currentPage, zoom, rotation);
      const cached = getCachedBitmap(key);
      if (cached && cached.width === Math.round(viewport.width) && cached.height === Math.round(viewport.height)) {
        ctx.drawImage(cached, 0, 0);
      } else {
        // Render PDF page
        await page.render({ canvasContext: ctx, viewport }).promise;
        // Cache as ImageBitmap
        try {
          const bitmap = await createImageBitmap(canvas);
          setCachedBitmap(key, bitmap);
        } catch {
          // ImageBitmap not supported in some contexts, skip cache
        }
      }

      if (overlayCanvasRef.current) {
        overlayCanvasRef.current.width = viewport.width;
        overlayCanvasRef.current.height = viewport.height;
        drawOverlays();
      }
    } catch (err) {
      console.error("Error rendering page:", err);
    } finally {
      setRendering(false);
    }
  }, [doc, currentPage, zoom, rotation, source, scale, docVersion]);

  // ---------- Transform fragment coords between rotations ----------
  // Fragments are placed in viewport coords at a given rotation.
  // When rotation changes, we transform: viewport(rot1) → PDF canonical → viewport(rot2)
  const transformFragmentRotation = useCallback(
    (fx: number, fy: number, fw: number, fh: number, fromRot: number) => {
      const normFrom = ((fromRot % 360) + 360) % 360;
      const normTo = rotation;
      if (normFrom === normTo || pageDims.width === 0) return { x: fx, y: fy, w: fw, h: fh };

      const pw = pageDims.width; // original page width (at scale 1, rotation 0)
      const ph = pageDims.height;

      // Convert from viewport coords at fromRot to canonical PDF coords (TL origin, scale 1)
      let cx: number, cy: number; // center of fragment in canonical coords
      switch (normFrom) {
        case 0:
          cx = fx + fw / 2;
          cy = fy + fh / 2;
          break;
        case 90:
          cx = fy + fh / 2;
          cy = pw - (fx + fw / 2);
          break;
        case 180:
          cx = pw - (fx + fw / 2);
          cy = ph - (fy + fh / 2);
          break;
        case 270:
          cx = ph - (fy + fh / 2);
          cy = fx + fw / 2;
          break;
        default:
          // For non-90° rotations, no transform (rare case)
          return { x: fx, y: fy, w: fw, h: fh };
      }

      // Convert from canonical PDF coords to viewport coords at current rotation
      let newX: number, newY: number, newW: number, newH: number;
      switch (normTo) {
        case 0:
          newX = cx - fw / 2;
          newY = cy - fh / 2;
          newW = fw; newH = fh;
          break;
        case 90:
          newX = ph - cy - fh / 2;
          newY = cx - fw / 2;
          newW = fh; newH = fw;
          break;
        case 180:
          newX = pw - cx - fw / 2;
          newY = ph - cy - fh / 2;
          newW = fw; newH = fh;
          break;
        case 270:
          newX = cy - fh / 2;
          newY = pw - cx - fw / 2;
          newW = fh; newH = fw;
          break;
        default:
          return { x: fx, y: fy, w: fw, h: fh };
      }

      return { x: newX, y: newY, w: newW, h: newH };
    },
    [rotation, pageDims]
  );

  // ---------- Draw overlays ----------
  const drawOverlays = useCallback(() => {
    const overlayCanvas = overlayCanvasRef.current;
    if (!overlayCanvas) return;
    const ctx = overlayCanvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    // --- Search highlighting ---
    // Text content coords are PDF-space (y from bottom) — flip to canvas space
    const pageH = pageDims.height;
    for (let i = 0; i < mySearchItems.length; i++) {
      const item = mySearchItems[i];
      const globalIndex = searchGlobalOffset + i;
      const isCurrent = globalIndex === store.searchCurrentMatchIndex;
      ctx.save();
      ctx.fillStyle = isCurrent
        ? "rgba(251, 146, 60, 0.45)"
        : "rgba(250, 204, 21, 0.35)";
      ctx.fillRect(
        item.x * scale,
        (pageH - item.y - item.height) * scale,
        item.width * scale,
        item.height * scale
      );
      if (isCurrent) {
        ctx.strokeStyle = "rgba(234, 88, 12, 0.9)";
        ctx.lineWidth = 2;
        ctx.strokeRect(
          item.x * scale,
          (pageH - item.y - item.height) * scale,
          item.width * scale,
          item.height * scale
        );
      }
      ctx.restore();
    }

    // --- Eraser strokes (saved) — opaque white stamp brush ---
    for (const stroke of myEraserStrokes) {
      if (stroke.points.length < 1) continue;
      ctx.save();
      ctx.fillStyle = "rgba(255, 255, 255, 1.0)";
      const radius = (stroke.brushSize / 2) * scale;
      for (const pt of stroke.points) {
        ctx.beginPath();
        ctx.arc(pt.x * scale, pt.y * scale, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // --- Current eraser stroke being drawn ---
    if (isErasing && currentEraserStroke.length >= 1) {
      ctx.save();
      ctx.fillStyle = "rgba(255, 255, 255, 1.0)";
      const radius = (ERASER_BRUSH_SIZE / 2) * scale;
      for (const pt of currentEraserStroke) {
        ctx.beginPath();
        ctx.arc(pt.x * scale, pt.y * scale, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // --- Mark annotations (highlight / underline / strikethrough) ---
    for (const mark of myMarkAnnotations) {
      const mx = mark.x * scale;
      const my = mark.y * scale;
      const mw = mark.width * scale;
      const mh = mark.height * scale;

      ctx.save();
      if (mark.tool === "highlight") {
        ctx.fillStyle = mark.color || "rgba(250, 204, 21, 0.4)";
        ctx.globalAlpha = 0.4;
        ctx.fillRect(mx, my, mw, mh);
      } else if (mark.tool === "underline") {
        ctx.strokeStyle = mark.color || "#000000";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(mx, my + mh);
        ctx.lineTo(mx + mw, my + mh);
        ctx.stroke();
      } else if (mark.tool === "strikethrough") {
        ctx.strokeStyle = mark.color || "#000000";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(mx, my + mh / 2);
        ctx.lineTo(mx + mw, my + mh / 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // --- Drawing strokes (pen / free drawing) ---
    for (const stroke of myDrawingStrokes) {
      if (stroke.points.length < 2) continue;
      ctx.save();
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width * scale;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x * scale, stroke.points[0].y * scale);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x * scale, stroke.points[i].y * scale);
      }
      ctx.stroke();
      ctx.restore();
    }

    // --- Current pen stroke being drawn ---
    if (isPenDrawing && currentPenStroke.length >= 2) {
      ctx.save();
      ctx.strokeStyle = store.currentTextColor;
      ctx.lineWidth = penWidth * scale;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(currentPenStroke[0].x * scale, currentPenStroke[0].y * scale);
      for (let i = 1; i < currentPenStroke.length; i++) {
        ctx.lineTo(
          currentPenStroke[i].x * scale,
          currentPenStroke[i].y * scale
        );
      }
      ctx.stroke();
      ctx.restore();
    }

    // --- Text annotations (primary only) ---
    const annotations = store.textAnnotations.filter(
      (a) => a.pageIndex === currentPage && a.source === source
    );
    for (const annotation of annotations) {
      const scaledX = annotation.x * scale;
      const scaledY = annotation.y * scale;
      const scaledFontSize = annotation.fontSize * scale;

      ctx.save();
      ctx.font = `${scaledFontSize}px ${annotation.font}, serif`;
      ctx.fillStyle = annotation.color;
      ctx.globalAlpha = 0.8;
      ctx.fillText(annotation.text, scaledX, scaledY);
      ctx.restore();
    }

    // --- Placed fragments ---
    const frags = store.placedFragments.filter(
      (f) => f.source === source && f.pageIndex === currentPage
    );
    for (const fp of frags) {
      const img = imageCacheRef.current.get(fp.fragment.imageData);
      if (!img || img.naturalWidth === 0) continue;

      ctx.save();

      // Transform fragment coords if rotation changed since placement
      const placedRot = fp.placedRotation ?? 0;
      const transformed = transformFragmentRotation(fp.x, fp.y, fp.width, fp.height, placedRot);
      const drawX = transformed.x * scale;
      const drawY = transformed.y * scale;
      const drawW = transformed.w * scale;
      const drawH = transformed.h * scale;

      // Rotate the fragment image if needed (90° increments swap w/h)
      const normPlaced = ((placedRot % 360) + 360) % 360;
      const normCurrent = rotation;
      const deltaRot = ((normCurrent - normPlaced) % 360 + 360) % 360;

      if (deltaRot !== 0 && deltaRot % 90 === 0) {
        ctx.translate(drawX + drawW / 2, drawY + drawH / 2);
        ctx.rotate((deltaRot * Math.PI) / 180);
        ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
      } else {
        ctx.drawImage(img, drawX, drawY, drawW, drawH);
      }

      const isSelected = selectedPlacedId === fp.id;
      const isDragged = draggingFragment?.id === fp.id;

      if (isSelected || isDragged) {
        ctx.strokeStyle = isDragged ? "#f59e0b" : "#3b82f6";
        ctx.lineWidth = isDragged ? 3 : 2;
        ctx.setLineDash(isDragged ? [] : [5, 5]);
        ctx.strokeRect(drawX, drawY, drawW, drawH);

        const handleSize = 7;
        ctx.fillStyle = isDragged ? "#f59e0b" : "#3b82f6";
        ctx.setLineDash([]);
        const handles = [
          drawX, drawY,
          drawX + drawW, drawY,
          drawX, drawY + drawH,
          drawX + drawW, drawY + drawH,
          drawX + drawW / 2, drawY,
          drawX + drawW / 2, drawY + drawH,
          drawX, drawY + drawH / 2,
          drawX + drawW, drawY + drawH / 2,
        ];
        for (let i = 0; i < handles.length; i += 2) {
          ctx.beginPath();
          ctx.arc(handles[i], handles[i + 1], handleSize / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.fillStyle = isDragged ? "#f59e0b" : "#3b82f6";
          ctx.strokeStyle = isDragged ? "#f59e0b" : "#3b82f6";
        }
      }

      ctx.restore();
    }

    // --- Selection rectangle (crop / highlight / underline / strikethrough) ---
    if (selectionRect) {
      ctx.save();
      ctx.strokeStyle = "#3b82f6";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 3]);
      const sx = Math.min(selectionRect.startX, selectionRect.endX);
      const sy = Math.min(selectionRect.startY, selectionRect.endY);
      const sw = Math.abs(selectionRect.endX - selectionRect.startX);
      const sh = Math.abs(selectionRect.endY - selectionRect.startY);
      ctx.strokeRect(sx, sy, sw, sh);
      ctx.fillStyle = "rgba(59, 130, 246, 0.08)";
      ctx.fillRect(sx, sy, sw, sh);
      ctx.restore();
    }
  }, [
    currentPage,
    scale,
    source,
    store.textAnnotations,
    store.placedFragments,
    store.eraserStrokes,
    store.markAnnotations,
    store.drawingStrokes,
    store.stickyNotes,
    store.flatSearchItems,
    store.searchCurrentMatchIndex,
    selectionRect,
    draggingFragment,
    selectedPlacedId,
    isErasing,
    currentEraserStroke,
    isPenDrawing,
    currentPenStroke,
    penWidth,
    store.currentTextColor,
    activeTool,
    mySearchItems,
    searchGlobalOffset,
    myEraserStrokes,
    myMarkAnnotations,
    myDrawingStrokes,
    transformFragmentRotation,
    rotation,
  ]);

  // Re-render page when deps change
  useEffect(() => {
    renderPage();
  }, [renderPage]);

  // Re-draw overlays when deps change
  useEffect(() => {
    drawOverlays();
  }, [drawOverlays]);

  // Deselect placed fragment when switching tools
  useEffect(() => {
    if (activeTool && activeTool !== 'paste') {
      setSelectedPlacedId(null);
    }
  }, [activeTool]);

  // ---------- Mouse helpers ----------
  const getCanvasCoords = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const hitTestFragment = (canvasX: number, canvasY: number): PlacedFragment | null => {
    for (let i = myFragments.length - 1; i >= 0; i--) {
      const fp = myFragments[i];
      const t = transformFragmentRotation(fp.x, fp.y, fp.width, fp.height, fp.placedRotation ?? 0);
      const fx = t.x * scale;
      const fy = t.y * scale;
      const fw = t.w * scale;
      const fh = t.h * scale;
      if (
        canvasX >= fx &&
        canvasX <= fx + fw &&
        canvasY >= fy &&
        canvasY <= fy + fh
      ) {
        return fp;
      }
    }
    return null;
  };

  const hitTestStickyNote = (canvasX: number, canvasY: number): StickyNote | null => {
    const cx = canvasX / scale;
    const cy = canvasY / scale;
    for (let i = myStickyNotes.length - 1; i >= 0; i--) {
      const n = myStickyNotes[i];
      if (
        cx >= n.x &&
        cx <= n.x + n.width &&
        cy >= n.y &&
        cy <= n.y + n.height
      ) {
        return n;
      }
    }
    return null;
  };

  // ---------- High-resolution fragment capture ----------
  const captureHighResFragment = useCallback(
    async (
      docX: number,
      docY: number,
      docW: number,
      docH: number
    ): Promise<FragmentData | null> => {
      if (!doc) return null;
      setCapturing(true);
      try {
        const page = await doc.getPage(currentPage);
        const highScale = 3;
        const viewport = page.getViewport({ scale: highScale, rotation });

        const offscreen = document.createElement("canvas");
        offscreen.width = Math.round(viewport.width);
        offscreen.height = Math.round(viewport.height);
        const ctx = offscreen.getContext("2d");
        if (!ctx) return null;

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, offscreen.width, offscreen.height);
        await page.render({ canvasContext: ctx, viewport }).promise;

        const hrX = Math.round(docX * highScale);
        const hrY = Math.round(docY * highScale);
        const hrW = Math.round(docW * highScale);
        const hrH = Math.round(docH * highScale);

        const clampedX = Math.max(0, Math.min(hrX, offscreen.width - 1));
        const clampedY = Math.max(0, Math.min(hrY, offscreen.height - 1));
        const clampedW = Math.min(hrW, offscreen.width - clampedX);
        const clampedH = Math.min(hrH, offscreen.height - clampedY);

        if (clampedW <= 0 || clampedH <= 0) return null;

        const imageData = ctx.getImageData(clampedX, clampedY, clampedW, clampedH);
        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = clampedW;
        tempCanvas.height = clampedH;
        const tempCtx = tempCanvas.getContext("2d");
        if (!tempCtx) return null;
        tempCtx.putImageData(imageData, 0, 0);

        const origViewport = page.getViewport({ scale: 1, rotation });

        const dataUrl = tempCanvas.toDataURL("image/png");
        const img = new Image();
        img.src = dataUrl;
        if (img.complete) {
          imageCacheRef.current.set(dataUrl, img);
        } else {
          img.onload = () => {
            imageCacheRef.current.set(dataUrl, img);
            drawOverlays();
          };
        }

        return {
          imageData: dataUrl,
          x: docX,
          y: docY,
          width: docW,
          height: docH,
          sourceFileName:
            source === "primary" ? store.fileName : store.secondaryFileName,
          sourcePageIndex: currentPage,
          sourcePageWidth: origViewport.width,
          sourcePageHeight: origViewport.height,
        };
      } catch (err) {
        console.error("High-res capture failed:", err);
        return null;
      } finally {
        setCapturing(false);
      }
    },
    [doc, currentPage, rotation, scale, source, store.fileName, store.secondaryFileName]
  );

  // ---------- Paste fragment at given doc coords ----------
  const pasteAt = useCallback(
    (docX: number, docY: number) => {
      if (!store.clipboardFragment) return;
      const frag = store.clipboardFragment;

      const newFp: PlacedFragment = {
        id: Date.now().toString() + Math.random().toString(36).slice(2),
        source,
        pageIndex: currentPage,
        fragment: frag,
        x: docX - frag.width / 2,
        y: docY - frag.height / 2,
        width: frag.width,
        height: frag.height,
        placedRotation: rotation,
      };

      store.addPlacedFragment(newFp);
      // Fragment already pushed its own history layer — subsequent drag is silent
      fragInteractionRef.current = { pushed: true, label: "" };
      setSelectedPlacedId(newFp.id);
      setDraggingFragment({
        id: newFp.id,
        offsetX: frag.width / 2,
        offsetY: frag.height / 2,
      });
    },
    [store.clipboardFragment, source, currentPage, store.addPlacedFragment]
  );

  // ---------- Mouse handlers ----------
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!doc) return;
    const coords = getCanvasCoords(e);
    const docX = coords.x / scale;
    const docY = coords.y / scale;

    // PRIORITY 0: Check resize handles on selected fragment
    if (selectedPlacedId && !activeTool) {
      const frag = store.placedFragments.find((f) => f.id === selectedPlacedId);
      if (frag) {
        const t = transformFragmentRotation(frag.x, frag.y, frag.width, frag.height, frag.placedRotation ?? 0);
        const fx = t.x * scale;
        const fy = t.y * scale;
        const fw = t.w * scale;
        const fh = t.h * scale;
        const handleRadius = 10;
        const handles: Array<{
          name: "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w";
          hx: number;
          hy: number;
        }> = [
          { name: "nw", hx: fx, hy: fy },
          { name: "ne", hx: fx + fw, hy: fy },
          { name: "sw", hx: fx, hy: fy + fh },
          { name: "se", hx: fx + fw, hy: fy + fh },
          { name: "n", hx: fx + fw / 2, hy: fy },
          { name: "s", hx: fx + fw / 2, hy: fy + fh },
          { name: "w", hx: fx, hy: fy + fh / 2 },
          { name: "e", hx: fx + fw, hy: fy + fh / 2 },
        ];
        for (const h of handles) {
          const dist = Math.sqrt(
            (coords.x - h.hx) ** 2 + (coords.y - h.hy) ** 2
          );
          if (dist <= handleRadius) {
            fragInteractionRef.current = { pushed: false, label: "Изменение размера фрагмента" };
            setResizingFragment({
              id: frag.id,
              handle: h.name,
              startX: coords.x,
              startY: coords.y,
              origX: frag.x,
              origY: frag.y,
              origW: frag.width,
              origH: frag.height,
            });
            e.preventDefault();
            return;
          }
        }
      }
    }

    // PRIORITY 1: Sticky note drag check (if not editing that note)
    const hitSticky = hitTestStickyNote(coords.x, coords.y);
    if (hitSticky && (!editingStickyId || editingStickyId !== hitSticky.id)) {
      stickyInteractionRef.current = { pushed: false };
      setStickyDragState({
        id: hitSticky.id,
        offsetX: docX - hitSticky.x,
        offsetY: docY - hitSticky.y,
      });
      e.preventDefault();
      return;
    }

    // PRIORITY 2: Fragment hit-test → select & drag (only when no tool active)
    if (!activeTool) {
      const hitFragment = hitTestFragment(coords.x, coords.y);
      if (hitFragment) {
        fragInteractionRef.current = { pushed: false, label: "Перемещение фрагмента" };
        setSelectedPlacedId(hitFragment.id);
        setDraggingFragment({
          id: hitFragment.id,
          offsetX: coords.x / scale - hitFragment.x,
          offsetY: coords.y / scale - hitFragment.y,
        });
        store.bringFragmentToFront(hitFragment.id);
        return;
      }
    }

    // PRIORITY 3: Deselect if clicking empty area (and no tool active)
    if (selectedPlacedId && !activeTool) {
      setSelectedPlacedId(null);
    }

    // PRIORITY 4: Tool-specific handling
    if (activeTool === "crop") {
      setIsDrawing(true);
      setSelectionRect({
        startX: coords.x,
        startY: coords.y,
        endX: coords.x,
        endY: coords.y,
      });
    } else if (activeTool === "text") {
      setTextPosition({ x: docX, y: docY });
      setTextInput("");
      setEditingAnnotation(null);
    } else if (activeTool === "eyedropper") {
      const canvas = canvasRef.current;
      if (canvas) {
        const color = pickColorFromCanvas(canvas, coords.x, coords.y);
        store.setPickedColor(color);
      }
    } else if (activeTool === "paste" && store.clipboardFragment) {
      pasteAt(docX, docY);
    } else if (activeTool === "eraser") {
      setIsErasing(true);
      setCurrentEraserStroke([{ x: docX, y: docY }]);
    } else if (activeTool === "pen") {
      setIsPenDrawing(true);
      setCurrentPenStroke([{ x: docX, y: docY }]);
    } else if (
      activeTool === "highlight" ||
      activeTool === "underline" ||
      activeTool === "strikethrough"
    ) {
      setIsDrawing(true);
      setIsMarkDrawing(true);
      setSelectionRect({
        startX: coords.x,
        startY: coords.y,
        endX: coords.x,
        endY: coords.y,
      });
    } else if (activeTool === "sticky") {
      const newNote: StickyNote = {
        id: Date.now().toString() + Math.random().toString(36).slice(2),
        source,
        pageIndex: currentPage,
        x: docX,
        y: docY,
        text: "",
        color: "yellow",
        width: 180,
        height: 160,
      };
      store.addStickyNote(newNote);
      setEditingStickyId(newNote.id);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const coords = getCanvasCoords(e);

    // Sticky note dragging
    if (stickyDragState) {
      if (stickyInteractionRef.current && !stickyInteractionRef.current.pushed) {
        store.pushHistory("Перемещение заметки");
        stickyInteractionRef.current.pushed = true;
      }
      const docX = coords.x / scale;
      const docY = coords.y / scale;
      store.updateStickyNote(stickyDragState.id, {
        x: docX - stickyDragState.offsetX,
        y: docY - stickyDragState.offsetY,
      }, { silent: true });
      return;
    }

    // Resizing a placed fragment
    if (resizingFragment) {
      const dx = (coords.x - resizingFragment.startX) / scale;
      const dy = (coords.y - resizingFragment.startY) / scale;
      const rf = resizingFragment;
      const minSize = 5;
      let newX = rf.origX,
        newY = rf.origY,
        newW = rf.origW,
        newH = rf.origH;
      if (rf.handle.includes("e"))
        newW = Math.max(minSize, rf.origW + dx);
      if (rf.handle.includes("w")) {
        newW = Math.max(minSize, rf.origW - dx);
        newX = rf.origX + rf.origW - newW;
      }
      if (rf.handle.includes("s"))
        newH = Math.max(minSize, rf.origH + dy);
      if (rf.handle.includes("n")) {
        newH = Math.max(minSize, rf.origH - dy);
        newY = rf.origY + rf.origH - newH;
      }
      if (fragInteractionRef.current && !fragInteractionRef.current.pushed) {
        store.pushHistory(fragInteractionRef.current.label);
        fragInteractionRef.current.pushed = true;
      }
      store.updatePlacedFragment(rf.id, {
        x: newX,
        y: newY,
        width: newW,
        height: newH,
      }, { silent: true });
      return;
    }

    // Dragging a placed fragment
    if (draggingFragment) {
      if (fragInteractionRef.current && !fragInteractionRef.current.pushed) {
        store.pushHistory(fragInteractionRef.current.label);
        fragInteractionRef.current.pushed = true;
      }
      const docX = coords.x / scale;
      const docY = coords.y / scale;
      store.updatePlacedFragment(draggingFragment.id, {
        x: docX - draggingFragment.offsetX,
        y: docY - draggingFragment.offsetY,
      }, { silent: true });
      return;
    }

    // Drawing selection rect (crop, highlight, underline, strikethrough)
    if (isDrawing && (activeTool === "crop" || isMarkDrawing)) {
      setSelectionRect((prev) =>
        prev ? { ...prev, endX: coords.x, endY: coords.y } : null
      );
    }

    // Eraser drawing
    if (isErasing) {
      const docX = coords.x / scale;
      const docY = coords.y / scale;
      setCurrentEraserStroke((prev) => [...prev, { x: docX, y: docY }]);
      return;
    }

    // Pen drawing
    if (isPenDrawing) {
      const docX = coords.x / scale;
      const docY = coords.y / scale;
      setCurrentPenStroke((prev) => [...prev, { x: docX, y: docY }]);
      return;
    }
  };

  const handleMouseUp = async () => {
    fragInteractionRef.current = null;
    stickyInteractionRef.current = null;

    // Sticky drag finished
    if (stickyDragState) {
      setStickyDragState(null);
      return;
    }

    if (resizingFragment) {
      setResizingFragment(null);
      return;
    }

    if (draggingFragment) {
      setDraggingFragment(null);
      return;
    }

    // Finish eraser stroke (и одиночный клик — точечное стирание)
    if (isErasing && currentEraserStroke.length >= 1) {
      store.addEraserStroke({
        id: Date.now().toString() + Math.random().toString(36).slice(2),
        source,
        pageIndex: currentPage,
        points: [...currentEraserStroke],
        brushSize: ERASER_BRUSH_SIZE,
      });
      setIsErasing(false);
      setCurrentEraserStroke([]);
      return;
    }
    setIsErasing(false);
    setCurrentEraserStroke([]);

    // Finish pen stroke
    if (isPenDrawing && currentPenStroke.length >= 2) {
      store.addDrawingStroke({
        id: Date.now().toString() + Math.random().toString(36).slice(2),
        source,
        pageIndex: currentPage,
        points: [...currentPenStroke],
        color: store.currentTextColor,
        width: penWidth,
      });
    }
    setIsPenDrawing(false);
    setCurrentPenStroke([]);

    // Handle selection rect completion
    if (isDrawing && selectionRect) {
      setIsDrawing(false);

      const x = Math.min(selectionRect.startX, selectionRect.endX);
      const y = Math.min(selectionRect.startY, selectionRect.endY);
      const w = Math.abs(selectionRect.endX - selectionRect.startX);
      const h = Math.abs(selectionRect.endY - selectionRect.startY);

      if (w > 5 && h > 5) {
        const docX = x / scale;
        const docY = y / scale;
        const docW = w / scale;
        const docH = h / scale;

        if (activeTool === "crop") {
          // Capture fragment
          let fragment = await captureHighResFragment(docX, docY, docW, docH);

          // Fallback to display canvas capture
          if (!fragment && canvasRef.current) {
            const imageData = captureCanvasFragment(
              canvasRef.current,
              x,
              y,
              w,
              h
            );
            if (imageData) {
              const img = new Image();
              img.src = imageData;
              if (img.complete) {
                imageCacheRef.current.set(imageData, img);
              } else {
                img.onload = () => {
                  imageCacheRef.current.set(imageData, img);
                  drawOverlays();
                };
              }

              const page = await doc?.getPage(currentPage);
              const origViewport = page?.getViewport({ scale: 1, rotation });
              fragment = {
                imageData,
                x: docX,
                y: docY,
                width: docW,
                height: docH,
                sourceFileName:
                  source === "primary"
                    ? store.fileName
                    : store.secondaryFileName,
                sourcePageIndex: currentPage,
                sourcePageWidth:
                  origViewport?.width || canvasSize.width / scale,
                sourcePageHeight:
                  origViewport?.height || canvasSize.height / scale,
              };
            }
          }

          if (fragment) {
            store.setSelectedFragment(fragment);
            store.setClipboardFragment({ ...fragment });
            store.copyFragment();
          }
        } else if (isMarkDrawing && activeTool) {
          // Create mark annotation for highlight / underline / strikethrough
          const markColor =
            activeTool === "highlight"
              ? "rgba(250, 204, 21, 0.4)"
              : activeTool === "underline"
              ? "#ef4444"
              : "#ef4444";

          store.addMarkAnnotation({
            id: Date.now().toString() + Math.random().toString(36).slice(2),
            source,
            pageIndex: currentPage,
            tool: activeTool as "highlight" | "underline" | "strikethrough",
            x: docX,
            y: docY,
            width: docW,
            height: docH,
            color: markColor,
          });
        }
      }

      setIsMarkDrawing(false);
    } else {
      setIsMarkDrawing(false);
    }

    setSelectionRect(null);
    setIsDrawing(false);
  };

  // ---------- Commit text ----------
  const commitText = () => {
    if (!textPosition || !textInput.trim()) {
      setTextPosition(null);
      return;
    }

    if (editingAnnotation) {
      store.updateTextAnnotation(editingAnnotation.id, {
        text: textInput,
        font: store.currentFont,
        fontSize: store.currentFontSize,
        color: store.currentTextColor,
      });
    } else {
      const annotation: TextAnnotation = {
        id: Date.now().toString() + Math.random().toString(36).slice(2),
        source,
        pageIndex: currentPage,
        x: textPosition.x,
        y: textPosition.y,
        text: textInput,
        font: store.currentFont,
        fontSize: store.currentFontSize,
        color: store.currentTextColor,
      };
      store.addTextAnnotation(annotation);
    }

    setTextPosition(null);
    setTextInput("");
    setEditingAnnotation(null);
  };

  // ---------- Handle sticky note text changes ----------
  const handleStickyTextChange = (id: string, text: string) => {
    // Coalesced layer: continuous typing merges into a single undo step
    store.updateStickyNote(id, { text }, { key: `sticky-text-${id}` });
  };

  const handleStickyColorChange = (id: string, color: StickyNote["color"]) => {
    store.updateStickyNote(id, { color }, { key: `sticky-color-${id}` });
  };

  const handleStickyDelete = (id: string) => {
    store.removeStickyNote(id);
    if (editingStickyId === id) setEditingStickyId(null);
  };

  // ---------- Keyboard shortcuts ----------
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement;

      if (e.key === "Escape") {
        setTextPosition(null);
        setSelectionRect(null);
        setDraggingFragment(null);
        setSelectedPlacedId(null);
        setResizingFragment(null);
        setStickyDragState(null);
        setEditingStickyId(null);
        store.setActiveTool(null);
        return;
      }

      // Global shortcuts are registered only by the primary viewer,
      // otherwise every shortcut fires twice when the secondary panel is open
      if (source !== "primary") return;

      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === "v" || e.key === "V") &&
        !e.shiftKey
      ) {
        if (store.clipboardFragment && !isInput) {
          e.preventDefault();
          const centerX = canvasSize.width / scale / 2;
          const centerY = canvasSize.height / scale / 2;
          pasteAt(centerX, centerY);
          return;
        }
      }

      if ((e.ctrlKey || e.metaKey) && (e.key === "c" || e.key === "C")) {
        if (store.selectedFragment && !isInput) {
          e.preventDefault();
          store.copyFragment();
          return;
        }
      }

      // Ctrl+Y / Ctrl+Shift+Z — redo
      if (
        (e.ctrlKey || e.metaKey) &&
        ((e.key === "y" || e.key === "Y") ||
         ((e.key === "z" || e.key === "Z") && e.shiftKey))
      ) {
        if (!isInput) {
          e.preventDefault();
          store.redo();
          return;
        }
      }

      // Ctrl+Z — undo
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === "z" || e.key === "Z") &&
        !e.shiftKey
      ) {
        if (!isInput) {
          e.preventDefault();
          store.undo();
          return;
        }
      }

      if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("pdf-save"));
        return;
      }

      // Delete / Backspace
      if (e.key === "Delete" || e.key === "Backspace") {
        // If editing a sticky note's text area, don't intercept
        const isStickyEditing =
          editingStickyId &&
          target instanceof HTMLTextAreaElement;

        if (selectedPlacedId && !isInput && !isStickyEditing) {
          e.preventDefault();
          store.removePlacedFragment(selectedPlacedId);
          setSelectedPlacedId(null);
          setDraggingFragment(null);
          return;
        }

        if (isStickyEditing) {
          const note = store.stickyNotes.find((n) => n.id === editingStickyId);
          if (note && note.text.trim() === "") {
            e.preventDefault();
            store.removeStickyNote(editingStickyId!);
            setEditingStickyId(null);
            return;
          }
          // Otherwise let the native Backspace work in the textarea
          return;
        }

        if (!isInput) {
          e.preventDefault();
          // Remove last mark annotation on current page
          const pageMarks = store.markAnnotations.filter(
            (m) => m.pageIndex === currentPage
          );
          if (pageMarks.length > 0) {
            store.removeMarkAnnotation(pageMarks[pageMarks.length - 1].id);
            return;
          }
          // Remove last drawing stroke on current page
          const pageStrokes = store.drawingStrokes.filter(
            (s) => s.source === source && s.pageIndex === currentPage
          );
          if (pageStrokes.length > 0) {
            store.removeDrawingStroke(
              pageStrokes[pageStrokes.length - 1].id
            );
            return;
          }
        }
      }

      // Arrow keys — move selected placed fragment
      if (
        selectedPlacedId &&
        !isInput &&
        !e.ctrlKey &&
        !e.metaKey
      ) {
        const step = e.shiftKey ? 5 : 1;
        const fragment = store.placedFragments.find(
          (f) => f.id === selectedPlacedId
        );
        if (
          fragment &&
          ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
            e.key
          )
        ) {
          e.preventDefault();
          const dx =
            e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
          const dy =
            e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
          // Coalesced layer: an arrow-key burst merges into a single undo step
          store.updatePlacedFragment(selectedPlacedId, {
            x: fragment.x + dx,
            y: fragment.y + dy,
          }, { key: `frag-move-${selectedPlacedId}` });
          return;
        }
      }

      if (isInput) return;

      // Tool shortcuts
      if (e.key === "t" || e.key === "T") store.setActiveTool("text");
      if (e.key === "i" && !e.ctrlKey && !e.metaKey)
        store.setActiveTool("eyedropper");
      if (e.key === "e" && !e.ctrlKey && !e.metaKey)
        store.setActiveTool("eraser");
      if (e.key === "s" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        store.setActiveTool("crop");
      }
      if (e.key === "v" && !e.ctrlKey && !e.metaKey)
        store.setActiveTool("paste");
      if (e.key === "p" || e.key === "P") store.setActiveTool("pen");
      if (e.key === "h" || e.key === "H") store.setActiveTool("highlight");
      if (e.key === "n" || e.key === "N") store.setActiveTool("sticky");
      if (e.key === "+" || e.key === "=") store.setZoomLevel(zoom + 0.25);
      if (e.key === "-") store.setZoomLevel(zoom - 0.25);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    store,
    zoom,
    pasteAt,
    canvasSize,
    scale,
    draggingFragment,
    selectedPlacedId,
    editingStickyId,
    currentPage,
    source,
  ]);

  // ---------- Cursor ----------
  const getCursor = () => {
    if (resizingFragment) {
      const h = resizingFragment.handle;
      if (h === "nw" || h === "se") return "nwse-resize";
      if (h === "ne" || h === "sw") return "nesw-resize";
      if (h === "n" || h === "s") return "ns-resize";
      return "ew-resize";
    }
    if (isErasing) return "cell";
    if (isPenDrawing) return "crosshair";
    if (isMarkDrawing) return "crosshair";
    if (draggingFragment) return "grabbing";
    if (stickyDragState) return "grabbing";
    if (selectedPlacedId && !activeTool) return "default";
    switch (activeTool) {
      case "text":
        return "text";
      case "eyedropper":
        return "crosshair";
      case "crop":
        return capturing ? "wait" : "crosshair";
      case "eraser":
        return "cell";
      case "pen":
        return "crosshair";
      case "highlight":
        return "crosshair";
      case "underline":
        return "crosshair";
      case "strikethrough":
        return "crosshair";
      case "sticky":
        return "cell";
      case "paste":
        return store.clipboardFragment ? "copy" : "default";
      default:
        return "default";
    }
  };

  const handleMouseMoveCursor = (e: React.MouseEvent) => {
    if (draggingFragment || activeTool || stickyDragState) return;
    const coords = getCanvasCoords(e);
    const hitFrag = hitTestFragment(coords.x, coords.y);
    const hitSticky = hitTestStickyNote(coords.x, coords.y);
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.style.cursor = hitFrag
        ? "move"
        : hitSticky
        ? "grab"
        : "default";
    }
  };

  // ---------- Tool hint messages ----------
  const getToolHint = () => {
    if (!activeTool) return null;
    switch (activeTool) {
      case "text":
        return "\uD83D\uDCDD \u0422\u0435\u043A\u0441\u0442 \u2014 \u043A\u043B\u0438\u043A\u043D\u0438\u0442\u0435 \u0434\u043B\u044F \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u0438\u044F";
      case "eyedropper":
        return "\uD83D\uDCA7 \u041F\u0438\u043F\u0435\u0442\u043A\u0430 \u2014 \u043A\u043B\u0438\u043A\u043D\u0438\u0442\u0435 \u0434\u043B\u044F \u0432\u044B\u0431\u043E\u0440\u0430 \u0446\u0432\u0435\u0442\u0430";
      case "crop":
        return capturing
          ? "\u23F3 \u0417\u0430\u0445\u0432\u0430\u0447\u0435\u043D \u0444\u0440\u0430\u0433\u043C\u0435\u043D\u0442 \u0432\u044B\u0441\u043E\u043A\u043E\u0433\u043E \u043A\u0430\u0447\u0435\u0441\u0442\u0432\u0430..."
          : "\u2702\uFE0F \u0412\u044B\u0434\u0435\u043B\u0435\u043D\u0438\u0435 \u2014 \u0432\u044B\u0434\u0435\u043B\u0438\u0442\u0435 \u0444\u0440\u0430\u0433\u043C\u0435\u043D\u0442";
      case "paste":
        return "\uD83D\uDCCB \u0412\u0441\u0442\u0430\u0432\u043A\u0430 \u2014 \u043A\u043B\u0438\u043A\u043D\u0438\u0442\u0435 \u0434\u043B\u044F \u0432\u0441\u0442\u0430\u0432\u043A\u0438 (\u0438\u043B\u0438 Ctrl+V)";
      case "eraser":
        return isErasing
          ? "🧽 Ластик — ведите, чтобы стереть рисунок и текст"
          : "🧽 Ластик — стирает нарисованное пером и замазывает содержимое PDF (Ctrl+Z — отменить)";
      case "pen":
        return "\u270F\uFE0F \u041A\u0430\u0440\u0430\u043D\u0434\u0430\u0448 \u2014 \u0440\u0438\u0441\u0443\u0439\u0442\u0435 \u0441\u0432\u043E\u0431\u043E\u0434\u043D\u044B\u0435 \u043B\u0438\u043D\u0438\u0438";
      case "highlight":
        return "\uD83D\uDFE2 \u0412\u044B\u0434\u0435\u043B\u0435\u043D\u0438\u0435 \u2014 \u0432\u044B\u0434\u0435\u043B\u0438\u0442\u0435 \u043E\u0431\u043B\u0430\u0441\u0442\u044C \u0434\u043B\u044F \u043F\u043E\u0434\u0441\u0432\u0435\u0442\u043A\u0438";
      case "underline":
        return "\uD83C\uDD93 \u041F\u043E\u0434\u0447\u0451\u0440\u043A\u0438\u0432\u0430\u043D\u0438\u0435 \u2014 \u0432\u044B\u0434\u0435\u043B\u0438\u0442\u0435 \u043E\u0431\u043B\u0430\u0441\u0442\u044C \u0434\u043B\u044F \u043F\u043E\u0434\u0447\u0451\u0440\u043A\u0438\u0432\u0430\u043D\u0438\u044F";
      case "sticky":
        return "\uD83D\uDCCC \u0417\u0430\u043C\u0435\u0442\u043A\u0430 \u2014 \u043A\u043B\u0438\u043A\u043D\u0438\u0442\u0435 \u0434\u043B\u044F \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u0438\u044F \u0437\u0430\u043C\u0435\u0442\u043A\u0438";
      default:
        return null;
    }
  };

  const toolHint = getToolHint();

  return (
    <div
      ref={containerRef}
      className="relative flex-1 overflow-auto bg-slate-100 flex items-start justify-center"
    >
      {!doc ? (
        <div
          className={`absolute inset-0 flex flex-col items-center justify-center text-slate-300 px-4 transition-colors duration-200 ${
            dropActive ? "bg-emerald-50/70" : ""
          }`}
          onDragOver={
            isPrimary
              ? (e) => {
                  e.preventDefault();
                  setDropActive(true);
                }
              : undefined
          }
          onDragLeave={
            isPrimary
              ? (e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    setDropActive(false);
                  }
                }
              : undefined
          }
          onDrop={isPrimary ? handleEmptyDrop : undefined}
        >
          {dropActive && (
            <div className="absolute inset-3 rounded-2xl border-2 border-dashed border-emerald-400 bg-emerald-50/40 pointer-events-none" />
          )}
          <div className="relative mb-6">
            <div className="absolute -inset-4 rounded-[2rem] bg-emerald-400/15 blur-2xl" />
            <div className="relative h-24 w-24 rounded-3xl overflow-hidden shadow-2xl shadow-emerald-500/30 ring-1 ring-black/10">
              <img src="/logo-new2.png" alt="Редактор PDF" className="h-full w-full object-cover scale-[1.14]" />
            </div>
          </div>
          <p className="text-lg font-semibold text-slate-400">
            {dropActive ? "Отпустите файл — откроем!" : "Добро пожаловать в Редактор PDF"}
          </p>
          <p className="text-sm mt-1.5 text-slate-300 text-center max-w-sm">
            {dropActive
              ? "PDF откроется для редактирования, JPEG / PNG станут страницами"
              : isPrimary
                ? "Нажмите «Открыть» на панели инструментов или перетащите сюда PDF, JPEG или PNG"
                : "Откройте PDF-источник через панель инструментов"}
          </p>
          <div className="flex flex-wrap justify-center gap-2 mt-6 max-w-md">
            <div className="flex items-center gap-1.5 bg-white px-3 py-2 rounded-lg border border-slate-200/60 shadow-sm text-xs text-slate-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Поворот и выравнивание
            </div>
            <div className="flex items-center gap-1.5 bg-white px-3 py-2 rounded-lg border border-slate-200/60 shadow-sm text-xs text-slate-400">
              <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
              Текст и заметки
            </div>
            <div className="flex items-center gap-1.5 bg-white px-3 py-2 rounded-lg border border-slate-200/60 shadow-sm text-xs text-slate-400">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              JPEG / PNG → PDF
            </div>
            <div className="flex items-center gap-1.5 bg-white px-3 py-2 rounded-lg border border-slate-200/60 shadow-sm text-xs text-slate-400">
              <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
              Слои и отмена
            </div>
          </div>
        </div>
      ) : (
        <div ref={wrapperRef} className="relative inline-block">
          {rendering && (
            <div className="absolute top-2 right-2 z-10">
              <div className="flex items-center gap-1.5 bg-slate-800/80 backdrop-blur-sm text-white text-xs px-2.5 py-1 rounded-full">
                <Loader2 className="h-3 w-3 animate-spin" />
                Загрузка...
              </div>
            </div>
          )}

          {rotation !== 0 && (
            <div className="absolute top-2 left-2 z-10">
              <div className="bg-amber-500/90 backdrop-blur-sm text-white text-xs px-2.5 py-1 rounded-full font-medium">
                {rotation}°
              </div>
            </div>
          )}

          {toolHint && !draggingFragment && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10">
              <div className="bg-slate-800/80 backdrop-blur-sm text-white text-xs px-4 py-1.5 rounded-full shadow-lg">
                {toolHint}
              </div>
            </div>
          )}

          {selectedPlacedId && !draggingFragment && (
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10">
              <div className="bg-slate-700/80 backdrop-blur-sm text-white text-[10px] px-3 py-1.5 rounded-full shadow-lg font-medium whitespace-nowrap">
                ← ↑ ↓ → переместить · Shift = крупный шаг · Delete — удалить · Esc — снять выделение
              </div>
            </div>
          )}

          {draggingFragment && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10">
              <div className="bg-amber-500/90 backdrop-blur-sm text-white text-xs px-4 py-1.5 rounded-full shadow-lg font-medium">
                \u270B \u041F\u0435\u0440\u0435\u043C\u0435\u0449\u0435\u043D\u0438\u0435 \u2014 \u043E\u0442\u043F\u0443\u0441\u0442\u0438\u0442\u0435 \u0434\u043B\u044F \u0440\u0430\u0437\u043C\u0435\u0449\u0435\u043D\u0438\u044F
              </div>
            </div>
          )}

          <div className="relative rounded-lg shadow-xl ring-1 ring-black/5 overflow-hidden">
            <canvas
              ref={canvasRef}
              className="block bg-white"
              style={{
                cursor: getCursor(),
                maxWidth: "none",
                display: "block",
                filter: cssFilter !== "none" ? cssFilter : undefined,
              }}
              onMouseDown={handleMouseDown}
              onMouseMove={(e) => {
                handleMouseMove(e);
                handleMouseMoveCursor(e);
              }}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            />

            <canvas
              ref={overlayCanvasRef}
              className="absolute top-0 left-0 pointer-events-none"
              style={{ maxWidth: "none" }}
            />
          </div>

          {/* Text input overlay */}
          {textPosition && (
            <div
              className="absolute z-20"
              style={{
                left: textPosition.x * scale + 16,
                top: textPosition.y * scale + 16,
              }}
            >
              <div className="bg-white rounded-xl shadow-xl ring-1 ring-slate-200/80 p-2 border border-slate-200/50">
                <input
                  type="text"
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitText();
                    if (e.key === "Escape") {
                      setTextPosition(null);
                      setTextInput("");
                    }
                  }}
                  placeholder="Введите текст..."
                  autoFocus
                  className="outline-none text-sm min-w-[200px] bg-transparent"
                  style={{
                    fontFamily: store.currentFont,
                    fontSize: store.currentFontSize * scale,
                    color: store.currentTextColor,
                  }}
                />
                <div className="flex gap-1.5 mt-1.5">
                  <button
                    onClick={commitText}
                    className="text-[10px] bg-emerald-500 text-white px-3 py-1 rounded-lg hover:bg-emerald-600 font-medium transition-colors"
                  >
                    OK
                  </button>
                  <button
                    onClick={() => {
                      setTextPosition(null);
                      setTextInput("");
                    }}
                    className="text-[10px] bg-slate-100 text-slate-600 px-3 py-1 rounded-lg hover:bg-slate-200 font-medium transition-colors"
                  >
                    \u041E\u0442\u043C\u0435\u043D\u0430
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Sticky note HTML overlays */}
          {myStickyNotes.map((note) => {
            const isEditing = editingStickyId === note.id;
            const isDragging = stickyDragState?.id === note.id;
            return (
              <div
                key={note.id}
                className={`absolute z-30 rounded-lg shadow-lg border border-black/10 overflow-hidden select-none ${
                  isDragging ? "opacity-90" : ""
                }`}
                style={{
                  left: note.x * scale,
                  top: note.y * scale,
                  width: note.width * scale,
                  minHeight: 32 * scale,
                  cursor: isDragging ? "grabbing" : "grab",
                }}
                onMouseDown={(e) => {
                  if (isEditing) return;
                  e.stopPropagation();
                  const canvas = canvasRef.current;
                  if (!canvas) return;
                  const rect = canvas.getBoundingClientRect();
                  const scaleX = canvas.width / rect.width;
                  const scaleY = canvas.height / rect.height;
                  const canvasX = (e.clientX - rect.left) * scaleX;
                  const canvasY = (e.clientY - rect.top) * scaleY;
                  const docX = canvasX / scale;
                  const docY = canvasY / scale;
                  setStickyDragState({
                    id: note.id,
                    offsetX: docX - note.x,
                    offsetY: docY - note.y,
                  });
                }}
              >
                {/* Color picker header */}
                <div
                  className="flex items-center justify-between px-1.5 py-0.5"
                  style={{
                    backgroundColor: STICKY_HEADER_MAP[note.color],
                    cursor: isDragging ? "grabbing" : "grab",
                  }}
                >
                  <div className="flex gap-0.5">
                    {STICKY_COLORS.map((c) => (
                      <button
                        key={c}
                        className="w-3.5 h-3.5 rounded-full border border-black/20 hover:scale-110 transition-transform"
                        style={{ backgroundColor: STICKY_HEADER_MAP[c] }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStickyColorChange(note.id, c);
                        }}
                      />
                    ))}
                  </div>
                  <button
                    className="text-black/50 hover:text-red-600 text-xs font-bold leading-none px-1"
                    onMouseDown={(e) => {
                      e.stopPropagation();
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleStickyDelete(note.id);
                    }}
                  >
                    ✕
                  </button>
                </div>

                {/* Text area */}
                <div
                  style={{
                    backgroundColor: STICKY_COLOR_MAP[note.color],
                    padding: "4px 6px",
                    minHeight: 60 * scale,
                  }}
                  onClick={() => {
                    if (!isEditing) setEditingStickyId(note.id);
                  }}
                >
                  <textarea
                    value={note.text}
                    onChange={(e) =>
                      handleStickyTextChange(note.id, e.target.value)
                    }
                    onFocus={() => setEditingStickyId(note.id)}
                    onBlur={() => {
                      // Delay to allow click events on color/delete buttons
                      setTimeout(() => {
                        if (editingStickyId === note.id) {
                          setEditingStickyId(null);
                        }
                      }, 150);
                    }}
                    placeholder="Заметка..."
                    className="w-full h-full bg-transparent border-none outline-none resize-none text-xs text-gray-800 placeholder-gray-400"
                    style={{
                      minHeight: 50 * scale,
                      fontFamily: "inherit",
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
