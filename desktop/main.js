// Maestro Billing — Electron shell.
// Boots the Fastify backend (which also serves the built frontend) inside
// this process, then opens the app window pointed at it. All mutable data
// (database, backups, WhatsApp session) lives in the per-user app-data
// folder, because the install directory is not writable.

const { app, BrowserWindow, Menu, dialog, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');

const PORT = 3179;
const LOCAL_URL = `http://127.0.0.1:${PORT}`;

// Where the UI actually lives. In the normal ("server") mode that's this PC's
// own in-process backend; on a second PC running in "client" mode it's the
// main PC's address across the studio LAN. Assigned during startup, before
// any window exists, so every isAppUrl() check below compares against the
// origin this install genuinely talks to.
let APP_URL = LOCAL_URL;

// url.startsWith(APP_URL) is not a safe origin check: a URL like
// "http://127.0.0.1:3179@evil.example" passes that prefix test (the string
// literally starts with APP_URL) but the "@" makes "127.0.0.1:3179" parsed
// userinfo, not the host — it actually navigates to evil.example. Parse the
// URL and compare the real origin instead. pathPrefix additionally restricts
// to a specific route (e.g. the backup/report download endpoints).
function isAppUrl(url, pathPrefix) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.origin !== APP_URL) return false;
  return pathPrefix ? parsed.pathname.startsWith(pathPrefix) : true;
}

// Data lives under %APPDATA%/Maestro Billing — set before any getPath call,
// otherwise Electron derives the folder from the package name.
app.setName('Maestro Billing');

// Packaged: resources/app.asar/{backend,frontend,node_modules} (archived —
// Electron's require()/fs transparently read through it) plus
// resources/template/ (a real loose file — see extraResources below, kept
// out of the archive since main.js fs.copyFileSync()s it directly).
// Dev (electron . from codes/desktop): the codes/ folder itself.
const APP_ROOT = app.isPackaged
  ? path.join(process.resourcesPath, 'app.asar')
  : path.resolve(__dirname, '..');
const TEMPLATE_DB = app.isPackaged
  ? path.join(process.resourcesPath, 'template', 'studio.db')
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

// ── Network mode (single PC vs. two PCs sharing one database) ─────────────
// Two studio PCs cannot both open the same studio.db over a file share:
// SQLite in WAL mode needs shared memory that only works when every process
// is on the same machine, and Windows share locking would corrupt the file
// regardless. So the second PC does NOT get its own database — it runs the
// UI against the main PC's backend over HTTP, which is what this app already
// is internally (a Fastify server + a browser UI that happens to be local).
//
//   server mode — the normal install: own database, backups, WhatsApp.
//                 `share: true` additionally binds the backend to the LAN.
//   client mode — no database, no backend, no WhatsApp on this PC. The window
//                 just points at the main PC. Nothing is stored locally.
//
// Concurrency is already safe: billNumber is UNIQUE and BillService.createBill
// retries on P2002, so two operators saving at the same instant get different
// bill numbers rather than a duplicate-key error.
const NETWORK_CONFIG = path.join(app.getPath('userData'), 'network-mode.json');

function readNetworkConfig() {
  try {
    // Strip a UTF-8 BOM before parsing. We never write one, but Notepad and
    // PowerShell's Out-File both add one by default — so the moment anyone
    // hand-edits this file to fix an address, JSON.parse would throw and the
    // app would silently look like it had forgotten its settings.
    const raw = fs.readFileSync(NETWORK_CONFIG, 'utf8').replace(/^﻿/, '');
    const cfg = JSON.parse(raw);
    if (cfg.mode === 'client' && typeof cfg.address === 'string' && cfg.address) return cfg;
    if (cfg.mode === 'server') return { mode: 'server', share: cfg.share === true };
    return null;
  } catch {
    return null; // never configured — first run
  }
}

