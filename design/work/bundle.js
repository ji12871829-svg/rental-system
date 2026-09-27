// Bundle the Patient Arithmetic plates into a three-page PDF (Letter,
// 300-dpi plates mapped 1:1 to 612×792 pt full-bleed pages).
const path = require('path');
const { PDFDocument } = require('pdf-lib'); // resolves from design/work/node_modules
const fs = require('fs');

(async () => {
  const pdf = await PDFDocument.create();
  pdf.setTitle('Patient Arithmetic — Plates 04, 05 & 06');
  pdf.setSubject('A record of twelve intervals; the water year; the receipt series');
  pdf.setProducer('pdf-lib');
  const plates = [
    ['patient-arithmetic-plate.png', 'Plate No. 04 — Patient Arithmetic'],
    ['patient-arithmetic-plate-05.png', 'Plate No. 05 — The Water Year'],
    ['patient-arithmetic-plate-06.png', 'Plate No. 06 — The Receipt Series'],
  ];
  for (const [file] of plates) {
    const png = await pdf.embedPng(fs.readFileSync(path.join(__dirname, '..', file)));
    const page = pdf.addPage([612, 792]);
    page.drawImage(png, { x: 0, y: 0, width: 612, height: 792 });
  }
  const bytes = await pdf.save();
  const out = path.join(__dirname, '..', 'patient-arithmetic.pdf');
  fs.writeFileSync(out, bytes);
  console.log('written', out, bytes.length, 'bytes,', pdf.getPageCount(), 'pages');
})().catch((e) => { console.error(e); process.exit(1); });
