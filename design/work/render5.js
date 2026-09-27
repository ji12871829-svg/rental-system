// Patient Arithmetic — Plate No. 05: "The Water Year" (annual conspectus)
// Same philosophy, distinct composition: twelve unit dials (year-end
// readings), the combined monthly stream, and a per-unit cross-section on
// matched ruled rows. Σ 001743 agrees with Plate 04 — one record.
const path = require('path');
const vm = require('vm');
const fs = require('fs');
const reqFE = require('module').createRequire(path.resolve(__dirname, '../../frontend/package.json'));
const sharp = reqFE('sharp');

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
const rnd = mulberry32(29);

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
P.push(`<line x1="${M}" y1="255" x2="${RIGHT}" y2="255" stroke="${INK}" stroke-width="3"/>`);
P.push(`<line x1="${M}" y1="261" x2="${RIGHT}" y2="261" stroke="${INK}" stroke-width="1.2"/>`);
P.push(textStart(monoReg, 'PLATE No. 05', M, 295, 21, CIPZ, 0.24));
P.push(textEnd(monoReg, 'ANNUAL CONSPECTUS · B', RIGHT, 295, 21, CIPZ, 0.24));
P.push(textStart(display, 'The Water Year', M, 630, 210, INK, 0.01));
P.push(textStart(monoLight, 'A YEAR OF READINGS IN FOUR MOVEMENTS · EACH UNIT SEEN TWELVE TIMES', M, 707, 26, FAINT, 0.13));

// ============ FIG. 03 — twelve unit dials (year-end readings) ============
const FIG3 = 755;
P.push(`<line x1="${M}" y1="${FIG3}" x2="${RIGHT}" y2="${FIG3}" stroke="${INK}" stroke-width="2"/>`);
P.push(textStart(monoReg, 'FIG. 03 — THE WATER YEAR', M, FIG3 + 34, 19, INK, 0.14));
P.push(textEnd(monoReg, 'TWELVE READINGS · ONE AQUIFER', RIGHT, FIG3 + 34, 19, INK, 0.14));
P.push(textStart(monoLight, 'SINGLE SERIES · GROUPED BY UNIT', 263, FIG3 + 30, 15.5, CIPZ, 0.14));

const totals = [86, 149, 121, 204, 96, 172, 138, 187, 114, 158, 95, 223]; // Σ 1743
{
  const n = 12, r = 62;
  const cx0 = 299, pitch = 161.8;
  const cy = 1030;
  const dmax = Math.max(...totals);
  for (let i = 0; i < n; i++) {
    const cx = cx0 + i * pitch;
    const lead = totals[i] === dmax; // single blue accent: the leading unit
    P.push(`<circle cx="${cx.toFixed(2)}" cy="${cy}" r="${r}" fill="none" stroke="${INK}" stroke-width="2.2"/>`);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * 2 * Math.PI;
      const x1 = cx + Math.cos(a) * (r - 15), y1 = cy + Math.sin(a) * (r - 15);
      const x2 = cx + Math.cos(a) * (r - 3), y2 = cy + Math.sin(a) * (r - 3);
      P.push(`<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${INK}" stroke-width="2.5"/>`);
    }
    const an = rnd() * 2 * Math.PI; // needles as found
    P.push(`<line x1="${cx}" y1="${cy}" x2="${(cx + Math.cos(an) * (r - 22)).toFixed(2)}" y2="${(cy + Math.sin(an) * (r - 22)).toFixed(2)}" stroke="${lead ? BLUE : DEEP}" stroke-width="3.5"/>`);
    P.push(`<circle cx="${cx}" cy="${cy}" r="5.5" fill="${lead ? BLUE : DEEP}"/>`);
    P.push(textCenter(monoReg, String(totals[i]).padStart(3, '0'), cx, 1150, 22, INK, 0.02));
    P.push(textCenter(monoLight, 'MTR-' + String(i + 1).padStart(3, '0'), cx, 1180, 15, FAINT, 0.07));
    // Δ arc: annual total, scaled to the leading unit
    const sweepDeg = Math.max(30, Math.round((totals[i] / dmax) * 180));
    const sweepRad = (sweepDeg / 180) * Math.PI;
    const x0 = cx - 55, y0 = 1215;
    const ex = x0 - 55 * Math.cos(sweepRad) + 55, ey = y0 - 55 * Math.sin(sweepRad);
    P.push(`<path d="M ${x0} ${y0} A 55 55 0 0 1 ${ex.toFixed(2)} ${ey.toFixed(2)}" fill="none" stroke="${BLUE}" stroke-width="11"/>`);
    P.push(textCenter(monoReg, String(totals[i]).padStart(3, '0'), cx, 1222, 19, FAINT, 0.02));
  }
  P.push(textStart(monoLight, 'NEEDLES AS FOUND · ARCS SCALED TO MAXIMUM', M, 1268, 17, FAINT, 0.05));
  P.push(textEnd(monoReg, 'MAX 0223', RIGHT, 1268, 22, INK, 0.06));
}
P.push(`<line x1="${M}" y1="1270" x2="${RIGHT}" y2="1270" stroke="${HAIR}" stroke-width="1.5"/>`);

