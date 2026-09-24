import 'dotenv/config';
import {
  DEFAULT_PRODUCTS,
  DEFAULT_MM_PRODUCT_NAMES,
  DEFAULT_MM_PRODUCT_FIELDS,
  DEFAULT_SERVICE_NAMES,
} from './utils/catalogDefaults';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // (User model is retained for the Bill.createdBy FK, but no login is required
  //  in single-user local mode — leave the users table empty.)

  // Default settings
  const defaults: Array<{ key: string; value: string; group: string }> = [
    { key: 'studio_name', value: "The Maestro Studio's", group: 'studio' },
    { key: 'studio_owner', value: 'Maestro Yuvaraj V', group: 'studio' },
    { key: 'studio_address', value: '18, Brindavan Road, Fairlands\nSalem - 636 016', group: 'studio' },
    { key: 'studio_phone', value: '9843096461', group: 'studio' },
    { key: 'studio_email', value: '', group: 'studio' },
    { key: 'studio_gstin', value: '33ABWPY8748G1ZN', group: 'studio' },
    { key: 'invoice_prefix', value: 'MS', group: 'invoice' },
    { key: 'invoice_footer', value: 'Thank You', group: 'invoice' },
    { key: 'gst_enabled', value: 'true', group: 'tax' },
    { key: 'default_gst_rate', value: '18', group: 'tax' },
    { key: 'thermal_printer_name', value: 'RP-3160', group: 'printer' },
    { key: 'thermal_paper_width', value: '80', group: 'printer' },
    { key: 'currency_symbol', value: '₹', group: 'general' },
    { key: 'currency_code', value: 'INR', group: 'general' },
    { key: 'show_whatsapp_on_billing', value: 'true', group: 'general' },
    // MM billing module's own settings — separate from the main tax group,
    // since MM's default GST rate (5%) is independent of the studio's
    // regular default_gst_rate (18%) above.
    { key: 'mm_default_gst_rate', value: '5', group: 'mm' },
    // Gate on editing a saved bill (both MAIN and MM) — a soft deterrent
    // against casual/accidental edits, not real auth (this app has none,
    // deliberately). Changeable in Settings → Security.
    { key: 'bill_edit_password', value: '1234567890', group: 'security' },
  ];

  for (const s of defaults) {
    await prisma.setting.upsert({
      where: { key: s.key },
      update: { value: s.value },
      create: s,
    });
  }
  console.log('✓ Default settings created');

  // Catalog defaults live in utils/catalogDefaults.ts so that this seed and
  // the Alt → Setup → "Restore Default Products & Services" route can never
  // disagree about what "default" means.
  for (const p of DEFAULT_PRODUCTS) {
    const existing = await prisma.product.findFirst({ where: { name: p.name } });
    if (!existing) {
      await prisma.product.create({
        data: { name: p.name, unit: p.unit, unitPrice: p.unitPrice, gstRate: p.gstRate },
      });
    }
  }
  console.log('✓ Sample products created');

  for (const name of DEFAULT_MM_PRODUCT_NAMES) {
    const existing = await prisma.mmProduct.findFirst({ where: { name } });
    if (!existing) {
      await prisma.mmProduct.create({ data: { name, ...DEFAULT_MM_PRODUCT_FIELDS } });
    }
  }
  console.log('✓ MM products created');

  for (const name of DEFAULT_SERVICE_NAMES) {
    const existing = await prisma.service.findFirst({ where: { name } });
    if (!existing) {
      await prisma.service.create({ data: { name } });
    }
  }
  console.log('✓ Sample services created');

  // Sample customer
  await prisma.customer.upsert({
    where: { id: 1 },
    update: {},
    create: {
      name: 'Walk-in Customer',
      phone: '0000000000',
      notes: 'Default walk-in customer',
    },
  }).catch(() =>
    prisma.customer.create({
      data: { name: 'Walk-in Customer', phone: '0000000000', notes: 'Default walk-in customer' },
    }),
  );
  console.log('✓ Default walk-in customer created');

  console.log('\nDatabase seeded successfully!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
