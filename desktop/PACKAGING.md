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

# 2. Fresh template database (ships inside the installer; used on first run)
cd backend
DATABASE_URL="file:<ABSOLUTE_PATH_TO_REPO>/desktop/template/studio.db" ./node_modules/.bin/prisma migrate deploy
DATABASE_URL="file:<ABSOLUTE_PATH_TO_REPO>/desktop/template/studio.db" ./node_modules/.bin/tsx src/seed.ts

# 3. Icon (square PNG is generated from frontend/public/Logo.png — see git
#    history for the PowerShell System.Drawing snippet if build/icon-256.png
#    is missing)
cd ../desktop
npm run icon

# 4. Installer → desktop/release/Maestro Billing Setup 1.0.0.exe
npm run dist
```

## Where the installed app keeps data

`%APPDATA%/Maestro Billing/data/`
- `database/studio.db` (+ `database/backups/`)
- `.wwebjs_auth/` — WhatsApp session (scan QR once in Settings)
- `.secret` — generated at first run

Uninstalling keeps this folder, so bills survive reinstalls/updates.

## Requirements on the client PC

- Windows 10/11, 64-bit
- Chrome or Edge installed (Edge ships with Windows) — used headlessly for WhatsApp
- RP 3160 printer installed for thermal printing (app works without it)
