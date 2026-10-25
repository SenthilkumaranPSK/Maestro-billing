/**
 * Tests for BackupService. BackupService reads `process.env.DATABASE_URL`
 * at construction time and validates the file exists. To exercise the
 * env-var resolution path, each test sets the env var BEFORE importing
 * or instantiating BackupService.
 *
 * We use a small dance: dynamically import the module AFTER setting the
 * env var, so the BackupService constructor sees the test path.
 *
 * BackupService refuses to keep any backup smaller than 1 KB (corruption
 * guard), so the source DB in these tests must be a REAL SQLite file —
 * a 0-byte "touch" would be rejected by design. We materialize one real
 * schema DB via `prisma db push` and copy it wherever a test needs a DB.
 *
 * Tests cover:
 *   - DB file path resolves from `process.env.DATABASE_URL` + `process.cwd()`
 *   - Missing DB file throws a clear error
 *   - Absolute path in DATABASE_URL is used as-is (no cwd prefix)
 *   - backup() always writes the single fixed-name file and overwrites it
 *     in place on repeated calls — no accumulating dated history
 *   - A failed backup never corrupts the previous good one (temp + rename)
 *   - Older dated backups left on disk (pre single-file scheme) are not
 *     added to or shown in list(), but remain restorable by exact name
 *   - A custom backup dir (operator-configured location) is used and flagged
 *   - assertBackupDirUsable / getConfiguredBackupDir / setConfiguredBackupDir
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

// One-time: build a real SQLite DB (with the project schema) to copy from.
const TEMPLATE_DB = join(tmpdir(), `studio-backup-template-${randomUUID()}.db`);
const prismaBin = join(process.cwd(), 'node_modules', '.bin', 'prisma');
execSync(`"${prismaBin}" db push --force-reset --skip-generate --accept-data-loss`, {
  stdio: 'pipe',
  shell: process.platform === 'win32' ? 'cmd.exe' : undefined,
  env: { ...process.env, DATABASE_URL: `file:${TEMPLATE_DB}` },
});

process.on('exit', () => {
  try {
    if (existsSync(TEMPLATE_DB)) unlinkSync(TEMPLATE_DB);
  } catch {
    // best effort
  }
});

test('BackupService: reads DB path from process.env.DATABASE_URL', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'studio-backup-'));
  const dbFile = join(dir, 'mydb.db');
  copyFileSync(TEMPLATE_DB, dbFile);

  process.env.DATABASE_URL = `file:${dbFile}`;
  // Pin the backup dir explicitly — production prefers D:\Billing/E:\Billing
  // when present, which would make this test's expectations depend on
  // whatever drives happen to exist on the machine running it.
  process.env.BACKUP_DIR = join(dir, 'backups');
  // Dynamic import so the module reads the env var we just set
  const { BackupService } = await import(`../src/services/BackupService.ts?cb=${Date.now()}`);

  const svc = new BackupService();
  const backupPath = await svc.backup();

  assert.ok(existsSync(backupPath), 'backup file should exist');
  assert.ok(backupPath.endsWith('.db'), 'backup should be a .db file');
  assert.ok(backupPath.includes('backups'), 'backup should be in a backups/ dir');

  rmSync(dir, { recursive: true, force: true });
});

test('BackupService: throws with a clear error when DB file is missing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'studio-backup-missing-'));
  const missing = join(dir, 'does-not-exist.db');

  process.env.DATABASE_URL = `file:${missing}`;
  const { BackupService } = await import(`../src/services/BackupService.ts?cb=${Date.now()}-${Math.random()}`);

  assert.throws(
    () => new BackupService(),
    /DATABASE_URL points to a non-existent file/,
  );

  rmSync(dir, { recursive: true, force: true });
});

test('BackupService: absolute path in DATABASE_URL is used as-is', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'studio-backup-abs-'));
  const dbFile = join(dir, 'abs.db');
  copyFileSync(TEMPLATE_DB, dbFile);

  // On Windows, paths look like "C:\\..." which already starts with a drive
  // letter. We expect BackupService to use the absolute path verbatim,
  // not re-resolve it against cwd.
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.BACKUP_DIR = join(dir, 'backups');
  const { BackupService } = await import(`../src/services/BackupService.ts?cb=${Date.now()}-${Math.random()}-abs`);

  const svc = new BackupService();
  const backupPath = await svc.backup();

  // backupPath is under <dbDir>/backups/<fixed-name>
  assert.ok(backupPath.startsWith(dir), `expected backup under ${dir}, got ${backupPath}`);

  rmSync(dir, { recursive: true, force: true });
});

test('BackupService: rejects a backup smaller than 1 KB', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'studio-backup-tiny-'));
  const dbFile = join(dir, 'tiny.db');
  // A 0-byte source produces a 0-byte copy — the guard must delete it and throw.
  writeFileSync(dbFile, '');

  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.BACKUP_DIR = join(dir, 'backups');
  const { BackupService } = await import(`../src/services/BackupService.ts?cb=${Date.now()}-${Math.random()}-tiny`);

  const svc = new BackupService();
  await assert.rejects(() => svc.backup(), /Backup aborted/);

  // No leftover backup — nor a leftover temp file — must be left behind.
  const backupsDir = join(dir, 'backups');
  const leftovers = existsSync(backupsDir) ? readdirSync(backupsDir) : [];
  assert.equal(leftovers.length, 0, 'a sub-1KB backup (and its temp file) must be cleaned up');

  rmSync(dir, { recursive: true, force: true });
});

test('BackupService: backup() always writes the single fixed-name file, no dated history', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'studio-backup-single-'));
  const dbFile = join(dir, 'single.db');
  const backupsDir = join(dir, 'backups');
  copyFileSync(TEMPLATE_DB, dbFile);

  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.BACKUP_DIR = backupsDir;
  const { BackupService, BACKUP_FILE_NAME } = await import(
    `../src/services/BackupService.ts?cb=${Date.now()}-${Math.random()}-single`
  );

  const svc = new BackupService();
  const first = await svc.backup();
  const second = await svc.backup();
  const third = await svc.backup();

  assert.equal(first, second, 'every call returns the same fixed path');
  assert.equal(second, third, 'every call returns the same fixed path');
  assert.equal(first, join(backupsDir, BACKUP_FILE_NAME));

  // Exactly one .db file on disk — no month folders, no per-run dated names.
  const entries = readdirSync(backupsDir, { withFileTypes: true });
  const dbFiles = entries.filter((e: { isFile: () => boolean; name: string }) => e.isFile() && e.name.endsWith('.db'));
  assert.equal(dbFiles.length, 1, 'exactly one backup file, not one per run');
  assert.equal(dbFiles[0]!.name, BACKUP_FILE_NAME);
  assert.equal(entries.some((e: { isDirectory: () => boolean }) => e.isDirectory()), false, 'no month subfolders');

  assert.equal(svc.list().length, 1);
  assert.equal(svc.list()[0]!.name, BACKUP_FILE_NAME);

  // No leftover temp files from any of the three runs.
  assert.equal(entries.filter((e: { name: string }) => e.name.includes('.tmp-')).length, 0);

  rmSync(dir, { recursive: true, force: true });
});

test('BackupService: backup() reflects the latest source content after each overwrite', async () => {
  // Mutates the source DB through a real Prisma write (not a raw byte
  // append) between two backups — SQLite's on-disk format doesn't
  // necessarily grow in step with raw file size the way appending garbage
  // bytes would suggest (a `.backup`/checkpoint copy operates at the
  // logical page level, not "however many bytes the file happens to be"),
  // so a genuine committed write is what actually proves an overwrite
  // picked up the latest state.
  const dir = mkdtempSync(join(tmpdir(), 'studio-backup-content-'));
  const dbFile = join(dir, 'content.db');
  const backupsDir = join(dir, 'backups');
  copyFileSync(TEMPLATE_DB, dbFile);

  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.BACKUP_DIR = backupsDir;
  const { BackupService, BACKUP_FILE_NAME } = await import(
    `../src/services/BackupService.ts?cb=${Date.now()}-${Math.random()}-content`
  );
  const svc = new BackupService();

  const backupFile = join(backupsDir, BACKUP_FILE_NAME);
  const firstPath = await svc.backup();
  const firstHash = readFileSync(backupFile).toString('base64');

  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${dbFile}` } } });
  await prisma.setting.create({ data: { key: 'test-marker', value: randomUUID(), group: 'test' } });
  await prisma.$disconnect();

  const secondPath = await svc.backup();
  const secondHash = readFileSync(backupFile).toString('base64');

  assert.equal(firstPath, secondPath, 'still the same fixed file');
  assert.notEqual(secondHash, firstHash, 'the overwritten backup should reflect the new committed write');

  // And the backup file itself is queryable and actually has the new row —
  // not just "some bytes changed somewhere".
  const backupPrisma = new PrismaClient({ datasources: { db: { url: `file:${backupFile}` } } });
  const marker = await backupPrisma.setting.findUnique({ where: { key: 'test-marker' } });
  await backupPrisma.$disconnect();
  assert.ok(marker, 'the backup should contain the row written after the first backup');

  rmSync(dir, { recursive: true, force: true });
});

test('BackupService: a failed backup does not corrupt the previous good one', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'studio-backup-failsafe-'));
  const dbFile = join(dir, 'failsafe.db');
  const backupsDir = join(dir, 'backups');
  copyFileSync(TEMPLATE_DB, dbFile);

  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.BACKUP_DIR = backupsDir;
  const { BackupService, BACKUP_FILE_NAME } = await import(
    `../src/services/BackupService.ts?cb=${Date.now()}-${Math.random()}-failsafe`
  );
  const svc = new BackupService();

  const goodPath = await svc.backup();
  const goodBytes = readFileSync(goodPath);
  assert.ok(goodBytes.length >= 1024);

  // Truncate the "live" database below the 1KB floor so the next backup()
  // call is guaranteed to fail its sanity check, without touching the
  // already-written good backup.
  writeFileSync(dbFile, Buffer.alloc(10));
  await assert.rejects(() => svc.backup());

  // The existing backup file must be untouched — same bytes as before the
  // failed attempt, not truncated/half-written by the rename-over-temp step.
  const stillThere = readFileSync(join(backupsDir, BACKUP_FILE_NAME));
  assert.deepEqual(stillThere, goodBytes, 'the last good backup must survive a failed overwrite attempt');

  // And no leftover temp file from the failed attempt.
  const leftoverTemps = readdirSync(backupsDir).filter((f: string) => f.includes('.tmp-'));
  assert.equal(leftoverTemps.length, 0);

  rmSync(dir, { recursive: true, force: true });
});

test('BackupService: older dated backups from before single-file backups are left alone', async () => {
  // Regression guard for the migration to a single overwritten file: an
  // already-installed studio's 30 days of dated backups must not be touched
  // or deleted by the new code, even though they're no longer added to.
  const dir = mkdtempSync(join(tmpdir(), 'studio-backup-legacy-'));
  const dbFile = join(dir, 'legacy.db');
  const backupsDir = join(dir, 'backups');
  copyFileSync(TEMPLATE_DB, dbFile);

  const monthDir = join(backupsDir, '2026-06');
  mkdirSync(monthDir, { recursive: true });
  writeFileSync(join(monthDir, 'Studio__15_06_2026__T__08_00_AM.db'), 'x'.repeat(2000));
  writeFileSync(join(backupsDir, 'studio_2026-05-01T00-00-00.db'), 'y'.repeat(2000));

  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.BACKUP_DIR = backupsDir;
  const { BackupService, BACKUP_FILE_NAME } = await import(
    `../src/services/BackupService.ts?cb=${Date.now()}-${Math.random()}-legacy`
  );
  const svc = new BackupService();

  await svc.backup();

  // The old files are still exactly where they were.
  assert.ok(existsSync(join(monthDir, 'Studio__15_06_2026__T__08_00_AM.db')));
  assert.ok(existsSync(join(backupsDir, 'studio_2026-05-01T00-00-00.db')));

  // list() only ever surfaces the current single backup, not the old ones.
  const listed = svc.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0]!.name, BACKUP_FILE_NAME);

  // But an old one is still resolvable/restorable by its exact name.
  const resolved = svc.resolveBackupPath('2026-06/Studio__15_06_2026__T__08_00_AM.db');
  assert.ok(existsSync(resolved));

  rmSync(dir, { recursive: true, force: true });
});

test('BackupService: a relative DATABASE_URL resolves the same way Prisma resolves it (relative to backend/prisma/, not process.cwd())', async () => {
  // Regression test for a real, pre-existing bug: Prisma resolves a relative
  // SQLite DATABASE_URL relative to schema.prisma's own folder
  // (backend/prisma/) — not process.cwd(). BackupService used to do
  // path.resolve(filePath), which resolves against cwd instead. With this
  // project's actual .env value ("file:../../database/studio.db") and cwd
  // == backend/ (the normal case when running `npm run dev:backend`), the
  // two resolutions land on two DIFFERENT files two directories apart:
  // Prisma correctly reaches codes/database/studio.db (the real, live
  // database fastify.prisma actually reads/writes), while the old
  // cwd-relative code silently reached one level further outside the repo
  // entirely — so every backup silently captured a stale, disconnected
  // database with no error either way, since both paths can genuinely
  // contain *a* SQLite file. Now both must resolve to the same place.
  const prismaDir = resolve(process.cwd(), 'prisma');
  const localDb = join(prismaDir, '.test-backup-relprisma.db');
  copyFileSync(TEMPLATE_DB, localDb);
  const localBackups = join(prismaDir, '.test-backups-relprisma');

  try {
    process.env.DATABASE_URL = `file:./.test-backup-relprisma.db`;
    process.env.BACKUP_DIR = localBackups;
    const { BackupService } = await import(
      `../src/services/BackupService.ts?cb=${Date.now()}-${Math.random()}-relprisma`
    );

    // Constructing it at all proves the resolved path exists — the old,
    // cwd-relative code would have thrown "non-existent file" here instead,
    // since .test-backup-relprisma.db was never created under cwd.
    const svc = new BackupService();
    const backupPath = await svc.backup();
    assert.ok(existsSync(backupPath), 'backup should exist at the resolved path');
  } finally {
    try { unlinkSync(localDb); } catch { /* ignore */ }
    try {
      if (existsSync(localBackups)) rmSync(localBackups, { recursive: true, force: true });
    } catch { /* ignore */ }
  }
});

