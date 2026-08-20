import { useState, useEffect, useMemo } from 'react';
import { Plus, Printer, FileText, ScanEye, Save, RotateCcw, CalendarDays, X } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CustomerBar, type CustomerInfo } from '@/components/billing/CustomerBar';
import { LineItemRow } from '@/components/billing/LineItemRow';
import { LayoutToggle, type BillLayout } from '@/components/billing/LayoutToggle';
import { PdfPreviewModal } from '@/components/billing/PdfPreviewModal';
import { GstModeToggle } from '@/components/billing/GstModeToggle';
import { ServiceDescriptionInput } from '@/components/billing/ServiceDescriptionInput';
import { PaymentModeSelect } from '@/components/billing/PaymentModeSelect';
import { BilledBySelect } from '@/components/billing/BilledBySelect';
import { staffApi } from '@/api/staff';
import { billsApi } from '@/api/bills';
import { settingsApi } from '@/api/settings';
import { customersApi } from '@/api/customers';
import { printerApi } from '@/api/printer';
// pdf-lib is heavy (~400KB) — loaded on demand so the app starts fast.
const loadPdfLib = () => import('@/lib/pdf');
const loadA4Lib = () => import('@/lib/a4invoice');
import { whatsappApi } from '@/api/whatsapp';
import { useToast } from '@/hooks/use-toast';
import { isValidIndianPhone, newId } from '@/lib/utils';
import { computeLineTotals, splitTaxP } from '@/lib/billMath';
import { suggestInterState } from '@/lib/gstin';
import { buildDraftBill } from '@/lib/draftBill';
import type { BillItemForm, Bill, Settings, PaymentMode } from '@/types';
import { rupeeToPaisa, paisaToRupee, formatCurrency, shouldShowWhatsappOnBilling } from '@/types';

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

function buildWhatsAppCaption(billNumber: string, grandTotal: number, customerName?: string): string {
  return `Dear ${customerName?.trim() || 'Customer'},

Thank you for choosing The Maestro Studio's!

Bill No: ${billNumber}
Total Amount: ${formatCurrency(grandTotal)}`;
}

async function sendBillViaWhatsApp(
  bill: Bill,
  phone: string,
  settings: Partial<Settings>,
  layout: BillLayout,
): Promise<void> {
  const pdfBase64 =
    layout === 'a4'
      ? await (await loadA4Lib()).generateA4InvoicePDFBase64(bill, settings)
      : await (await loadPdfLib()).generateBillPDFBase64(bill, settings);
  await whatsappApi.sendPdf({
    phone,
    pdfBase64,
    fileName: `${bill.billNumber}.pdf`,
    caption: buildWhatsAppCaption(bill.billNumber, bill.grandTotal, bill.customer?.name),
  });
}

