import { useState } from 'react';
import { X, Save, Plus } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CustomerBar, type CustomerInfo } from '@/components/billing/CustomerBar';
import { LineItemRow } from '@/components/billing/LineItemRow';
import { PaymentModeSelect } from '@/components/billing/PaymentModeSelect';
import { billsApi } from '@/api/bills';
import { mmCustomersApi } from '@/api/mmCustomers';
import { useToast } from '@/hooks/use-toast';
import { useClosingTransition } from '@/hooks/use-closing-transition';
import { computeLineTotals, splitTaxP } from '@/lib/billMath';
import { newId } from '@/lib/utils';
import type { Bill, BillItemForm, PaymentMode } from '@/types';
import { paisaToRupee, rupeeToPaisa, formatCurrency } from '@/types';

const newEmptyItem = (): BillItemForm => ({
  _id: newId(),
  productName: '',
  unit: 'Kgs',
  qty: 1,
  unitPrice: 0,
  gstRate: 5,
});

interface MmEditBillModalProps {
  bill: Bill;
  onClose: () => void;
  onSaved: (updated: Bill) => void;
}

/** MM billing module's own edit-bill flow — mirrors EditBillModal, but always
 * shows the Tax Invoice Details fields (no Thermal/A4/MM toggle — MM bills
 * are never anything else) and edits bill.mmCustomer via mmCustomersApi. */
