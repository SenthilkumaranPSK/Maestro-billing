import { Prisma, PrismaClient } from '@prisma/client';
import { BillItemInput, CreateBillInput } from '../types/index';

export class BillService {
  constructor(private readonly prisma: PrismaClient) {}

  async getNextBillNumber(): Promise<string> {
    const prefixSetting = await this.prisma.setting.findUnique({
      where: { key: 'invoice_prefix' },
    });
    // Fallback must match seed.ts — a mismatched prefix on an unseeded DB
    // would fork the bill-number series.
    const prefix = prefixSetting?.value ?? 'MS';

    const year = new Date().getFullYear();

    const lastBill = await this.prisma.bill.findFirst({
      where: { billNumber: { startsWith: `${prefix}-${year}-` } },
      orderBy: { id: 'desc' },
    });

    let seq = 1;
    if (lastBill) {
      const parts = lastBill.billNumber.split('-');
      const lastSeq = parseInt(parts[parts.length - 1] ?? '0', 10);
      if (!isNaN(lastSeq)) seq = lastSeq + 1;
    }

    return `${prefix}-${year}-${String(seq).padStart(4, '0')}`;
  }

  computeItemTotals(items: BillItemInput[]): {
    items: Array<BillItemInput & { gstAmount: number; totalAmount: number }>;
    subTotal: number;
    totalGst: number;
    grandTotal: number;
  } {
    let subTotal = 0;
    let totalGst = 0;

    const computed = items.map((item) => {
      const itemSubTotal = Math.round(item.qty * item.unitPrice);
      const gstAmount = Math.round((itemSubTotal * item.gstRate) / 100);
      const totalAmount = itemSubTotal + gstAmount;

      subTotal += itemSubTotal;
      totalGst += gstAmount;

      return { ...item, gstAmount, totalAmount };
    });

    return { items: computed, subTotal, totalGst, grandTotal: subTotal + totalGst };
  }

  async createBill(input: CreateBillInput) {
    const { items: computedItems, subTotal, totalGst, grandTotal } =
      this.computeItemTotals(input.items);

    const discountAmount = input.discountAmount ?? 0;
    const roundOffAmount = input.roundOffAmount ?? 0;
    const finalTotal = grandTotal - discountAmount + roundOffAmount;

    // A zero-total bill is almost always a mistake (e.g. a forgotten line
    // item). Reject loudly so the user can fix it.
    if (finalTotal <= 0) {
      throw new Error('Cannot save a bill with a total of 0. Add at least one item with a price.');
    }

    // Bill numbers are assigned read-then-write, so two simultaneous saves
    // (e.g. a double-click) can race to the same number. billNumber is UNIQUE,
    // so the loser fails with P2002 — recompute and retry instead of surfacing
    // a duplicate-key error to the operator.
    for (let attempt = 1; ; attempt++) {
      const billNumber = await this.getNextBillNumber();
      try {
        return await this.prisma.bill.create({
          data: {
            billNumber,
            customerId: input.customerId,
            billDate: new Date(input.billDate),
            dueDate: input.dueDate ? new Date(input.dueDate) : null,
            subTotal,
            gstAmount: totalGst,
            discountAmount,
            grandTotal: finalTotal,
            status: 'PAID',
            notes: input.notes,
            items: {
              create: computedItems.map((item) => ({
                productId: item.productId,
                productName: item.productName,
                unit: item.unit,
                qty: item.qty,
                unitPrice: item.unitPrice,
                gstRate: item.gstRate,
                gstAmount: item.gstAmount,
                totalAmount: item.totalAmount,
              })),
            },
          },
          include: { items: true, payments: true, customer: true },
        });
      } catch (err) {
        const isDuplicateNumber =
          err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
        if (!isDuplicateNumber || attempt >= 3) throw err;
      }
    }
  }

  async updateBill(billId: number, input: CreateBillInput) {
    const existing = await this.prisma.bill.findUnique({ where: { id: billId, deletedAt: null } });
    if (!existing) throw new Error('Bill not found');
    if (existing.status === 'CANCELLED') throw new Error('Cancelled bills cannot be edited');

    const { items: computedItems, subTotal, totalGst, grandTotal } = this.computeItemTotals(input.items);
    const discountAmount = input.discountAmount ?? 0;
    const roundOffAmount = input.roundOffAmount ?? 0;
    const finalTotal = grandTotal - discountAmount + roundOffAmount;

    if (finalTotal <= 0) {
      throw new Error('Cannot save a bill with a total of 0. Add at least one item with a price.');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.billItem.deleteMany({ where: { billId } });
      // Legacy payment rows are tied to the old totals — clear them.
      await tx.payment.deleteMany({ where: { billId } });

      return tx.bill.update({
        where: { id: billId },
        data: {
          customerId: input.customerId ?? null,
          billDate: new Date(input.billDate),
          dueDate: input.dueDate ? new Date(input.dueDate) : null,
          subTotal,
          gstAmount: totalGst,
          discountAmount,
          grandTotal: finalTotal,
          status: 'PAID',
          paymentMode: null,
          notes: input.notes ?? null,
          items: {
            create: computedItems.map((item) => ({
              productId: item.productId,
              productName: item.productName,
              unit: item.unit,
              qty: item.qty,
              unitPrice: item.unitPrice,
              gstRate: item.gstRate,
              gstAmount: item.gstAmount,
              totalAmount: item.totalAmount,
            })),
          },
        },
        include: { items: true, payments: true, customer: true },
      });
    });
  }

  async getBillWithDetails(billId: number) {
    return this.prisma.bill.findUnique({
      where: { id: billId, deletedAt: null },
      include: { items: true, payments: true, customer: true },
    });
  }
}
