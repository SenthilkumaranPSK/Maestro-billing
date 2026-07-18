import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { phoneSchema } from '../utils/validators';

const sendPdfSchema = z.object({
  phone: phoneSchema,
  // ~10 MB of PDF once base64-decoded; the server bodyLimit backs this up.
  pdfBase64: z.string().min(1).max(14_000_000),
  fileName: z.string().min(1).max(120),
  caption: z.string().max(1000).optional(),
});

export async function whatsappRoutes(fastify: FastifyInstance) {
  fastify.get('/status', async (_request, reply) => {
    const status = fastify.whatsapp.getStatus();
    return reply.send({ success: true, data: status });
  });

  fastify.post('/send-pdf', async (request, reply) => {
    const body = sendPdfSchema.parse(request.body);

    try {
      await fastify.whatsapp.sendPdfInvoice(
        body.phone,
        body.pdfBase64,
        body.fileName,
        body.caption,
      );
      return reply.send({ success: true, message: 'Invoice sent successfully via WhatsApp!' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send WhatsApp message';
      fastify.log.error({ err }, 'Failed to send PDF invoice via WhatsApp');
      return reply.status(400).send({ success: false, error: message });
    }
  });
}
