import { FastifyInstance } from 'fastify';
import { requireAppHeader } from '../middleware/requireAppHeader';
import {
  DEFAULT_PRODUCTS,
  DEFAULT_MM_PRODUCT_NAMES,
  DEFAULT_MM_PRODUCT_FIELDS,
  DEFAULT_SERVICE_NAMES,
} from '../utils/catalogDefaults';

/**
 * Put back catalog entries that ship with a fresh install but have since been
 * deleted — reached from the desktop app's Alt → Setup menu.
 *
 * **Strictly additive. It never edits or removes anything the operator has.**
 * That is the whole contract, and it is what makes the menu item safe to press
 * by accident:
 *
 *   - a default that is missing entirely  → created
 *   - a default that was deleted (soft)   → reactivated, fields left ALONE
 *   - a default that is present           → untouched
 *   - anything the operator added         → untouched
 *   - any price/unit/GST they edited      → untouched
 *
 * Reactivating without resetting fields is deliberate. "Delete" in this app is
 * a soft delete (`isActive: false`, never a row removal, because
 * `BillItem.productId` points at products on saved bills), so a deleted item
 * still carries whatever price the operator last set. Restoring it at the
 * shipped default price would silently overwrite a real edit — the opposite of
 * "nothing is lost". They get their item back exactly as they left it.
 *
 * Matching is by exact name, the same key `seed.ts` uses for its own
 * idempotency, so running this twice is a no-op the second time.
 */

interface RestoreCount {
  created: number;
  reactivated: number;
  unchanged: number;
}

const emptyCount = (): RestoreCount => ({ created: 0, reactivated: 0, unchanged: 0 });

export async function catalogRoutes(fastify: FastifyInstance) {
  fastify.post('/restore-defaults', { preHandler: requireAppHeader }, async (_request, reply) => {
    const prisma = fastify.prisma;

    const products = emptyCount();
    const mmProducts = emptyCount();
    const services = emptyCount();

    // New rows append to the end of the operator's own ordering rather than
    // shuffling it — same rule the Products/Services pages use when adding.
    const nextSortOrder = async (
      max: { sortOrder: number } | null,
      offset: number,
    ): Promise<number> => (max?.sortOrder ?? -1) + 1 + offset;

    // ── Studio products ────────────────────────────────────────────────────
    {
      const max = await prisma.product.findFirst({ orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } });
      let added = 0;
      for (const def of DEFAULT_PRODUCTS) {
        const existing = await prisma.product.findFirst({ where: { name: def.name } });
        if (!existing) {
          await prisma.product.create({
            data: {
              name: def.name,
              unit: def.unit,
              unitPrice: def.unitPrice,
              gstRate: def.gstRate,
              sortOrder: await nextSortOrder(max, added),
            },
          });
          added += 1;
          products.created += 1;
        } else if (!existing.isActive) {
          await prisma.product.update({ where: { id: existing.id }, data: { isActive: true } });
          products.reactivated += 1;
        } else {
          products.unchanged += 1;
        }
      }
    }

    // ── MM wholesale products ──────────────────────────────────────────────
    {
      const max = await prisma.mmProduct.findFirst({ orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } });
      let added = 0;
      for (const name of DEFAULT_MM_PRODUCT_NAMES) {
        const existing = await prisma.mmProduct.findFirst({ where: { name } });
        if (!existing) {
          await prisma.mmProduct.create({
            data: { name, ...DEFAULT_MM_PRODUCT_FIELDS, sortOrder: await nextSortOrder(max, added) },
          });
          added += 1;
          mmProducts.created += 1;
        } else if (!existing.isActive) {
          await prisma.mmProduct.update({ where: { id: existing.id }, data: { isActive: true } });
          mmProducts.reactivated += 1;
        } else {
          mmProducts.unchanged += 1;
        }
      }
    }

    // ── Services ───────────────────────────────────────────────────────────
    {
      const max = await prisma.service.findFirst({ orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } });
      let added = 0;
      for (const name of DEFAULT_SERVICE_NAMES) {
        const existing = await prisma.service.findFirst({ where: { name } });
        if (!existing) {
          await prisma.service.create({ data: { name, sortOrder: await nextSortOrder(max, added) } });
          added += 1;
          services.created += 1;
        } else if (!existing.isActive) {
          await prisma.service.update({ where: { id: existing.id }, data: { isActive: true } });
          services.reactivated += 1;
        } else {
          services.unchanged += 1;
        }
      }
    }

    return reply.send({ success: true, data: { products, mmProducts, services } });
  });
}
