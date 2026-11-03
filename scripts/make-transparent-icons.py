#!/usr/bin/env python3
"""Генерация иконок pdf-editor из логотипа (честный premultiplied RGBA-ресайз).

Источник: public/logo-new2.png (512x512 RGBA, скругление уже в альфе).
Результат: app-icon-square.png (1024), app-icon.png (512), icon-NN.png,
public/icons/NNxNN/apps/pdf-editor.png, public/icons/pixmap/pdf-editor.png.
"""
from PIL import Image
import numpy as np
import os

BASE = "/home/z/my-project/public"
SRC = os.path.join(BASE, "logo-new2.png")

src = Image.open(SRC).convert("RGBA")
arr = np.asarray(src).astype(np.float64)
alpha = arr[..., 3:4] / 255.0

# Premultiply → resize → unpremultiply (без тёмного ореола на краях)
def resize_rgba(im: Image.Image, size: int) -> Image.Image:
    a = np.asarray(im).astype(np.float64)
    al = a[..., 3:4] / 255.0
    prem = a.copy()
    prem[..., :3] *= al
    pil = Image.fromarray(prem.astype(np.uint8), "RGBA")
    pil = pil.resize((size, size), Image.LANCZOS)
    b = np.asarray(pil).astype(np.float64)
    bl = b[..., 3:4] / 255.0
    with np.errstate(divide="ignore", invalid="ignore"):
        rgb = np.where(bl > 0, b[..., :3] / bl, 0)
    b[..., :3] = np.clip(rgb, 0, 255)
    return Image.fromarray(np.clip(b, 0, 255).astype(np.uint8), "RGBA")

def cut(size: int) -> Image.Image:
    if size >= src.size[0]:
        # апскейл до 1024: сначала обычный ресайз (премультиплиц. тоже ок)
        return resize_rgba(src, size)
    return resize_rgba(src, size)

SIZES = [16, 24, 32, 48, 64, 128, 256, 512]

cut(1024).save(os.path.join(BASE, "app-icon-square.png"))
cut(512).save(os.path.join(BASE, "app-icon.png"))
for s in [16, 32, 48, 64, 128, 256, 512]:
    cut(s).save(os.path.join(BASE, f"icon-{s}.png"))
for s in SIZES:
    d = os.path.join(BASE, "icons", f"{s}x{s}", "apps")
    os.makedirs(d, exist_ok=True)
    cut(s).save(os.path.join(d, "pdf-editor.png"))
pm = os.path.join(BASE, "icons", "pixmap")
os.makedirs(pm, exist_ok=True)
cut(256).save(os.path.join(pm, "pdf-editor.png"))

# Проверка
chk = Image.open(os.path.join(BASE, "app-icon.png"))
a = np.asarray(chk)
print("app-icon.png:", chk.mode, chk.size,
      "углы альфа:", a[0,0,3], a[0,-1,3], a[-1,0,3], a[-1,-1,3],
      "центр альфа:", a[256,256,3])
# пиксель чуть внутри скругления — проверить отсутствие чёрного ореола
print("y=2,x=20:", a[2,20])  # край скругления — RGB должен быть зелёным, не чёрным
print("OK")
