// One-off PWA icon generator: rasterizes public/favicon.svg into the PNG set
// the manifest and iOS need. Run: node scripts/generate-icons.mjs
// (uses the devDependency `sharp`; kept in-repo for icon regeneration)
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tile = readFileSync(join(root, 'public/favicon.svg'));

// Maskable icons need the artwork inside a safe zone (~80% of the canvas):
// render the tile smaller on a solid brand-color background that bleeds to
// every edge, so Android's circular crop never clips the building.
const maskableSvg = (size) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">` +
  `<rect width="${size}" height="${size}" fill="#1559b3"/>` +
  `<g transform="translate(${size * 0.125}, ${size * 0.125}) scale(${size * 0.75 / 32})">${tile
    .toString()
    .replace('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">', '')
    .replace('</svg>', '')}</g>` +
  `</svg>`;

const jobs = [
  { file: 'pwa-192.png', size: 192, source: tile },
  { file: 'pwa-512.png', size: 512, source: tile },
  { file: 'pwa-maskable-192.png', size: 192, source: Buffer.from(maskableSvg(512)) },
  { file: 'pwa-maskable-512.png', size: 512, source: Buffer.from(maskableSvg(512)) },
  { file: 'apple-touch-icon.png', size: 180, source: Buffer.from(maskableSvg(512)) },
];

for (const { file, size, source } of jobs) {
  await sharp(source, { density: 512 }).resize(size, size).png().toFile(join(root, 'public', file));
  console.log('wrote public/' + file);
}
