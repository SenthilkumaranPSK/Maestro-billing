/**
 * Shared test setup. Imported at the top of every test file. Performs
 * one-time, file-level work:
 *
 *   1. Point DATABASE_URL at a unique temp SQLite file so the test DB is
 *      isolated from dev data.
 *   2. Run `prisma db push --force-reset --skip-generate` against that file
 *      to materialize the schema (faster than running migrations for an
 *      ephemeral DB).
 *   3. Export a singleton `prisma` client and a `reset()` helper that
 *      truncates every table — call it from `beforeEach` to start each
 *      test from a clean slate.
 *
 * Note: BackupService reads `process.env.DATABASE_URL` at construction
 * time. Tests that need to control the env path must set it before
 * importing BackupService — i.e. before this setup module evaluates
 * `new PrismaClient()`. The order in the test file (import `setup.ts`
 * first, then `BackupService.ts`) handles this naturally.
 */
import { execSync } from 'node:child_process';
import { existsSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const DB_FILE = join(tmpdir(), `studio-test-${randomUUID()}.db`);

process.env.DATABASE_URL = `file:${DB_FILE}`;

// Run prisma db push to materialize the schema. --force-reset so a stale
// file from a prior run is overwritten. --skip-generate because the
// client is already generated for the project schema.
// Use the LOCAL prisma binary — `npx prisma` can resolve a newer cached
// Prisma major whose CLI flags differ.
const prismaBin = join(process.cwd(), 'node_modules', '.bin', 'prisma');
execSync(`"${prismaBin}" db push --force-reset --skip-generate --accept-data-loss`, {
  stdio: 'pipe',
  shell: process.platform === 'win32' ? 'cmd.exe' : undefined,
  env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
});

// Best-effort cleanup of the temp file on process exit. Test files may
// register hooks that need the DB to still exist when the process exits,
// so we only delete the file — Prisma is already disconnected by then.
process.on('exit', () => {
  try {
    if (existsSync(DB_FILE)) unlinkSync(DB_FILE);
  } catch {
    // ignore — best effort
  }
});

export const prisma = new PrismaClient();

/**
 * Wipe all rows from every table. We disable FK checks (SQLite doesn't
 * support them globally; we just delete in dependency order) and reset
 * autoincrement counters by deleting from sqlite_sequence.
 */
export async function reset(): Promise<void> {
  // Order matters: child tables before parents. mmStockMovement references
  // both bill and mmProduct, so it has to go before either of those.
  await prisma.mmStockMovement.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.billItem.deleteMany();
  await prisma.bill.deleteMany();
  await prisma.product.deleteMany();
  await prisma.mmProduct.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.mmCustomer.deleteMany();
  await prisma.log.deleteMany();
  await prisma.setting.deleteMany();
  await prisma.user.deleteMany();
}

export const DB_FILE_PATH = DB_FILE;
