/**
 * Tests for runPendingMigrations (backend/src/utils/runMigrations.ts).
 *
 * This is the single thing standing between a Prisma schema change and a
 * repeat of the v2.3.0 incident: an installer upgrade replaces the app's
 * code but never an existing client's database, so any release that adds a
 * column/table ships silently broken for every already-installed client
 * unless this runner brings their database up to schema at boot. It had no
 * test coverage at all before this file.
 *
 * Covers:
 *   - The actual v2.3.0 scenario: upgrading a database that only has the
 *     migrations from BEFORE `add_service_dates` (with a real row already in
 *     it) all the way up to the project's current full migration set.
 *   - Idempotency: running it twice never re-applies or double-records.
 *   - Atomicity: a migration file with a bad statement rolls back entirely —
 *     no half-applied schema, no _prisma_migrations row for it — instead of
 *     bricking the app on next boot with "table already exists".
 *   - Comment stripping (line + block comments, including a semicolon
 *     embedded inside a comment) doesn't corrupt statement splitting.
 *   - Missing migrations directory / a migration folder with no
 *     migration.sql are both no-ops, not crashes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { runPendingMigrations } from '../src/utils/runMigrations.ts';

const REAL_MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'migrations');

function newTempDb(): { dbFile: string; prisma: PrismaClient } {
  const dir = mkdtempSync(join(tmpdir(), 'studio-migrations-'));
  const dbFile = join(dir, 'test.db');
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${dbFile}` } } });
  return { dbFile, prisma };
}

function realMigrationFolders(): string[] {
  return readdirSync(REAL_MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

test('runPendingMigrations: upgrades an old-schema DB (pre-service_dates, with a real row) to the current full schema — the actual v2.3.0 scenario', async () => {
  const allFolders = realMigrationFolders();
  const cutoff = allFolders.findIndex((f) => f.includes('add_service_dates'));
  assert.ok(cutoff > 0, 'expected to find the add_service_dates migration in the real migrations directory');
  const oldFolders = allFolders.slice(0, cutoff); // everything strictly before it

  // Build a migrations dir that only contains the "old install" migrations —
  // simulates a client running a build from before service_dates existed.
  const oldMigrationsDir = mkdtempSync(join(tmpdir(), 'studio-old-migrations-'));
  for (const folder of oldFolders) {
    cpSync(join(REAL_MIGRATIONS_DIR, folder), join(oldMigrationsDir, folder), { recursive: true });
  }

  const { dbFile, prisma } = newTempDb();
  try {
    await runPendingMigrations(prisma, oldMigrationsDir);

    // A real bill, saved on the old schema, before service_dates ever existed.
    await prisma.$executeRawUnsafe(
      `INSERT INTO "bills" ("bill_number", "bill_date", "sub_total", "grand_total", "status", "updated_at")
       VALUES (?, ?, ?, ?, ?, ?)`,
      '049/2026', '2026-07-11T10:00:00.000Z', 11800, 11800, 'PAID', '2026-07-11T10:00:00.000Z',
    );

    // Confirm service_dates genuinely doesn't exist yet on the old schema —
    // otherwise the rest of this test wouldn't actually be proving anything.
    const oldColumns = await prisma.$queryRawUnsafe<Array<{ name: string }>>('PRAGMA table_info("bills")');
    assert.ok(!oldColumns.some((c) => c.name === 'service_dates'), 'sanity check: old schema must not have service_dates yet');

    // The upgrade: point the runner at the REAL, full migrations directory —
    // exactly what server.ts's main() does on every boot.
    await runPendingMigrations(prisma, REAL_MIGRATIONS_DIR);

    // The pre-existing bill must have survived the upgrade untouched.
    const bills = await prisma.$queryRawUnsafe<Array<{ bill_number: string; sub_total: number; grand_total: number }>>(
      'SELECT bill_number, sub_total, grand_total FROM "bills" WHERE bill_number = ?',
      '049/2026',
    );
    assert.equal(bills.length, 1, 'the bill saved under the old schema must still be there after upgrading');
    assert.equal(bills[0]!.sub_total, 11800);
    assert.equal(bills[0]!.grand_total, 11800);

    // New columns/tables from every migration after the cutoff must now exist.
    const newColumns = await prisma.$queryRawUnsafe<Array<{ name: string }>>('PRAGMA table_info("bills")');
    assert.ok(newColumns.some((c) => c.name === 'service_dates'), 'service_dates column should exist after upgrading');
    assert.ok(newColumns.some((c) => c.name === 'series'), 'series column (MM support) should exist after upgrading');

    const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      `SELECT name FROM sqlite_master WHERE type='table'`,
    );
    const tableNames = tables.map((t) => t.name);
    for (const expected of ['mm_products', 'mm_customers', 'mm_stock_movements']) {
      assert.ok(tableNames.includes(expected), `${expected} table should exist after upgrading`);
    }

    // Every migration folder — old AND new — must be recorded as applied.
    const applied = await prisma.$queryRawUnsafe<Array<{ migration_name: string }>>(
      'SELECT migration_name FROM "_prisma_migrations" WHERE rolled_back_at IS NULL',
    );
    const appliedNames = new Set(applied.map((r) => r.migration_name));
    for (const folder of allFolders) {
      assert.ok(appliedNames.has(folder), `${folder} should be recorded as applied`);
    }
  } finally {
    await prisma.$disconnect();
    rmSync(oldMigrationsDir, { recursive: true, force: true });
    try {
      const dir = join(dbFile, '..');
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

test('runPendingMigrations: running it twice is a no-op the second time (idempotent)', async () => {
  const { dbFile, prisma } = newTempDb();
  try {
    await runPendingMigrations(prisma, REAL_MIGRATIONS_DIR);
    const afterFirst = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
      'SELECT COUNT(*) as n FROM "_prisma_migrations"',
    );

    await runPendingMigrations(prisma, REAL_MIGRATIONS_DIR); // must not throw, must not re-apply

    const afterSecond = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
      'SELECT COUNT(*) as n FROM "_prisma_migrations"',
    );
    assert.equal(Number(afterSecond[0]!.n), Number(afterFirst[0]!.n), 'a second run must not add duplicate rows');
    assert.equal(Number(afterSecond[0]!.n), realMigrationFolders().length, 'one row per real migration folder');
  } finally {
    await prisma.$disconnect();
    rmSync(join(dbFile, '..'), { recursive: true, force: true });
  }
});

test('runPendingMigrations: a migration file that fails partway is rolled back entirely, not half-applied', async () => {
  // This is the guarantee CLAUDE.md/PROJECT_HISTORY.md call out explicitly:
  // this project's own migration history already contains multi-statement
  // RedefineTables rebuilds, so a crash mid-file must never leave a table
  // created with nothing recorded — the next boot would then fail forever
  // with "table already exists" while retrying from the top.
  const badMigrationsDir = mkdtempSync(join(tmpdir(), 'studio-bad-migration-'));
  const folder = '99999999999999_broken';
  mkdirSync(join(badMigrationsDir, folder), { recursive: true });
  writeFileSync(
    join(badMigrationsDir, folder, 'migration.sql'),
    `CREATE TABLE "test_atomic" ("id" INTEGER NOT NULL PRIMARY KEY);\nINSERT INTO "table_that_does_not_exist" ("x") VALUES (1);\n`,
  );

  const { dbFile, prisma } = newTempDb();
  try {
    await assert.rejects(() => runPendingMigrations(prisma, badMigrationsDir));

    const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name = 'test_atomic'`,
    );
    assert.equal(tables.length, 0, 'the CREATE TABLE from the failed migration must have been rolled back, not left half-applied');

    const applied = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
      'SELECT COUNT(*) as n FROM "_prisma_migrations" WHERE migration_name = ?',
      folder,
    );
    assert.equal(Number(applied[0]!.n), 0, 'a failed migration must not be recorded as applied');
  } finally {
    await prisma.$disconnect();
    rmSync(badMigrationsDir, { recursive: true, force: true });
    rmSync(join(dbFile, '..'), { recursive: true, force: true });
  }
});

test('runPendingMigrations: strips line and block comments (including a semicolon inside a comment) before splitting statements', async () => {
  const commentedDir = mkdtempSync(join(tmpdir(), 'studio-comment-migration-'));
  const folder = '00000000000001_commented';
  mkdirSync(join(commentedDir, folder), { recursive: true });
  writeFileSync(
    join(commentedDir, folder, 'migration.sql'),
    [
      '-- a leading comment with a ; semicolon inside it, must not split here',
      '/* a block comment;',
      '   spanning multiple lines; also with semicolons */',
      'CREATE TABLE "comment_test" ("id" INTEGER NOT NULL PRIMARY KEY, "name" TEXT);',
      '-- another comment; before the next real statement',
      'INSERT INTO "comment_test" ("id", "name") VALUES (1, \'ok\');',
      '',
    ].join('\n'),
  );

  const { dbFile, prisma } = newTempDb();
  try {
    await runPendingMigrations(prisma, commentedDir);
    const rows = await prisma.$queryRawUnsafe<Array<{ id: number; name: string }>>(
      'SELECT id, name FROM "comment_test"',
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.name, 'ok');
  } finally {
    await prisma.$disconnect();
    rmSync(commentedDir, { recursive: true, force: true });
    rmSync(join(dbFile, '..'), { recursive: true, force: true });
  }
});

