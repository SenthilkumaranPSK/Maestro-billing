import { X, FileText, Printer, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ThermalPreviewModal } from './ThermalPreviewModal';
import { useState, useEffect } from 'react';
import { formatCurrency, billStatusVariant, type Bill, type Settings, type BillStatus } from '@/types';
import { formatDate } from '@/lib/utils';

const statusVariant = billStatusVariant;

interface BillDetailModalProps {
  bill: Bill;
  settings: Partial<Settings>;
  onClose: () => void;
  onDownload: () => void;
  onEdit?: () => void;
}

export function BillDetailModal({ bill, settings, onClose, onDownload, onEdit }: BillDetailModalProps) {
  const [showThermal, setShowThermal] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-[2px] flex items-center justify-center p-4 animate-in fade-in-0 duration-150"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            onClose();
          }
        }}
      >
        <div className="bg-white rounded-xl shadow-soft-lg w-full max-w-2xl max-h-[90vh] flex flex-col animate-in fade-in-0 zoom-in-95 duration-200">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b">
            <div className="flex items-center gap-3">
              <div>
                <h3 className="font-bold text-lg">{bill.billNumber}</h3>
                <p className="text-xs text-muted-foreground">{formatDate(bill.billDate)}</p>
              </div>
              <Badge variant={statusVariant[bill.status as BillStatus]}>{bill.status}</Badge>
            </div>
            <div className="flex gap-2">
              {bill.status !== 'CANCELLED' && onEdit && (
                <Button variant="outline" size="sm" onClick={onEdit} className="border-amber-300 text-amber-700 hover:bg-amber-50">
                  <Pencil className="h-4 w-4 mr-1" /> Edit
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => setShowThermal(true)}>
                <Printer className="h-4 w-4 mr-1" /> Thermal
              </Button>
              <Button variant="outline" size="sm" onClick={onDownload}>
                <FileText className="h-4 w-4 mr-1" /> PDF
              </Button>
              <Button variant="ghost" size="icon" onClick={onClose}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Content */}
          <div className="overflow-auto flex-1 p-6 space-y-4">
            {/* Customer */}
            {bill.customer && (
              <div className="bg-slate-50 rounded-lg p-4">
                <p className="text-xs font-semibold text-muted-foreground mb-2">CUSTOMER</p>
                <p className="font-semibold">{bill.customer.name}</p>
                <p className="text-sm text-muted-foreground">{bill.customer.phone}</p>
                {bill.customer.address && <p className="text-sm text-muted-foreground">{bill.customer.address}</p>}
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
                <tbody>
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

      {showThermal && (
        <ThermalPreviewModal
          bill={bill}
          settings={settings}
          onClose={() => setShowThermal(false)}
        />
      )}
    </>
  );
}
