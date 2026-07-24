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

// Backups deliberately live off the same drive as the app/database, so a
// failing C: drive (or a botched install/uninstall) can't take the database
// AND its safety net down together. D:\Billing is tried first, then
// E:\Billing, for whichever drive actually exists on this PC; a single-drive
// PC (no D: or E:) falls back to the old sibling-of-the-database folder.
const PREFERRED_BACKUP_DIRS = ['D:\\Billing', 'E:\\Billing'];

export class BackupService {
  private readonly dbPath: string;
  private readonly backupDir: string;

  constructor() {
    const dbUrl = process.env.DATABASE_URL ?? 'file:../../database/studio.db';
    const filePath = dbUrl.replace(/^file:/, '');
    this.dbPath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(process.cwd(), filePath);

    if (!fs.existsSync(this.dbPath)) {
      throw new BackupError(
        `DATABASE_URL points to a non-existent file: ${this.dbPath}`,
      );
    }

    this.backupDir = BackupService.resolveBackupDir(this.dbPath);
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
    return path.parse(this.dbPath).root.toLowerCase() !== path.parse(this.backupDir).root.toLowerCase();
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
    if (!fs.existsSync(monthDir)) {
      fs.mkdirSync(monthDir, { recursive: true });
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
          const rows = await tmp.$queryRawUnsafe<Array<{ busy: number }>>(
            'PRAGMA wal_checkpoint(TRUNCATE)',
          );
          busy = rows[0]?.busy ?? 0;
          if (busy !== 0 && attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
        if (busy !== 0) {
          console.warn(
            'Backup: WAL checkpoint stayed busy after retries — this backup may be missing the most recent writes.',
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

  private pruneOldBackups(keepCount: number): void {
    const files = this.list();
    const toDelete = files.slice(keepCount);
    for (const f of toDelete) {
      fs.unlinkSync(path.join(this.backupDir, f.name));
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
        fs.rmdirSync(dir);
      }
    }
  }
}
