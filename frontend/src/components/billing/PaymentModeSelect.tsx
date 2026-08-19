import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { PaymentMode } from '@/types';

const MODES: PaymentMode[] = ['CASH', 'UPI', 'CARD', 'CHEQUE'];
const UNSET = 'UNSET';

interface PaymentModeSelectProps {
  value: PaymentMode | '';
  onChange: (mode: PaymentMode | '') => void;
  disabled?: boolean;
}

/**
 * How the bill was paid — shown on the New Bill form, Edit Bill form, and
 * every bill history/detail view. Deliberately never read by the thermal
 * receipt or A4/MM-A4 PDF renderers (see Bill.paymentMode in schema.prisma).
 */
export function PaymentModeSelect({ value, onChange, disabled }: PaymentModeSelectProps) {
  return (
    <Select value={value || UNSET} onValueChange={(v) => onChange(v === UNSET ? '' : (v as PaymentMode))} disabled={disabled}>
      <SelectTrigger>
        <SelectValue placeholder="Payment Mode" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNSET}>Not set</SelectItem>
        {MODES.map((mode) => (
          <SelectItem key={mode} value={mode}>{mode}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