test('BackupService: a custom backup dir passed to the constructor is used and flagged', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'studio-backup-custom-'));
  const dbFile = join(dir, 'mydb.db');
  copyFileSync(TEMPLATE_DB, dbFile);
  const customDir = join(dir, 'my-custom-location');

  process.env.DATABASE_URL = `file:${dbFile}`;
  delete process.env.BACKUP_DIR; // make sure the env-var escape hatch isn't masking the constructor param
  const { BackupService } = await import(`../src/services/BackupService.ts?cb=${Date.now()}-${Math.random()}-custom`);

  const svc = new BackupService(customDir);
  assert.equal(svc.isCustomBackupDir, true);
  assert.equal(svc.resolvedBackupDir, customDir);

  const backupPath = await svc.backup();
  assert.ok(backupPath.startsWith(customDir), `expected backup under ${customDir}, got ${backupPath}`);

  rmSync(dir, { recursive: true, force: true });
});

test('BackupService: no custom dir passed falls back to auto-detection, not flagged as custom', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'studio-backup-nocustom-'));
  const dbFile = join(dir, 'mydb.db');
  copyFileSync(TEMPLATE_DB, dbFile);

  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.BACKUP_DIR = join(dir, 'backups');
  const { BackupService } = await import(`../src/services/BackupService.ts?cb=${Date.now()}-${Math.random()}-nocustom`);

  const svc = new BackupService();
  assert.equal(svc.isCustomBackupDir, false);

  rmSync(dir, { recursive: true, force: true });
});

