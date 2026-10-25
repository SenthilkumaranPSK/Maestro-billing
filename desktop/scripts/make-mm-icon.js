const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pngToIco = require('png-to-ico');

const BUILD_DIR = path.join(__dirname, '..', 'build');
const FRONTEND_PUBLIC = path.join(__dirname, '..', '..', 'frontend', 'public');
const FRONTEND_DIST = path.join(__dirname, '..', '..', 'frontend', 'dist');

async function main() {
  console.log('Generating official MM icons from master logo...');

  const masterLogoPath = path.join(BUILD_DIR, 'mm_logo_original.png');
  if (!fs.existsSync(masterLogoPath)) {
    throw new Error('Master logo not found at: ' + masterLogoPath);
  }

  // 1. Copy master logo as mm-logo.png for sidebar/header
  fs.copyFileSync(masterLogoPath, path.join(FRONTEND_PUBLIC, 'mm-logo.png'));
  if (fs.existsSync(FRONTEND_DIST)) {
    fs.copyFileSync(masterLogoPath, path.join(FRONTEND_DIST, 'mm-logo.png'));
  }
  console.log('Updated mm-logo.png in frontend public & dist');

  // 2. Read master logo dimensions
  const logoMeta = await sharp(masterLogoPath).metadata();
  const targetW = 210;
  const targetH = Math.round((logoMeta.height / logoMeta.width) * targetW);
  const resizedLogo = await sharp(masterLogoPath).resize(targetW, targetH).toBuffer();

  // 3. Create clean 256x256 card for desktop icon & favicon
  const svgCard = `
    <svg width="256" height="256" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="cardGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#FFFFFF" />
          <stop offset="100%" stop-color="#FEF2F2" />
        </linearGradient>
      </defs>
      <rect x="8" y="8" width="240" height="240" rx="48" fill="url(#cardGrad)" stroke="#DC2626" stroke-width="6" />
      <rect x="16" y="16" width="224" height="224" rx="40" fill="none" stroke="#FDE047" stroke-width="2" opacity="0.8" />
    </svg>
  `;

  const left = Math.round((256 - targetW) / 2);
  const top = Math.round((256 - targetH) / 2);

  const icon256Buffer = await sharp(Buffer.from(svgCard))
    .composite([{ input: resizedLogo, left, top }])
    .png()
    .toBuffer();

  const outPng = path.join(BUILD_DIR, 'icon-256.png');
  fs.writeFileSync(outPng, icon256Buffer);
  console.log('Wrote', outPng);

  // 4. Generate .ico for Windows executable
  const icoBuffer = await pngToIco(outPng);
  const outIco = path.join(BUILD_DIR, 'icon.ico');
  fs.writeFileSync(outIco, icoBuffer);
  console.log('Wrote', outIco);

  // 5. Update web favicon & receipt assets
  fs.writeFileSync(path.join(FRONTEND_PUBLIC, 'mm-logo-icon.png'), icon256Buffer);
  fs.writeFileSync(path.join(FRONTEND_PUBLIC, 'Logo.png'), fs.readFileSync(masterLogoPath));
  fs.writeFileSync(path.join(FRONTEND_PUBLIC, 'Logo-receipt.png'), icon256Buffer);

  if (fs.existsSync(FRONTEND_DIST)) {
    fs.writeFileSync(path.join(FRONTEND_DIST, 'mm-logo-icon.png'), icon256Buffer);
    fs.writeFileSync(path.join(FRONTEND_DIST, 'Logo.png'), fs.readFileSync(masterLogoPath));
    fs.writeFileSync(path.join(FRONTEND_DIST, 'Logo-receipt.png'), icon256Buffer);
  }
  console.log('Updated frontend public & dist icon files.');
}

main().catch(err => {
  console.error('Failed to generate MM icons:', err);
  process.exit(1);
});
