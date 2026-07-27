import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { PrismaClient } from '@prisma/client';

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

const MIN_BACKUP_BYTES = 1024; // refuse to keep a backup smaller than 1 KB
const BACKUP_DIR_SETTING_KEY = 'backup_dir';

// Backups deliberately live off the same drive as the app/database, so a
// failing C: drive (or a botched install/uninstall) can't take the database
// AND its safety net down together. D:\Billing is tried first, then
// E:\Billing, for whichever drive actually exists on this PC; a single-drive
// PC (no D: or E:) falls back to the old sibling-of-the-database folder.
// An operator-configured location (Settings → Database) takes priority over
// all of this — see the `customBackupDir` constructor param.
const PREFERRED_BACKUP_DIRS = ['D:\\Billing', 'E:\\Billing'];

// Every call site that constructs a BackupService needs to resolve the same
// operator-configured location first, or different requests (list/create/
// download/restore) could each land on a different folder. Centralized here
// so that can never drift.
export async function getConfiguredBackupDir(prisma: PrismaClient): Promise<string | undefined> {
  const setting = await prisma.setting.findUnique({ where: { key: BACKUP_DIR_SETTING_KEY } });
  return setting?.value?.trim() || undefined;
}

export async function setConfiguredBackupDir(prisma: PrismaClient, dir: string): Promise<void> {
  const trimmed = dir.trim();
  if (trimmed) assertBackupDirUsable(trimmed);
  await prisma.setting.upsert({
    where: { key: BACKUP_DIR_SETTING_KEY },
    create: { key: BACKUP_DIR_SETTING_KEY, value: trimmed, group: 'backup' },
    update: { value: trimmed },
  });
}

// Confirms a path can actually be used as a backup location — creates it if
// missing, then proves it's genuinely writable (a directory can already
// exist but be read-only, which a bare existence check wouldn't catch).
// Used when the operator sets a custom location, so a bad path is rejected
// immediately instead of silently failing on the next automatic backup.
export function assertBackupDirUsable(dir: string): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-test-${Date.now()}`);
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
  } catch (err) {
    throw new BackupError(
      `Can't use "${dir}" as a backup location: ${err instanceof Error ? err.message : String(err)}. ` +
        'Check the path exists (or can be created) and is writable.',
    );
  }
}

export class BackupService {
  private readonly dbPath: string;
  private readonly backupDir: string;
  readonly isCustomBackupDir: boolean;

  constructor(customBackupDir?: string) {
    const dbUrl = process.env.DATABASE_URL ?? 'file:../../database/studio.db';
    const filePath = dbUrl.replace(/^file:/, '');
    // path.resolve() rather than using an absolute path verbatim: it also
    // NORMALIZES separators, which matters more than it looks.
    //
    // The packaged app builds DATABASE_URL as
    // 'file:' + dbFile.replace(/\\/g, '/') (desktop/main.js), so in production
    // this arrives as "C:/Users/.../studio.db" with forward slashes, while
    // backupDir is always built with path.join/resolve and comes out with
    // backslashes. path.parse() then reports the drive root as "C:/" for one
    // and "C:\" for the other — different strings for the same drive, which
    // made onSeparateDrive below silently return true on every packaged
    // install. Dev and the test suite both pass native backslash paths, so
    // the bug only ever existed in the shipped app.
    this.dbPath = path.resolve(filePath);

    if (!fs.existsSync(this.dbPath)) {
      throw new BackupError(
        `DATABASE_URL points to a non-existent file: ${this.dbPath}`,
      );
    }

    const trimmedCustom = customBackupDir?.trim();
    if (trimmedCustom) {
      this.backupDir = path.resolve(trimmedCustom);
      this.isCustomBackupDir = true;
    } else {
      this.backupDir = BackupService.resolveBackupDir(this.dbPath);
      this.isCustomBackupDir = false;
    }
  }

  /**
   * True only when backups actually land on a different drive letter than
   * the live database — the thing PREFERRED_BACKUP_DIRS is meant to
   * guarantee. On a single-drive PC (no D:/E:) this is false: backups fall
   * back to a folder next to the live database, so a failed/stolen/wiped
   * drive would take out the database AND every backup together. The
   * Settings page surfaces this so it's never a silent false sense of
   * security.
   */
  get onSeparateDrive(): boolean {
    // Both sides go through path.resolve() again here rather than trusting
    // the stored values: getting this wrong doesn't throw, it just quietly
    // tells the operator their backups are safe when they aren't, which is
    // the exact failure this flag exists to prevent.
    const driveOf = (p: string) => path.parse(path.resolve(p)).root.toLowerCase();
    return driveOf(this.dbPath) !== driveOf(this.backupDir);
  }

  get resolvedBackupDir(): string {
    return this.backupDir;
  }