test('BackupService: onSeparateDrive is false when DATABASE_URL uses forward slashes', async () => {
  // Regression test. The packaged desktop app builds DATABASE_URL as
  // 'file:' + dbFile.replace(/\\/g, '/'), so it arrives with FORWARD slashes,
  // while backupDir is always built with path.join and uses backslashes.
  // path.parse() then reported the drive root as "C:/" vs "C:\" — different
  // strings for the same drive — so onSeparateDrive returned true on every
  // packaged install, and the "your backups are on the same drive as the
  // database" warning in Settings could never appear on the single-drive PCs
  // it exists to warn. Dev and every other test here pass native backslash
  // paths, which is why this only ever broke in the shipped app.
  const dir = mkdtempSync(join(tmpdir(), 'studio-backup-slash-'));
  const dbFile = join(dir, 'mydb.db');
  copyFileSync(TEMPLATE_DB, dbFile);

  process.env.DATABASE_URL = `file:${dbFile.replace(/\\/g, '/')}`;
  process.env.BACKUP_DIR = join(dir, 'backups'); // same drive, deliberately
  const { BackupService } = await import(`../src/services/BackupService.ts?cb=${Date.now()}-${Math.random()}-slash`);

  const svc = new BackupService();
  assert.equal(
    svc.onSeparateDrive,
    false,
    'database and backups are on the same drive, so this must be false regardless of path separator',
  );

  rmSync(dir, { recursive: true, force: true });
});

