import { FastifyInstance } from 'fastify';
import {
  createBillSchema,
  parseId,
  parseIntParam,
  parseDateParam,
} from '../utils/validators';
import { BillService } from '../services/BillService';

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

    return reply.send({ success: true, data: bills, meta: { total, page, limit } });
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

  fastify.post('/', async (request, reply) => {
    const body = createBillSchema.parse(request.body);
    const bill = await billService.createBill(body);

    await prisma.log.create({
      data: {
        action: 'CREATE',
        entityType: 'bill',
        entityId: bill.id,
        newValue: JSON.stringify({ billNumber: bill.billNumber }),
      },
    });

    return reply.status(201).send({ success: true, data: bill });
  });

  // Full edit — replaces items, recalculates totals; any non-cancelled bill
  fastify.put('/:id', async (request, reply) => {
    const id = parseId((request.params as { id: string }).id);
    if (!id) return reply.status(400).send({ success: false, error: 'Invalid bill id' });
    const body = createBillSchema.parse(request.body);
    try {
      const bill = await billService.updateBill(id, body);
      await prisma.log.create({
        data: {
          action: 'UPDATE',
          entityType: 'bill',
          entityId: bill.id,
          newValue: JSON.stringify({ billNumber: bill.billNumber }),
        },
      });
      return reply.send({ success: true, data: bill });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Update failed';
      if (msg.includes('Cancelled') || msg.includes('not found') || msg.includes('total of 0')) {
        return reply.status(400).send({ success: false, error: msg });
      }
      throw err;
    }
  });

  fastify.delete('/:id', async (request, reply) => {
    const id = parseId((request.params as { id: string }).id);
    if (!id) return reply.status(400).send({ success: false, error: 'Invalid bill id' });

    // Mark CANCELLED but keep the bill visible in history (audit trail).
    // Revenue and GST figures exclude CANCELLED bills on the frontend.
    await prisma.bill.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });

    await prisma.log.create({
      data: {
        action: 'DELETE',
        entityType: 'bill',
        entityId: id,
      },
    });

    return reply.send({ success: true });
  });

}
