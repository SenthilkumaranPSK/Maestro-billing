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
 *   - backup() copies the file to backups/ and prunes old ones
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

  // backupPath is under <dbDir>/backups/<timestamp>.db
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

  // The bad backup file must not be left behind.
  const backupsDir = join(dir, 'backups');
  const leftovers = existsSync(backupsDir)
    ? readdirSync(backupsDir).filter((f: string) => f.endsWith('.db'))
    : [];
  assert.equal(leftovers.length, 0, 'a sub-1KB backup must be deleted');

  rmSync(dir, { recursive: true, force: true });
});

test('BackupService: prunes old backups beyond keepCount', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'studio-backup-prune-'));
  const dbFile = join(dir, 'prune.db');
  const backupsDir = join(dir, 'backups');
  mkdirSync(backupsDir, { recursive: true });
  copyFileSync(TEMPLATE_DB, dbFile);

  // Pre-create 5 fake backups directly at the top level of backupsDir —
  // this is the legacy (pre-month-folder) layout, still expected to be
  // read transparently alongside new nested ones. Dated 5 days apart,
  // oldest first.
  for (let i = 0; i < 5; i++) {
    const d = new Date(Date.now() - (5 - i) * 24 * 3600 * 1000);
    const stamp = d.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    writeFileSync(join(backupsDir, `studio_${stamp}.db`), '');
  }
  assert.equal(readdirSync(backupsDir).length, 5);

  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.BACKUP_DIR = backupsDir;
  const { BackupService } = await import(`../src/services/BackupService.ts?cb=${Date.now()}-${Math.random()}-prune`);

  const svc = new BackupService();
  const newBackupPath = await svc.backup(); // creates 1 new + prunes to keep last 30 (no-op, we have 6)

  // The new backup lands under a "YYYY-MM" month subfolder, not flat at
  // backupsDir's top level — verify that explicitly, then use the public
  // list() API (not a raw non-recursive readdir) to count backups, since
  // list() is what's actually responsible for seeing both the 5 legacy
  // flat files and the 1 new nested one as a single unified set.
  assert.match(newBackupPath, /[\\/]\d{4}-\d{2}[\\/]Studio__/, 'new backup should be nested under a YYYY-MM folder');
  assert.equal(svc.list().length, 6, '5 legacy flat + 1 new nested = 6 total');

  rmSync(dir, { recursive: true, force: true });
});

test('BackupService: pruning removes old backups AND the now-empty month folder', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'studio-backup-prune2-'));
  const dbFile = join(dir, 'prune2.db');
  const backupsDir = join(dir, 'backups');
  copyFileSync(TEMPLATE_DB, dbFile);

  // 2 old backups in one month folder — expected to be fully pruned away,
  // including the now-empty folder itself. Year 2000 guarantees these sort
  // as the oldest regardless of when this test actually runs.
  const oldMonthDir = join(backupsDir, '2000-01');
  mkdirSync(oldMonthDir, { recursive: true });
  writeFileSync(join(oldMonthDir, 'studio_2000-01-01T00-00-00.db'), '');
  writeFileSync(join(oldMonthDir, 'studio_2000-01-02T00-00-00.db'), '');

  // 30 backups in a different month folder, dated far in the future (2099)
  // so they always sort as the newest regardless of the real system clock —
  // exactly at keepCount, so all 30 should survive pruning.
  const newMonthDir = join(backupsDir, '2099-01');
  mkdirSync(newMonthDir, { recursive: true });
  for (let i = 0; i < 30; i++) {
    const n = String(i + 1).padStart(2, '0');
    writeFileSync(join(newMonthDir, `studio_2099-01-${n}T00-00-00.db`), '');
  }

  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.BACKUP_DIR = backupsDir;
  const { BackupService } = await import(`../src/services/BackupService.ts?cb=${Date.now()}-${Math.random()}-prune2`);

  const svc = new BackupService();
  // Adds one more real (present-day-dated) backup, sorting between the two
  // synthetic sets — pushing the total to 33, so pruning to keepCount (30)
  // must remove exactly this new one plus the 2 old ones.
  await svc.backup();

  const remaining = svc.list();
  assert.equal(remaining.length, 30, 'pruned down to keepCount (30)');
  assert.ok(!remaining.some((f) => f.name.startsWith('2000-01/')), 'the 2 oldest backups should be gone');
  assert.ok(!existsSync(oldMonthDir), 'the now-empty 2000-01 folder should be removed, not left behind');

  rmSync(dir, { recursive: true, force: true });
});

