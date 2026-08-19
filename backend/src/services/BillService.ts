import { Prisma, PrismaClient } from '@prisma/client';
import { BillItemInput, CreateBillInput } from '../types/index';

export class BillService {
  constructor(private readonly prisma: PrismaClient) {}

  async getNextBillNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const yy = String(year).slice(-2);
    const yyyy = String(year);

    // Bill numbers have gone through two format changes: the original
    // "PREFIX-YYYY-NNNN", then a brief "NNN/YY" (2-digit year), now
    // "NNN/YYYY" (4-digit year). GST filing expects consistent, sequential
    // invoice numbers within a year, so the sequence must keep counting up
    // across every switch rather than restarting at 1 while older-format
    // bills already exist for this year — check all three and continue
    // from whichever has the highest sequence. (endsWith(`/${yy}`) and
    // endsWith(`/${yyyy}`) can't collide with each other: the character
    // right before the year in a 4-digit bill number is a digit, e.g.
    // "049/2026" does not end with the literal substring "/26".)
    const prefixSetting = await this.prisma.setting.findUnique({
      where: { key: 'invoice_prefix' },
    });
    // Fallback must match seed.ts — a mismatched prefix would miss the old
    // series entirely and let the sequence restart from 1 mid-year.
    const prefix = prefixSetting?.value ?? 'MS';

    const [oldFormatBill, shortYearBill, fullYearBill] = await Promise.all([
      this.prisma.bill.findFirst({
        where: { billNumber: { startsWith: `${prefix}-${year}-` } },
        orderBy: { billNumber: 'desc' },
      }),
      this.prisma.bill.findFirst({
        where: { billNumber: { endsWith: `/${yy}` } },
        orderBy: { billNumber: 'desc' },
      }),
      this.prisma.bill.findFirst({
        where: { billNumber: { endsWith: `/${yyyy}` } },
        orderBy: { billNumber: 'desc' },
      }),
    ]);

    let seq = 0;
    if (oldFormatBill) {
      const parts = oldFormatBill.billNumber.split('-');
      const n = parseInt(parts[parts.length - 1] ?? '0', 10);
      if (!isNaN(n)) seq = Math.max(seq, n);
    }
    for (const bill of [shortYearBill, fullYearBill]) {
      if (!bill) continue;
      const n = parseInt(bill.billNumber.split('/')[0] ?? '0', 10);
      if (!isNaN(n)) seq = Math.max(seq, n);
    }

