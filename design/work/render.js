// Patient Arithmetic — plate renderer (v1)
// 2550×3300 @300dpi → PNG. Type as <path> outlines via vendored opentype.js.
const path = require('path');
const vm = require('vm');
const fs = require('fs');
const reqFE = require('module').createRequire(path.resolve(__dirname, '../../frontend/package.json'));
const sharp = reqFE('sharp');

// vendored opentype: the UMD build attaches to bare `this` when neither
// `module` nor `define` exists, so run it in a sandbox and read the global.
const opentype = (() => {
  const code = fs.readFileSync(path.join(__dirname, 'fonts', 'opentype.min.js'), 'utf8');
  const sandbox = { console, require, Buffer };
  vm.runInNewContext(code, sandbox);
  const ot = sandbox.opentype;
  if (!ot || !ot.loadSync) { console.error('opentype failed to load'); process.exit(1); }
  return ot;
})();

const W = 2550, H = 3300;
const GROUND = '#F4F1EA', INK = '#232019', BLUE = '#1559B3', DEEP = '#0E3A73';
const HAIR = 'rgba(35,32,25,0.14)';
const FAINT = '#7A7264', CIPZ = '#B08968';
const M = 255, RIGHT = 2295;
const figTop = 755, panelH = 1030, gap = 60;
const YA = figTop, YB = figTop + panelH + gap; // 755, 1845
const tallyY = YB + panelH;                    // 2875
const bottomY = 3045;

const display = opentype.loadSync(path.join(__dirname, 'fonts', 'Italiana-Regular.ttf'));
const monoLight = opentype.loadSync(path.join(__dirname, 'fonts', 'IBMPlexMono-Light.ttf'));
const monoReg = opentype.loadSync(path.join(__dirname, 'fonts', 'IBMPlexMono-Regular.ttf'));