test('BackupService: repeated manual backups do NOT evict older daily history', async () => {
  // Regression test. Retention used to keep the newest 30 FILES, which was
  // equivalent while backups were strictly one-per-day. Once Settings gained
  // a manual "Backup Now" button, a handful of clicks silently deleted the
  // oldest real daily backups — 30 clicks would leave the studio with 30
  // copies of today and no history at all. Retention now counts distinct
  // DAYS, so same-day manual backups can never push a previous day out.
  const dir = mkdtempSync(join(tmpdir(), 'studio-backup-manual-'));
  const dbFile = join(dir, 'manual.db');
  const backupsDir = join(dir, 'backups');
  copyFileSync(TEMPLATE_DB, dbFile);

  // 29 days of daily history, dated in the past so "today" is strictly newer
  // — 29 + today = exactly the 30-day retention window, so nothing should be
  // aged out and any loss is attributable purely to the manual backups.
  // Under the old file-count budget, 29 history files + 5 manual ones = 34
  // > 30, so four days of real history were silently deleted.
  const monthDir = join(backupsDir, '2026-06');
  mkdirSync(monthDir, { recursive: true });
  for (let day = 1; day <= 29; day++) {
    const dd = String(day).padStart(2, '0');
    writeFileSync(join(monthDir, `Studio__${dd}_06_2026__T__08_00_AM.db`), '');
  }
  assert.equal(readdirSync(monthDir).length, 29);

  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.BACKUP_DIR = backupsDir;
  const { BackupService } = await import(`../src/services/BackupService.ts?cb=${Date.now()}-${Math.random()}-manual`);
  const svc = new BackupService();

  // Five manual "Backup Now" clicks, all landing on today.
  for (let i = 0; i < 5; i++) await svc.backup();

  const surviving = svc.list().map((f) => f.name.slice(f.name.lastIndexOf('/') + 1));
  const juneKept = surviving.filter((n) => n.includes('_06_2026__'));
  assert.equal(juneKept.length, 29, 'every day of daily history must survive repeated manual backups');
  assert.equal(surviving.length - juneKept.length, 5, 'and all 5 of today\'s manual backups are kept too');

  rmSync(dir, { recursive: true, force: true });
});

test('BackupService: two backups in the same minute both survive (no silent overwrite)', async () => {
  // Regression test. The display filename only has minute precision, and the
  // "_2"/"_3" collision suffix used to be chosen by an existsSync() check
  // that ran BEFORE the (potentially multi-second) WAL checkpoint and write
  // — leaving a window where a concurrent backup picked the same name and
  // silently clobbered the first. The name is now reserved atomically.
  const dir = mkdtempSync(join(tmpdir(), 'studio-backup-sameminute-'));
  const dbFile = join(dir, 'sameminute.db');
  copyFileSync(TEMPLATE_DB, dbFile);

  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.BACKUP_DIR = join(dir, 'backups');
  const { BackupService } = await import(`../src/services/BackupService.ts?cb=${Date.now()}-${Math.random()}-sameminute`);
  const svc = new BackupService();

  // Started concurrently, so they genuinely overlap rather than running
  // strictly one after the other.
  const paths = await Promise.all([svc.backup(), svc.backup(), svc.backup()]);
  assert.equal(new Set(paths).size, 3, 'each concurrent backup must get its own filename');
  for (const p of paths) assert.ok(existsSync(p), `${p} should still exist (not overwritten)`);
  assert.equal(svc.list().length, 3);

  rmSync(dir, { recursive: true, force: true });
});

test('BackupService: relative DATABASE_URL is resolved against process.cwd()', async () => {
  // The typical project layout: codes/backend/ is cwd, DATABASE_URL is
  // "file:../../database/studio.db" relative to it. We create a real DB
  // under the backend dir and point a relative DATABASE_URL at it to
  // verify the resolution logic.
  const backendCwd = resolve(process.cwd());
  const localDb = join(backendCwd, '.test-backup-rel.db');
  copyFileSync(TEMPLATE_DB, localDb);
  const localBackups = join(backendCwd, 'backups');

  try {
    // path.isAbsolute() check in the service: "./..." is NOT absolute,
    // so it gets resolved against process.cwd().
    process.env.DATABASE_URL = `file:./.test-backup-rel.db`;
    process.env.BACKUP_DIR = localBackups;
    const { BackupService } = await import(`../src/services/BackupService.ts?cb=${Date.now()}-${Math.random()}-rel`);

    const svc = new BackupService();
    const backupPath = await svc.backup();
    assert.ok(existsSync(backupPath), 'backup should exist at the resolved path');
    // Clean up the backup this test created in backend/backups/.
    try { unlinkSync(backupPath); } catch { /* ignore */ }
  } finally {
    try { unlinkSync(localDb); } catch { /* ignore */ }
    try {
      if (existsSync(localBackups) && readdirSync(localBackups).length === 0) {
        rmSync(localBackups, { recursive: true, force: true });
      }
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
