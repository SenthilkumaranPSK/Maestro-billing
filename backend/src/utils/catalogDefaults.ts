/**
 * The catalogs a fresh install ships with — the single source of truth for
 * "default", used by two callers that must never disagree:
 *
 *   1. `seed.ts`, which fills a brand-new database (and the packaged
 *      `desktop/template/studio.db`).
 *   2. `routes/catalog.ts` → `POST /api/v1/catalog/restore-defaults`, reachable
 *      from the desktop app's Alt → Setup menu, which puts back any of these
 *      that the operator has since deleted.
 *
 * These lists previously existed only as literals inside `seed.ts`. Restoring
 * from a second copy would have meant the "defaults" drifting from what a new
 * install actually gets the first time anyone edited one of them.
 */

export interface DefaultProduct {
  name: string;
  unit: string;
  unitPrice: number; // paise — money is integer paise everywhere
  gstRate: number;
}

/** Studio billing catalog. Sample data: generic photo-studio items and prices. */
export const DEFAULT_PRODUCTS: DefaultProduct[] = [
  { name: 'Passport Size Photo (6 pcs)', unit: 'set', unitPrice: 10000, gstRate: 18 },
  { name: 'Studio Portrait 4x6', unit: 'photo', unitPrice: 3000, gstRate: 18 },
  { name: 'Studio Portrait 6x8', unit: 'photo', unitPrice: 5000, gstRate: 18 },
  { name: 'Wedding Album 12x16 (20 pgs)', unit: 'album', unitPrice: 250000, gstRate: 18 },
  { name: 'Canvas Print 12x16', unit: 'piece', unitPrice: 75000, gstRate: 18 },
  { name: 'Photo Frame 8x10', unit: 'piece', unitPrice: 45000, gstRate: 18 },
  { name: 'Vinyl Banner 3x6 ft', unit: 'piece', unitPrice: 120000, gstRate: 18 },
  { name: 'Baby Photo Shoot (1 hr)', unit: 'session', unitPrice: 300000, gstRate: 18 },
  { name: 'ID Card Photo', unit: 'set', unitPrice: 5000, gstRate: 18 },
  { name: 'Soft Copy (Pen Drive)', unit: 'piece', unitPrice: 20000, gstRate: 18 },
];

/**
 * MM wholesale catalog. Unlike the studio products above these are NOT
 * placeholders — they come from the studio's own reference wholesale tax
 * invoice (names with the "1Q Bulk" prefix stripped), all HSN 210690, Kgs,
 * 5% GST, Rs.120/kg to match that reference.
 */
export const DEFAULT_MM_PRODUCT_NAMES: string[] = [
  'Thenkuzhal Murukku',
  'Butter Muruku',
  'Spring Muruku',
  'Garlic Mixture',
  'Pepper Sev',
  'Sirai Pakkoda',
  'Kara Boondhi',
  'Madras Mixture',
  'Kara Sev',
  'Mini Kara Sev',
  'Mullu Murukku',
  'Bombay Mixture',
  'Double Ring Murukku',
  'Onion Murukku',
  'Baby Nippet Chilly',
  'Avul Mixture',
];

/** Field values every default MM product is created with. */
export const DEFAULT_MM_PRODUCT_FIELDS = {
  unit: 'Kgs',
  unitPrice: 12000,
  gstRate: 5,
  hsnSac: '210690',
} as const;

/**
 * Service names feeding the A4 invoice's Service Description autocomplete.
 * Deliberately names only — HSN/SAC and price are studio/CA-specific and
 * shouldn't ship as a guessed default.
 */
export const DEFAULT_SERVICE_NAMES: string[] = [
  'Wedding Photography',
  'Wedding Videography',
  'Pre-Wedding Shoot',
  'Product Photography',
  'Product Video Shoot',
  'Baby / Family Portrait Session',
  'Birthday & Event Coverage',
  'Passport / ID Photo Service',
];
