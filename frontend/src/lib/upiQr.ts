/**
 * Standalone UPI Payment QR code generator & helper.
 * Zero external dependencies — generates standard ISO/IEC 18004 QR matrices
 * and renders to Canvas / PNG DataURL / SVG for thermal receipts and A4 invoices.
 */

export interface UpiPaymentParams {
  upiId: string;
  name: string;
  amountPaisa: number;
  billNumber: string;
  notes?: string;
}

/** Builds a standard NPCI UPI payment deep link */
export function buildUpiUri(params: UpiPaymentParams): string {
  const { upiId, name, amountPaisa, billNumber, notes } = params;
  if (!upiId) return '';
  const rupees = (amountPaisa / 100).toFixed(2);
  const search = new URLSearchParams({
    pa: upiId.trim(),
    pn: name.trim() || 'Studio',
    am: rupees,
    cu: 'INR',
    tn: notes || `Bill ${billNumber}`,
  });
  return `upi://pay?${search.toString()}`;
}

// ── Minimal QR Code (Model 2, Byte Mode) Matrix Generator ──────────────────

type BitMatrix = boolean[][];

const GF256_EXP = new Uint8Array(512);
const GF256_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF256_EXP[i] = x;
    GF256_EXP[i + 255] = x;
    GF256_LOG[x] = i;
    x = (x << 1) ^ (x >= 128 ? 0x11d : 0);
  }
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF256_EXP[GF256_LOG[a]! + GF256_LOG[b]!];
}

function polyMul(p1: number[], p2: number[]): number[] {
  const res: number[] = new Array(p1.length + p2.length - 1).fill(0);
  for (let i = 0; i < p1.length; i++) {
    for (let j = 0; j < p2.length; j++) {
      res[i + j] = (res[i + j] ?? 0) ^ gfMul(p1[i]!, p2[j]!);
    }
  }
  return res;
}

function rsGeneratorPoly(degree: number): number[] {
  let g = [1];
  for (let i = 0; i < degree; i++) {
    g = polyMul(g, [1, GF256_EXP[i]!]);
  }
  return g;
}

function rsCompute(data: Uint8Array, eccCount: number): Uint8Array {
  const gen = rsGeneratorPoly(eccCount);
  const msg = new Uint8Array(data.length + eccCount);
  msg.set(data, 0);
  for (let i = 0; i < data.length; i++) {
    const coef = msg[i]!;
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        msg[i + j] ^= gfMul(gen[j]!, coef);
      }
    }
  }
  return msg.slice(data.length);
}

// Version table: [version, totalDataBytes, eccBytesPerBlock, numBlocks] for Level M
const VERSION_TABLE = [
  { ver: 1,  size: 21, dataCap: 14,  ecc: 10, blocks: 1 },
  { ver: 2,  size: 25, dataCap: 26,  ecc: 16, blocks: 1 },
  { ver: 3,  size: 29, dataCap: 42,  ecc: 26, blocks: 1 },
  { ver: 4,  size: 33, dataCap: 62,  ecc: 18, blocks: 2 },
  { ver: 5,  size: 37, dataCap: 84,  ecc: 24, blocks: 2 },
  { ver: 6,  size: 41, dataCap: 106, ecc: 16, blocks: 4 },
  { ver: 7,  size: 45, dataCap: 122, ecc: 18, blocks: 4 },
  { ver: 8,  size: 49, dataCap: 152, ecc: 22, blocks: 4 },
  { ver: 9,  size: 53, dataCap: 180, ecc: 22, blocks: 5 },
  { ver: 10, size: 57, dataCap: 213, ecc: 26, blocks: 5 },
];

