import { HardDrive, Smartphone, RotateCcw, FileBarChart2, Percent, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { whatsappApi } from '@/api/whatsapp';
import { backupsApi } from '@/api/backups';
import { useToast } from '@/hooks/use-toast';
import { formatDateTime } from '@/lib/utils';

export default function SettingsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data: whatsappStatus } = useQuery({
    queryKey: ['whatsapp', 'status'],
    queryFn: whatsappApi.getStatus,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'CONNECTED' ? false : 3000;
    },
  });

  const { data: backups } = useQuery({
    queryKey: ['backups'],
    queryFn: backupsApi.list,
  });

  const backupMutation = useMutation({
    mutationFn: backupsApi.create,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['backups'] });
      toast({ title: 'Backup created', description: data.name, variant: 'success' });
    },
    onError: (err: Error) => {
      toast({ title: 'Backup failed', description: err.message, variant: 'destructive' });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: backupsApi.restore,
    onSuccess: () => {
      qc.invalidateQueries();
      toast({
        title: 'Database restored',
        description: 'All data has been rolled back to the selected backup.',
        variant: 'success',
      });
    },
    onError: (err: Error) => {
      toast({ title: 'Restore failed', description: err.message, variant: 'destructive' });
    },
  });

  const handleRestore = (name: string, createdAt: string) => {
    const ok = confirm(
      `Restore the database from this backup?\n\n${name}\n(${formatDateTime(createdAt)})\n\n` +
        'ALL bills and customers created after this backup will be LOST. ' +
        'This cannot be undone.',
    );
    if (!ok) return;
    const doubleCheck = confirm('Are you absolutely sure? This replaces the live database.');
    if (doubleCheck) restoreMutation.mutate(name);
  };

  return (
    <div className="max-w-4xl space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Settings</h2>
        <Button variant="outline" onClick={() => backupMutation.mutate()} disabled={backupMutation.isPending}>
          <HardDrive className="h-4 w-4 mr-1" />
          {backupMutation.isPending ? 'Backing up…' : 'Backup DB'}
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-5 items-start">
        {/* Left column — WhatsApp + Backups */}
        <div className="col-span-2 space-y-5">

      <Card className="border-whatsapp/30">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Smartphone className="h-4 w-4 text-whatsapp" />
            WhatsApp Integration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <span
              className={`inline-block w-2.5 h-2.5 rounded-full ${
                whatsappStatus?.status === 'CONNECTED'
                  ? 'bg-green-500'
                  : whatsappStatus?.status === 'QR_READY'
                    ? 'bg-amber-500 animate-pulse'
                    : 'bg-slate-300'
              }`}
            />
            <span className="text-sm font-medium">
              {whatsappStatus?.status === 'CONNECTED' && 'Connected — bills will be sent with PDF attached'}
              {whatsappStatus?.status === 'QR_READY' && 'Scan QR code with your phone to link WhatsApp'}
              {whatsappStatus?.status === 'CONNECTING' && 'Starting WhatsApp…'}
              {(!whatsappStatus || whatsappStatus.status === 'DISCONNECTED') && 'Not connected'}
            </span>
          </div>

          {whatsappStatus?.status === 'QR_READY' && whatsappStatus.qrCode && (
            <div className="flex flex-col items-center gap-2 py-2">
              <img
                src={whatsappStatus.qrCode}
                alt="WhatsApp QR Code"
                className="w-48 h-48 border rounded-lg"
              />
              <p className="text-xs text-muted-foreground text-center max-w-xs">
                Open WhatsApp on your phone → Linked Devices → Link a Device → scan this code.
              </p>
            </div>
          )}

          {whatsappStatus?.status === 'CONNECTED' && (
            <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
              WhatsApp is linked. Saving a bill with a customer phone number will automatically send the PDF invoice.
            </p>
          )}

          {whatsappStatus?.status !== 'CONNECTED' && whatsappStatus?.status !== 'QR_READY' && (
            <p className="text-xs text-muted-foreground">
              Link your studio WhatsApp account once. After that, invoices are sent directly with the PDF attached — no manual download needed.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm">Database Backups</CardTitle>
          <Button variant="outline" size="sm" onClick={() => backupMutation.mutate()} disabled={backupMutation.isPending}>
            <HardDrive className="h-4 w-4 mr-2" />
            {backupMutation.isPending ? 'Backing up…' : 'Create Backup Now'}
          </Button>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">
            A backup is taken automatically every day when the app starts. The last 30 are kept in{' '}
            <code className="bg-slate-100 px-1 rounded">database/backups/</code>.
            Restoring rolls the whole database back to that moment.
          </p>
          {(backups?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground py-3 text-center">No backups yet.</p>
          ) : (
            <div className="border rounded-lg divide-y max-h-64 overflow-y-auto">
              {backups!.map((b) => (
                <div key={b.name} className="flex items-center justify-between px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{formatDateTime(b.createdAt)}</p>
                    <p className="text-xs text-muted-foreground font-mono truncate">
                      {b.name} · {(b.size / 1024).toFixed(0)} KB
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0 ml-3 text-amber-700 border-amber-300 hover:bg-amber-50"
                    onClick={() => handleRestore(b.name, b.createdAt)}
                    disabled={restoreMutation.isPending}
                  >
                    <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                    Restore
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

        </div>

        {/* Right column — Reports */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Reports</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <button
              className="w-full flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3 text-sm hover:bg-slate-50 hover:border-brand-400 transition-colors"
              onClick={() => navigate('/day-report')}
            >
              <span className="flex items-center gap-3">
                <FileBarChart2 className="h-4 w-4 text-brand-700 shrink-0" />
                <span className="text-left">
                  <span className="block font-medium">Day Report</span>
                  <span className="block text-xs text-muted-foreground">End-of-day closing summary</span>
                </span>
              </span>
              <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />
            </button>
            <button
              className="w-full flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3 text-sm hover:bg-slate-50 hover:border-brand-400 transition-colors"
              onClick={() => navigate('/gst-report')}
            >
              <span className="flex items-center gap-3">
                <Percent className="h-4 w-4 text-brand-700 shrink-0" />
                <span className="text-left">
                  <span className="block font-medium">GST Report</span>
                  <span className="block text-xs text-muted-foreground">Monthly GST summary for filing</span>
                </span>
              </span>
              <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />
            </button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
