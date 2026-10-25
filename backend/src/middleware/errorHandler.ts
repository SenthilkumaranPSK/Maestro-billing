import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';

export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (error instanceof ZodError) {
    return reply.status(400).send({
      success: false,
      error: 'Validation failed',
      details: error.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      })),
    });
  }

  // Prisma errors would otherwise surface as 500s with internal detail.
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2025') {
      return reply.status(404).send({ success: false, error: 'Record not found' });
    }
    if (error.code === 'P2002') {
      return reply
        .status(409)
        .send({ success: false, error: 'A record with the same unique value already exists' });
    }
    request.log.error(error);
    return reply.status(500).send({ success: false, error: 'Database error' });
  }

  const status = error.statusCode ?? 500;

  // Client errors (validation, 404s, bad content-type…) keep their message —
  // the operator can act on them. Server errors get logged in full but only a
  // generic message leaves the process, so internals (paths, SQL, stack
  // fragments) never end up in a response.
  if (status < 500) {
    return reply.status(status).send({ success: false, error: error.message || 'Request failed' });
  }

  request.log.error(error);
  return reply.status(500).send({ success: false, error: 'Internal server error' });
}
