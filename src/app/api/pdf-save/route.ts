import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, rgb, StandardFonts, degrees } from "pdf-lib";

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

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { pdfData, pageRotations, textAnnotations } = body;

    const pdfBytes = base64ToUint8Array(pdfData);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pages = pdfDoc.getPages();

    // Применить вращения
    for (const [pageIndexStr, rotation] of Object.entries(pageRotations || {}) as Array<[string, number]>) {
      const pageIndex = parseInt(pageIndexStr) - 1;
      if (pageIndex >= 0 && pageIndex < pages.length) {
        const page = pages[pageIndex];
        const curRot = page.getRotation().angle;
        page.setRotation(degrees(curRot + rotation));
      }
    }

    // Добавить текстовые аннотации
    for (const a of textAnnotations || []) {
      const pageIndex = a.pageIndex - 1;
      if (pageIndex >= 0 && pageIndex < pages.length) {
        const page = pages[pageIndex];
        const { height } = page.getSize();
        const fontKey = (FONT_MAP[a.font] || "Helvetica") as keyof typeof StandardFonts;
        const font = await pdfDoc.embedFont(fontKey);
        const color = hexToRgb(a.color);
        try {
          page.drawText(a.text, {
            x: a.x,
            y: height - a.y - a.fontSize,
            size: a.fontSize,
            font,
            color: rgb(color.r, color.g, color.b),
          });
        } catch { /* пропустить */ }
      }
    }

    const saved = await pdfDoc.save();
    const base64 = uint8ArrayToBase64(new Uint8Array(saved));

    return NextResponse.json({ pdfData: base64 });
  } catch (err) {
    console.error("Ошибка сохранения:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
