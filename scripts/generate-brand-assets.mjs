/* eslint-disable */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const BRAND_DIR = path.resolve(ROOT, "packages/ui/src/brand");
const ICONS_SVG_DIR = path.resolve(ROOT, "packages/ui/src/icons/svg");
const PUBLIC_DIR = path.resolve(ROOT, "apps/web/public");
const PUBLIC_ICONS_DIR = path.resolve(PUBLIC_DIR, "icons");
const DOCS_IMAGES_DIR = path.resolve(ROOT, "docs/images");

[BRAND_DIR, ICONS_SVG_DIR, PUBLIC_DIR, PUBLIC_ICONS_DIR, DOCS_IMAGES_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Brand Colors
const COLOR_PRIMARY = "#1a564b"; // Deep Mediterranean Pine (Light)
const COLOR_PRIMARY_DARK = "#4ecbb6"; // Luminous Seafoam / Sage (Dark)
const COLOR_WARM_ACCENT = "#d9822b"; // Warm Terracotta Ochre
const COLOR_LIGHT_BG = "#ffffff";
const COLOR_DARK_BG = "#11151c";
const COLOR_DARK_SURFACE = "#171c24";
const COLOR_LIGHT_SURFACE = "#f8fafc";
const COLOR_TEXT_MUTED = "#64748b";
const COLOR_TEXT_DARK_MUTED = "#94a3b8";

// ---------------------------------------------------------------------------
// 1. Raw Vector Definitions
// ---------------------------------------------------------------------------

// Standalone Mark SVG
function getMarkSvg(color = "currentColor", size = 64) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}" fill="none">
  <!-- OpenHR "L'Arc" Mark: Open Meridian Ring & Inner Radiant Core -->
  <path d="M 44.5 14.5 A 22 22 0 1 0 53 35" stroke="${color}" stroke-width="6" stroke-linecap="round"/>
  <circle cx="32" cy="32" r="7.5" fill="${color}"/>
</svg>`;
}

// Standalone Wordmark SVG (Pure geometric paths, zero <text> elements)
function getWordmarkSvg(color = "currentColor", width = 250, height = 64) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 64" width="${width}" height="${height}" fill="${color}">
  <!-- O -->
  <path d="M 22 13 C 10.95 13 2 21.95 2 33 C 2 44.05 10.95 53 22 53 C 33.05 53 42 44.05 42 33 C 42 21.95 33.05 13 22 13 Z M 22 18.5 C 30.01 18.5 36.5 24.99 36.5 33 C 36.5 41.01 30.01 47.5 22 47.5 C 13.99 47.5 7.5 41.01 7.5 33 C 7.5 24.99 13.99 18.5 22 18.5 Z" />
  <!-- p -->
  <path d="M 49 23 L 54.5 23 L 54.5 27.2 C 56.8 24.2 60.6 22.5 65.2 22.5 C 73.8 22.5 80 29.2 80 38.5 C 80 47.8 73.8 54.5 65.2 54.5 C 60.6 54.5 56.8 52.8 54.5 49.8 L 54.5 63 L 49 63 Z M 64.5 27.8 C 58.6 27.8 54.5 32.5 54.5 38.5 C 54.5 44.5 58.6 49.2 64.5 49.2 C 70.4 49.2 74.5 44.5 74.5 38.5 C 74.5 32.5 70.4 27.8 64.5 27.8 Z" />
  <!-- e -->
  <path d="M 98 22.5 C 88.2 22.5 81 29.8 81 39 C 81 48.2 88.2 54.5 98.5 54.5 C 105.2 54.5 110.5 51.2 113 45.5 L 107.5 43.5 C 106 47 102.5 49.2 98.5 49.2 C 92.8 49.2 87.8 45.5 86.6 39.8 L 114.5 39.8 C 114.7 38.8 114.7 37.8 114.7 36.8 C 114.7 28.5 107.8 22.5 98 22.5 Z M 86.8 35.5 C 88 30.8 92.2 27.5 98 27.5 C 103.8 27.5 108.2 30.8 109 35.5 Z" />
  <!-- n -->
  <path d="M 121 23 L 126.5 23 L 126.5 27.8 C 128.8 24.5 132.8 22.5 138 22.5 C 146 22.5 150 27.2 150 35.5 L 150 53 L 144.5 53 L 144.5 36.5 C 144.5 30.8 141.5 27.8 136.5 27.8 C 130.8 27.8 126.5 32 126.5 38.5 L 126.5 53 L 121 53 Z" />
  <!-- H -->
  <path d="M 163 13 L 169 13 L 169 30 L 187 30 L 187 13 L 193 13 L 193 53 L 187 53 L 187 35.5 L 169 35.5 L 169 53 L 163 53 Z" />
  <!-- R -->
  <path d="M 203 13 L 219.5 13 C 226.5 13 231.5 17.5 231.5 24.5 C 231.5 30 227.8 33.8 222 35.2 L 233 53 L 226 53 L 216 36 L 209 36 L 209 53 L 203 53 Z M 209 18.5 L 209 31 L 219 31 C 223 31 225.5 28.5 225.5 24.8 C 225.5 21 223 18.5 219 18.5 Z" />
</svg>`;
}

