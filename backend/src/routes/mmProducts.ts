import { FastifyInstance } from 'fastify';
import { mmProductSchema, mmRestockSchema, reorderSchema, parseId } from '../utils/validators';
import { requireAppHeader } from '../middleware/requireAppHeader';

/** MM billing module's own product catalog — mirrors productRoutes exactly,
 * against the separate MmProduct table (see schema.prisma). */
export async function mmProductRoutes(fastify: FastifyInstance) {
  const prisma = fastify.prisma;

  fastify.get('/', async (request, reply) => {
    const query = request.query as { search?: string; active?: string };
    const search = query.search?.trim();
    const activeOnly = query.active !== 'false';

    const products = await prisma.mmProduct.findMany({
      where: {
        ...(activeOnly ? { isActive: true } : {}),
        ...(search ? { name: { contains: search } } : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return reply.send({ success: true, data: products });
  });

  fastify.get('/:id', async (request, reply) => {
    const id = parseId((request.params as { id: string }).id);
    if (!id) return reply.status(400).send({ success: false, error: 'Invalid product id' });
    const product = await prisma.mmProduct.findUnique({ where: { id } });
    if (!product) {
      return reply.status(404).send({ success: false, error: 'Product not found' });
    }
    return reply.send({ success: true, data: product });
  });

  fastify.post('/', { preHandler: requireAppHeader }, async (request, reply) => {
    const body = mmProductSchema.parse(request.body);
    const last = await prisma.mmProduct.findFirst({ orderBy: { sortOrder: 'desc' } });
    const product = await prisma.mmProduct.create({ data: { ...body, sortOrder: (last?.sortOrder ?? -1) + 1 } });
    return reply.status(201).send({ success: true, data: product });
  });

  // Reassigns sortOrder = array index for every id in the submitted order.
  fastify.put('/reorder', { preHandler: requireAppHeader }, async (request, reply) => {
    const body = reorderSchema.parse(request.body);
    await prisma.$transaction(
      body.ids.map((id, index) => prisma.mmProduct.update({ where: { id }, data: { sortOrder: index } })),
    );
    const products = await prisma.mmProduct.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return reply.send({ success: true, data: products });
  });

  fastify.put('/:id', { preHandler: requireAppHeader }, async (request, reply) => {
    const id = parseId((request.params as { id: string }).id);
    if (!id) return reply.status(400).send({ success: false, error: 'Invalid product id' });
    const body = mmProductSchema.partial().parse(request.body);

    const product = await prisma.$transaction(async (tx) => {
      const before = await tx.mmProduct.findUnique({ where: { id } });
      const updated = await tx.mmProduct.update({ where: { id }, data: body });
      // A direct stockQty edit (the Edit dialog's "correct a wrong count"
      // field) still leaves a ledger entry — the only case where it
      // shouldn't is the Restock flow below, which writes its own PURCHASE
      // entry and never touches this route.
      if (before && body.stockQty !== undefined && body.stockQty !== before.stockQty) {
        await tx.mmStockMovement.create({
          data: {
            mmProductId: id,
            type: 'CORRECTION',
            qtyChange: body.stockQty - before.stockQty,
            balanceAfter: updated.stockQty,
          },
        });
      }
      return updated;
    });

    return reply.send({ success: true, data: product });
  });

  // Manual restock — records supplier/cost/invoice details as a proper
  // ledger entry (PURCHASE), not just a number bump. Separate from PUT so
  // the "how much did we buy and from whom" trail is never lost.
  fastify.post('/:id/restock', { preHandler: requireAppHeader }, async (request, reply) => {
    const id = parseId((request.params as { id: string }).id);
    if (!id) return reply.status(400).send({ success: false, error: 'Invalid product id' });
    const body = mmRestockSchema.parse(request.body);

    try {
      const product = await prisma.$transaction(async (tx) => {
        const updated = await tx.mmProduct.update({
          where: { id },
          data: { stockQty: { increment: body.qty } },
        });
        await tx.mmStockMovement.create({
          data: {
            mmProductId: id,
            type: 'PURCHASE',
            qtyChange: body.qty,
            balanceAfter: updated.stockQty,
            supplierName: body.supplierName,
            purchaseCost: body.purchaseCost,
            invoiceRef: body.invoiceRef,
            notes: body.notes,
          },
        });
        return updated;
      });
      return reply.send({ success: true, data: product });
    } catch {
      return reply.status(404).send({ success: false, error: 'Product not found' });
    }
  });

  // Stock ledger — every movement for this product, most recent first.
  fastify.get('/:id/stock-movements', async (request, reply) => {
    const id = parseId((request.params as { id: string }).id);
    if (!id) return reply.status(400).send({ success: false, error: 'Invalid product id' });
    const movements = await prisma.mmStockMovement.findMany({
      where: { mmProductId: id },
      include: { bill: { select: { billNumber: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return reply.send({ success: true, data: movements });
  });

  fastify.delete('/:id', { preHandler: requireAppHeader }, async (request, reply) => {
    const id = parseId((request.params as { id: string }).id);
    if (!id) return reply.status(400).send({ success: false, error: 'Invalid product id' });
    await prisma.mmProduct.update({
      where: { id },
      data: { isActive: false },
    });
    return reply.send({ success: true });
  });
}
