import { PDFDocument, PDFFont, PDFPage, rgb } from 'pdf-lib';
import { type Bill, type Settings, MM_DEFAULTS, paisaToRupee } from '@/types';
import { numberToIndianWords } from '@/lib/amountInWords';
import { bytesToBase64 } from '@/lib/pdf';
import { embedBrandFonts } from '@/lib/brandFont';
import { wrapText } from '@/lib/a4invoice';
import { computeHsnSummary } from '@/lib/hsnSummary';
import { splitTaxP } from '@/lib/billMath';

/**
 * MM/A4 "Tax Invoice" — wholesale tax invoice layout matching the official
 * Tally GST format with MORU MORU SNACKS brand header (from invoice_text.pdf).
 *
 * Fully customizable via MM Settings (mm_company_name, mm_brand_name,
 * mm_tagline, mm_fssai_no, mm_address, mm_branch_office, mm_branch_fssai,
 * mm_gstin, mm_contact, mm_bank_account_name, mm_bank_name, etc.),
 * pre-populated with SREE MEENAKSHI ENTERPRISES / IDBI BANK defaults.
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

function formatTallyDate(date: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = date.getDate();
  const month = months[date.getMonth()];
  const year = String(date.getFullYear()).slice(-2);
  return `${day}-${month}-${year}`;
}

const PAGE_W = 595.28; // A4, pt
const PAGE_H = 841.89;
const MARGIN = 24;

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

export async function generateMmA4InvoicePDF(
  bill: Bill,
  settings: Partial<Settings>,
  options: MmA4InvoiceOptions = {}
): Promise<Uint8Array> {
  const mmSettings = settings.mm || {};

  // Enterprise details from settings or defaults
  const companyName = mmSettings.mm_company_name || MM_DEFAULTS.company_name;
  const brandName = mmSettings.mm_brand_name || MM_DEFAULTS.brand_name;
  const tagline = mmSettings.mm_tagline || MM_DEFAULTS.tagline;
  const fssaiNo = mmSettings.mm_fssai_no || MM_DEFAULTS.fssai_no;
  const companyAddress = mmSettings.mm_address || MM_DEFAULTS.address;
  const branchOffice = mmSettings.mm_branch_office || MM_DEFAULTS.branch_office;
  const branchFssai = mmSettings.mm_branch_fssai || MM_DEFAULTS.branch_fssai;
  const companyGstin = mmSettings.mm_gstin || MM_DEFAULTS.gstin;
  const contactPhone = mmSettings.mm_contact || MM_DEFAULTS.contact;
  const companyStateName = mmSettings.mm_state_name || MM_DEFAULTS.state_name;
  const companyStateCode = mmSettings.mm_state_code || MM_DEFAULTS.state_code;

  // Bank details
  const bankAccountName = mmSettings.mm_bank_account_name || MM_DEFAULTS.bank_account_name;
  const bankName = mmSettings.mm_bank_name || MM_DEFAULTS.bank_name;
  const bankAccountNumber = mmSettings.mm_bank_account_number || MM_DEFAULTS.bank_account_number;
  const bankBranch = mmSettings.mm_bank_branch || MM_DEFAULTS.bank_branch;
  const bankIfsc = mmSettings.mm_bank_ifsc || MM_DEFAULTS.bank_ifsc;
  const jurisdiction = mmSettings.mm_jurisdiction || MM_DEFAULTS.jurisdiction;

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

  const left = MARGIN;
  const right = PAGE_W - MARGIN;
  const contentW = right - left;
  const midX = left + contentW * 0.5;
  const leftW = midX - left;
  const rightW = right - midX;

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

  // ── Header drawing ──────────────────────────────────────────────────────────
  function drawBrandHeader(copyTitleText?: string): number {
    let hy = PAGE_H - MARGIN;
    text(brandName, left, hy - 11, { size: 13, font: bold, align: 'center', maxWidth: contentW });
    text(tagline, left, hy - 21, { size: 7.5, font: regular, align: 'center', maxWidth: contentW });
    if (fssaiNo) {
      text(`(FSSAI : ${fssaiNo})`, left, hy - 30, { size: 7.5, font: regular, align: 'center', maxWidth: contentW });
    }
    text('TAX INVOICE', left, hy - 42, { size: 10, font: bold, align: 'center', maxWidth: contentW });
    if (copyTitleText) {
      text(`(${copyTitleText.toUpperCase()})`, left, hy - 50, { size: 7, font: bold, align: 'center', maxWidth: contentW });
      return hy - 55;
    }
    return hy - 48;
  }

  // ── Party & Dispatch Grid Section ──────────────────────────────────────────
  const GRID_H = 186;

  function drawGridSection(topY: number): number {
    const bottomY = topY - GRID_H;

    // Outer grid division lines
    vline(midX, bottomY, topY);

    // ── Left Half: Seller (Marketed By), Consignee, Buyer ──
    const sellerH = 76;
    const consigneeH = 55;
    const sellerBottom = topY - sellerH;
    const consigneeBottom = sellerBottom - consigneeH;

    hline(sellerBottom, left, midX);
    hline(consigneeBottom, left, midX);

    // Sub-box 1: Seller
    let sy = topY - 8.5;
    text(companyName, left + 6, sy, { size: 8.5, font: bold, maxWidth: leftW - 12 });
    sy -= 9.5;

    // Split address by explicit newlines or commas
    const rawAddrLines = companyAddress
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const sellerAddrLines = rawAddrLines.length > 0 ? rawAddrLines : wrapText(regular, companyAddress, 7, leftW - 12);

    for (const line of sellerAddrLines.slice(0, 4)) {
      text(line, left + 6, sy, { size: 6.8, font: regular, maxWidth: leftW - 12 });
      sy -= 8;
    }
    text(`GSTIN/UIN: ${companyGstin}`, left + 6, sy, { size: 7, font: bold });
    sy -= 8;
    text(`State Name : ${companyStateName}, Code : ${companyStateCode}`, left + 6, sy, { size: 6.8, font: regular });
    sy -= 8;
    const contactLine = [contactPhone ? `Contact : ${contactPhone}` : '', branchFssai ? `(FSSAI : ${branchFssai})` : '']
      .filter(Boolean)
      .join('   ');
    if (contactLine) {
      text(contactLine, left + 6, sy, { size: 6.8, font: regular });
    }

    // Sub-box 2: Consignee (Ship to)
    let cy = sellerBottom - 8.5;
    text('Consignee (Ship to)', left + 6, cy, { size: 7.5, font: bold });
    cy -= 9.5;
    text(consigneeName, left + 6, cy, { size: 8, font: bold, maxWidth: leftW - 12 });
    cy -= 9;
    const consigneeAddrLines = consigneeAddress ? wrapText(regular, consigneeAddress.replace(/\n/g, ', '), 7, leftW - 12) : [];
    for (const line of consigneeAddrLines.slice(0, 2)) {
      text(line, left + 6, cy, { size: 6.8, font: regular, maxWidth: leftW - 12 });
      cy -= 8;
    }
    text(`GSTIN/UIN : ${consigneeGstin || '—'}`, left + 6, cy, { size: 6.8, font: regular });
    cy -= 8;
    text(`State Name : ${consigneeState.name}, Code : ${consigneeState.code}`, left + 6, cy, { size: 6.8, font: regular });

    // Sub-box 3: Buyer (Bill to)
    let by = consigneeBottom - 8.5;
    text('Buyer (Bill to)', left + 6, by, { size: 7.5, font: bold });
    by -= 9.5;
    text(buyerName, left + 6, by, { size: 8, font: bold, maxWidth: leftW - 12 });
    by -= 9;
    const buyerAddrLines = buyerAddress ? wrapText(regular, buyerAddress.replace(/\n/g, ', '), 7, leftW - 12) : [];
    for (const line of buyerAddrLines.slice(0, 2)) {
      text(line, left + 6, by, { size: 6.8, font: regular, maxWidth: leftW - 12 });
      by -= 8;
    }
    text(`GSTIN/UIN : ${buyerGstin || '—'}`, left + 6, by, { size: 6.8, font: regular });
    by -= 8;
    text(`State Name : ${buyerState.name}, Code : ${buyerState.code}`, left + 6, by, { size: 6.8, font: regular });
    by -= 8;
    text(`Place of Supply : ${placeOfSupply}`, left + 6, by, { size: 6.8, font: regular });

    // ── Right Half: 7-Row Order & Dispatch Grid ──
    const col1W = rightW * 0.5;
    const col2X = midX + col1W;
    const ROW_H = 25;

    // Vertical line between col 1 & 2 for rows 1 to 6 (not row 7)
    vline(col2X, topY - ROW_H * 6, topY);

    // Row 1: Invoice No. | Dated
    let ry = topY;
    text('Invoice No.', midX + 6, ry - 8, { size: 6.5, font: regular });
    text(bill.billNumber, midX + 6, ry - 18, { size: 8.5, font: bold, maxWidth: col1W - 12 });
    text('Dated', col2X + 6, ry - 8, { size: 6.5, font: regular });
    text(formatTallyDate(new Date(bill.billDate)), col2X + 6, ry - 18, { size: 8.5, font: bold, maxWidth: col1W - 12 });
    ry -= ROW_H;
    hline(ry, midX, right);

    // Row 2: Delivery Note | Mode/Terms of Payment
    text('Delivery Note', midX + 6, ry - 8, { size: 6.5, font: regular });
    text('Mode/Terms of Payment', col2X + 6, ry - 8, { size: 6.5, font: regular });
    text(bill.paymentMode || '', col2X + 6, ry - 18, { size: 8, font: bold, maxWidth: col1W - 12 });
    ry -= ROW_H;
    hline(ry, midX, right);

    // Row 3: Reference No. & Date. | Other References
    text('Reference No. & Date.', midX + 6, ry - 8, { size: 6.5, font: regular });
    text(bill.otherReference || '', midX + 6, ry - 18, { size: 7.5, font: regular, maxWidth: col1W - 12 });
    text('Other References', col2X + 6, ry - 8, { size: 6.5, font: regular });
    text(bill.irnNo ? `IRN: ${bill.irnNo.slice(0, 20)}...` : '', col2X + 6, ry - 18, { size: 6.5, font: regular, maxWidth: col1W - 12 });
    ry -= ROW_H;
    hline(ry, midX, right);

    // Row 4: Buyer's Order No. | Dated
    text("Buyer's Order No.", midX + 6, ry - 8, { size: 6.5, font: regular });
    text('Dated', col2X + 6, ry - 8, { size: 6.5, font: regular });
    ry -= ROW_H;
    hline(ry, midX, right);

    // Row 5: Dispatch Doc No. | Delivery Note Date
    text('Dispatch Doc No.', midX + 6, ry - 8, { size: 6.5, font: regular });
    text(bill.ewayBillNo ? `EWAY: ${bill.ewayBillNo}` : '', midX + 6, ry - 18, { size: 7.5, font: regular, maxWidth: col1W - 12 });
    text('Delivery Note Date', col2X + 6, ry - 8, { size: 6.5, font: regular });
    ry -= ROW_H;
    hline(ry, midX, right);

    // Row 6: Dispatched through | Destination
    text('Dispatched through', midX + 6, ry - 8, { size: 6.5, font: regular });
    const dispatchDetails = [bill.despatchedThrough, bill.vehicleNo].filter(Boolean).join(' / ');
    text(dispatchDetails, midX + 6, ry - 18, { size: 7.5, font: regular, maxWidth: col1W - 12 });
    text('Destination', col2X + 6, ry - 8, { size: 6.5, font: regular });
    text(bill.destination || '', col2X + 6, ry - 18, { size: 7.5, font: regular, maxWidth: col1W - 12 });
    ry -= ROW_H;
    hline(ry, midX, right);

    // Row 7: Terms of Delivery (spans full right width down to bottomY)
    text('Terms of Delivery', midX + 6, ry - 8, { size: 6.5, font: regular });
    if (bill.notes) {
      text(bill.notes, midX + 6, ry - 18, { size: 7, font: regular, maxWidth: rightW - 12 });
    }

    // Grid divider closing bottom
    hline(bottomY, left, right);
    return bottomY;
  }

  // ── Items Table Setup ───────────────────────────────────────────────────────
  const cols = [
    { key: 'sno', label: 'Sl\nNo.', x: left, w: 26, align: 'center' as const },
    { key: 'desc', label: 'Description of Goods', x: left + 26, w: 200, align: 'left' as const },
    { key: 'hsn', label: 'HSN/SAC', x: left + 226, w: 55, align: 'center' as const },
    { key: 'qty', label: 'Quantity', x: left + 281, w: 75, align: 'right' as const },
    { key: 'rate', label: 'Rate', x: left + 356, w: 56, align: 'right' as const },
    { key: 'per', label: 'per', x: left + 412, w: 38, align: 'center' as const },
    { key: 'amt', label: 'Amount', x: left + 450, w: right - (left + 450), align: 'right' as const },
  ];

  const TABLE_HEADER_H = 20;

  function drawTableHeader(topY: number): number {
    const headerBottom = topY - TABLE_HEADER_H;
    const baseline = topY - 13;

    text('Sl No.', cols[0].x, baseline, { size: 7.5, font: bold, align: 'center', maxWidth: cols[0].w });
    text('Description of Goods', cols[1].x + 4, baseline, { size: 7.5, font: bold });
    text('HSN/SAC', cols[2].x, baseline, { size: 7.5, font: bold, align: 'center', maxWidth: cols[2].w });
    text('Quantity', cols[3].x, baseline, { size: 7.5, font: bold, align: 'center', maxWidth: cols[3].w });
    text('Rate', cols[4].x, baseline, { size: 7.5, font: bold, align: 'center', maxWidth: cols[4].w });
    text('per', cols[5].x, baseline, { size: 7.5, font: bold, align: 'center', maxWidth: cols[5].w });
    text('Amount', cols[6].x, baseline, { size: 7.5, font: bold, align: 'center', maxWidth: cols[6].w });

    hline(headerBottom, left, right);
    return headerBottom;
  }

  // ── Summary Block Calculations ─────────────────────────────────────────────
  const hsnGroups = computeHsnSummary(bill);
  const gstRates = [...new Set(bill.items.filter((i) => i.gstRate > 0).map((i) => i.gstRate))];
  const halfRate = gstRates.length === 1 ? gstRates[0]! / 2 : undefined;
  const fullRate = gstRates.length === 1 ? gstRates[0]! : undefined;

  const sameUnit = bill.items.length > 0 && bill.items.every((i) => i.unit === bill.items[0]!.unit);
  const totalQty = bill.items.reduce((s, i) => s + i.qty, 0);

  const TOTAL_ROW_H = 18;
  const WORDS_EOE_H = 24;
  const HSN_TABLE_H = 18 + hsnGroups.length * 13 + 14 + 16 + 2;
  const LEDGER_DUE_H = options.previousDueP && options.previousDueP > 0 ? 14 : 0;
  const BANK_SIG_H = 78;
  const SUMMARY_BLOCK_H = TOTAL_ROW_H + WORDS_EOE_H + HSN_TABLE_H + LEDGER_DUE_H + BANK_SIG_H;

  const bottomLimit = MARGIN + 22; // Leave room for jurisdiction and computer-generated footer
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

  // Calculate inline tax lines height (if single page / last page)
  const inlineTaxCount = bill.gstAmount > 0 ? (bill.isInterState ? 1 : 2) : 0;
  const INLINE_TAX_H = inlineTaxCount * 14;

  // Pagination
  const availableItemsH = PAGE_H - MARGIN - 51 - GRID_H - TABLE_HEADER_H - reservedBottomY;
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

  // ── Render Pages for each requested copy ──────────────────────────────────
  const copiesToRender: string[] = [];
  if (options.copyType === 'ALL') {
    copiesToRender.push('Original for Recipient', 'Duplicate for Transporter', 'Triplicate for Supplier');
  } else if (options.copyType === 'DUPLICATE') {
    copiesToRender.push('Duplicate for Transporter');
  } else if (options.copyType === 'TRIPLICATE') {
    copiesToRender.push('Triplicate for Supplier');
  } else {
    copiesToRender.push('Original for Recipient');
  }

  copiesToRender.forEach((copyTitle) => {
    pages.forEach((pageItems, pageIdx) => {
      const isLast = pageIdx === pages.length - 1;
      page = doc.addPage([PAGE_W, PAGE_H]);

      const headerBottomY = drawBrandHeader(copyTitle);
      const gridBottomY = drawGridSection(headerBottomY);
      const tableHeaderBottom = drawTableHeader(gridBottomY);

    let ty = tableHeaderBottom;

    // Render line items
    for (const il of pageItems) {
      const item = bill.items[il.itemIndex]!;
      const rowTop = ty;

      text(String(il.itemIndex + 1), cols[0].x, rowTop - 11, { size: 7.5, font: regular, align: 'center', maxWidth: cols[0].w });

      let ly = rowTop - 11;
      for (const line of il.nameLines) {
        text(line, cols[1].x + 4, ly, { size: 8, font: bold });
        ly -= 10;
      }

      text(item.hsnSac || '—', cols[2].x, rowTop - 11, { size: 7.5, font: regular, align: 'center', maxWidth: cols[2].w });
      text(`${formatQty3(item.qty)} ${item.unit || 'KGS'}`, cols[3].x, rowTop - 11, {
        size: 7.5,
        font: regular,
        align: 'right',
        maxWidth: cols[3].w - 4,
      });
      text(formatAmt2(il.baseUnitPrice), cols[4].x, rowTop - 11, { size: 7.5, font: regular, align: 'right', maxWidth: cols[4].w - 4 });
      text(item.unit || 'KGS', cols[5].x, rowTop - 11, { size: 7.5, font: regular, align: 'center', maxWidth: cols[5].w });
      text(formatAmt2(il.baseAmt), cols[6].x, rowTop - 11, { size: 7.5, font: regular, align: 'right', maxWidth: cols[6].w - 4 });

      ty -= il.height;
    }

    // Render inline Output CGST / SGST rows under the items on the last page
    if (isLast && bill.gstAmount > 0) {
      ty -= 4;
      if (bill.isInterState) {
        const rateStr = fullRate !== undefined ? `${fullRate}%` : `${hsnGroups[0]?.igstRate ?? 0}%`;
        text(`OUTPUT IGST ${rateStr}`, cols[1].x + 20, ty - 10, { size: 8, font: bold });
        text(fullRate !== undefined ? String(fullRate) : String(hsnGroups[0]?.igstRate ?? 0), cols[4].x, ty - 10, {
          size: 7.5,
          font: regular,
          align: 'right',
          maxWidth: cols[4].w - 4,
        });
        text('%', cols[5].x, ty - 10, { size: 7.5, font: regular, align: 'center', maxWidth: cols[5].w });
        text(formatAmt2(bill.gstAmount), cols[6].x, ty - 10, { size: 7.5, font: regular, align: 'right', maxWidth: cols[6].w - 4 });
        ty -= 14;
      } else {
        const { cgstP, sgstP } = splitTaxP(bill.gstAmount, false);
        const rateStr = halfRate !== undefined ? `${halfRate}%` : `${hsnGroups[0]?.cgstRate ?? 0}%`;
        const rateVal = halfRate !== undefined ? String(halfRate) : String(hsnGroups[0]?.cgstRate ?? 0);

        text(`OUTPUT CGST ${rateStr}`, cols[1].x + 20, ty - 10, { size: 8, font: bold });
        text(rateVal, cols[4].x, ty - 10, { size: 7.5, font: regular, align: 'right', maxWidth: cols[4].w - 4 });
        text('%', cols[5].x, ty - 10, { size: 7.5, font: regular, align: 'center', maxWidth: cols[5].w });
        text(formatAmt2(cgstP), cols[6].x, ty - 10, { size: 7.5, font: regular, align: 'right', maxWidth: cols[6].w - 4 });
        ty -= 14;

        text(`OUTPUT SGST ${rateStr}`, cols[1].x + 20, ty - 10, { size: 8, font: bold });
        text(rateVal, cols[4].x, ty - 10, { size: 7.5, font: regular, align: 'right', maxWidth: cols[4].w - 4 });
        text('%', cols[5].x, ty - 10, { size: 7.5, font: regular, align: 'center', maxWidth: cols[5].w });
        text(formatAmt2(sgstP), cols[6].x, ty - 10, { size: 7.5, font: regular, align: 'right', maxWidth: cols[6].w - 4 });
        ty -= 14;
      }
    }

    const tableBottom = isLast ? reservedBottomY : Math.min(ty - 20, reservedBottomY);
    const totalRowBottom = tableBottom - TOTAL_ROW_H;

    // Draw vertical column dividers down through the table body
    for (const c of cols.slice(1)) {
      // In the Total row, Sl No / Description / HSN/SAC are merged into one cell
      const mergeIntoTotal = isLast && (c.key === 'desc' || c.key === 'hsn');
      const lowerY = isLast ? (mergeIntoTotal ? tableBottom : totalRowBottom) : tableBottom;
      vline(c.x, lowerY, gridBottomY);
    }

    hline(tableBottom, left, right);

    if (!isLast) {
      text('(Continued on next page...)', left, ty - 14, { size: 8, font: bold, align: 'center', maxWidth: contentW });
    } else {
      // ── Total Row ──
      let sy = tableBottom;
      const totalBaseline = sy - 12;
      text('Total', cols[1].x + 4, totalBaseline, { size: 8.5, font: bold });
      text(`${formatQty3(totalQty)} ${sameUnit ? bill.items[0]!.unit : ''}`, cols[3].x, totalBaseline, {
        size: 8.5,
        font: bold,
        align: 'right',
        maxWidth: cols[3].w - 4,
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
      // Column boundaries matching exact grouped headers
      const isInter = bill.isInterState;
      const hsnX = left; // 24
      const taxValX = left + 80; // 104
      const cgstX = left + 175; // 199
      const cgstAmtX = cgstX + 45; // 244
      const sgstX = cgstAmtX + 75; // 319
      const sgstAmtX = sgstX + 45; // 364
      const totTaxX = sgstAmtX + 75; // 439

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

      // Data rows per HSN
      for (const g of hsnGroups) {
        text(g.hsnSac || '—', hsnX, sy - 9.5, { size: 7.5, font: regular, align: 'center', maxWidth: 80 });
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

      // HSN Totals
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

      // Draw HSN vertical dividers
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

      // Tax Amount in Words
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

      // Left Half: Bank Details & Declaration
      let bky = bankTopY - 9;
      text("Company's Bank Details", left + 6, bky, { size: 7.5, font: bold });
      bky -= 9.5;
      text(`A/c Holder's Name : ${bankAccountName}`, left + 6, bky, { size: 7, font: bold, maxWidth: leftW - 12 });
      bky -= 8.5;
      text(`Bank Name : ${bankName}`, left + 6, bky, { size: 7, font: regular });
      bky -= 8.5;
      text(`A/c No. : ${bankAccountNumber}`, left + 6, bky, { size: 7, font: bold });
      bky -= 8.5;
      text(`Branch & IFS Code : ${bankBranch} & ${bankIfsc}`, left + 6, bky, { size: 7, font: regular });

      const declTopY = bankTopY - 48;
      hline(declTopY, left, midX);
      text('Declaration', left + 6, declTopY - 8, { size: 7, font: bold });
      text('We declare that this invoice shows the actual price of the goods', left + 6, declTopY - 17, { size: 6.5, font: regular });
      text('described and that all particulars are true and correct.', left + 6, declTopY - 25, { size: 6.5, font: regular });

      // Right Half: for SREE MEENAKSHI ENTERPRISES & Authorised Signatory
      text(`for ${companyName}`, right - 10, bankTopY - 11, { size: 8, font: bold, align: 'right' });
      text('Authorised Signatory', right - 10, bottomLimit + 8, { size: 7.5, font: regular, align: 'right' });
    }

    // Outer Rectangle Border
    const borderBottom = isLast ? bottomLimit : tableBottom;
    page.drawRectangle({
      x: left,
      y: borderBottom,
      width: contentW,
      height: gridBottomY + GRID_H - borderBottom,
      borderColor: BLACK,
      borderWidth: 0.6,
    });

    // Outer Footers
    if (isLast) {
      text(`SUBJECT TO ${jurisdiction.toUpperCase()} JURISDICTION`, left, bottomLimit - 9, {
        size: 7,
        font: bold,
        align: 'center',
        maxWidth: contentW,
      });
      text('This is a Computer Generated Invoice', left, bottomLimit - 17, {
        size: 6.5,
        font: regular,
        align: 'center',
        maxWidth: contentW,
      });
    }
  });
  });

  return doc.save();
}

export async function generateMmA4InvoicePDFBase64(
  bill: Bill,
  settings: Partial<Settings>,
  options: MmA4InvoiceOptions = {}
): Promise<string> {
  const bytes = await generateMmA4InvoicePDF(bill, settings, options);
  return bytesToBase64(bytes);
}

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
