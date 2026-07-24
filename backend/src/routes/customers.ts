import { FastifyInstance } from 'fastify';
import { customerSchema, parseId, parseIntParam } from '../utils/validators';
import { requireAppHeader } from '../middleware/requireAppHeader';

export async function customerRoutes(fastify: FastifyInstance) {
  const prisma = fastify.prisma;

  fastify.get('/', async (request, reply) => {
    const query = request.query as {
      search?: string;
      page?: string;
      limit?: string;
    };
    const page = parseIntParam(query.page, 1);
    const limit = parseIntParam(query.limit, 20, 100);
    const skip = (page - 1) * limit;
    const search = query.search?.trim();

    const where = {
      deletedAt: null,
      ...(search
        ? {
            OR: [
              { name: { contains: search } },
              { phone: { contains: search } },
              { email: { contains: search } },
            ],
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        orderBy: { name: 'asc' },
        skip,
        take: limit,
      }),
      prisma.customer.count({ where }),
    ]);

    return reply.send({ success: true, data, meta: { total, page, limit } });
  });

  fastify.get('/:id', async (request, reply) => {
    const id = parseId((request.params as { id: string }).id);
    if (!id) return reply.status(400).send({ success: false, error: 'Invalid customer id' });
    const customer = await prisma.customer.findFirst({
      where: { id, deletedAt: null },
    });
    if (!customer) {
      return reply.status(404).send({ success: false, error: 'Customer not found' });
    }
    return reply.send({ success: true, data: customer });
  });

  fastify.get('/:id/bills', async (request, reply) => {
    const id = parseId((request.params as { id: string }).id);
    if (!id) return reply.status(400).send({ success: false, error: 'Invalid customer id' });
    const bills = await prisma.bill.findMany({
      where: { customerId: id, deletedAt: null },
      include: { items: true, payments: true },
      orderBy: { billDate: 'desc' },
    });
    return reply.send({ success: true, data: bills });
  });

  fastify.post('/', { preHandler: requireAppHeader }, async (request, reply) => {
    const body = customerSchema.parse(request.body);
    const customer = await prisma.customer.create({ data: body });
    return reply.status(201).send({ success: true, data: customer });
  });

  fastify.put('/:id', { preHandler: requireAppHeader }, async (request, reply) => {
    const id = parseId((request.params as { id: string }).id);
    if (!id) return reply.status(400).send({ success: false, error: 'Invalid customer id' });
    const existing = await prisma.customer.findFirst({ where: { id, deletedAt: null } });
    if (!existing) return reply.status(404).send({ success: false, error: 'Customer not found' });
    const body = customerSchema.parse(request.body);
    const customer = await prisma.customer.update({
      where: { id },
      data: body,
    });
    return reply.send({ success: true, data: customer });
  });

  fastify.delete('/:id', { preHandler: requireAppHeader }, async (request, reply) => {
    const id = parseId((request.params as { id: string }).id);
    if (!id) return reply.status(400).send({ success: false, error: 'Invalid customer id' });
    await prisma.customer.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return reply.send({ success: true });
  });
}
