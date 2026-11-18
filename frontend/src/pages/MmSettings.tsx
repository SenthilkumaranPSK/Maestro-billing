import { useState, useEffect, useRef } from 'react';
import {
  Save,
  Moon,
  Sun,
  Building2,
  Landmark,
  Lock,
  Database,
  FolderCog,
  Download,
  CheckCircle2,
  X,
  Loader2,
  RefreshCw,
  LayoutTemplate,
  Shield,
  Upload,
  Image as ImageIcon,
  RotateCcw,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
import { MM_DEFAULTS, type Bill, type Settings } from '@/types';
import { generateMmA4InvoicePDF } from '@/lib/mmA4invoice';

const samplePreviewBill: Bill = {
  id: 999,
  billNumber: 'MM/26-27/001',
  billDate: new Date().toISOString(),
  subTotal: 300000,
  gstAmount: 15000,
  discountAmount: 0,
  grandTotal: 315000,
  status: 'PAID',
  paymentMode: 'CASH',
  termsOfPayment: 'Immediate',
  gstInclusive: false,
  isInterState: false,
  deliveryNote: 'DN-1024',
  buyersOrderNo: 'PO-8821',
  buyersOrderDate: new Date(Date.now() - 86400000 * 2).toISOString(),
  dispatchDocNo: 'LR-55421',
  deliveryNoteDate: new Date().toISOString(),
  despatchedThrough: 'TN 30 AB 1234',
  destination: 'Salem',
  termsOfDelivery: 'Door Delivery',
  buyerName: 'Sample Wholesale Store',
  buyerAddress: '14/2 Bazaar Main Road, Salem - 636001',
  buyerGstin: '33AAAAA0000A1Z5',
  consigneeName: 'Sample Wholesale Store',
  consigneeAddress: '14/2 Bazaar Main Road, Salem - 636001',
  consigneeGstin: '33AAAAA0000A1Z5',
  items: [
    {
      id: 1,
      billId: 999,
      productName: 'Murukku Spicy Regular',
      hsnSac: '210690',
      unit: 'KGS',
      qty: 10,
      unitPrice: 15000,
      gstRate: 5,
      gstAmount: 7500,
      totalAmount: 157500,
    },
    {
      id: 2,
      billId: 999,
      productName: 'Ribbon Pakoda Special',
      hsnSac: '210690',
      unit: 'KGS',
      qty: 10,
      unitPrice: 15000,
      gstRate: 5,
      gstAmount: 7500,
      totalAmount: 157500,
    },
  ],
  payments: [],
  createdAt: new Date().toISOString(),
};

export default function MmSettingsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { theme, setTheme } = useTheme();

  const [activeTab, setActiveTab] = useState<'layout' | 'security'>('layout');

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  });

  const { data: nextMmNumber } = useQuery({
    queryKey: ['bills', 'next-number', 'MM'],
    queryFn: () => billsApi.getNextNumber('MM'),
  });

  // Enterprise & Layout details
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

  // Bank details (only editable in Settings)
  const [bankAccountName, setBankAccountName] = useState(MM_DEFAULTS.bank_account_name);
  const [bankName, setBankName] = useState(MM_DEFAULTS.bank_name);
  const [bankAccountNumber, setBankAccountNumber] = useState(MM_DEFAULTS.bank_account_number);
  const [bankBranch, setBankBranch] = useState(MM_DEFAULTS.bank_branch);
  const [bankIfsc, setBankIfsc] = useState(MM_DEFAULTS.bank_ifsc);

  // Direct Logo State
  const [logoData, setLogoData] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Real-time Live Preview state
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);

  useEffect(() => {
    const mm = settings?.mm;
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

    if (mm?.mm_logo_data) {
      setLogoData(mm.mm_logo_data);
    }
  }, [settings?.mm]);

  // Real-time live invoice preview generation
  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      setIsGeneratingPreview(true);
      try {
        const liveSettings: Partial<Settings> = {
          ...settings,
          mm: {
            ...settings?.mm,
            mm_company_name: companyName,
            mm_brand_name: brandName,
            mm_tagline: tagline,
            mm_fssai_no: fssaiNo,
            mm_address: companyAddress,
            mm_branch_office: branchOffice,
            mm_branch_fssai: branchFssai,
            mm_gstin: companyGstin,
            mm_contact: contactPhone,
            mm_state_name: stateName,
            mm_state_code: stateCode,
            mm_jurisdiction: jurisdiction,
            mm_bank_account_name: bankAccountName,
            mm_bank_name: bankName,
            mm_bank_account_number: bankAccountNumber,
            mm_bank_branch: bankBranch,
            mm_bank_ifsc: bankIfsc,
            mm_logo_data: logoData || undefined,
          },
        };

        const currentBill = {
          ...samplePreviewBill,
          billNumber: nextMmNumber || samplePreviewBill.billNumber,
        };

        const bytes = await generateMmA4InvoicePDF(currentBill, liveSettings);
        if (!active) return;
        const blob = new Blob(
          [bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer],
          { type: 'application/pdf' }
        );
        const url = URL.createObjectURL(blob);
        setPreviewUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return url;
        });
      } catch (err) {
        console.error('Failed to generate real-time preview:', err);
      } finally {
        if (active) setIsGeneratingPreview(false);
      }
    }, 300);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [
    companyName,
    brandName,
    tagline,
    fssaiNo,
    companyAddress,
    branchOffice,
    branchFssai,
    companyGstin,
    contactPhone,
    stateName,
    stateCode,
    jurisdiction,
    bankAccountName,
    bankName,
    bankAccountNumber,
    bankBranch,
    bankIfsc,
    logoData,
    nextMmNumber,
  ]);

  // Direct Logo Upload Handler
  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast({ title: 'Invalid file format', description: 'Please choose an image (PNG, JPG, or WEBP).', variant: 'destructive' });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: 'File too large', description: 'Logo size must be under 2MB.', variant: 'destructive' });
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setLogoData(dataUrl);
      toast({ title: 'Logo updated', description: 'Live preview updated. Click "Save Layout Changes" to persist.', variant: 'default' });
    };
    reader.readAsDataURL(file);
  };

  const handleResetLogo = () => {
    setLogoData(null);
    if (logoInputRef.current) logoInputRef.current.value = '';
    toast({ title: 'Default Logo Restored', description: 'Using default Moru Moru master logo.', variant: 'default' });
  };

  // Security & Protection
  const [protectionEnabled, setProtectionEnabled] = useState(true);
  const [showChangePinModal, setShowChangePinModal] = useState(false);
  const [showDisablePinModal, setShowDisablePinModal] = useState(false);
  const [disablePinInput, setDisablePinInput] = useState('');
  const [disablePinError, setDisablePinError] = useState('');
  const [isVerifyingDisable, setIsVerifyingDisable] = useState(false);

  // Change PIN fields
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinChangeError, setPinChangeError] = useState('');
  const [isChangingPin, setIsChangingPin] = useState(false);

  useEffect(() => {
    if (settings?.security) {
      if (settings.security.bill_edit_protection_enabled !== undefined) {
        setProtectionEnabled(settings.security.bill_edit_protection_enabled !== 'false');
      }
    }
  }, [settings?.security]);

  const handleToggleProtection = (checked: boolean) => {
    if (!checked && protectionEnabled) {
      setDisablePinInput('');
      setDisablePinError('');
      setShowDisablePinModal(true);
    } else if (checked && !protectionEnabled) {
      settingsApi.bulkUpdate([{ key: 'bill_edit_protection_enabled', value: 'true', group: 'security' }]).then(() => {
        setProtectionEnabled(true);
        qc.invalidateQueries({ queryKey: ['settings'] });
        toast({ title: 'Bill Edit Protection Enabled', variant: 'success' });
      });
    }
  };

  const confirmDisableProtection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!disablePinInput.trim()) {
      setDisablePinError('Please enter current Security PIN.');
      return;
    }
    setIsVerifyingDisable(true);
    setDisablePinError('');
    try {
      const res = await settingsApi.verifyPin(disablePinInput.trim());
      if (!res.data?.valid) {
        setDisablePinError('Incorrect Security PIN.');
        setIsVerifyingDisable(false);
        return;
      }
      await settingsApi.bulkUpdate(
        [{ key: 'bill_edit_protection_enabled', value: 'false', group: 'security' }],
        disablePinInput.trim()
      );
      setProtectionEnabled(false);
      setShowDisablePinModal(false);
      qc.invalidateQueries({ queryKey: ['settings'] });
      toast({ title: 'Bill Edit Protection Disabled', variant: 'default' });
    } catch (err: any) {
      setDisablePinError(err.message || 'Failed to disable protection.');
    } finally {
      setIsVerifyingDisable(false);
    }
  };

  const handleSaveNewPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPin.trim()) {
      setPinChangeError('Current Security PIN is required.');
      return;
    }
    if (!newPin.trim()) {
      setPinChangeError('New PIN cannot be empty.');
      return;
    }
    if (newPin.trim().length < 4) {
      setPinChangeError('New PIN must be at least 4 digits/characters.');
      return;
    }
    if (newPin !== confirmPin) {
      setPinChangeError('New PIN and Confirm PIN do not match.');
      return;
    }

    setIsChangingPin(true);
    setPinChangeError('');
    try {
      const verifyRes = await settingsApi.verifyPin(currentPin.trim());
      if (!verifyRes.data?.valid) {
        setPinChangeError('Current Security PIN is incorrect.');
        setIsChangingPin(false);
        return;
      }
      await settingsApi.bulkUpdate(
        [{ key: 'bill_edit_password', value: newPin.trim(), group: 'security' }],
        currentPin.trim()
      );
      setShowChangePinModal(false);
      setCurrentPin('');
      setNewPin('');
      setConfirmPin('');
      qc.invalidateQueries({ queryKey: ['settings'] });
      toast({ title: 'Security PIN updated successfully!', variant: 'success' });
    } catch (err: any) {
      setPinChangeError(err.message || 'Failed to update PIN.');
    } finally {
      setIsChangingPin(false);
    }
  };

  // Database Backup Management
  const [customBackupDir, setCustomBackupDir] = useState('');
  const [editingDir, setEditingDir] = useState(false);

  const { data: backupData, refetch: refetchBackupData } = useQuery({
    queryKey: ['backups', 'list'],
    queryFn: backupsApi.list,
  });

  useEffect(() => {
    if (backupData?.backupDir) {
      setCustomBackupDir(backupData.backupDir);
    }
  }, [backupData?.backupDir]);

  const createBackupMutation = useMutation({
    mutationFn: backupsApi.create,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['backups'] });
      refetchBackupData();
      toast({
        title: 'Database backup created!',
        description: `Snapshot ${data?.name || 'MM_Billing_Backup.db'} saved.`,
        variant: 'success',
      });
    },
    onError: (err: Error) => {
      toast({ title: 'Backup failed', description: err.message, variant: 'destructive' });
    },
  });

  const updateDirMutation = useMutation({
    mutationFn: (dir: string) => backupsApi.setLocation(dir),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['backups'] });
      refetchBackupData();
      setEditingDir(false);
      toast({ title: 'Backup folder updated', variant: 'success' });
    },
    onError: (err: Error) => {
      toast({ title: 'Could not change folder', description: err.message, variant: 'destructive' });
    },
  });

  // Save Layout Changes
  const updateLayoutMutation = useMutation({
    mutationFn: () => {
      const payload: Array<{ key: string; value: string; group?: string }> = [
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
        { key: 'mm_logo_data', value: logoData || '', group: 'mm' },
      ];
      return settingsApi.bulkUpdate(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      toast({ title: 'Invoice Layout & Bank Details saved!', description: 'All wholesale tax invoices will use these settings.', variant: 'success' });
    },
    onError: (err: Error) => {
      toast({ title: 'Save failed', description: err.message, variant: 'destructive' });
    },
  });

  const handleResetDefaults = () => {
    if (!confirm('Reset invoice layout and bank details to defaults?')) return;
    setCompanyName(MM_DEFAULTS.company_name);
    setBrandName(MM_DEFAULTS.brand_name);
    setTagline(MM_DEFAULTS.tagline);
    setFssaiNo(MM_DEFAULTS.fssai_no);
    setCompanyAddress(MM_DEFAULTS.address);
    setBranchOffice(MM_DEFAULTS.branch_office);
    setBranchFssai(MM_DEFAULTS.branch_fssai);
    setCompanyGstin(MM_DEFAULTS.gstin);
    setContactPhone(MM_DEFAULTS.contact);
    setStateName(MM_DEFAULTS.state_name);
    setStateCode(MM_DEFAULTS.state_code);
    setJurisdiction(MM_DEFAULTS.jurisdiction);
    setBankAccountName(MM_DEFAULTS.bank_account_name);
    setBankName(MM_DEFAULTS.bank_name);
    setBankAccountNumber(MM_DEFAULTS.bank_account_number);
    setBankBranch(MM_DEFAULTS.bank_branch);
    setBankIfsc(MM_DEFAULTS.bank_ifsc);
    setLogoData(null);
    toast({ title: 'Defaults restored', description: 'Click "Save Layout Changes" to apply.', variant: 'default' });
  };

  return (
    <div className="space-y-6 pb-12 max-w-7xl mx-auto">
      {/* Top Header & Tab Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">MM Settings</h1>
          <p className="text-sm text-muted-foreground">
            Configure wholesale tax invoice layout, identity, bank details, and security.
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center gap-1.5 bg-slate-100 p-1.5 rounded-xl border border-slate-200">
          <button
            type="button"
            onClick={() => setActiveTab('layout')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'layout'
                ? 'bg-white text-brand-700 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <LayoutTemplate className="h-4 w-4" />
            Edit Layout & Bank Details
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('security')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'security'
                ? 'bg-white text-brand-700 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Shield className="h-4 w-4" />
            Security & Backup
          </button>
        </div>
      </div>

      {/* ── TAB 1: EDIT LAYOUT WITH REAL-TIME PREVIEW ──────────────── */}
      {activeTab === 'layout' && (
        <div className="grid grid-cols-12 gap-6 items-start">
          {/* Left Column: Form Fields (Inputs) */}
          <div className="col-span-12 xl:col-span-6 space-y-5">
            {/* Direct Logo Option Card */}
            <Card className="border-brand-200/90 bg-brand-50/20 shadow-xs">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span className="flex items-center gap-2 text-brand-900">
                    <ImageIcon className="h-4 w-4 text-brand-700" />
                    Direct Logo Option
                  </span>
                  <span className="text-[11px] font-medium text-brand-700 bg-brand-100/70 px-2.5 py-0.5 rounded-full">
                    Top-Left Header
                  </span>
                </CardTitle>
                <CardDescription className="text-xs">
                  Upload custom brand logo rendered directly on the top-left of every MM wholesale tax invoice.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-4 bg-white p-3 rounded-lg border border-slate-200">
                  <div className="w-24 h-16 bg-slate-50 border border-dashed border-slate-300 rounded-md flex items-center justify-center p-1.5 overflow-hidden shrink-0">
                    <img
                      src={logoData || '/mm-logo.png'}
                      alt="Brand Logo Preview"
                      className="max-h-full max-w-full object-contain"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).src = '/mm-logo.png';
                      }}
                    />
                  </div>
                  <div className="space-y-1.5 flex-1">
                    <p className="text-xs font-semibold text-slate-800">
                      {logoData ? 'Custom Logo Active' : 'Default Master Logo Active'}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Supports PNG, JPG, or WEBP (transparent PNG recommended, up to 2MB).
                    </p>
                    <div className="flex items-center gap-2 pt-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs font-medium"
                        onClick={() => logoInputRef.current?.click()}
                      >
                        <Upload className="h-3.5 w-3.5 mr-1.5" />
                        Upload New Logo
                      </Button>
                      {logoData && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-8 text-xs text-muted-foreground hover:text-destructive"
                          onClick={handleResetLogo}
                        >
                          <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                          Use Default Logo
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
                <input
                  type="file"
                  ref={logoInputRef}
                  onChange={handleLogoUpload}
                  accept="image/png, image/jpeg, image/webp"
                  className="hidden"
                />
              </CardContent>
            </Card>

            {/* Top Brand & Seller Details Card */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-brand-600" />
                  Top Brand & Seller Identity (Marketed By)
                </CardTitle>
                <CardDescription className="text-xs">
                  Printed in the top header and left 'Marketed By' address block.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-12 gap-3">
                  <div className="col-span-8">
                    <Label className="text-xs font-semibold">Brand Name (Header Banner)</Label>
                    <Input
                      value={brandName}
                      onChange={(e) => setBrandName(e.target.value)}
                      placeholder="e.g. MORU MORU SNACKS"
                      className="font-bold text-sm"
                    />
                  </div>
                  <div className="col-span-4">
                    <Label className="text-xs font-semibold">Master FSSAI No</Label>
                    <Input
                      value={fssaiNo}
                      onChange={(e) => setFssaiNo(e.target.value)}
                      placeholder="e.g. 22426581000542"
                      maxLength={14}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-12 gap-3">
                  <div className="col-span-6">
                    <Label className="text-xs font-semibold">Company / Seller Legal Name</Label>
                    <Input
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      placeholder="e.g. SRI MEENAKSHI Enterprises"
                    />
                  </div>
                  <div className="col-span-6">
                    <Label className="text-xs font-semibold">Seller GSTIN</Label>
                    <Input
                      value={companyGstin}
                      onChange={(e) => setCompanyGstin(e.target.value.toUpperCase())}
                      placeholder="15-digit GSTIN"
                      maxLength={15}
                    />
                  </div>
                </div>

                <div>
                  <Label className="text-xs font-semibold">Seller Address (Marketed By block)</Label>
                  <Textarea
                    value={companyAddress}
                    onChange={(e) => setCompanyAddress(e.target.value)}
                    rows={2}
                    placeholder="Enter registered enterprise address"
                    className="text-xs"
                  />
                </div>

                <div className="grid grid-cols-12 gap-3">
                  <div className="col-span-6">
                    <Label className="text-xs font-semibold">Contact Phone</Label>
                    <Input
                      value={contactPhone}
                      onChange={(e) => setContactPhone(e.target.value)}
                      placeholder="e.g. 9698676151"
                    />
                  </div>
                  <div className="col-span-6">
                    <Label className="text-xs font-semibold">State &amp; Code</Label>
                    <div className="flex gap-2">
                      <Input
                        value={stateName}
                        onChange={(e) => setStateName(e.target.value)}
                        placeholder="e.g. Tamil Nadu"
                        className="flex-1"
                      />
                      <Input
                        value={stateCode}
                        onChange={(e) => setStateCode(e.target.value)}
                        placeholder="33"
                        className="w-16"
                        maxLength={2}
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Branch Office & Sales Point Card */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-brand-600" />
                  Branch Office &amp; Sales Point (Right Header)
                </CardTitle>
                <CardDescription className="text-xs">
                  Printed in the top right address box of the invoice.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label className="text-xs font-semibold">Branch Office Address</Label>
                  <Textarea
                    value={branchOffice}
                    onChange={(e) => setBranchOffice(e.target.value)}
                    rows={2}
                    placeholder="e.g. 35-A, Thiyagi Natesan St No 1, Ammapet, Salem."
                    className="text-xs"
                  />
                </div>
                <div>
                  <Label className="text-xs font-semibold">Branch FSSAI No</Label>
                  <Input
                    value={branchFssai}
                    onChange={(e) => setBranchFssai(e.target.value)}
                    placeholder="e.g. 22426582000581"
                    maxLength={14}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Bank Details Card — ONLY editable in Settings */}
            <Card className="border-brand-300 bg-brand-50/10 shadow-xs">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span className="flex items-center gap-2 text-brand-900">
                    <Landmark className="h-4 w-4 text-brand-700" />
                    Company Bank Details (for Tax Invoices)
                  </span>
                  <span className="text-[11px] font-semibold text-emerald-800 bg-emerald-100 px-2.5 py-0.5 rounded-full">
                    Exclusive to Settings
                  </span>
                </CardTitle>
                <CardDescription className="text-xs">
                  Bank details are strictly managed here and rendered in the bottom left bank block on every invoice.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-12 gap-3">
                  <div className="col-span-6">
                    <Label className="text-xs font-semibold">Bank Name</Label>
                    <Input
                      value={bankName}
                      onChange={(e) => setBankName(e.target.value)}
                      placeholder="e.g. City Union Bank"
                    />
                  </div>
                  <div className="col-span-6">
                    <Label className="text-xs font-semibold">Bank Branch</Label>
                    <Input
                      value={bankBranch}
                      onChange={(e) => setBankBranch(e.target.value)}
                      placeholder="e.g. Ammapet"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-12 gap-3">
                  <div className="col-span-6">
                    <Label className="text-xs font-semibold">Account Number</Label>
                    <Input
                      value={bankAccountNumber}
                      onChange={(e) => setBankAccountNumber(e.target.value)}
                      placeholder="e.g. 500101012345678"
                      className="font-mono text-xs"
                    />
                  </div>
                  <div className="col-span-6">
                    <Label className="text-xs font-semibold">IFSC Code</Label>
                    <Input
                      value={bankIfsc}
                      onChange={(e) => setBankIfsc(e.target.value.toUpperCase())}
                      placeholder="e.g. CIUB0000188"
                      className="font-mono text-xs"
                      maxLength={11}
                    />
                  </div>
                </div>

                <div>
                  <Label className="text-xs font-semibold">Account Beneficiary Name</Label>
                  <Input
                    value={bankAccountName}
                    onChange={(e) => setBankAccountName(e.target.value)}
                    placeholder="e.g. SRI MEENAKSHI Enterprises"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Jurisdiction Card */}
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <Label className="text-xs font-semibold">Legal Jurisdiction</Label>
                    <Input
                      value={jurisdiction}
                      onChange={(e) => setJurisdiction(e.target.value.toUpperCase())}
                      placeholder="e.g. SALEM"
                      className="text-xs"
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground w-1/2 pt-5">
                    Rendered in bottom legal footnote: <code className="text-slate-700 bg-slate-100 px-1 py-0.5 rounded font-mono">SUBJECT TO {jurisdiction || 'SALEM'} JURISDICTION</code>
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Save / Reset Actions */}
            <div className="flex items-center justify-between pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleResetDefaults}
                className="text-xs text-slate-600"
              >
                Reset to Defaults
              </Button>
              <Button
                type="button"
                onClick={() => updateLayoutMutation.mutate()}
                disabled={updateLayoutMutation.isPending}
                className="bg-brand-700 hover:bg-brand-800 text-white font-medium"
              >
                <Save className="h-4 w-4 mr-2" />
                {updateLayoutMutation.isPending ? 'Saving Layout…' : 'Save Layout Changes'}
              </Button>
            </div>
          </div>

          {/* Right Column: Real-Time Live Preview (Sticky) */}
          <div className="col-span-12 xl:col-span-6 sticky top-4 space-y-2">
            <Card className="border-slate-300 shadow-md flex flex-col h-[calc(100vh-130px)] min-h-[600px] overflow-hidden">
              <CardHeader className="py-2.5 px-4 bg-slate-900 text-white flex flex-row items-center justify-between shrink-0">
                <div className="flex items-center gap-2.5">
                  <div className={`h-2.5 w-2.5 rounded-full ${isGeneratingPreview ? 'bg-amber-400 animate-ping' : 'bg-emerald-400'}`} />
                  <CardTitle className="text-xs font-semibold tracking-wide text-white uppercase">
                    Real-Time Invoice Preview
                  </CardTitle>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] text-slate-300">
                    {isGeneratingPreview ? 'Rendering changes…' : 'Up to date'}
                  </span>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-slate-300 hover:text-white hover:bg-slate-800"
                    onClick={() => {
                      // Trigger manual preview bump
                      setBrandName((n) => n + ' ');
                      setTimeout(() => setBrandName((n) => n.trim()), 50);
                    }}
                    title="Refresh Preview"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0 flex-1 bg-slate-200/60 relative overflow-hidden">
                {previewUrl ? (
                  <iframe
                    src={`${previewUrl}#toolbar=0&navpanes=0`}
                    className="w-full h-full border-0"
                    title="Real-Time Invoice Live Preview"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-muted-foreground p-6">
                    <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
                    <p className="text-xs font-medium">Generating real-time invoice preview…</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* ── TAB 2: SECURITY & DATABASE BACKUP ──────────────────────── */}
      {activeTab === 'security' && (
        <div className="space-y-6 max-w-4xl">
          {/* Bill Edit Protection Card */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Lock className="h-4 w-4 text-brand-600" />
                  Bill Edit &amp; Cancel Protection
                </CardTitle>
                <span
                  className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                    protectionEnabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {protectionEnabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <label className="flex items-center justify-between gap-3 text-xs cursor-pointer rounded-lg border border-slate-200 p-3 bg-slate-50/50 hover:bg-slate-50 transition-colors">
                <div>
                  <span className="font-semibold text-slate-800 block">Require Security PIN for Edits &amp; Cancels</span>
                  <span className="text-muted-foreground block text-[11px]">
                    Blocks editing or cancelling saved invoices until PIN is verified against the server.
                  </span>
                </div>
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 accent-brand-600 shrink-0 cursor-pointer"
                  checked={protectionEnabled}
                  onChange={(e) => handleToggleProtection(e.target.checked)}
                />
              </label>

              <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3 bg-white">
                <div>
                  <p className="text-xs font-semibold text-slate-800">Security PIN / Password</p>
                  <p className="text-[11px] text-muted-foreground">
                    {protectionEnabled ? 'PIN protection is active and securely gating bill changes.' : 'Protection is currently turned off.'}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-xs h-8"
                  onClick={() => {
                    setPinChangeError('');
                    setCurrentPin('');
                    setNewPin('');
                    setConfirmPin('');
                    setShowChangePinModal(true);
                  }}
                >
                  Change PIN…
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Dedicated Database Backup & Storage Card */}
          <Card className="border-brand-200/80 bg-brand-50/20 shadow-xs">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Database className="h-4 w-4 text-brand-700" />
                  Database Backup &amp; Storage
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  Default location: C: drive User Documents. Safely stores live database snapshots.
                </CardDescription>
              </div>
              <Button
                size="sm"
                onClick={() => createBackupMutation.mutate()}
                disabled={createBackupMutation.isPending}
                className="h-8 text-xs bg-brand-700 hover:bg-brand-800 text-white font-medium"
              >
                <Save className="h-3.5 w-3.5 mr-1.5" />
                {createBackupMutation.isPending ? 'Backing up…' : 'Backup Now'}
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-lg border border-brand-200 bg-white p-3 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                    <FolderCog className="h-3.5 w-3.5 text-brand-700" />
                    Active Backup Folder:
                  </span>
                  <div className="flex items-center gap-2">
                    {editingDir ? (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-[11px] px-2 text-muted-foreground"
                          onClick={() => setEditingDir(false)}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          className="h-6 text-[11px] px-2 bg-brand-700 text-white"
                          disabled={updateDirMutation.isPending}
                          onClick={() => customBackupDir.trim() && updateDirMutation.mutate(customBackupDir.trim())}
                        >
                          Save Folder
                        </Button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="text-[11px] text-brand-700 hover:underline font-medium"
                          onClick={() => setEditingDir(true)}
                        >
                          Change Location
                        </button>
                        {backupData?.isCustomBackupDir && (
                          <button
                            type="button"
                            className="text-[11px] text-slate-500 hover:text-slate-800 hover:underline"
                            onClick={() => updateDirMutation.mutate('')}
                            title="Revert to C:\Users\<User>\Documents\MM Billing Backups"
                          >
                            Use Default Documents
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {editingDir ? (
                  <div className="space-y-1">
                    <Input
                      value={customBackupDir}
                      onChange={(e) => setCustomBackupDir(e.target.value)}
                      placeholder="e.g. D:\My Backups or C:\Users\Username\Documents\MM Billing Backups"
                      className="text-xs h-8 font-mono"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Enter any valid local drive directory. Folder will be created automatically if missing.
                    </p>
                  </div>
                ) : (
                  <div className="flex items-center justify-between bg-slate-50 px-2.5 py-1.5 rounded border border-slate-200 font-mono text-[11px] text-slate-700 select-all">
                    <span>{backupData?.backupDir || 'C:\\Users\\...\\Documents\\MM Billing Backups'}</span>
                    <span className="text-[10px] uppercase font-sans font-semibold px-1.5 py-0.5 rounded bg-brand-100 text-brand-800 shrink-0 ml-2">
                      {backupData?.isCustomBackupDir ? 'Custom' : 'Default Documents'}
                    </span>
                  </div>
                )}
              </div>

              {backupData?.backups && backupData.backups.length > 0 ? (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-slate-700 flex items-center justify-between">
                    <span>Recent Snapshots</span>
                    <span className="text-[11px] font-normal text-muted-foreground">
                      Primary Snapshot: <code className="text-brand-800 font-bold">MM_Billing_Backup.db</code>
                    </span>
                  </p>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {backupData.backups.map((b: any) => (
                      <div
                        key={b.name}
                        className="flex items-center justify-between p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs"
                      >
                        <div className="flex items-center gap-2 overflow-hidden mr-2">
                          <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                          <div className="truncate">
                            <p className="font-semibold text-slate-800 truncate">{b.name}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {new Date(b.createdAt).toLocaleString('en-IN', {
                                dateStyle: 'medium',
                                timeStyle: 'short',
                              })}{' '}
                              • {(b.size / 1024).toFixed(1)} KB
                            </p>
                          </div>
                        </div>
                        <a
                          onClick={() => backupsApi.download(b.name)}
                          className="shrink-0 inline-flex items-center gap-1 text-[11px] font-medium text-brand-700 hover:text-brand-900 bg-brand-50 hover:bg-brand-100 px-2.5 py-1 rounded border border-brand-200"
                        >
                          <Download className="h-3 w-3" />
                          Save As…
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground bg-white border border-dashed rounded-lg p-3 text-center">
                  No backup created yet. Click <strong>Backup Now</strong> to generate your first safety snapshot in Documents.
                </div>
              )}
            </CardContent>
          </Card>

          {/* Theme Switcher */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Appearance</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Dark Mode</p>
                  <p className="text-xs text-muted-foreground">Toggle dark or light theme</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                >
                  {theme === 'dark' ? (
                    <>
                      <Sun className="h-4 w-4 mr-1.5" /> Light
                    </>
                  ) : (
                    <>
                      <Moon className="h-4 w-4 mr-1.5" /> Dark
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── MODALS ──────────────────────────────────────────────────── */}
      {/* Modal: Change Security PIN */}
      {showChangePinModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-[2px] flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveNewPin}
            className="bg-card text-card-foreground rounded-xl shadow-soft-lg w-full max-w-sm p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base flex items-center gap-2">
                <Lock className="h-4 w-4 text-brand-600" />
                Change Security PIN
              </h3>
              <Button type="button" variant="ghost" size="icon" onClick={() => setShowChangePinModal(false)} disabled={isChangingPin}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Enter your current PIN to verify your authority, then choose a new Security PIN.
            </p>

            <div className="space-y-3">
              <div>
                <Label className="text-xs font-semibold block mb-1">Current PIN</Label>
                <Input
                  type="password"
                  value={currentPin}
                  onChange={(e) => setCurrentPin(e.target.value)}
                  placeholder="Enter current PIN"
                  autoFocus
                  disabled={isChangingPin}
                />
              </div>
              <div>
                <Label className="text-xs font-semibold block mb-1">New PIN</Label>
                <Input
                  type="password"
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value)}
                  placeholder="Enter new PIN"
                  disabled={isChangingPin}
                />
              </div>
              <div>
                <Label className="text-xs font-semibold block mb-1">Confirm New PIN</Label>
                <Input
                  type="password"
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(e.target.value)}
                  placeholder="Re-enter new PIN"
                  disabled={isChangingPin}
                />
              </div>
            </div>

            {pinChangeError && <p className="text-xs text-destructive font-medium">{pinChangeError}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setShowChangePinModal(false)} disabled={isChangingPin}>
                Cancel
              </Button>
              <Button type="submit" disabled={isChangingPin}>
                {isChangingPin ? 'Updating…' : 'Update PIN'}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Confirm Disable Protection */}
      {showDisablePinModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-[2px] flex items-center justify-center p-4">
          <form
            onSubmit={confirmDisableProtection}
            className="bg-card text-card-foreground rounded-xl shadow-soft-lg w-full max-w-sm p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base flex items-center gap-2">
                <Lock className="h-4 w-4 text-destructive" />
                Disable Protection
              </h3>
              <Button type="button" variant="ghost" size="icon" onClick={() => setShowDisablePinModal(false)} disabled={isVerifyingDisable}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Disabling edit protection allows anyone to edit or cancel saved invoices without entering a PIN. Enter current PIN to confirm.
            </p>

            <div>
              <Label className="text-xs font-semibold block mb-1">Current Security PIN</Label>
              <Input
                type="password"
                value={disablePinInput}
                onChange={(e) => setDisablePinInput(e.target.value)}
                placeholder="Enter current PIN"
                autoFocus
                disabled={isVerifyingDisable}
              />
            </div>

            {disablePinError && <p className="text-xs text-destructive font-medium">{disablePinError}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setShowDisablePinModal(false)} disabled={isVerifyingDisable}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={isVerifyingDisable}>
                {isVerifyingDisable ? 'Verifying…' : 'Disable Protection'}
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}