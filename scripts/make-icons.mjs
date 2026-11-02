/**
 * Icon processor: crops the app tile from the generated artwork,
 * applies rounded corners with transparency and emits the full
 * hicolor icon set + app icons used by the UI and Electron.
 *
 * Usage: bun scripts/make-icons.mjs <input.png>
 */
import sharp from "sharp";
import fs from "fs";
import path from "path";

const input = process.argv[2] || "/tmp/icon-raw.png";
const pubDir = "public";
const hicolorBase = path.join(pubDir, "icons");

async function detectTileBounds(img) {
  // Downscale for fast pixel scan
  const small = await img.clone().resize(256, 256, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  const { data, info } = small;
  const { width: W, height: H, channels: C } = info;
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * C;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      // ignore near-white bg and light gray shadow halo — keep only colored tile pixels
      const isNearWhite = r > 235 && g > 235 && b > 235;
      const isGrayishShadow = Math.abs(r - g) < 12 && Math.abs(g - b) < 12 && r > 190;
      if (!isNearWhite && !isGrayishShadow) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  // scale back to original resolution
  const full = await img.metadata();
  const sx = full.width / W, sy = full.height / H;
  const left = Math.max(0, Math.floor(minX * sx) - 2);
  const top = Math.max(0, Math.floor(minY * sy) - 2);
  return {
    left,
    top,
    width: Math.min(full.width - left, Math.ceil((maxX - minX + 1) * sx) + 4),
    height: Math.min(full.height - top, Math.ceil((maxY - minY + 1) * sy) + 4),
  };
}

function roundedMask(size, radiusPct) {
  const r = Math.round(size * radiusPct);
  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="0" width="${size}" height="${size}" rx="${r}" ry="${r}" fill="#fff"/>
  </svg>`;
  return Buffer.from(svg);
}

async function main() {
  const img = sharp(input);
  const meta = await img.metadata();
  console.log(`Input: ${meta.width}x${meta.height}`);

  const bounds = await detectTileBounds(img);
  if (!bounds) {
    console.error("Could not detect tile bounds");
    process.exit(1);
  }
  console.log("Tile bounds:", bounds);

  // Master: square crop of the tile at 1024
  const master = await img
    .clone()
    .extract(bounds)
    .resize(1024, 1024, { fit: "cover", position: "center" })
    .png()
    .toBuffer();

  const radiusPct = 0.225; // modern squircle look

  // ── Public app icons (used in UI, Electron window icon, .desktop) ──
  const targets = [
    { file: "app-icon.png", size: 512 },
    { file: "logo-new2.png", size: 512 },
    { file: "pdf-editor-icon.png", size: 256 },
    { file: "icon-512.png", size: 512 },
    { file: "icon-256.png", size: 256 },
    { file: "icon-128.png", size: 128 },
    { file: "icon-64.png", size: 64 },
    { file: "icon-48.png", size: 48 },
    { file: "icon-32.png", size: 32 },
    { file: "icon-16.png", size: 16 },
  ];
  for (const t of targets) {
    await sharp(master)
      .resize(t.size, t.size, { fit: "cover" })
      .composite([{ input: roundedMask(t.size, radiusPct), blend: "dest-in" }])
      .png()
      .toFile(path.join(pubDir, t.file));
    console.log(`✓ public/${t.file} (${t.size}×${t.size})`);
  }

  // ── Full square (no rounded corners) master for electron window icon ──
  await sharp(master).resize(512, 512, { fit: "cover" }).png().toFile(path.join(pubDir, "app-icon-square.png"));
  console.log("✓ public/app-icon-square.png (512×512, без скругления)");

  // ── hicolor set for Linux (РЕД ОС) ──
  const sizes = [16, 24, 32, 48, 64, 128, 256, 512];
  for (const s of sizes) {
    const dir = path.join(hicolorBase, `${s}x${s}`, "apps");
    fs.mkdirSync(dir, { recursive: true });
    await sharp(master)
      .resize(s, s, { fit: "cover" })
      .composite([{ input: roundedMask(s, radiusPct), blend: "dest-in" }])
      .png()
      .toFile(path.join(dir, "pdf-editor.png"));
    console.log(`✓ icons/${s}x${s}/apps/pdf-editor.png`);
  }

  // ── pixmap fallback ──
  const pixDir = path.join(hicolorBase, "pixmap");
  fs.mkdirSync(pixDir, { recursive: true });
  await sharp(master).resize(128, 128, { fit: "cover" })
    .composite([{ input: roundedMask(128, radiusPct), blend: "dest-in" }])
    .png()
    .toFile(path.join(pixDir, "pdf-editor.png"));
  console.log("✓ icons/pixmap/pdf-editor.png");

  console.log("Done!");
}

main().catch((e) => { console.error(e); process.exit(1); });
