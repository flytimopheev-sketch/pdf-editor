import { NextResponse } from "next/server";
import { readFileSync, statSync } from "fs";
import path from "path";

const FILE_PATH = "/home/z/my-project/public/pdf-editor-redos.tar.gz";
const FILE_NAME = "pdf-master-1.0.0-linux-x86_64.tar.gz";

export async function GET() {
  try {
    const fileBuffer = readFileSync(FILE_PATH);
    const stat = statSync(FILE_PATH);

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="${FILE_NAME}"`,
        "Content-Length": String(stat.size),
        "Cache-Control": "no-cache",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Файл не найден" },
      { status: 404 }
    );
  }
}
