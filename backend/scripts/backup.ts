import 'dotenv/config';
import { BackupService } from '../src/services/BackupService';

async function main() {
  const svc = new BackupService();
  const filePath = await svc.backup();
  console.log(`Backup created: ${filePath}`);
}

main().catch((err: unknown) => {
  console.error('Backup failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
