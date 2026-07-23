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
  assert.match(newBackupPath, /[\\/]\d{4}-\d{2}[\\/]studio_/, 'new backup should be nested under a YYYY-MM folder');
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
