#!/bin/bash
set -e

echo "=== Building Редактор PDF Desktop App for РЕД ОС ==="

SCRIPT_DIR="$(cd "$(dirname "$(realpath "$0")")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR"
BUILD_DIR="$PROJECT_DIR/dist-electron"
PACKAGE_DIR="$BUILD_DIR/package"
APP_NAME="pdf-editor"
VERSION="1.0.0"
ARCH="x86_64"
PACKAGE_NAME="$APP_NAME-$VERSION-$ARCH"

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

# Create launcher script
cat > "$PACKAGE_DIR/run.sh" << 'LAUNCHER'
#!/bin/bash
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
ELECTRON="$APP_DIR/electron/electron/electron"
MAIN_JS="$APP_DIR/electron/main.js"
LOG="/var/log/pdf-editor.log"

mkdir -p "$(dirname "$LOG")" 2>/dev/null

export NODE_ENV=production
export PORT=3000
export HOSTNAME=0.0.0.0
export NODE_PATH="$APP_DIR/app/node_modules"

cd "$APP_DIR"
nohup "$ELECTRON" "$MAIN_JS" > "$LOG" 2>&1 &
echo $! > /var/run/pdf-editor.pid
sleep 3

if kill -0 "$(cat /var/run/pdf-editor.pid 2>/dev/null)" 2>/dev/null; then
  echo "✓ Редактор PDF запущен (PID: $(cat /var/run/pdf-editor.pid))"
  echo "  http://localhost:$PORT"
else
  echo "✗ Ошибка запуска. Проверьте $LOG"
  exit 1
fi
LAUNCHER
chmod +x "$PACKAGE_DIR/run.sh"

# Create stop script
cat > "$PACKAGE_DIR/stop.sh" << 'STOP'
#!/bin/bash
PID_FILE="/var/run/pdf-editor.pid"
if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE" 2>/dev/null)
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID"
    rm -f "$PID_FILE"
    echo "✓ Редактор PDF остановлен"
  else
    rm -f "$PID_FILE"
    echo "Процесс не найден"
  fi
else
  echo "PID файл не найден"
fi
STOP
chmod +x "$PACKAGE_DIR/stop.sh"

# Create install.sh
cat > "$PACKAGE_DIR/install.sh" << INSTALL
#!/bin/bash
set -e

APP_NAME="pdf-editor"
APP_DIR="/opt/$APP_NAME"
SERVICE_NAME="pdf-editor"
PORT=3000

echo "=========================================="
echo "  Редактор PDF — Установка (Desktop)"
echo "=========================================="

if [ -d "$APP_DIR" ]; then
  echo "Редактор PDF уже установлен в $APP_DIR"
  echo "Для переустановки удалите: sudo rm -rf $APP_DIR"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo "[1/4] Копирование файлов в $APP_DIR..."
sudo mkdir -p "$APP_DIR"
sudo cp -r "$SCRIPT_DIR/app" "$APP_DIR/"
sudo cp -r "$SCRIPT_DIR/electron" "$APP_DIR/"
sudo cp "$SCRIPT_DIR/run.sh" "$APP_DIR/"
sudo cp "$SCRIPT_DIR/stop.sh" "$APP_DIR/"

echo "[2/4] Настройка прав доступа..."
sudo chmod +x "$APP_DIR/run.sh"
sudo chmod +x "$APP_DIR/stop.sh"
sudo chmod -R 755 "$APP_DIR/app"
sudo chmod -R 755 "$APP_DIR/electron"

echo "[3/4] Создание systemd сервиса..."
sudo tee /etc/systemd/system/$SERVICE_NAME.service > /dev/null << EOF
[Unit]
Description=Редактор PDF — графический редактор PDF файлов (Desktop)
After=network.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR/app
Environment=NODE_ENV=production
Environment=NODE_PATH=$APP_DIR/app/node_modules
Environment=PORT=$PORT
Environment=HOSTNAME=0.0.0.0
ExecStart=$APP_DIR/run.sh
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

echo "[4/4] Создание ярлыка на рабочем столе..."
sudo mkdir -p /usr/share/applications
sudo tee /usr/share/applications/$APP_NAME.desktop > /dev/null << EOF
[Desktop Entry]
Name=Редактор PDF
Comment=Графический редактор PDF файлов
Exec=$APP_DIR/run.sh
Icon=text-editor
Terminal=false
Type=Application
Categories=Office;Graphics;
StartupNotify=true
EOF

echo ""
echo "Включение автозапуска..."
sudo systemctl daemon-reload
sudo systemctl enable $SERVICE_NAME
sudo systemctl start $SERVICE_NAME

echo ""
echo "Ожидание запуска..."
sleep 5

if sudo systemctl is-active --quiet $SERVICE_NAME; then
  echo ""
  echo "=========================================="
  echo "  ✓ Установка завершена!"
  echo "=========================================="
  echo ""
  echo "  Редактор PDF запущен как десктопное приложение"
  echo "  Управление сервисом:"
  echo "    sudo systemctl start $SERVICE_NAME   — запустить"
  echo "    sudo systemctl stop $SERVICE_NAME    — остановить"
  echo "    sudo systemctl restart $SERVICE_NAME  — перезапустить"
  echo "    sudo systemctl status $SERVICE_NAME   — статус"
  echo ""
else
  echo ""
  echo "⚠ Сервис не запустился. Проверьте логи:"
  echo "  sudo journalctl -u $SERVICE_NAME -n 50"
  echo ""
  echo "Можно запустить вручную:"
  echo "  $APP_DIR/run.sh"
fi
INSTALL
chmod +x "$PACKAGE_DIR/install.sh"

# Create uninstall.sh
cat > "$PACKAGE_DIR/uninstall.sh" << UNINSTALL
#!/bin/bash
echo "Удаление Редактора PDF..."
sudo systemctl stop pdf-editor 2>/dev/null
sudo systemctl disable pdf-editor 2>/dev/null
sudo rm -f /etc/systemd/system/pdf-editor.service
sudo rm -f /usr/share/applications/pdf-editor.desktop
sudo rm -rf /opt/pdf-editor
sudo systemctl daemon-reload
echo "✓ Редактор PDF удалён"
UNINSTALL
chmod +x "$PACKAGE_DIR/uninstall.sh"

echo "[3/4] Creating tarball..."
cd "$BUILD_DIR"
tar czf "$PROJECT_DIR/$PACKAGE_NAME.tar.gz" "$PACKAGE_NAME"

SIZE=$(du -sh "$PROJECT_DIR/$PACKAGE_NAME.tar.gz" | cut -f1)
echo ""
echo "=========================================="
echo "  ✓ Пакет собран!"
echo "=========================================="
echo ""
echo "  Файл: $PACKAGE_NAME.tar.gz ($SIZE)"
echo "  Расположение: $PROJECT_DIR/$PACKAGE_NAME.tar.gz"
echo ""
echo "Для установки на РЕД ОС:"
echo "  1. Скопируйте файл на РЕД ОС (USB)"
echo "  2. Распакуйте: tar xzf $PACKAGE_NAME.tar.gz"
echo "  3. Установите: cd $PACKAGE_NAME && sudo ./install.sh"
