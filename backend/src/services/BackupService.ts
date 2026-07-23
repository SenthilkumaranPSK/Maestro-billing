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
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupFileName = `studio_${timestamp}.db`;
    const backupPath = path.join(this.backupDir, backupFileName);

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

  // Resolves a backup file name to its on-disk path, confined to backupDir
  // (path.basename strips any directory traversal) and confirmed to exist.
  resolveBackupPath(fileName: string): string {
    const safe = path.basename(fileName);
    const src = path.join(this.backupDir, safe);
    if (!fs.existsSync(src)) {
      throw new BackupError(`Backup file not found: ${safe}`);
    }
    return src;
  }

  restore(fileName: string): void {
    const src = this.resolveBackupPath(fileName);
    const size = fs.statSync(src).size;
    if (size < MIN_BACKUP_BYTES) {
      throw new BackupError(
        `Refusing to restore — backup is only ${size} bytes (< 1 KB)`,
      );
    }

    // Write to a temp file first, then atomically rename over the live DB.
    const tmp = `${this.dbPath}.restore-tmp`;
    fs.copyFileSync(src, tmp);
    fs.renameSync(tmp, this.dbPath);

    // Drop the old database's WAL/SHM sidecar files — SQLite would otherwise
    // replay the stale WAL onto the freshly restored file and corrupt it.
    for (const suffix of ['-wal', '-shm']) {
      const sidecar = this.dbPath + suffix;
      if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
    }
  }

  list(): Array<{ name: string; size: number; createdAt: Date }> {
    if (!fs.existsSync(this.backupDir)) return [];
    return fs
      .readdirSync(this.backupDir)
      .filter((f) => f.endsWith('.db'))
      .map((f) => {
        const stat = fs.statSync(path.join(this.backupDir, f));
        return { name: f, size: stat.size, createdAt: stat.mtime };
      })
      // Sort by filename (it embeds the ISO timestamp), newest first. File
      // mtime is unreliable on Windows — CopyFileW preserves the source's
      // timestamp, so copied backups can share identical mtimes.
      .sort((a, b) => b.name.localeCompare(a.name));
  }

  private pruneOldBackups(keepCount: number): void {
    const files = this.list();
    files
      .slice(keepCount)
      .forEach((f) => fs.unlinkSync(path.join(this.backupDir, f.name)));
  }
}
