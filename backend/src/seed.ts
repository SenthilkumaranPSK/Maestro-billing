import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Default operator login — created only when the users table is empty, so
  // re-seeding never resets a changed password. CHANGE THIS PASSWORD from
  // Settings after first login on any machine that is reachable from outside.
  if ((await prisma.user.count()) === 0) {
    await prisma.user.create({
      data: {
        username: 'maestro',
        passwordHash: await bcrypt.hash('maestro@2026', 10),
        role: 'admin',
      },
    });
    console.log('✓ Default user created (maestro / maestro@2026 — change it!)');
  }

  // Default settings
  const defaults: Array<{ key: string; value: string; group: string }> = [
    { key: 'studio_name', value: "The Maestro Studio's", group: 'studio' },
    { key: 'studio_owner', value: 'Maestro Yuvaraj V', group: 'studio' },
    { key: 'studio_address', value: 'Brindavan Road, Fairlands, Salem - 636 016', group: 'studio' },
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
