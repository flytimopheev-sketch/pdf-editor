import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, degrees } from "pdf-lib";

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
    const { action, pdfData, pages, pageOrder, pageRotations, fileName } = body;

    if (action === "delete") {
      return handleDelete(pdfData, pages, pageOrder, pageRotations);
    } else if (action === "extract") {
      return handleExtract(pdfData, pages, pageOrder, pageRotations, fileName);
    }

    return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
  } catch (err) {
    console.error("PDF operation error:", err);
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    );
  }
}

async function handleDelete(
  pdfBase64: string,
  pages: number[],
  pageOrder: number[],
  _pageRotations: Record<string, number>
) {
  const pdfBytes = base64ToUint8Array(pdfBase64);
  const srcDoc = await PDFDocument.load(pdfBytes);
  const newDoc = await PDFDocument.create();
  const remove = new Set(pages);

  for (const pp of pageOrder) {
    if (!remove.has(pp)) {
      const [copied] = await newDoc.copyPages(srcDoc, [pp - 1]);
      newDoc.addPage(copied);
    }
  }

  const newBytes = await newDoc.save();
  const base64 = uint8ArrayToBase64(new Uint8Array(newBytes));

  return NextResponse.json({
    pdfData: base64,
    pageCount: newDoc.getPageCount(),
  });
}

async function handleExtract(
  pdfBase64: string,
  pages: number[],
  pageOrder: number[],
  pageRotations: Record<string, number>,
  fileName: string
) {
  const pdfBytes = base64ToUint8Array(pdfBase64);
  const srcDoc = await PDFDocument.load(pdfBytes);
  const newDoc = await PDFDocument.create();
  const extract = new Set(pages);

  let idx = 0;
  for (const pp of pageOrder) {
    if (extract.has(pp)) {
      const [copied] = await newDoc.copyPages(srcDoc, [pp - 1]);
      newDoc.addPage(copied);
      const rot = pageRotations[String(pp)] || 0;
      if (rot !== 0) {
        const page = newDoc.getPages()[idx];
        const curRot = page.getRotation().angle;
        page.setRotation(degrees(curRot + rot));
      }
      idx++;
    }
  }

  const newBytes = await newDoc.save();
  const base64 = uint8ArrayToBase64(new Uint8Array(newBytes));

  return NextResponse.json({
    pdfData: base64,
    fileName: (fileName || "документ").replace(".pdf", "") + "_извлечено.pdf",
    pageCount: newDoc.getPageCount(),
  });
}
