import 'dotenv/config';
import path from 'path';
import { BackupService } from '../src/services/BackupService';

const fileName = process.argv[2];

if (!fileName) {
  console.error('Usage: npm run restore -- <backup-filename>');
  console.error('       tsx scripts/restore.ts studio_2025-01-01T12-00-00.db');
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

try {
  const svc = new BackupService();
  svc.restore(path.basename(fileName));
  console.log(`Database restored from ${fileName}`);
} catch (err: unknown) {
  console.error('Restore failed:', err instanceof Error ? err.message : err);
  process.exit(1);
}