function textStart(font, text, x, y, size, fill, ls = 0) {
  const d = font.getPath(text, x, y, size, { kerning: true, letterSpacing: ls }).toPathData(2);
  return `<path d="${d}" fill="${fill}"/>`;
}
function textCenter(font, text, cx, y, size, fill, ls = 0) {
  const w = font.getAdvanceWidth(text, size, { letterSpacing: ls });
  return textStart(font, text, cx - w / 2, y, size, fill, ls);
}
function textEnd(font, text, xEnd, y, size, fill, ls = 0) {
  const w = font.getAdvanceWidth(text, size, { letterSpacing: ls });
  return textStart(font, text, xEnd - w, y, size, fill, ls);
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(11);

let P = [];
P.push(`<rect width="${W}" height="${H}" fill="${GROUND}"/>`);

// paper grain
{
  const g = [];
  for (let i = 0; i < 2600; i++) {
    const x = (rnd() * W).toFixed(1), y = (rnd() * H).toFixed(1);
    const r = (0.6 + rnd() * 1.4).toFixed(2);
    const a = (0.012 + rnd() * 0.02).toFixed(3);
    g.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${INK}" opacity="${a}"/>`);
  }
  P.push(g.join(''));
}

// ================= header =================
P.push(`<line x1="${M}" y1="${M}" x2="${RIGHT}" y2="${M}" stroke="${INK}" stroke-width="3"/>`);
P.push(`<line x1="${M}" y1="${M + 6}" x2="${RIGHT}" y2="${M + 6}" stroke="${INK}" stroke-width="1"/>`);
P.push(textStart(monoReg, 'PLATE No. 04', M, 295, 21, CIPZ, 0.24));
P.push(textEnd(monoReg, 'FIELD SERIES · A', RIGHT, 295, 21, CIPZ, 0.24));
P.push(textStart(display, 'Patient Arithmetic', M, 630, 210, INK, 0.01));
P.push(textStart(monoLight, 'A RECORD OF TWELVE INTERVALS · ONE READING AT A TIME', M, 707, 26, FAINT, 0.13));

// ================= FIG A : dials =================
P.push(`<line x1="${M}" y1="${figTop}" x2="${RIGHT}" y2="${figTop}" stroke="${INK}" stroke-width="2"/>`);
P.push(textStart(monoReg, 'FIG. 01 — CONSUMPTION', M, figTop + 34, 19, INK, 0.14));
P.push(textEnd(monoReg, 'UNITS CUBIC', RIGHT, figTop + 34, 19, INK, 0.14));
P.push(textStart(monoLight, 'ACCUMULATED READINGS — TWELVE INTERVALS', 263, YA + 30, 15.5, CIPZ, 0.14));

{
  const n = 12, r = 62;
  const cx0 = 299, pitch = 161.8;
  const cy = YA + 300; // 1055
  // Cumulative meter: one reading per interval, rising by a varied monthly
  // delta. The 3-digit window shows the rolling display (as meters do);
  // the deltas are the composition's quiet data.
  const deltas = [86, 149, 121, 204, 96, 172, 138, 187, 114, 158, 95, 223];
  const total = deltas.reduce((a, b) => a + b, 0);           // 1743
  const C = [];
  let c = 8916 - total;                                      // 7173
  for (let i = 0; i < n; i++) { c += deltas[i]; C.push(c); }
  const dmax = Math.max(...deltas);
  for (let i = 0; i < n; i++) {
    const cx = cx0 + i * pitch;
    P.push(`<circle cx="${cx.toFixed(2)}" cy="${cy}" r="${r}" fill="none" stroke="${INK}" stroke-width="2.2"/>`);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * 2 * Math.PI;
      const x1 = cx + Math.cos(a) * (r - 15), y1 = cy + Math.sin(a) * (r - 15);
      const x2 = cx + Math.cos(a) * (r - 3), y2 = cy + Math.sin(a) * (r - 3);
      P.push(`<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${INK}" stroke-width="2.5"/>`);
    }
    // The needle ENCODES the window reading: an auditor can read
    // needle → window → Δ arc and find the same number three ways.
    const an = ((C[i] % 1000) / 1000) * 2 * Math.PI - Math.PI / 2;
    P.push(`<line x1="${cx}" y1="${cy}" x2="${(cx + Math.cos(an) * (r - 22)).toFixed(2)}" y2="${(cy + Math.sin(an) * (r - 22)).toFixed(2)}" stroke="${DEEP}" stroke-width="3.5"/>`);
    P.push(`<circle cx="${cx}" cy="${cy}" r="5.5" fill="${DEEP}"/>`);
    const v = String(C[i] % 1000).padStart(3, '0');
    P.push(textCenter(monoReg, v, cx, cy + 120, 22, INK, 0.02));
    P.push(textCenter(monoLight, 'MTR-' + String(i + 1).padStart(3, '0'), cx, cy + 150, 15, FAINT, 0.07));
  }
  // Δ arcs: each sweep proportional to that interval's share of the max delta.
  for (let i = 0; i < n; i++) {
    const cx = cx0 + i * pitch;
    const x0 = cx - 55, y0 = YA + 830;
    const sweepDeg = Math.max(30, Math.round((deltas[i] / dmax) * 180));
    const sweepRad = (sweepDeg / 180) * Math.PI;
    const ex = x0 - 55 * Math.cos(sweepRad) + 55, ey = y0 - 55 * Math.sin(sweepRad);
    P.push(`<path d="M ${x0} ${y0} A 55 55 0 0 1 ${ex.toFixed(2)} ${ey.toFixed(2)}" fill="none" stroke="${BLUE}" stroke-width="11"/>`);
    P.push(`<line x1="${(cx - 55).toFixed(1)}" y1="${YA + 900}" x2="${(cx + 55).toFixed(1)}" y2="${YA + 900}" stroke="${HAIR}" stroke-width="1.5"/>`);
  }
  P.push(textStart(monoLight, 'READING Δ +001743 · CORRECTED FOR FIXED ERRORS', M, YA + 968, 19, FAINT, 0.05));
  P.push(textEnd(monoReg, 'Σ 008916', RIGHT, YA + 968, 22, INK, 0.06));
}

// ================= FIG B : ranked stems =================
P.push(`<line x1="${M}" y1="${YB}" x2="${RIGHT}" y2="${YB}" stroke="${INK}" stroke-width="2"/>`);
P.push(textStart(monoReg, 'FIG. 02 — DISTRIBUTION', M, YB + 34, 19, INK, 0.14));
P.push(textEnd(monoReg, 'PER INTERVAL', RIGHT, YB + 34, 19, INK, 0.14));
P.push(textStart(monoLight, 'DISTRIBUTION BY UNIT — RANKED DESCENDING', 263, YB + 30, 15.5, CIPZ, 0.14));