  private static resolveBackupDir(dbPath: string): string {
    // Escape hatch for tests (and anyone who wants a specific location) —
    // otherwise this resolution depends on which drives happen to exist on
    // whatever machine it runs on.
    if (process.env.BACKUP_DIR) return process.env.BACKUP_DIR;
    for (const dir of PREFERRED_BACKUP_DIRS) {
      if (fs.existsSync(dir.slice(0, 3))) return dir; // e.g. "D:\"
    }
    return path.resolve(path.dirname(dbPath), 'backups');
  }

  async backup(): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    // Grouped into a per-month subfolder (e.g. "2026-07") so a growing
    // history of daily backups doesn't just pile up as one flat folder of
    // loose files — makes it obvious at a glance which month a backup is
    // from when browsing the folder directly (not just in the app's list).
    const monthFolder = timestamp.slice(0, 7);
    const monthDir = path.join(this.backupDir, monthFolder);
    try {
      if (!fs.existsSync(monthDir)) {
        fs.mkdirSync(monthDir, { recursive: true });
      }
    } catch (err) {
      // Covers a configured/detected drive that's no longer reachable (a
      // USB drive unplugged, a mapped network drive disconnected) — without
      // this, the caller would see a raw Node ENOENT/EPERM instead of a
      // clear, actionable message.
      throw new BackupError(
        `Backup aborted — could not access the backup location at ${this.backupDir}: ` +
          `${err instanceof Error ? err.message : String(err)}. Check that it's still connected and writable.`,
      );
    }

    const backupFileName = `studio_${timestamp}.db`;
    const backupPath = path.join(monthDir, backupFileName);

    // Prefer the sqlite3 CLI — it uses the online backup API, which is WAL-safe
    // and works even while the DB is being written to.
    const cliResult = spawnSync(
      'sqlite3',
      [this.dbPath, `.backup ${backupPath.replace(/\\/g, '/')}`],
      { timeout: 30_000, encoding: 'utf8' },
    );