test('assertBackupDirUsable: accepts a creatable, writable path', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'studio-backup-assert-ok-'));
  const target = join(dir, 'nested', 'location');
  const { assertBackupDirUsable } = await import(`../src/services/BackupService.ts?cb=${Date.now()}-${Math.random()}-assertok`);

  assert.doesNotThrow(() => assertBackupDirUsable(target));
  assert.ok(existsSync(target), 'the path should have been created');

  rmSync(dir, { recursive: true, force: true });
});

test('assertBackupDirUsable: rejects a path under a drive letter that does not exist', async () => {
  const { assertBackupDirUsable, BackupError } = await import(`../src/services/BackupService.ts?cb=${Date.now()}-${Math.random()}-assertbad`);

  // Z: essentially never exists on a normal dev/CI machine — a stand-in for
  // "a USB drive that isn't actually plugged in".
  assert.throws(() => assertBackupDirUsable('Z:\\definitely-not-a-real-drive\\Billing'), BackupError);
});

test('getConfiguredBackupDir / setConfiguredBackupDir: round-trips through the Setting table', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'studio-backup-setting-'));
  const dbFile = join(dir, 'setting.db');
  copyFileSync(TEMPLATE_DB, dbFile);

  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${dbFile}` } } });
  const { getConfiguredBackupDir, setConfiguredBackupDir } = await import(
    `../src/services/BackupService.ts?cb=${Date.now()}-${Math.random()}-setting`
  );

  assert.equal(await getConfiguredBackupDir(prisma), undefined, 'unset by default');

  const target = join(dir, 'chosen-location');
  await setConfiguredBackupDir(prisma, target);
  assert.equal(await getConfiguredBackupDir(prisma), target);

  // Clearing with an empty string reverts to "unset" (auto-detection).
  await setConfiguredBackupDir(prisma, '');
  assert.equal(await getConfiguredBackupDir(prisma), undefined);

  await prisma.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

test('setConfiguredBackupDir: rejects and does not persist an unusable path', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'studio-backup-setting-bad-'));
  const dbFile = join(dir, 'setting.db');
  copyFileSync(TEMPLATE_DB, dbFile);

  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${dbFile}` } } });
  const { getConfiguredBackupDir, setConfiguredBackupDir } = await import(
    `../src/services/BackupService.ts?cb=${Date.now()}-${Math.random()}-settingbad`
  );

  await assert.rejects(() => setConfiguredBackupDir(prisma, 'Z:\\definitely-not-a-real-drive\\Billing'));
  assert.equal(await getConfiguredBackupDir(prisma), undefined, 'the bad path must not have been saved');

  await prisma.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});
