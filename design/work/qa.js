// QA for the Patient Arithmetic plate — pixel-level containment checks.
const path = require('path');
const reqFE = require('module').createRequire(path.resolve(__dirname, '../../frontend/package.json'));
const sharp = reqFE('sharp');

(async () => {
  const img = sharp(path.join(__dirname, '..', 'patient-arithmetic-plate.png'));
  const { width, height } = await img.metadata();
  const { data: raw, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels; // PNG may carry alpha — never assume 3
  const px = (x, y) => {
    const i = (y * width + x) * ch;
    return [raw[i], raw[i + 1], raw[i + 2]];
  };
  const isGround = ([r, g, b]) => r > 225 && g > 220 && b > 210;
  const isDark = ([r, g, b]) => r < 90 && g < 90 && b < 90;

  const report = [];
  // 1. Margins must be pure ground (no ink bleeding outside the frame).
  const strips = {
    left: [0, 0, 200, height],
    right: [width - 200, 0, 200, height],
    top: [0, 0, width, 200],
    bottom: [0, height - 160, width, 160],
  };
  for (const [name, [sx, sy, sw, sh]] of Object.entries(strips)) {
    let bad = 0;
    for (let y = sy; y < sy + sh; y += 3)
      for (let x = sx; x < sx + sw; x += 3)
        if (!isGround(px(x, y))) bad++;
    report.push([`margin ${name}`, bad === 0 ? 'CLEAN' : `${bad} non-ground samples`]);
  }
  // 2. Double rules exist where expected (rows with many dark pixels).
  for (const y of [255, 755, 1845, 3045]) {
    let dark = 0, samples = 0;
    for (let x = 255; x < 2295; x += 5) { samples++; if (isDark(px(x, y))) dark++; }
    report.push([`rule @y=${y}`, `${dark}/${samples} dark`]);
  }
  // 3. Ink present in every text/figure zone.
  const zones = {
    'plate/meta row': [255, 270, 2040, 40],
    'title band': [255, 480, 2040, 200],
    'subtitle band': [255, 700, 2040, 40],
    'figA dials': [255, 900, 2040, 500],
    'phase arcs': [255, 1560, 2040, 200],
    'figB stems': [255, 2300, 2040, 460],
    'tally row': [1400, 2875, 900, 90],
    'bottom lines': [255, 3060, 2040, 60],
  };
  for (const [name, [sx, sy, sw, sh]] of Object.entries(zones)) {
    let ink = 0, samples = 0;
    for (let y = sy; y < sy + sh; y += 2)
      for (let x = sx; x < sx + sw; x += 2) { samples++; if (isDark(px(x, y)) || px(x, y)[2] > px(x, y)[0] + 30) ink++; }
    report.push([`zone ${name}`, `${((ink / samples) * 100).toFixed(2)}% ink`]);
  }
  for (const [k, v] of report) console.log(k.padEnd(22), v);
})();