/** Encodes string into QR boolean matrix (true = black dot, false = white) */
export function generateQrMatrix(text: string): BitMatrix {
  const utf8 = new TextEncoder().encode(text);
  const charCount = utf8.length;
  // Byte mode header: 4 bits mode (0100) + 8 bits length
  const bitsNeeded = 4 + 8 + charCount * 8;
  const dataBytesNeeded = Math.ceil(bitsNeeded / 8);

  const info = VERSION_TABLE.find((v) => v.dataCap >= dataBytesNeeded) || VERSION_TABLE[VERSION_TABLE.length - 1]!;
  const { size, dataCap, ecc, blocks } = info;

  // Build bitstream
  const bitArr: number[] = [0, 1, 0, 0]; // 0100 = 8-bit byte mode
  for (let i = 7; i >= 0; i--) bitArr.push((charCount >> i) & 1);
  for (let i = 0; i < charCount; i++) {
    for (let b = 7; b >= 0; b--) bitArr.push((utf8[i]! >> b) & 1);
  }

  // Terminator (up to 4 zeroes)
  while (bitArr.length < dataCap * 8 && bitArr.length < bitsNeeded + 4) bitArr.push(0);
  while (bitArr.length % 8 !== 0) bitArr.push(0);

  // Pad bytes (0xEC, 0x11)
  const padPatterns = [0xec, 0x11];
  let padIdx = 0;
  while (bitArr.length < dataCap * 8) {
    const pad = padPatterns[padIdx % 2]!;
    for (let b = 7; b >= 0; b--) bitArr.push((pad >> b) & 1);
    padIdx++;
  }

  // Group into data bytes
  const dataBytes = new Uint8Array(dataCap);
  for (let i = 0; i < dataCap; i++) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bitArr[i * 8 + j]!;
    dataBytes[i] = b;
  }

  // Interleave ECC blocks
  const blockSize = Math.floor(dataCap / blocks);
  const allEcc: Uint8Array[] = [];
  for (let b = 0; b < blocks; b++) {
    const start = b * blockSize;
    const end = b === blocks - 1 ? dataCap : (b + 1) * blockSize;
    allEcc.push(rsCompute(dataBytes.slice(start, end), ecc));
  }

  // Final codeword stream
  const codewords: number[] = [];
  for (let i = 0; i < blockSize + (dataCap % blocks > 0 ? 1 : 0); i++) {
    for (let b = 0; b < blocks; b++) {
      const idx = b * blockSize + i;
      if (idx < (b === blocks - 1 ? dataCap : (b + 1) * blockSize)) {
        codewords.push(dataBytes[idx]!);
      }
    }
  }
  for (let i = 0; i < ecc; i++) {
    for (let b = 0; b < blocks; b++) codewords.push(allEcc[b]![i]!);
  }

  // Initialize Matrix
  const mat: BitMatrix = Array.from({ length: size }, () => Array(size).fill(false));
  const isFunc: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  const setModule = (r: number, c: number, v: boolean, func = true) => {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      mat[r]![c] = v;
      if (func) isFunc[r]![c] = true;
    }
  };

  // 1. Finder patterns
  const drawFinder = (row: number, col: number) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const inRow = row + r;
        const inCol = col + c;
        if (inRow < 0 || inRow >= size || inCol < 0 || inCol >= size) continue;
        const isBlack = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
                        (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
                        (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        setModule(inRow, inCol, isBlack);
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // 2. Timing patterns
  for (let i = 8; i < size - 8; i++) {
    setModule(6, i, i % 2 === 0);
    setModule(i, 6, i % 2 === 0);
  }

  // 3. Alignment patterns (version >= 2)
  if (info.ver >= 2) {
    const pos = size - 7;
    for (let r = -2; r <= 2; r++) {
      for (let c = -2; c <= 2; c++) {
        const isBlack = Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0);
        setModule(pos + r, pos + c, isBlack);
      }
    }
  }

  // 4. Reserve format info
  for (let i = 0; i < 9; i++) {
    setModule(8, i, false);
    setModule(i, 8, false);
    setModule(8, size - 1 - i, false);
    setModule(size - 1 - i, 8, false);
  }
  setModule(size - 8, 8, true); // Dark module

  // 5. Place Data Codewords (Zig-Zag)
  let bitIdx = 0;
  const allBits: number[] = [];
  for (const cw of codewords) {
    for (let b = 7; b >= 0; b--) allBits.push((cw >> b) & 1);
  }

  let right = size - 1;
  let upward = true;
  while (right > 0) {
    if (right === 6) right--; // Skip timing column
    const cols = [right, right - 1];
    const rows = upward
      ? Array.from({ length: size }, (_, i) => size - 1 - i)
      : Array.from({ length: size }, (_, i) => i);

    for (const r of rows) {
      for (const c of cols) {
        if (!isFunc[r]![c]!) {
          const bit = bitIdx < allBits.length ? allBits[bitIdx]! === 1 : false;
          // Apply mask 0: (row + col) % 2 === 0
          const mask = (r + c) % 2 === 0;
          setModule(r, c, bit !== mask, false);
          bitIdx++;
        }
      }
    }
    right -= 2;
    upward = !upward;
  }

  // 6. Format info bits (Level M, Mask 0 = 0x5412)
  const formatBits = [1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0];
  for (let i = 0; i < 6; i++) setModule(8, i, formatBits[i] === 1);
  setModule(8, 7, formatBits[6] === 1);
  setModule(8, 8, formatBits[7] === 1);
  setModule(7, 8, formatBits[8] === 1);
  for (let i = 9; i < 15; i++) setModule(14 - i, 8, formatBits[i] === 1);

  for (let i = 0; i < 8; i++) setModule(size - 1 - i, 8, formatBits[i] === 1);
  for (let i = 8; i < 15; i++) setModule(8, size - 15 + i, formatBits[i] === 1);

  return mat;
}

/** Draws QR Code matrix to HTML Canvas context */
export function drawQrToCanvas(
  ctx: CanvasRenderingContext2D,
  matrix: BitMatrix,
  x: number,
  y: number,
  pixelSize: number,
  quietZone = 2,
): void {
  const n = matrix.length;
  const cellSize = pixelSize / (n + quietZone * 2);

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(x, y, pixelSize, pixelSize);

  ctx.fillStyle = '#000000';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (matrix[r]![c]!) {
        ctx.fillRect(
          Math.round(x + (c + quietZone) * cellSize),
          Math.round(y + (r + quietZone) * cellSize),
          Math.ceil(cellSize),
          Math.ceil(cellSize),
        );
      }
    }
  }
}

/** Generates a PNG Data URL for a given UPI Payment payload */
export function generateUpiQrDataUrl(params: UpiPaymentParams, sizePx = 180): string {
  const uri = buildUpiUri(params);
  if (!uri) return '';
  const matrix = generateQrMatrix(uri);
  const canvas = document.createElement('canvas');
  canvas.width = sizePx;
  canvas.height = sizePx;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  drawQrToCanvas(ctx, matrix, 0, 0, sizePx);
  return canvas.toDataURL('image/png');
}
