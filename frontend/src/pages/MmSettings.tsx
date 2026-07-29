import { useState, useEffect } from 'react';
import { Save } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { settingsApi } from '@/api/settings';
import { billsApi } from '@/api/bills';
import { useToast } from '@/hooks/use-toast';

/**
 * MM billing module's own settings — deliberately minimal. The studio's
 * name/address/GSTIN/bank details are shared with the main app (confirmed
 * when MM was first built: same studio, same bank account) and are edited on
 * the main Settings page, not duplicated here. This page only holds the one
 * thing that's actually MM-specific: its default GST rate.
 */
export default function MmSettingsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  });

  const { data: nextMmNumber } = useQuery({
    queryKey: ['bills', 'next-number', 'MM'],
    queryFn: () => billsApi.getNextNumber('MM'),
  });

  const [gstRate, setGstRate] = useState('5');

  useEffect(() => {
    if (settings?.mm?.mm_default_gst_rate) setGstRate(settings.mm.mm_default_gst_rate);
  }, [settings?.mm?.mm_default_gst_rate]);

  const saveMutation = useMutation({
    mutationFn: () => settingsApi.update('mm_default_gst_rate', gstRate, 'mm'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      toast({ title: 'MM settings saved', variant: 'success' });
    },
    onError: (err: Error) => {
      toast({ title: 'Could not save', description: err.message, variant: 'destructive' });
    },
  });

  return (
    <div className="space-y-5 max-w-xl">
      <h2 className="text-lg font-semibold">MM Settings</h2>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Current MM Bill Series</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold text-brand-700 tabular-nums">{nextMmNumber ?? '—'}</p>
          <p className="text-xs text-muted-foreground mt-1">
            Next MM bill number — its own sequence (MM/YY-YY/NNN), entirely separate from the studio's regular bill numbering.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Default GST Rate</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5 max-w-40">
            <Label>GST % for new MM items</Label>
            <Input
              type="number"
              min={0}
              max={100}
              value={gstRate}
              onChange={(e) => setGstRate(e.target.value)}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Applied to new blank line items in MM Billing and new MM/Products. Existing items and products keep whatever rate they already have.
          </p>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            <Save className="h-4 w-4 mr-1.5" />
            {saveMutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
