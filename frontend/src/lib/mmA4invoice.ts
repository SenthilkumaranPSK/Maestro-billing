import { PDFDocument, PDFFont, PDFImage, PDFPage, rgb } from 'pdf-lib';
import { type Bill, type Settings, MM_DEFAULTS, paisaToRupee } from '@/types';
import { numberToIndianWords } from '@/lib/amountInWords';
import { bytesToBase64 } from '@/lib/pdf';
import { embedBrandFonts } from '@/lib/brandFont';
import { wrapText } from '@/lib/a4invoice';
import { computeHsnSummary } from '@/lib/hsnSummary';
import { splitTaxP } from '@/lib/billMath';

const STATE_CODES: Record<string, string> = {
  '33': 'Tamil Nadu',
  '37': 'Andhra Pradesh',
  '29': 'Karnataka',
  '32': 'Kerala',
  '36': 'Telangana',
  '27': 'Maharashtra',
  '07': 'Delhi',
  '09': 'Uttar Pradesh',
  '19': 'West Bengal',
  '24': 'Gujarat',
  '08': 'Rajasthan',
  '06': 'Haryana',
  '03': 'Punjab',
  '34': 'Puducherry',
};

function getStateInfo(gstin?: string, defaultState = 'Tamil Nadu', defaultCode = '33') {
  if (gstin && gstin.trim().length >= 2) {
    const code = gstin.trim().slice(0, 2);
    if (/^\d{2}$/.test(code)) {
      const name = STATE_CODES[code] || defaultState;
      return { name, code };
    }
  }
  return { name: defaultState, code: defaultCode };
}

function formatTallyDate(date: Date | string | undefined | null): string {
  if (!date) return '';
  if (typeof date === 'string') {
    const trimmed = date.trim();
    if (!trimmed) return '';
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
    if (match) {
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const y = match[1];
      const m = parseInt(match[2], 10) - 1;
      const d = parseInt(match[3], 10);
      return `${d}-${months[m] || match[2]}-${y.slice(-2)}`;
    }
  }
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return String(date);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = d.getDate();
  const month = months[d.getMonth()];
  const year = String(d.getFullYear()).slice(-2);
  return `${day}-${month}-${year}`;
}

const PAGE_W = 595.28; // A4 pt
const PAGE_H = 841.89;

const BLACK = rgb(0.08, 0.08, 0.08);
const THIN = 0.5;

