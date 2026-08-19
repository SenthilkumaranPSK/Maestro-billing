import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

const MIN_BACKUP_BYTES = 1024; // refuse to keep a backup smaller than 1 KB
const BACKUP_DIR_SETTING_KEY = 'backup_dir';

// A single, fixed-name backup file — overwritten in place on every backup
// rather than accumulating one dated file per run. Simpler and matches how
// the operator actually thinks about it ("the backup", not a growing
// history to manage). Backups made before this change (the old
// "Studio__DD_MM_YYYY__T__HH_MM_AM.db" / "studio_<ISO>.db" names, nested in
// "YYYY-MM" month folders) are left on disk untouched — just no longer
// added to, or shown in list() — resolveBackupPath() can still find one by
// its exact name for a manual restore of an older snapshot.
export const BACKUP_FILE_NAME = 'Studio_Backup.db';

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
    // A RELATIVE path here must resolve the same way Prisma itself resolves
    // it for a SQLite datasource: relative to schema.prisma's own folder
    // (backend/prisma/), not relative to process.cwd(). __dirname here is
    // backend/src/services in dev (tsx runs .ts directly) or
    // backend/dist/services once built — both two levels below backend/, so
    // '..', '..', 'prisma' lands on backend/prisma/ either way. Getting this
    // wrong silently pointed backups at a different, stale database than the
    // one the app's own Prisma client (fastify.prisma) actually reads/writes
    // — same relative DATABASE_URL, two different resolutions, no error
    // either way since both paths can genuinely contain *a* SQLite file.
    //
    // path.resolve() also NORMALIZES separators, which matters more than it
    // looks: an ABSOLUTE path (always the case in the packaged app — see
    // desktop/main.js, which builds DATABASE_URL as
    // 'file:' + dbFile.replace(/\\/g, '/'), forward slashes) passes through
    // path.resolve() unchanged in meaning regardless of the base arguments,
    // so this base-directory change is a no-op for production installs —
    // this bug only ever affected relative-path dev/test setups.
    this.dbPath = path.resolve(__dirname, '..', '..', 'prisma', filePath);

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

  /**
   * Overwrites the single backup file with a fresh copy of the live
   * database. Writes to a uniquely-named temp file first, then atomically
   * renames it over the previous backup — a failed/interrupted backup can
   * never leave a corrupted or half-written file in place of the last good
   * one, and a still-open handle on the old file (e.g. mid-download) keeps
   * reading the old content until the rename, never a torn write.
   */
  async backup(): Promise<string> {
    const srcSize = fs.existsSync(this.dbPath) ? fs.statSync(this.dbPath).size : 0;
    if (srcSize < MIN_BACKUP_BYTES) {
      throw new BackupError(
        `Backup aborted — source database is only ${srcSize} bytes (< 1 KB). ` +
          'Check DATABASE_URL and ensure the database file exists and is not empty.',
      );
    }

    try {
      fs.mkdirSync(this.backupDir, { recursive: true });
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

    const finalPath = path.join(this.backupDir, BACKUP_FILE_NAME);
    // A random suffix, not a fixed ".tmp" name — two backups racing (a
    // manual "Backup Now" click landing right as the daily auto-backup
    // fires, or two operators in two-PC mode both clicking it at once)
    // would otherwise write to and rename from the very same temp path at
    // the same time.
    const tmpPath = `${finalPath}.tmp-${randomUUID()}`;

    try {
      await this.writeBackup(tmpPath);
      // Same directory, so this is an atomic rename, not a copy — the
      // visible backup file is always either the previous one or the fully
      // written new one, never a partial file in between.
      fs.renameSync(tmpPath, finalPath);
      return finalPath;
    } finally {
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch {
        // best effort — a leftover temp file is harmless clutter, not worth
        // failing an otherwise-successful (or already-failed) backup over
      }
    }
  }

  private async writeBackup(backupPath: string): Promise<void> {
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

    // Sanity check — a valid SQLite file must be at least 1 KB. Left for
    // backup()'s own finally-block cleanup to remove — this is always a temp
    // path here, never the live final backup file.
    const size = fs.existsSync(backupPath) ? fs.statSync(backupPath).size : 0;
    if (size < MIN_BACKUP_BYTES) {
      throw new BackupError(
        `Backup aborted — output is only ${size} bytes (< 1 KB). ` +
          'Check DATABASE_URL and ensure the database file exists and is not empty.',
      );
    }
  }

  // Resolves a backup file name to its on-disk path, confined to backupDir.
  // Normally just BACKUP_FILE_NAME, but also accepts an older dated name
  // (bare, or nested under a "YYYY-MM/" month folder from before this
  // change) so those remain restorable by exact name. Each path segment is
  // run through path.basename so neither can escape backupDir via "..",
  // regardless of how many segments are present.
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

  /**
   * The current backup, if one has been taken yet — at most one entry
   * (previously a growing dated history with a 30-day retention window).
   * Older backups left on disk from before this change aren't listed here,
   * but resolveBackupPath()/restore() can still find one by its exact name.
   */
  list(): Array<{ name: string; size: number; createdAt: Date }> {
    const p = path.join(this.backupDir, BACKUP_FILE_NAME);
    if (!fs.existsSync(p)) return [];
    const stat = fs.statSync(p);
    return [{ name: BACKUP_FILE_NAME, size: stat.size, createdAt: stat.mtime }];
  }
}
