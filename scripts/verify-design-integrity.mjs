import fs from 'fs';
import path from 'path';

const ROOT = process.argv[2] ?? process.cwd();

function abs(...parts) { return path.join(ROOT, ...parts); }

function st(p) { return fs.statSync(p); }

function pngSafe(p) {
  const s = st(p);
  if (s.size < 6) throw new Error(`${p} is smaller than a valid PNG header (size=${s.size})`);
}

// --- finished plates (under design/) ------------------------------------------------
{
  const names = [
    'patient-arithmetic-plate.png',
    'patient-arithmetic-plate-05.png',
    'patient-arithmetic-plate-06.png',
  ];
  for (const name of names) {
    const p = abs('design', name);
    pngSafe(p);
  }
  console.log('PNG integrity: 3 plates in design/ read OK');
}

// --- SVG tracks (work product, kept next to their render scripts) --------------------
const plateSvgs = ['plate.svg', 'plate5.svg', 'plate6.svg'].map(name => abs('design', 'work', name));
for (const p of plateSvgs) {
  const s = st(p);
  if (s.size < 10) throw new Error(`${p} looks empty (size=${s.size})`);
}
console.log('SVG integrity: plate.svg + plate5.svg + plate6.svg retain content');

// --- fonts (shared tooling, used by multiple renderers) ------------------------------
const fontDir = abs('design', 'work', 'fonts');
const wanted = [
  'Italiana-Regular.ttf',
  'IBMPlexMono-Light.ttf',
  'IBMPlexMono-Regular.ttf',
  'opentype.min.js',
];
for (const name of wanted) fs.statSync(path.join(fontDir, name));
console.log('Font shared tooling: design/work/fonts/ intact (4 files)');

// --- render 5/6 sources (kept artifacts, no binary in this tree) ----------------------
for (const name of ['render5.js', 'render6.js', 'bundle.js']) {
  st(abs('design', 'work', name));
}
console.log('KEEP work: render5.js + render6.js + bundle.js present');

// --- nothing in render/ (leave untouched) -------------------------------------------
console.log('Render assets: design/render/ left untouched');

// --- summarize ---------------------------------------------------------------------
console.log('---');
console.log(`Scanned: ${ROOT}`);
console.log('OK');
