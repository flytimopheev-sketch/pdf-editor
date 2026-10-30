'use client';

import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  Type, Pipette, ClipboardPaste, Save, FolderOpen, Undo2, Redo2, History, ZoomIn, ZoomOut,
  FileText, Copy, Trash2, FileOutput, CheckSquare, Square, ImageDown, Eraser,
  RotateCcw, RotateCw, Wand2, BoxSelect, SunMedium, SlidersHorizontal, Pen,
  Highlighter, Underline, StickyNote, Search, Printer, FileDown,
  FileSpreadsheet, Signature, ChevronUp, ChevronDown, X, FileImage, Crop,
  FileX2, Download, Upload, AlertTriangle, Layers, SearchX, Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { usePdfEditorStore, FONT_LIST } from '@/lib/pdf-store';
import { convertAndOpenImages } from '@/lib/image-to-pdf';
import { ocrPage } from '@/lib/ocr-client';
import { useToast } from '@/hooks/use-toast';
import type {
  FlatSearchItem, SignatureTemplate, SearchMatch, TextLineItem, OcrWordItem,
} from '@/lib/pdf-store';

// ── Style System ──────────────────────────────────────────────────────

type ColorGroup = 'file' | 'rotate' | 'tool' | 'page' | 'zoom' | 'adjust' | 'draw' | 'export';

const GROUP_COLORS: Record<ColorGroup, {
  bg: string; hoverBg: string; text: string; activeBg: string; activeText: string;
}> = {
  file:    { bg: 'bg-emerald-50/80', hoverBg: 'hover:bg-emerald-100', text: 'text-emerald-600', activeBg: 'bg-emerald-500', activeText: 'text-white' },
  rotate:  { bg: 'bg-amber-50/80',   hoverBg: 'hover:bg-amber-100',   text: 'text-amber-600',   activeBg: 'bg-amber-500',   activeText: 'text-white' },
  tool:    { bg: 'bg-violet-50/80',  hoverBg: 'hover:bg-violet-100',  text: 'text-violet-600',  activeBg: 'bg-violet-500',  activeText: 'text-white' },
  page:    { bg: 'bg-rose-50/80',    hoverBg: 'hover:bg-rose-100',    text: 'text-rose-600',    activeBg: 'bg-rose-500',    activeText: 'text-white' },
  zoom:    { bg: 'bg-slate-50/80',   hoverBg: 'hover:bg-slate-100',   text: 'text-slate-600',   activeBg: 'bg-slate-500',   activeText: 'text-white' },
  adjust:  { bg: 'bg-sky-50/80',    hoverBg: 'hover:bg-sky-100',    text: 'text-sky-600',    activeBg: 'bg-sky-500',    activeText: 'text-white' },
  draw:    { bg: 'bg-teal-50/80',    hoverBg: 'hover:bg-teal-100',    text: 'text-teal-600',    activeBg: 'bg-teal-500',    activeText: 'text-white' },
  export:  { bg: 'bg-indigo-50/80',  hoverBg: 'hover:bg-indigo-100',  text: 'text-indigo-600',  activeBg: 'bg-indigo-500',  activeText: 'text-white' },
};

// ── ToolButton ────────────────────────────────────────────────────────

interface ToolButtonProps {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  colorGroup?: ColorGroup;
  variant?: 'destructive' | 'warning';
}

function ToolButton({ icon, label, active, onClick, disabled, colorGroup = 'tool', variant }: ToolButtonProps) {
  const colors = GROUP_COLORS[colorGroup];

  let bgClass = colors.bg;
  let textClass = colors.text;

  if (variant === 'destructive') {
    bgClass = 'bg-red-50/80';
    textClass = 'text-red-500';
  } else if (variant === 'warning') {
    bgClass = 'bg-amber-50/80';
    textClass = 'text-amber-500';
  }

  if (active) {
    bgClass = colors.activeBg;
    textClass = colors.activeText;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          onClick={onClick}
          className={[
            'inline-flex items-center justify-center w-8 h-8 rounded-lg',
            'ring-1 ring-black/[0.04] shadow-[0_1px_2px_rgba(0,0,0,0.04)]',
            bgClass,
            colors.hoverBg,
            textClass,
            'transition-all duration-150',
            'hover:scale-[1.02] hover:shadow-[0_2px_4px_rgba(0,0,0,0.08)]',
            'active:scale-95 active:shadow-[0_1px_2px_rgba(0,0,0,0.04)]',
            'disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:shadow-[0_1px_2px_rgba(0,0,0,0.04)]',
          ].join(' ')}
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        className="bg-slate-800 text-white rounded-lg shadow-xl border-0 text-xs"
      >
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

// ── ManualAdjustPopover ───────────────────────────────────────────────

function ManualAdjustPopover() {
  const { currentPage, pageAdjustments, setPageAdjustment, clearPageAdjustment } = usePdfEditorStore();
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [open, setOpen] = useState(false);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen) {
      // Sync from store when opening
      const adj = usePdfEditorStore.getState().pageAdjustments[usePdfEditorStore.getState().currentPage];
      setBrightness(adj?.brightness ?? 0);
      setContrast(adj?.contrast ?? 0);
    }
    setOpen(nextOpen);
  }, []);

  const handleApply = () => {
    setPageAdjustment(currentPage, { brightness, contrast });
    setOpen(false);
  };

  const handleCancel = () => {
    const adj = usePdfEditorStore.getState().pageAdjustments[usePdfEditorStore.getState().currentPage];
    setBrightness(adj?.brightness ?? 0);
    setContrast(adj?.contrast ?? 0);
    setOpen(false);
  };

  const handleReset = () => {
    setBrightness(0);
    setContrast(0);
    clearPageAdjustment(currentPage);
  };

  const filterStr = `brightness(${(100 + brightness) / 100}) contrast(${(100 + contrast) / 100})`;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Яркость / Контраст"
          aria-label="Яркость / Контраст"
          className={[
            'inline-flex items-center justify-center w-8 h-8 rounded-lg',
            'ring-1 ring-black/[0.04] shadow-[0_1px_2px_rgba(0,0,0,0.04)]',
            GROUP_COLORS.adjust.bg,
            GROUP_COLORS.adjust.hoverBg,
            GROUP_COLORS.adjust.text,
            'transition-all duration-150',
            'hover:scale-[1.02] hover:shadow-[0_2px_4px_rgba(0,0,0,0.08)]',
          ].join(' ')}
        >
          <SunMedium className="w-3.5 h-3.5" />
          <SlidersHorizontal className="w-2.5 h-2.5 ml-[-2px]" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-4 space-y-4" side="bottom">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-slate-600">Яркость</Label>
            <span className="text-xs text-slate-400">{brightness > 0 ? '+' : ''}{brightness}</span>
          </div>
          <Slider
            min={-100}
            max={100}
            step={1}
            value={[brightness]}
            onValueChange={([v]) => setBrightness(v)}
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-slate-600">Контраст</Label>
            <span className="text-xs text-slate-400">{contrast > 0 ? '+' : ''}{contrast}</span>
          </div>
          <Slider
            min={-100}
            max={100}
            step={1}
            value={[contrast]}
            onValueChange={([v]) => setContrast(v)}
          />
        </div>
        {/* Preview bar */}
        <div className="space-y-1">
          <Label className="text-xs text-slate-500">Предпросмотр</Label>
          <div
            className="h-8 rounded-md border border-slate-200 bg-gradient-to-r from-white via-slate-100 to-slate-300"
            style={{ filter: filterStr }}
          />
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleApply} className="flex-1 h-7 text-xs bg-sky-500 hover:bg-sky-600">
            Применить
          </Button>
          <Button size="sm" variant="outline" onClick={handleCancel} className="flex-1 h-7 text-xs">
            Отмена
          </Button>
          <Button size="sm" variant="ghost" onClick={handleReset} className="h-7 text-xs text-slate-400">
            Сброс
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── SearchBar ────────────────────────────────────────────────────

