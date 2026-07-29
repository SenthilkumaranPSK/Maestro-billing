import { FastifyInstance } from 'fastify';
import { mmCustomerSchema, parseId, parseIntParam } from '../utils/validators';
import { requireAppHeader } from '../middleware/requireAppHeader';

/** MM billing module's own customer database — mirrors customerRoutes
 * exactly, against the separate MmCustomer table (see schema.prisma). */
export async function mmCustomerRoutes(fastify: FastifyInstance) {
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
      prisma.mmCustomer.findMany({
        where,
        orderBy: { name: 'asc' },
        skip,
        take: limit,
      }),
      prisma.mmCustomer.count({ where }),
    ]);

    return reply.send({ success: true, data, meta: { total, page, limit } });
  });

  fastify.get('/:id', async (request, reply) => {
    const id = parseId((request.params as { id: string }).id);
    if (!id) return reply.status(400).send({ success: false, error: 'Invalid customer id' });
    const customer = await prisma.mmCustomer.findFirst({
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
      where: { mmCustomerId: id, deletedAt: null },
      include: { items: true, payments: true },
      orderBy: { billDate: 'desc' },
    });
    return reply.send({ success: true, data: bills });
  });

  fastify.post('/', { preHandler: requireAppHeader }, async (request, reply) => {
    const body = mmCustomerSchema.parse(request.body);
    const customer = await prisma.mmCustomer.create({ data: body });
    return reply.status(201).send({ success: true, data: customer });
  });

  fastify.put('/:id', { preHandler: requireAppHeader }, async (request, reply) => {
    const id = parseId((request.params as { id: string }).id);
    if (!id) return reply.status(400).send({ success: false, error: 'Invalid customer id' });
    const existing = await prisma.mmCustomer.findFirst({ where: { id, deletedAt: null } });
    if (!existing) return reply.status(404).send({ success: false, error: 'Customer not found' });
    const body = mmCustomerSchema.parse(request.body);
    const customer = await prisma.mmCustomer.update({
      where: { id },
      data: body,
    });
    return reply.send({ success: true, data: customer });
  });

  fastify.delete('/:id', { preHandler: requireAppHeader }, async (request, reply) => {
    const id = parseId((request.params as { id: string }).id);
    if (!id) return reply.status(400).send({ success: false, error: 'Invalid customer id' });
    await prisma.mmCustomer.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return reply.send({ success: true });
  });
}