// Turns whatever the operator typed into the exact origin string every
// isAppUrl() check compares against.
//
// Two things go wrong without this. First, a bare "192.168.1.50" becomes
// http://192.168.1.50 — which is port 80, not this app — so the second PC
// would sit there insisting the main PC is switched off. The setup screen
// deliberately allows a bare address (a studio operator should not have to
// know what a port is), so the default has to be applied here.
//
// Second, isAppUrl compares against URL.origin, which is normalized:
// lowercased host, and the default port dropped. Comparing that to a raw
// concatenated string means an address typed as "Reception-PC:3179" never
// matches its own pages — and then every in-app navigation gets treated as
// external and thrown out to the system browser. Normalizing through URL
// once, here, keeps both sides in the same shape.
function clientOrigin(address) {
  const withPort = /:\d+$/.test(address) ? address : `${address}:${PORT}`;
  try {
    return new URL(`http://${withPort}`).origin;
  } catch {
    return `http://${withPort}`; // setup.html already validated the shape
  }
}

function writeNetworkConfig(cfg) {
  fs.mkdirSync(path.dirname(NETWORK_CONFIG), { recursive: true });
  fs.writeFileSync(NETWORK_CONFIG, JSON.stringify(cfg), 'utf8');
}

// This PC's LAN addresses, shown on the main PC so the operator knows what to
// type on the second one.
//
// A bare "every non-internal IPv4" list is not usable here — a normal Windows
// PC reports a pile of addresses that will never work: 169.254.x.x (APIPA,
// which Windows self-assigns to an adapter that got NO network at all), and
// virtual switches from Hyper-V/WSL/VirtualBox/VMware, which are real private
// addresses on a network the other PC isn't on. Handing the operator six
// addresses and letting them guess is how "I typed it and it didn't work"
// happens. Drop the ones that cannot be right, then order the rest so the
// most likely home/studio-router address is first.
const VIRTUAL_IFACE = /vethernet|virtualbox|vmware|hyper-v|loopback|wsl|docker|tailscale|zerotier/i;

function getLanAddresses() {
  const candidates = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    if (VIRTUAL_IFACE.test(name)) continue;
    for (const net of ifaces[name] ?? []) {
      if (net.family !== 'IPv4' || net.internal) continue;
      if (net.address.startsWith('169.254.')) continue; // APIPA — no network
      candidates.push(net.address);
    }
  }
  // 192.168.x.x is what almost every home/small-office router hands out, so
  // it goes first; then 10.x, then the 172.16–31 range.
  const rank = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : 2);
  return candidates.sort((a, b) => rank(a) - rank(b));
}

// Electron has no text-input dialog, so this is a real (small, frameless-ish)
// window loading setup.html. It stays under the same webPreferences lockdown
// as the main window — no Node in the renderer — and hands its answer back
// through a page-side promise that executeJavaScript awaits. Resolves to the
// chosen config, or null if the operator cancelled.
let setupWindow = null;

