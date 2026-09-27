// Patient Arithmetic — Plate No. 06: "The Receipt Series" (the rent register)
// Same philosophy, money voice: the register that numbers every payment, and
// the two-register cumulative staircase. The rent column is priced directly
// from Plate 04's recorded deltas (× KSh 50 → Σ 087,150), so the series stays
// one record. Row 13 is RCP-0142 — the receipt on the landing page — entered
// in blue as the register's wink.
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
const GROUND = '#F4F1EA', INK = '#232019', BLUE = '#1559B3';
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
const rnd = mulberry32(47);

let P = [];
P.push(`<rect width="${W}" height="${H}" fill="${GROUND}"/>`);
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
P.push(textStart(monoReg, 'PLATE No. 06', M, 295, 21, CIPZ, 0.24));
P.push(textEnd(monoReg, 'RENT REGISTER · C', RIGHT, 295, 21, CIPZ, 0.24));
P.push(textStart(display, 'The Receipt Series', M, 630, 210, INK, 0.01));
P.push(textStart(monoLight, 'TWELVE PAYMENTS · TWELVE WATER BILLS · ONE LEDGER THAT NUMBERS EVERYTHING', M, 707, 26, FAINT, 0.13));

// ================= FIG. 05 — the register =================
const FIG5 = 755;
P.push(`<line x1="${M}" y1="${FIG5}" x2="${RIGHT}" y2="${FIG5}" stroke="${INK}" stroke-width="2"/>`);
P.push(textStart(monoReg, 'FIG. 05 — THE REGISTER', M, FIG5 + 34, 19, INK, 0.14));
P.push(textEnd(monoReg, 'STAFF LEDGER · SEQUENTIAL', RIGHT, FIG5 + 34, 19, INK, 0.14));
P.push(textStart(monoLight, 'TWELVE ENTRIES · PRICED AT KSH 50 PER UNIT · 1 UNIT = 1 M3', 263, FIG5 + 30, 15.5, CIPZ, 0.14));

const deltas = [86, 149, 121, 204, 96, 172, 138, 187, 114, 158, 95, 223]; // Σ 1743
const units = ['MTR-003', 'MTR-005', 'MTR-001', 'MTR-008', 'MTR-002', 'MTR-006',
               'MTR-004', 'MTR-009', 'MTR-001', 'MTR-010', 'MTR-002', 'MTR-012'];
const names = ['J. Ochieng', 'P. Wanjiru', 'A. Otieno', 'S. Kamau', 'M. Njeri', 'D. Achieng',
               'K. Mutiso', 'E. Wafula', 'G. Otieno', 'R. Chebet', 'T. Mumbi', 'B. Kiptoo'];

function fmt(n) { return n.toLocaleString('en-KE').replace(/,/g, ' '); }
let cum = 0;
{
  // Twelve evenly ruled rows; the twelfth is RCP-0142 — the landing page's
  // receipt — entered in blue as the register's latest line.
  const x0 = 300, x1 = 2250, y0 = 965, pitch = 126.4;
  const colReceipt = 520, colUnit = 800, colName = 1050, colUnits = 1420, colAmount = 1620, colRun = 2100;
  const headY = FIG5 + 105;
  for (const [label, x] of [
    ['RECEIPT', colReceipt], ['UNIT', colUnit], ['TENANT', colName],
    ['UNITS', colUnits], ['AMOUNT', colAmount], ['RUNNING Σ', colRun],
  ]) {
    P.push(textStart(monoLight, label, x, headY, 15, FAINT, 0.1));
  }
  for (let i = 0; i < 12; i++) {
    const y = y0 + i * pitch;
    cum += deltas[i] * 50;
    const blue = i === 11; // RCP-0142
    P.push(`<line x1="${x0}" y1="${y.toFixed(2)}" x2="${x1}" y2="${y.toFixed(2)}" stroke="${HAIR}" stroke-width="1.5"/>`);
    const receipt = 'RCP-' + String(i === 11 ? 142 : 131 + i).padStart(4, '0');
    P.push(textStart(monoReg, receipt, colReceipt, y + 40, 19, blue ? BLUE : INK, 0.02));
    P.push(textStart(monoLight, units[i], colUnit, y + 40, 19, FAINT, 0.05));
    P.push(textStart(monoLight, names[i], colName, y + 40, 19, FAINT, 0.05));
    P.push(textEnd(monoReg, String(deltas[i]).padStart(3, '0'), colUnits, y + 40, 19, blue ? BLUE : INK, 0.02));
    P.push(textEnd(monoReg, fmt(deltas[i] * 50), colAmount, y + 40, 19, blue ? BLUE : INK, 0.02));
    P.push(textEnd(monoReg, fmt(cum), colRun, y + 40, 19, blue ? BLUE : INK, 0.02));
  }
  const yEnd = y0 + 11 * pitch + 84;
  P.push(`<line x1="${x0}" y1="${yEnd.toFixed(2)}" x2="${x1}" y2="${yEnd.toFixed(2)}" stroke="${INK}" stroke-width="2"/>`);
  P.push(textStart(monoLight, 'TWELVE OF ONE HUNDRED · FISCAL YEAR OPEN', 300, yEnd + 48, 17, FAINT, 0.05));
  P.push(textEnd(monoReg, 'Σ 087 150', x1, yEnd + 48, 22, INK, 0.06));
}

