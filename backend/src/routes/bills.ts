import { FastifyInstance } from 'fastify';
import {
  createBillSchema,
  parseId,
  parseIntParam,
  parseDateParam,
} from '../utils/validators';
import { BillService } from '../services/BillService';
import { requireAppHeader } from '../middleware/requireAppHeader';

export async function billRoutes(fastify: FastifyInstance) {
  const prisma = fastify.prisma;
  const billService = new BillService(prisma);

  // GET /bills/next-number — must come before /:id
  fastify.get('/next-number', async (_request, reply) => {
    const billNumber = await billService.getNextBillNumber();
    return reply.send({ success: true, data: billNumber });
  });

  fastify.get('/', async (request, reply) => {
    const query = request.query as {
      status?: string;
      customerId?: string;
      from?: string;
      to?: string;
      search?: string;
      page?: string;
      limit?: string;
    };

    const page = parseIntParam(query.page, 1);
    const limit = parseIntParam(query.limit, 20, 2000);
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { deletedAt: null };
    if (query.status) where['status'] = query.status;
    if (query.customerId) {
      const customerId = parseId(query.customerId);
      if (!customerId) {
        return reply.status(400).send({ success: false, error: 'Invalid customerId' });
      }
      where['customerId'] = customerId;
    }
    if (query.from || query.to) {
      const from = query.from ? parseDateParam(query.from, 'start') : undefined;
      const to = query.to ? parseDateParam(query.to, 'end') : undefined;
      if (from === null || to === null) {
        return reply.status(400).send({ success: false, error: 'Dates must be YYYY-MM-DD' });
      }
      where['billDate'] = {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      };
    }
    if (query.search) {
      where['billNumber'] = { contains: query.search };
    }

    const [bills, total] = await Promise.all([
      prisma.bill.findMany({
        where,
        // payments intentionally excluded — no list view renders them, and the
        // GST/Day reports pull up to 2000 bills at once. GET /:id keeps them.
        include: { customer: true, items: true },
        orderBy: { billDate: 'desc' },
        skip,
        take: limit,
      }),
      prisma.bill.count({ where }),
    ]);

    // Same "total > returned rows" comparison the report pages already do
    // client-side to show their truncation warning — exposed here too so a
    // caller doesn't have to derive it itself.
    const capped = total > bills.length;
    return reply.send({ success: true, data: bills, meta: { total, page, limit, capped } });
  });

  fastify.get('/:id', async (request, reply) => {
    const id = parseId((request.params as { id: string }).id);
    if (!id) return reply.status(400).send({ success: false, error: 'Invalid bill id' });
    const bill = await billService.getBillWithDetails(id);
    if (!bill) {
      return reply.status(404).send({ success: false, error: 'Bill not found' });
    }
    return reply.send({ success: true, data: bill });
  });

  fastify.post('/', { preHandler: requireAppHeader }, async (request, reply) => {
    const body = createBillSchema.parse(request.body);
    let bill;
    try {
      bill = await billService.createBill(body);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Create failed';
      if (msg.includes('negative total')) {
        return reply.status(400).send({ success: false, error: msg });
      }
      throw err;
    }

    // The bill is already committed at this point — a failure writing the
    // audit log must never 500 the request (the operator would see "Error
    // saving bill" for a bill that in fact saved fine, and the natural next
    // action — clicking Save again — creates a genuine duplicate bill).
    try {
      await prisma.log.create({
        data: {
          action: 'CREATE',
          entityType: 'bill',
          entityId: bill.id,
          newValue: JSON.stringify({ billNumber: bill.billNumber }),
        },
      });
    } catch (err) {
      fastify.log.error({ err, billId: bill.id }, 'Failed to write audit log for created bill');
    }

    return reply.status(201).send({ success: true, data: bill });
  });

  // Full edit — replaces items, recalculates totals; any non-cancelled bill
  fastify.put('/:id', { preHandler: requireAppHeader }, async (request, reply) => {
    const id = parseId((request.params as { id: string }).id);
    if (!id) return reply.status(400).send({ success: false, error: 'Invalid bill id' });
    const body = createBillSchema.parse(request.body);
    let bill;
    try {
      bill = await billService.updateBill(id, body);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Update failed';
      if (msg.includes('Cancelled') || msg.includes('not found') || msg.includes('negative total') || msg.includes('recorded payments')) {
        return reply.status(400).send({ success: false, error: msg });
      }
      throw err;
    }

    // Same reasoning as bill creation: the update already committed, so a
    // log-write failure here must not turn into a 500 that looks like the
    // save itself failed.
    try {
      await prisma.log.create({
        data: {
          action: 'UPDATE',
          entityType: 'bill',
          entityId: bill.id,
          newValue: JSON.stringify({ billNumber: bill.billNumber }),
        },
      });
    } catch (err) {
      fastify.log.error({ err, billId: bill.id }, 'Failed to write audit log for updated bill');
    }

    return reply.send({ success: true, data: bill });
  });

  fastify.delete('/:id', { preHandler: requireAppHeader }, async (request, reply) => {
    const id = parseId((request.params as { id: string }).id);
    if (!id) return reply.status(400).send({ success: false, error: 'Invalid bill id' });

    const existing = await prisma.bill.findUnique({ where: { id, deletedAt: null } });
    if (!existing) return reply.status(404).send({ success: false, error: 'Bill not found' });
    if (existing.status === 'CANCELLED') {
      return reply.status(400).send({ success: false, error: 'Bill is already cancelled' });
    }

    // Mark CANCELLED but keep the bill visible in history (audit trail).
    // Revenue and GST figures exclude CANCELLED bills on the frontend.
    await prisma.bill.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });

    try {
      await prisma.log.create({
        data: {
          action: 'DELETE',
          entityType: 'bill',
          entityId: id,
        },
      });
    } catch (err) {
      fastify.log.error({ err, billId: id }, 'Failed to write audit log for cancelled bill');
    }

    return reply.send({ success: true });
  });

}