// Horizontal Lockup SVG (viewBox 340 70)
function getHorizontalLockupSvg(markColor = COLOR_PRIMARY, textColor = COLOR_PRIMARY, width = 340, height = 70) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 340 70" width="${width}" height="${height}" fill="none">
  <!-- Mark -->
  <g transform="translate(6, 3)">
    <path d="M 44.5 14.5 A 22 22 0 1 0 53 35" stroke="${markColor}" stroke-width="6" stroke-linecap="round"/>
    <circle cx="32" cy="32" r="7.5" fill="${markColor}"/>
  </g>
  <!-- Wordmark -->
  <g fill="${textColor}" transform="translate(80, 5)">
    <!-- O -->
    <path d="M 22 13 C 10.95 13 2 21.95 2 33 C 2 44.05 10.95 53 22 53 C 33.05 53 42 44.05 42 33 C 42 21.95 33.05 13 22 13 Z M 22 18.5 C 30.01 18.5 36.5 24.99 36.5 33 C 36.5 41.01 30.01 47.5 22 47.5 C 13.99 47.5 7.5 41.01 7.5 33 C 7.5 24.99 13.99 18.5 22 18.5 Z" />
    <!-- p -->
    <path d="M 49 23 L 54.5 23 L 54.5 27.2 C 56.8 24.2 60.6 22.5 65.2 22.5 C 73.8 22.5 80 29.2 80 38.5 C 80 47.8 73.8 54.5 65.2 54.5 C 60.6 54.5 56.8 52.8 54.5 49.8 L 54.5 63 L 49 63 Z M 64.5 27.8 C 58.6 27.8 54.5 32.5 54.5 38.5 C 54.5 44.5 58.6 49.2 64.5 49.2 C 70.4 49.2 74.5 44.5 74.5 38.5 C 74.5 32.5 70.4 27.8 64.5 27.8 Z" />
    <!-- e -->
    <path d="M 98 22.5 C 88.2 22.5 81 29.8 81 39 C 81 48.2 88.2 54.5 98.5 54.5 C 105.2 54.5 110.5 51.2 113 45.5 L 107.5 43.5 C 106 47 102.5 49.2 98.5 49.2 C 92.8 49.2 87.8 45.5 86.6 39.8 L 114.5 39.8 C 114.7 38.8 114.7 37.8 114.7 36.8 C 114.7 28.5 107.8 22.5 98 22.5 Z M 86.8 35.5 C 88 30.8 92.2 27.5 98 27.5 C 103.8 27.5 108.2 30.8 109 35.5 Z" />
    <!-- n -->
    <path d="M 121 23 L 126.5 23 L 126.5 27.8 C 128.8 24.5 132.8 22.5 138 22.5 C 146 22.5 150 27.2 150 35.5 L 150 53 L 144.5 53 L 144.5 36.5 C 144.5 30.8 141.5 27.8 136.5 27.8 C 130.8 27.8 126.5 32 126.5 38.5 L 126.5 53 L 121 53 Z" />
    <!-- H -->
    <path d="M 163 13 L 169 13 L 169 30 L 187 30 L 187 13 L 193 13 L 193 53 L 187 53 L 187 35.5 L 169 35.5 L 169 53 L 163 53 Z" />
    <!-- R -->
    <path d="M 203 13 L 219.5 13 C 226.5 13 231.5 17.5 231.5 24.5 C 231.5 30 227.8 33.8 222 35.2 L 233 53 L 226 53 L 216 36 L 209 36 L 209 53 L 203 53 Z M 209 18.5 L 209 31 L 219 31 C 223 31 225.5 28.5 225.5 24.8 C 225.5 21 223 18.5 219 18.5 Z" />
  </g>
