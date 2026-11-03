/**
 * OCR-сервис для настольной сборки (Node.js, порт 3011).
 *
 * Аналог mini-services/ocr-service (bun), но на чистом Node http —
 * запускается из electron/main.js через ELECTRON_RUN_AS_NODE,
 * поэтому в системе не требуется ни bun, ни node.
 *
 * POST /ocr  { image: dataURL }
 *   → { words: [{ text, x0, y0, x1, y1, confidence }], text }
 *
 * Языковые модели: <APP_DIR>/app/ocr-data (rus + eng), полностью офлайн.
 */

const http = require("http");
const path = require("path");
const fs = require("fs");

const PORT = Number(process.env.OCR_PORT || 3011);
const LANG_DIR = process.env.OCR_LANG_DIR ||
  path.resolve(__dirname, "ocr-data");

let workerPromise = null;

function getWorker() {
  if (!workerPromise) {
    // tesseract.js лежит в app/node_modules — разрешается автоматически
    const { createWorker } = require("tesseract.js");
    workerPromise = createWorker(["rus", "eng"], 1, {
      langPath: LANG_DIR,
      cachePath: LANG_DIR,
      gzip: false,
      logger: () => {},
    });
  }
  return workerPromise;
}

async function recognizeDataUrl(dataUrl) {
  const worker = await getWorker();
  const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
  const bytes = Buffer.from(base64, "base64");
  console.log("[ocr-service] recognize: bytes=", bytes.length);

  const { data } = await worker.recognize(bytes);
  const d = data;

  const words = [];
  const blocks = d.blocks || [];
  for (const block of blocks) {
    for (const par of block.paragraphs || []) {
      for (const line of par.lines || []) {
        for (const w of line.words || []) {
          const text = String(w.text || "");
          if (!text.trim() || !w.bbox) continue;
          words.push({
            text,
            x0: w.bbox.x0,
            y0: w.bbox.y0,
            x1: w.bbox.x1,
            y1: w.bbox.y1,
            confidence: Number(w.confidence || 0),
          });
        }
      }
    }
  }

  // Fallback: плоский массив слов
  if (words.length === 0 && Array.isArray(d.words)) {
    for (const w of d.words) {
      const text = String((w && w.text) || "");
      if (!text.trim() || !w.bbox) continue;
      words.push({
        text,
        x0: w.bbox.x0,
        y0: w.bbox.y0,
        x1: w.bbox.x1,
        y1: w.bbox.y1,
        confidence: Number(w.confidence || 0),
      });
    }
  }

  return { words, text: String(d.text || "") };
}

const server = http.createServer((req, res) => {
  const sendJson = (code, obj) => {
    const body = JSON.stringify(obj);
    res.writeHead(code, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
    });
    res.end(body);
  };

  if (req.method === "GET") {
    sendJson(200, { ok: true, service: "ocr", port: PORT });
    return;
  }

  if (req.method === "POST" && req.url === "/ocr") {
    let chunks = [];
    let size = 0;
    req.on("data", (c) => {
      chunks.push(c);
      size += c.length;
      if (size > 60 * 1024 * 1024) {
        sendJson(413, { error: "Слишком большое изображение" });
        req.destroy();
      }
    });
    req.on("end", async () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const image = body && body.image;
        if (typeof image !== "string" || !image.startsWith("data:image/")) {
          sendJson(400, { error: "Ожидается dataURL изображения в поле image" });
          return;
        }
        const result = await recognizeDataUrl(image);
        sendJson(200, result);
      } catch (err) {
        console.error("[ocr-service] ошибка распознавания:", err);
        sendJson(500, {
          error: "Ошибка распознавания: " + String((err && err.message) || err),
        });
      }
    });
    return;
  }

  sendJson(404, { error: "Not found" });
});

if (!fs.existsSync(path.join(LANG_DIR, "rus.traineddata"))) {
  console.error("[ocr-service] НЕ найдены языковые модели в", LANG_DIR);
}

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[ocr-service] запущен на порту ${PORT}, языки: rus+eng, модели: ${LANG_DIR}`);
  // Прогрев tesseract до первого запроса
  getWorker()
    .then(() => console.log("[ocr-service] tesseract-воркер готов"))
    .catch((e) => console.error("[ocr-service] ошибка инициализации tesseract:", e));
});
