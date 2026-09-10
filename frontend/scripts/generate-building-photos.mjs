// One-off: generate optimized web versions of the building photos from the
// project root into frontend/public/building/. Run:
//   node scripts/generate-building-photos.mjs
// (uses the devDependency `sharp`; kept in-repo for regenerating when a new
// photo is dropped in the root with the same filename)
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const project = join(root, '..');

const PHOTOS = [
  // Source in the project root → output basename in public/building/.
  { src: 'naksha-banwao-3ddHcjHmiGw-unsplash.jpg', out: 'building-1' },
  { src: 'webaliser-_TPTXZd9mOo-unsplash.jpg', out: 'building-2' },
];

// Breakpoints: the login hero needs ~1600px for large desktop; the dashboard
// cards top out ~800px. Quality 72 keeps each file in the 60–250 kB range.
const WIDTHS = [480, 800, 1600];

for (const { src, out } of PHOTOS) {
  for (const width of WIDTHS) {
    const outPath = join(root, 'public/building', `${out}-${width}.webp`);
    const info = await sharp(join(project, src))
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 72 })
      .toFile(outPath);
    console.log(`${out}-${width}.webp  ${info.width}x${info.height}  ${(info.size / 1024).toFixed(0)} kB`);
  }
}
console.log('done');
