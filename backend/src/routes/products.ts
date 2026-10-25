import { FastifyInstance } from 'fastify';
import { productSchema, reorderSchema, parseId } from '../utils/validators';
import { requireAppHeader } from '../middleware/requireAppHeader';

export async function productRoutes(fastify: FastifyInstance) {
  const prisma = fastify.prisma;

  fastify.get('/', async (request, reply) => {
    const query = request.query as { search?: string; active?: string };
    const search = query.search?.trim();
    const activeOnly = query.active !== 'false';

    const products = await prisma.product.findMany({
      where: {
        ...(activeOnly ? { isActive: true } : {}),
        ...(search ? { name: { contains: search } } : {}),
      },
      // sortOrder first (the operator's own Rearrange order), name only as a
      // tiebreaker for rows that happen to share one (e.g. two rows created
      // before this column existed, both backfilled the same way).
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return reply.send({ success: true, data: products });
  });

  fastify.get('/:id', async (request, reply) => {
    const id = parseId((request.params as { id: string }).id);
    if (!id) return reply.status(400).send({ success: false, error: 'Invalid product id' });
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) {
      return reply.status(404).send({ success: false, error: 'Product not found' });
    }
    return reply.send({ success: true, data: product });
  });

  fastify.post('/', { preHandler: requireAppHeader }, async (request, reply) => {
    const body = productSchema.parse(request.body);
    // New products go to the end of the list — one more than the current
    // highest sortOrder, so Add never has to know Rearrange's own numbering.
    const last = await prisma.product.findFirst({ orderBy: { sortOrder: 'desc' } });
    const product = await prisma.product.create({ data: { ...body, sortOrder: (last?.sortOrder ?? -1) + 1 } });
    return reply.status(201).send({ success: true, data: product });
  });

  // Reassigns sortOrder = array index for every id in the submitted order.
  fastify.put('/reorder', { preHandler: requireAppHeader }, async (request, reply) => {
    const body = reorderSchema.parse(request.body);
    await prisma.$transaction(
      body.ids.map((id, index) => prisma.product.update({ where: { id }, data: { sortOrder: index } })),
    );
    const products = await prisma.product.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return reply.send({ success: true, data: products });
  });

  fastify.put('/:id', { preHandler: requireAppHeader }, async (request, reply) => {
    const id = parseId((request.params as { id: string }).id);
    if (!id) return reply.status(400).send({ success: false, error: 'Invalid product id' });
    const body = productSchema.partial().parse(request.body);
    const product = await prisma.product.update({
      where: { id },
      data: body,
    });
    return reply.send({ success: true, data: product });
  });

  fastify.delete('/:id', { preHandler: requireAppHeader }, async (request, reply) => {
    const id = parseId((request.params as { id: string }).id);
    if (!id) return reply.status(400).send({ success: false, error: 'Invalid product id' });
    await prisma.product.update({
      where: { id },
      data: { isActive: false },
    });
    return reply.send({ success: true });
  });
}