function formatAmt2(paise: number): string {
  return paisaToRupee(paise).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatQty3(qty: number): string {
  return qty.toLocaleString('en-IN', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}

function formatWordsINR(paise: number): string {
  const rupees = Math.floor(paise / 100);
  const paiseRemainder = Math.round(paise) % 100;
  const rupeeWords = numberToIndianWords(rupees);
  const paiseWords = paiseRemainder ? ` and ${numberToIndianWords(paiseRemainder)} Paise` : '';
  return `INR ${rupeeWords}${paiseWords} Only`;
}

interface TextOpts {
  size?: number;
  font?: PDFFont;
  color?: ReturnType<typeof rgb>;
  align?: 'left' | 'right' | 'center';
  maxWidth?: number;
}

export type MmCopyType = 'ORIGINAL' | 'DUPLICATE' | 'TRIPLICATE' | 'ALL';

export interface MmA4InvoiceOptions {
  copyType?: MmCopyType;
  previousDueP?: number;
}

let mmLogoBytesCache: Uint8Array | null | undefined;

async function fetchMmA4LogoBytes(): Promise<Uint8Array | null> {
  if (mmLogoBytesCache !== undefined) return mmLogoBytesCache;
  mmLogoBytesCache = null;
  for (const p of ['/mm-logo.png', '/Logo.png']) {
    try {
      const res = await fetch(p);
      if (res.ok) {
        const buf = await res.arrayBuffer();
        mmLogoBytesCache = new Uint8Array(buf);
        return mmLogoBytesCache;
      }
    } catch {
      // try next
    }
  }
  return null;
}

export async function generateMmA4InvoicePDF(
  bill: Bill,
  settings: Partial<Settings>,
  options: MmA4InvoiceOptions = {}
): Promise<Uint8Array> {
  const mmSettings = settings.mm || {};

  // ── Geometry & Layout Dividers (Full Manual Control) ───────────────────────
  const MARGIN = parseFloat(mmSettings.mm_margin || '') || MM_DEFAULTS.margin;
  const midX = parseFloat(mmSettings.mm_mid_x || '') || MM_DEFAULTS.mid_x;
  const col2X = parseFloat(mmSettings.mm_col2_x || '') || MM_DEFAULTS.col2_x;
  const HEADER_H = parseFloat(mmSettings.mm_header_height || '') || MM_DEFAULTS.header_height;
  const COMPANY_BAND_H = parseFloat(mmSettings.mm_company_band_height || '') || MM_DEFAULTS.company_band_height;
  const MIDDLE_GRID_H = parseFloat(mmSettings.mm_middle_grid_height || '') || MM_DEFAULTS.middle_grid_height;
  const buyerH = parseFloat(mmSettings.mm_buyer_height || '') || MM_DEFAULTS.buyer_height;
  const TABLE_HEADER_H = parseFloat(mmSettings.mm_table_header_height || '') || MM_DEFAULTS.table_header_height;

  // Alignment & Placement Offsets
  const logoXOffset = parseFloat(mmSettings.mm_logo_x_offset || '') || 0;
  const logoYOffset = parseFloat(mmSettings.mm_logo_y_offset || '') || 0;
  const logoAlign = (mmSettings.mm_logo_align as 'left' | 'center' | 'right') || MM_DEFAULTS.logo_align;
  const titleAlign = (mmSettings.mm_title_align as 'left' | 'center' | 'right') || MM_DEFAULTS.title_align;
  const brandAlign = (mmSettings.mm_brand_align as 'left' | 'center' | 'right') || MM_DEFAULTS.brand_align;

  // ── Document & Header Settings ─────────────────────────────────────────────
  const invoiceTitle = mmSettings.mm_invoice_title || MM_DEFAULTS.invoice_title;
  const brandName = mmSettings.mm_brand_name || MM_DEFAULTS.brand_name;
  const tagline = mmSettings.mm_tagline ?? MM_DEFAULTS.tagline;
  const fssaiNo = mmSettings.mm_fssai_no || MM_DEFAULTS.fssai_no;
  const showHeaderLogo = mmSettings.mm_show_header_logo !== 'false';
  const logoSize = mmSettings.mm_logo_size || MM_DEFAULTS.logo_size;
  const showHeaderFssai = mmSettings.mm_show_header_fssai !== 'false';

  // ── Seller Identity (Marketed By) ──────────────────────────────────────────
  const sellerBoxLabel = mmSettings.mm_seller_box_label || MM_DEFAULTS.seller_box_label;
  const companyName = mmSettings.mm_company_name || MM_DEFAULTS.company_name;
  const companyAddress = mmSettings.mm_address || MM_DEFAULTS.address;
  const companyGstin = mmSettings.mm_gstin || MM_DEFAULTS.gstin;
  const contactPhone = mmSettings.mm_contact || MM_DEFAULTS.contact;
  const sellerState = getStateInfo(
    companyGstin,
    mmSettings.mm_state_name || MM_DEFAULTS.state_name,
    mmSettings.mm_state_code || MM_DEFAULTS.state_code
  );

  // ── Branch Office & Sales Point ────────────────────────────────────────────
  const showBranchOffice = mmSettings.mm_show_branch_office !== 'false';
  const branchBoxLabel = mmSettings.mm_branch_box_label || MM_DEFAULTS.branch_box_label;
  const branchOffice = mmSettings.mm_branch_office || MM_DEFAULTS.branch_office;
  const branchFssai = mmSettings.mm_branch_fssai || MM_DEFAULTS.branch_fssai;

  // ── Parties & Dispatch ─────────────────────────────────────────────────────
  const buyerBoxLabel = mmSettings.mm_buyer_box_label || MM_DEFAULTS.buyer_box_label;
  const consigneeBoxLabel = mmSettings.mm_consignee_box_label || MM_DEFAULTS.consignee_box_label;
  const showPartiesContact = mmSettings.mm_show_parties_contact !== 'false';
  const showPlaceOfSupply = mmSettings.mm_show_place_of_supply !== 'false';
  const showDispatchGrid = mmSettings.mm_show_dispatch_grid !== 'false';

  // Dispatch Row Labels
  const labelBillNo = mmSettings.mm_label_bill_no || MM_DEFAULTS.label_bill_no;
  const labelDate = mmSettings.mm_label_date || MM_DEFAULTS.label_date;
  const labelDeliveryNote = mmSettings.mm_label_delivery_note || MM_DEFAULTS.label_delivery_note;
  const labelPaymentTerms = mmSettings.mm_label_payment_terms || MM_DEFAULTS.label_payment_terms;
  const labelBuyerOrderNo = mmSettings.mm_label_buyer_order_no || MM_DEFAULTS.label_buyer_order_no;
  const labelDispatchDoc = mmSettings.mm_label_dispatch_doc || MM_DEFAULTS.label_dispatch_doc;
  const labelDespatchedThrough = mmSettings.mm_label_despatched_through || MM_DEFAULTS.label_despatched_through;
  const labelDestination = mmSettings.mm_label_destination || MM_DEFAULTS.label_destination;
  const labelTermsDelivery = mmSettings.mm_label_terms_delivery || MM_DEFAULTS.label_terms_delivery;

  // ── Items Table & Columns ──────────────────────────────────────────────────
  const colLabelSno = mmSettings.mm_col_label_sno || MM_DEFAULTS.col_label_sno;
  const colLabelDesc = mmSettings.mm_col_label_desc || MM_DEFAULTS.col_label_desc;
  const colLabelUnit = mmSettings.mm_col_label_unit || MM_DEFAULTS.col_label_unit;
  const colLabelHsn = mmSettings.mm_col_label_hsn || MM_DEFAULTS.col_label_hsn;
  const colLabelQty = mmSettings.mm_col_label_qty || MM_DEFAULTS.col_label_qty;
  const colLabelRate = mmSettings.mm_col_label_rate || MM_DEFAULTS.col_label_rate;
  const colLabelAmount = mmSettings.mm_col_label_amount || MM_DEFAULTS.col_label_amount;
  const showColUnit = mmSettings.mm_show_col_unit !== 'false';
  const showColHsn = mmSettings.mm_show_col_hsn !== 'false';
  const showInlineTax = mmSettings.mm_show_inline_tax !== 'false';

  // Configured Column Widths
  const colWSno = parseFloat(mmSettings.mm_col_width_sno || '') || MM_DEFAULTS.col_width_sno;
  const colWDesc = parseFloat(mmSettings.mm_col_width_desc || '') || MM_DEFAULTS.col_width_desc;
  const colWUnit = parseFloat(mmSettings.mm_col_width_unit || '') || MM_DEFAULTS.col_width_unit;
  const colWHsn = parseFloat(mmSettings.mm_col_width_hsn || '') || MM_DEFAULTS.col_width_hsn;
  const colWQty = parseFloat(mmSettings.mm_col_width_qty || '') || MM_DEFAULTS.col_width_qty;
  const colWRate = parseFloat(mmSettings.mm_col_width_rate || '') || MM_DEFAULTS.col_width_rate;
  const colWAmt = parseFloat(mmSettings.mm_col_width_amt || '') || MM_DEFAULTS.col_width_amt;

  // ── Summary Block ──────────────────────────────────────────────────────────
  const showTaxSummaryTable = mmSettings.mm_show_tax_summary_table !== 'false';
  const showAmountInWords = mmSettings.mm_show_amount_in_words !== 'false';
  const showEoe = mmSettings.mm_show_eoe !== 'false';

  // ── Bank Details ───────────────────────────────────────────────────────────
  const showBankDetails = mmSettings.mm_show_bank_details !== 'false';
  const bankAccountName = mmSettings.mm_bank_account_name || MM_DEFAULTS.bank_account_name;
  const bankName = mmSettings.mm_bank_name || MM_DEFAULTS.bank_name;
  const bankAccountNumber = mmSettings.mm_bank_account_number || MM_DEFAULTS.bank_account_number;
  const bankBranch = mmSettings.mm_bank_branch || MM_DEFAULTS.bank_branch;
  const bankIfsc = mmSettings.mm_bank_ifsc || MM_DEFAULTS.bank_ifsc;

  // ── Declaration & Signatory ────────────────────────────────────────────────
  const declarationTitle = mmSettings.mm_declaration_title || MM_DEFAULTS.declaration_title;
  const declarationText = mmSettings.mm_declaration_text || MM_DEFAULTS.declaration_text;
  const signatoryPrefix = mmSettings.mm_signatory_prefix || `for ${companyName}`;
  const signatoryLabel = mmSettings.mm_signatory_label || MM_DEFAULTS.signatory_label;
  const showLegalFootnote = mmSettings.mm_show_legal_footnote !== 'false';
  const jurisdiction = mmSettings.mm_jurisdiction || MM_DEFAULTS.jurisdiction;
  const footerComputerGeneratedText = mmSettings.mm_footer_computer_generated_text || MM_DEFAULTS.footer_computer_generated_text;

  // Parties resolution
  const buyerName = bill.buyerName || bill.mmCustomer?.name || bill.customer?.name || '';
  const buyerAddress = bill.buyerAddress || bill.mmCustomer?.address || bill.customer?.address || '';
  const buyerGstin = bill.buyerGstin || bill.mmCustomer?.gstin || bill.customer?.gstin || '';
  const buyerState = getStateInfo(buyerGstin, sellerState.name, sellerState.code);

  const consigneeName = bill.consigneeName || buyerName;
  const consigneeAddress = bill.consigneeAddress || buyerAddress;
  const consigneeGstin = bill.consigneeGstin || buyerGstin;
  const consigneeState = getStateInfo(consigneeGstin, buyerState.name, buyerState.code);

  const placeOfSupply = bill.destination || buyerState.name;

  const doc = await PDFDocument.create();
  const { regular, bold } = await embedBrandFonts(doc);

  // Logo loading
  let logoBytes: Uint8Array | null = null;
  let isJpeg = false;

  if (showHeaderLogo && mmSettings.mm_logo_data) {
    try {
      const dataStr = mmSettings.mm_logo_data;
      const base64Content = dataStr.includes(',') ? dataStr.split(',')[1] : dataStr;
      const binaryString = atob(base64Content);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      logoBytes = bytes;
      isJpeg = dataStr.includes('image/jpeg') || dataStr.includes('image/jpg') || (bytes[0] === 0xff && bytes[1] === 0xd8);
    } catch {
      logoBytes = null;
    }
  }

  if (showHeaderLogo && !logoBytes) {
    logoBytes = await fetchMmA4LogoBytes();
  }

  let logoImage: PDFImage | null = null;
  if (showHeaderLogo && logoBytes) {
    try {
      if (isJpeg) {
        logoImage = await doc.embedJpg(logoBytes);
      } else {
        logoImage = await doc.embedPng(logoBytes);
      }
    } catch {
      try {
        logoImage = await doc.embedJpg(logoBytes);
      } catch {
        // ignore format error
      }
    }
  }

  const left = MARGIN;
  const right = PAGE_W - MARGIN;
  const contentW = right - left;
  const leftW = midX - left;
  const rightW = right - midX;

  // Dynamic Column Layout
  interface ColDef {
    key: string;
    label: string;
    w: number;
    align: 'left' | 'right' | 'center';
  }

  const rawCols: ColDef[] = [
    { key: 'sno', label: colLabelSno, w: colWSno, align: 'center' },
    { key: 'desc', label: colLabelDesc, w: colWDesc, align: 'left' },
  ];

  if (showColUnit) {
    rawCols.push({ key: 'unit', label: colLabelUnit, w: colWUnit, align: 'center' });
  }
  if (showColHsn) {
    rawCols.push({ key: 'hsn', label: colLabelHsn, w: colWHsn, align: 'center' });
  }
  rawCols.push(
    { key: 'qty', label: colLabelQty, w: colWQty, align: 'right' },
    { key: 'rate', label: colLabelRate, w: colWRate, align: 'right' },
    { key: 'amt', label: colLabelAmount, w: colWAmt, align: 'right' }
  );

  // Normalize column widths to fit contentW exactly
  const sumW = rawCols.reduce((acc, c) => acc + c.w, 0);
  const scale = contentW / sumW;
  let curX = left;
  const cols = rawCols.map((c) => {
    const colW = c.w * scale;
    const colObj = { ...c, w: colW, x: curX };
    curX += colW;
    return colObj;
  });

  const copiesToRender: Array<{ copyType: MmCopyType; title: string }> = [];
  if (options.copyType === 'ALL') {
    copiesToRender.push(
      { copyType: 'ORIGINAL', title: 'ORIGINAL FOR RECIPIENT' },
      { copyType: 'DUPLICATE', title: 'DUPLICATE FOR TRANSPORTER' },
      { copyType: 'TRIPLICATE', title: 'TRIPLICATE FOR SUPPLIER' }
    );
  } else if (options.copyType === 'DUPLICATE') {
    copiesToRender.push({ copyType: 'DUPLICATE', title: 'DUPLICATE FOR TRANSPORTER' });
  } else if (options.copyType === 'TRIPLICATE') {
    copiesToRender.push({ copyType: 'TRIPLICATE', title: 'TRIPLICATE FOR SUPPLIER' });
  } else {
    copiesToRender.push({ copyType: 'ORIGINAL', title: options.copyType ? 'ORIGINAL FOR RECIPIENT' : '' });
  }

  // Summary calculations
  const hsnGroups = computeHsnSummary(bill);
  const gstRates = [...new Set(bill.items.filter((i) => i.gstRate > 0).map((i) => i.gstRate))];
  const halfRate = gstRates.length === 1 ? gstRates[0]! / 2 : undefined;
  const fullRate = gstRates.length === 1 ? gstRates[0]! : undefined;
  const totalQty = bill.items.reduce((s, i) => s + i.qty, 0);

  const TOTAL_ROW_H = 18;
  const WORDS_EOE_H = showAmountInWords || showEoe ? 24 : 0;
  const HSN_TABLE_H = showTaxSummaryTable ? 18 + hsnGroups.length * 13 + 14 + 16 + 2 : 0;
  const LEDGER_DUE_H = options.previousDueP && options.previousDueP > 0 ? 14 : 0;
  const BANK_SIG_H = 75;
  const SUMMARY_BLOCK_H = TOTAL_ROW_H + WORDS_EOE_H + HSN_TABLE_H + LEDGER_DUE_H + BANK_SIG_H;

  const bottomLimit = MARGIN + 18;
  const reservedBottomY = bottomLimit + SUMMARY_BLOCK_H;

  interface ItemLayout {
    itemIndex: number;
    nameLines: string[];
    height: number;
    baseAmt: number;
    baseUnitPrice: number;
  }

  const descWidth = cols.find((c) => c.key === 'desc')?.w || 180;
  const itemLayouts: ItemLayout[] = bill.items.map((item, idx) => {
    const lines = wrapText(bold, item.productName, 8, descWidth - 8);
    const baseAmt = item.totalAmount - item.gstAmount;
    const baseUnitPrice = item.qty ? Math.round(baseAmt / item.qty) : item.unitPrice;
    const height = Math.max(18, lines.length * 10 + 6);
    return { itemIndex: idx, nameLines: lines, height, baseAmt, baseUnitPrice };
  });

  const inlineTaxCount = showInlineTax && bill.gstAmount > 0 ? (bill.isInterState ? 1 : 2) : 0;
  const INLINE_TAX_H = inlineTaxCount * 14;

  const availableItemsH = PAGE_H - MARGIN - HEADER_H - COMPANY_BAND_H - MIDDLE_GRID_H - TABLE_HEADER_H - reservedBottomY;
  const itemPages: ItemLayout[][] = [];
  let current: ItemLayout[] = [];
  let currentH = 0;

  for (const il of itemLayouts) {
    if (current.length > 0 && currentH + il.height > availableItemsH - INLINE_TAX_H) {
      itemPages.push(current);
      current = [];
      currentH = 0;
    }
    current.push(il);
    currentH += il.height;
  }
  itemPages.push(current);

  for (const copyInfo of copiesToRender) {
    itemPages.forEach((pageItems, pageIdx) => {
      const isLast = pageIdx === itemPages.length - 1;
      const page = doc.addPage([PAGE_W, PAGE_H]);

      const hline = (yPos: number, x1 = left, x2 = right, thickness = THIN) =>
        page.drawLine({ start: { x: x1, y: yPos }, end: { x: x2, y: yPos }, thickness, color: BLACK });
      const vline = (xPos: number, y1: number, y2: number, thickness = THIN) =>
        page.drawLine({ start: { x: xPos, y: y1 }, end: { x: xPos, y: y2 }, thickness, color: BLACK });

      const text = (str: string, x: number, yPos: number, opts: TextOpts = {}) => {
        const font = opts.font ?? regular;
        const size = opts.size ?? 8;
        const color = opts.color ?? BLACK;
        const w = font.widthOfTextAtSize(str, size);
        let drawX = x;
        if (opts.align === 'right') {
          drawX = opts.maxWidth !== undefined ? x + opts.maxWidth - w : x - w;
        } else if (opts.align === 'center') {
          drawX = opts.maxWidth !== undefined ? x + (opts.maxWidth - w) / 2 : x - w / 2;
        }
        page.drawText(str, { x: drawX, y: yPos, size, font, color });
      };

      // ── 1. Brand Header ──────────────────────────────────────────────
      const hy = PAGE_H - MARGIN;

      // Draw custom logo with alignment & offsets
      if (showHeaderLogo && logoImage) {
        let maxLogoW = 95;
        let maxLogoH = 50;
        if (logoSize === 'compact') {
          maxLogoW = 75;
          maxLogoH = 40;
        } else if (logoSize === 'large') {
          maxLogoW = 125;
          maxLogoH = 60;
        }
        const aspect = logoImage.width / logoImage.height;
        let drawW = maxLogoW;
        let drawH = drawW / aspect;
        if (drawH > maxLogoH) {
          drawH = maxLogoH;
          drawW = drawH * aspect;
        }

        let logoX = left + 6;
        if (logoAlign === 'center') {
          logoX = left + (contentW - drawW) / 2;
        } else if (logoAlign === 'right') {
          logoX = right - drawW - 6;
        }
        logoX += logoXOffset;

        const logoY = hy - 64 + (maxLogoH - drawH) / 2 + logoYOffset;
        page.drawImage(logoImage, {
          x: logoX,
          y: logoY,
          width: drawW,
          height: drawH,
        });
      }

      // Title & Copy type with configurable alignment
      let titleX = right - 5;
      let tAlign: 'left' | 'center' | 'right' = titleAlign;
      if (titleAlign === 'center') {
        titleX = left;
      } else if (titleAlign === 'left') {
        titleX = left + 5;
      }
      text(invoiceTitle, titleX, hy - 14, { size: 10, font: bold, align: tAlign, maxWidth: contentW });
      if (copyInfo.title) {
        text(`(${copyInfo.title})`, titleX, hy - 26, { size: 7, font: bold, align: tAlign, maxWidth: contentW });
      }

      // Center Brand Identity
      let brandX = left;
      let bAlign: 'left' | 'center' | 'right' = brandAlign;
      if (brandAlign === 'left') {
        brandX = left + 5;
      } else if (brandAlign === 'right') {
        brandX = right - 5;
      }
      text(brandName, brandX, hy - 18, { size: 20, font: bold, align: bAlign, maxWidth: contentW });
      if (tagline) {
        text(tagline, brandX, hy - 36, { size: 9.5, font: regular, align: bAlign, maxWidth: contentW });
      }
      if (showHeaderFssai && fssaiNo) {
        text(`(FSSAI: ${fssaiNo})`, brandX, hy - 52, { size: 9.5, font: regular, align: bAlign, maxWidth: contentW });
      }

      const headerBottomY = hy - HEADER_H;
      hline(headerBottomY, left, right);

      // ── 2. Top Address Band ──────────────────────────────────────────
      const companyBandBottomY = headerBottomY - COMPANY_BAND_H;

      if (showBranchOffice) {
        vline(midX, companyBandBottomY, headerBottomY);

        // Left: Marketed By / Seller
        text(sellerBoxLabel, left + 5, headerBottomY - 16, { size: 9.5, font: bold });
        text(companyName, left + 5, headerBottomY - 31, { size: 9.5, font: regular, maxWidth: leftW - 10 });
        const rawAddrLines = companyAddress.split('\n').map((s) => s.trim()).filter(Boolean);
        text(rawAddrLines[0] || '', left + 5, headerBottomY - 45, { size: 9.5, font: regular, maxWidth: leftW - 10 });
        text(rawAddrLines[1] || '', left + 5, headerBottomY - 59, { size: 9.5, font: regular, maxWidth: leftW - 10 });
        text(`GST NO: ${companyGstin}`, left + 5, headerBottomY - 73, { size: 9.5, font: regular });

        // Right: Branch Office & Sales Point
        text(branchBoxLabel, midX + 5, headerBottomY - 16, { size: 9.5, font: bold });
        const rawBranchLines = branchOffice.split('\n').map((s) => s.trim()).filter(Boolean);
        text(rawBranchLines[0] || '', midX + 5, headerBottomY - 31, { size: 9.5, font: regular, maxWidth: rightW - 10 });
        text(rawBranchLines[1] || '', midX + 5, headerBottomY - 45, { size: 9.5, font: regular, maxWidth: rightW - 10 });
        if (branchFssai) {
          text(`FSSAI No: ${branchFssai}`, midX + 5, headerBottomY - 59, { size: 9.5, font: regular });
        }
      } else {
        text(sellerBoxLabel, left + 5, headerBottomY - 16, { size: 10, font: bold });
        text(companyName, left + 5, headerBottomY - 31, { size: 9.5, font: regular });
        const rawAddrLines = companyAddress.split('\n').map((s) => s.trim()).filter(Boolean);
        text(rawAddrLines.join(', '), left + 5, headerBottomY - 45, { size: 9.5, font: regular, maxWidth: contentW - 10 });
        text(`GST NO: ${companyGstin}   |   Contact: ${contactPhone}   |   State: ${sellerState.name} (${sellerState.code})`, left + 5, headerBottomY - 63, { size: 9.5, font: regular });
      }

      hline(companyBandBottomY, left, right);

      // ── 3. Middle Section: Parties & Dispatch Grid ────────────────────
      const middleGridBottomY = companyBandBottomY - MIDDLE_GRID_H;
      vline(midX, middleGridBottomY, companyBandBottomY);

      // Left: Buyer & Consignee
      const buyerBottom = companyBandBottomY - buyerH;
      hline(buyerBottom, left, midX);

      // Buyer:
      let ay = companyBandBottomY - 14;
      text(buyerBoxLabel, left + 5, ay, { size: 9, font: bold });
      ay -= 11;
      text(buyerName, left + 5, ay, { size: 8.5, font: bold, maxWidth: leftW - 10 });
      ay -= 10.5;
      const buyerAddrLines = buyerAddress ? wrapText(regular, buyerAddress.replace(/\n/g, ', '), 7.5, leftW - 10) : [];
      const customerPhone = bill.mmCustomer?.phone || bill.customer?.phone || '';
      const hasPhone = customerPhone && customerPhone !== '0000000000';
      for (const line of buyerAddrLines.slice(0, 2)) {
        text(line, left + 5, ay, { size: 7.5, font: regular, maxWidth: leftW - 10 });
        ay -= 10;
      }
      if (showPartiesContact && hasPhone) {
        text(`Contact : ${customerPhone}`, left + 5, ay, { size: 7.5, font: regular });
        ay -= 10;
      }
      text(`GST NO: ${buyerGstin || '—'}`, left + 5, ay, { size: 7.5, font: regular });
      ay -= 10;
      text(`State Name : ${buyerState.name}, Code : ${buyerState.code}`, left + 5, ay, { size: 7.5, font: regular });

      // Consignee:
      let cay = buyerBottom - 14;
      text(consigneeBoxLabel, left + 5, cay, { size: 9, font: bold });
      cay -= 11;
      text(consigneeName, left + 5, cay, { size: 8.5, font: bold, maxWidth: leftW - 10 });
      cay -= 10.5;
      const consigneeAddrLines = consigneeAddress ? wrapText(regular, consigneeAddress.replace(/\n/g, ', '), 7.5, leftW - 10) : [];
      for (const line of consigneeAddrLines.slice(0, 2)) {
        text(line, left + 5, cay, { size: 7.5, font: regular, maxWidth: leftW - 10 });
        cay -= 10;
      }
      text(`GST NO: ${consigneeGstin || '—'}`, left + 5, cay, { size: 7.5, font: regular });
      cay -= 10;
      text(`State Name : ${consigneeState.name}, Code : ${consigneeState.code}`, left + 5, cay, { size: 7.5, font: regular });
      if (showPlaceOfSupply) {
        cay -= 10;
        text(`Place of Supply : ${placeOfSupply}`, left + 5, cay, { size: 7.5, font: regular });
      }

      // Right: 7-Row Dispatch Grid
      const ROW_H = MIDDLE_GRID_H / 7;
      let ry = companyBandBottomY;
      vline(col2X, middleGridBottomY, companyBandBottomY);

      // Row 1: Bill No. | Date:
      text(labelBillNo, midX + 4, ry - 11, { size: 8, font: regular });
      text(bill.billNumber, midX + 4, ry - 21, { size: 8, font: bold, maxWidth: col2X - midX - 8 });
      text(labelDate, col2X + 4, ry - 11, { size: 8, font: regular });
      text(formatTallyDate(bill.billDate), col2X + 4, ry - 21, { size: 8, font: bold, maxWidth: right - col2X - 8 });
      ry -= ROW_H;
      hline(ry, midX, right);

      // Row 2: Delivery Note | Terms of Payment
      text(labelDeliveryNote, midX + 4, ry - 11, { size: 8, font: regular });
      if (bill.deliveryNote) {
        text(bill.deliveryNote, midX + 4, ry - 21, { size: 7.5, font: regular, maxWidth: col2X - midX - 8 });
      }
      text(labelPaymentTerms, col2X + 4, ry - 11, { size: 8, font: regular });
      const paymentDisplay = bill.termsOfPayment || bill.paymentMode || '';
      if (paymentDisplay) {
        text(paymentDisplay, col2X + 4, ry - 21, { size: 8, font: bold, maxWidth: right - col2X - 8 });
      }
      ry -= ROW_H;
      hline(ry, midX, right);

      // Row 3: Buyer's Order No. | Date:
      text(labelBuyerOrderNo, midX + 4, ry - 11, { size: 8, font: regular });
      if (bill.buyersOrderNo) {
        text(bill.buyersOrderNo, midX + 4, ry - 21, { size: 7.5, font: regular, maxWidth: col2X - midX - 8 });
      }
      text(labelDate, col2X + 4, ry - 11, { size: 8, font: regular });
      if (bill.buyersOrderDate) {
        text(formatTallyDate(bill.buyersOrderDate), col2X + 4, ry - 21, { size: 7.5, font: regular, maxWidth: right - col2X - 8 });
      }
      ry -= ROW_H;
      hline(ry, midX, right);

      // Row 4: Dispatch Doc No. | Date:
      text(labelDispatchDoc, midX + 4, ry - 11, { size: 8, font: regular });
      const dispatchDocDisplay = bill.dispatchDocNo || (bill.ewayBillNo ? `EWAY: ${bill.ewayBillNo}` : '');
      if (dispatchDocDisplay) {
        text(dispatchDocDisplay, midX + 4, ry - 21, { size: 7.5, font: regular, maxWidth: col2X - midX - 8 });
      }
      text(labelDate, col2X + 4, ry - 11, { size: 8, font: regular });
      if (bill.deliveryNoteDate) {
        text(formatTallyDate(bill.deliveryNoteDate), col2X + 4, ry - 21, { size: 7.5, font: regular, maxWidth: right - col2X - 8 });
      }
      ry -= ROW_H;
      hline(ry, midX, right);

      // Row 5: Despatched through
      text(labelDespatchedThrough, midX + 4, ry - 11, { size: 8, font: regular });
      const dispatchDetails = [bill.despatchedThrough, bill.vehicleNo].filter(Boolean).join(' / ');
      if (dispatchDetails) {
        text(dispatchDetails, midX + 4, ry - 21, { size: 7.5, font: regular, maxWidth: right - midX - 8 });
      }
      ry -= ROW_H;
      hline(ry, midX, right);

      // Row 6: Destination
      text(labelDestination, midX + 4, ry - 11, { size: 8, font: regular });
      if (bill.destination) {
        text(bill.destination, midX + 4, ry - 21, { size: 7.5, font: regular, maxWidth: right - midX - 8 });
      }
      ry -= ROW_H;
      hline(ry, midX, right);

      // Row 7: Terms of delivery
      text(labelTermsDelivery, midX + 4, ry - 11, { size: 8, font: regular });
      const termsDisplay = bill.termsOfDelivery || bill.notes || '';
      if (termsDisplay) {
        text(termsDisplay, midX + 4, ry - 21, { size: 7.5, font: regular, maxWidth: right - midX - 8 });
      }
      hline(middleGridBottomY, left, right);

      // ── 4. Items Table Header ─────────────────────────────────────────
      const tableHeaderBottom = middleGridBottomY - TABLE_HEADER_H;
      const baseline = middleGridBottomY - 15;

      for (const col of cols) {
        text(col.label, col.x + (col.align === 'left' ? 4 : 0), baseline, {
          size: 8.5,
          font: bold,
          align: col.align,
          maxWidth: col.w - (col.align === 'left' ? 8 : 0),
        });
      }
      hline(tableHeaderBottom, left, right);

      // ── 5. Items Rows ─────────────────────────────────────────────────
      let ty = tableHeaderBottom;
      const snoCol = cols.find((c) => c.key === 'sno')!;
      const dCol = cols.find((c) => c.key === 'desc')!;
      const unitCol = cols.find((c) => c.key === 'unit');
      const hsnCol = cols.find((c) => c.key === 'hsn');
      const qtyCol = cols.find((c) => c.key === 'qty')!;
      const rateCol = cols.find((c) => c.key === 'rate')!;
      const amtCol = cols.find((c) => c.key === 'amt')!;

      for (const il of pageItems) {
        const item = bill.items[il.itemIndex]!;
        const rowTop = ty;

        text(String(il.itemIndex + 1), snoCol.x, rowTop - 11, { size: 8, font: regular, align: 'center', maxWidth: snoCol.w });

        let ly = rowTop - 11;
        for (const line of il.nameLines) {
          text(line, dCol.x + 4, ly, { size: 8, font: bold });
          ly -= 10;
        }

        if (unitCol) {
          const kgsText = item.unit?.toUpperCase() === 'KGS' || !item.unit ? formatQty3(item.qty) : (item.unit || '—');
          text(kgsText, unitCol.x, rowTop - 11, { size: 8, font: regular, align: 'center', maxWidth: unitCol.w });
        }

        if (hsnCol) {
          text(item.hsnSac || '210690', hsnCol.x, rowTop - 11, { size: 8, font: regular, align: 'center', maxWidth: hsnCol.w });
        }

        text(formatQty3(item.qty), qtyCol.x, rowTop - 11, {
          size: 8,
          font: regular,
          align: 'right',
          maxWidth: qtyCol.w - 4,
        });

        text(formatAmt2(il.baseUnitPrice), rateCol.x, rowTop - 11, {
          size: 8,
          font: regular,
          align: 'right',
          maxWidth: rateCol.w - 4,
        });

        text(formatAmt2(il.baseAmt), amtCol.x, rowTop - 11, {
          size: 8,
          font: regular,
          align: 'right',
          maxWidth: amtCol.w - 4,
        });

        ty -= il.height;
      }

      // Inline Output CGST / SGST / IGST rows under items on the last page
      if (isLast && showInlineTax && bill.gstAmount > 0) {
        ty -= 4;
        if (bill.isInterState) {
          const rateStr = fullRate !== undefined ? `${fullRate}%` : `${hsnGroups[0]?.igstRate ?? 0}%`;
          text(`OUTPUT IGST ${rateStr}`, dCol.x + 20, ty - 10, { size: 8, font: bold });
          text(fullRate !== undefined ? String(fullRate) : String(hsnGroups[0]?.igstRate ?? 0), rateCol.x, ty - 10, {
            size: 8,
            font: regular,
            align: 'right',
            maxWidth: rateCol.w - 4,
          });
          text(formatAmt2(bill.gstAmount), amtCol.x, ty - 10, { size: 8, font: regular, align: 'right', maxWidth: amtCol.w - 4 });
          ty -= 14;
        } else {
          const { cgstP, sgstP } = splitTaxP(bill.gstAmount, false);
          const rateStr = halfRate !== undefined ? `${halfRate}%` : `${hsnGroups[0]?.cgstRate ?? 0}%`;
          const rateVal = halfRate !== undefined ? String(halfRate) : String(hsnGroups[0]?.cgstRate ?? 0);

          text(`OUTPUT CGST ${rateStr}`, dCol.x + 20, ty - 10, { size: 8, font: bold });
          text(rateVal, rateCol.x, ty - 10, { size: 8, font: regular, align: 'right', maxWidth: rateCol.w - 4 });
          text(formatAmt2(cgstP), amtCol.x, ty - 10, { size: 8, font: regular, align: 'right', maxWidth: amtCol.w - 4 });
          ty -= 14;

          text(`OUTPUT SGST ${rateStr}`, dCol.x + 20, ty - 10, { size: 8, font: bold });
          text(rateVal, rateCol.x, ty - 10, { size: 8, font: regular, align: 'right', maxWidth: rateCol.w - 4 });
          text(formatAmt2(sgstP), amtCol.x, ty - 10, { size: 8, font: regular, align: 'right', maxWidth: amtCol.w - 4 });
          ty -= 14;
        }
      }

      const tableBottom = isLast ? reservedBottomY : Math.min(ty - 20, reservedBottomY);
      const totalRowBottom = tableBottom - TOTAL_ROW_H;

      // Draw vertical column dividers
      for (const c of cols.slice(1)) {
        const mergeIntoTotal = isLast && (c.key === 'desc' || c.key === 'unit' || c.key === 'hsn');
        const lowerY = isLast ? (mergeIntoTotal ? tableBottom : totalRowBottom) : tableBottom;
        vline(c.x, lowerY, middleGridBottomY);
      }
      hline(tableBottom, left, right);

      if (!isLast) {
        text('(Continued on next page...)', left, ty - 14, { size: 8, font: bold, align: 'center', maxWidth: contentW });
      } else {
        // ── Total Row ──
        let sy = tableBottom;
        const totalBaseline = sy - 12;
        text('Total', dCol.x + 4, totalBaseline, { size: 8.5, font: bold });
        text(formatQty3(totalQty), qtyCol.x, totalBaseline, {
          size: 8.5,
          font: bold,
          align: 'right',
          maxWidth: qtyCol.w - 4,
        });
        text(`Rs.  ${formatAmt2(bill.grandTotal)}`, amtCol.x, totalBaseline, {
          size: 9,
          font: bold,
          align: 'right',
          maxWidth: amtCol.w - 4,
        });

        sy -= TOTAL_ROW_H;
        hline(sy, left, right);

        // ── Amount Chargeable (in words) & E. & O.E ──
        if (showAmountInWords || showEoe) {
          if (showAmountInWords) {
            text('Amount Chargeable (in words)', left + 6, sy - 8, { size: 6.5, font: regular });
            text(formatWordsINR(bill.grandTotal), left + 6, sy - 18, { size: 8, font: bold, maxWidth: contentW - 80 });
          }
          if (showEoe) {
            text('E. & O.E', right - 8, sy - 10, { size: 7.5, font: bold, align: 'right' });
          }
          sy -= WORDS_EOE_H;
          hline(sy, left, right);
        }

        // ── HSN/SAC Tax Summary Table ──
        if (showTaxSummaryTable) {
          const isInter = bill.isInterState;
          const hsnX = left;
          const taxValX = left + 80;
          const cgstX = left + 175;
          const cgstAmtX = cgstX + 45;
          const sgstX = cgstAmtX + 75;
          const sgstAmtX = sgstX + 45;
          const totTaxX = sgstAmtX + 75;

          const hsnTopY = sy;
          const subHeaderY = sy - 9;

          if (isInter) {
            const igstAmtX = cgstX + 60;
            text('HSN/SAC', hsnX, sy - 12, { size: 7.5, font: bold, align: 'center', maxWidth: 80 });
            text('Taxable Value', taxValX, sy - 12, { size: 7.5, font: bold, align: 'right', maxWidth: 91 });
            text('IGST', cgstX, sy - 7, { size: 7.5, font: bold, align: 'center', maxWidth: 240 });
            hline(subHeaderY, cgstX, totTaxX);
            text('Rate', cgstX, sy - 16, { size: 6.5, font: bold, align: 'center', maxWidth: 60 });
            text('Amount', igstAmtX, sy - 16, { size: 6.5, font: bold, align: 'right', maxWidth: 176 });
            text('Total Tax Amount', totTaxX, sy - 12, { size: 7.5, font: bold, align: 'right', maxWidth: right - totTaxX - 4 });
          } else {
            text('HSN/SAC', hsnX, sy - 12, { size: 7.5, font: bold, align: 'center', maxWidth: 80 });
            text('Taxable Value', taxValX, sy - 12, { size: 7.5, font: bold, align: 'right', maxWidth: 91 });
            text('CGST', cgstX, sy - 7, { size: 7.5, font: bold, align: 'center', maxWidth: 120 });
            text('SGST/UTGST', sgstX, sy - 7, { size: 7.5, font: bold, align: 'center', maxWidth: 120 });
            hline(subHeaderY, cgstX, totTaxX);
            text('Rate', cgstX, sy - 16, { size: 6.5, font: bold, align: 'center', maxWidth: 45 });
            text('Amount', cgstAmtX, sy - 16, { size: 6.5, font: bold, align: 'right', maxWidth: 71 });
            text('Rate', sgstX, sy - 16, { size: 6.5, font: bold, align: 'center', maxWidth: 45 });
            text('Amount', sgstAmtX, sy - 16, { size: 6.5, font: bold, align: 'right', maxWidth: 71 });
            text('Total Tax Amount', totTaxX, sy - 12, { size: 7.5, font: bold, align: 'right', maxWidth: right - totTaxX - 4 });
          }

          sy -= 20;
          hline(sy, left, right);

          for (const g of hsnGroups) {
            text(g.hsnSac || '210690', hsnX, sy - 9.5, { size: 7.5, font: regular, align: 'center', maxWidth: 80 });
            text(formatAmt2(g.taxableValue), taxValX, sy - 9.5, { size: 7.5, font: regular, align: 'right', maxWidth: 91 });
            if (isInter) {
              const igstAmtX = cgstX + 60;
              text(`${g.igstRate}%`, cgstX, sy - 9.5, { size: 7.5, font: regular, align: 'center', maxWidth: 60 });
              text(formatAmt2(g.igstAmount), igstAmtX, sy - 9.5, { size: 7.5, font: regular, align: 'right', maxWidth: 176 });
              text(formatAmt2(g.igstAmount), totTaxX, sy - 9.5, { size: 7.5, font: regular, align: 'right', maxWidth: right - totTaxX - 4 });
            } else {
              text(`${g.cgstRate}%`, cgstX, sy - 9.5, { size: 7.5, font: regular, align: 'center', maxWidth: 45 });
              text(formatAmt2(g.cgstAmount), cgstAmtX, sy - 9.5, { size: 7.5, font: regular, align: 'right', maxWidth: 71 });
              text(`${g.sgstRate}%`, sgstX, sy - 9.5, { size: 7.5, font: regular, align: 'center', maxWidth: 45 });
              text(formatAmt2(g.sgstAmount), sgstAmtX, sy - 9.5, { size: 7.5, font: regular, align: 'right', maxWidth: 71 });
              text(formatAmt2(g.cgstAmount + g.sgstAmount), totTaxX, sy - 9.5, {
                size: 7.5,
                font: regular,
                align: 'right',
                maxWidth: right - totTaxX - 4,
              });
            }
            sy -= 13;
          }

          hline(sy, left, right);

          const totalTaxable = hsnGroups.reduce((s, g) => s + g.taxableValue, 0);
          const totalCgst = hsnGroups.reduce((s, g) => s + g.cgstAmount, 0);
          const totalSgst = hsnGroups.reduce((s, g) => s + g.sgstAmount, 0);
          const totalIgst = hsnGroups.reduce((s, g) => s + g.igstAmount, 0);
          const totalTax = totalCgst + totalSgst + totalIgst;

          text('Total', hsnX, sy - 10, { size: 8, font: bold, align: 'center', maxWidth: 80 });
          text(formatAmt2(totalTaxable), taxValX, sy - 10, { size: 8, font: bold, align: 'right', maxWidth: 91 });

          if (isInter) {
            const igstAmtX = cgstX + 60;
            text(formatAmt2(totalIgst), igstAmtX, sy - 10, { size: 8, font: bold, align: 'right', maxWidth: 176 });
            text(formatAmt2(totalIgst), totTaxX, sy - 10, { size: 8, font: bold, align: 'right', maxWidth: right - totTaxX - 4 });
          } else {
            text(formatAmt2(totalCgst), cgstAmtX, sy - 10, { size: 8, font: bold, align: 'right', maxWidth: 71 });
            text(formatAmt2(totalSgst), sgstAmtX, sy - 10, { size: 8, font: bold, align: 'right', maxWidth: 71 });
            text(formatAmt2(totalTax), totTaxX, sy - 10, { size: 8, font: bold, align: 'right', maxWidth: right - totTaxX - 4 });
          }

          sy -= 14;
          hline(sy, left, right);

          vline(taxValX, sy, hsnTopY);
          vline(cgstX, sy, hsnTopY);
          if (isInter) {
            const igstAmtX = cgstX + 60;
            vline(igstAmtX, sy, subHeaderY);
          } else {
            vline(cgstAmtX, sy, subHeaderY);
            vline(sgstX, sy, hsnTopY);
            vline(sgstAmtX, sy, subHeaderY);
          }
          vline(totTaxX, sy, hsnTopY);

          text(`Tax Amount (in words) : ${formatWordsINR(totalTax)}`, left + 6, sy - 11, { size: 7.5, font: bold });
          sy -= 16;
          hline(sy, left, right);
        }

        // Ledger Outstanding Balance
        if (options.previousDueP && options.previousDueP > 0) {
          const netPayable = bill.grandTotal + options.previousDueP;
          text(
            `Ledger Balance  ::  Previous Due: ${formatAmt2(options.previousDueP)}    |    Current Bill: ${formatAmt2(bill.grandTotal)}    |    Total Net Payable: ${formatAmt2(netPayable)}`,
            left + 6,
            sy - 9.5,
            { size: 7, font: bold, color: rgb(0.1, 0.1, 0.1) }
          );
          sy -= 14;
          hline(sy, left, right);
        }

        // ── Bank Details, Declaration & Signatory ──
        const bankTopY = sy;
        vline(midX, bottomLimit, bankTopY);

        if (showBankDetails) {
          let bky = bankTopY - 10;
          text(`Bank: ${bankName}`, left + 6, bky, { size: 8, font: regular });
          bky -= 12;
          text(`A/C No: ${bankAccountNumber || ''}`, left + 6, bky, { size: 8, font: regular });
          bky -= 12;
          text(`IFSC No: ${bankIfsc}`, left + 6, bky, { size: 8, font: regular });
        }

        const declTopY = bankTopY - 44;
        hline(declTopY, left, midX);
        text(declarationTitle, left + 6, declTopY - 8, { size: 7, font: bold });
        const declLines = wrapText(regular, declarationText, 6.5, leftW - 12);
        let dly = declTopY - 17;
        for (const line of declLines.slice(0, 2)) {
          text(line, left + 6, dly, { size: 6.5, font: regular });
          dly -= 8;
        }

        text(signatoryPrefix, right - 10, bankTopY - 11, { size: 8, font: bold, align: 'right' });
        text(signatoryLabel, right - 10, bottomLimit + 8, { size: 7.5, font: regular, align: 'right' });
      }

      // Outer Border
      const borderBottom = isLast ? bottomLimit : tableBottom;
      page.drawRectangle({
        x: left,
        y: borderBottom,
        width: contentW,
        height: headerBottomY - borderBottom,
        borderColor: BLACK,
        borderWidth: THIN,
      });

      // Bottom legal / software notice
      if (showLegalFootnote) {
        text(`SUBJECT TO ${jurisdiction} JURISDICTION`, left, borderBottom - 8, { size: 5.5, font: regular });
        text(footerComputerGeneratedText, right, borderBottom - 8, { size: 5.5, font: regular, align: 'right' });
      }
    });
  }

  return await doc.save();
}

export async function generateMmA4InvoiceBase64(
  bill: Bill,
  settings: Partial<Settings>,
  options: MmA4InvoiceOptions = {}
): Promise<string> {
  const bytes = await generateMmA4InvoicePDF(bill, settings, options);
  return bytesToBase64(bytes);
}

export const generateMmA4InvoicePDFBase64 = generateMmA4InvoiceBase64;

export async function downloadMmA4InvoicePDF(
  bill: Bill,
  settings: Partial<Settings>,
  options: MmA4InvoiceOptions = {}
) {
  const bytes = await generateMmA4InvoicePDF(bill, settings, options);
  const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], {
    type: 'application/pdf',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const copySuffix = options.copyType ? `-${options.copyType.toLowerCase()}` : '';
  a.download = `${bill.billNumber}-tax-invoice${copySuffix}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function printMmA4InvoicePDF(
  bill: Bill,
  settings: Partial<Settings>,
  options: MmA4InvoiceOptions = {}
) {
  const bytes = await generateMmA4InvoicePDF(bill, settings, options);
  const { printPdfBytes } = await import('@/lib/printPdf');
  printPdfBytes(bytes);
}
