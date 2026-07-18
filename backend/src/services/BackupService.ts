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

    this.backupDir = path.resolve(path.dirname(this.dbPath), 'backups');
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
      // Fallback: flush WAL to the main file, then copy.
      // This is safe as long as no write is in progress, which is true for a
      // single-user local app that is idle during the backup.
      const tmp = new PrismaClient({
        datasources: { db: { url: `file:${this.dbPath}` } },
      });
      try {
        await tmp.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)');
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

  restore(fileName: string): void {
    // Only allow a plain filename, not a path traversal
    const safe = path.basename(fileName);
    const src = path.join(this.backupDir, safe);

    if (!fs.existsSync(src)) {
      throw new BackupError(`Backup file not found: ${safe}`);
    }

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