// ============ FIG. 03b — the combined monthly stream ============
{
  const combined = [172, 258, 341, 389, 402, 367, 331, 358, 289, 214, 186, 267]; // Σ 3574, peak MAY
  const months = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
  const maxV = Math.max(...combined), minV = Math.min(...combined);
  const base = 1530, maxH = 170, bw = 110, pitch = 161.8, x0 = 299;
  P.push(textStart(monoLight, 'MONTHLY VOLUME · COMBINED', 263, 1345, 15.5, CIPZ, 0.14));
  P.push(`<line x1="${M}" y1="1530" x2="${RIGHT}" y2="1530" stroke="${HAIR}" stroke-width="1.5"/>`);
  for (let i = 0; i < 12; i++) {
    const h = Math.max(20, Math.round((combined[i] / maxV) * maxH));
    const x = x0 + i * pitch;
    const fill = combined[i] === maxV ? BLUE : INK; // peak month in blue
    P.push(`<rect x="${x.toFixed(2)}" y="${(base - h).toFixed(2)}" width="${bw}" height="${h}" fill="${fill}"/>`);
    P.push(textCenter(monoLight, months[i], x + bw / 2, 1560, 14, FAINT, 0.07));
  }
  const peakI = combined.indexOf(maxV);
  P.push(textStart(monoReg, `PEAK MONTH ${['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][peakI]} · Δ +${String(maxV - minV).padStart(6, '0')}`, M, 1600, 19, FAINT, 0.05));
  P.push(textEnd(monoReg, 'Σ 003574', RIGHT, 1600, 22, INK, 0.06));
}

// ============ FIG. 04 — per-unit cross-section on matched rows ============
const FIG4 = 1685;
P.push(`<line x1="${M}" y1="${FIG4}" x2="${RIGHT}" y2="${FIG4}" stroke="${INK}" stroke-width="2"/>`);
P.push(textStart(monoReg, 'FIG. 04 — DISTRIBUTION', M, FIG4 + 34, 19, INK, 0.14));
P.push(textEnd(monoReg, 'TWELVE UNITS · PER UNIT', RIGHT, FIG4 + 34, 19, INK, 0.14));
P.push(textStart(monoLight, 'CROSS-SECTION BY UNIT · SCALES MATCHED', 263, FIG4 + 30, 15.5, CIPZ, 0.14));

{
  // descending, consistent with FIG. 03
  const units = [
    ['MTR-012', 223], ['MTR-004', 204], ['MTR-008', 187], ['MTR-006', 172],
    ['MTR-010', 158], ['MTR-002', 149], ['MTR-007', 138], ['MTR-003', 121],
    ['MTR-009', 114], ['MTR-005', 96], ['MTR-011', 95], ['MTR-001', 86],
  ];
  const rows = 12, pitch = 95;
  const stemX = 300, barX0 = 395, barMax = 1700; // label of the longest bar ends ≤ RIGHT−12
  // Common zero axis: bars grow rightward from one shared origin, each on
  // its own ruled row — scales matched, nothing crosses a row boundary.
  P.push(`<line x1="${barX0}" y1="1775" x2="${barX0}" y2="2860" stroke="rgba(35,32,25,0.3)" stroke-width="2"/>`);
  const dmax = units[0][1];
  for (let i = 0; i < rows; i++) {
    const rowCy = 1775 + i * pitch + 40;
    P.push(`<line x1="${stemX}" y1="${1775 + i * pitch}" x2="2250" y2="${1775 + i * pitch}" stroke="${HAIR}" stroke-width="1.5"/>`);
    const [name, val] = units[i];
    const w = Math.max(60, Math.round((val / dmax) * barMax));
    const fill = i === 0 ? BLUE : INK; // leading unit in blue
    P.push(`<line x1="${stemX}" y1="${rowCy}" x2="${barX0 - 25}" y2="${rowCy}" stroke="${INK}" stroke-width="2"/>`);
    P.push(textStart(monoLight, name, stemX + 10, rowCy + 7, 17, FAINT, 0.05));
    P.push(`<rect x="${barX0}" y="${rowCy - 28}" width="${w}" height="56" fill="${fill}"/>`);
    const labelX = barX0 + w + 40;
    if (labelX + 130 > RIGHT - 12) throw new Error('fig04 label overflow at row ' + i);
    P.push(textStart(monoReg, String(val).padStart(4, '0'), labelX, rowCy + 7, 19, INK, 0.02));
  }
  P.push(textStart(monoLight, 'TWELVE UNITS · ONE RECORD', M, 2925, 19, FAINT, 0.05));
  P.push(textEnd(monoReg, 'Σ 001743', RIGHT, 2925, 22, INK, 0.06));
}

// ================= bottom block =================
P.push(`<line x1="${M}" y1="3015" x2="${RIGHT}" y2="3015" stroke="${INK}" stroke-width="3"/>`);
P.push(`<line x1="${M}" y1="3021" x2="${RIGHT}" y2="3021" stroke="${INK}" stroke-width="1.2"/>`);
P.push(textStart(monoReg, 'EVERY MARK ENTERED BY HAND. VERIFIED TWICE.', M, 3063, 21, INK, 0.07));
P.push(textEnd(monoLight, 'ANNUAL SERIES · KEPT CONTINUOUSLY', RIGHT, 3063, 18, FAINT, 0.09));

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${P.join('')}</svg>`;
fs.writeFileSync(path.join(__dirname, 'plate5.svg'), svg);
sharp(Buffer.from(svg))
  .png({ compressionLevel: 9 })
  .toFile(path.join(__dirname, '..', 'patient-arithmetic-plate-05.png'))
  .then((info) => console.log('written', info.width + 'x' + info.height, info.size + ' bytes'))
  .catch((e) => { console.error(e); process.exit(1); });
