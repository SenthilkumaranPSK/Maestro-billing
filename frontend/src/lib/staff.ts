/**
 * ── Staff list for "Billed By" ──────────────────────────────────────────
 * Hardcoded on purpose — no Staff table, no admin UI, matching how small
 * this app's operator base actually is. To add a new staff member, append
 * a row below with the next unused id. Never reuse or renumber an existing
 * id: it gets stored on every bill that staff member billed (Bill.billedById
 * in schema.prisma), so changing an id after the fact would silently point
 * old bills at the wrong person. Renaming an existing entry only affects
 * the dropdown going forward — already-saved bills keep whatever name was
 * stored on them at the time (Bill.billedByName), not whatever this list
 * says now.
 */
export interface StaffMember {
  id: number;
  name: string;
}

export const STAFF_LIST: StaffMember[] = [
  { id: 1, name: 'YUVARAJ V' },
  { id: 2, name: 'PANDIYAN I' },
  // { id: 3, name: 'NEW STAFF NAME' },
];
