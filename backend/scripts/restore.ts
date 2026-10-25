import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { BackupService, getConfiguredBackupDir } from '../src/services/BackupService';

// Restoring is deliberately not available anywhere in the app — a one-click
// way to discard every bill taken since a backup is too easy to hit by
// mistake. This script is the whole recovery path, so it has to be right.

const fileName = process.argv[2];

if (!fileName) {
  console.error('Usage: npm run restore -- <backup-name>');
  console.error('       npm run restore -- Studio_Backup.db');
  console.error('');
  console.error('Normally just "Studio_Backup.db" — the single backup file kept in the');
  console.error('backup folder (Settings → Database). An older dated backup from before');
  console.error('single-file backups (e.g. "2026-07/studio_2026-07-24T03-00-00.db") also');
  console.error('still works if it\'s still on disk — pass its name exactly as it appears');
  console.error('in the backup folder, including its month subfolder.');
  process.exit(1);
}

if (process.env.CONFIRM !== 'yes') {
  console.error(
    'This command OVERWRITES the live database.\n' +
      'Set CONFIRM=yes to proceed:\n' +
      `  CONFIRM=yes npm run restore -- ${fileName}`,
  );
  process.exit(1);
}

async function main() {
  // The operator can point backups at any folder (Settings → Database), and
  // every other call site resolves that setting before touching BackupService.
  // Constructing it bare here looked in the auto-detected folder instead, so
  // on any studio with a custom backup location this failed to find a backup
  // that plainly exists.
  const prisma = new PrismaClient();
  let svc: BackupService;
  try {
    svc = new BackupService(await getConfiguredBackupDir(prisma));
  } finally {
    await prisma.$disconnect();
  }

  // Do NOT basename() this. Current backups live in a month folder
  // ("2026-07/studio_….db") and resolveBackupPath is built to accept that,
  // sanitizing each segment itself. Stripping the folder turned every
  // documented example into a "backup file not found" — including the one in
  // this script's own usage text.
  console.log(`Backup folder: ${svc.resolvedBackupDir}`);

  // The route this replaced took a safety snapshot first, so a restore of the
  // wrong file was still undoable. Keep that — it is the only thing standing
  // between a mistyped filename and permanent data loss.
  console.log('Taking a safety snapshot of the current database first…');
  const snapshot = await svc.backup();
  console.log(`  saved: ${snapshot}`);

  await svc.restore(fileName);
  console.log(`Database restored from ${fileName}`);
  console.log('Restart Maestro Billing for the change to take effect.');
}

// Previously this was a bare `svc.restore(...)` inside a try/catch with no
// await. restore() is async, so the catch could never see its failure: the
// success line printed immediately and the real error surfaced afterwards as
// an unhandled rejection — the script reported a restore that had not
// happened, which for a disaster-recovery tool is the worst way to fail.
main().catch((err: unknown) => {
  console.error('Restore failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
