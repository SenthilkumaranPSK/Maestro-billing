import { useState, useEffect, useRef, useCallback } from 'react';
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
  Sliders,
  Eye,
  FileText,
  Users,
  Grid,
  FileCheck,
  Check,
  Maximize2,
  HelpCircle,
  AlertCircle,
  FileDown,
  FileUp,
  Move,
  AlignLeft,
  AlignCenter,
  AlignRight,
  SplitSquareVertical,
  SplitSquareHorizontal,
  MousePointer,
  ArrowLeftRight,
  ArrowUpDown,
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
import { generateMmA4InvoicePDF, downloadMmA4InvoicePDF, type MmCopyType } from '@/lib/mmA4invoice';

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

type LayoutSubSection = 'geometry' | 'header' | 'seller' | 'parties' | 'table' | 'bank' | 'presets';

export default function MmSettingsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { theme, setTheme } = useTheme();

  const [mainTab, setMainTab] = useState<'layout' | 'security'>('layout');
  const [layoutSubSection, setLayoutSubSection] = useState<LayoutSubSection>('geometry');
  const [previewViewMode, setPreviewViewMode] = useState<'canvas' | 'pdf'>('canvas');

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  });

  const { data: nextMmNumber } = useQuery({
    queryKey: ['bills', 'next-number', 'MM'],
    queryFn: () => billsApi.getNextNumber('MM'),
  });

  // ── Geometry & Layout Dividers (Full Manual Control) ───────────────────────
  const [margin, setMargin] = useState(MM_DEFAULTS.margin);
  const [midX, setMidX] = useState(MM_DEFAULTS.mid_x);
  const [col2X, setCol2X] = useState(MM_DEFAULTS.col2_x);
  const [headerHeight, setHeaderHeight] = useState(MM_DEFAULTS.header_height);
  const [companyBandHeight, setCompanyBandHeight] = useState(MM_DEFAULTS.company_band_height);
  const [middleGridHeight, setMiddleGridHeight] = useState(MM_DEFAULTS.middle_grid_height);
  const [buyerHeight, setBuyerHeight] = useState(MM_DEFAULTS.buyer_height);
  const [tableHeaderHeight, setTableHeaderHeight] = useState(MM_DEFAULTS.table_header_height);

  // Column Widths
  const [colWSno, setColWSno] = useState(MM_DEFAULTS.col_width_sno);
  const [colWDesc, setColWDesc] = useState(MM_DEFAULTS.col_width_desc);
  const [colWUnit, setColWUnit] = useState(MM_DEFAULTS.col_width_unit);
  const [colWHsn, setColWHsn] = useState(MM_DEFAULTS.col_width_hsn);
  const [colWQty, setColWQty] = useState(MM_DEFAULTS.col_width_qty);
  const [colWRate, setColWRate] = useState(MM_DEFAULTS.col_width_rate);
  const [colWAmt, setColWAmt] = useState(MM_DEFAULTS.col_width_amt);

  // Alignments & Offsets
  const [logoXOffset, setLogoXOffset] = useState(0);
  const [logoYOffset, setLogoYOffset] = useState(0);
  const [logoAlign, setLogoAlign] = useState<'left' | 'center' | 'right'>('left');
  const [titleAlign, setTitleAlign] = useState<'left' | 'center' | 'right'>('right');
  const [brandAlign, setBrandAlign] = useState<'left' | 'center' | 'right'>('center');

  // ── Document & Header Content ──────────────────────────────────────────────
  const [invoiceTitle, setInvoiceTitle] = useState(MM_DEFAULTS.invoice_title);
  const [brandName, setBrandName] = useState(MM_DEFAULTS.brand_name);
  const [tagline, setTagline] = useState(MM_DEFAULTS.tagline);
  const [fssaiNo, setFssaiNo] = useState(MM_DEFAULTS.fssai_no);
  const [showHeaderLogo, setShowHeaderLogo] = useState(true);
  const [logoSize, setLogoSize] = useState<'compact' | 'standard' | 'large'>('standard');
  const [showHeaderFssai, setShowHeaderFssai] = useState(true);
  const [logoData, setLogoData] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const jsonImportRef = useRef<HTMLInputElement>(null);

  // ── Seller Identity (Marketed By) ──────────────────────────────────────────
  const [sellerBoxLabel, setSellerBoxLabel] = useState(MM_DEFAULTS.seller_box_label);
  const [companyName, setCompanyName] = useState(MM_DEFAULTS.company_name);
  const [companyAddress, setCompanyAddress] = useState(MM_DEFAULTS.address);
  const [companyGstin, setCompanyGstin] = useState(MM_DEFAULTS.gstin);
  const [contactPhone, setContactPhone] = useState(MM_DEFAULTS.contact);
  const [stateName, setStateName] = useState(MM_DEFAULTS.state_name);
  const [stateCode, setStateCode] = useState(MM_DEFAULTS.state_code);

  // ── Branch Office & Sales Point ────────────────────────────────────────────
  const [showBranchOffice, setShowBranchOffice] = useState(true);
  const [branchBoxLabel, setBranchBoxLabel] = useState(MM_DEFAULTS.branch_box_label);
  const [branchOffice, setBranchOffice] = useState(MM_DEFAULTS.branch_office);
  const [branchFssai, setBranchFssai] = useState(MM_DEFAULTS.branch_fssai);

  // ── Parties & Dispatch ─────────────────────────────────────────────────────
  const [buyerBoxLabel, setBuyerBoxLabel] = useState(MM_DEFAULTS.buyer_box_label);
  const [consigneeBoxLabel, setConsigneeBoxLabel] = useState(MM_DEFAULTS.consignee_box_label);
  const [showPartiesContact, setShowPartiesContact] = useState(true);
  const [showPlaceOfSupply, setShowPlaceOfSupply] = useState(true);
  const [showDispatchGrid, setShowDispatchGrid] = useState(true);

  // Dispatch Row Labels
  const [labelBillNo, setLabelBillNo] = useState(MM_DEFAULTS.label_bill_no);
  const [labelDate, setLabelDate] = useState(MM_DEFAULTS.label_date);
  const [labelDeliveryNote, setLabelDeliveryNote] = useState(MM_DEFAULTS.label_delivery_note);
  const [labelPaymentTerms, setLabelPaymentTerms] = useState(MM_DEFAULTS.label_payment_terms);
  const [labelBuyerOrderNo, setLabelBuyerOrderNo] = useState(MM_DEFAULTS.label_buyer_order_no);
  const [labelDispatchDoc, setLabelDispatchDoc] = useState(MM_DEFAULTS.label_dispatch_doc);
  const [labelDespatchedThrough, setLabelDespatchedThrough] = useState(MM_DEFAULTS.label_despatched_through);
  const [labelDestination, setLabelDestination] = useState(MM_DEFAULTS.label_destination);
  const [labelTermsDelivery, setLabelTermsDelivery] = useState(MM_DEFAULTS.label_terms_delivery);

  // ── Items Table & Columns ──────────────────────────────────────────────────
  const [colLabelSno, setColLabelSno] = useState(MM_DEFAULTS.col_label_sno);
  const [colLabelDesc, setColLabelDesc] = useState(MM_DEFAULTS.col_label_desc);
  const [colLabelUnit, setColLabelUnit] = useState(MM_DEFAULTS.col_label_unit);
  const [colLabelHsn, setColLabelHsn] = useState(MM_DEFAULTS.col_label_hsn);
  const [colLabelQty, setColLabelQty] = useState(MM_DEFAULTS.col_label_qty);
  const [colLabelRate, setColLabelRate] = useState(MM_DEFAULTS.col_label_rate);
  const [colLabelAmount, setColLabelAmount] = useState(MM_DEFAULTS.col_label_amount);
  const [showColUnit, setShowColUnit] = useState(true);
  const [showColHsn, setShowColHsn] = useState(true);
  const [showInlineTax, setShowInlineTax] = useState(true);

  // ── Summary & Notes ────────────────────────────────────────────────────────
  const [showTaxSummaryTable, setShowTaxSummaryTable] = useState(true);
  const [showAmountInWords, setShowAmountInWords] = useState(true);
  const [showEoe, setShowEoe] = useState(true);

  // ── Bank Details ───────────────────────────────────────────────────────────
  const [showBankDetails, setShowBankDetails] = useState(true);
  const [bankAccountName, setBankAccountName] = useState(MM_DEFAULTS.bank_account_name);
  const [bankName, setBankName] = useState(MM_DEFAULTS.bank_name);
  const [bankAccountNumber, setBankAccountNumber] = useState(MM_DEFAULTS.bank_account_number);
  const [bankBranch, setBankBranch] = useState(MM_DEFAULTS.bank_branch);
  const [bankIfsc, setBankIfsc] = useState(MM_DEFAULTS.bank_ifsc);

  // ── Declaration & Signatory ────────────────────────────────────────────────
  const [declarationTitle, setDeclarationTitle] = useState(MM_DEFAULTS.declaration_title);
  const [declarationText, setDeclarationText] = useState(MM_DEFAULTS.declaration_text);
  const [signatoryPrefix, setSignatoryPrefix] = useState(MM_DEFAULTS.signatory_prefix);
  const [signatoryLabel, setSignatoryLabel] = useState(MM_DEFAULTS.signatory_label);
  const [showLegalFootnote, setShowLegalFootnote] = useState(true);
  const [jurisdiction, setJurisdiction] = useState(MM_DEFAULTS.jurisdiction);
  const [footerComputerGeneratedText, setFooterComputerGeneratedText] = useState(MM_DEFAULTS.footer_computer_generated_text);

  // ── Real-Time Preview State ────────────────────────────────────────────────
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
  const [previewCopyType, setPreviewCopyType] = useState<MmCopyType>('ORIGINAL');

  // Load existing settings on mount / update
  useEffect(() => {
    const mm = settings?.mm;
    if (!mm) return;

    if (mm.mm_margin !== undefined) setMargin(parseFloat(mm.mm_margin) || MM_DEFAULTS.margin);
    if (mm.mm_mid_x !== undefined) setMidX(parseFloat(mm.mm_mid_x) || MM_DEFAULTS.mid_x);
    if (mm.mm_col2_x !== undefined) setCol2X(parseFloat(mm.mm_col2_x) || MM_DEFAULTS.col2_x);
    if (mm.mm_header_height !== undefined) setHeaderHeight(parseFloat(mm.mm_header_height) || MM_DEFAULTS.header_height);
    if (mm.mm_company_band_height !== undefined) setCompanyBandHeight(parseFloat(mm.mm_company_band_height) || MM_DEFAULTS.company_band_height);
    if (mm.mm_middle_grid_height !== undefined) setMiddleGridHeight(parseFloat(mm.mm_middle_grid_height) || MM_DEFAULTS.middle_grid_height);
    if (mm.mm_buyer_height !== undefined) setBuyerHeight(parseFloat(mm.mm_buyer_height) || MM_DEFAULTS.buyer_height);
    if (mm.mm_table_header_height !== undefined) setTableHeaderHeight(parseFloat(mm.mm_table_header_height) || MM_DEFAULTS.table_header_height);

    if (mm.mm_col_width_sno !== undefined) setColWSno(parseFloat(mm.mm_col_width_sno) || MM_DEFAULTS.col_width_sno);
    if (mm.mm_col_width_desc !== undefined) setColWDesc(parseFloat(mm.mm_col_width_desc) || MM_DEFAULTS.col_width_desc);
    if (mm.mm_col_width_unit !== undefined) setColWUnit(parseFloat(mm.mm_col_width_unit) || MM_DEFAULTS.col_width_unit);
    if (mm.mm_col_width_hsn !== undefined) setColWHsn(parseFloat(mm.mm_col_width_hsn) || MM_DEFAULTS.col_width_hsn);
    if (mm.mm_col_width_qty !== undefined) setColWQty(parseFloat(mm.mm_col_width_qty) || MM_DEFAULTS.col_width_qty);
    if (mm.mm_col_width_rate !== undefined) setColWRate(parseFloat(mm.mm_col_width_rate) || MM_DEFAULTS.col_width_rate);
    if (mm.mm_col_width_amt !== undefined) setColWAmt(parseFloat(mm.mm_col_width_amt) || MM_DEFAULTS.col_width_amt);

    if (mm.mm_logo_x_offset !== undefined) setLogoXOffset(parseFloat(mm.mm_logo_x_offset) || 0);
    if (mm.mm_logo_y_offset !== undefined) setLogoYOffset(parseFloat(mm.mm_logo_y_offset) || 0);
    if (mm.mm_logo_align !== undefined) setLogoAlign((mm.mm_logo_align as any) || 'left');
    if (mm.mm_title_align !== undefined) setTitleAlign((mm.mm_title_align as any) || 'right');
    if (mm.mm_brand_align !== undefined) setBrandAlign((mm.mm_brand_align as any) || 'center');

    if (mm.mm_invoice_title !== undefined) setInvoiceTitle(mm.mm_invoice_title);
    if (mm.mm_brand_name !== undefined) setBrandName(mm.mm_brand_name);
    if (mm.mm_tagline !== undefined) setTagline(mm.mm_tagline);
    if (mm.mm_fssai_no !== undefined) setFssaiNo(mm.mm_fssai_no);
    if (mm.mm_show_header_logo !== undefined) setShowHeaderLogo(mm.mm_show_header_logo !== 'false');
    if (mm.mm_logo_size !== undefined) setLogoSize((mm.mm_logo_size as any) || 'standard');
    if (mm.mm_show_header_fssai !== undefined) setShowHeaderFssai(mm.mm_show_header_fssai !== 'false');
    if (mm.mm_logo_data !== undefined) setLogoData(mm.mm_logo_data || null);

    if (mm.mm_seller_box_label !== undefined) setSellerBoxLabel(mm.mm_seller_box_label);
    if (mm.mm_company_name !== undefined) setCompanyName(mm.mm_company_name);
    if (mm.mm_address !== undefined) setCompanyAddress(mm.mm_address);
    if (mm.mm_gstin !== undefined) setCompanyGstin(mm.mm_gstin);
    if (mm.mm_contact !== undefined) setContactPhone(mm.mm_contact);
    if (mm.mm_state_name !== undefined) setStateName(mm.mm_state_name);
    if (mm.mm_state_code !== undefined) setStateCode(mm.mm_state_code);

    if (mm.mm_show_branch_office !== undefined) setShowBranchOffice(mm.mm_show_branch_office !== 'false');
    if (mm.mm_branch_box_label !== undefined) setBranchBoxLabel(mm.mm_branch_box_label);
    if (mm.mm_branch_office !== undefined) setBranchOffice(mm.mm_branch_office);
    if (mm.mm_branch_fssai !== undefined) setBranchFssai(mm.mm_branch_fssai);

    if (mm.mm_buyer_box_label !== undefined) setBuyerBoxLabel(mm.mm_buyer_box_label);
    if (mm.mm_consignee_box_label !== undefined) setConsigneeBoxLabel(mm.mm_consignee_box_label);
    if (mm.mm_show_parties_contact !== undefined) setShowPartiesContact(mm.mm_show_parties_contact !== 'false');
    if (mm.mm_show_place_of_supply !== undefined) setShowPlaceOfSupply(mm.mm_show_place_of_supply !== 'false');
    if (mm.mm_show_dispatch_grid !== undefined) setShowDispatchGrid(mm.mm_show_dispatch_grid !== 'false');

    if (mm.mm_label_bill_no !== undefined) setLabelBillNo(mm.mm_label_bill_no);
    if (mm.mm_label_date !== undefined) setLabelDate(mm.mm_label_date);
    if (mm.mm_label_delivery_note !== undefined) setLabelDeliveryNote(mm.mm_label_delivery_note);
    if (mm.mm_label_payment_terms !== undefined) setLabelPaymentTerms(mm.mm_label_payment_terms);
    if (mm.mm_label_buyer_order_no !== undefined) setLabelBuyerOrderNo(mm.mm_label_buyer_order_no);
    if (mm.mm_label_dispatch_doc !== undefined) setLabelDispatchDoc(mm.mm_label_dispatch_doc);
    if (mm.mm_label_despatched_through !== undefined) setLabelDespatchedThrough(mm.mm_label_despatched_through);
    if (mm.mm_label_destination !== undefined) setLabelDestination(mm.mm_label_destination);
    if (mm.mm_label_terms_delivery !== undefined) setLabelTermsDelivery(mm.mm_label_terms_delivery);

    if (mm.mm_col_label_sno !== undefined) setColLabelSno(mm.mm_col_label_sno);
    if (mm.mm_col_label_desc !== undefined) setColLabelDesc(mm.mm_col_label_desc);
    if (mm.mm_col_label_unit !== undefined) setColLabelUnit(mm.mm_col_label_unit);
    if (mm.mm_col_label_hsn !== undefined) setColLabelHsn(mm.mm_col_label_hsn);
    if (mm.mm_col_label_qty !== undefined) setColLabelQty(mm.mm_col_label_qty);
    if (mm.mm_col_label_rate !== undefined) setColLabelRate(mm.mm_col_label_rate);
    if (mm.mm_col_label_amount !== undefined) setColLabelAmount(mm.mm_col_label_amount);
    if (mm.mm_show_col_unit !== undefined) setShowColUnit(mm.mm_show_col_unit !== 'false');
    if (mm.mm_show_col_hsn !== undefined) setShowColHsn(mm.mm_show_col_hsn !== 'false');
    if (mm.mm_show_inline_tax !== undefined) setShowInlineTax(mm.mm_show_inline_tax !== 'false');

    if (mm.mm_show_tax_summary_table !== undefined) setShowTaxSummaryTable(mm.mm_show_tax_summary_table !== 'false');
    if (mm.mm_show_amount_in_words !== undefined) setShowAmountInWords(mm.mm_show_amount_in_words !== 'false');
    if (mm.mm_show_eoe !== undefined) setShowEoe(mm.mm_show_eoe !== 'false');

    if (mm.mm_show_bank_details !== undefined) setShowBankDetails(mm.mm_show_bank_details !== 'false');
    if (mm.mm_bank_account_name !== undefined) setBankAccountName(mm.mm_bank_account_name);
    if (mm.mm_bank_name !== undefined) setBankName(mm.mm_bank_name);
    if (mm.mm_bank_account_number !== undefined) setBankAccountNumber(mm.mm_bank_account_number);
    if (mm.mm_bank_branch !== undefined) setBankBranch(mm.mm_bank_branch);
    if (mm.mm_bank_ifsc !== undefined) setBankIfsc(mm.mm_bank_ifsc);

    if (mm.mm_declaration_title !== undefined) setDeclarationTitle(mm.mm_declaration_title);
    if (mm.mm_declaration_text !== undefined) setDeclarationText(mm.mm_declaration_text);
    if (mm.mm_signatory_prefix !== undefined) setSignatoryPrefix(mm.mm_signatory_prefix);
    if (mm.mm_signatory_label !== undefined) setSignatoryLabel(mm.mm_signatory_label);
    if (mm.mm_show_legal_footnote !== undefined) setShowLegalFootnote(mm.mm_show_legal_footnote !== 'false');
    if (mm.mm_jurisdiction !== undefined) setJurisdiction(mm.mm_jurisdiction);
    if (mm.mm_footer_computer_generated_text !== undefined) setFooterComputerGeneratedText(mm.mm_footer_computer_generated_text);
  }, [settings?.mm]);

  // Construct current live settings object
  const currentLiveSettings: Partial<Settings> = {
    ...settings,
    mm: {
      ...settings?.mm,
      mm_margin: String(margin),
      mm_mid_x: String(midX),
      mm_col2_x: String(col2X),
      mm_header_height: String(headerHeight),
      mm_company_band_height: String(companyBandHeight),
      mm_middle_grid_height: String(middleGridHeight),
      mm_buyer_height: String(buyerHeight),
      mm_table_header_height: String(tableHeaderHeight),

      mm_col_width_sno: String(colWSno),
      mm_col_width_desc: String(colWDesc),
      mm_col_width_unit: String(colWUnit),
      mm_col_width_hsn: String(colWHsn),
      mm_col_width_qty: String(colWQty),
      mm_col_width_rate: String(colWRate),
      mm_col_width_amt: String(colWAmt),

      mm_logo_x_offset: String(logoXOffset),
      mm_logo_y_offset: String(logoYOffset),
      mm_logo_align: logoAlign,
      mm_title_align: titleAlign,
      mm_brand_align: brandAlign,

      mm_invoice_title: invoiceTitle,
      mm_brand_name: brandName,
      mm_tagline: tagline,
      mm_fssai_no: fssaiNo,
      mm_show_header_logo: showHeaderLogo ? 'true' : 'false',
      mm_logo_size: logoSize,
      mm_show_header_fssai: showHeaderFssai ? 'true' : 'false',
      mm_logo_data: logoData || undefined,

      mm_seller_box_label: sellerBoxLabel,
      mm_company_name: companyName,
      mm_address: companyAddress,
      mm_gstin: companyGstin,
      mm_contact: contactPhone,
      mm_state_name: stateName,
      mm_state_code: stateCode,

      mm_show_branch_office: showBranchOffice ? 'true' : 'false',
      mm_branch_box_label: branchBoxLabel,
      mm_branch_office: branchOffice,
      mm_branch_fssai: branchFssai,

      mm_buyer_box_label: buyerBoxLabel,
      mm_consignee_box_label: consigneeBoxLabel,
      mm_show_parties_contact: showPartiesContact ? 'true' : 'false',
      mm_show_place_of_supply: showPlaceOfSupply ? 'true' : 'false',
      mm_show_dispatch_grid: showDispatchGrid ? 'true' : 'false',

      mm_label_bill_no: labelBillNo,
      mm_label_date: labelDate,
      mm_label_delivery_note: labelDeliveryNote,
      mm_label_payment_terms: labelPaymentTerms,
      mm_label_buyer_order_no: labelBuyerOrderNo,
      mm_label_dispatch_doc: labelDispatchDoc,
      mm_label_despatched_through: labelDespatchedThrough,
      mm_label_destination: labelDestination,
      mm_label_terms_delivery: labelTermsDelivery,

      mm_col_label_sno: colLabelSno,
      mm_col_label_desc: colLabelDesc,
      mm_col_label_unit: colLabelUnit,
      mm_col_label_hsn: colLabelHsn,
      mm_col_label_qty: colLabelQty,
      mm_col_label_rate: colLabelRate,
      mm_col_label_amount: colLabelAmount,
      mm_show_col_unit: showColUnit ? 'true' : 'false',
      mm_show_col_hsn: showColHsn ? 'true' : 'false',
      mm_show_inline_tax: showInlineTax ? 'true' : 'false',

      mm_show_tax_summary_table: showTaxSummaryTable ? 'true' : 'false',
      mm_show_amount_in_words: showAmountInWords ? 'true' : 'false',
      mm_show_eoe: showEoe ? 'true' : 'false',

      mm_show_bank_details: showBankDetails ? 'true' : 'false',
      mm_bank_account_name: bankAccountName,
      mm_bank_name: bankName,
      mm_bank_account_number: bankAccountNumber,
      mm_bank_branch: bankBranch,
      mm_bank_ifsc: bankIfsc,

      mm_declaration_title: declarationTitle,
      mm_declaration_text: declarationText,
      mm_signatory_prefix: signatoryPrefix,
      mm_signatory_label: signatoryLabel,
      mm_show_legal_footnote: showLegalFootnote ? 'true' : 'false',
      mm_jurisdiction: jurisdiction,
      mm_footer_computer_generated_text: footerComputerGeneratedText,
    },
  };

  // Real-time live invoice preview generation
  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      setIsGeneratingPreview(true);
      try {
        const currentBill = {
          ...samplePreviewBill,
          billNumber: nextMmNumber || samplePreviewBill.billNumber,
        };

        const bytes = await generateMmA4InvoicePDF(currentBill, currentLiveSettings, {
          copyType: previewCopyType,
        });

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
    }, 250);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [
    margin,
    midX,
    col2X,
    headerHeight,
    companyBandHeight,
    middleGridHeight,
    buyerHeight,
    tableHeaderHeight,
    colWSno,
    colWDesc,
    colWUnit,
    colWHsn,
    colWQty,
    colWRate,
    colWAmt,
    logoXOffset,
    logoYOffset,
    logoAlign,
    titleAlign,
    brandAlign,
    invoiceTitle,
    brandName,
    tagline,
    fssaiNo,
    showHeaderLogo,
    logoSize,
    showHeaderFssai,
    logoData,
    sellerBoxLabel,
    companyName,
    companyAddress,
    companyGstin,
    contactPhone,
    stateName,
    stateCode,
    showBranchOffice,
    branchBoxLabel,
    branchOffice,
    branchFssai,
    buyerBoxLabel,
    consigneeBoxLabel,
    showPartiesContact,
    showPlaceOfSupply,
    showDispatchGrid,
    labelBillNo,
    labelDate,
    labelDeliveryNote,
    labelPaymentTerms,
    labelBuyerOrderNo,
    labelDispatchDoc,
    labelDespatchedThrough,
    labelDestination,
    labelTermsDelivery,
    colLabelSno,
    colLabelDesc,
    colLabelUnit,
    colLabelHsn,
    colLabelQty,
    colLabelRate,
    colLabelAmount,
    showColUnit,
    showColHsn,
    showInlineTax,
    showTaxSummaryTable,
    showAmountInWords,
    showEoe,
    showBankDetails,
    bankAccountName,
    bankName,
    bankAccountNumber,
    bankBranch,
    bankIfsc,
    declarationTitle,
    declarationText,
    signatoryPrefix,
    signatoryLabel,
    showLegalFootnote,
    jurisdiction,
    footerComputerGeneratedText,
    previewCopyType,
    nextMmNumber,
  ]);

  // ── Manual Mouse Drag & Movement Engine ────────────────────────────────────
  const canvasRef = useRef<HTMLDivElement>(null);
  const [activeDrag, setActiveDrag] = useState<{
    type: 'midX' | 'col2X' | 'headerH' | 'bandH' | 'buyerH' | 'logo' | 'col_desc';
    startX: number;
    startY: number;
    origVal: number;
    origVal2?: number;
  } | null>(null);

  const handleMouseDownOnHandle = (
    e: React.MouseEvent,
    type: 'midX' | 'col2X' | 'headerH' | 'bandH' | 'buyerH' | 'logo' | 'col_desc',
    origVal: number,
    origVal2?: number
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setActiveDrag({
      type,
      startX: e.clientX,
      startY: e.clientY,
      origVal,
      origVal2,
    });
  };

  useEffect(() => {
    if (!activeDrag) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - activeDrag.startX;
      const deltaY = e.clientY - activeDrag.startY;

      const canvasEl = canvasRef.current;
      const canvasWidth = canvasEl ? canvasEl.clientWidth : 500;
      const ptScale = 595.28 / canvasWidth;

      if (activeDrag.type === 'midX') {
        const next = Math.max(180, Math.min(480, Math.round(activeDrag.origVal + deltaX * ptScale)));
        setMidX(next);
      } else if (activeDrag.type === 'col2X') {
        const next = Math.max(midX + 40, Math.min(540, Math.round(activeDrag.origVal + deltaX * ptScale)));
        setCol2X(next);
      } else if (activeDrag.type === 'headerH') {
        const next = Math.max(45, Math.min(130, Math.round(activeDrag.origVal + deltaY * ptScale)));
        setHeaderHeight(next);
      } else if (activeDrag.type === 'bandH') {
        const next = Math.max(50, Math.min(150, Math.round(activeDrag.origVal + deltaY * ptScale)));
        setCompanyBandHeight(next);
      } else if (activeDrag.type === 'buyerH') {
        const next = Math.max(40, Math.min(120, Math.round(activeDrag.origVal + deltaY * ptScale)));
        setBuyerHeight(next);
      } else if (activeDrag.type === 'logo') {
        const nextX = Math.round((activeDrag.origVal || 0) + deltaX * ptScale);
        const nextY = Math.round((activeDrag.origVal2 || 0) - deltaY * ptScale);
        setLogoXOffset(nextX);
        setLogoYOffset(nextY);
      } else if (activeDrag.type === 'col_desc') {
        const next = Math.max(100, Math.min(280, Math.round(activeDrag.origVal + deltaX * ptScale)));
        setColWDesc(next);
      }
    };

    const handleMouseUp = () => {
      setActiveDrag(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [activeDrag, midX]);

  // Logo upload handler
  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: 'Image too large', description: 'Logo size must be under 2MB', variant: 'destructive' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setLogoData(result);
      toast({ title: 'Logo uploaded', description: 'Real-time preview updated with your logo.', variant: 'success' });
    };
    reader.readAsDataURL(file);
  };

  const handleResetLogo = () => {
    setLogoData(null);
    if (logoInputRef.current) logoInputRef.current.value = '';
    toast({ title: 'Default logo restored', variant: 'default' });
  };

  // ── Save All Layout Changes Mutation ───────────────────────────────────────
  const updateLayoutMutation = useMutation({
    mutationFn: () => {
      const payload: Array<{ key: string; value: string; group?: string }> = [
        { key: 'mm_margin', value: String(margin), group: 'mm' },
        { key: 'mm_mid_x', value: String(midX), group: 'mm' },
        { key: 'mm_col2_x', value: String(col2X), group: 'mm' },
        { key: 'mm_header_height', value: String(headerHeight), group: 'mm' },
        { key: 'mm_company_band_height', value: String(companyBandHeight), group: 'mm' },
        { key: 'mm_middle_grid_height', value: String(middleGridHeight), group: 'mm' },
        { key: 'mm_buyer_height', value: String(buyerHeight), group: 'mm' },
        { key: 'mm_table_header_height', value: String(tableHeaderHeight), group: 'mm' },

        { key: 'mm_col_width_sno', value: String(colWSno), group: 'mm' },
        { key: 'mm_col_width_desc', value: String(colWDesc), group: 'mm' },
        { key: 'mm_col_width_unit', value: String(colWUnit), group: 'mm' },
        { key: 'mm_col_width_hsn', value: String(colWHsn), group: 'mm' },
        { key: 'mm_col_width_qty', value: String(colWQty), group: 'mm' },
        { key: 'mm_col_width_rate', value: String(colWRate), group: 'mm' },
        { key: 'mm_col_width_amt', value: String(colWAmt), group: 'mm' },

        { key: 'mm_logo_x_offset', value: String(logoXOffset), group: 'mm' },
        { key: 'mm_logo_y_offset', value: String(logoYOffset), group: 'mm' },
        { key: 'mm_logo_align', value: logoAlign, group: 'mm' },
        { key: 'mm_title_align', value: titleAlign, group: 'mm' },
        { key: 'mm_brand_align', value: brandAlign, group: 'mm' },

        { key: 'mm_invoice_title', value: invoiceTitle.trim(), group: 'mm' },
        { key: 'mm_brand_name', value: brandName.trim(), group: 'mm' },
        { key: 'mm_tagline', value: tagline.trim(), group: 'mm' },
        { key: 'mm_fssai_no', value: fssaiNo.trim(), group: 'mm' },
        { key: 'mm_show_header_logo', value: showHeaderLogo ? 'true' : 'false', group: 'mm' },
        { key: 'mm_logo_size', value: logoSize, group: 'mm' },
        { key: 'mm_show_header_fssai', value: showHeaderFssai ? 'true' : 'false', group: 'mm' },
        { key: 'mm_logo_data', value: logoData || '', group: 'mm' },

        { key: 'mm_seller_box_label', value: sellerBoxLabel.trim(), group: 'mm' },
        { key: 'mm_company_name', value: companyName.trim(), group: 'mm' },
        { key: 'mm_address', value: companyAddress.trim(), group: 'mm' },
        { key: 'mm_gstin', value: companyGstin.trim(), group: 'mm' },
        { key: 'mm_contact', value: contactPhone.trim(), group: 'mm' },
        { key: 'mm_state_name', value: stateName.trim(), group: 'mm' },
        { key: 'mm_state_code', value: stateCode.trim(), group: 'mm' },

        { key: 'mm_show_branch_office', value: showBranchOffice ? 'true' : 'false', group: 'mm' },
        { key: 'mm_branch_box_label', value: branchBoxLabel.trim(), group: 'mm' },
        { key: 'mm_branch_office', value: branchOffice.trim(), group: 'mm' },
        { key: 'mm_branch_fssai', value: branchFssai.trim(), group: 'mm' },

        { key: 'mm_buyer_box_label', value: buyerBoxLabel.trim(), group: 'mm' },
        { key: 'mm_consignee_box_label', value: consigneeBoxLabel.trim(), group: 'mm' },
        { key: 'mm_show_parties_contact', value: showPartiesContact ? 'true' : 'false', group: 'mm' },
        { key: 'mm_show_place_of_supply', value: showPlaceOfSupply ? 'true' : 'false', group: 'mm' },
        { key: 'mm_show_dispatch_grid', value: showDispatchGrid ? 'true' : 'false', group: 'mm' },

        { key: 'mm_label_bill_no', value: labelBillNo.trim(), group: 'mm' },
        { key: 'mm_label_date', value: labelDate.trim(), group: 'mm' },
        { key: 'mm_label_delivery_note', value: labelDeliveryNote.trim(), group: 'mm' },
        { key: 'mm_label_payment_terms', value: labelPaymentTerms.trim(), group: 'mm' },
        { key: 'mm_label_buyer_order_no', value: labelBuyerOrderNo.trim(), group: 'mm' },
        { key: 'mm_label_dispatch_doc', value: labelDispatchDoc.trim(), group: 'mm' },
        { key: 'mm_label_despatched_through', value: labelDespatchedThrough.trim(), group: 'mm' },
        { key: 'mm_label_destination', value: labelDestination.trim(), group: 'mm' },
        { key: 'mm_label_terms_delivery', value: labelTermsDelivery.trim(), group: 'mm' },

        { key: 'mm_col_label_sno', value: colLabelSno.trim(), group: 'mm' },
        { key: 'mm_col_label_desc', value: colLabelDesc.trim(), group: 'mm' },
        { key: 'mm_col_label_unit', value: colLabelUnit.trim(), group: 'mm' },
        { key: 'mm_col_label_hsn', value: colLabelHsn.trim(), group: 'mm' },
        { key: 'mm_col_label_qty', value: colLabelQty.trim(), group: 'mm' },
        { key: 'mm_col_label_rate', value: colLabelRate.trim(), group: 'mm' },
        { key: 'mm_col_label_amount', value: colLabelAmount.trim(), group: 'mm' },
        { key: 'mm_show_col_unit', value: showColUnit ? 'true' : 'false', group: 'mm' },
        { key: 'mm_show_col_hsn', value: showColHsn ? 'true' : 'false', group: 'mm' },
        { key: 'mm_show_inline_tax', value: showInlineTax ? 'true' : 'false', group: 'mm' },

        { key: 'mm_show_tax_summary_table', value: showTaxSummaryTable ? 'true' : 'false', group: 'mm' },
        { key: 'mm_show_amount_in_words', value: showAmountInWords ? 'true' : 'false', group: 'mm' },
        { key: 'mm_show_eoe', value: showEoe ? 'true' : 'false', group: 'mm' },

        { key: 'mm_show_bank_details', value: showBankDetails ? 'true' : 'false', group: 'mm' },
        { key: 'mm_bank_account_name', value: bankAccountName.trim(), group: 'mm' },
        { key: 'mm_bank_name', value: bankName.trim(), group: 'mm' },
        { key: 'mm_bank_account_number', value: bankAccountNumber.trim(), group: 'mm' },
        { key: 'mm_bank_branch', value: bankBranch.trim(), group: 'mm' },
        { key: 'mm_bank_ifsc', value: bankIfsc.trim(), group: 'mm' },

        { key: 'mm_declaration_title', value: declarationTitle.trim(), group: 'mm' },
        { key: 'mm_declaration_text', value: declarationText.trim(), group: 'mm' },
        { key: 'mm_signatory_prefix', value: signatoryPrefix.trim(), group: 'mm' },
        { key: 'mm_signatory_label', value: signatoryLabel.trim(), group: 'mm' },
        { key: 'mm_show_legal_footnote', value: showLegalFootnote ? 'true' : 'false', group: 'mm' },
        { key: 'mm_jurisdiction', value: jurisdiction.trim(), group: 'mm' },
        { key: 'mm_footer_computer_generated_text', value: footerComputerGeneratedText.trim(), group: 'mm' },
      ];
      return settingsApi.bulkUpdate(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      toast({
        title: 'Full Layout Saved in Database!',
        description: 'All geometry, line positions, alignments, and text labels are saved and backed up.',
        variant: 'success',
      });
    },
    onError: (err: Error) => {
      toast({ title: 'Save failed', description: err.message, variant: 'destructive' });
    },
  });

  // Export Layout Configuration as JSON
  const handleExportLayoutJson = () => {
    const layoutConfig = {
      version: '2.0',
      exportedAt: new Date().toISOString(),
      geometry: {
        margin,
        midX,
        col2X,
        headerHeight,
        companyBandHeight,
        middleGridHeight,
        buyerHeight,
        tableHeaderHeight,
        colWSno,
        colWDesc,
        colWUnit,
        colWHsn,
        colWQty,
        colWRate,
        colWAmt,
        logoXOffset,
        logoYOffset,
        logoAlign,
        titleAlign,
        brandAlign,
      },
      content: {
        invoiceTitle,
        brandName,
        tagline,
        fssaiNo,
        showHeaderLogo,
        logoSize,
        showHeaderFssai,
        logoData,
        sellerBoxLabel,
        companyName,
        companyAddress,
        companyGstin,
        contactPhone,
        stateName,
        stateCode,
        showBranchOffice,
        branchBoxLabel,
        branchOffice,
        branchFssai,
        buyerBoxLabel,
        consigneeBoxLabel,
        showPartiesContact,
        showPlaceOfSupply,
        showDispatchGrid,
        labelBillNo,
        labelDate,
        labelDeliveryNote,
        labelPaymentTerms,
        labelBuyerOrderNo,
        labelDispatchDoc,
        labelDespatchedThrough,
        labelDestination,
        labelTermsDelivery,
        colLabelSno,
        colLabelDesc,
        colLabelUnit,
        colLabelHsn,
        colLabelQty,
        colLabelRate,
        colLabelAmount,
        showColUnit,
        showColHsn,
        showInlineTax,
        showTaxSummaryTable,
        showAmountInWords,
        showEoe,
        showBankDetails,
        bankAccountName,
        bankName,
        bankAccountNumber,
        bankBranch,
        bankIfsc,
        declarationTitle,
        declarationText,
        signatoryPrefix,
        signatoryLabel,
        showLegalFootnote,
        jurisdiction,
        footerComputerGeneratedText,
      },
    };

    const blob = new Blob([JSON.stringify(layoutConfig, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mm-layout-config-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: 'Layout exported as JSON', description: 'Standalone layout file downloaded safely.', variant: 'success' });
  };

  // Import Layout Configuration from JSON
  const handleImportLayoutJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string);
        const g = parsed.geometry || {};
        const c = parsed.content || parsed.layout || parsed;

        if (g.margin !== undefined) setMargin(g.margin);
        if (g.midX !== undefined) setMidX(g.midX);
        if (g.col2X !== undefined) setCol2X(g.col2X);
        if (g.headerHeight !== undefined) setHeaderHeight(g.headerHeight);
        if (g.companyBandHeight !== undefined) setCompanyBandHeight(g.companyBandHeight);
        if (g.middleGridHeight !== undefined) setMiddleGridHeight(g.middleGridHeight);
        if (g.buyerHeight !== undefined) setBuyerHeight(g.buyerHeight);
        if (g.tableHeaderHeight !== undefined) setTableHeaderHeight(g.tableHeaderHeight);

        if (g.colWSno !== undefined) setColWSno(g.colWSno);
        if (g.colWDesc !== undefined) setColWDesc(g.colWDesc);
        if (g.colWUnit !== undefined) setColWUnit(g.colWUnit);
        if (g.colWHsn !== undefined) setColWHsn(g.colWHsn);
        if (g.colWQty !== undefined) setColWQty(g.colWQty);
        if (g.colWRate !== undefined) setColWRate(g.colWRate);
        if (g.colWAmt !== undefined) setColWAmt(g.colWAmt);

        if (g.logoXOffset !== undefined) setLogoXOffset(g.logoXOffset);
        if (g.logoYOffset !== undefined) setLogoYOffset(g.logoYOffset);
        if (g.logoAlign !== undefined) setLogoAlign(g.logoAlign);
        if (g.titleAlign !== undefined) setTitleAlign(g.titleAlign);
        if (g.brandAlign !== undefined) setBrandAlign(g.brandAlign);

        if (c.invoiceTitle !== undefined) setInvoiceTitle(c.invoiceTitle);
        if (c.brandName !== undefined) setBrandName(c.brandName);
        if (c.tagline !== undefined) setTagline(c.tagline);
        if (c.fssaiNo !== undefined) setFssaiNo(c.fssaiNo);
        if (c.showHeaderLogo !== undefined) setShowHeaderLogo(Boolean(c.showHeaderLogo));
        if (c.logoSize !== undefined) setLogoSize(c.logoSize);
        if (c.showHeaderFssai !== undefined) setShowHeaderFssai(Boolean(c.showHeaderFssai));
        if (c.logoData !== undefined) setLogoData(c.logoData || null);

        if (c.sellerBoxLabel !== undefined) setSellerBoxLabel(c.sellerBoxLabel);
        if (c.companyName !== undefined) setCompanyName(c.companyName);
        if (c.companyAddress !== undefined) setCompanyAddress(c.companyAddress);
        if (c.companyGstin !== undefined) setCompanyGstin(c.companyGstin);
        if (c.contactPhone !== undefined) setContactPhone(c.contactPhone);
        if (c.stateName !== undefined) setStateName(c.stateName);
        if (c.stateCode !== undefined) setStateCode(c.stateCode);

        if (c.showBranchOffice !== undefined) setShowBranchOffice(Boolean(c.showBranchOffice));
        if (c.branchBoxLabel !== undefined) setBranchBoxLabel(c.branchBoxLabel);
        if (c.branchOffice !== undefined) setBranchOffice(c.branchOffice);
        if (c.branchFssai !== undefined) setBranchFssai(c.branchFssai);

        if (c.buyerBoxLabel !== undefined) setBuyerBoxLabel(c.buyerBoxLabel);
        if (c.consigneeBoxLabel !== undefined) setConsigneeBoxLabel(c.consigneeBoxLabel);
        if (c.showPartiesContact !== undefined) setShowPartiesContact(Boolean(c.showPartiesContact));
        if (c.showPlaceOfSupply !== undefined) setShowPlaceOfSupply(Boolean(c.showPlaceOfSupply));
        if (c.showDispatchGrid !== undefined) setShowDispatchGrid(Boolean(c.showDispatchGrid));

        if (c.colLabelSno !== undefined) setColLabelSno(c.colLabelSno);
        if (c.colLabelDesc !== undefined) setColLabelDesc(c.colLabelDesc);
        if (c.colLabelUnit !== undefined) setColLabelUnit(c.colLabelUnit);
        if (c.colLabelHsn !== undefined) setColLabelHsn(c.colLabelHsn);
        if (c.colLabelQty !== undefined) setColLabelQty(c.colLabelQty);
        if (c.colLabelRate !== undefined) setColLabelRate(c.colLabelRate);
        if (c.colLabelAmount !== undefined) setColLabelAmount(c.colLabelAmount);
        if (c.showColUnit !== undefined) setShowColUnit(Boolean(c.showColUnit));
        if (c.showColHsn !== undefined) setShowColHsn(Boolean(c.showColHsn));
        if (c.showInlineTax !== undefined) setShowInlineTax(Boolean(c.showInlineTax));

        if (c.showTaxSummaryTable !== undefined) setShowTaxSummaryTable(Boolean(c.showTaxSummaryTable));
        if (c.showAmountInWords !== undefined) setShowAmountInWords(Boolean(c.showAmountInWords));
        if (c.showEoe !== undefined) setShowEoe(Boolean(c.showEoe));

        if (c.showBankDetails !== undefined) setShowBankDetails(Boolean(c.showBankDetails));
        if (c.bankAccountName !== undefined) setBankAccountName(c.bankAccountName);
        if (c.bankName !== undefined) setBankName(c.bankName);
        if (c.bankAccountNumber !== undefined) setBankAccountNumber(c.bankAccountNumber);
        if (c.bankBranch !== undefined) setBankBranch(c.bankBranch);
        if (c.bankIfsc !== undefined) setBankIfsc(c.bankIfsc);

        if (c.declarationTitle !== undefined) setDeclarationTitle(c.declarationTitle);
        if (c.declarationText !== undefined) setDeclarationText(c.declarationText);
        if (c.signatoryPrefix !== undefined) setSignatoryPrefix(c.signatoryPrefix);
        if (c.signatoryLabel !== undefined) setSignatoryLabel(c.signatoryLabel);
        if (c.showLegalFootnote !== undefined) setShowLegalFootnote(Boolean(c.showLegalFootnote));
        if (c.jurisdiction !== undefined) setJurisdiction(c.jurisdiction);
        if (c.footerComputerGeneratedText !== undefined) setFooterComputerGeneratedText(c.footerComputerGeneratedText);

        toast({ title: 'Full layout imported!', description: 'Review the interactive canvas and save.', variant: 'success' });
      } catch (err: any) {
        toast({ title: 'Failed to import JSON', description: err.message, variant: 'destructive' });
      }
    };
    reader.readAsText(file);
  };

  const handleResetDefaults = () => {
    if (!confirm('Reset all geometry, lines, and layout settings to original defaults?')) return;
    setMargin(MM_DEFAULTS.margin);
    setMidX(MM_DEFAULTS.mid_x);
    setCol2X(MM_DEFAULTS.col2_x);
    setHeaderHeight(MM_DEFAULTS.header_height);
    setCompanyBandHeight(MM_DEFAULTS.company_band_height);
    setMiddleGridHeight(MM_DEFAULTS.middle_grid_height);
    setBuyerHeight(MM_DEFAULTS.buyer_height);
    setTableHeaderHeight(MM_DEFAULTS.table_header_height);

    setColWSno(MM_DEFAULTS.col_width_sno);
    setColWDesc(MM_DEFAULTS.col_width_desc);
    setColWUnit(MM_DEFAULTS.col_width_unit);
    setColWHsn(MM_DEFAULTS.col_width_hsn);
    setColWQty(MM_DEFAULTS.col_width_qty);
    setColWRate(MM_DEFAULTS.col_width_rate);
    setColWAmt(MM_DEFAULTS.col_width_amt);

    setLogoXOffset(0);
    setLogoYOffset(0);
    setLogoAlign('left');
    setTitleAlign('right');
    setBrandAlign('center');

    setInvoiceTitle(MM_DEFAULTS.invoice_title);
    setBrandName(MM_DEFAULTS.brand_name);
    setTagline(MM_DEFAULTS.tagline);
    setFssaiNo(MM_DEFAULTS.fssai_no);
    setShowHeaderLogo(true);
    setLogoSize('standard');
    setShowHeaderFssai(true);
    setLogoData(null);

    setSellerBoxLabel(MM_DEFAULTS.seller_box_label);
    setCompanyName(MM_DEFAULTS.company_name);
    setCompanyAddress(MM_DEFAULTS.address);
    setCompanyGstin(MM_DEFAULTS.gstin);
    setContactPhone(MM_DEFAULTS.contact);
    setStateName(MM_DEFAULTS.state_name);
    setStateCode(MM_DEFAULTS.state_code);

    setShowBranchOffice(true);
    setBranchBoxLabel(MM_DEFAULTS.branch_box_label);
    setBranchOffice(MM_DEFAULTS.branch_office);
    setBranchFssai(MM_DEFAULTS.branch_fssai);

    setBuyerBoxLabel(MM_DEFAULTS.buyer_box_label);
    setConsigneeBoxLabel(MM_DEFAULTS.consignee_box_label);
    setShowPartiesContact(true);
    setShowPlaceOfSupply(true);
    setShowDispatchGrid(true);

    toast({ title: 'Defaults restored', description: 'Click "Save Layout Changes" to apply.', variant: 'default' });
  };

  // ── Security Tab State ─────────────────────────────────────────────────────
  const [protectionEnabled, setProtectionEnabled] = useState(
    settings?.security?.bill_edit_protection_enabled !== 'false'
  );

  useEffect(() => {
    if (settings?.security?.bill_edit_protection_enabled !== undefined) {
      setProtectionEnabled(settings.security.bill_edit_protection_enabled !== 'false');
    }
  }, [settings?.security?.bill_edit_protection_enabled]);

  const [showDisablePinModal, setShowDisablePinModal] = useState(false);
  const [disablePinInput, setDisablePinInput] = useState('');
  const [disablePinError, setDisablePinError] = useState('');
  const [isVerifyingDisable, setIsVerifyingDisable] = useState(false);

  const [showChangePinModal, setShowChangePinModal] = useState(false);
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinChangeError, setPinChangeError] = useState('');
  const [isChangingPin, setIsChangingPin] = useState(false);

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

  // ── Database Backup State ──────────────────────────────────────────────────
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
        description: `Snapshot ${data?.name || 'MM_Billing_Backup.db'} saved with complete layout.`,
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

  return (
    <div className="space-y-6 pb-24 max-w-[1700px] mx-auto px-2 sm:px-4">
      {/* ── Top Header & Tab Controls ───────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b pb-4 bg-white/70 backdrop-blur-xs p-4 rounded-xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Settings &amp; Layout Studio</h1>
            <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Auto-Backup Active
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Full layout alignment, mouse drag line management, company branding, and database backups.
          </p>
        </div>

        {/* Main Tab Controller */}
        <div className="flex items-center gap-2 bg-slate-100 p-1.5 rounded-xl border border-slate-200">
          <button
            type="button"
            onClick={() => setMainTab('layout')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
              mainTab === 'layout'
                ? 'bg-white text-brand-700 shadow-xs border border-slate-200/80'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <LayoutTemplate className="h-4 w-4" />
            Visual Layout Studio
          </button>
          <button
            type="button"
            onClick={() => setMainTab('security')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
              mainTab === 'security'
                ? 'bg-white text-brand-700 shadow-xs border border-slate-200/80'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Shield className="h-4 w-4" />
            Security &amp; Database Backup
          </button>
        </div>
      </div>

      {/* ── TAB 1: VISUAL LAYOUT STUDIO ─────────────────────────────────────── */}
      {mainTab === 'layout' && (
        <div className="grid grid-cols-12 gap-6 items-start">
          {/* Left Column: Categorized Controls (Scrollable) */}
          <div className="col-span-12 xl:col-span-6 space-y-4">
            {/* Category Navigation Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none border-b border-slate-200 pb-2.5">
              {[
                { id: 'geometry', label: 'Manual Lines & Alignment', icon: MousePointer },
                { id: 'header', label: 'Header & Logo', icon: ImageIcon },
                { id: 'seller', label: 'Seller & Branch', icon: Building2 },
                { id: 'parties', label: 'Parties & Grid', icon: Users },
                { id: 'table', label: 'Table Columns', icon: Grid },
                { id: 'bank', label: 'Bank & Footers', icon: Landmark },
                { id: 'presets', label: 'Backup & Presets', icon: Sliders },
              ].map((tab) => {
                const Icon = tab.icon;
                const isActive = layoutSubSection === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setLayoutSubSection(tab.id as LayoutSubSection)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                      isActive
                        ? 'bg-brand-700 text-white shadow-xs'
                        : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* ── Sub-Section: Manual Lines & Alignment ── */}
            {layoutSubSection === 'geometry' && (
              <div className="space-y-4">
                <Card className="border-brand-200 bg-brand-50/15 shadow-xs">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center justify-between text-brand-950">
                      <span className="flex items-center gap-2">
                        <MousePointer className="h-4 w-4 text-brand-600" />
                        Manual Line Management &amp; Positioning
                      </span>
                      <span className="text-[11px] font-semibold bg-brand-100/80 text-brand-800 px-2.5 py-0.5 rounded-full">
                        Interactive Mouse Controls
                      </span>
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Adjust exact dividing coordinates or drag the handles with your mouse on the visual canvas.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Vertical Dividing Lines */}
                    <div className="space-y-3 p-3 bg-white rounded-lg border border-slate-200">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                          <ArrowLeftRight className="h-3.5 w-3.5 text-brand-600" />
                          Marketed By / Branch Office Divider (midX)
                        </Label>
                        <span className="text-xs font-mono font-bold text-brand-700">{midX} pt</span>
                      </div>
                      <input
                        type="range"
                        min={180}
                        max={450}
                        value={midX}
                        onChange={(e) => setMidX(parseInt(e.target.value, 10))}
                        className="w-full accent-brand-600 cursor-pointer"
                      />
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>Left Wider (180 pt)</span>
                        <span>Equal (310 pt)</span>
                        <span>Right Wider (450 pt)</span>
                      </div>
                    </div>

                    {/* Dispatch Grid Divider */}
                    <div className="space-y-3 p-3 bg-white rounded-lg border border-slate-200">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                          <ArrowLeftRight className="h-3.5 w-3.5 text-brand-600" />
                          Dispatch Col 1 &amp; Col 2 Divider (col2X)
                        </Label>
                        <span className="text-xs font-mono font-bold text-brand-700">{col2X} pt</span>
                      </div>
                      <input
                        type="range"
                        min={350}
                        max={520}
                        value={col2X}
                        onChange={(e) => setCol2X(parseInt(e.target.value, 10))}
                        className="w-full accent-brand-600 cursor-pointer"
                      />
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>Narrow Col 1 (350 pt)</span>
                        <span>Standard (440 pt)</span>
                        <span>Wide Col 1 (520 pt)</span>
                      </div>
                    </div>

                    {/* Horizontal Section Heights */}
                    <div className="grid grid-cols-12 gap-3">
                      <div className="col-span-6 space-y-1.5 p-3 bg-white rounded-lg border border-slate-200">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs font-semibold text-slate-800">Header Height</Label>
                          <span className="text-xs font-mono font-bold text-brand-700">{headerHeight} pt</span>
                        </div>
                        <input
                          type="range"
                          min={50}
                          max={120}
                          value={headerHeight}
                          onChange={(e) => setHeaderHeight(parseInt(e.target.value, 10))}
                          className="w-full accent-brand-600 cursor-pointer"
                        />
                      </div>

                      <div className="col-span-6 space-y-1.5 p-3 bg-white rounded-lg border border-slate-200">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs font-semibold text-slate-800">Address Band Height</Label>
                          <span className="text-xs font-mono font-bold text-brand-700">{companyBandHeight} pt</span>
                        </div>
                        <input
                          type="range"
                          min={60}
                          max={130}
                          value={companyBandHeight}
                          onChange={(e) => setCompanyBandHeight(parseInt(e.target.value, 10))}
                          className="w-full accent-brand-600 cursor-pointer"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-12 gap-3">
                      <div className="col-span-6 space-y-1.5 p-3 bg-white rounded-lg border border-slate-200">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs font-semibold text-slate-800">Buyer Box Height</Label>
                          <span className="text-xs font-mono font-bold text-brand-700">{buyerHeight} pt</span>
                        </div>
                        <input
                          type="range"
                          min={40}
                          max={110}
                          value={buyerHeight}
                          onChange={(e) => setBuyerHeight(parseInt(e.target.value, 10))}
                          className="w-full accent-brand-600 cursor-pointer"
                        />
                      </div>

                      <div className="col-span-6 space-y-1.5 p-3 bg-white rounded-lg border border-slate-200">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs font-semibold text-slate-800">Page Margins</Label>
                          <span className="text-xs font-mono font-bold text-brand-700">{margin} pt</span>
                        </div>
                        <input
                          type="range"
                          min={15}
                          max={50}
                          value={margin}
                          onChange={(e) => setMargin(parseInt(e.target.value, 10))}
                          className="w-full accent-brand-600 cursor-pointer"
                        />
                      </div>
                    </div>

                    {/* Element Alignment Controls */}
                    <div className="p-3 bg-white rounded-lg border border-slate-200 space-y-3">
                      <Label className="text-xs font-semibold text-slate-900 block">Element Alignment Controls</Label>
                      <div className="grid grid-cols-12 gap-3 items-center">
                        <div className="col-span-4 text-xs font-medium text-slate-700">Document Title:</div>
                        <div className="col-span-8 flex items-center gap-1">
                          {(['left', 'center', 'right'] as const).map((al) => (
                            <button
                              key={al}
                              type="button"
                              onClick={() => setTitleAlign(al)}
                              className={`flex-1 text-xs py-1 px-2 rounded-md font-medium capitalize border transition-colors ${
                                titleAlign === al ? 'bg-brand-700 text-white border-brand-700' : 'bg-white text-slate-700 border-slate-200'
                              }`}
                            >
                              {al}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="grid grid-cols-12 gap-3 items-center">
                        <div className="col-span-4 text-xs font-medium text-slate-700">Brand Banner:</div>
                        <div className="col-span-8 flex items-center gap-1">
                          {(['left', 'center', 'right'] as const).map((al) => (
                            <button
                              key={al}
                              type="button"
                              onClick={() => setBrandAlign(al)}
                              className={`flex-1 text-xs py-1 px-2 rounded-md font-medium capitalize border transition-colors ${
                                brandAlign === al ? 'bg-brand-700 text-white border-brand-700' : 'bg-white text-slate-700 border-slate-200'
                              }`}
                            >
                              {al}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="grid grid-cols-12 gap-3 items-center">
                        <div className="col-span-4 text-xs font-medium text-slate-700">Logo Alignment:</div>
                        <div className="col-span-8 flex items-center gap-1">
                          {(['left', 'center', 'right'] as const).map((al) => (
                            <button
                              key={al}
                              type="button"
                              onClick={() => setLogoAlign(al)}
                              className={`flex-1 text-xs py-1 px-2 rounded-md font-medium capitalize border transition-colors ${
                                logoAlign === al ? 'bg-brand-700 text-white border-brand-700' : 'bg-white text-slate-700 border-slate-200'
                              }`}
                            >
                              {al}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Manual Logo Nudge */}
                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                        <span className="font-medium text-slate-700">Logo Manual Offsets:</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-muted-foreground">X:</span>
                          <Input
                            type="number"
                            value={logoXOffset}
                            onChange={(e) => setLogoXOffset(parseInt(e.target.value, 10) || 0)}
                            className="w-16 h-7 text-xs font-mono"
                          />
                          <span className="text-[11px] text-muted-foreground">Y:</span>
                          <Input
                            type="number"
                            value={logoYOffset}
                            onChange={(e) => setLogoYOffset(parseInt(e.target.value, 10) || 0)}
                            className="w-16 h-7 text-xs font-mono"
                          />
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* ── Sub-Section: Header & Logo ── */}
            {layoutSubSection === 'header' && (
              <div className="space-y-4">
                <Card className="border-slate-200 shadow-xs">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center justify-between">
                      <span className="flex items-center gap-2 text-slate-900">
                        <FileText className="h-4 w-4 text-brand-600" />
                        Invoice Document Title
                      </span>
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Printed prominently in the top header.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <Label className="text-xs font-semibold">Document Title</Label>
                      <Input
                        value={invoiceTitle}
                        onChange={(e) => setInvoiceTitle(e.target.value.toUpperCase())}
                        placeholder="TAX INVOICE"
                        className="font-bold tracking-wider text-sm mt-1"
                      />
                    </div>
                    <div className="flex items-center gap-1.5 pt-1">
                      <span className="text-[11px] text-muted-foreground mr-1">Presets:</span>
                      {['TAX INVOICE', 'COMMERCIAL INVOICE', 'BILL OF SUPPLY', 'INVOICE'].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setInvoiceTitle(preset)}
                          className="text-[11px] font-medium bg-slate-100 hover:bg-brand-50 hover:text-brand-700 px-2.5 py-1 rounded-md border border-slate-200 transition-colors"
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* Logo & Brand Identity */}
                <Card className="border-brand-200/90 bg-brand-50/15 shadow-xs">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm flex items-center gap-2 text-brand-900">
                        <ImageIcon className="h-4 w-4 text-brand-700" />
                        Brand Header &amp; Master Logo
                      </CardTitle>
                      <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-800">
                        <span>Show Logo</span>
                        <input
                          type="checkbox"
                          checked={showHeaderLogo}
                          onChange={(e) => setShowHeaderLogo(e.target.checked)}
                          className="h-4 w-4 accent-brand-600 rounded"
                        />
                      </label>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {showHeaderLogo && (
                      <div className="flex items-center gap-4 bg-white p-3.5 rounded-lg border border-slate-200">
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
                            {logoData ? 'Custom Logo Active' : 'Default Moru Moru Logo Active'}
                          </p>
                          <div className="flex items-center gap-2 pt-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs font-medium"
                              onClick={() => logoInputRef.current?.click()}
                            >
                              <Upload className="h-3 w-3 mr-1.5" />
                              Upload Custom Logo
                            </Button>
                            {logoData && (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs text-muted-foreground hover:text-destructive"
                                onClick={handleResetLogo}
                              >
                                <RotateCcw className="h-3 w-3 mr-1.5" />
                                Revert
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                    <input
                      type="file"
                      ref={logoInputRef}
                      onChange={handleLogoUpload}
                      accept="image/png, image/jpeg, image/webp"
                      className="hidden"
                    />

                    {showHeaderLogo && (
                      <div className="grid grid-cols-12 gap-3 items-center pt-1">
                        <div className="col-span-5">
                          <Label className="text-xs font-semibold">Logo Render Sizing</Label>
                        </div>
                        <div className="col-span-7 flex items-center gap-1.5">
                          {(['compact', 'standard', 'large'] as const).map((s) => (
                            <button
                              key={s}
                              type="button"
                              onClick={() => setLogoSize(s)}
                              className={`flex-1 text-xs py-1 px-2 rounded-md font-medium border capitalize transition-colors ${
                                logoSize === s
                                  ? 'bg-brand-700 text-white border-brand-700'
                                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                              }`}
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-12 gap-3 pt-2 border-t border-slate-200">
                      <div className="col-span-8">
                        <Label className="text-xs font-semibold">Brand Banner Name</Label>
                        <Input
                          value={brandName}
                          onChange={(e) => setBrandName(e.target.value)}
                          placeholder="e.g. MORU MORU SNACKS"
                          className="font-bold text-sm mt-1"
                        />
                      </div>
                      <div className="col-span-4">
                        <div className="flex items-center justify-between mb-1">
                          <Label className="text-xs font-semibold">Master FSSAI</Label>
                          <label className="flex items-center gap-1 text-[11px] text-muted-foreground cursor-pointer">
                            <input
                              type="checkbox"
                              checked={showHeaderFssai}
                              onChange={(e) => setShowHeaderFssai(e.target.checked)}
                              className="h-3 w-3 accent-brand-600 rounded"
                            />
                            <span>Show</span>
                          </label>
                        </div>
                        <Input
                          value={fssaiNo}
                          onChange={(e) => setFssaiNo(e.target.value)}
                          placeholder="14-digit FSSAI"
                          maxLength={14}
                          disabled={!showHeaderFssai}
                        />
                      </div>
                    </div>

                    <div>
                      <Label className="text-xs font-semibold">Tagline / Sub-header</Label>
                      <Input
                        value={tagline}
                        onChange={(e) => setTagline(e.target.value)}
                        placeholder="e.g. - The Mastero Food Products -"
                        className="text-xs mt-1"
                      />
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* ── Sub-Section: Seller & Branch ── */}
            {layoutSubSection === 'seller' && (
              <div className="space-y-4">
                <Card className="border-slate-200 shadow-xs">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-brand-600" />
                      Seller Identity Block (Left Header)
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Enterprise registration details printed in the left Marketed By block.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-12 gap-3">
                      <div className="col-span-4">
                        <Label className="text-xs font-semibold">Box Header Title</Label>
                        <Input
                          value={sellerBoxLabel}
                          onChange={(e) => setSellerBoxLabel(e.target.value)}
                          placeholder="Marketed By:"
                          className="text-xs font-medium"
                        />
                      </div>
                      <div className="col-span-8">
                        <Label className="text-xs font-semibold">Company / Seller Legal Name</Label>
                        <Input
                          value={companyName}
                          onChange={(e) => setCompanyName(e.target.value)}
                          placeholder="e.g. SREE MEENAKSHI ENTERPRISES"
                          className="font-bold text-xs"
                        />
                      </div>
                    </div>

                    <div>
                      <Label className="text-xs font-semibold">Registered Seller Address</Label>
                      <Textarea
                        value={companyAddress}
                        onChange={(e) => setCompanyAddress(e.target.value)}
                        rows={3}
                        placeholder="Enter full address lines"
                        className="text-xs"
                      />
                    </div>

                    <div className="grid grid-cols-12 gap-3">
                      <div className="col-span-4">
                        <Label className="text-xs font-semibold">Seller GSTIN</Label>
                        <Input
                          value={companyGstin}
                          onChange={(e) => setCompanyGstin(e.target.value.toUpperCase())}
                          placeholder="15-digit GSTIN"
                          maxLength={15}
                          className="font-mono text-xs"
                        />
                      </div>
                      <div className="col-span-4">
                        <Label className="text-xs font-semibold">Contact Phone</Label>
                        <Input
                          value={contactPhone}
                          onChange={(e) => setContactPhone(e.target.value)}
                          placeholder="9698676151"
                          className="text-xs"
                        />
                      </div>
                      <div className="col-span-4">
                        <Label className="text-xs font-semibold">State &amp; Code</Label>
                        <div className="flex gap-1.5">
                          <Input
                            value={stateName}
                            onChange={(e) => setStateName(e.target.value)}
                            placeholder="Tamil Nadu"
                            className="text-xs flex-1"
                          />
                          <Input
                            value={stateCode}
                            onChange={(e) => setStateCode(e.target.value)}
                            placeholder="33"
                            maxLength={2}
                            className="text-xs w-12 text-center"
                          />
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Branch Office & Sales Point */}
                <Card className="border-slate-200 shadow-xs">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-brand-600" />
                        Branch Office &amp; Sales Point (Right Header)
                      </CardTitle>
                      <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-800">
                        <span>Show Branch Box</span>
                        <input
                          type="checkbox"
                          checked={showBranchOffice}
                          onChange={(e) => setShowBranchOffice(e.target.checked)}
                          className="h-4 w-4 accent-brand-600 rounded"
                        />
                      </label>
                    </div>
                    <CardDescription className="text-xs">
                      {showBranchOffice
                        ? 'Appears in the right box beside Marketed By.'
                        : 'Disabled: Marketed By spans the full width of the header.'}
                    </CardDescription>
                  </CardHeader>
                  {showBranchOffice && (
                    <CardContent className="space-y-3">
                      <div className="grid grid-cols-12 gap-3">
                        <div className="col-span-6">
                          <Label className="text-xs font-semibold">Branch Box Title</Label>
                          <Input
                            value={branchBoxLabel}
                            onChange={(e) => setBranchBoxLabel(e.target.value)}
                            placeholder="B.Office & Sales Point"
                            className="text-xs"
                          />
                        </div>
                        <div className="col-span-6">
                          <Label className="text-xs font-semibold">Branch FSSAI No</Label>
                          <Input
                            value={branchFssai}
                            onChange={(e) => setBranchFssai(e.target.value)}
                            placeholder="e.g. 22426582000581"
                            maxLength={14}
                            className="text-xs"
                          />
                        </div>
                      </div>
                      <div>
                        <Label className="text-xs font-semibold">Branch Office Address</Label>
                        <Textarea
                          value={branchOffice}
                          onChange={(e) => setBranchOffice(e.target.value)}
                          rows={2}
                          placeholder="e.g. 35-A, Thiyagi Nataraj St No 1, Ammapet Salem."
                          className="text-xs"
                        />
                      </div>
                    </CardContent>
                  )}
                </Card>
              </div>
            )}

            {/* ── Sub-Section: Parties & Dispatch ── */}
            {layoutSubSection === 'parties' && (
              <div className="space-y-4">
                <Card className="border-slate-200 shadow-xs">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Users className="h-4 w-4 text-brand-600" />
                      Buyer &amp; Consignee Box Headers
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Custom headers and field visibility for buyer and delivery consignee.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-12 gap-3">
                      <div className="col-span-6">
                        <Label className="text-xs font-semibold">Buyer Label</Label>
                        <Input
                          value={buyerBoxLabel}
                          onChange={(e) => setBuyerBoxLabel(e.target.value)}
                          placeholder="Buyer:"
                          className="text-xs"
                        />
                      </div>
                      <div className="col-span-6">
                        <Label className="text-xs font-semibold">Consignee Label</Label>
                        <Input
                          value={consigneeBoxLabel}
                          onChange={(e) => setConsigneeBoxLabel(e.target.value)}
                          placeholder="Consignee:"
                          className="text-xs"
                        />
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-slate-100">
                      <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-800">
                        <input
                          type="checkbox"
                          checked={showPartiesContact}
                          onChange={(e) => setShowPartiesContact(e.target.checked)}
                          className="h-4 w-4 accent-brand-600 rounded"
                        />
                        <span>Show Contact Phone in Party Box</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-800">
                        <input
                          type="checkbox"
                          checked={showPlaceOfSupply}
                          onChange={(e) => setShowPlaceOfSupply(e.target.checked)}
                          className="h-4 w-4 accent-brand-600 rounded"
                        />
                        <span>Show Place of Supply Line</span>
                      </label>
                    </div>
                  </CardContent>
                </Card>

                {/* Dispatch Grid Labels */}
                <Card className="border-slate-200 shadow-xs">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Grid className="h-4 w-4 text-brand-600" />
                        7-Row Dispatch &amp; Order Metadata Grid
                      </CardTitle>
                      <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-800">
                        <span>Show Grid</span>
                        <input
                          type="checkbox"
                          checked={showDispatchGrid}
                          onChange={(e) => setShowDispatchGrid(e.target.checked)}
                          className="h-4 w-4 accent-brand-600 rounded"
                        />
                      </label>
                    </div>
                  </CardHeader>
                  {showDispatchGrid && (
                    <CardContent className="space-y-3">
                      <div className="grid grid-cols-12 gap-3">
                        <div className="col-span-6">
                          <Label className="text-[11px] font-semibold">Row 1 Left: Bill No Label</Label>
                          <Input value={labelBillNo} onChange={(e) => setLabelBillNo(e.target.value)} className="text-xs h-8" />
                        </div>
                        <div className="col-span-6">
                          <Label className="text-[11px] font-semibold">Row 1 Right: Date Label</Label>
                          <Input value={labelDate} onChange={(e) => setLabelDate(e.target.value)} className="text-xs h-8" />
                        </div>
                      </div>

                      <div className="grid grid-cols-12 gap-3">
                        <div className="col-span-6">
                          <Label className="text-[11px] font-semibold">Row 2 Left: Delivery Note</Label>
                          <Input value={labelDeliveryNote} onChange={(e) => setLabelDeliveryNote(e.target.value)} className="text-xs h-8" />
                        </div>
                        <div className="col-span-6">
                          <Label className="text-[11px] font-semibold">Row 2 Right: Mode/Terms Payment</Label>
                          <Input value={labelPaymentTerms} onChange={(e) => setLabelPaymentTerms(e.target.value)} className="text-xs h-8" />
                        </div>
                      </div>

                      <div className="grid grid-cols-12 gap-3">
                        <div className="col-span-6">
                          <Label className="text-[11px] font-semibold">Row 3 Left: Buyer's Order No</Label>
                          <Input value={labelBuyerOrderNo} onChange={(e) => setLabelBuyerOrderNo(e.target.value)} className="text-xs h-8" />
                        </div>
                        <div className="col-span-6">
                          <Label className="text-[11px] font-semibold">Row 4 Left: Dispatch Doc No</Label>
                          <Input value={labelDispatchDoc} onChange={(e) => setLabelDispatchDoc(e.target.value)} className="text-xs h-8" />
                        </div>
                      </div>

                      <div className="grid grid-cols-12 gap-3">
                        <div className="col-span-4">
                          <Label className="text-[11px] font-semibold">Row 5: Despatched through</Label>
                          <Input value={labelDespatchedThrough} onChange={(e) => setLabelDespatchedThrough(e.target.value)} className="text-xs h-8" />
                        </div>
                        <div className="col-span-4">
                          <Label className="text-[11px] font-semibold">Row 6: Destination</Label>
                          <Input value={labelDestination} onChange={(e) => setLabelDestination(e.target.value)} className="text-xs h-8" />
                        </div>
                        <div className="col-span-4">
                          <Label className="text-[11px] font-semibold">Row 7: Terms of delivery</Label>
                          <Input value={labelTermsDelivery} onChange={(e) => setLabelTermsDelivery(e.target.value)} className="text-xs h-8" />
                        </div>
                      </div>
                    </CardContent>
                  )}
                </Card>
              </div>
            )}

            {/* ── Sub-Section: Table & Columns ── */}
            {layoutSubSection === 'table' && (
              <div className="space-y-4">
                <Card className="border-slate-200 shadow-xs">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Grid className="h-4 w-4 text-brand-600" />
                      Items Table Columns &amp; Headers
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Control visibility and header labels for each column in the items table.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-12 gap-3">
                      <div className="col-span-4">
                        <Label className="text-xs font-semibold">S.No Label</Label>
                        <Input value={colLabelSno} onChange={(e) => setColLabelSno(e.target.value)} className="text-xs" />
                      </div>
                      <div className="col-span-8">
                        <Label className="text-xs font-semibold">Description Column Label</Label>
                        <Input value={colLabelDesc} onChange={(e) => setColLabelDesc(e.target.value)} className="text-xs" />
                      </div>
                    </div>

                    <div className="grid grid-cols-12 gap-3">
                      <div className="col-span-6 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs font-semibold">Unit / KGS Column</Label>
                          <label className="flex items-center gap-1 text-[11px] text-muted-foreground cursor-pointer">
                            <input
                              type="checkbox"
                              checked={showColUnit}
                              onChange={(e) => setShowColUnit(e.target.checked)}
                              className="h-3.5 w-3.5 accent-brand-600 rounded"
                            />
                            <span>Show</span>
                          </label>
                        </div>
                        <Input value={colLabelUnit} onChange={(e) => setColLabelUnit(e.target.value)} disabled={!showColUnit} className="text-xs" />
                      </div>

                      <div className="col-span-6 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs font-semibold">HSN/SAC Column</Label>
                          <label className="flex items-center gap-1 text-[11px] text-muted-foreground cursor-pointer">
                            <input
                              type="checkbox"
                              checked={showColHsn}
                              onChange={(e) => setShowColHsn(e.target.checked)}
                              className="h-3.5 w-3.5 accent-brand-600 rounded"
                            />
                            <span>Show</span>
                          </label>
                        </div>
                        <Input value={colLabelHsn} onChange={(e) => setColLabelHsn(e.target.value)} disabled={!showColHsn} className="text-xs" />
                      </div>
                    </div>

                    <div className="grid grid-cols-12 gap-3">
                      <div className="col-span-4">
                        <Label className="text-xs font-semibold">Quantity Label</Label>
                        <Input value={colLabelQty} onChange={(e) => setColLabelQty(e.target.value)} className="text-xs" />
                      </div>
                      <div className="col-span-4">
                        <Label className="text-xs font-semibold">Rate Label</Label>
                        <Input value={colLabelRate} onChange={(e) => setColLabelRate(e.target.value)} className="text-xs" />
                      </div>
                      <div className="col-span-4">
                        <Label className="text-xs font-semibold">Amount Label</Label>
                        <Input value={colLabelAmount} onChange={(e) => setColLabelAmount(e.target.value)} className="text-xs" />
                      </div>
                    </div>

                    <div className="space-y-2 pt-3 border-t border-slate-100">
                      <label className="flex items-center justify-between text-xs cursor-pointer p-2 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors">
                        <div>
                          <span className="font-semibold text-slate-800 block">Inline Output CGST / SGST Rows</span>
                          <span className="text-[11px] text-muted-foreground">Prints tax breakdown rows directly under line items.</span>
                        </div>
                        <input
                          type="checkbox"
                          checked={showInlineTax}
                          onChange={(e) => setShowInlineTax(e.target.checked)}
                          className="h-4 w-4 accent-brand-600 rounded"
                        />
                      </label>

                      <label className="flex items-center justify-between text-xs cursor-pointer p-2 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors">
                        <div>
                          <span className="font-semibold text-slate-800 block">HSN/SAC Tax Summary Table</span>
                          <span className="text-[11px] text-muted-foreground">Detailed HSN taxable value and CGST/SGST/IGST breakdown grid.</span>
                        </div>
                        <input
                          type="checkbox"
                          checked={showTaxSummaryTable}
                          onChange={(e) => setShowTaxSummaryTable(e.target.checked)}
                          className="h-4 w-4 accent-brand-600 rounded"
                        />
                      </label>

                      <div className="flex items-center gap-4 pt-1">
                        <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-800">
                          <input
                            type="checkbox"
                            checked={showAmountInWords}
                            onChange={(e) => setShowAmountInWords(e.target.checked)}
                            className="h-4 w-4 accent-brand-600 rounded"
                          />
                          <span>Show Amount in Words</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-800">
                          <input
                            type="checkbox"
                            checked={showEoe}
                            onChange={(e) => setShowEoe(e.target.checked)}
                            className="h-4 w-4 accent-brand-600 rounded"
                          />
                          <span>Show 'E. &amp; O.E' Tag</span>
                        </label>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* ── Sub-Section: Bank & Footers ── */}
            {layoutSubSection === 'bank' && (
              <div className="space-y-4">
                <Card className="border-brand-300 bg-brand-50/10 shadow-xs">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm flex items-center gap-2 text-brand-900">
                        <Landmark className="h-4 w-4 text-brand-700" />
                        Company Bank Details
                      </CardTitle>
                      <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-800">
                        <span>Show Bank Details</span>
                        <input
                          type="checkbox"
                          checked={showBankDetails}
                          onChange={(e) => setShowBankDetails(e.target.checked)}
                          className="h-4 w-4 accent-brand-600 rounded"
                        />
                      </label>
                    </div>
                    <CardDescription className="text-xs">
                      Bank credentials printed in the bottom left block on every invoice.
                    </CardDescription>
                  </CardHeader>
                  {showBankDetails && (
                    <CardContent className="space-y-3">
                      <div className="grid grid-cols-12 gap-3">
                        <div className="col-span-6">
                          <Label className="text-xs font-semibold">Bank Name</Label>
                          <Input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="IDBI BANK" className="text-xs" />
                        </div>
                        <div className="col-span-6">
                          <Label className="text-xs font-semibold">Bank Branch</Label>
                          <Input value={bankBranch} onChange={(e) => setBankBranch(e.target.value)} placeholder="AMMAPET" className="text-xs" />
                        </div>
                      </div>

                      <div className="grid grid-cols-12 gap-3">
                        <div className="col-span-6">
                          <Label className="text-xs font-semibold">Account Number</Label>
                          <Input
                            value={bankAccountNumber}
                            onChange={(e) => setBankAccountNumber(e.target.value)}
                            placeholder="1907102000007535"
                            className="font-mono text-xs"
                          />
                        </div>
                        <div className="col-span-6">
                          <Label className="text-xs font-semibold">IFSC Code</Label>
                          <Input
                            value={bankIfsc}
                            onChange={(e) => setBankIfsc(e.target.value.toUpperCase())}
                            placeholder="IBKL0001907"
                            maxLength={11}
                            className="font-mono text-xs"
                          />
                        </div>
                      </div>

                      <div>
                        <Label className="text-xs font-semibold">Beneficiary Account Name</Label>
                        <Input
                          value={bankAccountName}
                          onChange={(e) => setBankAccountName(e.target.value)}
                          placeholder="SREE MEENAKSHI ENTERPRISES"
                          className="text-xs"
                        />
                      </div>
                    </CardContent>
                  )}
                </Card>

                {/* Declaration & Signatory */}
                <Card className="border-slate-200 shadow-xs">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <FileCheck className="h-4 w-4 text-brand-600" />
                      Declaration &amp; Authorised Signatory
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-12 gap-3">
                      <div className="col-span-4">
                        <Label className="text-xs font-semibold">Declaration Title</Label>
                        <Input value={declarationTitle} onChange={(e) => setDeclarationTitle(e.target.value)} className="text-xs" />
                      </div>
                      <div className="col-span-8">
                        <Label className="text-xs font-semibold">Declaration Statement</Label>
                        <Textarea
                          value={declarationText}
                          onChange={(e) => setDeclarationText(e.target.value)}
                          rows={2}
                          className="text-xs"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-12 gap-3 pt-2">
                      <div className="col-span-6">
                        <Label className="text-xs font-semibold">Company Prefix</Label>
                        <Input value={signatoryPrefix} onChange={(e) => setSignatoryPrefix(e.target.value)} className="text-xs" />
                      </div>
                      <div className="col-span-6">
                        <Label className="text-xs font-semibold">Signatory Designation</Label>
                        <Input value={signatoryLabel} onChange={(e) => setSignatoryLabel(e.target.value)} className="text-xs" />
                      </div>
                    </div>

                    <div className="pt-3 border-t border-slate-100 space-y-3">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-semibold">Legal Jurisdiction Footnote</Label>
                        <label className="flex items-center gap-1.5 cursor-pointer text-xs">
                          <input
                            type="checkbox"
                            checked={showLegalFootnote}
                            onChange={(e) => setShowLegalFootnote(e.target.checked)}
                            className="h-3.5 w-3.5 accent-brand-600 rounded"
                          />
                          <span>Show Footnote</span>
                        </label>
                      </div>
                      {showLegalFootnote && (
                        <div className="grid grid-cols-12 gap-3">
                          <div className="col-span-5">
                            <Input
                              value={jurisdiction}
                              onChange={(e) => setJurisdiction(e.target.value.toUpperCase())}
                              placeholder="SALEM"
                              className="text-xs"
                            />
                            <p className="text-[10px] text-muted-foreground mt-1">
                              Prints: <code className="bg-slate-100 px-1 py-0.5 rounded">SUBJECT TO {jurisdiction} JURISDICTION</code>
                            </p>
                          </div>
                          <div className="col-span-7">
                            <Input
                              value={footerComputerGeneratedText}
                              onChange={(e) => setFooterComputerGeneratedText(e.target.value)}
                              placeholder="This is a Computer Generated Invoice"
                              className="text-xs"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* ── Sub-Section: Backup & Presets ── */}
            {layoutSubSection === 'presets' && (
              <div className="space-y-4">
                <Card className="border-emerald-200 bg-emerald-50/20 shadow-xs">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2 text-emerald-950">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      Layout Saved in Database Backups
                    </CardTitle>
                    <CardDescription className="text-xs text-emerald-800">
                      Automatic recovery across uninstalls, re-installs, and PC changes.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 text-xs text-slate-700 leading-relaxed">
                    <p>
                      Every position, manual line coordinate, divider width, and text label is saved in the SQLite database (<code className="bg-white px-1.5 py-0.5 rounded border border-emerald-200 font-mono">settings</code> table).
                    </p>
                    <p>
                      Your database backup (<code className="bg-white px-1.5 py-0.5 rounded border border-emerald-200 font-mono">MM_Billing_Backup.db</code>) inherently carries all these exact settings. Restoring your backup restores this entire layout automatically.
                    </p>
                  </CardContent>
                </Card>

                {/* Standalone Layout Import / Export */}
                <Card className="border-slate-200 shadow-xs">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Sliders className="h-4 w-4 text-brand-600" />
                      Standalone Layout File (JSON)
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Export just your layout configuration as a portable JSON file.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-12 gap-3">
                      <div className="col-span-6">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={handleExportLayoutJson}
                          className="w-full text-xs h-9 justify-center"
                        >
                          <FileDown className="h-4 w-4 mr-2 text-brand-600" />
                          Export Layout (.json)
                        </Button>
                      </div>
                      <div className="col-span-6">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => jsonImportRef.current?.click()}
                          className="w-full text-xs h-9 justify-center"
                        >
                          <FileUp className="h-4 w-4 mr-2 text-indigo-600" />
                          Import Layout (.json)
                        </Button>
                        <input
                          type="file"
                          ref={jsonImportRef}
                          onChange={handleImportLayoutJson}
                          accept=".json"
                          className="hidden"
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Bottom Actions Bar */}
            <div className="flex items-center justify-between pt-2 border-t border-slate-200 bg-white/50 backdrop-blur-xs p-3 rounded-xl border">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleResetDefaults}
                className="text-xs text-slate-600 hover:text-destructive hover:border-destructive/30"
              >
                <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                Reset Defaults
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleExportLayoutJson}
                  className="text-xs"
                >
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                  Save JSON
                </Button>
                <Button
                  type="button"
                  onClick={() => updateLayoutMutation.mutate()}
                  disabled={updateLayoutMutation.isPending}
                  className="bg-brand-700 hover:bg-brand-800 text-white font-semibold text-xs h-9 px-5 shadow-xs"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {updateLayoutMutation.isPending ? 'Saving Layout…' : 'Save Layout Changes'}
                </Button>
              </div>
            </div>
          </div>

          {/* Right Column: Interactive Visual Canvas & Real-Time PDF */}
          <div className="col-span-12 xl:col-span-6 sticky top-4 space-y-2">
            <Card className="border-slate-300 shadow-md flex flex-col h-[calc(100vh-130px)] min-h-[640px] overflow-hidden">
              <CardHeader className="py-2.5 px-4 bg-slate-900 text-white flex flex-row items-center justify-between shrink-0">
                <div className="flex items-center gap-2.5">
                  <div className={`h-2.5 w-2.5 rounded-full ${isGeneratingPreview ? 'bg-amber-400 animate-ping' : 'bg-emerald-400'}`} />
                  <CardTitle className="text-xs font-semibold tracking-wide text-white uppercase">
                    {previewViewMode === 'canvas' ? 'Interactive Mouse Movement Canvas' : 'Live Rendered PDF'}
                  </CardTitle>
                </div>

                {/* View Mode Toggle & Copy Actions */}
                <div className="flex items-center gap-2">
                  <div className="flex items-center bg-slate-800 rounded-lg p-0.5 border border-slate-700">
                    <button
                      type="button"
                      onClick={() => setPreviewViewMode('canvas')}
                      className={`text-[11px] font-semibold px-2.5 py-1 rounded transition-colors flex items-center gap-1 ${
                        previewViewMode === 'canvas' ? 'bg-brand-600 text-white' : 'text-slate-300 hover:text-white'
                      }`}
                      title="Interactive visual canvas with mouse dragging for all divider lines"
                    >
                      <MousePointer className="h-3 w-3" />
                      Visual Canvas
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewViewMode('pdf')}
                      className={`text-[11px] font-semibold px-2.5 py-1 rounded transition-colors flex items-center gap-1 ${
                        previewViewMode === 'pdf' ? 'bg-brand-600 text-white' : 'text-slate-300 hover:text-white'
                      }`}
                      title="Real-time compiled A4 PDF view"
                    >
                      <FileText className="h-3 w-3" />
                      PDF Preview
                    </button>
                  </div>

                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-slate-300 hover:text-white hover:bg-slate-800"
                    onClick={async () => {
                      const currentBill = {
                        ...samplePreviewBill,
                        billNumber: nextMmNumber || samplePreviewBill.billNumber,
                      };
                      await downloadMmA4InvoicePDF(currentBill, currentLiveSettings, { copyType: previewCopyType });
                    }}
                    title="Download Sample PDF"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0 flex-1 bg-slate-200/60 relative overflow-auto flex items-center justify-center p-3 select-none">
                {previewViewMode === 'canvas' ? (
                  /* ── INTERACTIVE VISUAL CANVAS WITH MOUSE DRAGGING ── */
                  <div
                    ref={canvasRef}
                    className="w-full max-w-[500px] aspect-[1/1.414] bg-white border border-slate-300 shadow-lg rounded-sm relative text-[11px] font-sans flex flex-col p-[4%]"
                    style={{
                      padding: `${(margin / 595) * 100}%`,
                    }}
                  >
                    {/* Outer Border */}
                    <div className="w-full h-full border border-slate-900 flex flex-col relative">
                      {/* Section 1: Header */}
                      <div
                        className="w-full border-b border-slate-900 relative flex flex-col items-center justify-center px-2 shrink-0 group"
                        style={{ height: `${(headerHeight / 842) * 100 * 3.5}%` }}
                      >
                        {/* Draggable Logo */}
                        {showHeaderLogo && (
                          <div
                            onMouseDown={(e) => handleMouseDownOnHandle(e, 'logo', logoXOffset, logoYOffset)}
                            className={`absolute top-2 ${
                              logoAlign === 'left' ? 'left-2' : logoAlign === 'center' ? 'left-1/2 -translate-x-1/2' : 'right-2'
                            } flex items-center gap-1 cursor-move bg-brand-50/90 border border-dashed border-brand-500 rounded p-1 shadow-xs group/logo`}
                            style={{
                              transform: `translate(${logoXOffset}px, ${-logoYOffset}px)`,
                            }}
                            title="Click and drag with mouse to move logo anywhere in header!"
                          >
                            <img
                              src={logoData || '/mm-logo.png'}
                              alt="Logo"
                              className="h-8 w-auto object-contain pointer-events-none"
                              onError={(e) => {
                                (e.currentTarget as HTMLImageElement).src = '/mm-logo.png';
                              }}
                            />
                            <Move className="h-3 w-3 text-brand-600 opacity-70 group-hover/logo:opacity-100" />
                          </div>
                        )}

                        {/* Title */}
                        <div
                          className={`w-full absolute top-1.5 px-2 ${
                            titleAlign === 'left' ? 'text-left' : titleAlign === 'center' ? 'text-center' : 'text-right'
                          }`}
                        >
                          <span className="font-bold text-[10px] tracking-wider text-slate-800">{invoiceTitle}</span>
                        </div>

                        {/* Center Brand */}
                        <div className={`w-full text-center mt-2 ${brandAlign === 'left' ? 'text-left' : brandAlign === 'right' ? 'text-right' : 'text-center'}`}>
                          <h2 className="font-extrabold text-sm sm:text-base tracking-wide text-slate-900">{brandName}</h2>
                          {tagline && <p className="text-[9px] text-slate-600 -mt-0.5">{tagline}</p>}
                          {showHeaderFssai && fssaiNo && <p className="text-[8px] text-slate-500">(FSSAI: {fssaiNo})</p>}
                        </div>

                        {/* Draggable Header Height Horizontal Line Handle */}
                        <div
                          onMouseDown={(e) => handleMouseDownOnHandle(e, 'headerH', headerHeight)}
                          className="absolute -bottom-1 left-0 right-0 h-2 cursor-row-resize flex items-center justify-center hover:bg-brand-500/20 transition-colors z-20"
                          title="Drag up/down to adjust Header Height"
                        >
                          <div className="w-8 h-1 bg-brand-600 rounded-full opacity-60 group-hover:opacity-100" />
                        </div>
                      </div>

                      {/* Section 2: Address Band (Marketed By vs Branch Office) */}
                      <div
                        className="w-full border-b border-slate-900 relative flex shrink-0 group"
                        style={{ height: `${(companyBandHeight / 842) * 100 * 3.5}%` }}
                      >
                        {/* Left: Marketed By */}
                        <div
                          className="h-full p-1.5 text-[8.5px] overflow-hidden"
                          style={{ width: `${(midX / 595) * 100}%` }}
                        >
                          <p className="font-bold text-slate-900">{sellerBoxLabel}</p>
                          <p className="font-semibold text-slate-800 truncate">{companyName}</p>
                          <p className="text-[7.5px] text-slate-600 line-clamp-2 leading-tight">{companyAddress}</p>
                          <p className="text-[7.5px] font-mono text-slate-700">GST: {companyGstin}</p>
                        </div>

                        {/* Draggable Vertical Divider (midX) */}
                        {showBranchOffice && (
                          <div
                            onMouseDown={(e) => handleMouseDownOnHandle(e, 'midX', midX)}
                            className="absolute top-0 bottom-0 w-2.5 -translate-x-1/2 cursor-col-resize hover:bg-brand-500/30 flex items-center justify-center z-30 transition-colors group/mid"
                            style={{ left: `${(midX / 595) * 100}%` }}
                            title="Click and drag with mouse left/right to adjust Marketed By vs Branch Office width!"
                          >
                            <div className="w-0.5 h-full bg-slate-900" />
                            <div className="absolute w-3 h-5 bg-brand-600 rounded text-white flex items-center justify-center opacity-0 group-hover/mid:opacity-100 shadow-xs">
                              <ArrowLeftRight className="h-2.5 w-2.5" />
                            </div>
                          </div>
                        )}

                        {/* Right: Branch Office */}
                        {showBranchOffice && (
                          <div className="flex-1 h-full p-1.5 text-[8.5px] border-l border-slate-900 overflow-hidden">
                            <p className="font-bold text-slate-900">{branchBoxLabel}</p>
                            <p className="text-[7.5px] text-slate-600 line-clamp-2 leading-tight">{branchOffice}</p>
                            {branchFssai && <p className="text-[7.5px] text-slate-700">FSSAI: {branchFssai}</p>}
                          </div>
                        )}

                        {/* Draggable Band Height Line Handle */}
                        <div
                          onMouseDown={(e) => handleMouseDownOnHandle(e, 'bandH', companyBandHeight)}
                          className="absolute -bottom-1 left-0 right-0 h-2 cursor-row-resize flex items-center justify-center hover:bg-brand-500/20 z-20"
                          title="Drag up/down to adjust Address Band Height"
                        >
                          <div className="w-8 h-1 bg-brand-600 rounded-full opacity-60 group-hover:opacity-100" />
                        </div>
                      </div>

                      {/* Section 3: Middle Section (Buyer/Consignee vs 7-Row Dispatch Grid) */}
                      <div
                        className="w-full border-b border-slate-900 relative flex shrink-0 group"
                        style={{ height: `${(middleGridHeight / 842) * 100 * 3.5}%` }}
                      >
                        {/* Left: Buyer & Consignee */}
                        <div
                          className="h-full flex flex-col relative"
                          style={{ width: `${(midX / 595) * 100}%` }}
                        >
                          {/* Buyer Box */}
                          <div
                            className="w-full p-1.5 text-[8px] border-b border-slate-900 overflow-hidden relative group/buyer"
                            style={{ height: `${(buyerHeight / middleGridHeight) * 100}%` }}
                          >
                            <p className="font-bold text-slate-900">{buyerBoxLabel}</p>
                            <p className="font-semibold text-slate-800 truncate">Sample Wholesale Buyer</p>
                            <p className="text-[7px] text-slate-600 truncate">Salem, Tamil Nadu</p>
                            <p className="text-[7px] font-mono text-slate-700">GST: 33AAAAA0000A1Z5</p>

                            {/* Draggable Buyer Height Horizontal Line Handle */}
                            <div
                              onMouseDown={(e) => handleMouseDownOnHandle(e, 'buyerH', buyerHeight)}
                              className="absolute -bottom-1 left-0 right-0 h-2 cursor-row-resize flex items-center justify-center hover:bg-brand-500/20 z-20"
                              title="Drag up/down to adjust Buyer vs Consignee height"
                            >
                              <div className="w-6 h-1 bg-brand-600 rounded-full opacity-60 group-hover/buyer:opacity-100" />
                            </div>
                          </div>

                          {/* Consignee Box */}
                          <div className="flex-1 w-full p-1.5 text-[8px] overflow-hidden">
                            <p className="font-bold text-slate-900">{consigneeBoxLabel}</p>
                            <p className="font-semibold text-slate-800 truncate">Sample Wholesale Buyer</p>
                            <p className="text-[7px] text-slate-600 truncate">Door Delivery, Salem</p>
                          </div>
                        </div>

                        {/* Mid Divider Line */}
                        <div
                          className="absolute top-0 bottom-0 w-0.5 bg-slate-900"
                          style={{ left: `${(midX / 595) * 100}%` }}
                        />

                        {/* Right: 7-Row Dispatch Grid */}
                        <div className="flex-1 h-full flex flex-col relative border-l border-slate-900 text-[7px]">
                          {/* Vertical Col 2 Divider in Dispatch Grid */}
                          <div
                            onMouseDown={(e) => handleMouseDownOnHandle(e, 'col2X', col2X)}
                            className="absolute top-0 bottom-0 w-2.5 -translate-x-1/2 cursor-col-resize hover:bg-brand-500/30 flex items-center justify-center z-30 group/col2"
                            style={{ left: `${((col2X - midX) / (595 - midX)) * 100}%` }}
                            title="Click and drag with mouse to adjust Dispatch Grid Column 1 vs Column 2 divider!"
                          >
                            <div className="w-0.5 h-full bg-slate-900" />
                            <div className="absolute w-2.5 h-4 bg-brand-600 rounded text-white flex items-center justify-center opacity-0 group-hover/col2:opacity-100 shadow-xs">
                              <ArrowLeftRight className="h-2 w-2" />
                            </div>
                          </div>

                          <div className="flex-1 border-b border-slate-900 flex items-center px-1">
                            <span className="font-semibold">{labelBillNo}: MM/26-27/001</span>
                          </div>
                          <div className="flex-1 border-b border-slate-900 flex items-center px-1">
                            <span>{labelDeliveryNote}: DN-1024</span>
                          </div>
                          <div className="flex-1 border-b border-slate-900 flex items-center px-1">
                            <span>{labelBuyerOrderNo}: PO-8821</span>
                          </div>
                          <div className="flex-1 border-b border-slate-900 flex items-center px-1">
                            <span>{labelDispatchDoc}: LR-55421</span>
                          </div>
                          <div className="flex-1 border-b border-slate-900 flex items-center px-1">
                            <span>{labelDespatchedThrough}: TN 30 AB 1234</span>
                          </div>
                          <div className="flex-1 border-b border-slate-900 flex items-center px-1">
                            <span>{labelDestination}: Salem</span>
                          </div>
                          <div className="flex-1 flex items-center px-1">
                            <span>{labelTermsDelivery}: Door Delivery</span>
                          </div>
                        </div>
                      </div>

                      {/* Section 4: Table Header & Line Items */}
                      <div className="w-full flex-1 flex flex-col relative">
                        {/* Table Header */}
                        <div className="w-full h-5 border-b border-slate-900 flex items-center text-[7.5px] font-bold bg-slate-50 relative">
                          <div style={{ width: '8%' }} className="text-center">{colLabelSno}</div>
                          <div style={{ width: '38%' }} className="px-1">{colLabelDesc}</div>
                          {showColUnit && <div style={{ width: '10%' }} className="text-center">{colLabelUnit}</div>}
                          {showColHsn && <div style={{ width: '12%' }} className="text-center">{colLabelHsn}</div>}
                          <div style={{ width: '12%' }} className="text-right px-1">{colLabelQty}</div>
                          <div style={{ width: '10%' }} className="text-right px-1">{colLabelRate}</div>
                          <div style={{ width: '10%' }} className="text-right px-1">{colLabelAmount}</div>
                        </div>

                        {/* Line Items */}
                        <div className="flex-1 p-1 text-[7.5px] space-y-1">
                          <div className="flex items-center">
                            <div style={{ width: '8%' }} className="text-center">1</div>
                            <div style={{ width: '38%' }} className="px-1 font-semibold">Murukku Spicy Regular</div>
                            {showColUnit && <div style={{ width: '10%' }} className="text-center">10.000</div>}
                            {showColHsn && <div style={{ width: '12%' }} className="text-center">210690</div>}
                            <div style={{ width: '12%' }} className="text-right px-1">10.000</div>
                            <div style={{ width: '10%' }} className="text-right px-1">150.00</div>
                            <div style={{ width: '10%' }} className="text-right px-1 font-semibold">1,500.00</div>
                          </div>
                          {showInlineTax && (
                            <div className="flex items-center text-slate-700 italic text-[7px] pl-[8%]">
                              <span>OUTPUT CGST 2.5% (Rs. 37.50) &nbsp;|&nbsp; OUTPUT SGST 2.5% (Rs. 37.50)</span>
                            </div>
                          )}
                        </div>

                        {/* Total Row */}
                        <div className="w-full h-5 border-t border-b border-slate-900 flex items-center justify-between px-2 text-[8px] font-bold bg-slate-50">
                          <span>Total</span>
                          <span>Rs. 3,150.00</span>
                        </div>

                        {/* Bank Details & Signatory Footer */}
                        <div className="w-full h-14 flex text-[7px] border-t border-slate-900">
                          <div className="w-1/2 p-1 border-r border-slate-900">
                            {showBankDetails && (
                              <p className="font-semibold text-slate-800">Bank: {bankName} | A/C: {bankAccountNumber}</p>
                            )}
                            <p className="font-bold text-slate-900 mt-1">{declarationTitle}</p>
                            <p className="text-[6.5px] text-slate-600 line-clamp-1">{declarationText}</p>
                          </div>
                          <div className="w-1/2 p-1 flex flex-col justify-between text-right">
                            <p className="font-bold text-slate-900">{signatoryPrefix}</p>
                            <p className="text-slate-700">{signatoryLabel}</p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Bottom Footnote */}
                    {showLegalFootnote && (
                      <div className="w-full flex items-center justify-between text-[6px] text-slate-500 pt-1">
                        <span>SUBJECT TO {jurisdiction} JURISDICTION</span>
                        <span>{footerComputerGeneratedText}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  /* ── REAL-TIME COMPILED PDF IFRAME ── */
                  previewUrl ? (
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
                  )
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* ── TAB 2: SECURITY & DATABASE BACKUP ──────────────────────────────── */}
      {mainTab === 'security' && (
        <div className="space-y-6 max-w-4xl mx-auto">
          {/* Bill Edit & Cancel Security Gate Card */}
          <Card className="border-slate-200 shadow-xs">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Lock className="h-4 w-4 text-brand-600" />
                  Bill Edit &amp; Cancel Protection
                </CardTitle>
                <span
                  className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${
                    protectionEnabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {protectionEnabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              <CardDescription className="text-xs">
                Requires the Security PIN on the client and verifies on the server before editing or cancelling bills.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <label className="flex items-center justify-between gap-3 text-xs cursor-pointer rounded-lg border border-slate-200 p-3 bg-slate-50/50 hover:bg-slate-50 transition-colors">
                <div>
                  <span className="font-semibold text-slate-800 block">Require Security PIN for Edits &amp; Cancels</span>
                  <span className="text-muted-foreground block text-[11px]">
                    Prevents accidental modifications or deletions of saved tax invoices.
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
                  <p className="text-xs font-semibold text-slate-800">Security PIN</p>
                  <p className="text-[11px] text-muted-foreground">
                    {protectionEnabled ? 'PIN protection is active.' : 'Protection is currently turned off.'}
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

          {/* Database Backup Management Card */}
          <Card className="border-slate-200 shadow-xs">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Database className="h-4 w-4 text-brand-600" />
                  Database Backups &amp; Disaster Recovery
                </CardTitle>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => createBackupMutation.mutate()}
                  disabled={createBackupMutation.isPending}
                  className="bg-brand-700 hover:bg-brand-800 text-white text-xs h-8"
                >
                  <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${createBackupMutation.isPending ? 'animate-spin' : ''}`} />
                  {createBackupMutation.isPending ? 'Creating Snapshot…' : 'Backup Now'}
                </Button>
              </div>
              <CardDescription className="text-xs">
                Backups preserve your complete database: all products, bills, customer ledgers, and invoice layouts.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Active Folder */}
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                    <FolderCog className="h-3.5 w-3.5 text-brand-600" />
                    Active Backup Directory:
                  </span>
                  {!editingDir && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[11px] text-brand-700 hover:text-brand-800 p-0"
                      onClick={() => setEditingDir(true)}
                    >
                      Change Folder
                    </Button>
                  )}
                </div>

                {editingDir ? (
                  <div className="space-y-2 pt-1">
                    <Input
                      value={customBackupDir}
                      onChange={(e) => setCustomBackupDir(e.target.value)}
                      placeholder="e.g. D:\\MM Backups or C:\\Users\\User\\Documents"
                      className="text-xs h-8 font-mono bg-white"
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        className="h-7 text-xs bg-brand-700 hover:bg-brand-800 text-white"
                        onClick={() => updateDirMutation.mutate(customBackupDir.trim())}
                        disabled={updateDirMutation.isPending}
                      >
                        Save Folder
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => {
                          setCustomBackupDir(backupData?.backupDir || '');
                          setEditingDir(false);
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="font-mono text-slate-800 break-all text-[11px] bg-white p-2 rounded border border-slate-200">
                    {backupData?.backupDir || 'C:\\\\Users\\\\Documents\\\\MM Billing Backups'}
                  </p>
                )}
              </div>

              {/* Recent Backup Snapshot Status */}
              <div className="border border-slate-200 rounded-lg p-3 bg-white flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-slate-800">Latest Backup Snapshot</p>
                  <p className="text-[11px] text-muted-foreground">
                    {backupData?.backups && backupData.backups.length > 0
                      ? `${backupData.backups[0].name} (${Math.round(backupData.backups[0].size / 1024)} KB)`
                      : 'No backup found. Click "Backup Now" above.'}
                  </p>
                </div>
                {backupData?.backups && backupData.backups.length > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-xs h-7"
                    onClick={() => {
                      window.location.href = `/api/v1/backups/${encodeURIComponent(backupData.backups[0].name)}/download`;
                    }}
                  >
                    <Download className="h-3 w-3 mr-1.5 text-brand-600" />
                    Download Copy
                  </Button>
                )}
              </div>

              {/* Disaster Recovery Note */}
              <div className="p-3 bg-blue-50/50 rounded-lg border border-blue-200 text-xs text-blue-900 space-y-1">
                <p className="font-semibold flex items-center gap-1.5">
                  <HelpCircle className="h-4 w-4 text-blue-700" />
                  How to Restore a Backup on Reinstall
                </p>
                <p className="text-[11px] text-blue-800 leading-relaxed">
                  If you delete and reinstall the app, open the application top menu: <strong>Alt &rarr; Setup &rarr; Restore from Backup…</strong> and select your <code className="bg-white/80 px-1 py-0.5 rounded font-mono">MM_Billing_Backup.db</code> file. The app will restart and load all your bills and custom layout instantly.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Security Modals ─────────────────────────────────────────────────── */}
      {showDisablePinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="bg-white rounded-xl shadow-xl border p-6 w-full max-w-sm space-y-4">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Shield className="h-4 w-4 text-destructive" />
              Disable Bill Protection
            </h3>
            <p className="text-xs text-muted-foreground">
              Enter current Security PIN to disable protection:
            </p>
            <form onSubmit={confirmDisableProtection} className="space-y-3">
              <Input
                type="password"
                placeholder="Enter PIN"
                value={disablePinInput}
                onChange={(e) => setDisablePinInput(e.target.value)}
                autoFocus
                className="text-center font-mono text-lg tracking-widest"
              />
              {disablePinError && <p className="text-xs text-destructive font-medium">{disablePinError}</p>}
              <div className="flex items-center justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  onClick={() => setShowDisablePinModal(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isVerifyingDisable}
                  className="bg-destructive hover:bg-destructive/90 text-white text-xs"
                >
                  {isVerifyingDisable ? 'Verifying…' : 'Disable Protection'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showChangePinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="bg-white rounded-xl shadow-xl border p-6 w-full max-w-sm space-y-4">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Lock className="h-4 w-4 text-brand-600" />
              Change Security PIN
            </h3>
            <form onSubmit={handleSaveNewPin} className="space-y-3">
              <div>
                <Label className="text-xs">Current PIN</Label>
                <Input
                  type="password"
                  placeholder="Enter current PIN"
                  value={currentPin}
                  onChange={(e) => setCurrentPin(e.target.value)}
                  autoFocus
                  className="text-xs mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">New PIN (min 4 characters)</Label>
                <Input
                  type="password"
                  placeholder="Enter new PIN"
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value)}
                  className="text-xs mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Confirm New PIN</Label>
                <Input
                  type="password"
                  placeholder="Re-enter new PIN"
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(e.target.value)}
                  className="text-xs mt-1"
                />
              </div>
              {pinChangeError && <p className="text-xs text-destructive font-medium">{pinChangeError}</p>}
              <div className="flex items-center justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  onClick={() => setShowChangePinModal(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isChangingPin}
                  className="bg-brand-700 hover:bg-brand-800 text-white text-xs"
                >
                  {isChangingPin ? 'Saving…' : 'Update PIN'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}