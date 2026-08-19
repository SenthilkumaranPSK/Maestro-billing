import type { Bill, BillItem, BillItemForm, Customer, MmCustomer } from '@/types';
import { rupeeToPaisa } from '@/types';
import { computeItemLineTotal } from '@/lib/billMath';
import type { CustomerInfo } from '@/components/billing/CustomerBar';

export interface DraftBillFields {
  billNumber: string;
  items: BillItemForm[];
  gstInclusive: boolean;
  isInterState: boolean;
  customer: CustomerInfo;
  roundOffP: number;
  series?: 'MAIN' | 'MM';
  serviceDescription?: string;
  serviceDates?: string[];
  vehicleNo?: string;
  despatchedThrough?: string;
  destination?: string;
  otherReference?: string;
  ewayBillNo?: string;
  irnNo?: string;
  consigneeName?: string;
  consigneeAddress?: string;
  consigneeGstin?: string;
  buyerName?: string;
  buyerAddress?: string;
  buyerGstin?: string;
}

/**
 * Builds a Bill-shaped object straight from in-progress form state — never
 * sent to the API, never persisted — so the Preview button can feed the same
 * generateBillPDF/generateA4InvoicePDF/generateMmA4InvoicePDF functions a
 * saved Bill uses, before the operator has clicked Save. GST math mirrors
 * handleSave's own computeLineTotals call exactly (same per-item rounding),
 * so the preview can't show numbers that saving would then contradict.
 */
export function buildDraftBill(fields: DraftBillFields): Bill {
  const countedItems = fields.items.filter((i) => i.productName.trim() && i.qty > 0);
  const series = fields.series ?? 'MAIN';

  let subTotalP = 0;
  let gstAmountP = 0;
  const items: BillItem[] = countedItems.map((item, idx) => {
    const totals = computeItemLineTotal(item, fields.gstInclusive);
    subTotalP += totals.subTotalP;
    gstAmountP += totals.gstAmountP;
    return {
      id: -(idx + 1),
      billId: 0,
      productId: item.productId,
      mmProductId: item.mmProductId,
      productName: item.productName,
      hsnSac: item.hsnSac,
      unit: item.unit,
      qty: item.qty,
      unitPrice: rupeeToPaisa(item.unitPrice),
      gstRate: item.gstRate,
      gstAmount: totals.gstAmountP,
      totalAmount: totals.totalP,
    };
  });

  const customerRecord: Customer | MmCustomer | undefined =
    fields.customer.name.trim() || fields.customer.phone.trim()
      ? {
          id: fields.customer.id ?? 0,
          name: fields.customer.name,
          phone: fields.customer.phone,
          gstin: fields.customer.gstin,
          address: fields.customer.address,
          isActive: true,
          createdAt: '',
          updatedAt: '',
        }
      : undefined;

  return {
    id: 0,
    billNumber: fields.billNumber,
    customerId: series === 'MAIN' ? fields.customer.id : undefined,
    customer: series === 'MAIN' ? (customerRecord as Customer | undefined) : undefined,
    mmCustomerId: series === 'MM' ? fields.customer.id : undefined,
    mmCustomer: series === 'MM' ? (customerRecord as MmCustomer | undefined) : undefined,
    billDate: new Date().toISOString(),
    subTotal: subTotalP,
    gstAmount: gstAmountP,
    discountAmount: 0,
    grandTotal: subTotalP + gstAmountP + fields.roundOffP,
    status: 'DRAFT',
    serviceDescription: fields.serviceDescription,
    serviceDates: fields.serviceDates,
    gstInclusive: fields.gstInclusive,
    isInterState: fields.isInterState,
    vehicleNo: fields.vehicleNo,
    despatchedThrough: fields.despatchedThrough,
    destination: fields.destination,
    otherReference: fields.otherReference,
    ewayBillNo: fields.ewayBillNo,
    irnNo: fields.irnNo,
    consigneeName: fields.consigneeName,
    consigneeAddress: fields.consigneeAddress,
    consigneeGstin: fields.consigneeGstin,
    buyerName: fields.buyerName,
    buyerAddress: fields.buyerAddress,
    buyerGstin: fields.buyerGstin,
    series,
    items,
    payments: [],
    createdAt: '',
  };
}
