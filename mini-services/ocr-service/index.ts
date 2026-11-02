/**
 * OCR mini-service (порт 3011)
 *
 * Отдельный процесс для распознавания текста (rus + eng) через tesseract.js.
 * Запускается отдельно от Next.js — tesseract.js в одном процессе с Next
 * работает некорректно (воркер-поток tesseract внутри next dev возвращает
 * пустой результат), поэтому вынесено в независимый сервис.
 *
 * POST /ocr  { image: dataURL }
 *   → { words: [{ text, x0, y0, x1, y1, confidence }], text }
 *
 * Языковые модели лежат в <project>/ocr-data (rus.traineddata, eng.traineddata)
 * — работает полностью офлайн.
 */

import path from "path";
import { createWorker, type Worker } from "tesseract.js";

const PORT = 3011;
const LANG_DIR = path.resolve(import.meta.dir, "..", "..", "ocr-data");

interface OcrWordBox {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  confidence: number;
}

let workerPromise: Promise<Worker> | null = null;

function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker(["rus", "eng"], 1, {
      langPath: LANG_DIR,
      cachePath: LANG_DIR,
      gzip: false,
      logger: () => {},
    });
  }
  return workerPromise;
}

// Воркер создаётся сразу при старте — до Bun.serve,
// чтобы tesseract.js инициализировался в «чистом» контексте
const warmup = getWorker()
  .then(() => console.log("[ocr-service] tesseract-воркер готов"))
  .catch((e) => console.error("[ocr-service] ошибка инициализации tesseract:", e));

async function recognizeDataUrl(dataUrl: string): Promise<{ words: OcrWordBox[]; text: string }> {
  await warmup;
  const worker = await getWorker();
  const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  console.log("[ocr-service] recognize: bytes=", bytes.length);

  const { data } = await worker.recognize(bytes);
  const d = data as unknown as Record<string, unknown>;

  const words: OcrWordBox[] = [];

  // tesseract.js v5: блоки → параграфы → строки → слова
  const blocks = (d.blocks as Array<Record<string, unknown>>) ?? [];
  for (const block of blocks) {
    for (const par of (block.paragraphs as Array<Record<string, unknown>>) ?? []) {
      for (const line of (par.lines as Array<Record<string, unknown>>) ?? []) {
        for (const w of (line.words as Array<Record<string, unknown>>) ?? []) {
          const text = String(w.text ?? "");
          if (!text.trim()) continue;
          const bbox = w.bbox as { x0: number; y0: number; x1: number; y1: number } | undefined;
          if (!bbox) continue;
          words.push({
            text,
            x0: bbox.x0,
            y0: bbox.y0,
            x1: bbox.x1,
            y1: bbox.y1,
            confidence: Number(w.confidence ?? 0),
          });
        }
      }
    }
  }

  // Fallback: плоский массив слов (старая форма результата)
  if (words.length === 0) {
    const flat = (d.words as Array<{ text?: string; bbox?: { x0: number; y0: number; x1: number; y1: number }; confidence?: number }>) ?? [];
    for (const w of flat) {
      const text = String(w.text ?? "");
      if (!text.trim() || !w.bbox) continue;
      words.push({
        text,
        x0: w.bbox.x0,
        y0: w.bbox.y0,
        x1: w.bbox.x1,
        y1: w.bbox.y1,
        confidence: Number(w.confidence ?? 0),
      });
    }
  }

  return { words, text: String(d.text ?? "") };
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "GET") {
      return new Response(`OCR service is running on :${PORT}`);
    }

    if (req.method === "POST" && url.pathname === "/ocr") {
      try {
        const body = await req.json();
        const image = body?.image;
        if (typeof image !== "string" || !image.startsWith("data:image/")) {
          return Response.json({ error: "Ожидается dataURL изображения в поле image" }, { status: 400 });
        }
        const result = await recognizeDataUrl(image);
        return Response.json(result);
      } catch (err) {
        console.error("[ocr-service] ошибка распознавания:", err);
        return Response.json(
          { error: "Ошибка распознавания: " + String(err instanceof Error ? err.message : err) },
          { status: 500 },
        );
      }
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
});

console.log(`[ocr-service] запущен на порту ${PORT}, языки: rus+eng, модели: ${LANG_DIR}`);
