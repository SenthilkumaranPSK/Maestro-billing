# The Maestro Studio's — Billing System

Local-first billing software for The Maestro Studio's, Salem. Runs entirely on your Windows PC — no internet required after setup.

**Stack:** React 18 + Vite + Tailwind (frontend) · Fastify + Prisma + SQLite/WAL (backend) · whatsapp-web.js · pdf-lib. All money is stored as integer paise.

## Features

- **One-screen billing** — customer autocomplete, service picker with fixed catalog prices, live CGST/SGST totals, automatic whole-rupee round-off. Bill date is always the moment of saving; every save is a PAID bill.
- **Three outputs per bill** — 80mm thermal receipt (RP 3160, ESC/POS), downloadable PDF, and automatic WhatsApp send with the PDF attached (via the studio's own linked WhatsApp).
- **Bill history** — search, view, edit items, cancel. Cancelled bills stay visible for audit but never count as revenue. Every change is written to a log table.
- **Customers & products** — simple catalogs; bill items snapshot the product name and price, so history survives catalog changes.
- **Reports** (in Settings) — printable end-of-day Day Report, and a monthly GST report grouped by rate with CSV export. Both warn if any bills could not be loaded.
- **Backups** — automatic daily snapshot on app start (last 30 kept), to a configurable folder on a separate drive; each backup can be saved anywhere as a copy. Restoring is CLI-only, on purpose.
- **Resilience** — SQLite WAL mode, Zod-validated API boundary, race-proof unique bill numbers, self-recovering WhatsApp session, printer-availability badge on the billing screen.

---

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 20+ | [nodejs.org](https://nodejs.org) |
| npm | 10+ | Comes with Node 20 |
| sqlite3 CLI | optional | Enables WAL-safe backups; if absent, fallback copy is used |
| Chromium / Chrome | latest | Required for WhatsApp integration via `whatsapp-web.js` |

---

## First-Time Setup

```bash
# 1. Install all dependencies (backend + frontend)
npm install

# 2. Generate Prisma client
npm run --workspace=backend db:generate

# 3. Apply all database migrations (creates studio.db)
npm run db:migrate:deploy

# 4. Seed default products and settings
npm run db:seed
```

---

## Running in Development

Open **two terminals**:

**Terminal 1 — Backend**
```bash
npm run dev:backend
# API available at http://127.0.0.1:3001
```

**Terminal 2 — Frontend**
```bash
npm run dev:frontend
# UI available at http://localhost:5173
```

---

## Running in Production

```bash
# Build both apps
npm run build

# Start the backend (serves compiled JS, no live reload)
NODE_ENV=production node backend/dist/server.js
```

> **Note:** this app has no login — it's built for a single trusted operator on the
> studio's own PC/LAN. Don't expose it to the public internet.

---

## Environment Variables

Edit `backend/.env` to configure the app.

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `file:../../database/studio.db` | Path to the SQLite database file |
| `PORT` | `3001` | Backend port |
| `HOST` | `127.0.0.1` | Bind address (`0.0.0.0` to allow LAN access) |
| `NODE_ENV` | `development` | `development` or `production` |
| `CORS_ORIGIN` | `http://localhost:5173` | Comma-separated allowed origins for CORS |
| `LOG_LEVEL` | `info` | Pino log level (`debug`, `info`, `warn`, `error`) |

To allow access from another device on your LAN:
```env
HOST=0.0.0.0
CORS_ORIGIN=http://localhost:5173,http://192.168.1.100:5173
```

In the packaged desktop app these are not edited by hand — `desktop/main.js`
sets them from the Connection Setup screen (Alt → Setup → Connection Setup…,
or Ctrl+Shift+C), which writes `network-mode.json` in the app-data folder:

| Mode | Effect |
|---|---|
| `{"mode":"server","share":false}` | Default. Backend on `127.0.0.1` only |
| `{"mode":"server","share":true}` | Backend on `0.0.0.0` so a second studio PC can connect |
| `{"mode":"client","address":"192.168.1.50:3179"}` | No local backend or database at all — the window points at the main PC |

See **[TWO-PC-SETUP.md](TWO-PC-SETUP.md)** for the operator-facing walkthrough
(including the required Windows Firewall rule). Note that sharing the database
by putting `studio.db` on a network share instead is **not** supported — SQLite
in WAL mode requires all connections to be on the same machine.

---

## Health Checks

| Endpoint | Purpose | Success | Failure |
|---|---|---|---|
| `GET /live` | Liveness — is the process running? | `200 {"status":"ok"}` | Never fails (process is up) |
| `GET /health` | Readiness — can the DB be reached? | `200 {"status":"ok","db":"ok"}` | `503 {"status":"error","db":"unreachable"}` |

Use `/health` to verify the backend is fully operational before running reports or taking backups.

---

## Backups

Backups are stored in `database/backups/`. The 30 most recent are kept; older ones are deleted automatically.

### API Endpoints

```bash
# List all backups
GET /api/v1/backups

# Create a new backup
POST /api/v1/backups

# Save a copy of a backup (streams the file as a download)
GET /api/v1/backups/<filename>/download

# Read / set the backup folder ("" clears it, reverting to auto-detection)
GET /api/v1/backups/location
PUT /api/v1/backups/location   { "path": "D:\\Billing" }
```

There is no restore endpoint — restoring is deliberately not exposed in the
app or the API (see the CLI below).

### CLI Commands

```bash
# Create a backup
npm run backup --workspace=backend

# Restore from a backup (set CONFIRM=yes to confirm the destructive operation).
# This is the ONLY restore path — it is intentionally not available in the app,
# so a mis-click can never roll the studio's live database back.
# Pass the name exactly as listed, INCLUDING its month folder.
# A safety snapshot of the current database is taken automatically first.
CONFIRM=yes npm run restore --workspace=backend -- 2026-07/studio_2026-07-24T03-00-00.db
```

> ⚠️ **This script is not shipped in the installer.** `desktop/package.json`'s
> `files` list contains `backend/dist`, not `backend/scripts`, and `tsx` is a
> devDependency — so on a client PC there is currently **no** way to restore a
> backup at all. Recovering a studio machine today means either copying the
> backup `.db` over `studio.db` by hand (stop the app first; delete the
> `-wal`/`-shm` sidecars next to it) or running this script from a dev
> checkout with `DATABASE_URL`/`BACKUP_DIR` pointed at that machine's folders.

### Notes

- The backup command uses the `sqlite3` CLI (online backup API) when available.
  If sqlite3 is not installed, it falls back to a WAL checkpoint + file copy.
- Any backup smaller than **1 KB** is automatically deleted and an error is raised.
  This prevents 0-byte files from silently masquerading as valid backups.
- **Uploads and images are not included** in backups — only the SQLite database.
  If you store photos or files on disk, copy those separately.

---

## Project Layout

```
codes/
├── backend/
│   ├── prisma/
│   │   └── schema.prisma        # Database schema
│   ├── scripts/
│   │   ├── backup.ts            # CLI: create a backup
│   │   └── restore.ts           # CLI: restore from a backup
│   ├── src/
│   │   ├── routes/              # Fastify route handlers
│   │   ├── services/            # Business logic (BillService, BackupService, …)
│   │   ├── middleware/          # Error handler
│   │   ├── types/               # Shared TypeScript types
│   │   ├── utils/               # Zod validators
│   │   ├── seed.ts              # Default data seeder
│   │   └── server.ts            # App entry point
│   ├── .env                     # Local config (never commit)
│   └── package.json
├── database/
│   ├── studio.db                # Live SQLite database (never commit)
│   └── backups/                 # Backup snapshots (never commit)
├── frontend/
│   ├── src/
│   │   ├── api/                 # Axios API clients
│   │   ├── components/          # React components
│   │   ├── pages/               # Route-level pages
│   │   ├── lib/                 # PDF, thermal print, utils
│   │   └── types/               # Shared TypeScript types
│   └── package.json
└── README.md
```

---

## Moving to a New Machine

1. Copy the entire `codes/` folder to the new machine.
2. Copy `database/studio.db` (and `database/backups/` if you want to keep backup history).
3. Install Node.js 20+ on the new machine.
4. Run `npm install` in `codes/`.
5. Run `npm run --workspace=backend db:generate` to regenerate the Prisma client for the new OS.
6. Copy `backend/.env` from the old machine (or recreate it).
7. Start the app as usual.

> The database is a single portable file — no database server to install or migrate.
