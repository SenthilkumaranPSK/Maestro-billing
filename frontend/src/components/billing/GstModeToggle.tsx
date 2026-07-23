import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface GstModeToggleProps {
  value: boolean; // true = inclusive
  onChange: (inclusive: boolean) => void;
}

/**
 * Whole-bill GST pricing mode. Exclusive (default): GST is added on top of
 * the entered price. Inclusive: the entered price already includes GST, so
 * the tax is extracted from within it instead — same idea as Zoho's GST
 * calculator, applied to the whole bill at once.
 */
export function GstModeToggle({ value, onChange }: GstModeToggleProps) {
  return (
    <Select value={value ? 'inclusive' : 'exclusive'} onValueChange={(v) => onChange(v === 'inclusive')}>
      <SelectTrigger className="h-8 w-[130px] text-xs" title="GST pricing mode">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="exclusive" title="GST is added on top of the entered price">
          Exclusive
        </SelectItem>
        <SelectItem value="inclusive" title="The entered price already includes GST">
          Inclusive
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