{
  const base = YB + 910; // 2755
  const hs = [295, 271, 255, 239, 224, 210, 196, 183, 170, 158, 146, 135, 124, 113, 103, 93, 84, 75, 66, 58, 50, 42, 34, 26];
  const x0 = 300, bw = 45, pitch = 81.25;
  for (let i = 0; i < 24; i++) {
    const x = x0 + i * pitch;
    const fill = (i === 6 || i === 12 || i === 18) ? BLUE : INK; // true quartile anchors for N=24
    P.push(`<rect x="${x.toFixed(2)}" y="${(base - hs[i]).toFixed(2)}" width="${bw}" height="${hs[i]}" fill="${fill}"/>`);
    if (i % 4 === 0) P.push(`<line x1="${(x + 22.5).toFixed(2)}" y1="${base + 7}" x2="${(x + 22.5).toFixed(2)}" y2="${base + 14}" stroke="${INK}" stroke-width="2"/>`);
  }
  for (const i of [0, 5, 11, 17, 23]) {
    const xEnd = x0 + i * pitch + bw;
    P.push(textEnd(monoReg, String(hs[i]), xEnd.toFixed(2), base + 40, 17, INK, 0.02));
  }
  P.push(textStart(monoLight, 'N = 24 INTERVALS · BLUE = QUARTILE ANCHORS', M, YB + 968, 19, FAINT, 0.05));
  P.push(textEnd(monoReg, 'MEDIAN 135', RIGHT, YB + 968, 22, INK, 0.06));
}

// ================= tally row =================
{
  // 38 marks in groups of five — the arithmetic the dials answer. The final
  // partial group ends 2 marks shy of the margin so nothing clips and the
  // ledger visibly continues.
  const groups = [5, 5, 5, 5, 5, 5, 5, 3];
  const names = ['OCT', 'NOV', 'DEC', 'JAN', 'FEB', 'MAR', 'Q1', 'Q2'];
  const pitch = 95, dx = 24; // 8×95+7×24 = 928 ≤ 940 (fit verified in code)
  const x0 = 1355;           // last group ends at 2283 ≤ RIGHT−12
  const fit = (8 - 1) * pitch + 7 * dx + 4;
  if (x0 + fit > RIGHT - 12) throw new Error('tally row overflow: ' + (x0 + fit));
  for (let gi = 0; gi < 8; gi++) {
    const gx = x0 + gi * pitch;
    for (let k = 0; k < groups[gi]; k++) {
      const fill = (gi === 7) ? BLUE : INK;
      P.push(`<rect x="${(gx + k * dx).toFixed(1)}" y="${tallyY}" width="4" height="20" fill="${fill}"/>`);
    }
    P.push(textStart(monoLight, names[gi], gx, tallyY + 64, 15, FAINT, 0.07));
  }
}

// ================= bottom block =================
P.push(`<line x1="${M}" y1="${bottomY}" x2="${RIGHT}" y2="${bottomY}" stroke="${INK}" stroke-width="3"/>`);
P.push(`<line x1="${M}" y1="${bottomY + 6}" x2="${RIGHT}" y2="${bottomY + 6}" stroke="${INK}" stroke-width="1.2"/>`);
P.push(textStart(monoReg, 'EVERY MARK ENTERED BY HAND. VERIFIED TWICE.', M, 3093, 21, INK, 0.07));
P.push(textEnd(monoLight, 'SERIES 1973—2026 · KEPT CONTINUOUSLY', RIGHT, 3093, 18, FAINT, 0.09));

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${P.join('')}</svg>`;
fs.writeFileSync(path.join(__dirname, 'plate.svg'), svg);
sharp(Buffer.from(svg))
  .png({ compressionLevel: 9 })
  .toFile(path.join(__dirname, '..', 'patient-arithmetic-plate.png'))
  .then((info) => console.log('written', info.width + 'x' + info.height, info.size + ' bytes'))
  .catch((e) => { console.error(e); process.exit(1); });
