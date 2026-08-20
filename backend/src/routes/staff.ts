import { FastifyInstance } from 'fastify';
import { staffSchema, reorderSchema, parseId } from '../utils/validators';
import { requireAppHeader } from '../middleware/requireAppHeader';

// The "Billed By" staff list, managed from Settings — same soft-delete
// pattern as productRoutes/serviceRoutes (isActive, never hard-deleted: a
// bill's billedById/billedByName is denormalized, see schema.prisma Bill, so
// deactivating a staff member never touches already-saved bills). The one
// addition over that pattern is sortOrder + a dedicated reorder route, since
// this list also drives the BilledBySelect dropdown's display order.
export async function staffRoutes(fastify: FastifyInstance) {
  const prisma = fastify.prisma;

  fastify.get('/', async (request, reply) => {
    const query = request.query as { active?: string };
    const activeOnly = query.active !== 'false';

    const staff = await prisma.staff.findMany({
      where: activeOnly ? { isActive: true } : {},
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    return reply.send({ success: true, data: staff });
  });

  fastify.post('/', { preHandler: requireAppHeader }, async (request, reply) => {
    const body = staffSchema.parse(request.body);
    // New entries go to the end of the active list — one more than the
    // current highest sortOrder, so Add never has to know the reorder UI's
    // internal numbering.
    const last = await prisma.staff.findFirst({ orderBy: { sortOrder: 'desc' } });
    const staff = await prisma.staff.create({
      data: { name: body.name, sortOrder: (last?.sortOrder ?? -1) + 1 },
    });
    return reply.status(201).send({ success: true, data: staff });
  });

  // Reassigns sortOrder = array index for every id in the submitted order —
  // registered before the generic '/:id' routes below only for readability;
  // Fastify's router matches the literal '/reorder' segment over ':id'
  // regardless of registration order.
  fastify.put('/reorder', { preHandler: requireAppHeader }, async (request, reply) => {
    const body = reorderSchema.parse(request.body);
    await prisma.$transaction(
      body.ids.map((id, index) => prisma.staff.update({ where: { id }, data: { sortOrder: index } })),
    );
    const staff = await prisma.staff.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    return reply.send({ success: true, data: staff });
  });

  fastify.put('/:id', { preHandler: requireAppHeader }, async (request, reply) => {
    const id = parseId((request.params as { id: string }).id);
    if (!id) return reply.status(400).send({ success: false, error: 'Invalid staff id' });
    const body = staffSchema.parse(request.body);
    const staff = await prisma.staff.update({ where: { id }, data: { name: body.name } });
    return reply.send({ success: true, data: staff });
  });

  fastify.delete('/:id', { preHandler: requireAppHeader }, async (request, reply) => {
    const id = parseId((request.params as { id: string }).id);
    if (!id) return reply.status(400).send({ success: false, error: 'Invalid staff id' });
    await prisma.staff.update({ where: { id }, data: { isActive: false } });
    return reply.send({ success: true });
  });
}