    return `${String(seq + 1).padStart(3, '0')}/${yyyy}`;
  }

  /**
   * MM billing module's own numbering — entirely separate sequence from
   * getNextBillNumber() above, scoped to series='MM' bills only, in Indian
   * financial-year format: "MM/26-27/001". FY runs April→March, so a bill
   * dated Jan–Mar counts toward the year that STARTED the previous April
   * (e.g. Feb 2027 is FY "26-27", not "27-28").
   */
  async getNextMmBillNumber(): Promise<string> {
    const now = new Date();
    const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1; // getMonth() 3 = April
    const fyLabel = `${String(fyStartYear).slice(-2)}-${String(fyStartYear + 1).slice(-2)}`;
    const prefix = `MM/${fyLabel}/`;

    const last = await this.prisma.bill.findFirst({
      where: { series: 'MM', billNumber: { startsWith: prefix } },
      orderBy: { billNumber: 'desc' },
    });
    let seq = 0;
    if (last) {
      const n = parseInt(last.billNumber.slice(prefix.length), 10);
      if (!isNaN(n)) seq = n;
    }
    return `${prefix}${String(seq + 1).padStart(3, '0')}`;
  }

  /**
   * gstInclusive=false (default, unchanged behaviour): unitPrice is the
   * pre-tax base — GST is computed and added on top, so the customer pays
   * qty * unitPrice * (1 + gstRate/100).
   *
   * gstInclusive=true: unitPrice is the all-in sticker price the customer
   * actually pays — GST is extracted from within it instead of added on top,
   * so the customer pays exactly qty * unitPrice either way. Either mode
   * still populates subTotal/gstAmount/totalAmount the same way (a taxable
   * base + a GST amount), so every existing report/GST filing keeps working
   * unchanged — only how that split was derived differs.
   */
  computeItemTotals(
    items: BillItemInput[],
    gstInclusive = false,
  ): {
    items: Array<BillItemInput & { gstAmount: number; totalAmount: number }>;
    subTotal: number;
    totalGst: number;
    grandTotal: number;
  } {
    let subTotal = 0;
    let totalGst = 0;

    const computed = items.map((item) => {
      const enteredTotal = Math.round(item.qty * item.unitPrice);
      let itemSubTotal: number;
      let gstAmount: number;
      let totalAmount: number;

      if (gstInclusive && item.gstRate > 0) {
        totalAmount = enteredTotal;
        itemSubTotal = Math.round((enteredTotal * 100) / (100 + item.gstRate));
        gstAmount = totalAmount - itemSubTotal;
      } else {
        itemSubTotal = enteredTotal;
        gstAmount = Math.round((itemSubTotal * item.gstRate) / 100);
        totalAmount = itemSubTotal + gstAmount;
      }

      subTotal += itemSubTotal;
      totalGst += gstAmount;

      return { ...item, gstAmount, totalAmount };
    });

    return { items: computed, subTotal, totalGst, grandTotal: subTotal + totalGst };
  }

  /**
   * Adjusts MmProduct.stockQty for every MM item that's linked to a catalog
   * product (mmProductId set — a manually-typed item has none and is
   * skipped), and logs each change as an MmStockMovement row — a sale (or
   * its reversal) is never just a silent number change, it's a dated ledger
   * entry pointing back at the bill that caused it. `sign` is -1 to deduct
   * on a sale, +1 to restore (edit replacing old items, or a cancellation).
   * Negative stock is allowed by design — see the stockQty column comment in
   * schema.prisma — so this never blocks or throws on an oversell.
   */
  async adjustMmStock(
    tx: Prisma.TransactionClient,
    items: Array<{ mmProductId?: number | null; qty: number }>,
    sign: 1 | -1,
    billId?: number,
  ): Promise<void> {
    for (const item of items) {
      if (!item.mmProductId) continue;
      const updated = await tx.mmProduct.update({
        where: { id: item.mmProductId },
        data: { stockQty: { increment: sign * item.qty } },
      });
      await tx.mmStockMovement.create({
        data: {
          mmProductId: item.mmProductId,
          type: sign === -1 ? 'SALE' : 'RESTORE',
          qtyChange: sign * item.qty,
          balanceAfter: updated.stockQty,
          billId: billId ?? null,
        },
      });
    }
  }

  async createBill(input: CreateBillInput) {
    const { items: computedItems, subTotal, totalGst, grandTotal } =
      this.computeItemTotals(input.items, input.gstInclusive ?? false);

    const discountAmount = input.discountAmount ?? 0;
    const roundOffAmount = input.roundOffAmount ?? 0;
    const finalTotal = grandTotal - discountAmount + roundOffAmount;

    // A zero total is a legitimate complimentary bill or a 100%-discounted
    // one — only a NEGATIVE total (discount bigger than the bill itself) is
    // actually invalid.
    if (finalTotal < 0) {
      throw new Error('Cannot save a bill with a negative total — the discount exceeds the bill amount.');
    }

    // Bill numbers are assigned read-then-write, so two simultaneous saves
    // (e.g. a double-click) can race to the same number. billNumber is UNIQUE,
    // so the loser fails with P2002 — recompute and retry instead of surfacing
    // a duplicate-key error to the operator.
    const series = input.series ?? 'MAIN';
    for (let attempt = 1; ; attempt++) {
      const billNumber = series === 'MM' ? await this.getNextMmBillNumber() : await this.getNextBillNumber();
      try {
        return await this.prisma.$transaction(async (tx) => {
          const bill = await tx.bill.create({
            data: {
              billNumber,
              series,
              customerId: input.customerId,
              mmCustomerId: input.mmCustomerId,
              billDate: new Date(input.billDate),
              dueDate: input.dueDate ? new Date(input.dueDate) : null,
              subTotal,
              gstAmount: totalGst,
              discountAmount,
              grandTotal: finalTotal,
              status: 'PAID',
              paymentMode: input.paymentMode ?? null,
              notes: input.notes,
              serviceDescription: input.serviceDescription,
              serviceFrom: input.serviceFrom ? new Date(input.serviceFrom) : null,
              serviceTo: input.serviceTo ? new Date(input.serviceTo) : null,
              serviceDates: input.serviceDates?.length ? JSON.stringify(input.serviceDates) : null,
              gstInclusive: input.gstInclusive ?? false,
              isInterState: input.isInterState ?? false,
              vehicleNo: input.vehicleNo,
              despatchedThrough: input.despatchedThrough,
              destination: input.destination,
              otherReference: input.otherReference,
              ewayBillNo: input.ewayBillNo,
              irnNo: input.irnNo,
              consigneeName: input.consigneeName,
              consigneeAddress: input.consigneeAddress,
              consigneeGstin: input.consigneeGstin,
              buyerName: input.buyerName,
              buyerAddress: input.buyerAddress,
              buyerGstin: input.buyerGstin,
              billedById: input.billedById,
              billedByName: input.billedByName,
              items: {
                create: computedItems.map((item) => ({
                  productId: item.productId,
                  mmProductId: item.mmProductId,
                  productName: item.productName,
                  hsnSac: item.hsnSac,
                  unit: item.unit,
                  qty: item.qty,
                  unitPrice: item.unitPrice,
                  gstRate: item.gstRate,
                  gstAmount: item.gstAmount,
                  totalAmount: item.totalAmount,
                })),
              },
            },
            include: { items: true, payments: true, customer: true, mmCustomer: true },
          });
          // Deduct stock inside the same transaction as the create — either
          // both happen or neither does, never a bill sold with no stock impact.
          await this.adjustMmStock(tx, computedItems, -1, bill.id);
          return bill;
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

    // The app currently never creates Payment rows itself (every bill saves
    // as fully PAID, no partial-payment UI exists) — this only guards
    // against the day that changes. Recomputing totals below would silently
    // delete any recorded payment history since it no longer lines up with
    // the new totals; refuse instead of destroying it quietly.
    const paymentCount = await this.prisma.payment.count({ where: { billId } });
    if (paymentCount > 0) {
      throw new Error('This bill has recorded payments and cannot be edited — editing would erase that payment history.');
    }

    const { items: computedItems, subTotal, totalGst, grandTotal } =
      this.computeItemTotals(input.items, input.gstInclusive ?? false);
    const discountAmount = input.discountAmount ?? 0;
    const roundOffAmount = input.roundOffAmount ?? 0;
    const finalTotal = grandTotal - discountAmount + roundOffAmount;

    if (finalTotal < 0) {
      throw new Error('Cannot save a bill with a negative total — the discount exceeds the bill amount.');
    }

    return this.prisma.$transaction(async (tx) => {
      // Restore stock for whatever this bill sold before (about to be
      // replaced below) — read the old items first, since deleteMany would
      // otherwise lose the qty/mmProductId needed to reverse them.
      const oldItems = await tx.billItem.findMany({ where: { billId } });
      await this.adjustMmStock(tx, oldItems, 1, billId);

      await tx.billItem.deleteMany({ where: { billId } });
      // Guarded above (paymentCount > 0 throws before this point) — this is
      // just belt-and-suspenders against a payment created in the gap
      // between that check and this transaction.
      await tx.payment.deleteMany({ where: { billId } });

      // Deduct stock for the new item set — same transaction as the old
      // items' restore and the update itself, so an edit's net stock effect
      // is always atomic (either the whole edit lands, or none of it does).
      await this.adjustMmStock(tx, computedItems, -1, billId);

      return tx.bill.update({
        where: { id: billId },
        data: {
          customerId: input.customerId ?? null,
          mmCustomerId: input.mmCustomerId ?? null,
          billDate: new Date(input.billDate),
          dueDate: input.dueDate ? new Date(input.dueDate) : null,
          subTotal,
          gstAmount: totalGst,
          discountAmount,
          grandTotal: finalTotal,
          status: 'PAID',
          paymentMode: input.paymentMode ?? null,
          notes: input.notes ?? null,
          serviceDescription: input.serviceDescription ?? null,
          serviceFrom: input.serviceFrom ? new Date(input.serviceFrom) : null,
          serviceTo: input.serviceTo ? new Date(input.serviceTo) : null,
          serviceDates: input.serviceDates?.length ? JSON.stringify(input.serviceDates) : null,
          gstInclusive: input.gstInclusive ?? false,
          isInterState: input.isInterState ?? false,
          vehicleNo: input.vehicleNo ?? null,
          despatchedThrough: input.despatchedThrough ?? null,
          destination: input.destination ?? null,
          otherReference: input.otherReference ?? null,
          ewayBillNo: input.ewayBillNo ?? null,
          irnNo: input.irnNo ?? null,
          consigneeName: input.consigneeName ?? null,
          consigneeAddress: input.consigneeAddress ?? null,
          consigneeGstin: input.consigneeGstin ?? null,
          buyerName: input.buyerName ?? null,
          buyerAddress: input.buyerAddress ?? null,
          buyerGstin: input.buyerGstin ?? null,
          billedById: input.billedById ?? null,
          billedByName: input.billedByName ?? null,
          items: {
            create: computedItems.map((item) => ({
              productId: item.productId,
              mmProductId: item.mmProductId,
              productName: item.productName,
              hsnSac: item.hsnSac,
              unit: item.unit,
              qty: item.qty,
              unitPrice: item.unitPrice,
              gstRate: item.gstRate,
              gstAmount: item.gstAmount,
              totalAmount: item.totalAmount,
            })),
          },
        },
        include: { items: true, payments: true, customer: true, mmCustomer: true },
      });
    });
  }

  async getBillWithDetails(billId: number) {
    return this.prisma.bill.findUnique({
      where: { id: billId, deletedAt: null },
      include: { items: true, payments: true, customer: true, mmCustomer: true },
    });
  }
}
