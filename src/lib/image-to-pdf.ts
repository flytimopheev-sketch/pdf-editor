"use client";

/**
 * Конвертация изображений (JPEG / PNG / WebP) в страницы PDF.
 *
 * Логика:
 *  - каждое изображение -> JPEG через canvas (заодно применяется EXIF-поворот
 *    и заливается белый фон вместо прозрачности PNG);
 *  - страница A4 (альбомная для горизонтальных изображений), изображение
 *    вписывается целиком по центру;
 *  - если документ уже открыт — страницы ДОБАВЛЯЮТСЯ в конец (это отдельный
 *    слой истории, отменяется через Ctrl+Z);
 *  - если документа нет — создаётся новый PDF из изображений.
 */

import { PDFDocument } from "pdf-lib";
import { usePdfEditorStore } from "@/lib/pdf-store";

const MAX_DIM = 4096; // защита от огромных фото — не больше 4096px по стороне
const JPEG_QUALITY = 0.92;

const A4_W = 595.28;
const A4_H = 841.89;

async function fileToJpegBytes(file: File): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error(`Не удалось прочитать файл «${file.name}»`));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error(`Не удалось открыть изображение «${file.name}»`));
    im.src = dataUrl;
  });

  const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas недоступен в этом браузере");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  const jpegUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  const base64 = jpegUrl.split(",")[1] || "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes, width: w, height: h };
}

export interface ImageToPdfResult {
  /** true — страницы добавлены в открытый документ; false — создан новый PDF */
  appended: boolean;
  /** сколько изображений стало страницами */
  pageCount: number;
  /** номер первой новой страницы (для appended) */
  firstPage: number;
}

/**
 * Главная функция: открывает изображения как PDF.
 * Вызывается из тулбара («Открыть») и из drop-зоны на пустом экране.
 */
export async function convertAndOpenImages(files: File[]): Promise<ImageToPdfResult> {
  if (!files.length) throw new Error("Файлы не выбраны");

  const store = usePdfEditorStore.getState();
  store.setIsProcessing(true);
  try {
    const existing = store.pdfFile ? new Uint8Array(store.pdfFile) : null;
    const doc = existing ? await PDFDocument.load(existing) : await PDFDocument.create();
    const existingPages = existing ? doc.getPageCount() : 0;

    for (const file of files) {
      const { bytes, width, height } = await fileToJpegBytes(file);
      const img = await doc.embedJpg(bytes);
      const landscape = width > height;
      const pageW = landscape ? A4_H : A4_W;
      const pageH = landscape ? A4_W : A4_H;
      const page = doc.addPage([pageW, pageH]);
      const scale = Math.min(pageW / width, pageH / height);
      const dw = width * scale;
      const dh = height * scale;
      page.drawImage(img, {
        x: (pageW - dw) / 2,
        y: (pageH - dh) / 2,
        width: dw,
        height: dh,
      });
    }

    const saved = await doc.save();
    const out = new Uint8Array(saved);

    if (existing) {
      const firstPage = existingPages + 1;
      await usePdfEditorStore.getState().appendImagesAsPages(out, files.length, firstPage);
      return { appended: true, pageCount: files.length, firstPage };
    }

    // Новый документ из изображений
    const base = (files[0]?.name || "изображение").replace(/\.[^.]+$/, "");
    const fileName = `${base || "документ"}.pdf`;
    const copy = new Uint8Array(out);
    await usePdfEditorStore.getState().loadPdf(
      copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength) as ArrayBuffer,
      fileName,
    );
    return { appended: false, pageCount: files.length, firstPage: 1 };
  } finally {
    usePdfEditorStore.getState().setIsProcessing(false);
  }
}

/** Проверка: файл является поддерживаемым изображением? */
export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}