/**
 * Map backend WhatsApp errors to user-friendly messages. The backend throws
 * distinct error messages for each common failure mode; this keeps the
 * BillingPage toast short and the action obvious.
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

const newEmptyItem = (): BillItemForm => ({
  _id: newId(),
  productName: '',
  unit: 'Piece',
  qty: 1,
  unitPrice: 0,
  gstRate: 18,
});

// Remembers the operator's last-used print layout across bills and app
// restarts (localStorage, this machine only) — a studio that bills mostly on
// A4 shouldn't have to re-click the toggle on every single new bill, since it
// otherwise always starts back on 'thermal'. Falls back silently (private
// browsing, storage disabled) since this is a convenience, not billing data.
const LAYOUT_STORAGE_KEY = 'maestro-billing:layout-preference';
function loadPreferredLayout(): BillLayout {
  try {
    const stored = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (stored === 'thermal' || stored === 'a4') return stored;
  } catch {
    // localStorage unavailable — just use the default below
  }
  return 'thermal';
}

export default function BillingPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [sendingWhatsApp, setSendingWhatsApp] = useState(false);

  const [customer, setCustomer] = useState<CustomerInfo>({ name: '', phone: '' });
  // Opt-in: many customers don't have WhatsApp, so auto-send only when ticked.
  // The manual "Send Bill on WhatsApp" button after save remains as a fallback.
  const [sendOnWhatsApp, setSendOnWhatsApp] = useState(false);
  const [items, setItems] = useState<BillItemForm[]>([newEmptyItem()]);
  const [savedBill, setSavedBill] = useState<Bill | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  // Which printed layout Print/PDF/WhatsApp use — thermal receipt or the A4
  // "Service Bill". Initialized from (and kept in sync with) the operator's
  // last choice — see loadPreferredLayout above.
  const [layout, setLayout] = useState<BillLayout>(loadPreferredLayout);
  // A4-only fields — optional, shown collapsed since most bills never need
  // them (per-unit retail sales rather than a dated service engagement).
  const [serviceDescription, setServiceDescription] = useState('');
  // Arbitrary list of service dates (replacing the old single from/to range)
  // — always at least one input shown, "+" appends another.
  const [serviceDates, setServiceDates] = useState<string[]>(['']);
  // Whole-bill GST pricing mode — see components/billing/GstModeToggle.
  const [gstInclusive, setGstInclusive] = useState(false);
  // Inter-state supply (IGST) vs intra-state (CGST+SGST) — mutually
  // exclusive, see schema.prisma Bill.isInterState. Auto-suggested below
  // from GSTIN state codes when the customer changes, but always overridable.
  const [isInterState, setIsInterState] = useState(false);
  // How the bill was paid — shown in the form and history/detail views only,
  // never on the printed receipt/invoice. See components/billing/PaymentModeSelect.
  const [paymentMode, setPaymentMode] = useState<PaymentMode | ''>('');
  // Which staff member billed this sale — required to save (see handleSave).
  // Deliberately NOT cleared in handleReset (below), same as `layout` above:
  // remembered across bills for the rest of this browser session so the
  // operator isn't re-picking themselves after every single save. Resets to
  // blank on an actual page reload, since it's plain component state, not
  // persisted to localStorage like the layout preference is.
  const [billedById, setBilledById] = useState<number | ''>('');

  const { data: nextNumber } = useQuery({
    queryKey: ['bills', 'next-number'],
    queryFn: () => billsApi.getNextNumber(),
    enabled: !savedBill,
    staleTime: 0,
  });

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  });
  const { data: staff } = useQuery({
    queryKey: ['staff'],
    queryFn: () => staffApi.list(),
  });
  // Settings → WhatsApp Integration → "Show WhatsApp option on the New Bill
  // screen". Missing (older installs) or anything but the literal string
  // 'false' means show — must default to today's behaviour on upgrade.
  const showWhatsapp = shouldShowWhatsappOnBilling(settings?.general);

  // Re-suggest Inter-state whenever the selected customer's GSTIN changes —
  // still just a default, the checkbox below stays freely overridable.
  useEffect(() => {
    if (savedBill) return;
    const suggestion = suggestInterState(settings?.studio?.studio_gstin, customer.gstin);
    if (suggestion !== null) setIsInterState(suggestion);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer.gstin, settings?.studio?.studio_gstin]);

  // Thermal printer availability — polled so plugging the printer in (or
  // turning it on) is reflected without a page reload.
  const { data: printerStatus } = useQuery({
    queryKey: ['printer', 'status'],
    queryFn: printerApi.getStatus,
    refetchInterval: 15_000,
  });

  // Live totals — integer paise, computed over exactly the rows that will be
  // saved and with the backend's per-item rounding (see lib/billMath), so the
  // displayed figures always match the stored bill.
  const countedItems = items.filter((i) => i.productName.trim() && i.qty > 0);
  const { subTotalP, gstTotalP } = computeLineTotals(countedItems, gstInclusive);
  // Effective half-rate for label — null when items have mixed GST rates
  const _activeRates = [...new Set(countedItems.filter(i => i.gstRate > 0).map(i => i.gstRate))];
  const gstHalfRate  = _activeRates.length === 1 ? _activeRates[0] / 2 : null;
  const gstFullRate  = _activeRates.length === 1 ? _activeRates[0] : null;
  const rawTotalP   = subTotalP + gstTotalP;
  const roundOffP   = Math.round(rawTotalP / 100) * 100 - rawTotalP;
  const grandTotalP = rawTotalP + roundOffP;

  // Bill-shaped view of the current form state, purely for the pre-save
  // Preview button — see lib/draftBill. Memoized (not rebuilt every render)
  // so PdfPreviewModal's per-layout PDF cache actually survives re-renders
  // that don't touch anything this would print.
  const draftBill = useMemo(
    () =>
      buildDraftBill({
        billNumber: nextNumber ?? 'DRAFT',
        items,
        gstInclusive,
        isInterState,
        customer,
        roundOffP,
        serviceDescription,
        serviceDates: serviceDates.filter(Boolean),
        billedByName: staff?.find((s) => s.id === billedById)?.name,
      }),
    [nextNumber, items, gstInclusive, isInterState, customer, roundOffP, serviceDescription, serviceDates, billedById, staff],
  );

  const createBillMutation = useMutation({
    mutationFn: billsApi.create,
    onSuccess: async (bill) => {
      setSavedBill(bill);
      qc.invalidateQueries({ queryKey: ['bills'] });
      toast({ title: 'Bill saved!', description: `${bill.billNumber} created.`, variant: 'success' });

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
            await sendBillViaWhatsApp(bill, customer.phone.trim(), settings ?? {}, layout);
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
      toast({ title: 'Error saving bill', description: err.message, variant: 'destructive' });
    },
  });

  const handleSave = async () => {
    const validItems = countedItems;
    if (validItems.length === 0) {
      toast({ title: 'No items', description: 'Add at least one item to the bill.', variant: 'destructive' });
      return;
    }

    if (billedById === '') {
      toast({ title: 'Select who billed this', description: 'Choose a "Billed By" staff member before saving.', variant: 'destructive' });
      return;
    }

    // A negative price can't come from the product list (prices there are
    // validated nonnegative) — this only catches a stray manual edge case.
    // 0 is allowed: that's how a complimentary/free line item gets billed.
    const unpriced = validItems.find((i) => i.unitPrice < 0);
    if (unpriced) {
      toast({
        title: 'Item has an invalid price',
        description: `"${unpriced.productName}" has a negative price — fix it before saving.`,
        variant: 'destructive',
      });
      return;
    }

    // Reject negative-total bills client-side (matches the server's rule) —
    // a total of exactly 0 is a legitimate complimentary bill.
    if (grandTotalP < 0) {
      toast({
        title: 'Negative total not allowed',
        description: 'The discount exceeds the bill amount.',
        variant: 'destructive',
      });
      return;
    }

    // Resolve customer ID
    let customerId: number | undefined = customer.id;

    // Auto-create a quick customer record only when both name AND phone are typed.
    // A name without a phone is left as a walk-in bill (customerId undefined) so we
    // don't pollute the customer list with `0000000000` placeholders.
    if (!customerId && customer.name.trim() && customer.phone.trim()) {
      try {
        const created = await customersApi.create({
          name: customer.name.trim(),
          phone: customer.phone.trim(),
          gstin: customer.gstin?.trim() || undefined,
          address: customer.address?.trim() || undefined,
        });
        customerId = created.id;
        qc.invalidateQueries({ queryKey: ['customers'] });
      } catch {
        // non-critical — continue without customer
      }
    }

    const filledServiceDates = serviceDates.filter(Boolean);
    createBillMutation.mutate({
      customerId,
      // Bill date is fixed to the moment of saving — no backdating from the UI.
      billDate: new Date().toISOString(),
      items: validItems.map((i) => ({
        productId: i.productId,
        productName: i.productName,
        hsnSac: i.hsnSac,
        unit: i.unit,
        qty: i.qty,
        unitPrice: rupeeToPaisa(i.unitPrice),
        gstRate: i.gstRate,
      })),
      roundOffAmount: roundOffP,
      paymentMode: paymentMode || undefined,
      // Not gated on `layout` — that toggle only controls which fields are
      // shown/editable in the form. Submitting must reflect whatever's
      // actually in state, or switching back to Thermal right before Save
      // would silently wipe out Service Details the operator already typed.
      serviceDescription: serviceDescription.trim() || undefined,
      serviceDates: filledServiceDates.length ? filledServiceDates : undefined,
      gstInclusive,
      isInterState,
      // billedById is already guaranteed a number here — the empty-string
      // ('') case returned early above.
      billedById,
      billedByName: staff?.find((s) => s.id === billedById)?.name,
    });
  };

  // Ctrl+S saves the bill (browsers otherwise hijack it for "Save page")
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (!savedBill && !createBillMutation.isPending) handleSave();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedBill, items, customer, createBillMutation.isPending, layout, gstInclusive, paymentMode, serviceDescription, serviceDates, billedById]);

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
      await sendBillViaWhatsApp(savedBill, customer.phone.trim(), settings ?? {}, layout);
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

  const handlePrint = async () => {
    if (!savedBill) return;
    if (layout === 'a4') {
      const { printA4InvoicePDF } = await loadA4Lib();
      await printA4InvoicePDF(savedBill, settings ?? {});
      return;
    }
    try {
      const { printThermalReceipt } = await import('@/lib/printThermal');
      await printThermalReceipt(savedBill, settings ?? {});
    } catch (err) {
      toast({
        title: 'Could not print the receipt',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    }
  };

  const handleDownloadPdf = async () => {
    if (!savedBill) return;
    if (layout === 'a4') {
      const { downloadA4InvoicePDF } = await loadA4Lib();
      await downloadA4InvoicePDF(savedBill, settings ?? {});
    } else {
      const { downloadBillPDF } = await loadPdfLib();
      await downloadBillPDF(savedBill, settings ?? {});
    }
  };

  // Ctrl+Enter (or Cmd+Enter on Mac) to save the bill. Only active on the
  // new-bill form (i.e. when no bill is currently saved).
  useEffect(() => {
    if (savedBill) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        // Don't trigger if focus is inside a button (e.g. the user is using
        // Ctrl+Enter as a click shortcut on the Save button itself).
        const target = e.target as HTMLElement | null;
        if (target && target.tagName === 'BUTTON') return;
        e.preventDefault();
        if (!createBillMutation.isPending) handleSave();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [savedBill, items, customer, createBillMutation.isPending, layout, gstInclusive, paymentMode, serviceDescription, serviceDates, billedById]);

  // Persist every layout change so the next bill (this session or after a
  // restart) starts on whatever the operator last used.
  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_STORAGE_KEY, layout);
    } catch {
      // localStorage unavailable — the toggle still works, it just won't be remembered
    }
  }, [layout]);

  const handleReset = () => {
    setCustomer({ name: '', phone: '', gstin: '', address: '' });
    setItems([newEmptyItem()]);
    setSendOnWhatsApp(false);
    setSavedBill(null);
    // Layout is deliberately left as-is (not reset to 'thermal') — a studio
    // billing a run of A4 invoices back-to-back shouldn't have to re-toggle
    // it after every single save. See loadPreferredLayout above.
    setServiceDescription('');
    setServiceDates(['']);
    setGstInclusive(false);
    setPaymentMode('');
    // billedById is deliberately left as-is too — see its declaration above.
    qc.invalidateQueries({ queryKey: ['bills', 'next-number'] });
    qc.refetchQueries({ queryKey: ['bills', 'next-number'] });
  };

  return (
    <>
    <div className="space-y-4 max-w-6xl">

      {/* ── Top action bar ──────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Bill No</span>
            <span className="text-lg font-bold text-brand-700 tabular-nums">
              {savedBill?.billNumber ?? nextNumber ?? '—'}
            </span>
            {savedBill && (
              <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium animate-in zoom-in-50 duration-300">
                Saved
              </span>
            )}
            {printerStatus && (
              <span
                className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full font-medium ${
                  printerStatus.available && !printerStatus.offline
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : printerStatus.available
                      ? 'bg-amber-50 text-amber-700 border border-amber-200'
                      : 'bg-slate-100 text-slate-500 border border-slate-200'
                }`}
                title={
                  printerStatus.available
                    ? `Windows printer: ${printerStatus.matchedName}`
                    : `"${printerStatus.printerName}" not found in Windows printers`
                }
              >
                <Printer className="w-3 h-3" />
                {printerStatus.available && !printerStatus.offline
                  ? 'Printer ready'
                  : printerStatus.available
                    ? 'Printer offline'
                    : 'No printer'}
              </span>
            )}
          </div>
        </div>

        <div className="flex gap-2 items-center">
          <LayoutToggle value={layout} onChange={setLayout} />
          <Button variant="outline" size="sm" onClick={handleReset}>
            <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
            New Bill
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
                {createBillMutation.isPending ? 'Saving…' : 'Save Bill'}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* ── Customer + Date bar ─────────────────────────────── */}
      <Card className="border-brand-500/30 bg-brand-50/60">
        <CardContent className="pt-4 pb-4 grid grid-cols-12 gap-4 items-end">
          <div className="col-span-5">
            <Label className="text-xs text-muted-foreground mb-1.5 block">Customer</Label>
            <CustomerBar value={customer} onChange={setCustomer} disabled={!!savedBill} showAddress={layout === 'a4'} />
          </div>
          <div className="col-span-2">
            <Label className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1">
              <CalendarDays className="w-3.5 h-3.5" /> Date
            </Label>
            <p className="h-10 flex items-center px-3 rounded-lg border border-slate-200 bg-slate-50 text-sm font-medium text-slate-700">
              {new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
            </p>
          </div>
          <div className="col-span-2">
            <Label className="text-xs text-muted-foreground mb-1.5 block">Payment Mode</Label>
            <PaymentModeSelect value={paymentMode} onChange={setPaymentMode} disabled={!!savedBill} />
          </div>
          <div className="col-span-3">
            <Label className="text-xs text-muted-foreground mb-1.5 block">Billed By *</Label>
            <BilledBySelect value={billedById} onChange={setBilledById} disabled={!!savedBill} />
          </div>
        </CardContent>
      </Card>

      {/* ── Service Details — shown only in A4 mode, since this info only
             appears on the A4 invoice layout ────────────────────────────── */}
      {layout === 'a4' && (
      <Card className="border-slate-200 animate-in fade-in slide-in-from-top-1 duration-200">
        <CardContent className="pt-3 pb-3">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
            Service Details <span className="normal-case font-normal text-muted-foreground">(optional — A4 invoice only)</span>
          </p>
            <div className="grid grid-cols-12 gap-3">
              <div className="col-span-6">
                <Label className="text-xs text-muted-foreground mb-1.5 block">Service Description</Label>
                <ServiceDescriptionInput
                  value={serviceDescription}
                  disabled={!!savedBill}
                  onChange={setServiceDescription}
                />
              </div>
              <div className="col-span-6">
                <Label className="text-xs text-muted-foreground mb-1.5 block">Service Date(s)</Label>
                <div className="flex flex-wrap items-center gap-2">
                  {serviceDates.map((date, idx) => (
                    <div key={idx} className="flex items-center gap-1">
                      <Input
                        type="date"
                        className="w-auto"
                        value={date}
                        disabled={!!savedBill}
                        onChange={(e) =>
                          setServiceDates((prev) => prev.map((d, i) => (i === idx ? e.target.value : d)))
                        }
                      />
                      {serviceDates.length > 1 && !savedBill && (
                        <button
                          type="button"
                          title="Remove date"
                          onClick={() => setServiceDates((prev) => prev.filter((_, i) => i !== idx))}
                          className="text-slate-400 hover:text-red-600 p-1"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                  {!savedBill && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9"
                      onClick={() => setServiceDates((prev) => [...prev, ''])}
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
        </CardContent>
      </Card>
      )}

      {/* ── Items table + Summary ────────────────────────────────── */}
      <div className="grid grid-cols-12 gap-4">

        {/* Items table — 8 cols */}
        <div className="col-span-8">
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-sm">Bill Items</CardTitle>
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
                    onClick={() => setItems((prev) => [...prev, newEmptyItem()])}
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
                      <th className="text-left py-2 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Product / Service</th>
                      <th className="text-right py-2 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground w-16">Qty</th>
                      <th className="text-right py-2 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground w-24">Price (₹)</th>
                      <th className="text-right py-2 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground w-16">GST %</th>
                      {layout === 'a4' && (
                        <th className="text-left py-2 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground w-24">HSN/SAC</th>
                      )}
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
                        showHsnSac={layout === 'a4'}
                        gstInclusive={gstInclusive}
                        // Matches the rest of the form, which already locks
                        // once saved. Print/PDF/WhatsApp all render from
                        // `savedBill`, so edits here changed the Summary and
                        // nothing that actually prints. Use Bill History →
                        // Edit Bill to change a saved bill.
                        disabled={!!savedBill}
                        onChange={(updated) =>
                          setItems((prev) => prev.map((i, j) => (j === idx ? updated : i)))
                        }
                        onRemove={() => setItems((prev) => prev.filter((_, j) => j !== idx))}
                        onRequestNewRow={
                          !savedBill && idx === items.length - 1
                            ? () => setItems((prev) => [...prev, newEmptyItem()])
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

          {/* Quick save button also here for convenience */}
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
              <Button
                className="w-full"
                onClick={handleSave}
                disabled={createBillMutation.isPending}
              >
                <Save className="w-4 h-4 mr-2" />
                {createBillMutation.isPending ? 'Saving…' : 'Save Bill'}
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
              <Button
                variant="outline"
                className="w-full"
                onClick={handleDownloadPdf}
              >
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
        layout={layout}
        readOnly={!savedBill}
        onClose={() => setPreviewOpen(false)}
      />
    )}
    </>
  );
}
