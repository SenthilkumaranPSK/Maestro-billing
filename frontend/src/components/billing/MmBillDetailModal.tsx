import { X, FileText, Printer, ScanEye, Pencil } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatCurrency, billStatusVariant, type Bill, type Settings, type BillStatus } from '@/types';
import { formatDate } from '@/lib/utils';
import { useClosingTransition } from '@/hooks/use-closing-transition';
import { PdfPreviewModal } from '@/components/billing/PdfPreviewModal';

// pdf-lib is heavy (~400KB) — loaded on demand, same pattern as BillDetailModal.
const loadMmA4Lib = () => import('@/lib/mmA4invoice');

const statusVariant = billStatusVariant;

interface MmBillDetailModalProps {
  bill: Bill;
  settings: Partial<Settings>;
  onClose: () => void;
  onEdit?: () => void;
}

/** MM billing module's own bill-detail view — mirrors BillDetailModal, but
 * always renders as the MM/A4 Tax Invoice layout (no Thermal/A4 toggle — MM
 * bills are never anything else) and shows bill.mmCustomer, not bill.customer. */
export function MmBillDetailModal({ bill, settings, onClose, onEdit }: MmBillDetailModalProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const { closing, requestClose } = useClosingTransition(onClose);

  const handlePrint = async () => {
    const { printMmA4InvoicePDF } = await loadMmA4Lib();
    await printMmA4InvoicePDF(bill, settings);
  };

  const handleDownload = async () => {
    const { downloadMmA4InvoicePDF } = await loadMmA4Lib();
    await downloadMmA4InvoicePDF(bill, settings);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        requestClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [requestClose]);

  return (
    <>
      <div
        className={`fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-[2px] flex items-center justify-center p-4 duration-150 ${closing ? 'animate-out fade-out-0' : 'animate-in fade-in-0'}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            requestClose();
          }
        }}
      >
        <div className={`bg-white rounded-xl shadow-soft-lg w-full max-w-2xl max-h-[90vh] flex flex-col duration-200 ${closing ? 'animate-out fade-out-0 zoom-out-95' : 'animate-in fade-in-0 zoom-in-95'}`}>
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b">
            <div className="flex items-center gap-3">
              <div>
                <h3 className="font-bold text-lg">{bill.billNumber}</h3>
                <p className="text-xs text-muted-foreground">{formatDate(bill.billDate)}</p>
              </div>
              <Badge variant={statusVariant[bill.status as BillStatus]}>{bill.status}</Badge>
            </div>
            <div className="flex gap-2 items-center">
              {bill.status !== 'CANCELLED' && onEdit && (
                <Button variant="outline" size="sm" onClick={onEdit} className="border-amber-300 text-amber-700 hover:bg-amber-50">
                  <Pencil className="h-4 w-4 mr-1" /> Edit
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => setPreviewOpen(true)}>
                <ScanEye className="h-4 w-4 mr-1" /> Preview
              </Button>
              <Button variant="outline" size="sm" onClick={handlePrint}>
                <Printer className="h-4 w-4 mr-1" /> Print
              </Button>
              <Button variant="outline" size="sm" onClick={handleDownload}>
                <FileText className="h-4 w-4 mr-1" /> PDF
              </Button>
              <Button variant="ghost" size="icon" onClick={requestClose}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Content */}
          <div className="overflow-auto flex-1 p-6 space-y-4">
            {/* Customer */}
            {bill.mmCustomer && (
              <div className="bg-slate-50 rounded-lg p-4">
                <p className="text-xs font-semibold text-muted-foreground mb-2">CUSTOMER</p>
                <p className="font-semibold">{bill.mmCustomer.name}</p>
                <p className="text-sm text-muted-foreground">{bill.mmCustomer.phone}</p>
                {bill.mmCustomer.address && <p className="text-sm text-muted-foreground">{bill.mmCustomer.address}</p>}
              </div>
            )}

            {/* Items */}
            <div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground text-xs">
                    <th className="text-left py-2 font-medium">#</th>
                    <th className="text-left py-2 font-medium">Product</th>
                    <th className="text-right py-2 font-medium">Qty</th>
                    <th className="text-right py-2 font-medium">Price</th>
                    <th className="text-right py-2 font-medium">GST</th>
                    <th className="text-right py-2 font-medium">Total</th>
                  </tr>
                </thead>
                <tbody className="stagger-children">
                  {bill.items.map((item, i) => (
                    <tr key={item.id} className="border-b">
                      <td className="py-2 text-muted-foreground">{i + 1}</td>
                      <td className="py-2 font-medium">{item.productName}</td>
                      <td className="py-2 text-right">{item.qty} {item.unit}</td>
                      <td className="py-2 text-right">{formatCurrency(item.unitPrice)}</td>
                      <td className="py-2 text-right text-muted-foreground">{item.gstRate}%</td>
                      <td className="py-2 text-right font-semibold">{formatCurrency(item.totalAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totals */}
            <div className="bg-slate-50 rounded-lg p-4 space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Sub Total</span>
                <span>{formatCurrency(bill.subTotal)}</span>
              </div>
              {bill.gstAmount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">GST</span>
                  <span>{formatCurrency(bill.gstAmount)}</span>
                </div>
              )}
              {bill.discountAmount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Discount</span>
                  <span className="text-red-500">-{formatCurrency(bill.discountAmount)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-base pt-1 border-t">
                <span>Grand Total</span>
                <span className="text-brand-700 tabular-nums">{formatCurrency(bill.grandTotal)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {previewOpen && (
        <PdfPreviewModal
          bill={bill}
          settings={settings}
          layout="mm_a4"
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </>
  );
}