export function MmEditBillModal({ bill, onClose, onSaved }: MmEditBillModalProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { closing, requestClose } = useClosingTransition(onClose);

  const [customer, setCustomer] = useState<CustomerInfo>({
    id: bill.mmCustomer?.id,
    name: bill.mmCustomer?.name ?? '',
    phone: bill.mmCustomer?.phone ?? '',
    gstin: bill.mmCustomer?.gstin ?? '',
    address: bill.mmCustomer?.address ?? '',
  });
  const [items, setItems] = useState<BillItemForm[]>(
    bill.items.map((i) => ({
      _id: newId(),
      productId: undefined, // MM items never link back to a Product row — see LineItemRow's catalog='mm' note
      mmProductId: i.mmProductId,
      productName: i.productName,
      hsnSac: i.hsnSac,
      unit: i.unit,
      qty: i.qty,
      unitPrice: paisaToRupee(i.unitPrice),
      gstRate: i.gstRate,
    })),
  );

  // Bill date and discount are not editable — same rule as the main app.
  const discountP = bill.discountAmount;

  const [paymentMode, setPaymentMode] = useState<PaymentMode | ''>(bill.paymentMode ?? '');
  const [notes, setNotes] = useState(bill.notes ?? '');
  const [isInterState, setIsInterState] = useState(bill.isInterState);
  const [vehicleNo, setVehicleNo] = useState(bill.vehicleNo ?? '');
  const [despatchedThrough, setDespatchedThrough] = useState(bill.despatchedThrough ?? '');
  const [destination, setDestination] = useState(bill.destination ?? '');
  const [otherReference, setOtherReference] = useState(bill.otherReference ?? '');
  const [ewayBillNo, setEwayBillNo] = useState(bill.ewayBillNo ?? '');
  const [irnNo, setIrnNo] = useState(bill.irnNo ?? '');
  const [consigneeName, setConsigneeName] = useState(bill.consigneeName ?? '');
  const [consigneeAddress, setConsigneeAddress] = useState(bill.consigneeAddress ?? '');
  const [consigneeGstin, setConsigneeGstin] = useState(bill.consigneeGstin ?? '');
  const [buyerManualEntry, setBuyerManualEntry] = useState(!!bill.buyerName);
  const [buyerName, setBuyerName] = useState(bill.buyerName ?? '');
  const [buyerAddress, setBuyerAddress] = useState(bill.buyerAddress ?? '');
  const [buyerGstin, setBuyerGstin] = useState(bill.buyerGstin ?? '');

  const countedItems = items.filter((i) => i.productName.trim() && i.qty > 0);
  const { subTotalP, gstTotalP } = computeLineTotals(countedItems, false);
  const _activeRates = [...new Set(countedItems.filter((i) => i.gstRate > 0).map((i) => i.gstRate))];
  const gstHalfRate = _activeRates.length === 1 ? _activeRates[0] / 2 : null;
  const gstFullRate = _activeRates.length === 1 ? _activeRates[0] : null;
  const rawTotalP = subTotalP + gstTotalP - discountP;
  const roundOffP = Math.round(rawTotalP / 100) * 100 - rawTotalP;
  const grandTotalP = rawTotalP + roundOffP;

  const updateMutation = useMutation({
    mutationFn: (payload: Parameters<typeof billsApi.editBill>[1]) =>
      billsApi.editBill(bill.id, payload),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ['bills'] });
      toast({ title: 'MM Bill updated!', description: `${updated.billNumber} saved.`, variant: 'success' });
      onSaved(updated);
    },
    onError: (err: Error) => {
      toast({ title: 'Error updating MM bill', description: err.message, variant: 'destructive' });
    },
  });

  const handleSave = async () => {
    const validItems = countedItems;
    if (validItems.length === 0) {
      toast({ title: 'No items', description: 'Add at least one item.', variant: 'destructive' });
      return;
    }

    const unpriced = validItems.find((i) => i.unitPrice < 0);
    if (unpriced) {
      toast({
        title: 'Item has an invalid price',
        description: `"${unpriced.productName}" has a negative price — fix it before saving.`,
        variant: 'destructive',
      });
      return;
    }

    let mmCustomerId: number | undefined = customer.id;
    if (!mmCustomerId && customer.name.trim() && customer.phone.trim()) {
      try {
        const created = await mmCustomersApi.create({
          name: customer.name.trim(),
          phone: customer.phone.trim(),
          gstin: customer.gstin?.trim() || undefined,
          address: customer.address?.trim() || undefined,
        });
        mmCustomerId = created.id;
        qc.invalidateQueries({ queryKey: ['mm-customers'] });
      } catch {
        // non-critical — continue without
      }
    }

    updateMutation.mutate({
      mmCustomerId,
      billDate: bill.billDate,
      items: validItems.map((i) => ({
        productId: undefined,
        mmProductId: i.mmProductId,
        productName: i.productName,
        hsnSac: i.hsnSac,
        unit: i.unit,
        qty: i.qty,
        unitPrice: rupeeToPaisa(i.unitPrice),
        gstRate: i.gstRate,
      })),
      notes: notes.trim() || undefined,
      discountAmount: bill.discountAmount,
      roundOffAmount: roundOffP,
      paymentMode: paymentMode || undefined,
      isInterState,
      vehicleNo: vehicleNo.trim() || undefined,
      despatchedThrough: despatchedThrough.trim() || undefined,
      destination: destination.trim() || undefined,
      otherReference: otherReference.trim() || undefined,
      ewayBillNo: ewayBillNo.trim() || undefined,
      irnNo: irnNo.trim() || undefined,
      consigneeName: consigneeName.trim() || undefined,
      consigneeAddress: consigneeAddress.trim() || undefined,
      consigneeGstin: consigneeGstin.trim() || undefined,
      buyerName: buyerManualEntry ? buyerName.trim() || undefined : undefined,
      buyerAddress: buyerManualEntry ? buyerAddress.trim() || undefined : undefined,
      buyerGstin: buyerManualEntry ? buyerGstin.trim() || undefined : undefined,
    });
  };

  return (
    <div
      className={`fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-[2px] flex items-center justify-center p-4 duration-150 ${closing ? 'animate-out fade-out-0' : 'animate-in fade-in-0'}`}
      onClick={(e) => { if (e.target === e.currentTarget) requestClose(); }}
    >
      <div className={`bg-white rounded-xl shadow-soft-lg w-full max-w-5xl max-h-[95vh] flex flex-col duration-200 ${closing ? 'animate-out fade-out-0 zoom-out-95' : 'animate-in fade-in-0 zoom-in-95'}`}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <div>
            <h3 className="font-bold text-lg">Edit MM Bill — {bill.billNumber}</h3>
            <p className="text-xs text-amber-600 font-medium">Changes replace all items and recalculate totals</p>
          </div>
          <Button variant="ghost" size="icon" onClick={requestClose}><X className="h-4 w-4" /></Button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-auto flex-1 p-6 space-y-4">

          {/* Customer + Date */}
          <Card className="border-brand-500/30 bg-brand-50/60">
            <CardContent className="pt-4 pb-4 grid grid-cols-12 gap-4 items-end">
              <div className="col-span-6">
                <Label className="text-xs text-muted-foreground mb-1.5 block">Customer</Label>
                <CustomerBar value={customer} onChange={setCustomer} showAddress />
              </div>
              <div className="col-span-3">
                <Label className="text-xs text-muted-foreground mb-1.5 block">Date</Label>
                <p className="h-10 flex items-center px-3 rounded-lg border border-slate-200 bg-slate-50 text-sm font-medium text-slate-700">
                  {new Date(bill.billDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                </p>
              </div>
              <div className="col-span-3">
                <Label className="text-xs text-muted-foreground mb-1.5 block">Payment Mode</Label>
                <PaymentModeSelect value={paymentMode} onChange={setPaymentMode} />
              </div>
            </CardContent>
          </Card>

          {/* Tax Invoice Details — always shown for MM bills */}
          <Card className="border-slate-200">
            <CardContent className="pt-3 pb-3 space-y-3">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Tax Invoice Details</p>
              <div className="grid grid-cols-12 gap-3">
                <div className="col-span-3">
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Vehicle No</Label>
                  <Input value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} />
                </div>
                <div className="col-span-3">
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Despatched Through</Label>
                  <Input value={despatchedThrough} onChange={(e) => setDespatchedThrough(e.target.value)} />
                </div>
                <div className="col-span-3">
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Destination</Label>
                  <Input value={destination} onChange={(e) => setDestination(e.target.value)} />
                </div>
                <div className="col-span-3">
                  <Label className="text-xs text-muted-foreground mb-1.5 block">E-Way Bill No</Label>
                  <Input value={ewayBillNo} onChange={(e) => setEwayBillNo(e.target.value)} />
                </div>
                <div className="col-span-6">
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Other Reference</Label>
                  <Input value={otherReference} onChange={(e) => setOtherReference(e.target.value)} />
                </div>
                <div className="col-span-6">
                  <Label className="text-xs text-muted-foreground mb-1.5 block">IRN No</Label>
                  <Input value={irnNo} onChange={(e) => setIrnNo(e.target.value)} placeholder="Paste from the govt. e-invoice portal, if any" />
                </div>
              </div>

              <div className="pt-1 border-t border-slate-100">
                <label className="flex items-center gap-2 text-xs text-slate-600 mb-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={buyerManualEntry}
                    onChange={(e) => setBuyerManualEntry(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-slate-300"
                  />
                  Enter Buyer details manually (skip customer record — for a one-off buyer)
                </label>
                {buyerManualEntry && (
                  <div className="grid grid-cols-12 gap-3 mb-3">
                    <div className="col-span-4">
                      <Label className="text-xs text-muted-foreground mb-1.5 block">Buyer Name</Label>
                      <Input value={buyerName} onChange={(e) => setBuyerName(e.target.value)} />
                    </div>
                    <div className="col-span-5">
                      <Label className="text-xs text-muted-foreground mb-1.5 block">Buyer Address</Label>
                      <Input value={buyerAddress} onChange={(e) => setBuyerAddress(e.target.value)} />
                    </div>
                    <div className="col-span-3">
                      <Label className="text-xs text-muted-foreground mb-1.5 block">Buyer GSTIN</Label>
                      <Input value={buyerGstin} onChange={(e) => setBuyerGstin(e.target.value.toUpperCase())} maxLength={15} />
                    </div>
                  </div>
                )}
              </div>

              <div className="pt-1 border-t border-slate-100">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
                  Consignee (ship-to) — entered separately, not copied from Buyer
                </p>
                <div className="grid grid-cols-12 gap-3">
                  <div className="col-span-4">
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Consignee Name</Label>
                    <Input value={consigneeName} onChange={(e) => setConsigneeName(e.target.value)} />
                  </div>
                  <div className="col-span-5">
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Consignee Address</Label>
                    <Input value={consigneeAddress} onChange={(e) => setConsigneeAddress(e.target.value)} />
                  </div>
                  <div className="col-span-3">
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Consignee GSTIN</Label>
                    <Input value={consigneeGstin} onChange={(e) => setConsigneeGstin(e.target.value)} />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Items + Summary */}
          <div className="grid grid-cols-12 gap-4">

            <div className="col-span-9">
              <Card>
                <CardHeader className="pb-3 flex flex-row items-center justify-between">
                  <CardTitle className="text-sm">MM Bill Items</CardTitle>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer" title="Apply IGST instead of CGST+SGST">
                      <input
                        type="checkbox"
                        checked={isInterState}
                        onChange={(e) => setIsInterState(e.target.checked)}
                      />
                      Inter-state (IGST)
                    </label>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setItems((p) => [...p, newEmptyItem()])}
                    >
                      <Plus className="w-4 h-4 mr-1" /> Add Item
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-0 overflow-visible">
                  <div className="overflow-visible">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b bg-slate-50/80">
                          <th className="text-center py-2 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground w-8">#</th>
                          <th className="text-left py-2 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">MM Product</th>
                          <th className="text-right py-2 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground w-16">Qty</th>
                          <th className="text-right py-2 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground w-24">Price (₹)</th>
                          <th className="text-right py-2 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground w-16">GST %</th>
                          <th className="text-left py-2 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground w-24">HSN/SAC</th>
                          <th className="text-right py-2 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground w-24">Amount</th>
                          <th className="w-8" />
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item, idx) => (
                          <LineItemRow
                            key={item._id}
                            index={idx}
                            item={item}
                            catalog="mm"
                            showHsnSac
                            gstInclusive={false}
                            onChange={(u) => setItems((p) => p.map((i, j) => (j === idx ? u : i)))}
                            onRemove={() => setItems((p) => p.filter((_, j) => j !== idx))}
                            includeInactive
                          />
                        ))}
                      </tbody>
                    </table>
                    {items.length === 0 && (
                      <div className="py-12 text-center text-muted-foreground text-sm">
                        <Plus className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        No items. Click "Add Item" to begin.
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Summary — 3 cols */}
            <div className="col-span-3">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Summary</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Sub Total</span>
                    <span className="font-medium tabular-nums">₹{paisaToRupee(subTotalP).toFixed(2)}</span>
                  </div>
                  {isInterState ? (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{gstFullRate !== null ? `IGST (${gstFullRate}%)` : 'IGST'}</span>
                      <span className="font-medium tabular-nums">₹{paisaToRupee(gstTotalP).toFixed(2)}</span>
                    </div>
                  ) : (
                    <>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{gstHalfRate !== null ? `CGST (${gstHalfRate}%)` : 'CGST'}</span>
                        <span className="font-medium tabular-nums">₹{paisaToRupee(splitTaxP(gstTotalP, false).cgstP).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{gstHalfRate !== null ? `SGST (${gstHalfRate}%)` : 'SGST'}</span>
                        <span className="font-medium tabular-nums">₹{paisaToRupee(splitTaxP(gstTotalP, false).sgstP).toFixed(2)}</span>
                      </div>
                    </>
                  )}
                  {discountP > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Discount</span>
                      <span className="font-medium tabular-nums">−₹{paisaToRupee(discountP).toFixed(2)}</span>
                    </div>
                  )}
                  {roundOffP !== 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Round Off</span>
                      <span className="font-medium text-slate-500">
                        {roundOffP > 0 ? '+' : ''}₹{paisaToRupee(roundOffP).toFixed(2)}
                      </span>
                    </div>
                  )}
                  <div className="border-t pt-2.5 mt-1">
                    <div className="flex justify-between items-center">
                      <span className="font-semibold text-slate-700">Grand Total</span>
                      <span className="text-xl font-bold text-brand-700 tabular-nums">{formatCurrency(grandTotalP)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="mt-3">
                <CardHeader className="pb-2"><CardTitle className="text-sm">Notes / Remarks</CardTitle></CardHeader>
                <CardContent>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Internal notes about this bill — not printed on the invoice"
                    className="min-h-[100px]"
                  />
                </CardContent>
              </Card>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t shrink-0">
          <Button variant="outline" onClick={requestClose}>Cancel</Button>
          <Button
            onClick={handleSave}
            disabled={updateMutation.isPending}
            className="px-8"
          >
            <Save className="w-4 h-4 mr-2" />
            {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      </div>
    </div>
  );
}
