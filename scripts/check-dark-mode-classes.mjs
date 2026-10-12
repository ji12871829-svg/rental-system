// Dark-mode class coverage guard — fails CI when a Tailwind utility class
// used in src/ has no matching `html.dark .CLASS` remap in index.css.
//
// What it checks:
//  - Collect every `html.dark .X` selector from index.css.
//  - Collect every utility-like class token used in src/{pages,components,lib}.
//  - Fail if any used utility is missing from the remap set.
//
// What it ignores (by design, not a gap):
//  - Layout/text-utility prefixes that Tailwind ships with sensible dark
//    defaults (e.g. text-center, flex, grid, gap-*, leading-normal). We only
//    flag color/surface token families that the app's dark block is
//    explicitly expected to remap: text-*, bg-*, border-*, shadow-*,
//    animate-*, rounded, overflow, and the sizing/spacing token families
//    that matter for dark-surface contrast.
//
// Why this exists: the existing guard:dark-mode only verifies that each
// `html.dark .CLASS` rule has a real declaration. It does NOT check whether
// every class the app actually uses is covered. This guard closes that gap
// by failing on the inverse: a used class with no remap at all.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSS_FILE = join(ROOT, 'frontend', 'src', 'index.css');
const SRC_DIR = join(ROOT, 'frontend', 'src');

// ---------- collect dark remaps from CSS ----------
const css = readFileSync(CSS_FILE, 'utf8');
const remaps = new Set();
const darkSelRe = /html\.dark\s*\.\s*([a-zA-Z][a-zA-Z0-9_-]*)\b/g;
let m;
while ((m = darkSelRe.exec(css)) !== null) remaps.add(m[1]);

// ---------- collect used utility-like tokens from src ----------
const used = new Set();

// Tailwind-like token prefix families we care about for dark coverage.
// We deliberately keep this list narrow: flag color/surface/shadow/animation
// token families and the spacing/rounding/sizing tokens that affect
// dark-surface contrast, but not pure layout primitives Tailwind already
// handles in dark mode by default (text-left, flex, grid, gap-*, etc.).
const TOKEN_PREFIX = [
  'text', 'bg', 'border', 'border-', 'shadow', 'shadow-',
  'animate', 'animate-', 'rounded', 'rounded-',
  'overflow', 'leading', 'tracking',
  'mt', 'mb', 'ml', 'mr', 'mx', 'my', 'pt', 'pb', 'pl', 'pr',
  'p', 'px', 'py', 'w', 'h', 'min', 'max', 'gap',
  'space', 'items', 'justify',
].map((p) => p.replace(/-$/, ''));

function isTokenPrefix(s) {
  for (const p of TOKEN_PREFIX) {
    if (s === p || s.startsWith(p + '-') || s.startsWith(p + '/')) return true;
  }
  return false;
}

function maybeCollectToken(raw) {
  // raw is a single class token candidate like "bg-white" or "text-gray-500"
  if (!raw) return;
  if (!isTokenPrefix(raw)) return;
  // skip Tailwind variant prefixes that are not the base class
  // e.g. "hover:bg-white" -> "bg-white", "dark:text-gray-500" -> skip base
  // We only collect the base utility name; variants are covered by the base.
  let token = raw;
  for (const v of ['hover', 'focus', 'active', 'disabled', 'dark', 'group', 'peer', 'sm', 'md', 'lg', 'xl']) {
    if (token.startsWith(v + ':') || token.startsWith(v + '-')) {
      token = token.slice(v.length + 1);
    }
  }
  if (!isTokenPrefix(token)) return;
  used.add(token);
}

const classNameAttrRe = /(?:className|class)=['"]([^'"]*)['"]/g;
function walkDir(dir) {
  if (!readdirSync(dir, { withFileTypes: true }).length) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules' && e.name !== 'dist' && e.name !== 'build' && e.name !== '.next') {
        walkDir(p);
      }
    } else if (/\\.(tsx|ts|jsx|js|mjs|cjs)$/i.test(e.name)) {
      const src = readFileSync(p, 'utf8');
      let cm;
      while ((cm = classNameAttrRe.exec(src)) !== null) {
        for (const tok of cm[1].split(/\s+/)) {
          maybeCollectToken(tok.trim());
        }
      }
    }
  }
}
walkDir(SRC_DIR);

// App-owned custom tokens that are not Tailwind utilities and are expected
// to be dark-canvas chrome by construction (they are black/dark surfaces).
const APP_TOKENS = new Set(['ink', 'fog', 'sun', 'ash', 'divider', 'graphite', 'charcoal', 'silver']);

// ---------- report ----------
const missing = [];
for (const t of [...used].sort()) {
  if (APP_TOKENS.has(t)) continue;
  if (remaps.has(t)) continue;
  missing.push(t);
}

if (missing.length > 0) {
  console.error(`✗ ${missing.length} used UI class${missing.length === 1 ? ' has' : 'es have'} no html.dark remap in index.css:`);
  for (const c of missing) {
    console.error(`  ${c}`);
  }
  console.error(`\nAdd each missing token to the dark block in frontend/src/index.css,`);
  console.error(`e.g. html.dark .${missing[0]} { <real property> }.`);
  process.exit(1);
}

console.log(`✓ ${used.size} used UI classes checked — every one has an html.dark remap (or is app-owned chrome).`);
