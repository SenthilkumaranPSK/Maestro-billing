import { useEffect, useMemo, useState } from 'react';
import { Plus, Printer, FileText, ScanEye, Save, RotateCcw, CalendarDays } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CustomerBar, type CustomerInfo } from '@/components/billing/CustomerBar';
import { LineItemRow } from '@/components/billing/LineItemRow';
import { PdfPreviewModal } from '@/components/billing/PdfPreviewModal';
import { PaymentModeSelect } from '@/components/billing/PaymentModeSelect';
import { billsApi } from '@/api/bills';
import { mmCustomersApi } from '@/api/mmCustomers';
import { settingsApi } from '@/api/settings';
import { whatsappApi } from '@/api/whatsapp';
import { useToast } from '@/hooks/use-toast';
import { isValidIndianPhone, newId } from '@/lib/utils';
import { computeLineTotals, splitTaxP } from '@/lib/billMath';
import { suggestInterState } from '@/lib/gstin';
import { buildDraftBill } from '@/lib/draftBill';
import type { BillItemForm, Bill, Settings, PaymentMode } from '@/types';
import { rupeeToPaisa, paisaToRupee, formatCurrency, shouldShowWhatsappOnBilling } from '@/types';

// pdf-lib is heavy — loaded on demand, same pattern as the main Billing page.
const loadMmA4Lib = () => import('@/lib/mmA4invoice');

/**
 * MM Billing — a wholly separate billing area from the studio's normal
 * Thermal/A4 billing (own product catalog, own MM/YY-YY/NNN bill numbering,
 * own history list). Always renders as the MM/A4 GST Tax Invoice layout —
 * there's no Thermal/A4 toggle here, unlike the main Billing page.
 */

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

function buildWhatsAppCaption(billNumber: string, grandTotal: number, customerName?: string): string {
  return `Dear ${customerName?.trim() || 'Customer'},

Thank you for your business!

MM Bill No: ${billNumber}
Total Amount: ${formatCurrency(grandTotal)}`;
}

async function sendBillViaWhatsApp(bill: Bill, phone: string, settings: Partial<Settings>): Promise<void> {
  const { generateMmA4InvoicePDFBase64 } = await loadMmA4Lib();
  const pdfBase64 = await generateMmA4InvoicePDFBase64(bill, settings);
  await whatsappApi.sendPdf({
    phone,
    pdfBase64,
    fileName: `${bill.billNumber}.pdf`,
    caption: buildWhatsAppCaption(bill.billNumber, bill.grandTotal, bill.mmCustomer?.name),
  });
}

/**
 * Map backend WhatsApp errors to user-friendly messages — same mapping as
 * the main Billing page.
 */
function whatsappErrorMessage(msg: string): string {
  if (msg.includes('not linked')) {
    return 'Link WhatsApp in Settings, then tap Send Bill on WhatsApp.';
  }
  if (msg.includes('not registered') || msg.includes('is not a WhatsApp')) {
    return "This number isn't on WhatsApp. Verify with the customer.";
  }
  if (msg.includes('Invalid number') || msg.includes('invalid phone')) {
    return 'Phone number is invalid for WhatsApp.';
  }
  return msg;
}

const newEmptyItem = (defaultGstRate = 5): BillItemForm => ({
  _id: newId(),
  productName: '',
  unit: 'Kgs',
  qty: 1,
  unitPrice: 0,
  gstRate: defaultGstRate,
});

