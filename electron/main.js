const { app, BrowserWindow, Menu } = require("electron");
const path = require("path");
const { spawn } = require("child_process");

let mainWindow = null;
let serverProcess = null;
const SERVER_PORT = 3000;
const APP_DIR = path.dirname(__dirname);

function startServer() {
  return new Promise((resolve, reject) => {
    const nodeExe = path.join(APP_DIR, "node", "bin", "node");
    const serverScript = path.join(APP_DIR, "app", "server.js");

    serverProcess = spawn(nodeExe, [serverScript], {
      env: {
        ...process.env,
        NODE_ENV: "production",
        NODE_PATH: path.join(APP_DIR, "app", "node_modules"),
        PORT: String(SERVER_PORT),
        HOSTNAME: "0.0.0.0",
      },
      cwd: path.join(APP_DIR, "app"),
      stdio: "pipe",
    });

    serverProcess.on("error", (err) => {
      console.error("Failed to start server:", err);
      reject(err);
    });

    // Wait for server to be ready
    let attempts = 0;
    const maxAttempts = 30;
    const checkInterval = setInterval(() => {
      attempts++;
      const http = require("http");
      http
        .get(`http://127.0.0.1:${SERVER_PORT}/`, (res) => {
          clearInterval(checkInterval);
          resolve();
        })
        .on("error", () => {
          if (attempts >= maxAttempts) {
            clearInterval(checkInterval);
            reject(new Error("Server did not start in time"));
          }
        });
    }, 500);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: "Редактор PDF — Редос",
    icon: path.join(APP_DIR, "app", "public", "logo.svg"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${SERVER_PORT}`);
  mainWindow.setMenuBarVisibility(false);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function createMenu() {
  const template = [
    {
      label: "Файл",
      submenu: [
        {
          label: "Открыть PDF",
          accelerator: "CmdOrCtrl+O",
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.executeJavaScript(
                `document.querySelectorAll('input[type=file]')[0]?.click()`
              );
            }
          },
        },
        { type: "separator" },
        {
          label: "Сохранить",
          accelerator: "CmdOrCtrl+S",
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.executeJavaScript(
                `window.dispatchEvent(new CustomEvent('pdf-save'))`
              );
            }
          },
        },
        { type: "separator" },
        { role: "quit", label: "Выход" },
      ],
    },
    {
      label: "Правка",
      submenu: [
        { role: "undo", label: "Отменить" },
        { role: "redo", label: "Повторить" },
        { type: "separator" },
        { role: "cut", label: "Вырезать" },
        { role: "copy", label: "Копировать" },
        { role: "paste", label: "Вставить" },
        { role: "selectAll", label: "Выделить всё" },
      ],
    },
    {
      label: "Вид",
      submenu: [
        { role: "reload", label: "Обновить" },
        { role: "toggleDevTools", label: "Инструменты разработчика" },
        { role: "resetZoom", label: "Сбросить масштаб" },
        { role: "zoomIn", label: "Увеличить" },
        { role: "zoomOut", label: "Уменьшить" },
        { type: "separator" },
        { role: "togglefullscreen", label: "Полный экран" },
      ],
    },
    {
      label: "Справка",
      submenu: [
        {
          label: "О программе",
          click: () => {
            // Show about dialog
          },
        },
      ],
    },
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(async () => {
  try {
    await startServer();
    createMenu();
    createWindow();
  } catch (err) {
    console.error("Failed to start:", err);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    // Kill the server process
    if (serverProcess) {
      serverProcess.kill();
      serverProcess = null;
    }
    app.quit();
  }
});

app.on("before-quit", () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
