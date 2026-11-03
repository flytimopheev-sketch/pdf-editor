#!/bin/bash
set -e

echo "=== Building Редактор PDF Desktop App for РЕД ОС ==="

SCRIPT_DIR="$(cd "$(dirname "$(realpath "$0")")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR"
BUILD_DIR="$PROJECT_DIR/dist-electron"
APP_NAME="pdf-editor"
# Версия берётся из package.json — единый источник истины
VERSION="$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' "$PROJECT_DIR/package.json" | head -1)"
ARCH="x86_64"
PACKAGE_NAME="$APP_NAME-$VERSION-$ARCH"
PACKAGE_DIR="$BUILD_DIR/$PACKAGE_NAME"
echo "Версия из package.json: $VERSION"

echo "[1/4] Building Next.js standalone..."
(cd "$PROJECT_DIR" && /usr/local/bin/bun run build)

echo "[2/4] Setting up Electron package..."
rm -rf "$BUILD_DIR"
mkdir -p "$PACKAGE_DIR/app"
mkdir -p "$PACKAGE_DIR/electron"

# Copy the standalone Next.js build
cp -r "$PROJECT_DIR/.next/standalone/." "$PACKAGE_DIR/app/"
cp -r "$PROJECT_DIR/.next/static" "$PACKAGE_DIR/app/.next/" 2>/dev/null || true
cp -r "$PROJECT_DIR/public" "$PACKAGE_DIR/app/" 2>/dev/null || true

# ── OCR-сервис (поиск по сканам) ───────────────────────────────────
# Node-совместимый сервер → app/ocr-service.js (запускается из main.js через ELECTRON_RUN_AS_NODE)
cp "$PROJECT_DIR/mini-services/ocr-service/node-server.cjs" "$PACKAGE_DIR/app/ocr-service.js"
# Языковые модели rus+eng
mkdir -p "$PACKAGE_DIR/app/ocr-data"
cp "$PROJECT_DIR/ocr-data/rus.traineddata" "$PACKAGE_DIR/app/ocr-data/" 2>/dev/null || echo "  WARNING: rus.traineddata не найден"
cp "$PROJECT_DIR/ocr-data/eng.traineddata" "$PACKAGE_DIR/app/ocr-data/" 2>/dev/null || echo "  WARNING: eng.traineddata не найден"
# tesseract.js и его зависимости → app/node_modules (резолвятся из ocr-service.js)
for pkg in tesseract.js tesseract.js-core bmp-js idb-keyval is-electron is-url node-fetch opencollective-postinstall regenerator-runtime tr46; do
  SRC_PKG="$PROJECT_DIR/mini-services/ocr-service/node_modules/$pkg"
  [ -d "$SRC_PKG" ] || SRC_PKG="$PROJECT_DIR/node_modules/$pkg"
  if [ -d "$SRC_PKG" ]; then
    mkdir -p "$PACKAGE_DIR/app/node_modules/$pkg"
    cp -r "$SRC_PKG"/. "$PACKAGE_DIR/app/node_modules/$pkg/"
  else
    echo "  WARNING: пакет $pkg не найден для OCR"
  fi
done

# Copy Electron files
cp "$PROJECT_DIR/electron/main.js" "$PACKAGE_DIR/electron/main.js"
cp "$PROJECT_DIR/electron/preload.js" "$PACKAGE_DIR/electron/preload.js"