export default function MmBillingPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [customer, setCustomer] = useState<CustomerInfo>({ name: '', phone: '' });
  const [items, setItems] = useState<BillItemForm[]>([newEmptyItem()]);
  const [savedBill, setSavedBill] = useState<Bill | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [sendOnWhatsApp, setSendOnWhatsApp] = useState(false);
  const [sendingWhatsApp, setSendingWhatsApp] = useState(false);
  // How the bill was paid — shown in the form and history/detail views only,
  // never on the printed invoice. See components/billing/PaymentModeSelect.
  const [paymentMode, setPaymentMode] = useState<PaymentMode | ''>('');
  // Inter-state supply (IGST) vs intra-state (CGST+SGST) — mutually
  // exclusive, see schema.prisma Bill.isInterState. Auto-suggested below
  // from GSTIN state codes when the customer changes, but always overridable.
  const [isInterState, setIsInterState] = useState(false);

  // Tax Invoice Details — same fields as the main Billing page's MM/A4 mode,
  // always shown here since MM bills always need them.
  const [vehicleNo, setVehicleNo] = useState('');
  const [despatchedThrough, setDespatchedThrough] = useState('');
  const [destination, setDestination] = useState('');
  const [otherReference, setOtherReference] = useState('');
  const [ewayBillNo, setEwayBillNo] = useState('');
  const [irnNo, setIrnNo] = useState('');
  const [consigneeSameAsBuyer, setConsigneeSameAsBuyer] = useState(true);
  const [consigneeName, setConsigneeName] = useState('');
  const [consigneeAddress, setConsigneeAddress] = useState('');
  const [consigneeGstin, setConsigneeGstin] = useState('');
  // Manual Buyer override — for a one-off wholesale buyer the operator
  // doesn't want saved as an MmCustomer (which mandates a phone number).
  // The "Customer" bar above still drives mmCustomerId (phone/WhatsApp/
  // repeat-customer lookup) independently of this.
  const [buyerManualEntry, setBuyerManualEntry] = useState(false);
  const [buyerName, setBuyerName] = useState('');
  const [buyerAddress, setBuyerAddress] = useState('');
  const [buyerGstin, setBuyerGstin] = useState('');

  const { data: nextNumber } = useQuery({
    queryKey: ['bills', 'next-number', 'MM'],
    queryFn: () => billsApi.getNextNumber('MM'),
    enabled: !savedBill,
    staleTime: 0,
  });

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  });
  // Editable via MM Settings — falls back to the seeded 5% until that
  // setting exists (older installs, or before settings finish loading).
  const defaultGstRate = Number(settings?.mm?.mm_default_gst_rate ?? 5);
  // Same global "show WhatsApp" setting the main Billing page uses.
  const showWhatsapp = shouldShowWhatsappOnBilling(settings?.general);

  // Re-suggest Inter-state whenever the selected customer's GSTIN changes —
  // still just a default, the checkbox stays freely overridable.
  useEffect(() => {
    if (savedBill) return;
    const suggestion = suggestInterState(settings?.studio?.studio_gstin, customer.gstin);
    if (suggestion !== null) setIsInterState(suggestion);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer.gstin, settings?.studio?.studio_gstin]);

  const countedItems = items.filter((i) => i.productName.trim() && i.qty > 0);
  const { subTotalP, gstTotalP } = computeLineTotals(countedItems, false);
  const gstRates = [...new Set(countedItems.filter((i) => i.gstRate > 0).map((i) => i.gstRate))];
  const gstHalfRate = gstRates.length === 1 ? gstRates[0]! / 2 : null;
  const gstFullRate = gstRates.length === 1 ? gstRates[0]! : null;
  const rawTotalP = subTotalP + gstTotalP;
  const roundOffP = Math.round(rawTotalP / 100) * 100 - rawTotalP;
  const grandTotalP = rawTotalP + roundOffP;

  // Bill-shaped view of the current form state, purely for the pre-save
  // Preview button — see lib/draftBill. Memoized so PdfPreviewModal's
  // per-layout PDF cache survives re-renders that don't change anything
  // this would print.
  const draftBill = useMemo(
    () =>
      buildDraftBill({
        billNumber: nextNumber ?? 'DRAFT',
        items,
        gstInclusive: false,
        isInterState,
        customer,
        roundOffP,
        series: 'MM',
        vehicleNo,
        despatchedThrough,
        destination,
        otherReference,
        ewayBillNo,
        irnNo,
        consigneeName: consigneeSameAsBuyer ? undefined : consigneeName,
        consigneeAddress: consigneeSameAsBuyer ? undefined : consigneeAddress,
        consigneeGstin: consigneeSameAsBuyer ? undefined : consigneeGstin,
        buyerName: buyerManualEntry ? buyerName : undefined,
        buyerAddress: buyerManualEntry ? buyerAddress : undefined,
        buyerGstin: buyerManualEntry ? buyerGstin : undefined,
      }),
    [
      nextNumber, items, isInterState, customer, roundOffP, vehicleNo, despatchedThrough, destination,
      otherReference, ewayBillNo, irnNo, consigneeSameAsBuyer, consigneeName, consigneeAddress, consigneeGstin,
      buyerManualEntry, buyerName, buyerAddress, buyerGstin,
    ],
  );

  const createBillMutation = useMutation({
    mutationFn: billsApi.create,
    onSuccess: async (bill) => {
      setSavedBill(bill);
      qc.invalidateQueries({ queryKey: ['bills'] });
      toast({ title: 'MM Bill saved!', description: `${bill.billNumber} created.`, variant: 'success' });

      if (sendOnWhatsApp && customer.phone.trim()) {
        if (!isValidIndianPhone(customer.phone.trim())) {
          toast({
            title: 'Phone number is invalid',
            description: 'Bill saved but not sent on WhatsApp.',
            variant: 'destructive',
          });
        } else {
          setSendingWhatsApp(true);
          try {
            await sendBillViaWhatsApp(bill, customer.phone.trim(), settings ?? {});
            toast({
              title: 'Sent on WhatsApp!',
              description: `Invoice ${bill.billNumber}.pdf delivered to ${customer.phone}.`,
              variant: 'success',
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Could not send via WhatsApp';
            toast({
              title: 'WhatsApp send failed',
              description: whatsappErrorMessage(msg),
              variant: 'destructive',
            });
          } finally {
            setSendingWhatsApp(false);
          }
        }
      }
    },
    onError: (err: Error) => {
      toast({ title: 'Error saving MM bill', description: err.message, variant: 'destructive' });
    },
  });

  const handleSave = async () => {
    const validItems = countedItems;
    if (validItems.length === 0) {
      toast({ title: 'No items', description: 'Add at least one item to the bill.', variant: 'destructive' });
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
    if (grandTotalP < 0) {
      toast({ title: 'Negative total not allowed', variant: 'destructive' });
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
        // non-critical — continue without customer
      }
    }

    createBillMutation.mutate({
      mmCustomerId,
      billDate: new Date().toISOString(),
      items: validItems.map((i) => ({
        // MM items never link back to a Product row — see LineItemRow's
        // catalog='mm' note (productId is a FK into Product only). They
        // link via mmProductId instead, which is what lets stock auto-deduct.
        productId: undefined,
        mmProductId: i.mmProductId,
        productName: i.productName,
        hsnSac: i.hsnSac,
        unit: i.unit,
        qty: i.qty,
        unitPrice: rupeeToPaisa(i.unitPrice),
        gstRate: i.gstRate,
      })),
      roundOffAmount: roundOffP,
      paymentMode: paymentMode || undefined,
      isInterState,
      vehicleNo: vehicleNo.trim() || undefined,
      despatchedThrough: despatchedThrough.trim() || undefined,
      destination: destination.trim() || undefined,
      otherReference: otherReference.trim() || undefined,
      ewayBillNo: ewayBillNo.trim() || undefined,
      irnNo: irnNo.trim() || undefined,
      consigneeName: consigneeSameAsBuyer ? undefined : consigneeName.trim() || undefined,
      consigneeAddress: consigneeSameAsBuyer ? undefined : consigneeAddress.trim() || undefined,
      consigneeGstin: consigneeSameAsBuyer ? undefined : consigneeGstin.trim() || undefined,
      buyerName: buyerManualEntry ? buyerName.trim() || undefined : undefined,
      buyerAddress: buyerManualEntry ? buyerAddress.trim() || undefined : undefined,
      buyerGstin: buyerManualEntry ? buyerGstin.trim() || undefined : undefined,
      series: 'MM',
    });
  };

  const handlePrint = async () => {
    if (!savedBill) return;
    const { printMmA4InvoicePDF } = await loadMmA4Lib();
    await printMmA4InvoicePDF(savedBill, settings ?? {});
  };

  const handleDownloadPdf = async () => {
    if (!savedBill) return;
    const { downloadMmA4InvoicePDF } = await loadMmA4Lib();
    await downloadMmA4InvoicePDF(savedBill, settings ?? {});
  };

  const handleWhatsAppShare = async () => {
    if (!savedBill || !customer.phone) return;
    if (!isValidIndianPhone(customer.phone.trim())) {
      toast({
        title: 'Phone number is invalid',
        description: 'Update the customer phone, then tap Send Bill on WhatsApp.',
        variant: 'destructive',
      });
      return;
    }
    setSendingWhatsApp(true);
    try {
      await sendBillViaWhatsApp(savedBill, customer.phone.trim(), settings ?? {});
      toast({
        title: 'Sent on WhatsApp!',
        description: `Invoice ${savedBill.billNumber}.pdf delivered to ${customer.phone}.`,
        variant: 'success',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not send via WhatsApp';
      toast({
        title: 'WhatsApp send failed',
        description: whatsappErrorMessage(msg),
        variant: 'destructive',
      });
    } finally {
      setSendingWhatsApp(false);
    }
  };

  const handleReset = () => {
    setCustomer({ name: '', phone: '', gstin: '', address: '' });
    setItems([newEmptyItem(defaultGstRate)]);
    setSavedBill(null);
    setSendOnWhatsApp(false);
    setPaymentMode('');
    setVehicleNo('');
    setDespatchedThrough('');
    setDestination('');
    setOtherReference('');
    setEwayBillNo('');
    setIrnNo('');
    setConsigneeSameAsBuyer(true);
    setConsigneeName('');
    setConsigneeAddress('');
    setConsigneeGstin('');
    setBuyerManualEntry(false);
    setBuyerName('');
    setBuyerAddress('');
    setBuyerGstin('');
    qc.invalidateQueries({ queryKey: ['bills', 'next-number', 'MM'] });
    qc.refetchQueries({ queryKey: ['bills', 'next-number', 'MM'] });
  };

  return (
    <>
    <div className="space-y-4 max-w-6xl">

      {/* ── Top action bar ──────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">MM Bill No</span>
          <span className="text-lg font-bold text-brand-700 tabular-nums">
            {savedBill?.billNumber ?? nextNumber ?? '—'}
          </span>
          {savedBill && (
            <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium animate-in zoom-in-50 duration-300">
              Saved
            </span>
          )}
        </div>

        <div className="flex gap-2 items-center">
          <Button variant="outline" size="sm" onClick={handleReset}>
            <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
            New MM Bill
          </Button>
          {savedBill ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setPreviewOpen(true)}>
                <ScanEye className="w-3.5 h-3.5 mr-1.5" />
                Preview
              </Button>
              <Button variant="outline" size="sm" onClick={handlePrint}>
                <Printer className="w-3.5 h-3.5 mr-1.5" />
                Print
              </Button>
              <Button variant="outline" size="sm" onClick={handleDownloadPdf}>
                <FileText className="w-3.5 h-3.5 mr-1.5" />
                PDF
              </Button>
              {showWhatsapp && customer.phone && (
                <Button
                  size="sm"
                  className="bg-whatsapp hover:bg-whatsapp-hover text-white border-0"
                  onClick={handleWhatsAppShare}
                  disabled={sendingWhatsApp}
                >
                  <WhatsAppIcon className="w-3.5 h-3.5 mr-1.5" />
                  {sendingWhatsApp ? 'Sending…' : 'WhatsApp'}
                </Button>
              )}
            </>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPreviewOpen(true)}
                disabled={countedItems.length === 0}
              >
                <ScanEye className="w-3.5 h-3.5 mr-1.5" />
                Preview
              </Button>
              <Button onClick={handleSave} disabled={createBillMutation.isPending} className="px-6">
                <Save className="w-3.5 h-3.5 mr-1.5" />
                {createBillMutation.isPending ? 'Saving…' : 'Save MM Bill'}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* ── Customer + Date bar ─────────────────────────────── */}
      <Card className="border-brand-500/30 bg-brand-50/60">
        <CardContent className="pt-4 pb-4 grid grid-cols-12 gap-4 items-end">
          <div className="col-span-6">
            <Label className="text-xs text-muted-foreground mb-1.5 block">Customer</Label>
            <CustomerBar value={customer} onChange={setCustomer} disabled={!!savedBill} showAddress />
          </div>
          <div className="col-span-3">
            <Label className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1">
              <CalendarDays className="w-3.5 h-3.5" /> Date
            </Label>
            <p className="h-10 flex items-center px-3 rounded-lg border border-slate-200 bg-slate-50 text-sm font-medium text-slate-700">
              {new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
            </p>
          </div>
          <div className="col-span-3">
            <Label className="text-xs text-muted-foreground mb-1.5 block">Payment Mode</Label>
            <PaymentModeSelect value={paymentMode} onChange={setPaymentMode} disabled={!!savedBill} />
          </div>
        </CardContent>
      </Card>

      {/* ── Tax Invoice Details — always shown for MM bills ─────────────── */}
      <Card className="border-slate-200">
        <CardContent className="pt-3 pb-3 space-y-3">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Tax Invoice Details</p>
          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-3">
              <Label className="text-xs text-muted-foreground mb-1.5 block">Vehicle No</Label>
              <Input value={vehicleNo} disabled={!!savedBill} onChange={(e) => setVehicleNo(e.target.value)} />
            </div>
            <div className="col-span-3">
              <Label className="text-xs text-muted-foreground mb-1.5 block">Despatched Through</Label>
              <Input value={despatchedThrough} disabled={!!savedBill} onChange={(e) => setDespatchedThrough(e.target.value)} />
            </div>
            <div className="col-span-3">
              <Label className="text-xs text-muted-foreground mb-1.5 block">Destination</Label>
              <Input value={destination} disabled={!!savedBill} onChange={(e) => setDestination(e.target.value)} />
            </div>
            <div className="col-span-3">
              <Label className="text-xs text-muted-foreground mb-1.5 block">E-Way Bill No</Label>
              <Input value={ewayBillNo} disabled={!!savedBill} onChange={(e) => setEwayBillNo(e.target.value)} />
            </div>
            <div className="col-span-6">
              <Label className="text-xs text-muted-foreground mb-1.5 block">Other Reference</Label>
              <Input value={otherReference} disabled={!!savedBill} onChange={(e) => setOtherReference(e.target.value)} />
            </div>
            <div className="col-span-6">
              <Label className="text-xs text-muted-foreground mb-1.5 block">IRN No</Label>
              <Input value={irnNo} disabled={!!savedBill} onChange={(e) => setIrnNo(e.target.value)} placeholder="Paste from the govt. e-invoice portal, if any" />
            </div>
          </div>

          <div className="pt-1 border-t border-slate-100">
            <label className="flex items-center gap-2 text-xs text-slate-600 mb-2 cursor-pointer">
              <input
                type="checkbox"
                checked={buyerManualEntry}
                disabled={!!savedBill}
                onChange={(e) => setBuyerManualEntry(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300"
              />
              Enter Buyer details manually (skip customer record — for a one-off buyer)
            </label>
            {buyerManualEntry && (
              <div className="grid grid-cols-12 gap-3 mb-3">
                <div className="col-span-4">
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Buyer Name</Label>
                  <Input value={buyerName} disabled={!!savedBill} onChange={(e) => setBuyerName(e.target.value)} />
                </div>
                <div className="col-span-5">
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Buyer Address</Label>
                  <Input value={buyerAddress} disabled={!!savedBill} onChange={(e) => setBuyerAddress(e.target.value)} />
                </div>
                <div className="col-span-3">
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Buyer GSTIN</Label>
                  <Input value={buyerGstin} disabled={!!savedBill} onChange={(e) => setBuyerGstin(e.target.value.toUpperCase())} maxLength={15} />
                </div>
              </div>
            )}
          </div>

          <div className="pt-1 border-t border-slate-100">
            <label className="flex items-center gap-2 text-xs text-slate-600 mb-2 cursor-pointer">
              <input
                type="checkbox"
                checked={consigneeSameAsBuyer}
                disabled={!!savedBill}
                onChange={(e) => setConsigneeSameAsBuyer(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300"
              />
              Consignee (ship-to) same as Buyer
            </label>
            {!consigneeSameAsBuyer && (
              <div className="grid grid-cols-12 gap-3">
                <div className="col-span-4">
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Consignee Name</Label>
                  <Input value={consigneeName} disabled={!!savedBill} onChange={(e) => setConsigneeName(e.target.value)} />
                </div>
                <div className="col-span-5">
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Consignee Address</Label>
                  <Input value={consigneeAddress} disabled={!!savedBill} onChange={(e) => setConsigneeAddress(e.target.value)} />
                </div>
                <div className="col-span-3">
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Consignee GSTIN</Label>
                  <Input value={consigneeGstin} disabled={!!savedBill} onChange={(e) => setConsigneeGstin(e.target.value)} />
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Items table + Summary ────────────────────────────────── */}
      <div className="grid grid-cols-12 gap-4">

        <div className="col-span-8">
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-sm">MM Bill Items</CardTitle>
              {!savedBill && (
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
                    onClick={() => setItems((prev) => [...prev, newEmptyItem(defaultGstRate)])}
                  >
                    <Plus className="w-4 h-4 mr-1" />
                    Add Item
                  </Button>
                </div>
              )}
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
                      {!savedBill && <th className="w-8" />}
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
                        disabled={!!savedBill}
                        onChange={(updated) =>
                          setItems((prev) => prev.map((i, j) => (j === idx ? updated : i)))
                        }
                        onRemove={() => setItems((prev) => prev.filter((_, j) => j !== idx))}
                        onRequestNewRow={
                          !savedBill && idx === items.length - 1
                            ? () => setItems((prev) => [...prev, newEmptyItem(defaultGstRate)])
                            : undefined
                        }
                      />
                    ))}
                  </tbody>
                </table>

                {items.length === 0 && (
                  <div className="py-12 text-center text-muted-foreground text-sm">
                    <Plus className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No items yet. Click "Add Item" to begin.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Summary — 4 cols */}
        <div className="col-span-4 space-y-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Summary</CardTitle>
            </CardHeader>
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

          {!savedBill && (
            <div className="space-y-2">
              {showWhatsapp && (
                <label
                  className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm select-none ${
                    customer.phone.trim()
                      ? 'cursor-pointer border-whatsapp/40 bg-emerald-50/60 text-slate-700'
                      : 'cursor-not-allowed border-slate-200 bg-slate-50 text-muted-foreground opacity-60'
                  }`}
                  title={customer.phone.trim() ? undefined : 'Enter a customer phone number to enable'}
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-whatsapp"
                    checked={sendOnWhatsApp}
                    disabled={!customer.phone.trim()}
                    onChange={(e) => setSendOnWhatsApp(e.target.checked)}
                  />
                  <WhatsAppIcon className="w-4 h-4 text-whatsapp shrink-0" />
                  Send on WhatsApp after saving
                </label>
              )}
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setPreviewOpen(true)}
                disabled={countedItems.length === 0}
              >
                <ScanEye className="w-4 h-4 mr-2" />
                Preview
              </Button>
              <Button className="w-full" onClick={handleSave} disabled={createBillMutation.isPending}>
                <Save className="w-4 h-4 mr-2" />
                {createBillMutation.isPending ? 'Saving…' : 'Save MM Bill'}
              </Button>
            </div>
          )}

          {savedBill && (
            <div className="space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <Button variant="outline" className="w-full" onClick={() => setPreviewOpen(true)}>
                <ScanEye className="w-4 h-4 mr-2" />
                Preview
              </Button>
              <Button variant="outline" className="w-full" onClick={handlePrint}>
                <Printer className="w-4 h-4 mr-2" />
                Print
              </Button>
              <Button variant="outline" className="w-full" onClick={handleDownloadPdf}>
                <FileText className="w-4 h-4 mr-2" />
                Download PDF
              </Button>
              {showWhatsapp && customer.phone && (
                <Button
                  className="w-full bg-whatsapp hover:bg-whatsapp-hover text-white border-0"
                  onClick={handleWhatsAppShare}
                  disabled={sendingWhatsApp}
                >
                  <WhatsAppIcon className="w-4 h-4 mr-2" />
                  {sendingWhatsApp ? 'Sending on WhatsApp…' : 'Send Bill on WhatsApp'}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>

    {previewOpen && (
      <PdfPreviewModal
        bill={savedBill ?? draftBill}
        settings={settings ?? {}}
        layout="mm_a4"
        readOnly={!savedBill}
        onClose={() => setPreviewOpen(false)}
      />
    )}
    </>
  );
}
