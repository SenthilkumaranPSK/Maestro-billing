// Maestro Billing — Electron shell.
// Boots the Fastify backend (which also serves the built frontend) inside
// this process, then opens the app window pointed at it. All mutable data
// (database, backups, WhatsApp session) lives in the per-user app-data
// folder, because the install directory is not writable.

const { app, BrowserWindow, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');

const PORT = 3179;
const APP_URL = `http://127.0.0.1:${PORT}`;

// Packaged: resources/app/{backend,frontend,node_modules,template}
// Dev (electron . from codes/desktop): the codes/ folder itself.
const APP_ROOT = app.isPackaged
  ? path.join(process.resourcesPath, 'app')
  : path.resolve(__dirname, '..');
const TEMPLATE_DB = app.isPackaged
  ? path.join(APP_ROOT, 'template', 'studio.db')
  : path.join(__dirname, 'template', 'studio.db');

let mainWindow = null;

// A second double-click on the shortcut must focus the running app,
// not boot a second server against the same database.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function prepareDataDir() {
  const dataRoot = path.join(app.getPath('userData'), 'data');
  const dbDir = path.join(dataRoot, 'database');
  fs.mkdirSync(dbDir, { recursive: true });

  const dbFile = path.join(dbDir, 'studio.db');
  if (!fs.existsSync(dbFile)) {
    // First run: install the pre-migrated, seeded database template.
    fs.copyFileSync(TEMPLATE_DB, dbFile);
  }
  return { dataRoot, dbFile };
}

function loadOrCreateSecret(dataRoot) {
  const secretFile = path.join(dataRoot, '.secret');
  try {
    const existing = fs.readFileSync(secretFile, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch {
    // first run
  }
  const secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(secretFile, secret, 'utf8');
  return secret;
}

function startBackend() {
  const { dataRoot, dbFile } = prepareDataDir();

  process.env.NODE_ENV = 'production';
  process.env.DATABASE_URL = 'file:' + dbFile.replace(/\\/g, '/');
  process.env.PORT = String(PORT);
  process.env.HOST = '127.0.0.1';
  process.env.CORS_ORIGIN = APP_URL;
  process.env.FRONTEND_DIST = path.join(APP_ROOT, 'frontend', 'dist');
  process.env.WA_DATA_DIR = dataRoot;
  process.env.JWT_SECRET = loadOrCreateSecret(dataRoot);
  process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'info';

  // Runs Fastify inside this (Node-capable) Electron main process.
  require(path.join(APP_ROOT, 'backend', 'dist', 'server.js'));
}

function waitForServer(retriesLeft, onReady) {
  const req = http.get(`${APP_URL}/live`, (res) => {
    res.resume();
    if (res.statusCode === 200) return onReady();
    retry();
  });
  req.on('error', retry);
  req.setTimeout(1000, () => {
    req.destroy();
    retry();
  });

  function retry() {
    if (retriesLeft <= 0) {
      dialog.showErrorBox(
        'Maestro Billing could not start',
        'The billing server did not come up. Restart the app; if this keeps happening, contact support.',
      );
      app.quit();
      return;
    }
    setTimeout(() => waitForServer(retriesLeft - 1, onReady), 500);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    autoHideMenuBar: true,
    title: 'Maestro Billing',
    backgroundColor: '#f8fafc',
    webPreferences: {
      // The UI is our own local site — no Node access needed in the renderer.
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // The thermal receipt opens a popup that calls window.print() — allow it.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(APP_URL) || url === 'about:blank') return { action: 'allow' };
    // Anything external (e.g. wa.me links) goes to the system browser.
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadURL(APP_URL);
}

app.whenReady().then(() => {
  try {
    startBackend();
  } catch (err) {
    dialog.showErrorBox('Maestro Billing could not start', String(err && err.stack ? err.stack : err));
    app.quit();
    return;
  }
  waitForServer(60, createWindow);
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  // Triggers the backend's graceful shutdown (WhatsApp Chrome teardown,
  // DB disconnect). Its handler ends with process.exit, which is fine —
  // the app is quitting anyway.
  try {
    process.emit('SIGTERM', 'SIGTERM');
  } catch {
    // best effort
  }
});
