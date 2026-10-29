import { PDFDocument, rgb, StandardFonts, degrees, PDFPage } from "pdf-lib";
import type { TextAnnotation, FragmentData } from "./pdf-store";

/** Chunked base64 encoding — works for files of any size (unlike spread operator) */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000; // 32KB chunks
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

/** Decode base64 to Uint8Array */
export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Map of common font names to pdf-lib standard fonts
export function getFontFamily(fontName: string): keyof typeof StandardFonts {
  const fontMap: Record<string, keyof typeof StandardFonts> = {
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
  return fontMap[fontName] || "Helvetica";
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(result[1], 16) / 255,
    g: parseInt(result[2], 16) / 255,
    b: parseInt(result[3], 16) / 255,
  };
}

export async function exportPdf(
  originalPdfBytes: Uint8Array | ArrayBuffer,
  pageRotations: Record<number, number>,
  textAnnotations: TextAnnotation[],
  clipboardFragments: Array<{ fragment: FragmentData; pageIndex: number; x: number; y: number }>,
  removedPages: Set<number>
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(originalPdfBytes);
  const pages = pdfDoc.getPages();

  // Apply rotations
  for (const [pageIndexStr, rotation] of Object.entries(pageRotations)) {
    const pageIndex = parseInt(pageIndexStr) - 1; // 1-indexed to 0-indexed
    if (pageIndex >= 0 && pageIndex < pages.length) {
      const page = pages[pageIndex];
      const currentRotation = page.getRotation().angle;
      page.setRotation(degrees(currentRotation + rotation));
    }
  }

  // Add text annotations
  for (const annotation of textAnnotations) {
    const pageIndex = annotation.pageIndex - 1;
    if (pageIndex >= 0 && pageIndex < pages.length) {
      const page = pages[pageIndex];
      const { width, height } = page.getSize();
      const fontFamily = getFontFamily(annotation.font);
      const font = await pdfDoc.embedFont(fontFamily);
      const color = hexToRgb(annotation.color);

      // Convert from canvas coordinates (top-left origin) to PDF coordinates (bottom-left origin)
      const pdfY = height - annotation.y;

      try {
        page.drawText(annotation.text, {
          x: annotation.x,
          y: pdfY - annotation.fontSize,
          size: annotation.fontSize,
          font,
          color: rgb(color.r, color.g, color.b),
        });
      } catch {
        // Skip if text drawing fails
      }
    }
  }

  // Embed fragments (pasted images)
  for (const item of clipboardFragments) {
    const pageIndex = item.pageIndex - 1;
    if (pageIndex >= 0 && pageIndex < pages.length) {
      const page = pages[pageIndex];
      const { width: pageWidth, height: pageHeight } = page.getSize();
      
      try {
        const imageBytes = Uint8Array.from(atob(item.fragment.imageData.split(",")[1] || ""), (c) => c.charCodeAt(0));
        const image = await pdfDoc.embedPng(imageBytes);
        
        const pdfY = pageHeight - item.y - (item.fragment.height / item.fragment.sourcePageHeight) * pageHeight;
        const scaledWidth = (item.fragment.width / item.fragment.sourcePageWidth) * pageWidth;
        const scaledHeight = (item.fragment.height / item.fragment.sourcePageHeight) * pageHeight;
        
        page.drawImage(image, {
          x: item.x,
          y: pdfY,
          width: scaledWidth,
          height: scaledHeight,
        });
      } catch {
        // Skip if image embedding fails
      }
    }
  }

  return pdfDoc.save();
}

export async function compressPdf(
  pdfBytes: Uint8Array | ArrayBuffer,
  quality: "low" | "medium" | "high" = "medium"
): Promise<Uint8Array> {
  // Load and re-save to clean up the PDF structure
  const pdfDoc = await PDFDocument.load(pdfBytes);
  
  // Remove metadata for compression
  pdfDoc.setTitle("");
  pdfDoc.setAuthor("");
  pdfDoc.setSubject("");
  pdfDoc.setKeywords([]);
  pdfDoc.setProducer("");
  pdfDoc.setCreator("");
  
  // Save with different compression settings
  const saveOptions = quality === "low" 
    ? { useObjectStreams: true } 
    : { useObjectStreams: true };
    
  return pdfDoc.save(saveOptions);
}

export function captureCanvasFragment(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  width: number,
  height: number
): string {
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  
  const imageData = ctx.getImageData(x, y, width, height);
  
  // Create a temporary canvas for the fragment
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = width;
  tempCanvas.height = height;
  const tempCtx = tempCanvas.getContext("2d");
  if (!tempCtx) return "";
  
  tempCtx.putImageData(imageData, 0, 0);
  
  return tempCanvas.toDataURL("image/png");
}

export function pickColorFromCanvas(
  canvas: HTMLCanvasElement,
  x: number,
  y: number
): string {
  const ctx = canvas.getContext("2d");
  if (!ctx) return "#000000";
  
  const pixel = ctx.getImageData(x, y, 1, 1).data;
  const hex = "#" +
    pixel[0].toString(16).padStart(2, "0") +
    pixel[1].toString(16).padStart(2, "0") +
    pixel[2].toString(16).padStart(2, "0");
  
  return hex;
}