</svg>`;
}

// Stacked Lockup SVG (viewBox 0 0 260 200)
function getStackedLockupSvg(markColor = COLOR_PRIMARY, textColor = COLOR_PRIMARY, width = 260, height = 200) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 200" width="${width}" height="${height}" fill="none">
  <!-- Centered Mark -->
  <g transform="translate(98, 20)">
    <path d="M 44.5 14.5 A 22 22 0 1 0 53 35" stroke="${markColor}" stroke-width="6" stroke-linecap="round"/>
    <circle cx="32" cy="32" r="7.5" fill="${markColor}"/>
  </g>
  <!-- Wordmark below -->
  <g fill="${textColor}" transform="translate(6, 110)">
    <!-- O -->
    <path d="M 22 13 C 10.95 13 2 21.95 2 33 C 2 44.05 10.95 53 22 53 C 33.05 53 42 44.05 42 33 C 42 21.95 33.05 13 22 13 Z M 22 18.5 C 30.01 18.5 36.5 24.99 36.5 33 C 36.5 41.01 30.01 47.5 22 47.5 C 13.99 47.5 7.5 41.01 7.5 33 C 7.5 24.99 13.99 18.5 22 18.5 Z" />
    <!-- p -->
    <path d="M 49 23 L 54.5 23 L 54.5 27.2 C 56.8 24.2 60.6 22.5 65.2 22.5 C 73.8 22.5 80 29.2 80 38.5 C 80 47.8 73.8 54.5 65.2 54.5 C 60.6 54.5 56.8 52.8 54.5 49.8 L 54.5 63 L 49 63 Z M 64.5 27.8 C 58.6 27.8 54.5 32.5 54.5 38.5 C 54.5 44.5 58.6 49.2 64.5 49.2 C 70.4 49.2 74.5 44.5 74.5 38.5 C 74.5 32.5 70.4 27.8 64.5 27.8 Z" />
    <!-- e -->
    <path d="M 98 22.5 C 88.2 22.5 81 29.8 81 39 C 81 48.2 88.2 54.5 98.5 54.5 C 105.2 54.5 110.5 51.2 113 45.5 L 107.5 43.5 C 106 47 102.5 49.2 98.5 49.2 C 92.8 49.2 87.8 45.5 86.6 39.8 L 114.5 39.8 C 114.7 38.8 114.7 37.8 114.7 36.8 C 114.7 28.5 107.8 22.5 98 22.5 Z M 86.8 35.5 C 88 30.8 92.2 27.5 98 27.5 C 103.8 27.5 108.2 30.8 109 35.5 Z" />
    <!-- n -->
    <path d="M 121 23 L 126.5 23 L 126.5 27.8 C 128.8 24.5 132.8 22.5 138 22.5 C 146 22.5 150 27.2 150 35.5 L 150 53 L 144.5 53 L 144.5 36.5 C 144.5 30.8 141.5 27.8 136.5 27.8 C 130.8 27.8 126.5 32 126.5 38.5 L 126.5 53 L 121 53 Z" />
    <!-- H -->
    <path d="M 163 13 L 169 13 L 169 30 L 187 30 L 187 13 L 193 13 L 193 53 L 187 53 L 187 35.5 L 169 35.5 L 169 53 L 163 53 Z" />
    <!-- R -->
    <path d="M 203 13 L 219.5 13 C 226.5 13 231.5 17.5 231.5 24.5 C 231.5 30 227.8 33.8 222 35.2 L 233 53 L 226 53 L 216 36 L 209 36 L 209 53 L 203 53 Z M 209 18.5 L 209 31 L 219 31 C 223 31 225.5 28.5 225.5 24.8 C 225.5 21 223 18.5 219 18.5 Z" />
  </g>
</svg>`;
}

// Adaptive SVG Favicon (prefers-color-scheme)
function getAdaptiveFaviconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <style>
    :root {
      --mark-color: #1a564b;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --mark-color: #4ecbb6;
      }
    }
  </style>
  <path d="M 44.5 14.5 A 22 22 0 1 0 53 35" stroke="var(--mark-color)" stroke-width="6" stroke-linecap="round" fill="none"/>
  <circle cx="32" cy="32" r="7.5" fill="var(--mark-color)"/>
</svg>`;
}

// ---------------------------------------------------------------------------
// 2. Custom Module Icons (24x24, 1.75 stroke, Lucide style)
// ---------------------------------------------------------------------------

const MODULE_ICONS = {
  "employees": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
  <circle cx="9" cy="7" r="4"/>
  <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
  <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
</svg>`,

  "org-chart": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <rect x="8" y="3" width="8" height="5" rx="1.5"/>
  <rect x="2" y="16" width="6" height="5" rx="1.5"/>
  <rect x="9" y="16" width="6" height="5" rx="1.5"/>
  <rect x="16" y="16" width="6" height="5" rx="1.5"/>
  <path d="M12 8v5"/>
  <path d="M5 13h14"/>
  <path d="M5 13v3"/>
  <path d="M12 13v3"/>
  <path d="M19 13v3"/>
</svg>`,

  "time-off": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="4" width="18" height="17" rx="3"/>
  <line x1="16" y1="2" x2="16" y2="6"/>
  <line x1="8" y1="2" x2="8" y2="6"/>
  <line x1="3" y1="10" x2="21" y2="10"/>
  <circle cx="12" cy="15.5" r="2.25"/>
  <path d="M12 12.25v.75"/>
  <path d="M12 18v.75"/>
  <path d="M8.75 15.5h.75"/>
  <path d="M14.5 15.5h.75"/>
</svg>`,

  "clock-in": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 21a9 9 0 1 0-9-9"/>
  <path d="M12 7v5l3 2"/>
  <path d="M2 12h6"/>
  <path d="M5 9l3 3-3 3"/>
</svg>`,

  "documents": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
  <polyline points="14 2 14 8 20 8"/>
  <line x1="8" y1="13" x2="16" y2="13"/>
  <line x1="8" y1="17" x2="12" y2="17"/>
</svg>`,

  "onboarding": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16"/>
  <path d="M15 12h.01"/>
  <path d="M2 21h20"/>
  <path d="M9 17l3-3 3 3"/>
</svg>`,

  "reports": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <path d="M3 21h18"/>
  <rect x="5" y="13" width="3" height="8" rx="1"/>
  <rect x="10.5" y="8" width="3" height="13" rx="1"/>
  <rect x="16" y="4" width="3" height="17" rx="1"/>
  <path d="M4 9l5-4 5 3 6-5"/>
</svg>`,

  "settings": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="3"/>
  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
