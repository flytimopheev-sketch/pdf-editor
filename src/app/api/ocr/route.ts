import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/ocr — прокси к OCR mini-service (порт 3011).
 *
 * tesseract.js не запускается внутри процесса Next (воркер-поток tesseract
 * рядом с next dev возвращает пустой результат), поэтому распознавание
 * выполняет отдельный сервис mini-services/ocr-service.
 *
 * Body: { image: string } — dataURL изображения страницы (PNG/JPEG)
 * Response: { words: [{ text, x0, y0, x1, y1, confidence }], text }
 */
const OCR_SERVICE_URL = "http://127.0.0.1:3011/ocr";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const image = body?.image;
    if (typeof image !== "string" || !image.startsWith("data:image/")) {
      return NextResponse.json(
        { error: "Ожидается dataURL изображения в поле image" },
        { status: 400 },
      );
    }

    const res = await fetch(OCR_SERVICE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image }),
      signal: AbortSignal.timeout(280_000),
    });

    const data = await res.json().catch(() => ({ error: "Некорректный ответ OCR-сервиса" }));
    if (!res.ok) {
      console.error("[api/ocr] ошибка сервиса:", data);
    }
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    console.error("[api/ocr] OCR-сервис недоступен:", err);
    return NextResponse.json(
      { error: "OCR-сервис недоступен: " + String(err instanceof Error ? err.message : err) },
      { status: 502 },
    );
  }
}
