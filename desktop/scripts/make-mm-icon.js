const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pngToIco = require('png-to-ico');

const BUILD_DIR = path.join(__dirname, '..', 'build');
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'frontend', 'public');

if (!fs.existsSync(BUILD_DIR)) {
  fs.mkdirSync(BUILD_DIR, { recursive: true });
}

// 1024x1024 high-res icon SVG
const mmIconSvg = `
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#DC2626" />
      <stop offset="45%" stop-color="#B91C1C" />
      <stop offset="100%" stop-color="#7F1D1D" />
    </linearGradient>
    <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FDE047" />
      <stop offset="50%" stop-color="#EAB308" />
      <stop offset="100%" stop-color="#CA8A04" />
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="16" stdDeviation="24" flood-color="#000000" flood-opacity="0.35"/>
    </filter>
  </defs>

  <!-- Rounded App Icon Background -->
  <rect x="64" y="64" width="896" height="896" rx="200" fill="url(#bgGrad)" filter="url(#shadow)" />
  
  <!-- Outer Gold Border -->
  <rect x="64" y="64" width="896" height="896" rx="200" fill="none" stroke="url(#goldGrad)" stroke-width="24" opacity="0.85" />
  <rect x="88" y="88" width="848" height="848" rx="176" fill="none" stroke="#FFFFFF" stroke-width="4" opacity="0.3" />

  <!-- Center MM Monogram -->
  <g id="monogram">
    <!-- First 'M' -->
    <path d="M 230 630 L 230 390 L 310 390 L 390 535 L 470 390 L 550 390 L 550 630 L 475 630 L 475 490 L 415 600 L 365 600 L 305 490 L 305 630 Z" 
          fill="#FFFFFF" />
          
    <!-- Second 'M' (Interlocking / Shifted) -->
    <path d="M 474 630 L 474 390 L 554 390 L 634 535 L 714 390 L 794 390 L 794 630 L 719 630 L 719 490 L 659 600 L 609 600 L 549 490 L 549 630 Z" 
          fill="url(#goldGrad)" />
  </g>

  <!-- Tagline Banner -->
  <rect x="180" y="690" width="664" height="64" rx="32" fill="#FFFFFF" opacity="0.95" />
  <text x="512" y="734" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="900" fill="#991B1B" text-anchor="middle" letter-spacing="4">
    MORU MORU SNACKS
  </text>
  
  <text x="512" y="790" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="700" fill="#FEF08A" text-anchor="middle" letter-spacing="3">
    SREE MEENAKSHI ENTERPRISES
  </text>
</svg>
`;

// Wide horizontal logo for sidebar header (400x120)
const mmHeaderSvg = `
<svg width="400" height="120" viewBox="0 0 400 120" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="hBgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#DC2626" />
      <stop offset="100%" stop-color="#991B1B" />
    </linearGradient>
    <linearGradient id="hGold" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FDE047" />
      <stop offset="100%" stop-color="#CA8A04" />
    </linearGradient>
  </defs>

  <!-- Badge Emblem -->
  <rect x="10" y="15" width="90" height="90" rx="22" fill="url(#hBgGrad)" />
  <rect x="10" y="15" width="90" height="90" rx="22" fill="none" stroke="url(#hGold)" stroke-width="4" />
  
  <!-- MM inside emblem -->
  <text x="35" y="75" font-family="Arial, Helvetica, sans-serif" font-size="44" font-weight="900" fill="#FFFFFF">M</text>
  <text x="60" y="75" font-family="Arial, Helvetica, sans-serif" font-size="44" font-weight="900" fill="url(#hGold)">M</text>

  <!-- Brand Typography -->
  <text x="120" y="52" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="900" fill="#1E293B" letter-spacing="1">
    MORU MORU
  </text>
  <text x="120" y="78" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="800" fill="#DC2626" letter-spacing="3">
    SNACKS
  </text>
  <text x="120" y="96" font-family="Arial, Helvetica, sans-serif" font-size="10" font-weight="700" fill="#64748B" letter-spacing="1">
    SREE MEENAKSHI ENTERPRISES
  </text>
</svg>
`;

async function main() {
  console.log('Generating MM icons & logos...');
  
  // 1. Icon 1024x1024 PNG
  const icon1024Buffer = await sharp(Buffer.from(mmIconSvg)).resize(1024, 1024).png().toBuffer();
  
  // 2. Icon 256x256 PNG for Electron builder
  const icon256Buffer = await sharp(icon1024Buffer).resize(256, 256).png().toBuffer();
  const outPng = path.join(BUILD_DIR, 'icon-256.png');
  fs.writeFileSync(outPng, icon256Buffer);
  console.log('Wrote', outPng);

  // 3. Icon .ico for Windows Executable
  const icoBuffer = await pngToIco(outPng);
  const outIco = path.join(BUILD_DIR, 'icon.ico');
  fs.writeFileSync(outIco, icoBuffer);
  console.log('Wrote', outIco);

  // 4. Also copy to frontend/public for web favicon & display
  const outFavicon = path.join(PUBLIC_DIR, 'mm-logo-icon.png');
  fs.writeFileSync(outFavicon, icon256Buffer);
  console.log('Wrote', outFavicon);

  // 5. Header / Sidebar logo
  const headerBuffer = await sharp(Buffer.from(mmHeaderSvg)).resize(400, 120).png().toBuffer();
  const outHeaderLogo = path.join(PUBLIC_DIR, 'mm-logo.png');
  fs.writeFileSync(outHeaderLogo, headerBuffer);
  console.log('Wrote', outHeaderLogo);

  // Also replace Logo.png and Logo-receipt.png in frontend/public of codes 2 with MM versions
  fs.writeFileSync(path.join(PUBLIC_DIR, 'Logo-receipt.png'), icon256Buffer);
  fs.writeFileSync(path.join(PUBLIC_DIR, 'Logo.png'), headerBuffer);
  console.log('Updated public Logo.png and Logo-receipt.png with MM branding');
}

main().catch((err) => {
  console.error('Failed to generate MM icons:', err);
  process.exit(1);
});