type SearchStatus = "idle" | "searching" | "ocr" | "noresults" | "results";

function SearchBar() {
  const {
    pdfJsDoc, totalPages, currentPage, setCurrentPage,
    searchQuery, setSearchQuery,
    flatSearchItems, setFlatSearchItems,
    searchCurrentMatchIndex, setSearchCurrentMatchIndex,
    searchMatches, setSearchMatches,
  } = usePdfEditorStore();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [localQuery, setLocalQuery] = useState('');
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [ocrLabel, setOcrLabel] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  // Ctrl+F открывает поиск (работает и в русской раскладке — клавиша «а»)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А')
      ) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleSearch = useCallback(async () => {
    const q = localQuery.trim();
    if (!pdfJsDoc || !q) {
      setFlatSearchItems([]);
      setSearchMatches([]);
      setSearchCurrentMatchIndex(-1);
      setStatus('idle');
      return;
    }

    setStatus('searching');
    setSearchQuery(q);

    const query = q.toLowerCase();
    const allFlat: FlatSearchItem[] = [];
    const allMatches: SearchMatch[] = [];

    type RawItem = { str: string; x: number; y: number; width: number; height: number };

    // ── Этап 1: текстовый слой pdfjs (есть ли текст и где) ──────────
    const itemsByPage = new Map<number, RawItem[]>();
    const pagesWithoutText: number[] = [];

    for (let p = 1; p <= totalPages; p++) {
      try {
        const page = await pdfJsDoc.getPage(p);
        const textContent = await page.getTextContent();
        const items: RawItem[] = [];
        for (const raw of textContent.items as Array<Record<string, unknown>>) {
          const str = String(raw.str ?? '');
          if (!str.trim()) continue;
          const tr = raw.transform as number[] | undefined;
          items.push({
            str,
            x: tr?.[4] ?? 0,
            y: tr?.[5] ?? 0,
            width: Number(raw.width ?? 0),
            height: Number(raw.height ?? 12),
          });
        }
        if (items.length > 0) {
          itemsByPage.set(p, items);
        } else {
          pagesWithoutText.push(p);
        }
      } catch {
        // skip page errors
      }
    }

    // ── Этап 2: OCR для страниц-сканов (без текстового слоя) ────────
    // Результаты кэшируются в store (по docVersion) — повторный поиск мгновенен
    if (pagesWithoutText.length > 0) {
      const st = usePdfEditorStore.getState();
      const cached = st.ocrDocVersion === st.docVersion ? st.ocrResults : {};
      const need = pagesWithoutText.filter((p) => !(p in cached));

      if (need.length > 0) {
        setStatus('ocr');
        const collected: Record<number, OcrWordItem[]> = { ...cached };
        let recognized = 0;
        for (let i = 0; i < need.length; i++) {
          const p = need[i];
          setOcrLabel(`OCR ${i + 1}/${need.length}…`);
          try {
            const words = await ocrPage(pdfJsDoc, p);
            collected[p] = words;
            if (words.length > 0) recognized++;
          } catch (err) {
            console.error('OCR error on page', p, err);
            collected[p] = []; // не повторяем неудачную страницу в этом документе
          }
        }
        const cur = usePdfEditorStore.getState();
        cur.setOcrResults(cur.docVersion, collected);
        setOcrLabel(null);
        setStatus('searching');
        if (recognized > 0) {
          toast({
            title: `OCR: распознано страниц — ${recognized}`,
            description: 'Текст скана теперь доступен для поиска',
          });
        }
      }

      // Подключаем распознанный текст (из кэша или только что) к поиску
      const latest = usePdfEditorStore.getState();
      const ocr = latest.ocrDocVersion === latest.docVersion ? latest.ocrResults : {};
      for (const p of pagesWithoutText) {
        const words = ocr[p] ?? [];
        if (words.length > 0) {
          itemsByPage.set(
            p,
            words.map((w) => ({
              str: w.text,
              x: w.x,
              y: w.y,
              width: w.width,
              height: w.height,
            })),
          );
        }
      }
    }

    // ── Этап 3: сопоставление по строкам (текстовый слой + OCR) ────
    for (let p = 1; p <= totalPages; p++) {
      const items = itemsByPage.get(p);
      if (!items || items.length === 0) continue;

      // Группируем элементы в строки по координате Y — запрос,
      // разорванный между соседними фрагментами текста, теперь находится
      const lines = new Map<number, RawItem[]>();
      for (const it of items) {
        const key = Math.round(it.y / 2) * 2;
        if (!lines.has(key)) lines.set(key, []);
        lines.get(key)!.push(it);
      }

      const seen = new Set<string>();
      const pageItems: TextLineItem[] = [];

      for (const lineItems of lines.values()) {
        lineItems.sort((a, b) => a.x - b.x);
        // Склеиваем строку, запоминая диапазон символов каждого элемента
        let lineText = '';
        const spans: Array<{ start: number; end: number; item: RawItem }> = [];
        for (const it of lineItems) {
          const start = lineText.length;
          lineText += it.str;
          spans.push({ start, end: lineText.length, item: it });
          lineText += ' ';
        }
        const lower = lineText.toLowerCase();
        let from = 0;
        for (;;) {
          const idx = lower.indexOf(query, from);
          if (idx === -1) break;
          from = idx + Math.max(1, query.length);
          const qEnd = idx + query.length;
          for (const span of spans) {
            if (span.end <= idx || span.start >= qEnd) continue;
            const key = `${span.item.x}|${span.item.y}|${span.item.width}`;
            if (seen.has(key)) continue;
            seen.add(key);
            pageItems.push({
              pageIndex: p,
              text: span.item.str,
              x: span.item.x,
              y: span.item.y,
              width: span.item.width,
              height: span.item.height,
            });
            allFlat.push({
              pageIndex: p,
              itemIndex: allFlat.length,
              x: span.item.x,
              y: span.item.y,
              width: span.item.width,
              height: span.item.height,
              text: span.item.str,
            });
          }
        }
      }

      if (pageItems.length > 0) {
        allMatches.push({ pageIndex: p, items: pageItems });
      }
    }

    setFlatSearchItems(allFlat);
    setSearchMatches(allMatches);

    if (allFlat.length > 0) {
      setSearchCurrentMatchIndex(0);
      setCurrentPage(allFlat[0].pageIndex);
      setStatus('results');
    } else {
      setSearchCurrentMatchIndex(-1);
      setStatus('noresults');
      const docHasText = itemsByPage.size > 0;
      if (pagesWithoutText.length === totalPages && !docHasText) {
        // Документ — скан, но OCR не дал текста
        toast({
          variant: 'destructive',
          title: 'Нет совпадений',
          description:
            'Документ — скан без текстового слоя, и OCR не распознал текст. Попробуйте улучшить качество скана.',
        });
      }
    }
  }, [pdfJsDoc, localQuery, totalPages, setFlatSearchItems, setSearchMatches, setSearchCurrentMatchIndex, setSearchQuery, setCurrentPage, toast]);

  const goToNext = useCallback(() => {
    if (flatSearchItems.length === 0) return;
    const next = (searchCurrentMatchIndex + 1) % flatSearchItems.length;
    setSearchCurrentMatchIndex(next);
    setCurrentPage(flatSearchItems[next].pageIndex);
  }, [flatSearchItems, searchCurrentMatchIndex, setSearchCurrentMatchIndex, setCurrentPage]);

  const goToPrev = useCallback(() => {
    if (flatSearchItems.length === 0) return;
    const prev = (searchCurrentMatchIndex - 1 + flatSearchItems.length) % flatSearchItems.length;
    setSearchCurrentMatchIndex(prev);
    setCurrentPage(flatSearchItems[prev].pageIndex);
  }, [flatSearchItems, searchCurrentMatchIndex, setSearchCurrentMatchIndex, setCurrentPage]);

  const handleClose = () => {
    setOpen(false);
    setLocalQuery('');
    setFlatSearchItems([]);
    setSearchMatches([]);
    setSearchCurrentMatchIndex(-1);
    setSearchQuery('');
    setStatus('idle');
  };

  if (!open) {
    return (
      <ToolButton
        icon={<Search className="w-3.5 h-3.5" />}
        label="Поиск по документу (Ctrl+F)"
        colorGroup="adjust"
        onClick={() => setOpen(true)}
      />
    );
  }

  return (
    <div className="flex items-center gap-1 bg-slate-50 rounded-lg px-2 py-1 ring-1 ring-black/[0.04]">
      <Input
        ref={inputRef}
        value={localQuery}
        onChange={(e) => setLocalQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSearch();
          if (e.key === 'Escape') handleClose();
        }}
        placeholder="Поиск..."
        className="h-6 w-36 text-xs border-0 bg-transparent shadow-none focus-visible:ring-0 p-0"
      />
      <button
        type="button"
        onClick={handleSearch}
        className="p-0.5 rounded hover:bg-slate-200 text-slate-500 hover:text-slate-700 transition-colors"
        title="Искать (Enter)"
      >
        <Search className="w-3 h-3" />
      </button>
      <button
        type="button"
        onClick={goToPrev}
        disabled={flatSearchItems.length === 0}
        className="p-0.5 rounded hover:bg-slate-200 text-slate-500 hover:text-slate-700 transition-colors disabled:opacity-30"
        title="Предыдущее совпадение"
      >
        <ChevronUp className="w-3 h-3" />
      </button>
      <button
        type="button"
        onClick={goToNext}
        disabled={flatSearchItems.length === 0}
        className="p-0.5 rounded hover:bg-slate-200 text-slate-500 hover:text-slate-700 transition-colors disabled:opacity-30"
        title="Следующее совпадение"
      >
        <ChevronDown className="w-3 h-3" />
      </button>
      {status === 'results' && flatSearchItems.length > 0 && (
        <span className="text-[10px] font-medium text-emerald-600 whitespace-nowrap">
          {searchCurrentMatchIndex + 1}/{flatSearchItems.length}
        </span>
      )}
      {status === 'searching' && (
        <span className="text-[10px] text-slate-400 whitespace-nowrap">Поиск...</span>
      )}
      {status === 'ocr' && (
        <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-sky-600 whitespace-nowrap">
          <Loader2 className="w-3 h-3 animate-spin" />
          {ocrLabel ?? 'OCR...'}
        </span>
      )}
      {status === 'noresults' && (
        <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-rose-500 whitespace-nowrap">
          <SearchX className="w-3 h-3" />
          Нет совпадений
        </span>
      )}
      <button
        type="button"
        onClick={handleClose}
        className="p-0.5 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors"
        title="Закрыть (Esc)"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

