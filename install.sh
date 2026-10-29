#!/bin/bash
# ==============================================================
#  Установочный скрипт «Редактор PDF» для РЕД ОС
#  Требования: РЕД ОС 7.x / 8.x (x86_64), curl, unzip
# ==============================================================

set -euo pipefail

# Цвета
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
err()   { echo -e "${RED}[✗]${NC} $1"; exit 1; }

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  Установка «Редактор PDF» для РЕД ОС${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
echo ""

# Проверка ОС
if [ -f /etc/redos-release ]; then
    OS_VER=$(cat /etc/redos-release 2>/dev/null | head -1)
    info "Обнаружена ОС: $OS_VER"
else
    warn "ОС не определена как РЕД ОС. Продолжаем установку..."
fi

# Проверка архитектуры
ARCH=$(uname -m)
if [ "$ARCH" != "x86_64" ]; then
    err "Поддерживается только архитектура x86_64. Обнаружена: $ARCH"
fi
info "Архитектура: $ARCH"

# Проверка прав root
if [ "$EUID" -ne 0 ]; then
    err "Скрипт требует права root. Запустите: sudo bash install.sh"
fi

INSTALL_DIR="/opt/pdf-editor"
BIN_LINK="/usr/local/bin/pdf-editor"

echo ""
echo -e "${CYAN}── Шаг 1: Установка зависимостей ──${NC}"

# Установка curl если нет
if ! command -v curl &>/dev/null; then
    echo "Установка curl..."
    dnf install -y curl || yum install -y curl || { err "Не удалось установить curl"; }
fi
info "curl: $(curl --version | head -1)"

# Установка unzip если нет
if ! command -v unzip &>/dev/null; then
    echo "Установка unzip..."
    dnf install -y unzip || yum install -y unzip || { err "Не удалось установить unzip"; }
fi
info "unzip: $(unzip -v | head -1)"

echo ""
echo -e "${CYAN}── Шаг 2: Установка Bun ──${NC}"

if command -v bun &>/dev/null; then
    BUN_VER=$(bun --version)
    info "Bun уже установлен: v$BUN_VER"
else
    echo "Установка Bun runtime..."
    curl -fsSL https://bun.sh/install | bash || {
        err "Не удалось установить Bun. Проверьте подключение к интернету."
    }

    # Добавить bun в PATH
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"

    # Для root
    if [ -d "/root/.bun/bin" ]; then
        export PATH="/root/.bun/bin:$PATH"
    fi

    if command -v bun &>/dev/null; then
        info "Bun установлен: v$(bun --version)"
    else
        err "Bun не найден в PATH после установки"
    fi
fi

echo ""
echo -e "${CYAN}── Шаг 3: Создание директории ──${NC}"

mkdir -p "$INSTALL_DIR"
info "Директория: $INSTALL_DIR"

echo ""
echo -e "${CYAN}── Шаг 4: Копирование файлов ──${NC}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Копируем файлы проекта
if [ -f "$SCRIPT_DIR/package.json" ]; then
    cp -r "$SCRIPT_DIR"/* "$INSTALL_DIR/" 2>/dev/null || true
    cp -r "$SCRIPT_DIR"/.* "$INSTALL_DIR/" 2>/dev/null || true
    info "Файлы скопированы из: $SCRIPT_DIR"
else
    err "Не найден package.json в директории скрипта: $SCRIPT_DIR"
fi

echo ""
echo -e "${CYAN}── Шаг 5: Установка зависимостей проекта ──${NC}"

cd "$INSTALL_DIR"
bun install --production 2>&1 || {
    warn "bun install не удалось, пробуем npm..."
    if command -v npm &>/dev/null; then
        npm install --omit=dev 2>&1
    else
        err "Не удалось установить зависимости. Установите npm или bun."
    fi
}
info "Зависимости установлены"

echo ""
echo -e "${CYAN}── Шаг 6: Сборка проекта ──${NC}"

bun run build 2>&1 || {
    err "Сборка не удалась. Проверьте логи выше."
}
info "Сборка завершена"

echo ""
echo -e "${CYAN}── Шаг 7: Создание команды запуска ──${NC}"

# Создаём скрипт запуска
cat > "$BIN_LINK" << 'LAUNCH_EOF'
#!/bin/bash
# Запуск Редактор PDF
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/server.js" ]; then
    cd "$SCRIPT_DIR" && node server.js
elif [ -d "/opt/pdf-editor" ]; then
    cd /opt/pdf-editor && node .next/standalone/server.js
else
    echo "Редактор PDF не найден. Запустите установку: sudo bash install.sh"
    exit 1
fi
LAUNCH_EOF

chmod +x "$BIN_LINK"
info "Команда создана: pdf-editor"

# Создаём systemd service
cat > /etc/systemd/system/pdf-editor.service << 'SERVICE_EOF'
[Unit]
Description=Редактор PDF — веб-редактор PDF-документов
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/pdf-editor
ExecStart=/usr/bin/node /opt/pdf-editor/.next/standalone/server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
SERVICE_EOF

systemctl daemon-reload
info "systemd-сервис создан: pdf-editor.service"

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Установка завершена!${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
echo ""
echo "  Запуск:"
echo "    sudo systemctl start pdf-editor    — запустить сервис"
echo "    sudo systemctl enable pdf-editor   — автозапуск при загрузке"
echo "    sudo systemctl status pdf-editor   — статус"
echo ""
echo "  Адрес в браузере:"
echo -e "    ${CYAN}http://localhost:3000${NC}"
echo ""
echo "  Остановка:"
echo "    sudo systemctl stop pdf-editor"
echo ""
echo "  Логи:"
echo "    journalctl -u pdf-editor -f"
echo ""
