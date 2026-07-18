import { FastifyInstance } from 'fastify';
import { productSchema, parseId } from '../utils/validators';

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
      orderBy: { name: 'asc' },
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

  fastify.post('/', async (request, reply) => {
    const body = productSchema.parse(request.body);
    const product = await prisma.product.create({ data: body });
    return reply.status(201).send({ success: true, data: product });
  });

  fastify.put('/:id', async (request, reply) => {
    const id = parseId((request.params as { id: string }).id);
    if (!id) return reply.status(400).send({ success: false, error: 'Invalid product id' });
    const body = productSchema.partial().parse(request.body);
    const product = await prisma.product.update({
      where: { id },
      data: body,
    });
    return reply.send({ success: true, data: product });
  });

  fastify.delete('/:id', async (request, reply) => {
    const id = parseId((request.params as { id: string }).id);
    if (!id) return reply.status(400).send({ success: false, error: 'Invalid product id' });
    await prisma.product.update({
      where: { id },
      data: { isActive: false },
    });
    return reply.send({ success: true });
  });
}
