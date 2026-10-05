import { useState, useEffect } from 'react';
import {
  Smartphone, FileBarChart2, Percent, ChevronRight, Save, FolderCog, DatabaseBackup, Moon, Sun, Lock,
  Users, Plus, ChevronUp, ChevronDown, Trash2, ExternalLink, QrCode, HardDrive, RefreshCw, CheckCircle2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { backupsApi, type DetectedDrive } from '@/api/backups';
import { settingsApi } from '@/api/settings';
import { staffApi } from '@/api/staff';
import { useToast } from '@/hooks/use-toast';
import { useTheme } from '@/hooks/use-theme';
import { formatDateTime } from '@/lib/utils';
import { shouldShowWhatsappOnBilling } from '@/types';
import { isWhatsAppEmbedAvailable } from '@/lib/whatsappWeb';
import { generateUpiQrDataUrl } from '@/lib/upiQr';

export default function SettingsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();

  const { data: backupData } = useQuery({
    queryKey: ['backups'],
    queryFn: backupsApi.list,
  });
  const backups = backupData?.backups;

  const { data: detectedDrives, refetch: refetchDrives, isFetching: isFetchingDrives } = useQuery({
    queryKey: ['detected-drives'],
    queryFn: backupsApi.getDrives,
  });

  const [selectedTargetDrive, setSelectedTargetDrive] = useState<string>('');

  useEffect(() => {
    if (detectedDrives && detectedDrives.length > 0 && !selectedTargetDrive) {
      const removable = detectedDrives.find((d) => d.isRemovable) || detectedDrives[0];
      if (removable) setSelectedTargetDrive(removable.letter);
    }
  }, [detectedDrives, selectedTargetDrive]);

  const backupToDriveMutation = useMutation({
    mutationFn: (driveLetter: string) => backupsApi.exportToTarget(driveLetter),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['backups'] });
      toast({
        title: 'USB Backup Successful!',
        description: `Saved snapshot as ${data.fileName} (${(data.sizeBytes / 1024).toFixed(0)} KB)`,
        variant: 'success',
      });
    },
    onError: (err: Error) => {
      toast({
        title: 'USB Backup Failed',
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  const { data: settingsData } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  });

  const [upiIdInput, setUpiIdInput] = useState('');
  const [payeeNameInput, setPayeeNameInput] = useState('');

  useEffect(() => {
    if (settingsData) {
      setUpiIdInput(settingsData.payment?.upi_id || '');
      setPayeeNameInput(settingsData.payment?.upi_merchant_name || settingsData.studio?.studio_name || '');
    }
  }, [settingsData]);

  const saveUpiMutation = useMutation({
    mutationFn: async ({ upiId, payeeName }: { upiId: string; payeeName: string }) => {
      await settingsApi.update('upi_id', upiId.trim(), 'payment');
      if (payeeName.trim()) {
        await settingsApi.update('upi_merchant_name', payeeName.trim(), 'payment');
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      toast({ title: 'UPI settings saved', variant: 'success' });
    },
    onError: (err: Error) => {
      toast({ title: 'Could not save UPI settings', description: err.message, variant: 'destructive' });
    },
  });

  // Missing (older installs) or anything other than the literal string
  // 'false' means "show" — this has to default to today's behaviour so an
  // upgrade never silently hides a feature nobody asked to hide.
  const showWhatsappOnBilling = shouldShowWhatsappOnBilling(settingsData?.general);
  const whatsappEmbedded = isWhatsAppEmbedAvailable();

  const setShowWhatsappMutation = useMutation({
    mutationFn: (value: boolean) => settingsApi.update('show_whatsapp_on_billing', String(value), 'general'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Could not update setting', description: err.message, variant: 'destructive' });
    },
  });

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

  const backupNowMutation = useMutation({
    mutationFn: backupsApi.create,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['backups'] });
      toast({ title: 'Backup created', variant: 'success' });
    },
    onError: (err: Error) => {
      toast({ title: 'Backup failed', description: err.message, variant: 'destructive' });
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

  // Bill-edit password (Settings → Security) — required before EditBillModal
  // / MmEditBillModal can be opened, see PasswordGateModal. Seeded to
  // '1234567890' by backend/src/seed.ts on first install.
  const [editingPassword, setEditingPassword] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');

  const setPasswordMutation = useMutation({
    mutationFn: (password: string) => settingsApi.update('bill_edit_password', password, 'security'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      setEditingPassword(false);
      setPasswordInput('');
      toast({ title: 'Bill-edit password updated', variant: 'success' });
    },
    onError: (err: Error) => {
      toast({ title: 'Could not update password', description: err.message, variant: 'destructive' });
    },
  });

  const handleSavePassword = () => {
    if (!passwordInput.trim()) {
      toast({ title: 'Enter a password', variant: 'destructive' });
      return;
    }
    setPasswordMutation.mutate(passwordInput.trim());
  };

  // Staff list ("Billed By" on the bill form) — see api/staff.ts and backend
  // schema.prisma Staff. Ordered by sortOrder, active only (deactivated staff
  // just stop appearing here and in BilledBySelect; already-saved bills keep
  // their billedByName regardless).
  const { data: staffList } = useQuery({
    queryKey: ['staff'],
    queryFn: () => staffApi.list(),
  });
  const [newStaffName, setNewStaffName] = useState('');

  const addStaffMutation = useMutation({
    mutationFn: (name: string) => staffApi.create(name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff'] });
      setNewStaffName('');
    },
    onError: (err: Error) => {
      toast({ title: 'Could not add staff', description: err.message, variant: 'destructive' });
    },
  });

  const reorderStaffMutation = useMutation({
    mutationFn: (ids: number[]) => staffApi.reorder(ids),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Could not reorder staff', description: err.message, variant: 'destructive' });
    },
  });

  const removeStaffMutation = useMutation({
    mutationFn: (id: number) => staffApi.deactivate(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Could not remove staff', description: err.message, variant: 'destructive' });
    },
  });

  const handleAddStaff = () => {
    if (!newStaffName.trim()) {
      toast({ title: 'Enter a name', variant: 'destructive' });
      return;
    }
    addStaffMutation.mutate(newStaffName.trim());
  };

  // Swaps the row at `index` with its neighbour, then submits the FULL
  // resulting id order — staffApi.reorder always reassigns sortOrder from
  // the whole list it's given, not a per-row delta.
  const moveStaff = (index: number, direction: -1 | 1) => {
    if (!staffList) return;
    const target = index + direction;
    if (target < 0 || target >= staffList.length) return;
    const ids = staffList.map((s) => s.id);
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    reorderStaffMutation.mutate(ids);
  };

  const handleRemoveStaff = (name: string, id: number) => {
    const ok = confirm(`Remove "${name}" from the Billed By list?\n\nBills already billed by them keep showing their name — this only affects new bills.`);
    if (ok) removeStaffMutation.mutate(id);
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
          {whatsappEmbedded ? (
            <>
              <p className="text-sm">
                WhatsApp runs on the{' '}
                <span className="font-medium">WhatsApp</span> page — scan the QR
                code there once and this PC stays linked between restarts.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate('/whatsapp')}
              >
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                Open WhatsApp
              </Button>
              <p className="text-xs text-muted-foreground">
                Saving a bill with a customer phone number attaches the PDF and
                sends it from that session. There is no separate login here.
              </p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              WhatsApp sending runs inside the Maestro Billing desktop app,
              which keeps you signed in between restarts. In a browser, saving a
              bill downloads the PDF and opens the customer's chat on
              web.whatsapp.com so you can attach it.
            </p>
          )}

          <label className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              className="h-4 w-4 accent-whatsapp"
              checked={showWhatsappOnBilling}
              disabled={setShowWhatsappMutation.isPending}
              onChange={(e) => setShowWhatsappMutation.mutate(e.target.checked)}
            />
            <span>
              Show WhatsApp option on the New Bill screen
              <span className="block text-xs text-muted-foreground font-normal">
                Turn off to hide the "Send on WhatsApp" checkbox and buttons while billing. The WhatsApp page keeps working either way.
              </span>
            </span>
          </label>
        </CardContent>
      </Card>

      {/* UPI Payment QR Code Setup Card */}
      <Card className="border-blue-100">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <QrCode className="h-4 w-4 text-blue-600" />
            UPI Payment QR Code
          </CardTitle>
          {upiIdInput.trim() && (
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 border border-blue-200">
              <CheckCircle2 className="h-3 w-3 text-blue-600" />
              Active on Receipts & Invoices
            </span>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Print a dynamic UPI QR code on 80mm thermal receipts and A4 invoices so customers can scan and pay instantly with GPay, PhonePe, Paytm, or BHIM.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                UPI ID / VPA
              </label>
              <Input
                value={upiIdInput}
                onChange={(e) => setUpiIdInput(e.target.value)}
                placeholder="e.g. yourstore@okhdfcbank"
                className="h-8 text-xs font-mono"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Merchant / Business Name
              </label>
              <Input
                value={payeeNameInput}
                onChange={(e) => setPayeeNameInput(e.target.value)}
                placeholder="e.g. Maestro Studio"
                className="h-8 text-xs"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <Button
              size="sm"
              onClick={() => saveUpiMutation.mutate({ upiId: upiIdInput, payeeName: payeeNameInput })}
              disabled={saveUpiMutation.isPending}
              className="h-8 text-xs bg-blue-600 hover:bg-blue-700 text-white"
            >
              {saveUpiMutation.isPending ? 'Saving…' : 'Save UPI Settings'}
            </Button>
            {upiIdInput.trim() && (
              <span className="text-xs text-slate-500 italic">
                Format: <code className="font-mono text-blue-600">{upiIdInput.trim()}</code>
              </span>
            )}
          </div>

          {upiIdInput.trim() && (
            <div className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center gap-4">
              <img
                src={generateUpiQrDataUrl({
                  upiId: upiIdInput.trim(),
                  name: payeeNameInput.trim() || 'Studio',
                  amountPaisa: 10000,
                  billNumber: 'DEMO-001',
                  notes: 'Test UPI Scan',
                }, 110)}
                alt="Test UPI QR"
                className="w-24 h-24 rounded border bg-white p-1 shadow-sm shrink-0"
              />
              <div className="text-xs space-y-1">
                <span className="font-semibold text-slate-800 block">Live QR Preview & Scan Test</span>
                <p className="text-muted-foreground text-[11px]">
                  You can test-scan this sample QR code with your phone camera or payment app. Real receipts will automatically embed the exact bill amount and bill number.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <DatabaseBackup className="h-4 w-4 text-slate-700" />
            Database & Backups
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => backupNowMutation.mutate()}
            disabled={backupNowMutation.isPending}
          >
            <DatabaseBackup className="h-3.5 w-3.5 mr-1.5" />
            {backupNowMutation.isPending ? 'Backing up…' : 'Backup Now'}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Automatic daily backups are kept on a secondary drive. You can also export instant 1-click snapshots to an external USB flash pen drive or custom directory.
          </p>

          {/* USB Flash Drive Quick Backup Card */}
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <HardDrive className="h-4 w-4 text-emerald-700" />
                <span className="text-xs font-bold text-emerald-900 uppercase tracking-wide">
                  USB Pen Drive Backup
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => refetchDrives()}
                disabled={isFetchingDrives}
                className="h-6 text-[11px] px-2 text-emerald-800 hover:bg-emerald-100"
              >
                <RefreshCw className={`h-3 w-3 mr-1 ${isFetchingDrives ? 'animate-spin' : ''}`} />
                Scan Drives
              </Button>
            </div>

            {detectedDrives && detectedDrives.length > 0 ? (
              <div className="flex items-center gap-2 mt-2">
                <select
                  value={selectedTargetDrive}
                  onChange={(e) => setSelectedTargetDrive(e.target.value)}
                  className="h-8 flex-1 rounded-md border border-emerald-300 bg-white px-2 py-1 text-xs text-slate-800 font-medium shadow-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  {detectedDrives.map((d) => (
                    <option key={d.letter} value={d.letter}>
                      {d.letter} {d.label ? `(${d.label})` : ''} {d.isRemovable ? '— Removable USB' : '— Local Drive'}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  onClick={() => selectedTargetDrive && backupToDriveMutation.mutate(selectedTargetDrive)}
                  disabled={!selectedTargetDrive || backupToDriveMutation.isPending}
                  className="h-8 text-xs bg-emerald-700 hover:bg-emerald-800 text-white font-medium shrink-0"
                >
                  <Save className="h-3.5 w-3.5 mr-1" />
                  {backupToDriveMutation.isPending ? 'Copying…' : 'Backup to USB'}
                </Button>
              </div>
            ) : (
              <div className="text-xs text-emerald-800 py-1 flex items-center justify-between">
                <span>Plug in a USB Flash Drive to enable 1-click external backups.</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetchDrives()}
                  className="h-6 text-[11px] px-2 border-emerald-300 bg-white text-emerald-800"
                >
                  Detect Drives
                </Button>
              </div>
            )}
          </div>

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

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Users className="h-4 w-4" />
            Staff
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Who shows up in "Billed By" on the bill form, in this order. Removing someone here
            doesn't change bills they already billed — those keep their name.
          </p>

          <div className="flex items-center gap-2">
            <Input
              value={newStaffName}
              onChange={(e) => setNewStaffName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddStaff(); }}
              placeholder="New staff name"
              className="h-8 text-sm"
            />
            <Button size="sm" onClick={handleAddStaff} disabled={addStaffMutation.isPending}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add
            </Button>
          </div>

          {(staffList?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground py-3 text-center">No staff yet.</p>
          ) : (
            <div className="border rounded-lg divide-y">
              {staffList!.map((s, i) => (
                <div key={s.id} className="flex items-center justify-between px-3 py-2">
                  <span className="text-sm font-medium">{s.name}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      title="Move up"
                      disabled={i === 0 || reorderStaffMutation.isPending}
                      onClick={() => moveStaff(i, -1)}
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      title="Move down"
                      disabled={i === staffList!.length - 1 || reorderStaffMutation.isPending}
                      onClick={() => moveStaff(i, 1)}
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      title="Remove"
                      onClick={() => handleRemoveStaff(s.name, s.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

        </div>

        {/* Right column — Appearance + Reports */}
        <div className="space-y-5">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              {theme === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
              Appearance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <label className="flex items-center justify-between gap-3 text-sm cursor-pointer">
              <span>
                Dark mode
                <span className="block text-xs text-muted-foreground font-normal">
                  Applies across the whole app, remembered on this PC.
                </span>
              </span>
              <input
                type="checkbox"
                className="h-4 w-4 accent-brand-600 shrink-0"
                checked={theme === 'dark'}
                onChange={(e) => setTheme(e.target.checked ? 'dark' : 'light')}
              />
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Lock className="h-4 w-4" />
              Security
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mb-3">
              Editing a saved bill (main or MM) asks for this password first — a guard against
              accidental or casual edits, not a login.
            </p>
            {!editingPassword ? (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-700">Bill Edit Password</p>
                  <p className="text-xs text-muted-foreground font-mono">••••••••••</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setPasswordInput('');
                    setEditingPassword(true);
                  }}
                >
                  Change
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Input
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder="New password"
                  className="h-8 text-sm"
                  autoFocus
                />
                <Button size="sm" onClick={handleSavePassword} disabled={setPasswordMutation.isPending}>
                  Save
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setEditingPassword(false)}>
                  Cancel
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

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
      </div>

      {liveInfo?.version && (
        <p className="text-xs text-muted-foreground text-center">App Version v{liveInfo.version}</p>
      )}
    </div>
  );
}