</svg>`,
};

// ---------------------------------------------------------------------------
// 3. Execution: Write SVGs and Render PNGs
// ---------------------------------------------------------------------------

async function main() {
  console.log("Generating OpenHR Brand Assets...");

  // Write SVGs to packages/ui/src/brand
  fs.writeFileSync(path.join(BRAND_DIR, "openhr-mark.svg"), getMarkSvg(COLOR_PRIMARY));
  fs.writeFileSync(path.join(BRAND_DIR, "openhr-mark-dark.svg"), getMarkSvg(COLOR_PRIMARY_DARK));
  fs.writeFileSync(path.join(BRAND_DIR, "openhr-mark-monochrome.svg"), getMarkSvg("currentColor"));

  fs.writeFileSync(path.join(BRAND_DIR, "openhr-wordmark.svg"), getWordmarkSvg(COLOR_PRIMARY));
  fs.writeFileSync(path.join(BRAND_DIR, "openhr-wordmark-dark.svg"), getWordmarkSvg(COLOR_PRIMARY_DARK));
  fs.writeFileSync(path.join(BRAND_DIR, "openhr-wordmark-monochrome.svg"), getWordmarkSvg("currentColor"));

  fs.writeFileSync(path.join(BRAND_DIR, "openhr-lockup-horizontal.svg"), getHorizontalLockupSvg(COLOR_PRIMARY, COLOR_PRIMARY));
  fs.writeFileSync(path.join(BRAND_DIR, "openhr-lockup-horizontal-dark.svg"), getHorizontalLockupSvg(COLOR_PRIMARY_DARK, "#ffffff"));
  fs.writeFileSync(path.join(BRAND_DIR, "openhr-lockup-horizontal-monochrome.svg"), getHorizontalLockupSvg("currentColor", "currentColor"));

  fs.writeFileSync(path.join(BRAND_DIR, "openhr-lockup-stacked.svg"), getStackedLockupSvg(COLOR_PRIMARY, COLOR_PRIMARY));
  fs.writeFileSync(path.join(BRAND_DIR, "openhr-lockup-stacked-dark.svg"), getStackedLockupSvg(COLOR_PRIMARY_DARK, "#ffffff"));
  fs.writeFileSync(path.join(BRAND_DIR, "openhr-lockup-stacked-monochrome.svg"), getStackedLockupSvg("currentColor", "currentColor"));

  // Write SVGs to packages/ui/src/icons/svg
  for (const [name, content] of Object.entries(MODULE_ICONS)) {
    fs.writeFileSync(path.join(ICONS_SVG_DIR, `${name}.svg`), content);
  }

  // Write Adaptive SVG Favicon
  fs.writeFileSync(path.join(PUBLIC_DIR, "favicon.svg"), getAdaptiveFaviconSvg());

  // Also write SVGs into apps/web/public/icons
  fs.writeFileSync(path.join(PUBLIC_ICONS_DIR, "icon-192.svg"), getMarkSvg(COLOR_PRIMARY, 192));
  fs.writeFileSync(path.join(PUBLIC_ICONS_DIR, "icon-512.svg"), getMarkSvg(COLOR_PRIMARY, 512));

  console.log("SVGs written successfully.");

  // Render PNG Favicons (16, 32, 48) with solid and transparent backing
  const markBuffer = Buffer.from(getMarkSvg(COLOR_PRIMARY));
  await sharp(markBuffer).resize(16, 16).png().toFile(path.join(PUBLIC_DIR, "favicon-16x16.png"));
  await sharp(markBuffer).resize(32, 32).png().toFile(path.join(PUBLIC_DIR, "favicon-32x32.png"));
  await sharp(markBuffer).resize(48, 48).png().toFile(path.join(PUBLIC_DIR, "favicon-48x48.png"));
  console.log("Favicons 16/32/48 generated.");

  // Apple Touch Icon (180x180 on soft rounded square container)
  const appleTouchSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" width="180" height="180">
    <rect width="180" height="180" rx="38" fill="${COLOR_PRIMARY}"/>
    <g transform="translate(36, 36) scale(1.6875)">
      <path d="M 44.5 14.5 A 22 22 0 1 0 53 35" stroke="#ffffff" stroke-width="6" stroke-linecap="round" fill="none"/>
      <circle cx="32" cy="32" r="7.5" fill="#ffffff"/>
    </g>
  </svg>`;
  await sharp(Buffer.from(appleTouchSvg)).png().toFile(path.join(PUBLIC_DIR, "apple-touch-icon.png"));
  console.log("apple-touch-icon.png generated.");

  // PWA 192 and 512
  const pwa192Svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192" width="192" height="192">
    <rect width="192" height="192" rx="40" fill="${COLOR_PRIMARY}"/>
    <g transform="translate(38, 38) scale(1.8125)">
      <path d="M 44.5 14.5 A 22 22 0 1 0 53 35" stroke="#ffffff" stroke-width="6" stroke-linecap="round" fill="none"/>
      <circle cx="32" cy="32" r="7.5" fill="#ffffff"/>
    </g>
  </svg>`;
  await sharp(Buffer.from(pwa192Svg)).png().toFile(path.join(PUBLIC_ICONS_DIR, "icon-192.png"));

  const pwa512Svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
    <rect width="512" height="512" rx="108" fill="${COLOR_PRIMARY}"/>
    <g transform="translate(102, 102) scale(4.8125)">
      <path d="M 44.5 14.5 A 22 22 0 1 0 53 35" stroke="#ffffff" stroke-width="6" stroke-linecap="round" fill="none"/>
      <circle cx="32" cy="32" r="7.5" fill="#ffffff"/>
    </g>
  </svg>`;
  await sharp(Buffer.from(pwa512Svg)).png().toFile(path.join(PUBLIC_ICONS_DIR, "icon-512.png"));
  console.log("PWA icons 192/512 generated.");

  // PWA 512 Maskable with safe zone (80% inner safe circle per W3C specification)
  // Inner mark occupies 60% of the canvas to be well within the 80% safe zone circle
  const pwaMaskableSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
    <rect width="512" height="512" fill="${COLOR_PRIMARY}"/>
    <g transform="translate(128, 128) scale(4.0)">
      <path d="M 44.5 14.5 A 22 22 0 1 0 53 35" stroke="#ffffff" stroke-width="6" stroke-linecap="round" fill="none"/>
      <circle cx="32" cy="32" r="7.5" fill="#ffffff"/>
    </g>
  </svg>`;
  await sharp(Buffer.from(pwaMaskableSvg)).png().toFile(path.join(PUBLIC_ICONS_DIR, "icon-maskable-512.png"));
  console.log("PWA icon-maskable-512.png generated.");

  // OG / Social Image (1200x630)
  const ogSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#0f172a" />
        <stop offset="100%" stop-color="#11151c" />
      </linearGradient>
      <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#4ecbb6" />
        <stop offset="100%" stop-color="#1a564b" />
      </linearGradient>
    </defs>
    <rect width="1200" height="630" fill="url(#bg)"/>

    <!-- Subtle geometric grid/rings in background -->
    <circle cx="950" cy="315" r="320" stroke="#1e293b" stroke-width="2" fill="none" opacity="0.6"/>
    <circle cx="950" cy="315" r="220" stroke="#1e293b" stroke-width="2" fill="none" opacity="0.6"/>
    <circle cx="950" cy="315" r="120" stroke="#334155" stroke-width="2" fill="none" opacity="0.8"/>
    
    <!-- Hero Brand Mark (watermark glow on right) -->
    <g transform="translate(800, 165) scale(4.68)" opacity="0.95">
      <path d="M 44.5 14.5 A 22 22 0 1 0 53 35" stroke="#4ecbb6" stroke-width="6" stroke-linecap="round" fill="none"/>
      <circle cx="32" cy="32" r="7.5" fill="#4ecbb6"/>
    </g>

    <!-- Badge -->
    <rect x="90" y="90" width="280" height="38" rx="19" fill="#1e293b" stroke="#334155" stroke-width="1.5"/>
    <circle cx="110" cy="109" r="5" fill="#4ecbb6" />
    <text x="126" y="114" fill="#94a3b8" font-family="Segoe UI, Arial, sans-serif" font-size="14" font-weight="600" letter-spacing="0.5">OPEN-SOURCE AGPL-3.0</text>

    <!-- Horizontal Brand Lockup -->
    <g transform="translate(90, 160) scale(1.65)">
      <!-- Mark -->
      <g transform="translate(0, 0)">
        <path d="M 44.5 14.5 A 22 22 0 1 0 53 35" stroke="#4ecbb6" stroke-width="6" stroke-linecap="round" fill="none"/>
        <circle cx="32" cy="32" r="7.5" fill="#4ecbb6"/>
      </g>
      <!-- Wordmark -->
      <g fill="#ffffff" transform="translate(74, 2)">
        <path d="M 22 13 C 10.95 13 2 21.95 2 33 C 2 44.05 10.95 53 22 53 C 33.05 53 42 44.05 42 33 C 42 21.95 33.05 13 22 13 Z M 22 18.5 C 30.01 18.5 36.5 24.99 36.5 33 C 36.5 41.01 30.01 47.5 22 47.5 C 13.99 47.5 7.5 41.01 7.5 33 C 7.5 24.99 13.99 18.5 22 18.5 Z" />
        <path d="M 49 23 L 54.5 23 L 54.5 27.2 C 56.8 24.2 60.6 22.5 65.2 22.5 C 73.8 22.5 80 29.2 80 38.5 C 80 47.8 73.8 54.5 65.2 54.5 C 60.6 54.5 56.8 52.8 54.5 49.8 L 54.5 63 L 49 63 Z M 64.5 27.8 C 58.6 27.8 54.5 32.5 54.5 38.5 C 54.5 44.5 58.6 49.2 64.5 49.2 C 70.4 49.2 74.5 44.5 74.5 38.5 C 74.5 32.5 70.4 27.8 64.5 27.8 Z" />
        <path d="M 98 22.5 C 88.2 22.5 81 29.8 81 39 C 81 48.2 88.2 54.5 98.5 54.5 C 105.2 54.5 110.5 51.2 113 45.5 L 107.5 43.5 C 106 47 102.5 49.2 98.5 49.2 C 92.8 49.2 87.8 45.5 86.6 39.8 L 114.5 39.8 C 114.7 38.8 114.7 37.8 114.7 36.8 C 114.7 28.5 107.8 22.5 98 22.5 Z M 86.8 35.5 C 88 30.8 92.2 27.5 98 27.5 C 103.8 27.5 108.2 30.8 109 35.5 Z" />
        <path d="M 121 23 L 126.5 23 L 126.5 27.8 C 128.8 24.5 132.8 22.5 138 22.5 C 146 22.5 150 27.2 150 35.5 L 150 53 L 144.5 53 L 144.5 36.5 C 144.5 30.8 141.5 27.8 136.5 27.8 C 130.8 27.8 126.5 32 126.5 38.5 L 126.5 53 L 121 53 Z" />
        <path d="M 163 13 L 169 13 L 169 30 L 187 30 L 187 13 L 193 13 L 193 53 L 187 53 L 187 35.5 L 169 35.5 L 169 53 L 163 53 Z" />
        <path d="M 203 13 L 219.5 13 C 226.5 13 231.5 17.5 231.5 24.5 C 231.5 30 227.8 33.8 222 35.2 L 233 53 L 226 53 L 216 36 L 209 36 L 209 53 L 203 53 Z M 209 18.5 L 209 31 L 219 31 C 223 31 225.5 28.5 225.5 24.8 C 225.5 21 223 18.5 219 18.5 Z" />
      </g>
    </g>

    <!-- Tagline & Description -->
    <text x="90" y="335" fill="#f8fafc" font-family="Segoe UI, Arial, sans-serif" font-size="34" font-weight="700">Self-Hostable Human Resources for European SMBs</text>
    <text x="90" y="380" fill="#94a3b8" font-family="Segoe UI, Arial, sans-serif" font-size="22" font-weight="400">Statutory Working Time • Ledger Leave • Multi-Tenant RLS • GDPR Native</text>

    <!-- Feature Badges -->
    <g transform="translate(90, 430)">
      <!-- Pill 1 -->
      <rect x="0" y="0" width="180" height="42" rx="21" fill="#16202c" stroke="#334155"/>
      <text x="90" y="26" text-anchor="middle" fill="#cbd5e1" font-family="Segoe UI, Arial, sans-serif" font-size="15" font-weight="500">Registro de Jornada</text>
      <!-- Pill 2 -->
      <rect x="195" y="0" width="180" height="42" rx="21" fill="#16202c" stroke="#334155"/>
      <text x="285" y="26" text-anchor="middle" fill="#cbd5e1" font-family="Segoe UI, Arial, sans-serif" font-size="15" font-weight="500">PostgreSQL RLS</text>
      <!-- Pill 3 -->
      <rect x="390" y="0" width="160" height="42" rx="21" fill="#16202c" stroke="#334155"/>
      <text x="470" y="26" text-anchor="middle" fill="#cbd5e1" font-family="Segoe UI, Arial, sans-serif" font-size="15" font-weight="500">ca • es • en</text>
      <!-- Pill 4 -->
      <rect x="565" y="0" width="170" height="42" rx="21" fill="#16202c" stroke="#334155"/>
      <text x="650" y="26" text-anchor="middle" fill="#cbd5e1" font-family="Segoe UI, Arial, sans-serif" font-size="15" font-weight="500">No Telemetry</text>
    </g>

    <!-- Bottom URL -->
    <text x="90" y="555" fill="#64748b" font-family="Consolas, Monaco, monospace" font-size="18" font-weight="500">github.com/miquelsolaa/openhr</text>
  </svg>`;

  await sharp(Buffer.from(ogSvg)).png().toFile(path.join(DOCS_IMAGES_DIR, "og-image.png"));
  await sharp(Buffer.from(ogSvg)).png().toFile(path.join(PUBLIC_DIR, "og-image.png"));
  console.log("og-image.png generated.");

  // README Banner (1280x420)
  const bannerSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 420" width="1280" height="420">
    <defs>
      <linearGradient id="bannerBg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#0b1118" />
        <stop offset="50%" stop-color="#111923" />
        <stop offset="100%" stop-color="#142127" />
      </linearGradient>
    </defs>
    <rect width="1280" height="420" fill="url(#bannerBg)"/>

    <!-- Concentric geometry on the right -->
    <circle cx="1060" cy="210" r="260" stroke="#1c2c36" stroke-width="1.5" fill="none" opacity="0.6"/>
    <circle cx="1060" cy="210" r="180" stroke="#223842" stroke-width="1.5" fill="none" opacity="0.7"/>
    <circle cx="1060" cy="210" r="100" stroke="#2a4752" stroke-width="2" fill="none" opacity="0.8"/>

    <!-- Hero Mark in Background -->
    <g transform="translate(945, 95) scale(3.6)" opacity="0.85">
      <path d="M 44.5 14.5 A 22 22 0 1 0 53 35" stroke="#4ecbb6" stroke-width="6" stroke-linecap="round" fill="none"/>
      <circle cx="32" cy="32" r="7.5" fill="#4ecbb6"/>
    </g>

    <!-- Lockup Center-Left -->
    <g transform="translate(80, 80) scale(1.6)">
      <!-- Mark -->
      <g transform="translate(0, 0)">
        <path d="M 44.5 14.5 A 22 22 0 1 0 53 35" stroke="#4ecbb6" stroke-width="6" stroke-linecap="round" fill="none"/>
        <circle cx="32" cy="32" r="7.5" fill="#4ecbb6"/>
      </g>
      <!-- Wordmark -->
      <g fill="#ffffff" transform="translate(74, 2)">
        <path d="M 22 13 C 10.95 13 2 21.95 2 33 C 2 44.05 10.95 53 22 53 C 33.05 53 42 44.05 42 33 C 42 21.95 33.05 13 22 13 Z M 22 18.5 C 30.01 18.5 36.5 24.99 36.5 33 C 36.5 41.01 30.01 47.5 22 47.5 C 13.99 47.5 7.5 41.01 7.5 33 C 7.5 24.99 13.99 18.5 22 18.5 Z" />
        <path d="M 49 23 L 54.5 23 L 54.5 27.2 C 56.8 24.2 60.6 22.5 65.2 22.5 C 73.8 22.5 80 29.2 80 38.5 C 80 47.8 73.8 54.5 65.2 54.5 C 60.6 54.5 56.8 52.8 54.5 49.8 L 54.5 63 L 49 63 Z M 64.5 27.8 C 58.6 27.8 54.5 32.5 54.5 38.5 C 54.5 44.5 58.6 49.2 64.5 49.2 C 70.4 49.2 74.5 44.5 74.5 38.5 C 74.5 32.5 70.4 27.8 64.5 27.8 Z" />
        <path d="M 98 22.5 C 88.2 22.5 81 29.8 81 39 C 81 48.2 88.2 54.5 98.5 54.5 C 105.2 54.5 110.5 51.2 113 45.5 L 107.5 43.5 C 106 47 102.5 49.2 98.5 49.2 C 92.8 49.2 87.8 45.5 86.6 39.8 L 114.5 39.8 C 114.7 38.8 114.7 37.8 114.7 36.8 C 114.7 28.5 107.8 22.5 98 22.5 Z M 86.8 35.5 C 88 30.8 92.2 27.5 98 27.5 C 103.8 27.5 108.2 30.8 109 35.5 Z" />
        <path d="M 121 23 L 126.5 23 L 126.5 27.8 C 128.8 24.5 132.8 22.5 138 22.5 C 146 22.5 150 27.2 150 35.5 L 150 53 L 144.5 53 L 144.5 36.5 C 144.5 30.8 141.5 27.8 136.5 27.8 C 130.8 27.8 126.5 32 126.5 38.5 L 126.5 53 L 121 53 Z" />
        <path d="M 163 13 L 169 13 L 169 30 L 187 30 L 187 13 L 193 13 L 193 53 L 187 53 L 187 35.5 L 169 35.5 L 169 53 L 163 53 Z" />
        <path d="M 203 13 L 219.5 13 C 226.5 13 231.5 17.5 231.5 24.5 C 231.5 30 227.8 33.8 222 35.2 L 233 53 L 226 53 L 216 36 L 209 36 L 209 53 L 203 53 Z M 209 18.5 L 209 31 L 219 31 C 223 31 225.5 28.5 225.5 24.8 C 225.5 21 223 18.5 219 18.5 Z" />
      </g>
    </g>

    <!-- Subtitle -->
    <text x="80" y="245" fill="#f8fafc" font-family="Segoe UI, Arial, sans-serif" font-size="28" font-weight="700">Open-Source HRIS for European SMBs</text>
    <text x="80" y="285" fill="#94a3b8" font-family="Segoe UI, Arial, sans-serif" font-size="18" font-weight="400">Self-hostable • Statutory Working Time • RLS Multi-Tenancy • Clean-Room Built</text>

    <!-- Pills -->
    <g transform="translate(80, 325)">
      <rect x="0" y="0" width="165" height="36" rx="18" fill="#16202c" stroke="#334155"/>
      <text x="82.5" y="22" text-anchor="middle" fill="#cbd5e1" font-family="Segoe UI, Arial, sans-serif" font-size="13" font-weight="500">AGPL-3.0 License</text>
      
      <rect x="180" y="0" width="160" height="36" rx="18" fill="#16202c" stroke="#334155"/>
      <text x="260" y="22" text-anchor="middle" fill="#cbd5e1" font-family="Segoe UI, Arial, sans-serif" font-size="13" font-weight="500">Single Docker Compose</text>

      <rect x="355" y="0" width="150" height="36" rx="18" fill="#16202c" stroke="#334155"/>
      <text x="430" y="22" text-anchor="middle" fill="#cbd5e1" font-family="Segoe UI, Arial, sans-serif" font-size="13" font-weight="500">No Telemetry / SaaS</text>
    </g>
  </svg>`;

  await sharp(Buffer.from(bannerSvg)).png().toFile(path.join(DOCS_IMAGES_DIR, "banner.png"));
  console.log("banner.png generated.");

  // Multi-size Test Board to visually inspect scaling at 16, 32, 64, 512 px
  const testBoardSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 600" width="1000" height="600" fill="#ffffff">
    <rect width="1000" height="600" fill="#f8fafc"/>
    <text x="40" y="50" font-family="system-ui, sans-serif" font-size="24" font-weight="700" fill="#1e293b">OpenHR Brand Mark Legibility Inspection Matrix</text>

    <!-- Light Background Column -->
    <rect x="40" y="80" width="440" height="480" rx="16" fill="#ffffff" stroke="#e2e8f0"/>
    <text x="60" y="120" font-family="system-ui, sans-serif" font-size="16" font-weight="600" fill="#64748b">Light Canvas (#ffffff)</text>
    
    <!-- 512px scaled to 160 -->
    <g transform="translate(60, 150) scale(2.5)">
      <path d="M 44.5 14.5 A 22 22 0 1 0 53 35" stroke="#1a564b" stroke-width="6" stroke-linecap="round" fill="none"/>
      <circle cx="32" cy="32" r="7.5" fill="#1a564b"/>
    </g>
    <text x="70" y="330" font-family="monospace" font-size="14" fill="#64748b">160px (Hero)</text>

    <!-- 64px -->
    <g transform="translate(250, 160)">
      <path d="M 44.5 14.5 A 22 22 0 1 0 53 35" stroke="#1a564b" stroke-width="6" stroke-linecap="round" fill="none"/>
      <circle cx="32" cy="32" r="7.5" fill="#1a564b"/>
    </g>
    <text x="260" y="245" font-family="monospace" font-size="14" fill="#64748b">64px</text>

    <!-- 32px -->
    <g transform="translate(250, 270) scale(0.5)">
      <path d="M 44.5 14.5 A 22 22 0 1 0 53 35" stroke="#1a564b" stroke-width="6" stroke-linecap="round" fill="none"/>
      <circle cx="32" cy="32" r="7.5" fill="#1a564b"/>
    </g>
    <text x="260" y="325" font-family="monospace" font-size="14" fill="#64748b">32px</text>

    <!-- 16px -->
    <g transform="translate(250, 350) scale(0.25)">
      <path d="M 44.5 14.5 A 22 22 0 1 0 53 35" stroke="#1a564b" stroke-width="6" stroke-linecap="round" fill="none"/>
      <circle cx="32" cy="32" r="7.5" fill="#1a564b"/>
    </g>
    <text x="260" y="385" font-family="monospace" font-size="14" fill="#64748b">16px (Favicon)</text>


    <!-- Dark Background Column -->
    <rect x="520" y="80" width="440" height="480" rx="16" fill="#11151c" stroke="#1e293b"/>
    <text x="540" y="120" font-family="system-ui, sans-serif" font-size="16" font-weight="600" fill="#94a3b8">Dark Canvas (#11151c)</text>
    
    <!-- 512px scaled to 160 -->
    <g transform="translate(540, 150) scale(2.5)">
      <path d="M 44.5 14.5 A 22 22 0 1 0 53 35" stroke="#4ecbb6" stroke-width="6" stroke-linecap="round" fill="none"/>
      <circle cx="32" cy="32" r="7.5" fill="#4ecbb6"/>
    </g>
    <text x="550" y="330" font-family="monospace" font-size="14" fill="#94a3b8">160px (Hero)</text>

    <!-- 64px -->
    <g transform="translate(730, 160)">
      <path d="M 44.5 14.5 A 22 22 0 1 0 53 35" stroke="#4ecbb6" stroke-width="6" stroke-linecap="round" fill="none"/>
      <circle cx="32" cy="32" r="7.5" fill="#4ecbb6"/>
    </g>
    <text x="740" y="245" font-family="monospace" font-size="14" fill="#94a3b8">64px</text>

    <!-- 32px -->
    <g transform="translate(730, 270) scale(0.5)">
      <path d="M 44.5 14.5 A 22 22 0 1 0 53 35" stroke="#4ecbb6" stroke-width="6" stroke-linecap="round" fill="none"/>
      <circle cx="32" cy="32" r="7.5" fill="#4ecbb6"/>
    </g>
    <text x="740" y="325" font-family="monospace" font-size="14" fill="#94a3b8">32px</text>

    <!-- 16px -->
    <g transform="translate(730, 350) scale(0.25)">
      <path d="M 44.5 14.5 A 22 22 0 1 0 53 35" stroke="#4ecbb6" stroke-width="6" stroke-linecap="round" fill="none"/>
      <circle cx="32" cy="32" r="7.5" fill="#4ecbb6"/>
    </g>
    <text x="740" y="385" font-family="monospace" font-size="14" fill="#94a3b8">16px (Favicon)</text>
  </svg>`;

  await sharp(Buffer.from(testBoardSvg)).png().toFile(path.join(DOCS_IMAGES_DIR, "brand-inspection-matrix.png"));
  console.log("brand-inspection-matrix.png generated.");

  console.log("All brand assets generated successfully!");
}

main().catch((err) => {
  console.error("Asset generation failed:", err);
  process.exit(1);
});
