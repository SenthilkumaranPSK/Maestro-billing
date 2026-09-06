# Building MaestroBilling-Setup.exe

Produces a Windows installer the client double-clicks once. The app then runs
fully offline on their PC: its own window, desktop shortcut, database and
backups in their user profile, WhatsApp via their installed Chrome/Edge.

## One-time setup

```bash
cd desktop
npm install
```

## Build steps (run from the repo root)

```bash
# 1. Build both packages
npm run build

# 2. Fresh template database (ships inside the installer; used on first run —
#    see desktop/main.js's TEMPLATE_DB/prepareDataDir(), which fs.copyFileSync()s
#    this file verbatim as the starting database for a genuinely new install).
#    THIS STEP IS EASY TO SKIP — `npm run build` / `npm run dist` do NOT touch
#    desktop/template/studio.db at all, so skipping it silently ships whatever
#    stale template happens to already be sitting there. That exact mistake
#    shipped in 2.5.0: the template hadn't been regenerated since 2026-07-28,
#    before the MM billing module existed, so a genuine first-run install had
#    no mm_products table's worth of data — "MM Products" looked empty even
#    though the schema itself was fine (migrations still ran correctly against
#    the copied file; there was just nothing in the newer tables to show).
#    Delete any existing template first — prisma migrate deploy only APPLIES
#    migrations to whatever's already at that path, it doesn't create a DB
#    from scratch.
rm -f "<ABSOLUTE_PATH_TO_REPO>/desktop/template/studio.db"
cd backend
DATABASE_URL="file:<ABSOLUTE_PATH_TO_REPO>/desktop/template/studio.db" ./node_modules/.bin/prisma migrate deploy
DATABASE_URL="file:<ABSOLUTE_PATH_TO_REPO>/desktop/template/studio.db" ./node_modules/.bin/tsx src/seed.ts
# Checkpoint the WAL into the main file — the copy in main.js only copies the
# single .db file, no -wal/-shm sidecars, so any uncommitted WAL data would
# otherwise just be silently missing from every fresh install.
sqlite3 "<ABSOLUTE_PATH_TO_REPO>/desktop/template/studio.db" "PRAGMA wal_checkpoint(TRUNCATE);"

# 3. Icon (square PNG is generated from frontend/public/Logo.png — see git
#    history for the PowerShell System.Drawing snippet if build/icon-256.png
#    is missing)
cd ../desktop
npm run icon

# 4. Installer → desktop/release/Maestro Billing Setup 1.0.0.exe
npm run dist
```

## Where the installed app keeps data

`%APPDATA%/Maestro Billing/data/` — unless relocated on first run (main.js
asks once where to put `studio.db`; see `db-location.json` in the same
folder for the pointer to wherever it ended up):
- `database/studio.db`
- `.wwebjs_auth/` — WhatsApp session (scan QR once in Settings)

Uninstalling keeps this folder, so bills survive reinstalls/updates.

Backups are deliberately NOT under `%APPDATA%` — `BackupService` defaults to
`D:\Billing` (falling back to `E:\Billing`, then finally to a `backups/`
folder next to `studio.db` on a single-drive PC with neither), so a backup
survives even if the app's own drive/profile is lost.

There is a single, fixed-name backup file (`Studio_Backup.db`,
`BACKUP_FILE_NAME`), overwritten in place — not a growing dated history.
It's refreshed on every app boot and every 24 hours while the app stays
running, and the operator can also refresh it any time with
Settings → Database → **Backup Now**; all of those just overwrite the same
file. Written to a temp file and renamed into place atomically, so a
failed/interrupted backup can never corrupt the last good one. Backups made
before this change (dated names in `YYYY-MM/` month folders) are left on disk
untouched but are no longer added to or shown in the app's backup list.

## Known workspace quirks

**TypeScript / `@fastify/*` plugins.** `npm install` at the repo root can
hoist a `@fastify/*` plugin (e.g. `@fastify/static`, `@fastify/jwt`) into the
root `node_modules` instead of keeping it beside `backend/node_modules/fastify`.
TypeScript then can't resolve that plugin's `declare module 'fastify'`
augmentation and `tsc` fails on things like `reply.sendFile`. Fix: copy the
plugin folder from the root into `backend/node_modules/@fastify/<name>` so it
sits next to the `fastify` package it augments. Only affects local
type-checking — the packaged app ships pre-built `dist/`, so it never hits
this at runtime.

**WhatsApp / puppeteer at packaging time.** `puppeteer-extra` (and its stealth
plugin) consistently gets hoisted to the workspace root, but its own
transitive deps (`puppeteer-core`, `@puppeteer/browsers`, ...) sometimes land
in `backend/node_modules` instead depending on how a given `npm install`
resolved things. Since code in the packaged app can only resolve **upward**
(app/backend/node_modules → app/node_modules, never the reverse), a package
living in app/node_modules must find everything IT needs at that same level
or higher — if part of its dependency tree only exists one level down in
app/backend/node_modules, WhatsApp fails at boot with a `MODULE_NOT_FOUND` on
something like `@puppeteer/browsers`, silently (caught, logged, WhatsApp just
never connects). `npm run stage` (part of `npm run dist`) now handles this
automatically — it merges staged backend deps into staged root deps so root
is always a complete superset. If you ever build without going through
`stage`, or add new puppeteer-family packages, re-check this.

**`puppeteer-core` must be pinned to the exact same version in the root
`package.json` and `backend/package.json`** (currently `24.38.0`, no caret).
A version *mismatch* between the two (even a minor-version drift like
24.38.0 vs 24.43.1) can make npm install two separate copies with
incompatible internal dependency resolutions — this once manifested as
`ERR_REQUIRE_ESM` on `@puppeteer/browsers` deep inside `puppeteer-core`,
crashing WhatsApp init at boot. If you bump one, bump the other to match,
exactly.

## Requirements on the client PC

- Windows 10/11, 64-bit
- Chrome or Edge installed (Edge ships with Windows) — used headlessly for WhatsApp
- RP 3160 printer installed for thermal printing (app works without it)