# Copy Electron binary
ELECTRON_DIR="$PROJECT_DIR/node_modules/electron/dist"
if [ -d "$ELECTRON_DIR" ]; then
  mkdir -p "$PACKAGE_DIR/electron/electron"
  cp -r "$ELECTRON_DIR"/* "$PACKAGE_DIR/electron/electron/"
  echo "  Electron binary copied from node_modules"
else
  echo "  ERROR: Electron not found in node_modules!"
  exit 1
fi

# Find the Electron executable
ELECTRON_EXE=""
if [ -f "$PACKAGE_DIR/electron/electron/electron" ]; then
  ELECTRON_EXE="$PACKAGE_DIR/electron/electron/electron"
elif [ -f "$PACKAGE_DIR/electron/electron/chrome-sandbox" ]; then
  ELECTRON_EXE="$PACKAGE_DIR/electron/electron/electron"
fi

if [ -z "$ELECTRON_EXE" ]; then
  echo "  ERROR: Could not find Electron executable"
  exit 1
fi

# Create launcher script (desktop app: electron in foreground)
cat > "$PACKAGE_DIR/run.sh" << 'LAUNCHER'
#!/bin/bash
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
ELECTRON="$APP_DIR/electron/electron/electron"
MAIN_JS="$APP_DIR/electron/main.js"

export NODE_ENV=production
export PORT=3000
export DATABASE_URL="${DATABASE_URL:-file:$HOME/.pdf-editor/custom.db}"
mkdir -p "$(dirname "${DATABASE_URL#file:}")" 2>/dev/null

# --class=pdf-editor → WM_CLASS окна совпадает с StartupWMClass в .desktop:
# панель задач показывает красивую иконку приложения, а не системную заглушку
exec "$ELECTRON" --class=pdf-editor "$MAIN_JS"
LAUNCHER
chmod +x "$PACKAGE_DIR/run.sh"

# Create install.sh (desktop application: /opt + menu shortcut with proper icon)
cat > "$PACKAGE_DIR/install.sh" << INSTALL
#!/bin/bash
set -e

APP_NAME="pdf-editor"
APP_DIR="/opt/\$APP_NAME"

echo "=========================================="
echo "  Редактор PDF — Установка"
echo "=========================================="

if [ "\$EUID" -ne 0 ]; then
  echo "Запустите с правами root: sudo ./install.sh"
  exit 1
fi

SCRIPT_DIR="\$(cd "\$(dirname "\$0")" && pwd)"

# Удаляем остатки старой (веб) установки, если были
systemctl stop pdf-editor 2>/dev/null || true
systemctl disable pdf-editor 2>/dev/null || true
rm -f /etc/systemd/system/pdf-editor.service
rm -f /usr/local/bin/pdf-editor
systemctl daemon-reload 2>/dev/null || true

echo "[1/3] Копирование файлов в \$APP_DIR..."
mkdir -p "\$APP_DIR"
cp -r "\$SCRIPT_DIR/app" "\$APP_DIR/"
cp -r "\$SCRIPT_DIR/electron" "\$APP_DIR/"
cp "\$SCRIPT_DIR/run.sh" "\$APP_DIR/"
chmod +x "\$APP_DIR/run.sh"

echo "[2/3] Установка иконок..."
for size in 16 24 32 48 64 128 256 512; do
  if [ -f "\$SCRIPT_DIR/icons/pdf-editor-\${size}.png" ]; then
    mkdir -p "/usr/share/icons/hicolor/\${size}x\${size}/apps"
    cp "\$SCRIPT_DIR/icons/pdf-editor-\${size}.png" "/usr/share/icons/hicolor/\${size}x\${size}/apps/pdf-editor.png"
  fi
done
# Абсолютный путь-фолбэк — некоторые окружения меню смотрят только в pixmaps
if [ -f "\$SCRIPT_DIR/icons/pdf-editor-256.png" ]; then
  mkdir -p /usr/share/pixmaps
  cp "\$SCRIPT_DIR/icons/pdf-editor-256.png" /usr/share/pixmaps/pdf-editor.png
fi

echo "[3/3] Создание ярлыка в меню приложений..."
mkdir -p /usr/share/applications
cat > /usr/share/applications/\$APP_NAME.desktop << EOF
[Desktop Entry]
Name=Редактор PDF
GenericName=Редактор PDF-документов
Comment=Редактирование PDF: слои, текст, подписи, OCR
Exec=\$APP_DIR/run.sh
Icon=pdf-editor
Terminal=false
Type=Application
Categories=Office;Graphics;Viewer;
StartupNotify=true
StartupWMClass=pdf-editor
EOF

chmod 644 /usr/share/applications/\$APP_NAME.desktop

# Обновляем кэши (не критично при ошибке)
update-desktop-database /usr/share/applications 2>/dev/null || true
gtk-update-icon-cache -f /usr/share/icons/hicolor 2>/dev/null || true

echo ""
echo "=========================================="
echo "  ✓ Установка завершена!"
echo "=========================================="
echo ""
echo "  Приложение «Редактор PDF» доступно в меню приложений"
echo "  (категория «Офис» / «Графика»)."
echo ""
echo "  Запуск вручную: \$APP_DIR/run.sh"
echo "  Удаление:       sudo \$APP_DIR/uninstall.sh"
echo ""
INSTALL
chmod +x "$PACKAGE_DIR/install.sh"

# Create uninstall.sh
cat > "$PACKAGE_DIR/uninstall.sh" << 'UNINSTALL'
#!/bin/bash
echo "Удаление Редактора PDF..."
rm -f /usr/share/applications/pdf-editor.desktop
for size in 16 24 32 48 64 128 256 512; do
  rm -f "/usr/share/icons/hicolor/${size}x${size}/apps/pdf-editor.png"
done
rm -f /usr/share/pixmaps/pdf-editor.png
rm -rf /opt/pdf-editor
update-desktop-database /usr/share/applications 2>/dev/null || true
gtk-update-icon-cache -f /usr/share/icons/hicolor 2>/dev/null || true
echo "✓ Редактор PDF удалён"
UNINSTALL
chmod +x "$PACKAGE_DIR/uninstall.sh"

# Copy icons into package (for install.sh and RPM)
# Новый красивый логотип: собираем плоский набор icons/pdf-editor-<size>.png
# из сгенерированного hicolor-набора в public/icons
mkdir -p "$PACKAGE_DIR/icons"
for size in 16 24 32 48 64 128 256 512; do
  ICON_SRC="$PROJECT_DIR/public/icons/${size}x${size}/apps/pdf-editor.png"
  if [ -f "$ICON_SRC" ]; then
    cp "$ICON_SRC" "$PACKAGE_DIR/icons/pdf-editor-${size}.png"
  else
    echo "  WARNING: иконка $ICON_SRC не найдена"
  fi
done
# Пиксельная иконка окна/ярлыка (современный лого)
cp "$PROJECT_DIR/public/app-icon-square.png" "$PACKAGE_DIR/icons/" 2>/dev/null || true

# Fix ownership/permissions for RPM reproducibility
find "$PACKAGE_DIR" -type d -exec chmod 755 {} \;
find "$PACKAGE_DIR" -type f -exec chmod 644 {} \;
chmod 755 "$PACKAGE_DIR/run.sh" "$PACKAGE_DIR/install.sh" "$PACKAGE_DIR/uninstall.sh"
chmod 755 "$PACKAGE_DIR/electron/electron/electron" 2>/dev/null || true
# SUID-помощник chrome-sandbox обязателен для Electron на Linux
chmod 4755 "$PACKAGE_DIR/electron/electron/chrome-sandbox" 2>/dev/null || true
find "$PACKAGE_DIR/electron/electron" -maxdepth 1 -type f \( -name "*.so" -o -name "*.bin" -o -name "*.dat" -o -name "*.pak" -o -name "*.json" \) -exec chmod 644 {} \; 2>/dev/null || true

echo "[3/4] Creating tarball..."
cd "$BUILD_DIR"
tar czf "$PROJECT_DIR/$PACKAGE_NAME.tar.gz" "$PACKAGE_NAME"

echo "[4/4] Done."
SIZE=$(du -sh "$PROJECT_DIR/$PACKAGE_NAME.tar.gz" | cut -f1)
echo ""
echo "=========================================="
echo "  ✓ Пакет собран!"
echo "=========================================="
echo ""
echo "  Файл: $PACKAGE_NAME.tar.gz ($SIZE)"
echo ""
echo "Для установки на РЕД ОС:"
echo "  1. Скопируйте файл на РЕД ОС (USB)"
echo "  2. Распакуйте: tar xzf $PACKAGE_NAME.tar.gz"
echo "  3. Установите: cd $PACKAGE_NAME && sudo ./install.sh"
echo ""
echo "Для сборки RPM: python3 build-rpm.py"
