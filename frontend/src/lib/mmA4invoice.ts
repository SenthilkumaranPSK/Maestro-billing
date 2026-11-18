import { PDFDocument, PDFFont, PDFImage, PDFPage, rgb } from 'pdf-lib';
import { type Bill, type Settings, MM_DEFAULTS, paisaToRupee } from '@/types';
import { numberToIndianWords } from '@/lib/amountInWords';
import { bytesToBase64 } from '@/lib/pdf';
import { embedBrandFonts } from '@/lib/brandFont';
import { wrapText } from '@/lib/a4invoice';
import { computeHsnSummary } from '@/lib/hsnSummary';
import { splitTaxP } from '@/lib/billMath';

/**
 * MM/A4 Wholesale Tax Invoice layout matching the official client sample
 * (New sample.pdf).
 *
 * Fully customizable via MM Settings (mm_company_name, mm_brand_name,
 * mm_tagline, mm_fssai_no, mm_address, mm_branch_office, mm_branch_fssai,
 * mm_gstin, mm_contact, mm_bank_account_name, mm_bank_name, etc.),
 * pre-populated with SREE MEENAKSHI Enterprises / City Union Bank defaults.
 */

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

const PAGE_W = 595.28; // A4, pt
const PAGE_H = 841.89;
const MARGIN = 30; // Matches exact margin from New sample.pdf

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
      const response = await fetch(p);
      if (response.ok) {
        const buf = await response.arrayBuffer();
        mmLogoBytesCache = new Uint8Array(buf);
        return mmLogoBytesCache;
      }
    } catch {
      // ignore
    }
  }
  if (typeof window === 'undefined') {
    try {
      const fsMod = 'fs';
      const pathMod = 'path';
      const fs = await import(/* @vite-ignore */ fsMod);
      const path = await import(/* @vite-ignore */ pathMod);
    const candidatePaths = [
      path.resolve(process.cwd(), 'frontend/public/mm-logo.png'),
      path.resolve(process.cwd(), 'public/mm-logo.png'),
      'C:/000 MINE/My Codzz/Maestro/Billing/Test 1 - Claude/codes 2/frontend/public/mm-logo.png',
      'C:/000 MINE/My Codzz/Maestro/Billing/Test 1 - Claude/codes/frontend/public/mm-logo.png',
    ];
    for (const cp of candidatePaths) {
      if (fs.existsSync(cp)) {
        const data = fs.readFileSync(cp);
        if (data) {
          mmLogoBytesCache = new Uint8Array(data);
          return mmLogoBytesCache;
        }
      }
    }
    } catch {
      // ignore
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

  // Enterprise details from settings or defaults
  const companyName = mmSettings.mm_company_name || 'SRI MEENAKSHI Enterprises';
  const brandName = mmSettings.mm_brand_name || MM_DEFAULTS.brand_name;
  const tagline = mmSettings.mm_tagline || '- Fully Automated & 100% Hygiene Products';
  const fssaiNo = mmSettings.mm_fssai_no || MM_DEFAULTS.fssai_no;
  const companyAddress = mmSettings.mm_address || '21, Pachepatty Krishna Nagar 8th Cross\nAmmapet, Salem - 636003';
  const branchOffice = mmSettings.mm_branch_office || '35-A, Thiyagi Natesan St No 1\nAmmapet, Salem.';
  const branchFssai = mmSettings.mm_branch_fssai || '22426582000581';
  const companyGstin = mmSettings.mm_gstin || '33BAKPM3311D1Z9';
  const contactPhone = mmSettings.mm_contact || MM_DEFAULTS.contact;
  const companyStateName = mmSettings.mm_state_name || MM_DEFAULTS.state_name;
  const companyStateCode = mmSettings.mm_state_code || MM_DEFAULTS.state_code;

  // Bank details
  const bankAccountName = mmSettings.mm_bank_account_name || companyName;
  const bankName = mmSettings.mm_bank_name || 'City Union Bank';
  const bankAccountNumber = mmSettings.mm_bank_account_number || '';
  const bankBranch = mmSettings.mm_bank_branch || 'Ammapet';
  const bankIfsc = mmSettings.mm_bank_ifsc || 'CIUB0000188';
  const jurisdiction = mmSettings.mm_jurisdiction || MM_DEFAULTS.jurisdiction;
  const showDispatchGrid = mmSettings.mm_show_dispatch_grid !== 'false';
  const showBankDetails = mmSettings.mm_show_bank_details !== 'false';
  const showDeclaration = mmSettings.mm_show_declaration !== 'false';
  const logoPosition = mmSettings.mm_logo_position || 'left';

  // Customer / Buyer details
  const isPlaceholderCustomer = bill.mmCustomer?.phone === '0000000000';
  const buyerName = bill.buyerName || (isPlaceholderCustomer ? 'Customer' : bill.mmCustomer?.name) || 'Customer';
  const buyerAddress = (bill.buyerName ? bill.buyerAddress : bill.mmCustomer?.address) || '';
  const buyerGstin = (bill.buyerName ? bill.buyerGstin : bill.mmCustomer?.gstin) || '';
  const buyerState = getStateInfo(buyerGstin, companyStateName, companyStateCode);

  // Consignee details
  const consigneeName = bill.consigneeName || buyerName;
  const consigneeAddress = (bill.consigneeName ? bill.consigneeAddress : buyerAddress) || '';
  const consigneeGstin = (bill.consigneeName ? bill.consigneeGstin : buyerGstin) || '';
  const consigneeState = getStateInfo(consigneeGstin, buyerState.name, buyerState.code);

  const placeOfSupply = bill.destination || buyerState.name;

  const doc = await PDFDocument.create();
  const { regular, bold } = await embedBrandFonts(doc);

  let logoBytes: Uint8Array | null = null;
  let isJpeg = false;

  // Custom uploaded logo from settings takes precedence
  if (mmSettings.mm_logo_data) {
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

  // Fallback to static disk logo
  if (!logoBytes) {
    logoBytes = await fetchMmA4LogoBytes();
  }

  let logoImage: PDFImage | null = null;
  if (logoBytes) {
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
        // ignore invalid format
      }
    }
  }

  const left = MARGIN;
  const right = PAGE_W - MARGIN;
  const contentW = right - left;
  const midX = 310; // Exactly matches New sample.pdf vertical divider
  const leftW = midX - left;
  const rightW = right - midX;
  const col2X = 440; // Exactly matches New sample.pdf date/payment col divider

  let page: PDFPage;

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

  // ── 1. Top Brand Header (MORU MORU SNACKS) ──────────────────────────────────
  function drawBrandHeader(copyTitleText?: string): number {
    const hy = PAGE_H - MARGIN; // ~811.89

    // Draw Moru Moru master logo on the top left of the invoice (enlarged & utilizing top space)
    if (logoImage) {
      const maxLogoW = 135;
      const maxLogoH = 68;
      const aspect = logoImage.width / logoImage.height;
      let drawW = maxLogoW;
      let drawH = drawW / aspect;
      if (drawH > maxLogoH) {
        drawH = maxLogoH;
        drawW = drawH * aspect;
      }
      // Minimal 3.5pt padding from the top border (hy) so it fully utilizes the top space
      const slotH = 68;
      const logoY = hy - 3.5 - drawH - (slotH - drawH) / 2;
      const logoX = logoPosition === 'center' ? left + (contentW - drawW) / 2 : left + 6;
      page.drawImage(logoImage, {
        x: logoX,
        y: logoY,
        width: drawW,
        height: drawH,
      });
    }

    text(brandName, left, hy - 18, { size: 20, font: bold, align: 'center', maxWidth: contentW });
    text('- The Mastero Food Products', left, hy - 36, { size: 10, font: regular, align: 'center', maxWidth: contentW });
    if (fssaiNo) {
      text(`(FSSAI: ${fssaiNo})`, left, hy - 52, { size: 10, font: regular, align: 'center', maxWidth: contentW });
    }

    // Divider line below header at y ≈ 736.89
    const lineY = hy - 75;
    hline(lineY, left, right);
    return lineY;
  }

  // ── 2. Top Address Band: Marketed By (Left) & B.Office (Right) ──────────────
  const COMPANY_BAND_H = 85;

  function drawCompanyBand(topY: number): number {
    const bottomY = topY - COMPANY_BAND_H;

    // Outer and vertical dividing lines
    vline(midX, bottomY, topY);

    // Left: Marketed By
    text('Marketed By:', left + 5, topY - 16, { size: 9.5, font: bold });
    text(companyName, left + 5, topY - 31, { size: 9.5, font: regular });
    const rawAddrLines = companyAddress
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const addr1 = rawAddrLines[0] || '21, Pachepatty Krishna Nagar 8th Cross';
    const addr2 = rawAddrLines[1] || 'Ammapet, Salem - 636003';
    text(addr1, left + 5, topY - 45, { size: 9.5, font: regular });
    text(addr2, left + 5, topY - 59, { size: 9.5, font: regular });
    text(`GST NO: ${companyGstin}`, left + 5, topY - 73, { size: 9.5, font: regular });

    // Right: B.Office & Sales Point
    text('B.Office & Sales Point', midX + 5, topY - 16, { size: 9.5, font: bold });
    const rawBranchLines = branchOffice
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const branch1 = rawBranchLines[0] || '35-A, Thiyagi Natesan St No 1';
    const branch2 = rawBranchLines[1] || 'Ammapet, Salem.';
    text(branch1, midX + 5, topY - 31, { size: 9.5, font: regular });
    text(branch2, midX + 5, topY - 45, { size: 9.5, font: regular });
    text(`FSSAI No: ${branchFssai}`, midX + 5, topY - 59, { size: 9.5, font: regular });

    // Horizontal line closing address band at y ≈ 651.89
    hline(bottomY, left, right);
    return bottomY;
  }

  // ── 3. Middle Section: Buyer/Consignee (Left) & 7 Dispatch Rows (Right) ────
  const MIDDLE_GRID_H = 182; // y = 651.89 to 469.89

  function drawPartiesAndDispatchGrid(topY: number): number {
    const bottomY = topY - MIDDLE_GRID_H;

    // Vertical line dividing Left (Buyer/Consignee) and Right (Dispatch Grid)
    vline(midX, bottomY, topY);

    // ── Left Side: Buyer (Top) & Consignee (Bottom) ──
    const buyerH = 76;
    const buyerBottom = topY - buyerH; // y ≈ 575.89
    hline(buyerBottom, left, midX);

    // Top: Buyer:
    let ay = topY - 14;
    text('Buyer:', left + 5, ay, { size: 9, font: bold });
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
    if (hasPhone) {
      text(`Contact : ${customerPhone}`, left + 5, ay, { size: 7.5, font: regular });
      ay -= 10;
    }
    text(`GST NO: ${buyerGstin || '—'}`, left + 5, ay, { size: 7.5, font: regular });
    ay -= 10;
    text(`State Name : ${buyerState.name}, Code : ${buyerState.code}`, left + 5, ay, { size: 7.5, font: regular });

    // Bottom: Consignee:
    let cay = buyerBottom - 14;
    text('Consignee:', left + 5, cay, { size: 9, font: bold });
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
    cay -= 10;
    text(`Place of Supply : ${placeOfSupply}`, left + 5, cay, { size: 7.5, font: regular });

    // ── Right Side: 7-Row Dispatch Grid (Each with explicit dividing lines) ──
    const ROW_H = 26;
    let ry = topY;

    // Vertical line between Col 1 & Col 2 across ALL 7 ROWS!
    vline(col2X, bottomY, topY);

    // Row 1: Bill No. | Date:
    text('Bill No.', midX + 4, ry - 11, { size: 8, font: regular });
    text(bill.billNumber, midX + 4, ry - 21, { size: 8, font: bold, maxWidth: 120 });
    text('Date:', col2X + 4, ry - 11, { size: 8, font: regular });
    text(formatTallyDate(bill.billDate), col2X + 4, ry - 21, { size: 8, font: bold, maxWidth: 110 });
    ry -= ROW_H;
    hline(ry, midX, right);

    // Row 2: Delivery Note | Mode/Terms of Payment
    text('Delivery Note', midX + 4, ry - 11, { size: 8, font: regular });
    if (bill.deliveryNote) {
      text(bill.deliveryNote, midX + 4, ry - 21, { size: 7.5, font: regular, maxWidth: 120 });
    }
    text('Mode/Terms of Payment', col2X + 4, ry - 11, { size: 8, font: regular });
    const paymentDisplay = bill.termsOfPayment || bill.paymentMode || '';
    if (paymentDisplay) {
      text(paymentDisplay, col2X + 4, ry - 21, { size: 8, font: bold, maxWidth: 110 });
    }
    ry -= ROW_H;
    hline(ry, midX, right);

    // Row 3: Buyer's Order No. | Date:
    text("Buyer's Order No.", midX + 4, ry - 11, { size: 8, font: regular });
    if (bill.buyersOrderNo) {
      text(bill.buyersOrderNo, midX + 4, ry - 21, { size: 7.5, font: regular, maxWidth: 120 });
    }
    text('Date:', col2X + 4, ry - 11, { size: 8, font: regular });
    if (bill.buyersOrderDate) {
      text(formatTallyDate(bill.buyersOrderDate), col2X + 4, ry - 21, { size: 7.5, font: regular, maxWidth: 110 });
    }
    ry -= ROW_H;
    hline(ry, midX, right);

    // Row 4: Dispatch Doc No. | Date:
    text('Dispatch Doc No.', midX + 4, ry - 11, { size: 8, font: regular });
    const dispatchDocDisplay = bill.dispatchDocNo || (bill.ewayBillNo ? `EWAY: ${bill.ewayBillNo}` : '');
    if (dispatchDocDisplay) {
      text(dispatchDocDisplay, midX + 4, ry - 21, { size: 7.5, font: regular, maxWidth: 120 });
    }
    text('Date:', col2X + 4, ry - 11, { size: 8, font: regular });
    if (bill.deliveryNoteDate) {
      text(formatTallyDate(bill.deliveryNoteDate), col2X + 4, ry - 21, { size: 7.5, font: regular, maxWidth: 110 });
    }
    ry -= ROW_H;
    hline(ry, midX, right);

    // Row 5: Despatched through
    text('Despatched through', midX + 4, ry - 11, { size: 8, font: regular });
    const dispatchDetails = [bill.despatchedThrough, bill.vehicleNo].filter(Boolean).join(' / ');
    if (dispatchDetails) {
      text(dispatchDetails, midX + 4, ry - 21, { size: 7.5, font: regular, maxWidth: 120 });
    }
    ry -= ROW_H;
    hline(ry, midX, right);

    // Row 6: Destination
    text('Destination', midX + 4, ry - 11, { size: 8, font: regular });
    if (bill.destination) {
      text(bill.destination, midX + 4, ry - 21, { size: 7.5, font: regular, maxWidth: 120 });
    }
    ry -= ROW_H;
    hline(ry, midX, right);

    // Row 7: Terms of delivery
    text('Terms of delivery', midX + 4, ry - 11, { size: 8, font: regular });
    const termsDisplay = bill.termsOfDelivery || bill.notes || '';
    if (termsDisplay) {
      text(termsDisplay, midX + 4, ry - 21, { size: 7.5, font: regular, maxWidth: 120 });
    }
    ry -= ROW_H;
    hline(bottomY, left, right); // Explicit line below Terms of delivery across the whole page!

    return bottomY;
  }

  // ── 4. Items Table Columns (Matching New sample.pdf exact coordinates) ──────
  // x: 30, 68, 250, 295, 355, 420, 490, 565.28
  const cols = [
    { key: 'sno', label: 'S.No.', x: 30, w: 38, align: 'center' as const },
    { key: 'desc', label: 'Description of Goods', x: 68, w: 182, align: 'left' as const },
    { key: 'kgs', label: 'KGS', x: 250, w: 45, align: 'center' as const },
    { key: 'hsn', label: 'HSN/SAC', x: 295, w: 60, align: 'center' as const },
    { key: 'qty', label: 'Quantity', x: 355, w: 65, align: 'right' as const },
    { key: 'rate', label: 'Rate per kg', x: 420, w: 70, align: 'right' as const },
    { key: 'amt', label: 'Amount', x: 490, w: right - 490, align: 'right' as const },
  ];

  const TABLE_HEADER_H = 24;

  function drawTableHeader(topY: number): number {
    const headerBottom = topY - TABLE_HEADER_H;
    const baseline = topY - 15;

    text('S.No.', cols[0].x, baseline, { size: 8.5, font: bold, align: 'center', maxWidth: cols[0].w });
    text('Description of Goods', cols[1].x + 4, baseline, { size: 8.5, font: bold });
    text('KGS', cols[2].x, baseline, { size: 8.5, font: bold, align: 'center', maxWidth: cols[2].w });
    text('HSN/SAC', cols[3].x, baseline, { size: 8.5, font: bold, align: 'center', maxWidth: cols[3].w });
    text('Quantity', cols[4].x, baseline, { size: 8.5, font: bold, align: 'center', maxWidth: cols[4].w });
    text('Rate per kg', cols[5].x, baseline, { size: 8.5, font: bold, align: 'center', maxWidth: cols[5].w });
    text('Amount', cols[6].x, baseline, { size: 8.5, font: bold, align: 'center', maxWidth: cols[6].w });

    hline(headerBottom, left, right);
    return headerBottom;
  }

  // ── Summary Block Calculations ─────────────────────────────────────────────
  const hsnGroups = computeHsnSummary(bill);
  const gstRates = [...new Set(bill.items.filter((i) => i.gstRate > 0).map((i) => i.gstRate))];
  const halfRate = gstRates.length === 1 ? gstRates[0]! / 2 : undefined;
  const fullRate = gstRates.length === 1 ? gstRates[0]! : undefined;

  const totalQty = bill.items.reduce((s, i) => s + i.qty, 0);

  const TOTAL_ROW_H = 18;
  const WORDS_EOE_H = 24;
  const HSN_TABLE_H = 18 + hsnGroups.length * 13 + 14 + 16 + 2;
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

  const itemLayouts: ItemLayout[] = bill.items.map((item, idx) => {
    const lines = wrapText(bold, item.productName, 8, cols[1].w - 8);
    const baseAmt = item.totalAmount - item.gstAmount;
    const baseUnitPrice = item.qty ? Math.round(baseAmt / item.qty) : item.unitPrice;
    const height = Math.max(18, lines.length * 10 + 6);
    return { itemIndex: idx, nameLines: lines, height, baseAmt, baseUnitPrice };
  });

  const inlineTaxCount = bill.gstAmount > 0 ? (bill.isInterState ? 1 : 2) : 0;
  const INLINE_TAX_H = inlineTaxCount * 14;

  // Pagination calculation
  const availableItemsH = PAGE_H - MARGIN - 75 - COMPANY_BAND_H - MIDDLE_GRID_H - TABLE_HEADER_H - reservedBottomY;
  const pages: ItemLayout[][] = [];
  let current: ItemLayout[] = [];
  let currentH = 0;

  for (const il of itemLayouts) {
    if (current.length > 0 && currentH + il.height > availableItemsH - INLINE_TAX_H) {
      pages.push(current);
      current = [];
      currentH = 0;
    }
    current.push(il);
    currentH += il.height;
  }
  pages.push(current);

  // ── Render Pages ───────────────────────────────────────────────────────────
  pages.forEach((pageItems, pageIdx) => {
    const isLast = pageIdx === pages.length - 1;
    page = doc.addPage([PAGE_W, PAGE_H]);

    const headerBottomY = drawBrandHeader();
    const companyBandBottomY = drawCompanyBand(headerBottomY);
    const middleGridBottomY = drawPartiesAndDispatchGrid(companyBandBottomY);
    const tableHeaderBottom = drawTableHeader(middleGridBottomY);

      let ty = tableHeaderBottom;

      // Render line items
      for (const il of pageItems) {
        const item = bill.items[il.itemIndex]!;
        const rowTop = ty;

        text(String(il.itemIndex + 1), cols[0].x, rowTop - 11, { size: 8, font: regular, align: 'center', maxWidth: cols[0].w });

        let ly = rowTop - 11;
        for (const line of il.nameLines) {
          text(line, cols[1].x + 4, ly, { size: 8, font: bold });
          ly -= 10;
        }

        // KGS column
        const kgsText = item.unit?.toUpperCase() === 'KGS' || !item.unit ? formatQty3(item.qty) : '—';
        text(kgsText, cols[2].x, rowTop - 11, { size: 8, font: regular, align: 'center', maxWidth: cols[2].w });

        // HSN/SAC
        text(item.hsnSac || '210690', cols[3].x, rowTop - 11, { size: 8, font: regular, align: 'center', maxWidth: cols[3].w });

        // Quantity
        text(`${formatQty3(item.qty)}`, cols[4].x, rowTop - 11, {
          size: 8,
          font: regular,
          align: 'right',
          maxWidth: cols[4].w - 4,
        });

        // Rate per kg
        text(formatAmt2(il.baseUnitPrice), cols[5].x, rowTop - 11, { size: 8, font: regular, align: 'right', maxWidth: cols[5].w - 4 });

        // Amount
        text(formatAmt2(il.baseAmt), cols[6].x, rowTop - 11, { size: 8, font: regular, align: 'right', maxWidth: cols[6].w - 4 });

        ty -= il.height;
      }

      // Render inline Output CGST / SGST rows under the items on the last page
      if (isLast && bill.gstAmount > 0) {
        ty -= 4;
        if (bill.isInterState) {
          const rateStr = fullRate !== undefined ? `${fullRate}%` : `${hsnGroups[0]?.igstRate ?? 0}%`;
          text(`OUTPUT IGST ${rateStr}`, cols[1].x + 20, ty - 10, { size: 8, font: bold });
          text(fullRate !== undefined ? String(fullRate) : String(hsnGroups[0]?.igstRate ?? 0), cols[5].x, ty - 10, {
            size: 8,
            font: regular,
            align: 'right',
            maxWidth: cols[5].w - 4,
          });
          text(formatAmt2(bill.gstAmount), cols[6].x, ty - 10, { size: 8, font: regular, align: 'right', maxWidth: cols[6].w - 4 });
          ty -= 14;
        } else {
          const { cgstP, sgstP } = splitTaxP(bill.gstAmount, false);
          const rateStr = halfRate !== undefined ? `${halfRate}%` : `${hsnGroups[0]?.cgstRate ?? 0}%`;
          const rateVal = halfRate !== undefined ? String(halfRate) : String(hsnGroups[0]?.cgstRate ?? 0);

          text(`OUTPUT CGST ${rateStr}`, cols[1].x + 20, ty - 10, { size: 8, font: bold });
          text(rateVal, cols[5].x, ty - 10, { size: 8, font: regular, align: 'right', maxWidth: cols[5].w - 4 });
          text(formatAmt2(cgstP), cols[6].x, ty - 10, { size: 8, font: regular, align: 'right', maxWidth: cols[6].w - 4 });
          ty -= 14;

          text(`OUTPUT SGST ${rateStr}`, cols[1].x + 20, ty - 10, { size: 8, font: bold });
          text(rateVal, cols[5].x, ty - 10, { size: 8, font: regular, align: 'right', maxWidth: cols[5].w - 4 });
          text(formatAmt2(sgstP), cols[6].x, ty - 10, { size: 8, font: regular, align: 'right', maxWidth: cols[6].w - 4 });
          ty -= 14;
        }
      }

      const tableBottom = isLast ? reservedBottomY : Math.min(ty - 20, reservedBottomY);
      const totalRowBottom = tableBottom - TOTAL_ROW_H;

      // Draw vertical column dividers down through the table body
      for (const c of cols.slice(1)) {
        const mergeIntoTotal = isLast && (c.key === 'desc' || c.key === 'kgs' || c.key === 'hsn');
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
        text('Total', cols[1].x + 4, totalBaseline, { size: 8.5, font: bold });
        text(`${formatQty3(totalQty)}`, cols[4].x, totalBaseline, {
          size: 8.5,
          font: bold,
          align: 'right',
          maxWidth: cols[4].w - 4,
        });
        text(`Rs.  ${formatAmt2(bill.grandTotal)}`, cols[6].x, totalBaseline, {
          size: 9,
          font: bold,
          align: 'right',
          maxWidth: cols[6].w - 4,
        });

        sy -= TOTAL_ROW_H;
        hline(sy, left, right);

        // ── Amount Chargeable (in words) & E. & O.E ──
        text('Amount Chargeable (in words)', left + 6, sy - 8, { size: 6.5, font: regular });
        text(formatWordsINR(bill.grandTotal), left + 6, sy - 18, { size: 8, font: bold, maxWidth: contentW - 80 });
        text('E. & O.E', right - 8, sy - 10, { size: 7.5, font: bold, align: 'right' });

        sy -= WORDS_EOE_H;
        hline(sy, left, right);

        // ── HSN/SAC Tax Summary Table ──
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

        // Ledger Outstanding Balance (if any)
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

        // Left Half: Bank Details (Matching New sample.pdf exact format)
        let bky = bankTopY - 10;
        text(`Bank: ${bankName}`, left + 6, bky, { size: 8, font: regular });
        bky -= 12;
        text(`A/C No: ${bankAccountNumber || ''}`, left + 6, bky, { size: 8, font: regular });
        bky -= 12;
        text(`IFSC No: ${bankIfsc}`, left + 6, bky, { size: 8, font: regular });

        const declTopY = bankTopY - 44;
        hline(declTopY, left, midX);
        text('Declaration', left + 6, declTopY - 8, { size: 7, font: bold });
        text('We declare that this invoice shows the actual price of the goods', left + 6, declTopY - 17, { size: 6.5, font: regular });
        text('described and that all particulars are true and correct.', left + 6, declTopY - 25, { size: 6.5, font: regular });

        // Right Half: for SRI MEENAKSHI Enterprises & Authorised Signatory
        text(`for ${companyName}`, right - 10, bankTopY - 11, { size: 8, font: bold, align: 'right' });
        text('Authorised Signatory', right - 10, bottomLimit + 8, { size: 7.5, font: regular, align: 'right' });
      }

      // Outer Rectangle Border
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
      text(`SUBJECT TO ${jurisdiction} JURISDICTION`, left, borderBottom - 8, { size: 5.5, font: regular });
      text('This is a Computer Generated Invoice', right, borderBottom - 8, { size: 5.5, font: regular, align: 'right' });
    });

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