test('runPendingMigrations: a missing migrations directory is a no-op, not a crash', async () => {
  const { dbFile, prisma } = newTempDb();
  try {
    const missingDir = join(tmpdir(), `studio-missing-migrations-${randomUUID()}`);
    assert.ok(!existsSync(missingDir));
    await assert.doesNotReject(() => runPendingMigrations(prisma, missingDir));
  } finally {
    await prisma.$disconnect();
    rmSync(join(dbFile, '..'), { recursive: true, force: true });
  }
});

test('runPendingMigrations: a migration folder with no migration.sql is skipped, not fatal', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'studio-empty-folder-migration-'));
  // A folder that exists (e.g. left behind by a partial checkout) but has no
  // migration.sql inside it at all.
  mkdirSync(join(dir, '00000000000002_no_sql_file'), { recursive: true });

  const { dbFile, prisma } = newTempDb();
  try {
    await assert.doesNotReject(() => runPendingMigrations(prisma, dir));
    const applied = await prisma.$queryRawUnsafe<Array<{ n: number }>>('SELECT COUNT(*) as n FROM "_prisma_migrations"');
    assert.equal(Number(applied[0]!.n), 0, 'a folder with no migration.sql must not be recorded as applied');
  } finally {
    await prisma.$disconnect();
    rmSync(dir, { recursive: true, force: true });
    rmSync(join(dbFile, '..'), { recursive: true, force: true });
  }
});
