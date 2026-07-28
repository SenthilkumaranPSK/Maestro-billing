import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { PrismaClient } from '@prisma/client';

/**
 * Applies any migration under prisma/migrations/ not yet recorded in
 * _prisma_migrations — replicates what `prisma migrate deploy` does, but
 * runs directly through the already-bundled @prisma/client instead of
 * shelling out to the separate `prisma` CLI (whose own migration engine
 * isn't reliably resolvable from inside a packaged Electron asar).
 *
 * Needed because an installer upgrade only replaces the app's code —
 * it never touches an existing user's database file. Without this, any
 * release that adds a column/table (e.g. Bill.serviceDates) ships silently
 * broken for every already-installed client ("Error saving bill / Database
 * error") until they wipe and reinstall from scratch, even though a fresh
 * install works fine because its template database was pre-migrated at
 * build time.
 *
 * Writes to the SAME _prisma_migrations table `prisma migrate deploy`/`dev`
 * already use (not a separate tracking table), so a database that already
 * went through real Prisma tooling — every dev DB, every template DB baked
 * at build time — is correctly recognized as already up to date, and the
 * real `prisma` CLI could still inspect a client's copied-out database later
 * if ever needed for support.
 */
export async function runPendingMigrations(prisma: PrismaClient, migrationsDir: string): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "checksum" TEXT NOT NULL,
      "finished_at" DATETIME,
      "migration_name" TEXT NOT NULL,
      "logs" TEXT,
      "rolled_back_at" DATETIME,
      "started_at" DATETIME NOT NULL DEFAULT current_timestamp,
      "applied_steps_count" INTEGER UNSIGNED NOT NULL DEFAULT 0
    )
  `);

  const appliedRows = await prisma.$queryRawUnsafe<Array<{ migration_name: string }>>(
    `SELECT migration_name FROM "_prisma_migrations" WHERE rolled_back_at IS NULL`,
  );
  const applied = new Set(appliedRows.map((r) => r.migration_name));

  if (!fs.existsSync(migrationsDir)) return;
  const folders = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  for (const folder of folders) {
    if (applied.has(folder)) continue;
    const sqlPath = path.join(migrationsDir, folder, 'migration.sql');
    if (!fs.existsSync(sqlPath)) continue;

    const sql = fs.readFileSync(sqlPath, 'utf-8');
    const statements = splitStatements(sql);
    for (const statement of statements) {
      await prisma.$executeRawUnsafe(statement);
    }

    const checksum = crypto.createHash('sha256').update(sql).digest('hex');
    const now = new Date().toISOString();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, started_at, applied_steps_count) VALUES (?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(),
      checksum,
      now,
      folder,
      now,
      statements.length,
    );
  }
}

// Strips /* ... */ block comments and leading "--" line comments, then splits
// on ";" — enough for this project's own migration.sql files (plain
// sequential DDL, no semicolons embedded in string literals or triggers).
function splitStatements(sql: string): string[] {
  const withoutBlockComments = sql.replace(/\/\*[\s\S]*?\*\//g, '');
  const withoutLineComments = withoutBlockComments
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  return withoutLineComments
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