    if (cliResult.status !== 0) {
      // Fallback: flush WAL to the main file, then copy. This is the path
      // actually used on essentially every real operator PC — the sqlite3
      // CLI above isn't bundled with the app and isn't a stock Windows
      // component, so `cliResult.status !== 0` is the common case, not a
      // rare edge case.
      const tmp = new PrismaClient({
        datasources: { db: { url: `file:${this.dbPath}` } },
      });
      try {
        // Without busy_timeout, a checkpoint that can't get the write lock
        // right away (a bill save in flight) gives up immediately rather
        // than waiting — wait up to 5s for the lock instead of bailing.
        await tmp.$queryRawUnsafe('PRAGMA busy_timeout=5000');
        // wal_checkpoint returns one row: (busy, log, checkpointed). busy=1
        // means it couldn't get exclusive access and only partially
        // checkpointed — the copy below would then be structurally valid
        // but silently missing the most recent transactions. Retry a few
        // times (busy_timeout already covers most of the wait) before
        // proceeding anyway — a slightly stale backup beats none.
        let busy = 1;
        for (let attempt = 0; attempt < 3 && busy !== 0; attempt++) {
          const rows = await tmp.$queryRawUnsafe<Array<{ busy: bigint | number }>>(
            'PRAGMA wal_checkpoint(TRUNCATE)',
          );
          // SQLite's integer columns come back as BigInt via $queryRawUnsafe
          // — Number() it before comparing, since `0n !== 0` is true in JS
          // (no cross-type coercion across !==), which previously made this
          // "busy" check fire on every checkpoint, busy or not.
          busy = Number(rows[0]?.busy ?? 0);
          if (busy !== 0 && attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
        if (busy !== 0) {
          // Don't silently copy a file that's known to be missing recent
          // writes — a backup that looks successful but is quietly stale is
          // worse than no backup, since nobody has a reason to double-check
          // it before relying on it in a real restore.
          throw new BackupError(
            'Backup aborted — the database is busy and the WAL checkpoint could not complete after retries. Try again shortly.',
          );
        }
      } finally {
        await tmp.$disconnect();
      }
      fs.copyFileSync(this.dbPath, backupPath);
    }

    // Sanity check — a valid SQLite file must be at least 1 KB.
    const size = fs.existsSync(backupPath) ? fs.statSync(backupPath).size : 0;
    if (size < MIN_BACKUP_BYTES) {
      if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
      throw new BackupError(
        `Backup aborted — output is only ${size} bytes (< 1 KB). ` +
          'Check DATABASE_URL and ensure the database file exists and is not empty.',
      );
    }

    this.pruneOldBackups(30);
    return backupPath;
  }

  // Resolves a backup file name to its on-disk path, confined to backupDir.
  // `fileName` is either a bare name (legacy backups made before month
  // folders existed) or "YYYY-MM/studio_....db" (current scheme) — each
  // segment is run through path.basename so neither can escape backupDir via
  // "..", regardless of how many segments are present.
  resolveBackupPath(fileName: string): string {
    const segments = fileName
      .replace(/\\/g, '/')
      .split('/')
      .filter(Boolean)
      .map((segment) => path.basename(segment));
    const src = path.join(this.backupDir, ...segments);
    if (!fs.existsSync(src)) {
      throw new BackupError(`Backup file not found: ${fileName}`);
    }
    return src;
  }

  async restore(fileName: string): Promise<void> {
    const src = this.resolveBackupPath(fileName);
    const size = fs.statSync(src).size;
    if (size < MIN_BACKUP_BYTES) {
      throw new BackupError(
        `Refusing to restore — backup is only ${size} bytes (< 1 KB)`,
      );
    }

    // Drop the live database's own WAL/SHM sidecars BEFORE swapping in the
    // restored file, not after — once the file underneath changes, a stale
    // WAL no longer corresponds to it and SQLite would try to apply it on
    // the next connection. (Safe to remove first: the caller already took
    // a fresh safety-snapshot backup and disconnected Prisma before calling
    // this, so nothing has a reason to touch these sidecars in between.)
    for (const suffix of ['-wal', '-shm']) {
      const sidecar = this.dbPath + suffix;
      if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
    }

    // Write to a temp file first, then atomically rename over the live DB.
    const tmp = `${this.dbPath}.restore-tmp`;
    fs.copyFileSync(src, tmp);

    // Windows can throw EBUSY/EPERM if something still briefly holds a
    // handle on the live file right after the caller's Prisma disconnect —
    // retry on a real delay a few times before giving up, rather than
    // failing outright on what's normally a momentary lock.
    for (let attempt = 1; ; attempt++) {
      try {
        fs.renameSync(tmp, this.dbPath);
        return;
      } catch (err) {
        if (attempt >= 5) {
          try {
            fs.unlinkSync(tmp);
          } catch {
            // best effort — the rename error below is the one that matters
          }
          throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
  }

  // `name` is "YYYY-MM/studio_....db" for backups made under the current
  // month-folder scheme, or a bare filename for legacy backups made before
  // it existed (still supported so older backups don't just disappear from
  // the list) — resolveBackupPath()/pruneOldBackups() both accept either.
  list(): Array<{ name: string; size: number; createdAt: Date }> {
    if (!fs.existsSync(this.backupDir)) return [];
    const results: Array<{ name: string; size: number; createdAt: Date }> = [];

    for (const entry of fs.readdirSync(this.backupDir, { withFileTypes: true })) {
      if (entry.isDirectory() && /^\d{4}-\d{2}$/.test(entry.name)) {
        const monthDir = path.join(this.backupDir, entry.name);
        for (const f of fs.readdirSync(monthDir)) {
          if (!f.endsWith('.db')) continue;
          const stat = fs.statSync(path.join(monthDir, f));
          results.push({ name: `${entry.name}/${f}`, size: stat.size, createdAt: stat.mtime });
        }
      } else if (entry.isFile() && entry.name.endsWith('.db')) {
        const stat = fs.statSync(path.join(this.backupDir, entry.name));
        results.push({ name: entry.name, size: stat.size, createdAt: stat.mtime });
      }
    }

    // Sort by the base filename (it embeds the ISO timestamp), newest first,
    // ignoring any month-folder prefix so nesting never affects ordering.
    // File mtime is unreliable on Windows — CopyFileW preserves the source's
    // timestamp, so copied backups can share identical mtimes.
    const baseName = (name: string) => name.slice(name.lastIndexOf('/') + 1);
    return results.sort((a, b) => baseName(b.name).localeCompare(baseName(a.name)));
  }

  // Called as the last step of a backup that has ALREADY succeeded — a
  // pruning failure (a locked/permission-denied old file) must never
  // propagate and make the caller think the fresh backup itself failed.
  // Best-effort: log and move on, don't abort the rest of the cleanup either.
  private pruneOldBackups(keepCount: number): void {
    const files = this.list();
    const toDelete = files.slice(keepCount);
    for (const f of toDelete) {
      try {
        fs.unlinkSync(path.join(this.backupDir, f.name));
      } catch (err) {
        console.warn(`Backup prune: could not delete old backup ${f.name}:`, err);
      }
    }
    // Clean up any month folder left empty by the deletions above so old
    // backups don't leave a trail of empty dated folders behind forever.
    const touchedMonthDirs = new Set(
      toDelete
        .filter((f) => f.name.includes('/'))
        .map((f) => path.join(this.backupDir, f.name.slice(0, f.name.indexOf('/')))),
    );
    for (const dir of touchedMonthDirs) {
      if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
        try {
          fs.rmdirSync(dir);
        } catch (err) {
          console.warn(`Backup prune: could not remove empty folder ${dir}:`, err);
        }
      }
    }
  }
}
