/**
 * Клиентская часть OCR: рендер страниц PDF в изображения и вызов
 * серверного API /api/ocr. Результаты приводятся к системе координат
 * PDF-страницы (y — от нижнего края, единицы PDF при scale=1) —
 * той же, что использует pdfjs getTextContent, поэтому поиск и
 * подсветка работают одинаково для текстового слоя и для OCR.
 */

import type { OcrWordItem } from "./pdf-store";

/** Рендер страницы в JPEG (rotation 0 — базовая система координат документа) */
export async function renderPageForOcr(
  pdfJsDoc: { getPage: (n: number) => Promise<any> },
  pageNum: number,
  ocrScale = 2,
): Promise<{ dataUrl: string; pageW: number; pageH: number; scale: number }> {
  const page = await pdfJsDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale: ocrScale, rotation: 0 });

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Не удалось создать canvas для OCR");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;

  const origViewport = page.getViewport({ scale: 1, rotation: 0 });

  return {
    dataUrl: canvas.toDataURL("image/jpeg", 0.9),
    pageW: origViewport.width,
    pageH: origViewport.height,
    scale: ocrScale,
  };
}

interface OcrApiResponse {
  words?: Array<{ text: string; x0: number; y0: number; x1: number; y1: number; confidence: number }>;
  error?: string;
}

/** Распознать одну страницу через серверный API */
export async function ocrPage(
  pdfJsDoc: { getPage: (n: number) => Promise<any> },
  pageNum: number,
): Promise<OcrWordItem[]> {
  const { dataUrl, pageH, scale } = await renderPageForOcr(pdfJsDoc, pageNum);

  const res = await fetch("/api/ocr", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: dataUrl }),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as OcrApiResponse;
    throw new Error(body.error || `Ошибка OCR (HTTP ${res.status})`);
  }

  const data = (await res.json()) as OcrApiResponse;

  // Пиксели изображения → единицы PDF (y от нижнего края, как у pdfjs)
  return (data.words ?? []).map((w) => ({
    text: w.text,
    x: w.x0 / scale,
    y: pageH - w.y1 / scale,
    width: (w.x1 - w.x0) / scale,
    height: (w.y1 - w.y0) / scale,
  }));
}
