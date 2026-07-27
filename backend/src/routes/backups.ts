import { FastifyInstance } from 'fastify';
import fs from 'fs';
import path from 'path';
import {
  BackupService,
  BackupError,
  getConfiguredBackupDir,
  setConfiguredBackupDir,
} from '../services/BackupService';
import { requireAppHeader } from '../middleware/requireAppHeader';

export async function backupRoutes(fastify: FastifyInstance) {
  // GET /api/v1/backups — list available backup files
  fastify.get('/', { preHandler: requireAppHeader }, async (_req, reply) => {
    try {
      const customDir = await getConfiguredBackupDir(fastify.prisma);
      const svc = new BackupService(customDir);
      return reply.send({
        success: true,
        data: svc.list(),
        meta: {
          onSeparateDrive: svc.onSeparateDrive,
          backupDir: svc.resolvedBackupDir,
          isCustomBackupDir: svc.isCustomBackupDir,
        },
      });
    } catch (err) {
      if (err instanceof BackupError) {
        return reply.status(400).send({ success: false, error: err.message });
      }
      throw err;
    }
  });

  // GET /api/v1/backups/location — the operator-configured backup folder,
  // if one has been set (Settings → Database → Backup Location).
  fastify.get('/location', { preHandler: requireAppHeader }, async (_req, reply) => {
    const dir = await getConfiguredBackupDir(fastify.prisma);
    return reply.send({ success: true, data: { path: dir ?? null } });
  });

  // PUT /api/v1/backups/location — set a custom backup folder, or clear it
  // (empty/omitted path) to revert to automatic D:\Billing / E:\Billing /
  // same-drive-fallback detection. Validated before saving — a bad path
  // (unwritable, unreachable) is rejected immediately rather than only
  // surfacing on the next automatic backup.
  fastify.put<{ Body: { path?: string } }>('/location', { preHandler: requireAppHeader }, async (request, reply) => {
    const raw = (request.body?.path ?? '').trim();
    try {
      await setConfiguredBackupDir(fastify.prisma, raw);
    } catch (err) {
      if (err instanceof BackupError) {
        return reply.status(400).send({ success: false, error: err.message });
      }
      throw err;
    }
    return reply.send({ success: true, data: { path: raw || null } });
  });

  // GET /api/v1/backups/:file/download — stream a backup file as an
  // attachment. The desktop shell intercepts this download and shows a
  // native Save As dialog (see desktop/main.js), so the operator can save
  // the copy anywhere they like (USB drive, cloud-synced folder, etc.)
  // instead of only the app's internal backups folder.
  // No requireAppHeader here: the frontend triggers this via a plain
  // `window.location.href` navigation (not axios), which can't attach a
  // custom header — so this route stays unauthenticated.
  //
  // This used to say it was "only exploitable if HOST is ever changed from
  // the 127.0.0.1 default". Two-PC mode (desktop/main.js, Connection Setup →
  // sharing) now changes exactly that, on purpose. While sharing is on, any
  // device on the studio LAN can list backups via GET /backups and pull the
  // whole SQLite database through this route. Accepted for a private studio
  // network with no login anywhere in the app, but it is the single most
  // valuable thing exposed — if auth is ever added, start here.
  fastify.get<{ Params: { file: string } }>('/:file/download', async (request, reply) => {
    try {
      const customDir = await getConfiguredBackupDir(fastify.prisma);
      const svc = new BackupService(customDir);
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
      const customDir = await getConfiguredBackupDir(fastify.prisma);
      const svc = new BackupService(customDir);
      const filePath = await svc.backup();
      // Relative to backupDir (e.g. "2026-07/studio_....db"), not just the
      // bare filename — resolveBackupPath() needs the month-folder prefix
      // to find it again for a subsequent download/restore call.
      const name = path.relative(svc.resolvedBackupDir, filePath).replace(/\\/g, '/');
      return reply.status(201).send({ success: true, data: { name } });
    } catch (err) {
      if (err instanceof BackupError) {
        return reply.status(400).send({ success: false, error: err.message });
      }
      throw err;
    }
  });

  // NOTE: there is deliberately no restore route. Restoring is a destructive,
  // one-click way for the operator to wipe every bill created since a backup,
  // so it is kept out of the billing UI entirely — and out of the HTTP API,
  // which two-PC mode now exposes to the whole studio LAN.
  //
  // Recovery instead lives in the desktop shell: Alt → Setup → Restore from
  // Backup… (desktop/main.js), which does the swap at restart, before the
  // database is opened. `backend/scripts/restore.ts` is the equivalent for a
  // dev checkout. Both take a safety snapshot of the current database first.
}
