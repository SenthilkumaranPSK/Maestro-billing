import { X, Printer, Download, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import type { Bill, Settings } from '@/types';
import type { BillLayout } from '@/components/billing/LayoutToggle';
import { useClosingTransition } from '@/hooks/use-closing-transition';

interface PdfPreviewModalProps {
  bill: Bill;
  settings: Partial<Settings>;
  layout: BillLayout;
  onClose: () => void;
  /**
   * True when previewing unsaved form state (bill.id === 0, a draft built by
   * lib/draftBill). Hides Print/Download so the operator can't physically
   * print a thermal receipt or hand out a PDF for a bill that has no row in
   * the database yet — Preview is look-only until the bill is actually saved.
   */
  readOnly?: boolean;
  copyType?: 'ORIGINAL' | 'DUPLICATE' | 'TRIPLICATE' | 'ALL';
  previousDueP?: number;
}

/**
 * Shows the actual PDF a bill would print/download as, inline in an iframe —
 * lets the operator check the layout before committing to a physical print,
 * a file download, or a WhatsApp send. Reuses the same generate-bytes
 * functions as Print/Download, never the print/download helpers themselves,
 * which have their own side effects (an OS print dialog or a file save).
 */
export function PdfPreviewModal({
  bill,
  settings,
  layout,
  onClose,
  readOnly = false,
  copyType = 'ORIGINAL',
  previousDueP,
}: PdfPreviewModalProps) {
  const { closing, requestClose } = useClosingTransition(onClose);
  const { toast } = useToast();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedCopy, setSelectedCopy] = useState<'ORIGINAL' | 'DUPLICATE' | 'TRIPLICATE' | 'ALL'>(copyType);
  const [pageAspect, setPageAspect] = useState<number | null>(null);

  const cacheRef = useRef<Map<string, { url: string; aspect: number }>>(new Map());
  const billRef = useRef(bill);

  useEffect(() => {
    if (billRef.current !== bill) {
      cacheRef.current.forEach(({ url: cachedUrl }) => URL.revokeObjectURL(cachedUrl));
      cacheRef.current.clear();
      billRef.current = bill;
    }

    const cacheKey = `${layout}_${selectedCopy}_${previousDueP ?? 0}`;
    const cached = cacheRef.current.get(cacheKey);
    if (cached) {
      setUrl(cached.url);
      setPageAspect(cached.aspect);
      setError(null);
      return;
    }

    let cancelled = false;
    setUrl(null);
    setPageAspect(null);
    setError(null);
    (async () => {
      try {
        let bytes: Uint8Array;
        if (layout === 'mm_a4') {
          const { generateMmA4InvoicePDF } = await import('@/lib/mmA4invoice');
          bytes = await generateMmA4InvoicePDF(bill, settings, {
            copyType: selectedCopy,
            previousDueP,
          });
        } else if (layout === 'a4') {
          const { generateA4InvoicePDF } = await import('@/lib/a4invoice');
          bytes = await generateA4InvoicePDF(bill, settings);
        } else {
          const { generateBillPDF } = await import('@/lib/pdf');
          bytes = await generateBillPDF(bill, settings);
        }
        if (cancelled) return;
        const { PDFDocument } = await import('pdf-lib');
        const doc = await PDFDocument.load(bytes);
        const { width, height } = doc.getPage(0).getSize();
        const aspect = width / height;
        if (cancelled) return;
        const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], {
          type: 'application/pdf',
        });
        const objectUrl = URL.createObjectURL(blob);
        cacheRef.current.set(cacheKey, { url: objectUrl, aspect });
        setUrl(objectUrl);
        setPageAspect(aspect);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bill, layout, settings, selectedCopy, previousDueP]);

  // Revoke every cached object URL once the modal itself closes — not on
  // every layout switch, since the whole point of the cache is to survive those.
  useEffect(() => {
    return () => {
      cacheRef.current.forEach(({ url: cachedUrl }) => URL.revokeObjectURL(cachedUrl));
      cacheRef.current.clear();
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [requestClose]);

  const handlePrint = async () => {
    if (layout === 'a4') {
      const { printA4InvoicePDF } = await import('@/lib/a4invoice');
      await printA4InvoicePDF(bill, settings);
    } else if (layout === 'mm_a4') {
      const { printMmA4InvoicePDF } = await import('@/lib/mmA4invoice');
      await printMmA4InvoicePDF(bill, settings, {
        copyType: selectedCopy,
        previousDueP,
      });
    } else {
      const { printThermalReceipt } = await import('@/lib/printThermal');
      const route = await printThermalReceipt(bill, settings);
      toast({
        title: route === 'pdf' ? 'Opened PDF print dialog' : 'Printed to ESC/POS printer',
        description: route === 'raw-fallback' ? 'Used printer built-in font' : undefined,
      });
    }
  };

  const handleDownload = async () => {
    if (layout === 'a4') {
      const { downloadA4InvoicePDF } = await import('@/lib/a4invoice');
      await downloadA4InvoicePDF(bill, settings);
    } else if (layout === 'mm_a4') {
      const { downloadMmA4InvoicePDF } = await import('@/lib/mmA4invoice');
      await downloadMmA4InvoicePDF(bill, settings, {
        copyType: selectedCopy,
        previousDueP,
      });
    } else {
      const { downloadBillPDF } = await import('@/lib/pdf');
      await downloadBillPDF(bill, settings);
    }
  };

  // The thermal receipt is a narrow 58/80mm page — a full-width modal just
  // leaves it stranded in a sea of blank space, so it gets a much narrower
  // frame than the A4/MM-A4 layouts.
  const widthClass = layout === 'thermal' ? 'max-w-md' : 'max-w-5xl';

  return (
    <div
      className={`fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-[2px] flex items-center justify-center p-4 duration-150 ${closing ? 'animate-out fade-out-0' : 'animate-in fade-in-0'}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          requestClose();
        }
      }}
    >
      <div className={`bg-white rounded-xl shadow-soft-lg w-full ${widthClass} max-h-[90vh] flex flex-col duration-200 ${closing ? 'animate-out fade-out-0 zoom-out-95' : 'animate-in fade-in-0 zoom-in-95'}`}>
        <div className="flex items-center justify-between px-5 py-3 border-b shrink-0 gap-3">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-base">Preview — {bill.billNumber}</h3>
            {readOnly && (
              <span className="text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                Unsaved draft
              </span>
            )}
          </div>

          {/* 3-Copy Selector for MM Wholesale Tax Invoices */}
          {layout === 'mm_a4' && (
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg border text-xs">
              {(
                [
                  { id: 'ORIGINAL', label: 'Original' },
                  { id: 'DUPLICATE', label: 'Duplicate' },
                  { id: 'TRIPLICATE', label: 'Triplicate' },
                  { id: 'ALL', label: 'All 3 Copies' },
                ] as const
              ).map((cp) => (
                <button
                  key={cp.id}
                  type="button"
                  onClick={() => setSelectedCopy(cp.id)}
                  className={`px-2 py-1 rounded font-medium transition-all ${
                    selectedCopy === cp.id
                      ? 'bg-white text-emerald-800 shadow-2xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {cp.label}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center space-x-2">
            {!readOnly && (
              <>
                <Button variant="outline" size="sm" onClick={handleDownload}>
                  <Download className="h-4 w-4 mr-1" /> Download
                </Button>
                <Button variant="default" size="sm" onClick={handlePrint}>
                  <Printer className="h-4 w-4 mr-1" /> Print
                </Button>
              </>
            )}
            <Button variant="ghost" size="icon" onClick={requestClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {/* Sized to the actual PDF page's own aspect ratio once known, capped
            at the modal's remaining height — previously a fixed flex-1 box
            regardless of content, which left a lot of blank space below a
            short page (a few-item thermal receipt especially). Falls back to
            filling the available space while loading/erroring, before the
            aspect ratio is known. */}
        <div
          className={`bg-slate-100 rounded-b-xl overflow-hidden ${pageAspect ? 'w-full' : 'flex-1 min-h-[60vh]'}`}
          style={pageAspect ? { aspectRatio: String(pageAspect), maxHeight: 'calc(90vh - 3.5rem)' } : undefined}
        >
          {error ? (
            <div className="h-full flex items-center justify-center text-sm text-destructive p-6 text-center">
              Could not generate preview: {error}
            </div>
          ) : url ? (
            <object
              data={`${url}#toolbar=0&navpanes=0`}
              type="application/pdf"
              className="w-full h-full border-0 block"
            >
              <iframe
                src={`${url}#toolbar=0&navpanes=0`}
                title={`${bill.billNumber} preview`}
                className="w-full h-full border-0 block"
              />
            </object>
          ) : (
            <div className="h-full flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
              Generating preview…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
