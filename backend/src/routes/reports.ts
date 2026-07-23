import { FastifyInstance } from 'fastify';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { ReportService, ReportError, previousMonthYm } from '../services/ReportService';
import { requireAppHeader } from '../middleware/requireAppHeader';

const generateBodySchema = z.object({
  // Defaults to last month (the most recently *completed* month) if omitted —
  // the same month the automatic monthly job would generate.
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

export async function reportRoutes(fastify: FastifyInstance) {
  // GET /api/v1/reports — list generated monthly GST report PDFs
  fastify.get('/', { preHandler: requireAppHeader }, async (_req, reply) => {
    try {
      const svc = new ReportService(fastify.prisma);
      return reply.send({ success: true, data: svc.list() });
    } catch (err) {
      if (err instanceof ReportError) {
        return reply.status(400).send({ success: false, error: err.message });
      }
      throw err;
    }
  });

  // POST /api/v1/reports/generate — build (or rebuild) a month's GST report PDF on demand
  fastify.post('/generate', { preHandler: requireAppHeader }, async (request, reply) => {
    const parsed = generateBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: 'Invalid month — expected YYYY-MM' });
    }
    const ym = parsed.data.month ?? previousMonthYm();
    try {
      const svc = new ReportService(fastify.prisma);
      const filePath = await svc.generateGstReportPdf(ym);
      const name = filePath.split(/[\\/]/).pop() ?? filePath;
      return reply.status(201).send({ success: true, data: { name } });
    } catch (err) {
      if (err instanceof ReportError) {
        return reply.status(400).send({ success: false, error: err.message });
      }
      throw err;
    }
  });

  // GET /api/v1/reports/:file/download — stream a report PDF as an attachment
  // (same native Save-As flow as backup downloads — see desktop/main.js).
  // No requireAppHeader here: the frontend triggers this via a plain
  // `window.location.href` navigation (not axios) so the browser/Electron
  // treats it as a download rather than an XHR — a real navigation can't
  // attach a custom header, so this route stays unauthenticated. It's only
  // exploitable from another origin if HOST is ever changed from the
  // 127.0.0.1 default (see server.ts).
  fastify.get<{ Params: { file: string } }>('/:file/download', async (request, reply) => {
    try {
      const svc = new ReportService(fastify.prisma);
      const filePath = svc.resolveReportPath(request.params.file);
      const name = path.basename(filePath);
      reply.header('Content-Disposition', `attachment; filename="${name}"`);
      reply.type('application/pdf');
      const stream = fs.createReadStream(filePath);
      // resolveReportPath already checked existence, but the file can still
      // vanish between that check and the actual read — createReadStream's
      // 'error' event happens after headers are sent, so the surrounding
      // try/catch can't see it; without this handler it's an unhandled
      // stream error instead of the intended 404.
      stream.on('error', (err) => {
        if (!reply.sent) {
          reply.status(404).send({ success: false, error: `Report file not found: ${name}` });
        } else {
          reply.raw.destroy();
        }
        fastify.log.error({ err, name }, 'Report download stream failed');
      });
      return reply.send(stream);
    } catch (err) {
      if (err instanceof ReportError) {
        return reply.status(404).send({ success: false, error: err.message });
      }
      throw err;
    }
  });
}
