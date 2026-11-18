import { FastifyInstance } from 'fastify';
import { settingSchema, bulkSettingsSchema } from '../utils/validators';
import { BackupService, BackupError, getConfiguredBackupDir } from '../services/BackupService';
import { requireAppHeader } from '../middleware/requireAppHeader';

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

  
  // Verify Security PIN endpoint
  fastify.post('/verify-pin', { preHandler: requireAppHeader }, async (request, reply) => {
    const body = request.body as { pin?: string };
    const passwordSetting = await prisma.setting.findUnique({
      where: { key: 'bill_edit_password' },
    });
    const correctPin = passwordSetting?.value || '1234567890';
    const isValid = Boolean(body?.pin && body.pin.trim() === correctPin);
    return reply.send({ success: true, valid: isValid });
  });

  fastify.put('/', { preHandler: requireAppHeader }, async (request, reply) => {
    const body = settingSchema.parse(request.body);

    if (body.key === 'bill_edit_password' || body.key === 'bill_edit_protection_enabled') {
      const isProtectionOn = (await prisma.setting.findUnique({ where: { key: 'bill_edit_protection_enabled' } }))?.value !== 'false';
      if (isProtectionOn) {
        const currentPinSetting = await prisma.setting.findUnique({ where: { key: 'bill_edit_password' } });
        const currentPin = currentPinSetting?.value || '1234567890';
        const providedPin = request.headers['x-current-security-pin'] as string | undefined;
        if (!providedPin || providedPin !== currentPin) {
          return reply.status(403).send({ success: false, error: 'Current Security PIN is required to change security settings' });
        }
      }
    }
    const setting = await prisma.setting.upsert({
      where: { key: body.key },
      create: { key: body.key, value: body.value, group: body.group ?? 'general' },
      update: { value: body.value, group: body.group ?? 'general' },
    });
    return reply.send({ success: true, data: setting });
  });

  // Bulk update settings
  fastify.put('/bulk', { preHandler: requireAppHeader }, async (request, reply) => {
    const body = bulkSettingsSchema.parse(request.body);

    const touchesSecurity = body.some((s) => s.key === 'bill_edit_password' || s.key === 'bill_edit_protection_enabled');
    if (touchesSecurity) {
      const isProtectionOn = (await prisma.setting.findUnique({ where: { key: 'bill_edit_protection_enabled' } }))?.value !== 'false';
      if (isProtectionOn) {
        const currentPinSetting = await prisma.setting.findUnique({ where: { key: 'bill_edit_password' } });
        const currentPin = currentPinSetting?.value || '1234567890';
        const providedPin = request.headers['x-current-security-pin'] as string | undefined;
        if (!providedPin || providedPin !== currentPin) {
          return reply.status(403).send({ success: false, error: 'Current Security PIN is required to change security settings' });
        }
      }
    }
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

  fastify.post('/backup', { preHandler: requireAppHeader }, async (_request, reply) => {
    try {
      // Instantiated lazily — the constructor throws if the DB file is missing,
      // and doing that at route-registration time would crash the whole server.
      const customDir = await getConfiguredBackupDir(prisma);
      const backupPath = await new BackupService(customDir).backup();
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
