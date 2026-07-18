import { Printer, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { buildReceiptPreview, buildReceiptPrintHtml, normalizePaperWidth } from '@/lib/thermal';
import type { Bill, Settings } from '@/types';

interface ThermalPreviewModalProps {
  bill: Bill;
  settings: Partial<Settings>;
  onClose: () => void;
}

export function ThermalPreviewModal({ bill, settings, onClose }: ThermalPreviewModalProps) {
  const lines = buildReceiptPreview(bill, settings);
  const paperWidth = normalizePaperWidth(settings.printer?.thermal_paper_width);
  // 10px monospace is the sweet spot: large enough on screen for the eye to
  // lock onto the column grid, and 42 chars still fit 80mm of thermal paper
  // at typical driver DPI when the print popup is used.
  const fontClass = 'text-[10px]';
  const receiptWidth = paperWidth === '58' ? '32ch' : '42ch';

  const handleBrowserPrint = () => {
    const html = buildReceiptPrintHtml(bill, settings);
    const win = window.open('', '_blank', `width=${paperWidth === '58' ? 260 : 340},height=600`);
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-[2px] flex items-center justify-center p-4 animate-in fade-in-0 duration-150">
      <div className="bg-white rounded-xl shadow-soft-lg w-full max-w-md flex flex-col max-h-[90vh] animate-in fade-in-0 zoom-in-95 duration-200">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div>
            <h3 className="font-semibold">Thermal Receipt Preview</h3>
            <p className="text-xs text-muted-foreground">RP 3160 Gold — {paperWidth}mm paper</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="overflow-auto flex-1 px-5 py-4 flex justify-center">
          <div
            className={`bg-white border border-dashed border-slate-300 rounded ${fontClass}`}
            style={{
              // The box itself is exactly 42ch (or 32ch for 58mm) — this is the
              // monospace column grid. No inner padding: any padding would shrink
              // the text rows below 42ch, causing the rightmost chars to be
              // clipped by the overflow-auto parent and breaking the column grid.
              width: receiptWidth,
              padding: '12px 0',
              fontFamily: "'Courier New', Courier, monospace",
              lineHeight: 1.25,
              letterSpacing: 0,
            }}
          >
            <div className="flex justify-center mb-3">
              <img
                src="/Logo.png"
                alt="Logo"
                style={{ maxWidth: '100%', maxHeight: '48px', objectFit: 'contain' }}
              />
            </div>

            {lines.map((line, i) => (
              <div
                key={i}
                className={[
                  // The lines are pre-padded by rpad() to exactly charWidth
                  // characters, so whitespace-pre renders them edge-to-edge on
                  // the 42ch grid — no wrap, no centering, no padding.
                  'whitespace-pre',
                  line.bold ? 'font-bold' : '',
                  line.separator ? 'text-slate-400' : '',
                  line.center ? 'text-center' : '',
                  // Small header lines (address/Ph/GSTIN) — one size down, same
                  // as the printed receipt and PDF.
                  line.small ? 'text-[9px]' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={{ fontFamily: "'Courier New', Courier, monospace" }}
              >
                {line.text || ' '}
              </div>
            ))}
          </div>
        </div>

        <div className="px-5 py-4 border-t flex gap-2 justify-end">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleBrowserPrint}>
            <Printer className="h-4 w-4 mr-2" />
            Print Receipt
          </Button>
        </div>
      </div>
    </div>
  );
}