// ── SignatureTemplatesPopover ─────────────────────────────────────────

function SignatureTemplatesPopover() {
  const {
    signatureTemplates, saveSignatureTemplate, removeSignatureTemplate,
    clipboardFragment,
  } = usePdfEditorStore();

  const [open, setOpen] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  const handleSaveTemplate = () => {
    if (!clipboardFragment) return;
    const name = prompt('Название подписи:', `Подпись ${signatureTemplates.length + 1}`);
    if (!name) return;
    saveSignatureTemplate({
      id: `sig-${Date.now()}`,
      name,
      fragment: { ...clipboardFragment },
      createdAt: Date.now(),
    });
  };

  const handlePasteTemplate = (template: SignatureTemplate) => {
    usePdfEditorStore.getState().setClipboardFragment({ ...template.fragment });
    usePdfEditorStore.getState().setActiveTool('paste');
  };

  const handleExport = () => {
    const data = JSON.stringify(signatureTemplates, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pdf-signatures.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    importInputRef.current?.click();
  };

  const onImportChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string);
        if (!Array.isArray(parsed)) {
          alert('Неверный формат файла: ожидается массив');
          return;
        }
        let count = 0;
        for (const item of parsed) {
          if (
            item &&
            typeof item.id === 'string' &&
            typeof item.name === 'string' &&
            item.fragment &&
            typeof item.fragment.imageData === 'string' &&
            typeof item.createdAt === 'number'
          ) {
            saveSignatureTemplate(item as SignatureTemplate);
            count++;
          }
        }
        if (count === 0) {
          alert('Не найдено валидных шаблонов подписей в файле');
        } else {
          alert(`Импортировано шаблонов: ${count}`);
        }
      } catch {
        alert('Ошибка чтения файла: неверный формат JSON');
      }
    };
    reader.readAsText(file);
    // Reset input so same file can be re-imported
    e.target.value = '';
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Шаблоны подписей"
          aria-label="Шаблоны подписей"
          className="inline-flex items-center justify-center w-8 h-8 rounded-lg ring-1 ring-black/[0.04] shadow-[0_1px_2px_rgba(0,0,0,0.04)] bg-violet-50/80 hover:bg-violet-100 text-violet-600 transition-all duration-150 hover:scale-[1.02]"
        >
          <Signature className="w-3.5 h-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" side="bottom">
        <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-700">Шаблоны подписей</span>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
              localStorage (PNG)
            </Badge>
          </div>
          <button
            type="button"
            onClick={handleSaveTemplate}
            disabled={!clipboardFragment}
            className="text-xs text-sky-600 hover:text-sky-700 disabled:opacity-30 disabled:cursor-not-allowed font-medium"
          >
            Сохранить
          </button>
        </div>
        <div className="max-h-64 overflow-y-auto">
          {signatureTemplates.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-slate-400">
              Нет сохранённых шаблонов.<br />
              Скопируйте фрагмент и нажмите «Сохранить».
            </div>
          ) : (
            signatureTemplates.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 border-b border-slate-50 last:border-0"
              >
                {t.fragment.imageData && (
                  <img
                    src={t.fragment.imageData}
                    alt={t.name}
                    className="w-10 h-6 object-contain rounded border border-slate-200 bg-white"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-slate-700 truncate">{t.name}</div>
                  <div className="text-[10px] text-slate-400">
                    {new Date(t.createdAt).toLocaleDateString('ru-RU')}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handlePasteTemplate(t)}
                  className="p-1 rounded hover:bg-sky-50 text-sky-500 hover:text-sky-700 transition-colors"
                  title="Вставить"
                >
                  <ClipboardPaste className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => removeSignatureTemplate(t.id)}
                  className="p-1 rounded hover:bg-red-50 text-red-400 hover:text-red-600 transition-colors"
                  title="Удалить"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))
          )}
        </div>
        {/* Import / Export footer */}
        <div className="flex items-center gap-2 px-3 py-2 border-t border-slate-100">
          <button
            type="button"
            onClick={handleExport}
            disabled={signatureTemplates.length === 0}
            className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-700 disabled:opacity-30 transition-colors"
          >
            <Download className="w-3 h-3" />
            Экспорт
          </button>
          <button
            type="button"
            onClick={handleImport}
            className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-700 transition-colors"
          >
            <Upload className="w-3 h-3" />
            Импорт
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={onImportChange}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── HistoryPanel («Слои») ──────────────────────────────────────────────

