#!/usr/bin/env node
// Tailwind token guard — fails the build when any Tailwind color utility
// references a shade the palette does not define.
//
// Why: Tailwind silently DROPS unknown classes — no error, no warning, no CSS
// — so `text-brand-300` with no 300 in the palette shipped as "no color at
// all" (invisible checkmarks on navy) and `border-brand-200` shipped as no
// border (commit 3ad60c4). Linters and tsc cannot see it. This guard makes
// the failure loud: every `text|bg|border|ring|divide|from|via|to|…`
// `<family>-<shade>` utility in frontend sources is checked against the
// families/shades actually defined in tailwind.config.js (custom families)
// or Tailwind's default ramps (standard families).
//
// Zero dependencies. Exits 1 on any violation or on config-parse failure
// (fail loud, never silently green). Paths resolve from this file's location,
// so it runs from any working directory: `node scripts/check-tailwind-tokens.mjs`.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = join(ROOT, 'frontend', 'tailwind.config.js');
const SCAN_DIRS = [join(ROOT, 'frontend', 'src')];
const SCAN_FILES = [join(ROOT, 'frontend', 'index.html')];
const EXTENSIONS = new Set(['.ts', '.tsx', '.css', '.html']);

// Tailwind's default palettes carry the full ramp for every built-in family,
// so standard-family shades only need to be *valid ramp numbers*, while
// custom families (brand) are checked against the exact shades configured.
const DEFAULT_RAMP = new Set([50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]);
const STANDARD_FAMILIES = [
  'gray', 'slate', 'zinc', 'neutral', 'stone',
  'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky',
  'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose',
];

// Walk the config's `colors: { family: { shade: … } }` object with a real
// brace walk — regex-only parsing breaks on nested braces, and a parse
// failure here must fail the guard, not skip it.
function parsePalette(configText) {
  const colorsIdx = configText.indexOf('colors:');
  if (colorsIdx === -1) throw new Error('no `colors:` block found in tailwind.config.js');
  const open = configText.indexOf('{', colorsIdx);
  if (open === -1) throw new Error('malformed `colors:` block in tailwind.config.js');
  const colorsBlock = braceSlice(configText, open);

  const palette = new Map(); // family -> Set(shade)
  const familyRe = /(\w+)\s*:\s*\{/g;
  let m;
  while ((m = familyRe.exec(colorsBlock)) !== null) {
    // familyRe.lastIndex sits just past the family's `{` — inside colorsBlock's
    // coordinate space, NOT configText's. Slicing within the same string is
    // what keeps braceSlice balanced.
    const famOpen = colorsBlock.indexOf('{', familyRe.lastIndex - 1);
    const familyBlock = braceSlice(colorsBlock, famOpen);
    const shades = new Set();
    const shadeRe = /['"]?(\d{2,3}|DEFAULT)['"]?\s*:/g;
    let s;
    while ((s = shadeRe.exec(familyBlock)) !== null) shades.add(s[1]);
    if (shades.size > 0) palette.set(m[1], shades);
  }
  if (palette.size === 0) throw new Error('no color families parsed from tailwind.config.js');
  return palette;
}

// Return the text from `start` (an opening `{`) through its matching `}`.
function braceSlice(text, start) {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new Error('unbalanced braces in tailwind.config.js colors block');
}

function listFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) listFiles(full, out);
    else if (EXTENSIONS.has(entry.slice(entry.lastIndexOf('.')))) out.push(full);
  }
  return out;
}

const configText = readFileSync(CONFIG, 'utf8');
const palette = parsePalette(configText);

const families = [...STANDARD_FAMILIES, ...palette.keys()].join('|');
const prefixes =
  'text|bg|border(?:-[ltrb])?|ring|ring-offset|divide|outline|decoration|from|via|to|fill|stroke|placeholder|accent|caret|shadow';
const utilityRe = new RegExp(`\\b(?:${prefixes})-(${families})-(\\d{2,3}|DEFAULT)\\b`, 'g');

const files = [...SCAN_DIRS.flatMap((d) => listFiles(d)), ...SCAN_FILES];
const violations = [];
let checked = 0;

for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    let m;
    utilityRe.lastIndex = 0;
    while ((m = utilityRe.exec(line)) !== null) {
      checked++;
      const [, family, shade] = m;
      const defined = palette.get(family);
      const ok = defined ? defined.has(shade) : DEFAULT_RAMP.has(Number(shade));
      if (!ok) violations.push(`${relative(ROOT, file).replaceAll('\\', '/')}:${i + 1}: -${family}-${shade} (class "${m[0]}")`);
    }
  });
}

if (violations.length > 0) {
  console.error(`✗ ${violations.length} Tailwind color utilit${violations.length === 1 ? 'y references' : 'ies reference'} a shade the palette does not define — Tailwind drops these classes silently, so they render as nothing:\n`);
  for (const v of violations) console.error(`  ${v}`);
  console.error(`\nFix the class or define the shade in frontend/tailwind.config.js (see scripts/check-tailwind-tokens.mjs header for context).`);
  process.exit(1);
}
console.log(`✓ ${checked} Tailwind color utilities checked across ${files.length} files — every shade is defined in the palette.`);
