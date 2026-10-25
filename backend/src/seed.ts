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
  console.log('Seeding MM Billing database...');

  // Default settings
  const defaults: Array<{ key: string; value: string; group: string }> = [
    { key: 'studio_name', value: 'MORU MORU SNACKS', group: 'studio' },
    { key: 'studio_owner', value: 'SREE MEENAKSHI ENTERPRISES', group: 'studio' },
    { key: 'studio_address', value: '21, Pachapatty Krishna Nagar 8th cross\nAmmapet Salem - 636003.', group: 'studio' },
    { key: 'studio_phone', value: '9698676151', group: 'studio' },
    { key: 'studio_email', value: '', group: 'studio' },
    { key: 'studio_gstin', value: '33BAKPM3311D1Z9', group: 'studio' },
    { key: 'invoice_prefix', value: 'MM', group: 'invoice' },
    { key: 'invoice_footer', value: 'Thank You! Visit Again.', group: 'invoice' },
    { key: 'gst_enabled', value: 'true', group: 'tax' },
    { key: 'default_gst_rate', value: '5', group: 'tax' },
    { key: 'thermal_printer_name', value: 'RP-3160', group: 'printer' },
    { key: 'thermal_paper_width', value: '80', group: 'printer' },
    { key: 'currency_symbol', value: '₹', group: 'general' },
    { key: 'currency_code', value: 'INR', group: 'general' },
    { key: 'show_whatsapp_on_billing', value: 'true', group: 'general' },
    
    // MM Specific Identity & Tax settings
    { key: 'mm_default_gst_rate', value: '5', group: 'mm' },
    { key: 'mm_company_name', value: 'SREE MEENAKSHI ENTERPRISES', group: 'mm' },
    { key: 'mm_brand_name', value: 'MORU MORU SNACKS', group: 'mm' },
    { key: 'mm_tagline', value: '- Fully Automated 100% Hygiene Products. - The Mastero Food Products -', group: 'mm' },
    { key: 'mm_fssai_no', value: '22426581000542', group: 'mm' },
    { key: 'mm_address', value: '21, Pachapatty Krishna Nagar 8th cross\nAmmapet Salem - 636003.', group: 'mm' },
    { key: 'mm_branch_office', value: '35-A, Thiyagi Nataraj St No 1\nAmmapet Salem.', group: 'mm' },
    { key: 'mm_branch_fssai', value: '22426582000581', group: 'mm' },
    { key: 'mm_gstin', value: '33BAKPM3311D1Z9', group: 'mm' },
    { key: 'mm_contact', value: '9698676151', group: 'mm' },
    { key: 'mm_state_name', value: 'Tamil Nadu', group: 'mm' },
    { key: 'mm_state_code', value: '33', group: 'mm' },
    { key: 'mm_bank_account_name', value: 'SREE MEENAKSHI ENTERPRISES', group: 'mm' },
    { key: 'mm_bank_name', value: 'IDBI BANK', group: 'mm' },
    { key: 'mm_bank_account_number', value: '1907102000007535', group: 'mm' },
    { key: 'mm_bank_branch', value: 'AMMAPET', group: 'mm' },
    { key: 'mm_bank_ifsc', value: 'IBKL0001907', group: 'mm' },
    { key: 'mm_jurisdiction', value: 'SALEM', group: 'mm' },
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

  // MM Products
  for (const name of DEFAULT_MM_PRODUCT_NAMES) {
    const existing = await prisma.mmProduct.findFirst({ where: { name } });
    if (!existing) {
      await prisma.mmProduct.create({ data: { name, ...DEFAULT_MM_PRODUCT_FIELDS, stockQty: 100 } });
    }
  }
  console.log('✓ MM products created');

  // Sample MM wholesale customer
  const existingCustomer = await prisma.mmCustomer.findFirst({ where: { phone: '9840012345' } });
  if (!existingCustomer) {
    await prisma.mmCustomer.create({
      data: {
        name: 'Sri Krishna Sweets & Bakery',
        phone: '9840012345',
        address: '45, Car Street, Salem - 636001',
        gstin: '33AABCS1429B1ZB',
        notes: 'Regular wholesale buyer',
      },
    });
    console.log('✓ Sample MM customer created');
  }

  console.log('\nMM Database seeded successfully!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
