import { useEffect, useMemo, useState } from 'react';
import { Plus, Printer, FileText, ScanEye, Save, RotateCcw, CalendarDays, Zap, Copy, FileSpreadsheet } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CustomerBar, type CustomerInfo } from '@/components/billing/CustomerBar';
import { LineItemRow } from '@/components/billing/LineItemRow';
import { PdfPreviewModal } from '@/components/billing/PdfPreviewModal';
import { PaymentModeSelect } from '@/components/billing/PaymentModeSelect';
import { GstModeToggle } from '@/components/billing/GstModeToggle';
import { billsApi } from '@/api/bills';
import { mmCustomersApi } from '@/api/mmCustomers';
import { settingsApi } from '@/api/settings';
import { useNavigate } from 'react-router-dom';
import type { MmCopyType } from '@/lib/mmA4invoice';
import {
  isWhatsAppEmbedAvailable,
  isWhatsAppTextSendAvailable,
  openWhatsAppChatInNewTab,
  requestWhatsAppChat,
  sendBillTextOnWhatsApp,
} from '@/lib/whatsappWeb';
import { buildWhatsAppBillText } from '@/lib/whatsappBillText';
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

import { WhatsAppIcon } from '@/components/whatsapp/WhatsAppIcon';
import { WhatsAppShareDialog } from '@/components/whatsapp/WhatsAppShareDialog';

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
  const [whatsappModalBill, setWhatsappModalBill] = useState<Bill | null>(null);
  const [sendOnWhatsApp, setSendOnWhatsApp] = useState(false);
  const navigate = useNavigate();
  const [sendingWhatsApp, setSendingWhatsApp] = useState(false);
  const [copyType, setCopyType] = useState<MmCopyType>('ORIGINAL');
  const [previousDueRupees, setPreviousDueRupees] = useState('');
  // How the bill was paid — shown in the form and history/detail views only,
  // never on the printed invoice. See components/billing/PaymentModeSelect.
  const [paymentMode, setPaymentMode] = useState<PaymentMode | ''>('');
  // Inter-state supply (IGST) vs intra-state (CGST+SGST) — mutually
  // exclusive, see schema.prisma Bill.isInterState. Auto-suggested below
  // from GSTIN state codes when the customer changes, but always overridable.
  const [isInterState, setIsInterState] = useState(false);
  // Whole-bill GST pricing mode — same as the main Billing page. Exclusive
  // (default): GST added on top of the entered price. Inclusive: extracted
  // from within it. See schema.prisma Bill.gstInclusive.
  const [gstInclusive, setGstInclusive] = useState(false);
  // Internal record only — never printed on the Tax Invoice (same rule as
  // paymentMode above). See schema.prisma Bill.notes.
  const [notes, setNotes] = useState('');

  // Editable Bill Date (defaults to today YYYY-MM-DD)
  const [billDate, setBillDate] = useState(() => new Date().toISOString().slice(0, 10));

  // Tally Order & Dispatch Details
  const [termsOfPayment, setTermsOfPayment] = useState('');
  const [deliveryNote, setDeliveryNote] = useState('');
  const [deliveryNoteDate, setDeliveryNoteDate] = useState('');
  const [buyersOrderNo, setBuyersOrderNo] = useState('');
  const [buyersOrderDate, setBuyersOrderDate] = useState('');
  const [dispatchDocNo, setDispatchDocNo] = useState('');
  const [termsOfDelivery, setTermsOfDelivery] = useState('');

  // Tax Invoice Details — same fields as the main Billing page's MM/A4 mode,
  // always shown here since MM bills always need them.
  const [vehicleNo, setVehicleNo] = useState('');
  const [despatchedThrough, setDespatchedThrough] = useState('');
  const [destination, setDestination] = useState('');
  const [otherReference, setOtherReference] = useState('');
  const [ewayBillNo, setEwayBillNo] = useState('');
  const [irnNo, setIrnNo] = useState('');
  // Consignee is always its own independent entry — never pre-filled or
  // copied from Buyer. A genuinely blank Consignee still falls back to the
  // Buyer at print time (mmA4invoice.ts) purely so the invoice never shows a
  // blank ship-to block, but the form itself offers no "same as Buyer"
  // shortcut — the operator types it themselves.
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

  const { data: customerPastBills } = useQuery({
    queryKey: ['mm-customer-bills', customer.id],
    queryFn: () => mmCustomersApi.getBills(customer.id!),
    enabled: !!customer.id && !savedBill,
  });

  const lastBill = customerPastBills && customerPastBills.length > 0 ? customerPastBills[0] : null;

  const handleReorderLastBill = () => {
    if (!lastBill || !lastBill.items || lastBill.items.length === 0) return;
    const newItems: BillItemForm[] = lastBill.items.map((it) => ({
      _id: newId(),
      mmProductId: it.mmProductId ?? undefined,
      productName: it.productName,
      unit: it.unit || 'Kgs',
      qty: it.qty,
      unitPrice: paisaToRupee(it.unitPrice),
      gstRate: it.gstRate,
      hsnSac: it.hsnSac || undefined,
    }));
    setItems(newItems);
    toast({
      title: 'Previous order loaded!',
      description: `Loaded ${newItems.length} items from Bill #${lastBill.billNumber}.`,
      variant: 'success',
    });
  };
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
  const { subTotalP, gstTotalP } = computeLineTotals(countedItems, gstInclusive);
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
        gstInclusive,
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
        consigneeName,
        consigneeAddress,
        consigneeGstin,
        buyerName: buyerManualEntry ? buyerName : undefined,
        buyerAddress: buyerManualEntry ? buyerAddress : undefined,
        buyerGstin: buyerManualEntry ? buyerGstin : undefined,
        billDate,
        deliveryNote,
        termsOfPayment,
        buyersOrderNo,
        buyersOrderDate,
        dispatchDocNo,
        deliveryNoteDate,
        termsOfDelivery,
      }),
    [
      nextNumber, items, gstInclusive, isInterState, customer, roundOffP, vehicleNo, despatchedThrough, destination,
      otherReference, ewayBillNo, irnNo, consigneeName, consigneeAddress, consigneeGstin,
      buyerManualEntry, buyerName, buyerAddress, buyerGstin,
      billDate, deliveryNote, termsOfPayment, buyersOrderNo, buyersOrderDate, dispatchDocNo, deliveryNoteDate, termsOfDelivery,
    ],
  );

  /**
   * The ONE WhatsApp send path for this page — used by both the "Send Bill on
   * WhatsApp" button and the "Send on WhatsApp after saving" checkbox. MM's
   * twin of BillingPage.shareBillOnWhatsApp; keep the two in step.
   *
   * Takes the bill as an argument rather than reading `savedBill`: the
   * checkbox path runs inside this mutation's own onSuccess, whose closure
   * still sees the pre-save value (null).
   *
   * The bill goes as a MESSAGE, not the Tax Invoice PDF — see the same note on
   * BillingPage and lib/whatsappBillText.ts. The printed/downloadable Tax
   * Invoice is untouched and remains the real document for a wholesale buyer.
   */
  const shareBillOnWhatsApp = async (bill: Bill, phone: string, openDialogOnError = false) => {
    const text = buildWhatsAppBillText(bill, settings ?? {}, { heading: 'MM' });

    if (isWhatsAppTextSendAvailable()) {
      setSendingWhatsApp(true);
      try {
        await sendBillTextOnWhatsApp({ phone, text, billNumber: bill.billNumber });
        toast({
          title: 'Sent on WhatsApp!',
          description: `Bill ${bill.billNumber} delivered to ${phone}.`,
          variant: 'success',
        });
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Could not send automatically';
        toast({
          title: 'WhatsApp sending issue',
          description: msg,
          variant: 'destructive',
        });
        if (openDialogOnError) {
          setWhatsappModalBill(bill);
        }
        return;
      } finally {
        setSendingWhatsApp(false);
      }
    }

    // If text automation is not available (browser / LAN mode), open the share modal
    setWhatsappModalBill(bill);
  };

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
          await shareBillOnWhatsApp(bill, customer.phone.trim());
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
      billDate: billDate ? (billDate.includes('T') ? billDate : `${billDate}T12:00:00.000Z`) : new Date().toISOString(),
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
      notes: notes.trim() || undefined,
      gstInclusive,
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
      deliveryNote: deliveryNote.trim() || undefined,
      termsOfPayment: termsOfPayment.trim() || undefined,
      buyersOrderNo: buyersOrderNo.trim() || undefined,
      buyersOrderDate: buyersOrderDate.trim() || undefined,
      dispatchDocNo: dispatchDocNo.trim() || undefined,
      deliveryNoteDate: deliveryNoteDate.trim() || undefined,
      termsOfDelivery: termsOfDelivery.trim() || undefined,
      series: 'MM',
    });
  };

  const handlePrint = async () => {
    if (!savedBill) return;
    const { printMmA4InvoicePDF } = await loadMmA4Lib();
    const prevDue = Number(previousDueRupees) > 0 ? rupeeToPaisa(Number(previousDueRupees)) : undefined;
    await printMmA4InvoicePDF(savedBill, settings ?? {}, {
      copyType,
      previousDueP: prevDue,
    });
  };

  const handleDownloadPdf = async () => {
    if (!savedBill) return;
    const { downloadMmA4InvoicePDF } = await loadMmA4Lib();
    const prevDue = Number(previousDueRupees) > 0 ? rupeeToPaisa(Number(previousDueRupees)) : undefined;
    await downloadMmA4InvoicePDF(savedBill, settings ?? {}, {
      copyType,
      previousDueP: prevDue,
    });
  };

  /** "Send Bill on WhatsApp" sends directly in background if phone is valid, or opens dialog if missing */
  const handleWhatsAppShare = () => {
    if (!savedBill) return;
    const phone = (savedBill.mmCustomer?.phone || customer.phone || '').trim();
    if (isWhatsAppTextSendAvailable() && phone && isValidIndianPhone(phone)) {
      void shareBillOnWhatsApp(savedBill, phone, false);
    } else {
      setWhatsappModalBill(savedBill);
    }
  };

  const handleReset = () => {
    setCustomer({ name: '', phone: '', gstin: '', address: '' });
    setItems([newEmptyItem(defaultGstRate)]);
    setSavedBill(null);
    setSendOnWhatsApp(false);
    setPaymentMode('');
    setGstInclusive(false);
    setNotes('');
    setPreviousDueRupees('');
    setCopyType('ORIGINAL');
    setVehicleNo('');
    setDespatchedThrough('');
    setDestination('');
    setOtherReference('');
    setEwayBillNo('');
    setIrnNo('');
    setConsigneeName('');
    setConsigneeAddress('');
    setConsigneeGstin('');
    setBuyerManualEntry(false);
    setBuyerName('');
    setBuyerAddress('');
    setBuyerGstin('');
    setBillDate(new Date().toISOString().slice(0, 10));
    setTermsOfPayment('');
    setDeliveryNote('');
    setDeliveryNoteDate('');
    setBuyersOrderNo('');
    setBuyersOrderDate('');
    setDispatchDocNo('');
    setTermsOfDelivery('');
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
            <CustomerBar value={customer} onChange={setCustomer} disabled={!!savedBill} showAddress isMm />
          </div>
          <div className="col-span-3">
            <Label className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1">
              <CalendarDays className="w-3.5 h-3.5 text-brand-600" /> Invoice Date
            </Label>
            <Input
              type="date"
              value={billDate}
              disabled={!!savedBill}
              onChange={(e) => setBillDate(e.target.value)}
              className="h-10 bg-white font-medium text-slate-800"
            />
          </div>
          <div className="col-span-3">
            <Label className="text-xs text-muted-foreground mb-1.5 block">Payment Mode</Label>
            <PaymentModeSelect value={paymentMode} onChange={setPaymentMode} disabled={!!savedBill} />
          </div>
        </CardContent>
      </Card>

      {/* ── Repeat / Reorder Last Order Shortcut ────────────── */}
      {!savedBill && lastBill && (
        <div className="flex items-center justify-between px-3.5 py-2.5 rounded-lg border border-amber-300 bg-amber-50/90 text-amber-950 text-xs shadow-xs animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-full bg-amber-200/80 flex items-center justify-center shrink-0">
              <Zap className="w-3.5 h-3.5 text-amber-700 fill-amber-500" />
            </div>
            <div>
              <span className="font-semibold text-amber-900">Repeat Last Order:</span>{' '}
              <span>
                Bill <strong>{lastBill.billNumber}</strong> ({new Date(lastBill.billDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}) —{' '}
                <strong className="tabular-nums text-amber-900">{formatCurrency(lastBill.grandTotal)}</strong> ({lastBill.items?.length ?? 0} items)
              </span>
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleReorderLastBill}
            className="h-7 text-xs bg-white hover:bg-amber-100 border-amber-300 text-amber-900 font-semibold shadow-xs hover:border-amber-400"
          >
            <RotateCcw className="w-3 h-3 mr-1.5 text-amber-700" />
            Load Last Order Items
          </Button>
        </div>
      )}

      {/* ── Tax Invoice Order & Dispatch Details — matching Tally GST format ─────────────── */}
      <Card className="border-slate-200 shadow-xs">
        <CardContent className="pt-3.5 pb-3.5 space-y-3.5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-700 uppercase tracking-wide flex items-center gap-1.5">
              <FileSpreadsheet className="w-3.5 h-3.5 text-brand-600" />
              Tax Invoice Order &amp; Dispatch Details
            </p>
            <span className="text-[11px] text-muted-foreground">
              Official Tally 7-row layout (leave blank to omit)
            </span>
          </div>

          {/* Section 1: Buyer's Order & Terms of Payment */}
          <div className="rounded-md border border-slate-200/80 bg-slate-50/60 p-3 space-y-2.5">
            <p className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
              1. Buyer's Order &amp; Terms of Payment
            </p>
            <div className="grid grid-cols-12 gap-3">
              <div className="col-span-3">
                <Label className="text-xs text-muted-foreground mb-1 block">Buyer's Order No.</Label>
                <Input
                  value={buyersOrderNo}
                  disabled={!!savedBill}
                  placeholder="e.g. PO-8924"
                  onChange={(e) => setBuyersOrderNo(e.target.value)}
                />
              </div>
              <div className="col-span-3">
                <Label className="text-xs text-muted-foreground mb-1 block">Buyer's Order Date</Label>
                <Input
                  type="date"
                  value={buyersOrderDate}
                  disabled={!!savedBill}
                  onChange={(e) => setBuyersOrderDate(e.target.value)}
                  className="bg-white"
                />
              </div>
              <div className="col-span-6">
                <div className="flex items-center justify-between mb-1">
                  <Label className="text-xs text-muted-foreground block">Terms of Payment / Credit</Label>
                  {!savedBill && (
                    <div className="flex gap-1 text-[10px]">
                      {[
                        { label: 'Immediate', val: 'Immediate' },
                        { label: '15 Days', val: '15 Days Credit' },
                        { label: '30 Days', val: '30 Days Credit' },
                        { label: 'COD', val: 'Cash on Delivery' },
                      ].map((chip) => (
                        <button
                          key={chip.label}
                          type="button"
                          onClick={() => setTermsOfPayment(chip.val)}
                          className="px-1.5 py-0.5 rounded bg-slate-200 hover:bg-slate-300 text-slate-700 font-medium transition-colors"
                        >
                          {chip.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <Input
                  value={termsOfPayment}
                  disabled={!!savedBill}
                  placeholder="e.g. 30 Days Credit / Immediate"
                  onChange={(e) => setTermsOfPayment(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Section 2: Delivery Note & Dispatch Documents */}
          <div className="rounded-md border border-slate-200/80 bg-slate-50/60 p-3 space-y-2.5">
            <p className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
              2. Delivery Note &amp; Dispatch Documents
            </p>
            <div className="grid grid-cols-12 gap-3">
              <div className="col-span-3">
                <Label className="text-xs text-muted-foreground mb-1 block">Delivery Note</Label>
                <Input
                  value={deliveryNote}
                  disabled={!!savedBill}
                  placeholder="e.g. DN-01"
                  onChange={(e) => setDeliveryNote(e.target.value)}
                />
              </div>
              <div className="col-span-3">
                <Label className="text-xs text-muted-foreground mb-1 block">Delivery Note Date</Label>
                <Input
                  type="date"
                  value={deliveryNoteDate}
                  disabled={!!savedBill}
                  onChange={(e) => setDeliveryNoteDate(e.target.value)}
                  className="bg-white"
                />
              </div>
              <div className="col-span-3">
                <Label className="text-xs text-muted-foreground mb-1 block">Dispatch Doc No.</Label>
                <Input
                  value={dispatchDocNo}
                  disabled={!!savedBill}
                  placeholder="e.g. LR / RR No."
                  onChange={(e) => setDispatchDocNo(e.target.value)}
                />
              </div>
              <div className="col-span-3">
                <Label className="text-xs text-muted-foreground mb-1 block">E-Way Bill No</Label>
                <Input
                  value={ewayBillNo}
                  disabled={!!savedBill}
                  placeholder="12-digit E-Way Bill"
                  onChange={(e) => setEwayBillNo(e.target.value)}
                />
              </div>

              <div className="col-span-4">
                <Label className="text-xs text-muted-foreground mb-1 block">Dispatched Through</Label>
                <Input
                  value={despatchedThrough}
                  disabled={!!savedBill}
                  placeholder="e.g. VRL Logistics / By Hand"
                  onChange={(e) => setDespatchedThrough(e.target.value)}
                />
              </div>
              <div className="col-span-4">
                <Label className="text-xs text-muted-foreground mb-1 block">Vehicle No</Label>
                <Input
                  value={vehicleNo}
                  disabled={!!savedBill}
                  placeholder="e.g. TN-01-AB-1234"
                  onChange={(e) => setVehicleNo(e.target.value)}
                />
              </div>
              <div className="col-span-4">
                <Label className="text-xs text-muted-foreground mb-1 block">Destination</Label>
                <Input
                  value={destination}
                  disabled={!!savedBill}
                  placeholder="e.g. Madurai / Chennai"
                  onChange={(e) => setDestination(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Section 3: References & Delivery Terms */}
          <div className="rounded-md border border-slate-200/80 bg-slate-50/60 p-3 space-y-2.5">
            <p className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
              3. References &amp; Terms of Delivery
            </p>
            <div className="grid grid-cols-12 gap-3">
              <div className="col-span-6">
                <Label className="text-xs text-muted-foreground mb-1 block">Terms of Delivery</Label>
                <Input
                  value={termsOfDelivery}
                  disabled={!!savedBill}
                  placeholder="e.g. Delivery at Buyer's Godown / Freight Paid"
                  onChange={(e) => setTermsOfDelivery(e.target.value)}
                />
              </div>
              <div className="col-span-3">
                <Label className="text-xs text-muted-foreground mb-1 block">Other Reference &amp; Date</Label>
                <Input
                  value={otherReference}
                  disabled={!!savedBill}
                  placeholder="e.g. Ref / Quotation No."
                  onChange={(e) => setOtherReference(e.target.value)}
                />
              </div>
              <div className="col-span-3">
                <Label className="text-xs text-muted-foreground mb-1 block">IRN No (Govt E-Invoice)</Label>
                <Input
                  value={irnNo}
                  disabled={!!savedBill}
                  placeholder="Paste IRN hash if applicable"
                  onChange={(e) => setIrnNo(e.target.value)}
                />
              </div>
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
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
              Consignee (ship-to) — entered separately, not copied from Buyer
            </p>
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
                  <GstModeToggle value={gstInclusive} onChange={setGstInclusive} />
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
                        gstInclusive={gstInclusive}
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

              {/* Previous Due / Balance (Optional ledger balance for A4 Tax Invoice) */}
              <div className="pt-2 border-t border-slate-100 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs text-muted-foreground flex items-center gap-1">
                    Previous Due (₹)
                    <span className="text-[10px] text-slate-400 font-normal">(Optional)</span>
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    placeholder="0"
                    value={previousDueRupees}
                    onChange={(e) => setPreviousDueRupees(e.target.value)}
                    className="w-24 h-7 text-right text-xs tabular-nums"
                  />
                </div>
                {Number(previousDueRupees) > 0 && (
                  <div className="flex justify-between text-xs text-brand-800 bg-brand-50 px-2 py-1 rounded font-medium border border-brand-100">
                    <span>Total Net Payable:</span>
                    <span className="tabular-nums font-bold">
                      {formatCurrency(grandTotalP + rupeeToPaisa(Number(previousDueRupees) || 0))}
                    </span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Invoice Copy Option */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 space-y-1.5">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
              <span className="flex items-center gap-1">
                <Copy className="w-3.5 h-3.5 text-brand-600" /> Invoice Copy
              </span>
              <span className="text-[10px] text-muted-foreground font-normal">
                {copyType === 'ALL' ? 'All 3 Copies (Batch)' : copyType}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-1 text-[11px]">
              {(
                [
                  { id: 'ORIGINAL', label: 'Original', sub: 'Buyer' },
                  { id: 'DUPLICATE', label: 'Duplicate', sub: 'Transp.' },
                  { id: 'TRIPLICATE', label: 'Triplicate', sub: 'Seller' },
                  { id: 'ALL', label: 'All 3', sub: 'Batch' },
                ] as const
              ).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCopyType(c.id)}
                  className={`px-1 py-1 rounded text-center border transition-all ${
                    copyType === c.id
                      ? 'bg-brand-600 text-white border-brand-600 font-medium shadow-xs'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <div className="font-semibold text-[11px] leading-tight">{c.label}</div>
                  <div className={`text-[9px] leading-tight truncate ${copyType === c.id ? 'text-brand-100' : 'text-slate-400'}`}>
                    {c.sub}
                  </div>
                </button>
              ))}
            </div>
          </div>

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

          {/* Internal record only — never printed on the Tax Invoice (same
              rule as Payment Mode). */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Notes / Remarks</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                value={notes}
                disabled={!!savedBill}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Internal notes about this bill — not printed on the invoice"
                className="min-h-[100px]"
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>

    {previewOpen && (
      <PdfPreviewModal
        bill={savedBill ?? draftBill}
        settings={settings ?? {}}
        layout="mm_a4"
        readOnly={!savedBill}
        copyType={copyType}
        previousDueP={Number(previousDueRupees) > 0 ? rupeeToPaisa(Number(previousDueRupees)) : undefined}
        onClose={() => setPreviewOpen(false)}
      />
    )}

    <WhatsAppShareDialog
      open={!!whatsappModalBill}
      onOpenChange={(open) => {
        if (!open) setWhatsappModalBill(null);
      }}
      bill={whatsappModalBill}
      settings={settings ?? {}}
      isMm
    />
    </>
  );
}
