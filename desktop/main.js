// Maestro Billing — Electron shell.
// Boots the Fastify backend (which also serves the built frontend) inside
// this process, then opens the app window pointed at it. All mutable data
// (database, backups, WhatsApp session) lives in the per-user app-data
// folder, because the install directory is not writable.

const { app, BrowserWindow, dialog, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

const PORT = 3179;
const APP_URL = `http://127.0.0.1:${PORT}`;

// Data lives under %APPDATA%/Maestro Billing — set before any getPath call,
// otherwise Electron derives the folder from the package name.
app.setName('Maestro Billing');

// Packaged: resources/app/{backend,frontend,node_modules,template}
// Dev (electron . from codes/desktop): the codes/ folder itself.
const APP_ROOT = app.isPackaged
  ? path.join(process.resourcesPath, 'app')
  : path.resolve(__dirname, '..');
const TEMPLATE_DB = app.isPackaged
  ? path.join(APP_ROOT, 'template', 'studio.db')
  : path.join(__dirname, 'template', 'studio.db');

let mainWindow = null;
// A double-click on the shortcut while the first instance is still starting
// (server/WhatsApp warm-up) arrives before mainWindow exists — remember it
// and focus as soon as the window is actually created.
let focusPending = false;

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
    } else {
      focusPending = true;
    }
  });
}

// The database's folder is user-choosable (e.g. a bigger D:\ or E:\ drive)
// but that choice itself has to live somewhere fixed, so it survives even
// after the database moves off C: — this small pointer file is that fixed
// spot. Backups and the WhatsApp session are NOT affected by this: they
// always stay under dataRoot (%APPDATA%), only the .db file relocates.
const DB_LOCATION_POINTER = path.join(app.getPath('userData'), 'db-location.json');
const DEFAULT_DB_DIR = path.join(app.getPath('userData'), 'data', 'database');

function readDbLocationPointer() {
  try {
    const { dbDir } = JSON.parse(fs.readFileSync(DB_LOCATION_POINTER, 'utf8'));
    return typeof dbDir === 'string' && dbDir ? dbDir : null;
  } catch {
    return null; // no pointer yet — this is the first run
  }
}

function writeDbLocationPointer(dbDir) {
  fs.mkdirSync(path.dirname(DB_LOCATION_POINTER), { recursive: true });
  fs.writeFileSync(DB_LOCATION_POINTER, JSON.stringify({ dbDir }), 'utf8');
}

