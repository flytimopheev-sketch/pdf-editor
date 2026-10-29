"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { usePdfEditorStore } from "@/lib/pdf-store";
import { Check, ArrowUp, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ThumbnailItemProps {
  pageNum: number;
  dataUrl: string | undefined;
  isCurrent: boolean;
  isSelected: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  isPageSelectMode: boolean;
  onClick: () => void;
  onToggleSelect: (e: React.MouseEvent) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

function ThumbnailItem({
  pageNum,
  dataUrl,
  isCurrent,
  isSelected,
  canMoveUp,
  canMoveDown,
  isPageSelectMode,
  onClick,
  onToggleSelect,
  onMoveUp,
  onMoveDown,
}: ThumbnailItemProps) {
  return (
    <div className="group relative">
      {/* Move arrows — show when selected */}
      {isSelected && !isPageSelectMode && (
        <div className="absolute -left-0.5 top-1/2 -translate-y-1/2 z-10 flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          <Button
            variant="outline"
            size="icon"
            className="h-4 w-4 p-0 border-slate-300 bg-white shadow-sm rounded-sm"
            onClick={(e) => { e.stopPropagation(); onMoveUp(); }}
            disabled={!canMoveUp}
          >
            <ArrowUp className="h-2.5 w-2.5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-4 w-4 p-0 border-slate-300 bg-white shadow-sm rounded-sm"
            onClick={(e) => { e.stopPropagation(); onMoveDown(); }}
            disabled={!canMoveDown}
          >
            <ArrowDown className="h-2.5 w-2.5" />
          </Button>
        </div>
      )}

      <div
        className={cn(
          "block w-full rounded-lg transition-all duration-200 overflow-hidden cursor-pointer",
          isCurrent && !isSelected
            ? "ring-2 ring-emerald-500/60 ring-offset-1 shadow-sm"
            : isSelected
              ? "ring-2 ring-violet-500/60 ring-offset-1 shadow-sm"
              : "ring-1 ring-slate-200/80 hover:ring-slate-300 hover:shadow-sm"
        )}
        onClick={onClick}
      >
        <div className="relative bg-white p-1">
          {/* Selection checkbox */}
          <button
            onClick={(e) => { e.stopPropagation(); onToggleSelect(e); }}
            className={cn(
              "absolute top-1.5 left-1.5 z-10 h-4 w-4 rounded-md border flex items-center justify-center transition-all duration-200 shadow-sm",
              isSelected
                ? "bg-violet-500 border-violet-500 text-white scale-110"
                : "bg-white/90 border-slate-300 hover:border-violet-400 hover:bg-violet-50"
            )}
          >
            {isSelected && <Check className="h-2.5 w-2.5" />}
          </button>

          {dataUrl ? (
            <img
              src={dataUrl}
              alt={`Стр. ${pageNum}`}
              className="w-full h-auto rounded-sm"
              draggable={false}
            />
          ) : (
            <div className="w-full aspect-[3/4] bg-gradient-to-br from-slate-100 to-slate-200 animate-pulse rounded-sm" />
          )}
          <span className="absolute bottom-1.5 right-1.5 text-[9px] font-medium bg-slate-900/70 text-white rounded-md px-1.5 py-0.5 backdrop-blur-sm">
            {pageNum}
          </span>
        </div>
      </div>
    </div>
  );
}

export function ThumbnailSidebar({
  target: source,
}: {
  target: "primary" | "secondary";
}) {
  const store = usePdfEditorStore();
  const {
    pdfJsDoc,
    totalPages: primaryTotal,
    currentPage: primaryCurrent,
    setCurrentPage,
    pageSelections,
    secondaryPageSelections,
    pageOrder,
    togglePageSelection,
    toggleSecondaryPageSelection,
    movePage,
    pageRotations,
    secondaryPdfJsDoc,
    secondaryTotalPages,
    secondaryCurrentPage,
    setSecondaryCurrentPage,
  } = store;

  const doc = source === "primary" ? pdfJsDoc : secondaryPdfJsDoc;
  const totalPages = source === "primary" ? primaryTotal : secondaryTotalPages;
  const currentPage = source === "primary" ? primaryCurrent : secondaryCurrentPage;
  const setCurrent = source === "primary" ? setCurrentPage : setSecondaryCurrentPage;
  const selections = source === "primary" ? pageSelections : secondaryPageSelections;
  const toggleSelect = source === "primary" ? togglePageSelection : toggleSecondaryPageSelection;

  const [thumbnails, setThumbnails] = useState<Record<number, string>>({});
  const renderQueueRef = useRef<number[]>([]);
  const isRenderingRef = useRef(false);
  const startedRef = useRef(false);
  const docIdRef = useRef<string | null>(null);

  const processQueue = useCallback(async () => {
    if (!doc || isRenderingRef.current) return;
    if (renderQueueRef.current.length === 0) return;

    isRenderingRef.current = true;

    while (renderQueueRef.current.length > 0) {
      const pageNum = renderQueueRef.current.shift()!;
      try {
        const page = await doc.getPage(pageNum);
        const pageRot = (source === "primary" ? pageRotations[pageNum] : 0) || 0;
        const normalizedRot = ((pageRot % 360) + 360) % 360;
        const viewport = page.getViewport({ scale: 0.3, rotation: normalizedRot });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) continue;

        await page.render({ canvasContext: ctx, viewport }).promise;
        const dataUrl = canvas.toDataURL("image/jpeg", 0.6);
        setThumbnails((prev) => ({ ...prev, [pageNum]: dataUrl }));
      } catch {
        // skip
      }
    }

    isRenderingRef.current = false;
  }, [doc, pageRotations, source]);

  // Re-render thumbnails when rotation changes (doc stays the same)
  const rotationStrRef = useRef("");
  useEffect(() => {
    if (!doc) return;
    const newRotStr = JSON.stringify(source === "primary" ? pageRotations : {});
    if (newRotStr === rotationStrRef.current) return;
    rotationStrRef.current = newRotStr;
    // Re-render all thumbnails
    renderQueueRef.current = Array.from({ length: totalPages }, (_, i) => i + 1);
    isRenderingRef.current = false;
    setTimeout(() => processQueue(), 0);
  }, [doc, totalPages, pageRotations, processQueue, source]);

  // Start rendering when doc changes or rotation changes
  useEffect(() => {
    if (!doc) return;
    // Use a unique key to detect doc changes
    const id = `${doc.numPages}-${doc.loadingParams?.data?.byteLength || 0}`;
    if (id === docIdRef.current) return;
    docIdRef.current = id;
    rotationStrRef.current = JSON.stringify(source === "primary" ? pageRotations : {});
    startedRef.current = true;
    renderQueueRef.current = Array.from({ length: totalPages }, (_, i) => i + 1);
    isRenderingRef.current = false;
    // Schedule initial render
    setTimeout(() => processQueue(), 0);
  }, [doc, totalPages, processQueue, pageRotations]);

  // Continue rendering queue
  useEffect(() => {
    if (renderQueueRef.current.length > 0 && !isRenderingRef.current) {
      processQueue();
    }
  });

  // Map display order to physical page numbers
  const displayPages = pageOrder.length === totalPages ? pageOrder : Array.from({ length: totalPages }, (_, i) => i + 1);

  if (!doc || totalPages === 0) return null;

  return (
    <ScrollArea className="w-full h-full">
      <div className="p-1.5 space-y-1.5">
        {displayPages.map((physPage, displayIdx) => (
          <ThumbnailItem
            key={`page-${physPage}-${displayIdx}`}
            pageNum={physPage}
            dataUrl={thumbnails[physPage]}
            isCurrent={currentPage === physPage}
            isSelected={selections.includes(physPage)}
            canMoveUp={displayIdx > 0}
            canMoveDown={displayIdx < displayPages.length - 1}
            isPageSelectMode={selections.length > 0}
            onClick={() => setCurrentPage(physPage)}
            onToggleSelect={() => toggleSelect(physPage)}
            onMoveUp={() => {
              movePage(displayIdx, displayIdx - 1);
              setCurrentPage(physPage);
            }}
            onMoveDown={() => {
              movePage(displayIdx, displayIdx + 1);
              setCurrentPage(physPage);
            }}
          />
        ))}
      </div>
    </ScrollArea>
  );
}
