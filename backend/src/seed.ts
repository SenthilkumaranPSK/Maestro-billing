import 'dotenv/config';
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
    { key: 'studio_address', value: 'Brindavan Road, Fairlands\nSalem - 636 016', group: 'studio' },
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
  ];

  for (const s of defaults) {
    await prisma.setting.upsert({
      where: { key: s.key },
      update: { value: s.value },
      create: s,
    });
  }
  console.log('✓ Default settings created');

  // Sample products
  const products = [
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

  for (const p of products) {
    const existing = await prisma.product.findFirst({ where: { name: p.name } });
    if (!existing) {
      await prisma.product.create({
        data: { name: p.name, unit: p.unit, unitPrice: p.unitPrice, gstRate: p.gstRate },
      });
    }
  }
  console.log('✓ Sample products created');

  // Sample services — feeds the A4 invoice's Service Description autocomplete.
  // Deliberately just names, no HSN/SAC/price here: those are studio/CA-specific
  // and shouldn't ship as a guessed default.
  const services = [
    'Wedding Photography',
    'Wedding Videography',
    'Pre-Wedding Shoot',
    'Product Photography',
    'Product Video Shoot',
    'Baby / Family Portrait Session',
    'Birthday & Event Coverage',
    'Passport / ID Photo Service',
  ];

  for (const name of services) {
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