// Asked once, ever, on the very first launch (there is no later "change
// location" setting) — where should studio.db live? Defaults to the normal
// per-user app-data folder, but the operator can instead pick a folder on
// another drive (handy when C: is small/an SSD they want to keep free).
function chooseDbDirOnFirstRun() {
  const { response } = dialog.showMessageBoxSync({
    type: 'question',
    title: 'Maestro Billing — Database Location',
    message: 'Where should the billing database be stored?',
    detail:
      `This is asked once. "Use Default" keeps it with the app:\n${DEFAULT_DB_DIR}\n\n` +
      'Or pick a folder on a different drive (e.g. D:\\ or E:\\). Backups and the ' +
      'WhatsApp session always stay in the default app-data folder either way.',
    buttons: ['Use Default Location', 'Choose Folder…'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  if (response === 0) return DEFAULT_DB_DIR;

  const picked = dialog.showOpenDialogSync({
    title: 'Choose a folder for the Maestro Billing database',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (!picked || picked.length === 0) return DEFAULT_DB_DIR;
  return path.join(picked[0], 'Maestro Billing Database');
}

// rename() fails with EXDEV across drives (e.g. C: -> D:) — fall back to
// copy+delete in that case. Used for studio.db and its WAL/SHM sidecars.
function moveFile(src, dest) {
  try {
    fs.renameSync(src, dest);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    fs.copyFileSync(src, dest);
    fs.unlinkSync(src);
  }
}

// If the operator picked a custom folder (a USB drive, a network share)
// this can fail on a later launch simply because that drive isn't connected
// right now — not a real error, just a temporary unavailability. Without
// this, prepareDataDir()'s mkdirSync would throw straight up to the
// app.whenReady() catch-all, which shows a raw stack trace no operator
// could act on. Give them a clear choice instead: retry (plug the drive
// back in), fall back to the default location, or quit.
function ensureDbDirAccessible(dbDir) {
  for (;;) {
    try {
      fs.mkdirSync(dbDir, { recursive: true });
      return dbDir;
    } catch (err) {
      const { response } = dialog.showMessageBoxSync({
        type: 'error',
        title: 'Maestro Billing — Database Location Unavailable',
        message: `Can't reach the database folder:\n${dbDir}`,
        detail:
          `${err.message}\n\n` +
          "If this is a USB drive or network share, make sure it's connected, then Retry.\n" +
          `Otherwise, switch to the default location instead:\n${DEFAULT_DB_DIR}`,
        buttons: ['Retry', 'Use Default Location', 'Quit'],
        defaultId: 0,
        cancelId: 2,
      });
      if (response === 0) continue;
      if (response === 1) {
        dbDir = DEFAULT_DB_DIR;
        writeDbLocationPointer(dbDir); // remember the fallback so it's not asked again next time
        continue;
      }
      app.quit();
      process.exit(0);
    }
  }
}

function prepareDataDir() {
  const dataRoot = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(dataRoot, { recursive: true });

  let dbDir = readDbLocationPointer();
  if (!dbDir) {
    dbDir = chooseDbDirOnFirstRun();
    writeDbLocationPointer(dbDir);
  }
  dbDir = ensureDbDirAccessible(dbDir);

  const dbFile = path.join(dbDir, 'studio.db');
  if (!fs.existsSync(dbFile)) {
    const existingDbFile = path.join(DEFAULT_DB_DIR, 'studio.db');
    if (dbDir !== DEFAULT_DB_DIR && fs.existsSync(existingDbFile)) {
      // This install already had a real database at the default location
      // (from before this folder-choice existed, or from a run where the
      // operator picked "Use Default" previously) — carry it across along
      // with its WAL/SHM sidecars instead of handing them a blank template.
      moveFile(existingDbFile, dbFile);
      for (const suffix of ['-wal', '-shm']) {
        const sidecar = existingDbFile + suffix;
        if (fs.existsSync(sidecar)) moveFile(sidecar, dbFile + suffix);
      }
    } else {
      // Genuine first run: install the pre-migrated, seeded database template.
      fs.copyFileSync(TEMPLATE_DB, dbFile);
    }
  }
  return { dataRoot, dbFile };
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
  // electron-builder embeds build/icon.ico into the exe (covers the taskbar
  // and shortcuts automatically), but the window/title-bar icon is set here
  // explicitly so it's never left blank regardless of Windows icon caching.
  // Packaged: shipped alongside "app" as its own resource (see package.json
  // extraResources). Dev: read straight from the desktop/build folder.
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.ico')
    : path.join(__dirname, 'build', 'icon.ico');

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    autoHideMenuBar: true,
    title: 'Maestro Billing',
    backgroundColor: '#f8fafc',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
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

  // If the server passed its health check but then dies before the page
  // finishes loading (crash in the brief gap between the two), the window
  // would otherwise sit blank with no clue why. Offer a retry instead.
  //
  // did-fail-load fires for ANY failed load in this webContents, not just
  // the top-level page — including the hidden <iframe src="blob:...">
  // printing uses (lib/pdf.ts printBillPDF). Without the isMainFrame check,
  // a print action that failed to load its iframe (e.g. blocked by CSP)
  // triggered this exact "app failed to load" dialog, and clicking through
  // it either reloaded the whole app (losing the in-progress bill) or quit
  // it outright — a print hiccup should never be able to take the app down.
  mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription, _url, isMainFrame) => {
    if (errorCode === -3) return; // ERR_ABORTED — normal on a redirect/reload, not a failure
    if (!isMainFrame) {
      console.error(`Sub-frame failed to load (ignored, not fatal): ${errorDescription}`);
      return;
    }
    dialog
      .showMessageBox(mainWindow, {
        type: 'error',
        title: 'Maestro Billing',
        message: 'The billing app failed to load.',
        detail: errorDescription || 'Unknown error',
        buttons: ['Retry', 'Quit'],
        defaultId: 0,
      })
      .then(({ response }) => {
        if (response === 0) mainWindow?.loadURL(APP_URL);
        else app.quit();
      });
  });

  mainWindow.loadURL(APP_URL);

  if (focusPending) {
    focusPending = false;
    mainWindow.focus();
  }
}

// Backup/report "Save a Copy" downloads (see backend routes/backups.ts and
// routes/reports.ts) arrive here as a normal Chromium download. Rather than
// silently dropping the file in the default Downloads folder, prompt a
// native Save As dialog every time so the operator can put the copy
// anywhere they like — a USB drive, a cloud-synced folder, wherever.
//
// Scoped to our own download routes: this app never loads remote content
// (see setWindowOpenHandler above), so nothing else can trigger a download
// today — but scoping the handler is a free belt-and-suspenders guard
// against any download-triggering content ever reaching this window.
function setupBackupDownloads() {
  session.defaultSession.on('will-download', (_event, item) => {
    const url = item.getURL();
    const isBackup = url.startsWith(`${APP_URL}/api/v1/backups/`);
    const isReport = url.startsWith(`${APP_URL}/api/v1/reports/`);
    if (!isBackup && !isReport) {
      item.cancel();
      return;
    }
    const chosenPath = dialog.showSaveDialogSync(mainWindow ?? undefined, {
      title: isBackup ? 'Save Backup Copy' : 'Save Report Copy',
      defaultPath: item.getFilename(),
      filters: isBackup
        ? [{ name: 'Database Backup', extensions: ['db'] }]
        : [{ name: 'GST Report PDF', extensions: ['pdf'] }],
    });
    if (chosenPath) {
      item.setSavePath(chosenPath);
    } else {
      item.cancel();
    }
  });
}

app.whenReady().then(() => {
  try {
    startBackend();
  } catch (err) {
    dialog.showErrorBox('Maestro Billing could not start', String(err && err.stack ? err.stack : err));
    app.quit();
    return;
  }
  setupBackupDownloads();
  waitForServer(60, createWindow);
});

app.on('window-all-closed', () => {
  app.quit();
});

let quitting = false;
function beginGracefulShutdown() {
  if (quitting) return;
  quitting = true;
  try {
    process.emit('SIGTERM', 'SIGTERM');
  } catch {
    app.exit(1);
  }
}

app.on('before-quit', (event) => {
  // Without preventDefault, Electron's own quit sequence races ahead and can
  // kill the process before the backend's async shutdown below — closing
  // WhatsApp's Chrome and disconnecting Prisma — has actually finished,
  // leaving a zombie chrome.exe holding the session lock. The backend's
  // SIGTERM handler ends with process.exit() itself, which is what actually
  // terminates the app (with its own 10s failsafe if something hangs).
  if (quitting) return;
  event.preventDefault();
  beginGracefulShutdown();
});

// Windows/Linux-only: fired on OS shutdown, restart, or user log-off — a
// separate path from a normal in-app quit, and one 'before-quit' does NOT
// cover. Without this handler, Windows just force-kills the whole process
// (including WhatsApp's Chrome instance) partway through, whatever it's
// doing at that instant — which was the actual cause of WhatsApp needing a
// fresh QR scan after a system shutdown/restart (not a real "logout" call
// anywhere in this codebase, just an unclean process kill). preventDefault()
// has no effect here (Windows will not wait for us either way), so this is
// purely "run cleanup as fast as possible before the OS pulls the plug."
app.on('session-end', beginGracefulShutdown);
