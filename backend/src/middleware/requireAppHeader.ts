import { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Guards body-less POST endpoints (backup/report generation) that would
 * otherwise be a "simple request" under the Fetch spec — a cross-origin
 * page can fire one without a CORS preflight (the origin allowlist only
 * blocks the response from being *read*, not the request from executing).
 * Requiring this custom header forces a preflight, which our strict CORS
 * origin list then blocks outright. Mirrors the existing X-Confirm-Restore
 * pattern used for backup restores.
 */
export function requireAppHeader(request: FastifyRequest, reply: FastifyReply, done: () => void) {
  if (request.headers['x-requested-with'] !== 'maestro-billing-app') {
    reply.status(400).send({ success: false, error: 'Missing required X-Requested-With header' });
    return;
  }
  done();
}
