import { useState, useEffect } from 'react';
import { Save, FileBarChart2, Percent, ChevronRight, Moon, Sun, Building2, Landmark, Lock, Database, HardDrive, RefreshCw } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { settingsApi } from '@/api/settings';
import { billsApi } from '@/api/bills';
import { backupsApi } from '@/api/backups';
import { useToast } from '@/hooks/use-toast';
import { useTheme } from '@/hooks/use-theme';
import { MM_DEFAULTS } from '@/types';

export default function MmSettingsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  });

  const { data: nextMmNumber } = useQuery({
    queryKey: ['bills', 'next-number', 'MM'],
    queryFn: () => billsApi.getNextNumber('MM'),
  });

  const [gstRate, setGstRate] = useState('5');

  // Enterprise details
  const [companyName, setCompanyName] = useState(MM_DEFAULTS.company_name);
  const [brandName, setBrandName] = useState(MM_DEFAULTS.brand_name);
  const [tagline, setTagline] = useState(MM_DEFAULTS.tagline);
  const [fssaiNo, setFssaiNo] = useState(MM_DEFAULTS.fssai_no);
  const [companyAddress, setCompanyAddress] = useState(MM_DEFAULTS.address);
  const [branchOffice, setBranchOffice] = useState(MM_DEFAULTS.branch_office);
  const [branchFssai, setBranchFssai] = useState(MM_DEFAULTS.branch_fssai);
  const [companyGstin, setCompanyGstin] = useState(MM_DEFAULTS.gstin);
  const [contactPhone, setContactPhone] = useState(MM_DEFAULTS.contact);
  const [stateName, setStateName] = useState(MM_DEFAULTS.state_name);
  const [stateCode, setStateCode] = useState(MM_DEFAULTS.state_code);
  const [jurisdiction, setJurisdiction] = useState(MM_DEFAULTS.jurisdiction);

  // Bank details
  const [bankAccountName, setBankAccountName] = useState(MM_DEFAULTS.bank_account_name);
  const [bankName, setBankName] = useState(MM_DEFAULTS.bank_name);
  const [bankAccountNumber, setBankAccountNumber] = useState(MM_DEFAULTS.bank_account_number);
  const [bankBranch, setBankBranch] = useState(MM_DEFAULTS.bank_branch);
  const [bankIfsc, setBankIfsc] = useState(MM_DEFAULTS.bank_ifsc);

  useEffect(() => {
    const mm = settings?.mm;
    if (mm?.mm_default_gst_rate) setGstRate(mm.mm_default_gst_rate);
    if (mm?.mm_company_name) setCompanyName(mm.mm_company_name);
    if (mm?.mm_brand_name) setBrandName(mm.mm_brand_name);
    if (mm?.mm_tagline) setTagline(mm.mm_tagline);
    if (mm?.mm_fssai_no) setFssaiNo(mm.mm_fssai_no);
    if (mm?.mm_address) setCompanyAddress(mm.mm_address);
    if (mm?.mm_branch_office) setBranchOffice(mm.mm_branch_office);
    if (mm?.mm_branch_fssai) setBranchFssai(mm.mm_branch_fssai);
    if (mm?.mm_gstin) setCompanyGstin(mm.mm_gstin);
    if (mm?.mm_contact) setContactPhone(mm.mm_contact);
    if (mm?.mm_state_name) setStateName(mm.mm_state_name);
    if (mm?.mm_state_code) setStateCode(mm.mm_state_code);
    if (mm?.mm_jurisdiction) setJurisdiction(mm.mm_jurisdiction);

    if (mm?.mm_bank_account_name) setBankAccountName(mm.mm_bank_account_name);
    if (mm?.mm_bank_name) setBankName(mm.mm_bank_name);
    if (mm?.mm_bank_account_number) setBankAccountNumber(mm.mm_bank_account_number);
    if (mm?.mm_bank_branch) setBankBranch(mm.mm_bank_branch);
    if (mm?.mm_bank_ifsc) setBankIfsc(mm.mm_bank_ifsc);
  }, [settings?.mm]);

  // Security
  const [password, setPassword] = useState('');
  useEffect(() => {
    if (settings?.security?.bill_edit_password) {
      setPassword(settings.security.bill_edit_password);
    }
  }, [settings?.security]);

  // Backups
  const { data: detectedDrives, refetch: refetchDrives } = useQuery({
    queryKey: ['detected-drives'],
    queryFn: backupsApi.getDrives,
  });
  const [selectedTargetDrive, setSelectedTargetDrive] = useState<string>('');

  useEffect(() => {
    if (detectedDrives && detectedDrives.length > 0 && !selectedTargetDrive) {
      const removable = detectedDrives.find((d) => d.isRemovable);
      setSelectedTargetDrive(removable ? removable.letter : detectedDrives[0]!.letter);
    }
  }, [detectedDrives, selectedTargetDrive]);

  const backupToDriveMutation = useMutation({
    mutationFn: (target: string) => backupsApi.exportToTarget(target),
    onSuccess: (data) => {
      toast({
        title: 'Safe Backup Created!',
        description: `Exported to ${data.filePath} (${(data.sizeBytes / 1024).toFixed(0)} KB)`,
        variant: 'success',
      });
    },
    onError: (err: Error) => {
      toast({ title: 'USB Backup failed', description: err.message, variant: 'destructive' });
    },
  });

  const saveDetailsMutation = useMutation({
    mutationFn: async () => {
      const payload = [
        { key: 'mm_default_gst_rate', value: gstRate, group: 'mm' },
        { key: 'mm_company_name', value: companyName.trim(), group: 'mm' },
        { key: 'mm_brand_name', value: brandName.trim(), group: 'mm' },
        { key: 'mm_tagline', value: tagline.trim(), group: 'mm' },
        { key: 'mm_fssai_no', value: fssaiNo.trim(), group: 'mm' },
        { key: 'mm_address', value: companyAddress.trim(), group: 'mm' },
        { key: 'mm_branch_office', value: branchOffice.trim(), group: 'mm' },
        { key: 'mm_branch_fssai', value: branchFssai.trim(), group: 'mm' },
        { key: 'mm_gstin', value: companyGstin.trim(), group: 'mm' },
        { key: 'mm_contact', value: contactPhone.trim(), group: 'mm' },
        { key: 'mm_state_name', value: stateName.trim(), group: 'mm' },
        { key: 'mm_state_code', value: stateCode.trim(), group: 'mm' },
        { key: 'mm_jurisdiction', value: jurisdiction.trim(), group: 'mm' },
        { key: 'mm_bank_account_name', value: bankAccountName.trim(), group: 'mm' },
        { key: 'mm_bank_name', value: bankName.trim(), group: 'mm' },
        { key: 'mm_bank_account_number', value: bankAccountNumber.trim(), group: 'mm' },
        { key: 'mm_bank_branch', value: bankBranch.trim(), group: 'mm' },
        { key: 'mm_bank_ifsc', value: bankIfsc.trim(), group: 'mm' },
      ];
      if (password.trim()) {
        payload.push({ key: 'bill_edit_password', value: password.trim(), group: 'security' });
      }
      return settingsApi.bulkUpdate(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      toast({ title: 'MM enterprise & invoice settings saved', variant: 'success' });
    },
    onError: (err: Error) => {
      toast({ title: 'Could not save', description: err.message, variant: 'destructive' });
    },
  });

  return (
    <div className="space-y-6 max-w-3xl pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">MM Settings</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure MM wholesale enterprise branding, Tally-style Tax Invoice layout, and bank details.
          </p>
        </div>
        <Button onClick={() => saveDetailsMutation.mutate()} disabled={saveDetailsMutation.isPending} className="shadow-sm">
          <Save className="h-4 w-4 mr-1.5" />
          {saveDetailsMutation.isPending ? 'Saving…' : 'Save Changes'}
        </Button>
      </div>

      {/* Bill Series & Appearance */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Current MM Bill Series</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-brand-700 tabular-nums">{nextMmNumber ?? '—'}</p>
            <p className="text-xs text-muted-foreground mt-1">
              Next MM bill number sequence (MM/YY-YY/NNN).
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Default GST Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <div className="w-28">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={gstRate}
                  onChange={(e) => setGstRate(e.target.value)}
                />
              </div>
              <span className="text-sm font-medium">%</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Applied by default to new line items in MM Billing.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Enterprise & Brand Details */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Building2 className="h-4 w-4 text-brand-600" />
            MM Enterprise & Tax Invoice Header
          </CardTitle>
          <CardDescription className="text-xs">
            Printed on the MM A4 Tax Invoice header, Marketed By seller box, and signatory block.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Brand Title (Top Header)</Label>
              <Input value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="e.g. MORU MORU SNACKS" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Brand Tagline</Label>
              <Input value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="e.g. - Fully Automated 100% Hygiene Products. -" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Legal Company Name (Marketed By)</Label>
              <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="e.g. SREE MEENAKSHI ENTERPRISES" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Main Office FSSAI No.</Label>
              <Input value={fssaiNo} onChange={(e) => setFssaiNo(e.target.value)} placeholder="e.g. 22426581000542" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Marketed By / Main Office Address</Label>
            <Textarea
              rows={2}
              value={companyAddress}
              onChange={(e) => setCompanyAddress(e.target.value)}
              placeholder="e.g. # 21-PACHAPATTI, KRISHNA NAGAR 8th CROSS, AMMAPET, SALEM-636 003."
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Branch Office & Sales Point</Label>
              <Input value={branchOffice} onChange={(e) => setBranchOffice(e.target.value)} placeholder="e.g. 35-A, Thiyagi Nataraj St No 1, Ammapet Salem." />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Branch FSSAI No.</Label>
              <Input value={branchFssai} onChange={(e) => setBranchFssai(e.target.value)} placeholder="e.g. 22426582000581" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">GSTIN / UIN</Label>
              <Input value={companyGstin} onChange={(e) => setCompanyGstin(e.target.value)} placeholder="e.g. 33BAKPM3311D1Z9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Contact Phone</Label>
              <Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="e.g. 9698676151" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Jurisdiction (Footer)</Label>
              <Input value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} placeholder="e.g. SALEM" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">State Name</Label>
              <Input value={stateName} onChange={(e) => setStateName(e.target.value)} placeholder="e.g. Tamil Nadu" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">State Code</Label>
              <Input value={stateCode} onChange={(e) => setStateCode(e.target.value)} placeholder="e.g. 33" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bank Details */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Landmark className="h-4 w-4 text-brand-600" />
            Company Bank Details
          </CardTitle>
          <CardDescription className="text-xs">
            Printed in the bottom-left bank details box on the MM Tax Invoice.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">A/c Holder's Name</Label>
              <Input value={bankAccountName} onChange={(e) => setBankAccountName(e.target.value)} placeholder="e.g. SREE MEENAKSHI ENTERPRISES" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Bank Name</Label>
              <Input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="e.g. IDBI BANK" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">A/c Number</Label>
              <Input value={bankAccountNumber} onChange={(e) => setBankAccountNumber(e.target.value)} placeholder="e.g. 1907102000007535" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Branch</Label>
              <Input value={bankBranch} onChange={(e) => setBankBranch(e.target.value)} placeholder="e.g. AMMAPET" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">IFS Code</Label>
              <Input value={bankIfsc} onChange={(e) => setBankIfsc(e.target.value)} placeholder="e.g. IBKL0001907" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Appearance & Security */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              {theme === 'dark' ? <Moon className="h-4 w-4 text-brand-600" /> : <Sun className="h-4 w-4 text-amber-500" />}
              Appearance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Dark Mode</p>
                <p className="text-xs text-muted-foreground">Adjust display contrast for day / night</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              >
                {theme === 'dark' ? 'Switch to Light' : 'Switch to Dark'}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Lock className="h-4 w-4 text-brand-600" />
              Bill Edit Protection
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Security PIN / Password</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="PIN to edit or cancel saved bills"
              />
              <p className="text-[11px] text-muted-foreground">Required when editing or modifying saved invoices.</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 1-Click External / USB Pen Drive Backup */}
      <Card className="border-emerald-200 bg-emerald-50/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-emerald-900 flex items-center gap-2">
            <HardDrive className="h-4 w-4 text-emerald-700" />
            1-Click External / USB Pen Drive Backup
          </CardTitle>
          <CardDescription className="text-xs text-emerald-700">
            Instant safety backup to removable USB flash drive or secondary drive.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {detectedDrives && detectedDrives.length > 0 ? (
            <div className="flex items-center gap-2">
              <select
                value={selectedTargetDrive}
                onChange={(e) => setSelectedTargetDrive(e.target.value)}
                className="h-9 flex-1 rounded-md border border-emerald-300 bg-white px-3 py-1 text-xs text-slate-800 font-medium shadow-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
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
                className="h-9 text-xs bg-emerald-700 hover:bg-emerald-800 text-white font-medium shrink-0"
              >
                <Save className="h-3.5 w-3.5 mr-1" />
                {backupToDriveMutation.isPending ? 'Backing up…' : 'Backup to USB'}
              </Button>
            </div>
          ) : (
            <div className="text-xs text-emerald-800 py-1 flex items-center justify-between">
              <span>Plug in a USB Flash Drive to enable 1-click external backups.</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetchDrives()}
                className="h-7 text-xs border-emerald-300 bg-white text-emerald-800"
              >
                <RefreshCw className="h-3 w-3 mr-1" />
                Detect Drives
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Reports Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Reports</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <button
            className="w-full flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3 text-sm hover:bg-slate-50 hover:border-brand-400 transition-colors"
            onClick={() => navigate('/mm-day-report')}
          >
            <span className="flex items-center gap-3">
              <FileBarChart2 className="h-4 w-4 text-brand-700 shrink-0" />
              <span className="text-left">
                <span className="block font-medium">MM Day Report</span>
                <span className="block text-xs text-muted-foreground">End-of-day closing summary</span>
              </span>
            </span>
            <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />
          </button>
          <button
            className="w-full flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3 text-sm hover:bg-slate-50 hover:border-brand-400 transition-colors"
            onClick={() => navigate('/mm-month-report')}
          >
            <span className="flex items-center gap-3">
              <FileBarChart2 className="h-4 w-4 text-brand-700 shrink-0" />
              <span className="text-left">
                <span className="block font-medium">MM Month Report</span>
                <span className="block text-xs text-muted-foreground">Monthly closing summary</span>
              </span>
            </span>
            <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />
          </button>
          <button
            className="w-full flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3 text-sm hover:bg-slate-50 hover:border-brand-400 transition-colors"
            onClick={() => navigate('/mm-gst-report')}
          >
            <span className="flex items-center gap-3">
              <Percent className="h-4 w-4 text-brand-700 shrink-0" />
              <span className="text-left">
                <span className="block font-medium">MM GST Report</span>
                <span className="block text-xs text-muted-foreground">Monthly GST summary for filing</span>
              </span>
            </span>
            <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />
          </button>
        </CardContent>
      </Card>
    </div>
  );
}
