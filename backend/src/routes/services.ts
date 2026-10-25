import { FastifyInstance } from 'fastify';
import { serviceSchema, reorderSchema, parseId } from '../utils/validators';
import { requireAppHeader } from '../middleware/requireAppHeader';

// Reusable catalog of service names (e.g. "Wedding Videography") that feeds
// the autocomplete on the A4 invoice's Service Description field — same
// pattern as productRoutes, stripped down since a service entry is just a
// name, no price/GST/unit.
export async function serviceRoutes(fastify: FastifyInstance) {
  const prisma = fastify.prisma;

  fastify.get('/', async (request, reply) => {
    const query = request.query as { search?: string; active?: string };
    const search = query.search?.trim();
    const activeOnly = query.active !== 'false';

    const services = await prisma.service.findMany({
      where: {
        ...(activeOnly ? { isActive: true } : {}),
        ...(search ? { name: { contains: search } } : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return reply.send({ success: true, data: services });
  });

  fastify.get('/:id', async (request, reply) => {
    const id = parseId((request.params as { id: string }).id);
    if (!id) return reply.status(400).send({ success: false, error: 'Invalid service id' });
    const service = await prisma.service.findUnique({ where: { id } });
    if (!service) {
      return reply.status(404).send({ success: false, error: 'Service not found' });
    }
    return reply.send({ success: true, data: service });
  });

  fastify.post('/', { preHandler: requireAppHeader }, async (request, reply) => {
    const body = serviceSchema.parse(request.body);
    const last = await prisma.service.findFirst({ orderBy: { sortOrder: 'desc' } });
    const service = await prisma.service.create({ data: { ...body, sortOrder: (last?.sortOrder ?? -1) + 1 } });
    return reply.status(201).send({ success: true, data: service });
  });

  // Reassigns sortOrder = array index for every id in the submitted order.
  fastify.put('/reorder', { preHandler: requireAppHeader }, async (request, reply) => {
    const body = reorderSchema.parse(request.body);
    await prisma.$transaction(
      body.ids.map((id, index) => prisma.service.update({ where: { id }, data: { sortOrder: index } })),
    );
    const services = await prisma.service.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return reply.send({ success: true, data: services });
  });

  fastify.put('/:id', { preHandler: requireAppHeader }, async (request, reply) => {
    const id = parseId((request.params as { id: string }).id);
    if (!id) return reply.status(400).send({ success: false, error: 'Invalid service id' });
    const body = serviceSchema.partial().parse(request.body);
    const service = await prisma.service.update({ where: { id }, data: body });
    return reply.send({ success: true, data: service });
  });

  fastify.delete('/:id', { preHandler: requireAppHeader }, async (request, reply) => {
    const id = parseId((request.params as { id: string }).id);
    if (!id) return reply.status(400).send({ success: false, error: 'Invalid service id' });
    await prisma.service.update({ where: { id }, data: { isActive: false } });
    return reply.send({ success: true });
  });
}