// ================= FIG. 06 — twin cumulative staircase =================
const FIG6 = 2725;
P.push(`<line x1="${M}" y1="${FIG6}" x2="${RIGHT}" y2="${FIG6}" stroke="${INK}" stroke-width="2"/>`);
P.push(textStart(monoReg, 'FIG. 06 — CUMULATIVE', M, FIG6 + 34, 19, INK, 0.14));
P.push(textEnd(monoReg, 'TWO REGISTERS · ONE RECORD', RIGHT, FIG6 + 34, 19, INK, 0.14));
P.push(textStart(monoLight, 'SHILLINGS ABOVE · UNITS BELOW · SAME TWELVE STEPS · 1 UNIT = 1 M3 = KSH 50', 263, FIG6 + 30, 15.5, CIPZ, 0.14));
{
  // Fully contained between the section label (2755) and the bottom rule (3015).
  let ru = 0, rk = 0;
  const uSteps = [], kSteps = [];
  for (let i = 0; i < 12; i++) { ru += deltas[i]; uSteps.push(ru); rk += deltas[i] * 50; kSteps.push(rk); }
  const x0 = 300, x1 = 2245, bw = 132.9;
  const base = 2960, hMax = 130;
  for (let i = 0; i < 12; i++) {
    const x = x0 + i * (x1 - x0) / 12;
    const wBar = bw - 6;
    const hu = Math.round((uSteps[i] / 1743) * hMax);
    const hk = Math.round((kSteps[i] / 87150) * hMax);
    const fill = i === 11 ? BLUE : INK;
    P.push(`<rect x="${x.toFixed(2)}" y="${(base - 10 - hk).toFixed(2)}" width="${wBar}" height="${hk}" fill="${fill}"/>`);
    P.push(`<rect x="${x.toFixed(2)}" y="${base.toFixed(2)}" width="${wBar}" height="${hu}" fill="${fill}" opacity="0.45"/>`);
  }
  P.push(`<line x1="${x0}" y1="${base}" x2="${x1}" y2="${base}" stroke="rgba(35,32,25,0.3)" stroke-width="1.5"/>`);
  P.push(textStart(monoLight, 'CUMULATIVE ACROSS THE TWELVE INTERVALS', M, 2998, 17, FAINT, 0.05));
  P.push(textEnd(monoReg, '1743 U · 87 150 KSH', x1, 2998, 19, INK, 0.06));
}

// ================= bottom block =================
P.push(`<line x1="${M}" y1="3015" x2="${RIGHT}" y2="3015" stroke="${INK}" stroke-width="3"/>`);
P.push(`<line x1="${M}" y1="3021" x2="${RIGHT}" y2="3021" stroke="${INK}" stroke-width="1.2"/>`);
P.push(textStart(monoReg, 'EVERY MARK ENTERED BY HAND. VERIFIED TWICE.', M, 3063, 21, INK, 0.07));
P.push(textEnd(monoLight, 'REGISTER SERIES · KEPT CONTINUOUSLY', RIGHT, 3063, 18, FAINT, 0.09));

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${P.join('')}</svg>`;
fs.writeFileSync(path.join(__dirname, 'plate6.svg'), svg);
sharp(Buffer.from(svg))
  .png({ compressionLevel: 9 })
  .toFile(path.join(__dirname, '..', 'patient-arithmetic-plate-06.png'))
  .then((info) => console.log('written', info.width + 'x' + info.height, info.size + ' bytes'))
  .catch((e) => { console.error(e); process.exit(1); });
