import { useState } from 'react';
import { Smartphone, FileBarChart2, Percent, ChevronRight, Save, AlertTriangle, FolderCog } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

  const { data: backupData } = useQuery({
    queryKey: ['backups'],
    queryFn: backupsApi.list,
  });
  const backups = backupData?.backups;

  // Not versioned/behind the app's /api/v1 prefix — same root-level health
  // route desktop/main.js's waitForServer() polls at startup.
  const { data: liveInfo } = useQuery({
    queryKey: ['live'],
    queryFn: async () => {
      const res = await fetch('/live');
      if (!res.ok) throw new Error('not ok');
      return res.json() as Promise<{ version: string }>;
    },
    retry: false,
    staleTime: Infinity,
  });

  const [editingLocation, setEditingLocation] = useState(false);
  const [locationInput, setLocationInput] = useState('');

  const setLocationMutation = useMutation({
    mutationFn: (path: string) => backupsApi.setLocation(path),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['backups'] });
      setEditingLocation(false);
      toast({ title: 'Backup location updated', variant: 'success' });
    },
    onError: (err: Error) => {
      toast({ title: 'Could not set backup location', description: err.message, variant: 'destructive' });
    },
  });

  const handleEditLocation = () => {
    setLocationInput(backupData?.isCustomBackupDir ? backupData.backupDir : '');
    setEditingLocation(true);
  };

  const handleSaveLocation = () => {
    if (!locationInput.trim()) {
      toast({ title: 'Enter a folder path', variant: 'destructive' });
      return;
    }
    setLocationMutation.mutate(locationInput.trim());
  };

  return (
    <div className="max-w-4xl space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Settings</h2>
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
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Database</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">
            A backup is taken automatically every morning, the first time the app is opened that
            day — there's no manual "backup now" button, it's all automatic. The last 30 are kept,
            by default on{' '}
            <code className="bg-slate-100 px-1 rounded">D:\Billing</code> (or{' '}
            <code className="bg-slate-100 px-1 rounded">E:\Billing</code> if D: isn't available) —
            a separate drive from wherever the app and its live database live, on purpose. Set a
            location of your own below if you'd rather use a specific drive or folder. Use{' '}
            <span className="font-medium text-slate-700">Save a Copy</span> to save any backup to a
            location of your choice — a USB drive, Desktop, cloud-synced folder, wherever.
          </p>

          <div className="mb-3 rounded-lg border border-slate-200 px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex items-center gap-2">
                <FolderCog className="h-4 w-4 text-slate-400 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-700">
                    Backup Location{' '}
                    {backupData?.isCustomBackupDir && (
                      <span className="font-normal text-brand-700">(custom)</span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground font-mono truncate">
                    {backupData?.backupDir ?? '—'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {backupData?.isCustomBackupDir && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setLocationMutation.mutate('')}
                    disabled={setLocationMutation.isPending}
                  >
                    Use Automatic
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={handleEditLocation}>
                  Change
                </Button>
              </div>
            </div>
            {editingLocation && (
              <div className="flex items-center gap-2 mt-2.5">
                <Input
                  value={locationInput}
                  onChange={(e) => setLocationInput(e.target.value)}
                  placeholder="e.g. D:\Billing or \\NAS\Backups"
                  className="h-8 text-sm"
                  autoFocus
                />
                <Button size="sm" onClick={handleSaveLocation} disabled={setLocationMutation.isPending}>
                  Save
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setEditingLocation(false)}>
                  Cancel
                </Button>
              </div>
            )}
          </div>

          {backupData && !backupData.onSeparateDrive && (
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 mb-3">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800">
                <span className="font-semibold">No second drive found</span> — backups are currently
                stored on the same drive as the live database ({backupData.backupDir}), so a failed,
                stolen, or wiped drive would take out both together. Connect a D: or E: drive, or set
                a Backup Location above pointing at a different drive or network folder, or regularly
                use <span className="font-medium">Save a Copy</span> below to put one on a USB drive
                or a cloud-synced folder.
              </p>
            </div>
          )}
          {(backups?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground py-3 text-center">No backups yet.</p>
          ) : (
            <div className="border rounded-lg divide-y max-h-64 overflow-y-auto stagger-children">
              {backups!.map((b) => (
                <div key={b.name} className="flex items-center justify-between px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{formatDateTime(b.createdAt)}</p>
                    <p className="text-xs text-muted-foreground font-mono truncate">
                      {b.name} · {(b.size / 1024).toFixed(0)} KB
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => backupsApi.download(b.name)}
                    >
                      <Save className="h-3.5 w-3.5 mr-1.5" />
                      Save a Copy
                    </Button>
                  </div>
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
              onClick={() => navigate('/month-report')}
            >
              <span className="flex items-center gap-3">
                <FileBarChart2 className="h-4 w-4 text-brand-700 shrink-0" />
                <span className="text-left">
                  <span className="block font-medium">Month Report</span>
                  <span className="block text-xs text-muted-foreground">Monthly closing summary</span>
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

      {liveInfo?.version && (
        <p className="text-xs text-muted-foreground text-center">App Version v{liveInfo.version}</p>
      )}
    </div>
  );
}
