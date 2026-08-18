import { X, Printer, Download } from 'lucide-react';
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
}

/**
 * Shows the actual PDF a bill would print/download as, inline in an iframe —
 * lets the operator check the layout before committing to a physical print,
 * a file download, or a WhatsApp send. Reuses the same generate-bytes
 * functions as Print/Download, never the print/download helpers themselves,
 * which have their own side effects (an OS print dialog or a file save).
 */
export function PdfPreviewModal({ bill, settings, layout, onClose }: PdfPreviewModalProps) {
  const { closing, requestClose } = useClosingTransition(onClose);
  const { toast } = useToast();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setError(null);
    (async () => {
      try {
        let bytes: Uint8Array;
        if (layout === 'mm_a4') {
          const { generateMmA4InvoicePDF } = await import('@/lib/mmA4invoice');
          bytes = await generateMmA4InvoicePDF(bill, settings);
        } else if (layout === 'a4') {
          const { generateA4InvoicePDF } = await import('@/lib/a4invoice');
          bytes = await generateA4InvoicePDF(bill, settings);
        } else {
          const { generateBillPDF } = await import('@/lib/pdf');
          bytes = await generateBillPDF(bill, settings);
        }
        if (cancelled) return;
        const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
        const objectUrl = URL.createObjectURL(blob);
        urlRef.current = objectUrl;
        setUrl(objectUrl);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, [bill, layout, settings]);

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
      await printMmA4InvoicePDF(bill, settings);
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
      await downloadMmA4InvoicePDF(bill, settings);
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
      <div className={`bg-white rounded-xl shadow-soft-lg w-full ${widthClass} h-[90vh] flex flex-col duration-200 ${closing ? 'animate-out fade-out-0 zoom-out-95' : 'animate-in fade-in-0 zoom-in-95'}`}>
        <div className="flex items-center justify-between px-5 py-3 border-b shrink-0">
          <h3 className="font-bold text-base">Preview — {bill.billNumber}</h3>
          <div className="flex items-center space-x-2">
            <Button variant="outline" size="sm" onClick={handleDownload}>
              <Download className="h-4 w-4 mr-1" /> Download
            </Button>
            <Button variant="default" size="sm" onClick={handlePrint}>
              <Printer className="h-4 w-4 mr-1" /> Print
            </Button>
            <Button variant="ghost" size="icon" onClick={requestClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="flex-1 bg-slate-100 rounded-b-xl overflow-hidden">
          {error ? (
            <div className="h-full flex items-center justify-center text-sm text-destructive p-6 text-center">
              Could not generate preview: {error}
            </div>
          ) : url ? (
            <iframe src={url} title={`${bill.billNumber} preview`} className="w-full h-full border-0" />
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Generating preview…</div>
          )}
        </div>
      </div>
    </div>
  );
}