function HistoryPanel() {
  const {
    historyStack, historyIndex, canUndo, canRedo, pdfFile,
    undo, redo, jumpToHistory, clearHistory,
  } = usePdfEditorStore();
  const [popOpen, setPopOpen] = useState(false);

  const handleSaveLayers = () => {
    // Закрываем панель и открываем диалог «Сохранить как»:
    // все слои будут вшиты в PDF-документ
    setPopOpen(false);
    window.dispatchEvent(new CustomEvent('pdf-save'));
  };

  return (
    <Popover open={popOpen} onOpenChange={setPopOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Слои изменений (история)"
          aria-label="Слои изменений (история)"
          className="relative inline-flex items-center justify-center w-8 h-8 rounded-lg ring-1 ring-black/[0.04] shadow-[0_1px_2px_rgba(0,0,0,0.04)] bg-emerald-50/80 hover:bg-emerald-100 text-emerald-600 transition-all duration-150 hover:scale-[1.02]"
        >
          <History className="w-3.5 h-3.5" />
          {historyStack.length > 0 && (
            <span className="absolute -top-1 -right-1 h-3.5 min-w-3.5 px-0.5 rounded-full bg-emerald-500 text-white text-[8px] font-bold flex items-center justify-center">
              {historyStack.length}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" side="bottom" align="start">
        <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Layers className="w-3.5 h-3.5 text-emerald-600" />
            <span className="text-sm font-medium text-slate-700">Слои изменений</span>
          </div>
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
            {historyIndex} / {historyStack.length}
          </Badge>
        </div>

        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-slate-100">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs flex-1 gap-1"
            onClick={undo}
            disabled={!canUndo}
          >
            <Undo2 className="w-3 h-3" /> Отменить
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs flex-1 gap-1"
            onClick={redo}
            disabled={!canRedo}
          >
            <Redo2 className="w-3 h-3" /> Вернуть
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-slate-400 hover:text-rose-600"
            onClick={clearHistory}
            disabled={historyStack.length === 0}
            title="Очистить историю"
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>

        {/* Сохранение: вшивает все слои в PDF через диалог «Сохранить как» */}
        <div className="px-3 py-2 border-b border-slate-100">
          <Button
            size="sm"
            className="w-full h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
            onClick={handleSaveLayers}
            disabled={!pdfFile}
          >
            <Save className="w-3.5 h-3.5" />
            Сохранить итоговый PDF (вшить слои)
          </Button>
        </div>

        <div className="max-h-96 overflow-y-auto">
          {historyStack.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-slate-400">
              Пока нет слоёв изменений.<br />
              Каждое действие (текст, рисунок, поворот, вставка)
              сохраняется здесь как отдельный слой.
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => jumpToHistory(0)}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-left border-b border-slate-50 transition-colors ${
                  historyIndex === 0 ? 'bg-emerald-50/80' : 'hover:bg-slate-50'
                }`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-slate-300 shrink-0" />
                <span className="text-xs text-slate-500">Исходный документ</span>
              </button>
              {historyStack.map((entry, i) => {
                const isCurrent = i === historyIndex - 1;
                const isUndone = i >= historyIndex;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => jumpToHistory(i + 1)}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-left border-b border-slate-50 last:border-0 transition-colors ${
                      isCurrent ? 'bg-emerald-50/80' : 'hover:bg-slate-50'
                    } ${isUndone ? 'opacity-45' : ''}`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                        isCurrent ? 'bg-emerald-500' : isUndone ? 'bg-slate-200' : 'bg-slate-400'
                      }`}
                    />
                    <span className="flex-1 min-w-0">
                      <span className="block text-xs text-slate-700 truncate">{entry.label}</span>
                    </span>
                    <span className="text-[10px] text-slate-400 tabular-nums shrink-0">
                      {new Date(entry.time).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                    {isCurrent && (
                      <span className="text-[9px] font-semibold text-emerald-600 shrink-0">СЕЙЧАС</span>
                    )}
                  </button>
                );
              })}
            </>
          )}
        </div>

        <div className="px-3 py-2 border-t border-slate-100">
          <p className="text-[10px] text-slate-400 leading-relaxed">
            Клик по слою — вернуться к этому состоянию. «Сохранить» вшивает все слои в PDF.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── Main Toolbar ──────────────────────────────────────────────────────

export function Toolbar() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const secondaryInputRef = useRef<HTMLInputElement>(null);

  const {
    pdfFile,
    currentPage,
    totalPages,
    pageSelections,
    pageRotations,
    activeTool,
    currentFont,
    currentFontSize,
    currentTextColor,
    selectedFragment,
    clipboardFragment,
    zoomLevel,
    isProcessing,
    pageAdjustments,
    canUndo,
    canRedo,
    setActiveTool,
    setFont,
    setFontSize,
    setTextColor,
    rotatePage,
    undo,
    redo,
    copyFragment,
    setZoomLevel,
    selectAllPages,
    clearPageSelections,
    deletePages,
    extractPages,
    setClipboardFragment,
  } = usePdfEditorStore();

  // ── File open handler (PDF или изображения JPEG/PNG/WebP → PDF)
  const { toast } = useToast();

  const openImagesAsPdf = (images: File[]) => {
    convertAndOpenImages(images)
      .then((res) => {
        toast({
          title: res.appended
            ? 'Изображения добавлены в документ'
            : 'Изображения преобразованы в PDF',
          description: res.appended
            ? `Страницы с ${res.firstPage}-й · слой истории создан — отменить через Ctrl+Z`
            : `Создан новый PDF: ${res.pageCount} ${res.pageCount === 1 ? 'страница' : 'стр.'} из изображений`,
        });
      })
      .catch((err) => {
        toast({
          variant: 'destructive',
          title: 'Не удалось преобразовать изображения',
          description: String(err?.message || err),
        });
      });
  };

  const handleFileOpen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (images.length > 0) {
      openImagesAsPdf(images);
      return;
    }
    const file = files[0];
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const buffer = ev.target?.result as ArrayBuffer;
      await usePdfEditorStore.getState().loadPdf(buffer, file.name);
    };
    reader.readAsArrayBuffer(file);
  };

  // ── Secondary source open handler
  const handleSecondaryOpen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const buffer = ev.target?.result as ArrayBuffer;
      await usePdfEditorStore.getState().openSecondaryPdf(buffer, file.name);
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  // ── Fine rotation (±1°) with warning
  const handleFineRotate = useCallback((deg: number) => {
    const currentRot = pageRotations[currentPage] || 0;
    const newRot = ((currentRot + deg) % 360 + 360) % 360;
    if (newRot % 90 !== 0) {
      const confirmed = confirm(
        '⚠️ Растровый поворот\n\n' +
        'Поворот на ' + deg + '° (итого ' + newRot + '°) преобразует страницу в изображение при сохранении.\n' +
        'Текст станет нередактируемым.\n\n' +
        'Продолжить?'
      );
      if (!confirmed) return;
    }
    rotatePage(deg);
  }, [currentPage, pageRotations, rotatePage]);

  // ── Save
  const handleSave = () => {
    window.dispatchEvent(new CustomEvent('pdf-save'));
  };

  // ── Compress with DPI
  const handleCompress = (dpi: number) => {
    window.dispatchEvent(new CustomEvent('pdf-compress', { detail: { dpi } }));
  };

  // ── Export as image
  const handleExportImage = (format: 'png' | 'jpg') => {
    window.dispatchEvent(new CustomEvent('pdf-export-image', { detail: { format } }));
  };

  // ── Export Word
  const handleExportWord = () => {
    window.dispatchEvent(new CustomEvent('pdf-export-word'));
  };

  // ── Export Excel
  const handleExportExcel = () => {
    window.dispatchEvent(new CustomEvent('pdf-export-excel'));
  };

  // ── Delete blank pages
  const handleDeleteBlankPages = () => {
    window.dispatchEvent(new CustomEvent('pdf-auto-delete-blank'));
  };

  // ── Crop to selection
  const handleCropToSelection = () => {
    window.dispatchEvent(new CustomEvent('pdf-crop-to-selection'));
  };

  // ── Auto-correct
  const handleAutoCorrect = () => {
    window.dispatchEvent(new CustomEvent('pdf-autocorrect'));
  };

  // ── Select all / clear
  const allSelected = pageSelections.length === totalPages && totalPages > 0;
  const handleSelectToggle = () => {
    if (allSelected) {
      clearPageSelections();
    } else {
      selectAllPages();
    }
  };

  // ── Delete selected pages
  const handleDeleteSelected = () => {
    if (pageSelections.length === 0) return;
    const confirmed = confirm(`Удалить ${pageSelections.length} выбранных страниц?`);
    if (!confirmed) return;
    deletePages(pageSelections);
  };

  // ── Extract selected pages
  const handleExtractSelected = () => {
    if (pageSelections.length === 0) return;
    extractPages(pageSelections);
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="border-b border-slate-200/80 bg-white/95 backdrop-blur-sm">
        <div className="flex items-center gap-0.5 px-2 py-1.5 flex-wrap">

          {/* ── 1. File ops ──────────────────────────────────────── */}
          <ToolButton
            icon={<FolderOpen className="w-3.5 h-3.5" />}
            label="Открыть PDF или изображение (JPEG / PNG → PDF)"
            colorGroup="file"
            onClick={() => fileInputRef.current?.click()}
          />
          <ToolButton
            icon={<Undo2 className="w-3.5 h-3.5" />}
            label="Отменить — последний слой (Ctrl+Z)"
            colorGroup="file"
            onClick={undo}
            disabled={!canUndo}
          />
          <ToolButton
            icon={<Redo2 className="w-3.5 h-3.5" />}
            label="Вернуть отменённое (Ctrl+Y)"
            colorGroup="file"
            onClick={redo}
            disabled={!canRedo}
          />
          <HistoryPanel />
          <ToolButton
            icon={<Save className="w-3.5 h-3.5" />}
            label="Сохранить — вшить все слои в PDF (Ctrl+S)"
            colorGroup="file"
            onClick={handleSave}
            disabled={!pdfFile}
          />
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                disabled={!pdfFile}
                title="Сжать PDF (DPI)"
                aria-label="Сжать PDF (DPI)"
                className={[
                  'inline-flex items-center justify-center w-8 h-8 rounded-lg',
                  'ring-1 ring-black/[0.04] shadow-[0_1px_2px_rgba(0,0,0,0.04)]',
                  GROUP_COLORS.file.bg,
                  GROUP_COLORS.file.hoverBg,
                  GROUP_COLORS.file.text,
                  'transition-all duration-150',
                  'hover:scale-[1.02] hover:shadow-[0_2px_4px_rgba(0,0,0,0.08)]',
                  'disabled:opacity-30 disabled:cursor-not-allowed',
                ].join(' ')}
              >
                <ImageDown className="w-3.5 h-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-44 p-2" side="bottom">
              <div className="space-y-1">
                <Label className="text-xs text-slate-500 px-1">DPI сжатия</Label>
                {[150, 200, 300].map((dpi) => (
                  <button
                    key={dpi}
                    type="button"
                    onClick={() => handleCompress(dpi)}
                    className={[
                      'w-full text-left px-3 py-1.5 rounded-md text-xs',
                      'hover:bg-emerald-50 hover:text-emerald-700 transition-colors',
                    ].join(' ')}
                  >
                    {dpi} DPI {dpi === 150 ? '(низкое)' : dpi === 200 ? '(среднее)' : '(высокое)'}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          <Separator orientation="vertical" className="h-6 mx-1" />

          {/* ── 3. Rotation ──────────────────────────────────────── */}
          <ToolButton
            icon={<RotateCcw className="w-3.5 h-3.5" />}
            label="−90°"
            colorGroup="rotate"
            onClick={() => rotatePage(-90)}
            disabled={!pdfFile}
          />
          <ToolButton
            icon={<RotateCw className="w-3.5 h-3.5" />}
            label="+90°"
            colorGroup="rotate"
            onClick={() => rotatePage(90)}
            disabled={!pdfFile}
          />
          <ToolButton
            icon={<RotateCcw className="w-3.5 h-3.5" />}
            label="−1° выровнять скан"
            colorGroup="rotate"
            onClick={() => handleFineRotate(-1)}
            disabled={!pdfFile}
          />
          <ToolButton
            icon={<RotateCw className="w-3.5 h-3.5" />}
            label="+1° выровнять скан"
            colorGroup="rotate"
            onClick={() => handleFineRotate(1)}
            disabled={!pdfFile}
          />

          <Separator orientation="vertical" className="h-6 mx-1" />

          {/* ── 5. Tools ─────────────────────────────────────────── */}
          <ToolButton
            icon={<Type className="w-3.5 h-3.5" />}
            label="Текст (T)"
            colorGroup="tool"
            active={activeTool === 'text'}
            onClick={() => setActiveTool('text')}
          />
          <ToolButton
            icon={<Pipette className="w-3.5 h-3.5" />}
            label="Пипетка (I)"
            colorGroup="tool"
            active={activeTool === 'eyedropper'}
            onClick={() => setActiveTool('eyedropper')}
          />
          <ToolButton
            icon={<BoxSelect className="w-3.5 h-3.5" />}
            label="Выделить фрагмент (S)"
            colorGroup="tool"
            active={activeTool === 'crop'}
            onClick={() => setActiveTool('crop')}
          />
          <ToolButton
            icon={<Eraser className="w-3.5 h-3.5" />}
            label="Ластик (E)"
            colorGroup="tool"
            active={activeTool === 'eraser'}
            onClick={() => setActiveTool('eraser')}
          />
          <ToolButton
            icon={<Pen className="w-3.5 h-3.5" />}
            label="Перо (P)"
            colorGroup="tool"
            active={activeTool === 'pen'}
            onClick={() => setActiveTool('pen')}
          />
          <ToolButton
            icon={<Highlighter className="w-3.5 h-3.5" />}
            label="Выделение (H)"
            colorGroup="tool"
            active={activeTool === 'highlight'}
            onClick={() => setActiveTool('highlight')}
          />
          <ToolButton
            icon={<Underline className="w-3.5 h-3.5" />}
            label="Подчёркивание"
            colorGroup="tool"
            active={activeTool === 'underline'}
            onClick={() => setActiveTool('underline')}
          />
          <ToolButton
            icon={<StickyNote className="w-3.5 h-3.5" />}
            label="Заметка (N)"
            colorGroup="tool"
            active={activeTool === 'sticky'}
            onClick={() => setActiveTool('sticky')}
          />
          <ToolButton
            icon={<ClipboardPaste className="w-3.5 h-3.5" />}
            label="Вставить (V)"
            colorGroup="tool"
            active={activeTool === 'paste'}
            onClick={() => setActiveTool('paste')}
          />
          <ToolButton
            icon={<Copy className="w-3.5 h-3.5" />}
            label="Копировать (Ctrl+C)"
            colorGroup="tool"
            onClick={copyFragment}
            disabled={!selectedFragment}
          />

          <Separator orientation="vertical" className="h-6 mx-1" />

          {/* ── 7. Page management ────────────────────────────────── */}
          <ToolButton
            icon={allSelected ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
            label={allSelected ? 'Снять выделение' : 'Выделить все'}
            colorGroup="page"
            active={allSelected}
            onClick={handleSelectToggle}
          />
          <ToolButton
            icon={<Trash2 className="w-3.5 h-3.5" />}
            label="Удалить страницы"
            colorGroup="page"
            variant="destructive"
            onClick={handleDeleteSelected}
            disabled={pageSelections.length === 0}
          />
          <ToolButton
            icon={<FileOutput className="w-3.5 h-3.5" />}
            label="Извлечь страницы"
            colorGroup="page"
            onClick={handleExtractSelected}
            disabled={pageSelections.length === 0}
          />
          <ToolButton
            icon={<Crop className="w-3.5 h-3.5" />}
            label="Обрезать до выделения"
            colorGroup="page"
            onClick={handleCropToSelection}
            disabled={!selectedFragment}
          />
          <ToolButton
            icon={<FileX2 className="w-3.5 h-3.5" />}
            label="Удалить пустых страниц"
            colorGroup="page"
            onClick={handleDeleteBlankPages}
            disabled={!pdfFile}
          />

          <Separator orientation="vertical" className="h-6 mx-1" />

          {/* ── 9. Text settings ─────────────────────────────────── */}
          <Select value={currentFont} onValueChange={setFont}>
            <SelectTrigger className="h-7 w-[130px] text-xs border-slate-200 bg-slate-50/50 rounded-lg">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FONT_LIST.map((f) => (
                <SelectItem key={f} value={f} className="text-xs">
                  {f}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center justify-center w-7 h-7 rounded-lg ring-1 ring-black/[0.04] shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-all hover:scale-[1.02]"
                title="Цвет текста"
              >
                <div
                  className="w-4 h-4 rounded border border-slate-200"
                  style={{ backgroundColor: currentTextColor }}
                />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-48 p-3" side="bottom">
              <Label className="text-xs text-slate-500 mb-2 block">Цвет текста</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={currentTextColor}
                  onChange={(e) => setTextColor(e.target.value)}
                  className="w-8 h-8 rounded cursor-pointer border-0"
                />
                <Input
                  value={currentTextColor}
                  onChange={(e) => setTextColor(e.target.value)}
                  className="h-7 text-xs font-mono"
                />
              </div>
            </PopoverContent>
          </Popover>

          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={[
                  'inline-flex items-center justify-center h-7 px-2 rounded-lg',
                  'ring-1 ring-black/[0.04] shadow-[0_1px_2px_rgba(0,0,0,0.04)]',
                  'bg-slate-50/50 hover:bg-slate-100 text-slate-600',
                  'transition-all hover:scale-[1.02] text-xs',
                ].join(' ')}
              >
                {currentFontSize}pt
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-48 p-3" side="bottom">
              <Label className="text-xs text-slate-500 mb-2 block">Размер шрифта</Label>
              <Input
                type="number"
                min={6}
                max={72}
                value={currentFontSize}
                onChange={(e) => {
                  const v = parseInt(e.target.value);
                  if (!isNaN(v) && v >= 6 && v <= 72) setFontSize(v);
                }}
                className="h-7 text-xs"
              />
              <div className="flex gap-1 mt-2">
                {[10, 12, 14, 16, 18, 20, 24, 28, 32].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setFontSize(s)}
                    className={[
                      'flex-1 py-1 text-[10px] rounded transition-colors',
                      currentFontSize === s
                        ? 'bg-slate-700 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                    ].join(' ')}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          <Separator orientation="vertical" className="h-6 mx-1" />

          {/* ── 11. Adjustments ──────────────────────────────────── */}
          <ToolButton
            icon={<SunMedium className="w-3.5 h-3.5" />}
            label="Автокоррекция"
            colorGroup="adjust"
            onClick={handleAutoCorrect}
            disabled={!pdfFile}
          />
          <ManualAdjustPopover />

          <Separator orientation="vertical" className="h-6 mx-1" />

          {/* ── 13. Zoom ─────────────────────────────────────────── */}
          <ToolButton
            icon={<ZoomOut className="w-3.5 h-3.5" />}
            label="Уменьшить"
            colorGroup="zoom"
            onClick={() => setZoomLevel(zoomLevel - 0.15)}
          />
          <span className="text-xs text-slate-500 w-10 text-center font-medium tabular-nums">
            {Math.round(zoomLevel * 100)}%
          </span>
          <ToolButton
            icon={<ZoomIn className="w-3.5 h-3.5" />}
            label="Увеличить"
            colorGroup="zoom"
            onClick={() => setZoomLevel(zoomLevel + 0.15)}
          />

          <Separator orientation="vertical" className="h-6 mx-1" />

          {/* ── 15. Search ───────────────────────────────────────── */}
          <SearchBar />

          <Separator orientation="vertical" className="h-6 mx-1" />

          {/* ── 17. Signatures ───────────────────────────────────── */}
          <SignatureTemplatesPopover />

          <Separator orientation="vertical" className="h-6 mx-1" />

          {/* ── 19. Export ───────────────────────────────────────── */}
          <ToolButton
            icon={<Printer className="w-3.5 h-3.5" />}
            label="Печать текущей страницы"
            colorGroup="export"
            onClick={() => window.dispatchEvent(new CustomEvent('pdf-print'))}
            disabled={!pdfFile}
          />
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                disabled={!pdfFile}
                title="Экспорт страниц в изображения (ZIP)"
                aria-label="Экспорт страниц в изображения (ZIP)"
                className={[
                  'inline-flex items-center justify-center w-8 h-8 rounded-lg',
                  'ring-1 ring-black/[0.04] shadow-[0_1px_2px_rgba(0,0,0,0.04)]',
                  GROUP_COLORS.export.bg,
                  GROUP_COLORS.export.hoverBg,
                  GROUP_COLORS.export.text,
                  'transition-all duration-150',
                  'hover:scale-[1.02] hover:shadow-[0_2px_4px_rgba(0,0,0,0.08)]',
                  'disabled:opacity-30 disabled:cursor-not-allowed',
                ].join(' ')}
              >
                <FileImage className="w-3.5 h-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-44 p-2" side="bottom">
              <div className="space-y-1">
                <Label className="text-xs text-slate-500 px-1">Формат</Label>
                <button
                  type="button"
                  onClick={() => handleExportImage('png')}
                  className="w-full text-left px-3 py-1.5 rounded-md text-xs hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
                >
                  PNG
                </button>
                <button
                  type="button"
                  onClick={() => handleExportImage('jpg')}
                  className="w-full text-left px-3 py-1.5 rounded-md text-xs hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
                >
                  JPG
                </button>
              </div>
            </PopoverContent>
          </Popover>
          <ToolButton
            icon={<FileDown className="w-3.5 h-3.5" />}
            label="Экспорт текста в Word (.docx)"
            colorGroup="export"
            onClick={handleExportWord}
            disabled={!pdfFile}
          />
          <ToolButton
            icon={<FileSpreadsheet className="w-3.5 h-3.5" />}
            label="Экспорт текста в Excel (.xlsx)"
            colorGroup="export"
            onClick={handleExportExcel}
            disabled={!pdfFile}
          />

          {/* ── 20. Spacer ────────────────────────────────────────── */}
          <div className="flex-1" />

          {/* ── 21. Source PDF button ──────────────────────────────── */}
          {pdfFile && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs border-emerald-300 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 gap-1.5 rounded-lg"
              onClick={() => secondaryInputRef.current?.click()}
            >
              <FileText className="w-3.5 h-3.5" />
              Источник фрагмента
            </Button>
          )}

          {/* ── Hidden file inputs ────────────────────────────────── */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf,image/jpeg,image/jpg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={handleFileOpen}
          />
          <input
            ref={secondaryInputRef}
            type="file"
            accept=".pdf,application/pdf"
            className="hidden"
            onChange={handleSecondaryOpen}
          />
        </div>
      </div>
    </TooltipProvider>
  );
}
