import { FastifyInstance } from 'fastify';
import fs from 'fs';
import path from 'path';
import { BackupService, BackupError } from '../services/BackupService';
import { requireAppHeader } from '../middleware/requireAppHeader';

export async function backupRoutes(fastify: FastifyInstance) {
  // GET /api/v1/backups — list available backup files
  fastify.get('/', { preHandler: requireAppHeader }, async (_req, reply) => {
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

  // GET /api/v1/backups/:file/download — stream a backup file as an
  // attachment. The desktop shell intercepts this download and shows a
  // native Save As dialog (see desktop/main.js), so the operator can save
  // the copy anywhere they like (USB drive, cloud-synced folder, etc.)
  // instead of only the app's internal backups folder.
  // No requireAppHeader here: the frontend triggers this via a plain
  // `window.location.href` navigation (not axios), which can't attach a
  // custom header — so this route stays unauthenticated. Only exploitable
  // from another origin if HOST is ever changed from the 127.0.0.1 default.
  fastify.get<{ Params: { file: string } }>('/:file/download', async (request, reply) => {
    try {
      const svc = new BackupService();
      const filePath = svc.resolveBackupPath(request.params.file);
      const name = path.basename(filePath);
      reply.header('Content-Disposition', `attachment; filename="${name}"`);
      reply.type('application/octet-stream');
      const stream = fs.createReadStream(filePath);
      // resolveBackupPath already checked existence, but the file can still
      // vanish between that check and the actual read — createReadStream's
      // 'error' event happens after headers are sent, so the surrounding
      // try/catch can't see it; without this handler it's an unhandled
      // stream error instead of the intended 404.
      stream.on('error', (err) => {
        if (!reply.sent) {
          reply.status(404).send({ success: false, error: `Backup file not found: ${name}` });
        } else {
          reply.raw.destroy();
        }
        fastify.log.error({ err, name }, 'Backup download stream failed');
      });
      return reply.send(stream);
    } catch (err) {
      if (err instanceof BackupError) {
        return reply.status(404).send({ success: false, error: err.message });
      }
      throw err;
    }
  });

  // POST /api/v1/backups — create a new backup
  fastify.post('/', { preHandler: requireAppHeader }, async (_req, reply) => {
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
