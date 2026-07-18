import { FastifyInstance } from 'fastify';
import { settingSchema, bulkSettingsSchema } from '../utils/validators';
import { BackupService, BackupError } from '../services/BackupService';

export async function settingsRoutes(fastify: FastifyInstance) {
  const prisma = fastify.prisma;

  fastify.get('/', async (request, reply) => {
    const query = request.query as { group?: string };
    const settings = await prisma.setting.findMany({
      where: query.group ? { group: query.group } : {},
      orderBy: [{ group: 'asc' }, { key: 'asc' }],
    });

    const grouped = settings.reduce(
      (acc, s) => {
        const grp = acc[s.group] ?? {};
        acc[s.group] = grp;
        grp[s.key] = s.value;
        return acc;
      },
      {} as Record<string, Record<string, string>>,
    );

    return reply.send({ success: true, data: grouped });
  });

  fastify.put('/', async (request, reply) => {
    const body = settingSchema.parse(request.body);
    const setting = await prisma.setting.upsert({
      where: { key: body.key },
      create: { key: body.key, value: body.value, group: body.group ?? 'general' },
      update: { value: body.value, group: body.group ?? 'general' },
    });
    return reply.send({ success: true, data: setting });
  });

  // Bulk update settings
  fastify.put('/bulk', async (request, reply) => {
    const body = bulkSettingsSchema.parse(request.body);
    const updates = await Promise.all(
      body.map((s) =>
        prisma.setting.upsert({
          where: { key: s.key },
          create: { key: s.key, value: s.value, group: s.group ?? 'general' },
          update: { value: s.value },
        }),
      ),
    );
    return reply.send({ success: true, data: updates });
  });

  fastify.post('/backup', async (_request, reply) => {
    try {
      // Instantiated lazily — the constructor throws if the DB file is missing,
      // and doing that at route-registration time would crash the whole server.
      const backupPath = await new BackupService().backup();
      return reply.send({ success: true, data: { path: backupPath } });
    } catch (err) {
      fastify.log.error({ err }, 'Manual backup failed');
      // BackupError messages are written for the operator; anything else
      // stays generic so internals never leak into a response.
      const msg = err instanceof BackupError ? err.message : 'Backup failed';
      return reply.status(500).send({ success: false, error: msg });
    }
  });
}