function showSetupWindow(current) {
  // Ctrl+Shift+C is an app-wide accelerator, so it fires while the setup
  // window itself has focus — without this it would stack a second setup
  // window over the first, each awaiting its own page promise, and only one
  // of them could ever be the answer.
  if (setupWindow && !setupWindow.isDestroyed()) {
    setupWindow.focus();
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const params = new URLSearchParams({
      ips: JSON.stringify(getLanAddresses()),
      port: String(PORT),
      mode: current?.mode ?? '',
      address: current?.address ?? '',
      share: current?.share ? '1' : '0',
      firstRun: current ? '0' : '1',
    });

    const win = new BrowserWindow({
      width: 620,
      height: 660,
      resizable: false,
      minimizable: false,
      maximizable: false,
      autoHideMenuBar: true,
      title: 'Maestro Billing — Connection Setup',
      backgroundColor: '#f8fafc',
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });
    setupWindow = win;
    // The app menu's Ctrl+R (role: 'reload') would otherwise reload this page,
    // which builds a brand-new window.__setupResult promise while we are still
    // awaiting the old one — Save & Start would then appear to do nothing at
    // all, forever. Nothing here needs reloading.
    win.setMenu(null);

    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (setupWindow === win) setupWindow = null;
      if (!win.isDestroyed()) win.destroy();
      resolve(value);
    };

    // Closing the window with the X is the same as cancelling.
    win.on('closed', () => finish(null));

    win.loadFile(path.join(__dirname, 'setup.html'), { search: params.toString() });
    // `on`, not `once`: if the page ever does reload, re-attach to the new
    // promise rather than waiting forever on the discarded one.
    win.webContents.on('did-finish-load', () => {
      win.webContents
        .executeJavaScript('window.__setupResult')
        .then(finish)
        .catch(() => {
          // A reload rejects the pending executeJavaScript. That is not a
          // cancellation — the next did-finish-load will re-attach.
          if (win.isDestroyed()) finish(null);
        });
    });
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
  // NOTE: showMessageBoxSync returns the clicked button INDEX (a number), not
  // the {response} object its async sibling showMessageBox resolves to. This
  // was destructured as an object here for a long time, which silently made
  // `response` undefined — so "Use Default Location" never matched and every
  // first run fell through to the folder picker regardless of the choice.
  const response = dialog.showMessageBoxSync({
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
      // Button index, not an object — see chooseDbDirOnFirstRun above.
      // Destructured as {response} here previously, which meant Retry and
      // "Use Default Location" both fell through to the quit branch.
      const response = dialog.showMessageBoxSync({
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

function startBackend(share) {
  const { dataRoot, dbFile } = prepareDataDir();

  process.env.NODE_ENV = 'production';
  process.env.DATABASE_URL = 'file:' + dbFile.replace(/\\/g, '/');
  process.env.PORT = String(PORT);
  // Loopback unless the operator explicitly opted into letting a second
  // studio PC connect — this app has no login, so binding to the LAN is a
  // deliberate choice, never the default.
  process.env.HOST = share ? '0.0.0.0' : '127.0.0.1';
  // The second PC loads the UI *from* this server, so its requests are
  // same-origin and never hit CORS at all. The LAN origins are listed anyway
  // so a direct cross-origin call from the other PC isn't silently blocked.
  process.env.CORS_ORIGIN = share
    ? [LOCAL_URL, ...getLanAddresses().map((ip) => `http://${ip}:${PORT}`)].join(',')
    : LOCAL_URL;
  process.env.FRONTEND_DIST = path.join(APP_ROOT, 'frontend', 'dist');
  process.env.WA_DATA_DIR = dataRoot;
  process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'info';
  process.env.APP_VERSION = app.getVersion();

  // Runs Fastify inside this (Node-capable) Electron main process.
  require(path.join(APP_ROOT, 'backend', 'dist', 'server.js'));
}

function waitForServer(retriesLeft, onReady, onUnreachable) {
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
      if (onUnreachable) return onUnreachable();
      dialog.showErrorBox(
        'Maestro Billing could not start',
        'The billing server did not come up. Restart the app; if this keeps happening, contact support.',
      );
      app.quit();
      return;
    }
    setTimeout(() => waitForServer(retriesLeft - 1, onReady, onUnreachable), 500);
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
    if (isAppUrl(url) || url === 'about:blank') return { action: 'allow' };
    // Anything external (e.g. wa.me links) goes to the system browser.
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // setWindowOpenHandler above only covers NEW windows/tabs (window.open,
  // target="_blank"); it does nothing for the main window navigating itself
  // (e.g. location.href = someUrl, or clicking a plain link). This app has
  // no legitimate reason to ever navigate the main window away from its own
  // server — block anything else and send it to the system browser instead,
  // same treatment as setWindowOpenHandler, so a stray external link can
  // never replace the billing UI with an arbitrary page.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    shell.openExternal(url);
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

  // If the renderer process itself dies (a Chromium-level crash or OOM, not
  // a JS error — those stay inside the page and don't hit this at all), the
  // window would otherwise just sit there frozen/blank with no explanation
  // and no way back except force-closing the app. Same recovery pattern as
  // did-fail-load above: offer reload or quit instead of leaving it dead.
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit') return; // normal app-quit teardown
    dialog
      .showMessageBox(mainWindow, {
        type: 'error',
        title: 'Maestro Billing',
        message: 'The billing app stopped responding.',
        detail: `Reason: ${details.reason}`,
        buttons: ['Reload', 'Quit'],
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
// routes/reports.ts) and bill/invoice PDF downloads (frontend lib/pdf.ts +
// lib/a4invoice.ts — generated client-side as a blob: URL, not a server
// route) all arrive here as a normal Chromium download. Rather than
// silently dropping the file in the default Downloads folder, prompt a
// native Save As dialog every time so the operator can put the copy
// anywhere they like — a USB drive, a cloud-synced folder, wherever.
//
// The blob: case was missed when this was first written ("this app never
// loads remote content, so nothing else can trigger a download" — true,
// but bill PDFs are a *local* blob: download, not remote content) — every
// "Download PDF" click on a bill was silently cancelled below, with no
// visible error, because its blob: URL matched neither the backup nor the
// report route prefix.
function setupBackupDownloads() {
  session.defaultSession.on('will-download', (_event, item) => {
    const url = item.getURL();
    const isBackup = isAppUrl(url, '/api/v1/backups/');
    const isReport = isAppUrl(url, '/api/v1/reports/');
    const isBlobDownload = url.startsWith('blob:'); // bill/invoice PDFs, generated client-side
    if (!isBackup && !isReport && !isBlobDownload) {
      item.cancel();
      return;
    }
    const chosenPath = dialog.showSaveDialogSync(mainWindow ?? undefined, {
      title: isBackup ? 'Save Backup Copy' : isReport ? 'Save Report Copy' : 'Save Invoice PDF',
      defaultPath: item.getFilename(),
      filters: isBackup
        ? [{ name: 'Database Backup', extensions: ['db'] }]
        : [{ name: 'PDF File', extensions: ['pdf'] }],
    });
    if (chosenPath) {
      item.setSavePath(chosenPath);
    } else {
      item.cancel();
    }
  });
}

// A crash in a non-renderer child process (GPU, print backend/spooler
// service, network service, etc.) doesn't fire render-process-gone above —
// that's renderer-only. Printing in particular can spin up its own
// out-of-process print-compositor/backend service, and certain printer
// drivers are known to crash it when print settings change mid-dialog (e.g.
// switching the destination printer while the preview re-renders). Without
// this handler such a crash was silently unhandled — just logging it here
// stops it from being a mystery "the app vanished" report with no trace,
// and Chromium already recovers most of these services on its own; only the
// GPU process taking the renderer down with it would still hit
// render-process-gone separately.
app.on('child-process-gone', (_e, details) => {
  console.error(`Child process gone: type=${details.type} reason=${details.reason} name=${details.name ?? ''}`);
});

let networkMode = 'server';
// True only while the Connection Setup window is open — see runSetup().
let setupInFlight = false;
// What an install runs as unless it has been told otherwise: its own
// database, loopback only. Every existing 2.0.0 install has no
// network-mode.json at all, so this is also what they upgrade into — they
// must never be stopped by a connection question they didn't ask for.
const DEFAULT_NETWORK_CONFIG = { mode: 'server', share: false };

// Asks for the connection settings (first run, or after the main PC turned
// out to be unreachable), saves them, then boots accordingly. Recursive on
// purpose: a client that still can't reach the main PC lands back on the
// setup screen instead of a dead window with no way out.
function startWithConfig(cfg) {
  networkMode = cfg.mode;
  APP_URL = cfg.mode === 'client' ? clientOrigin(cfg.address) : LOCAL_URL;

  if (cfg.mode === 'server') {
    try {
      startBackend(cfg.share);
    } catch (err) {
      dialog.showErrorBox('Maestro Billing could not start', String(err && err.stack ? err.stack : err));
      app.quit();
      return;
    }
    waitForServer(60, createWindow);
    return;
  }

  // Client mode: nothing to boot locally — just check the main PC answers.
  // Far fewer retries than a local boot: this isn't waiting for a server to
  // warm up, it's asking whether another PC is switched on and reachable, and
  // making the operator stare at a blank window for 30s to find that out is
  // worse than telling them in 5.
  waitForServer(10, createWindow, () => {
    // Button index, not an object — see chooseDbDirOnFirstRun above.
    const response = dialog.showMessageBoxSync({
      type: 'error',
      title: 'Maestro Billing — Cannot Reach the Main PC',
      message: `No answer from ${cfg.address}`,
      detail:
        'Check that:\n' +
        '  • the Main PC is switched on and Maestro Billing is open on it\n' +
        '  • both PCs are on the same Wi-Fi\n' +
        "  • the Main PC's Connection Setup has sharing turned on\n" +
        '  • the address is still correct (it can change if the router reassigns it)',
      buttons: ['Retry', 'Change Connection Settings…', 'Quit'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    if (response === 0) return startWithConfig(cfg);
    if (response === 1) return runSetup(cfg);
    app.quit();
  });
}

function runSetup(current) {
  // Destroying the setup window leaves zero open windows, and Electron emits
  // 'window-all-closed' synchronously during that destroy — i.e. BEFORE the
  // .then() below (a microtask) can open the real window. Without this flag
  // the handler's app.quit() fires mid-setup: in client mode that reaches
  // beginGracefulShutdown's app.exit(0) and kills the app with the operator's
  // just-saved settings never applied, and in server mode it latches
  // `quitting = true`, so the genuine quit later that session skips the
  // backend's SIGTERM shutdown entirely — reintroducing the zombie chrome.exe
  // the before-quit fix exists to prevent.
  setupInFlight = true;
  showSetupWindow(current).then((cfg) => {
    setupInFlight = false;
    if (!cfg) {
      // Cancelled — carry on with whatever was already in effect. There is
      // always something to fall back to now that a missing config means
      // "normal single-PC install" rather than "must answer this dialog".
      return startWithConfig(current ?? DEFAULT_NETWORK_CONFIG);
    }
    writeNetworkConfig(cfg);
    startWithConfig(cfg);
  });
}

// Changing the connection afterwards is rare — the usual case (the router
// gave the main PC a new address) is already handled by the "Cannot Reach the
// Main PC" dialog's own "Change Connection Settings…" button. This menu is
// the deliberate route for everything else: switching a PC between main and
// second, or turning sharing on later. The menu bar is auto-hidden, so it
// appears on Alt; Ctrl+Shift+C works without it.
function buildMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: '&Setup',
        submenu: [
          {
            label: 'Connection Setup…',
            accelerator: 'CommandOrControl+Shift+C',
            click: () => {
              dialog
                .showMessageBox(mainWindow ?? undefined, {
                  type: 'question',
                  title: 'Maestro Billing',
                  message: 'Change how this PC connects?',
                  detail: 'Maestro Billing needs to restart to apply the new setting.',
                  buttons: ['Continue', 'Cancel'],
                  defaultId: 0,
                  cancelId: 1,
                  noLink: true,
                })
                .then(({ response }) => {
                  if (response !== 0) return;
                  showSetupWindow(readNetworkConfig()).then((cfg) => {
                    if (!cfg) return;
                    writeNetworkConfig(cfg);
                    app.relaunch();
                    app.quit();
                  });
                });
            },
          },
          { type: 'separator' },
          { role: 'reload' },
          { role: 'quit' },
        ],
      },
    ]),
  );
}

app.whenReady().then(() => {
  buildMenu();
  // Registered once, here — not per boot. startWithConfig can be re-entered
  // (Retry from the unreachable dialog, cancelling out of setup, switching
  // mode), and re-registering would stack duplicate 'will-download' handlers
  // on the shared default session: one "Download PDF" click would then open
  // a Save As dialog per stacked listener, each racing setSavePath/cancel on
  // the same item.
  setupBackupDownloads();
  // A missing config is NOT a question to ask — it's every existing install
  // on upgrade, plus every fresh single-PC install. Boot normally; two-PC
  // mode is opt-in via Setup → Connection Setup (Ctrl+Shift+C).
  startWithConfig(readNetworkConfig() ?? DEFAULT_NETWORK_CONFIG);
});

app.on('window-all-closed', () => {
  // The setup window is briefly the only window there is; quitting while it
  // is open (or while its result is being applied) would kill the app right
  // as the operator finished configuring it. See runSetup().
  if (setupInFlight) return;
  app.quit();
});

let quitting = false;
function beginGracefulShutdown() {
  if (quitting) return;
  quitting = true;
  // In client mode there is no backend in this process, so nothing is
  // listening for SIGTERM — process.emit() would just return false and the
  // app would hang on quit forever, since before-quit already called
  // preventDefault(). Exit directly instead; there's nothing local to flush.
  if (networkMode === 'client') {
    app.exit(0);
    return;
  }
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
