import { FastifyInstance } from 'fastify';
import { BackupService, BackupError } from '../services/BackupService';

export async function backupRoutes(fastify: FastifyInstance) {
  // GET /api/v1/backups — list available backup files
  fastify.get('/', async (_req, reply) => {
    try {
      const svc = new BackupService();
      return reply.send({ success: true, data: svc.list() });
    } catch (err) {
      if (err instanceof BackupError) {
        return reply.status(400).send({ success: false, error: err.message });
      }
      throw err;
    }
  });

  // POST /api/v1/backups — create a new backup
  fastify.post('/', async (_req, reply) => {
    try {
      const svc = new BackupService();
      const filePath = await svc.backup();
      const name = filePath.split(/[\\/]/).pop() ?? filePath;
      return reply.status(201).send({ success: true, data: { name } });
    } catch (err) {
      if (err instanceof BackupError) {
        return reply.status(400).send({ success: false, error: err.message });
      }
      throw err;
    }
  });

  // POST /api/v1/backups/:file/restore — restore from a backup
  // Requires header: X-Confirm-Restore: yes
  fastify.post<{ Params: { file: string } }>('/:file/restore', async (request, reply) => {
    if (request.headers['x-confirm-restore'] !== 'yes') {
      return reply.status(400).send({
        success: false,
        error: 'Send header X-Confirm-Restore: yes to confirm the restore.',
      });
    }

    const { file } = request.params;
    try {
      const svc = new BackupService();
      // Snapshot the current DB first so a mistaken restore is undoable.
      await svc.backup();
      // Close our SQLite handle so Windows lets us replace the file (and no
      // stale connection keeps writing to the old inode). Prisma reconnects
      // automatically on the next query.
      await fastify.prisma.$disconnect();
      svc.restore(file);
      return reply.send({ success: true, message: `Database restored from ${file}` });
    } catch (err) {
      if (err instanceof BackupError) {
        return reply.status(400).send({ success: false, error: err.message });
      }
      throw err;
    }
  });
}
