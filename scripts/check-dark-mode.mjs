// Dark-mode rule content guard — verifies that every `html.dark .CLASS`
// rule in index.css actually contains a meaningful CSS property override
// (not empty, not just `color: inherit`, not just comments).
//
// Why: an `html.dark .CLASS { }` rule with no declarations is silently
// harmless but also silently useless — it was probably intended to override
// something and the declaration was lost. Similarly, a rule that only sets
// `color: inherit` doesn't actually change anything in dark mode.
//
// This guard makes those cases loud at CI time so they get fixed.
//
// What it does NOT check: whether the overridden property value is "good"
// (that's a visual/Screenshot check). It only checks that the rule has at
// least one real property declaration.
//
// Zero dependencies. Exits 1 on any empty or inert rule. Paths resolve from
// this file's location so it runs from any working directory.
// Dark-mode rule content guard — verifies that every `html.dark .CLASS`
// rule in index.css actually contains a meaningful CSS property override
// (not empty, not just `color: inherit`, not just comments).
//
// Why: an `html.dark .CLASS { }` rule with no declarations is silently
// harmless but also silently useless — it was probably intended to override
// something and the declaration was lost. Similarly, a rule that only sets
// `color: inherit` doesn't actually change anything in dark mode.
//
// This guard makes those cases loud at CI time so they get fixed.
//
// What it does NOT check: whether the overridden property value is "good"
// (that's a visual/Screenshot check). It only checks that the rule has at
// least one real property declaration.
//
// Zero dependencies. Exits 1 on any empty or inert rule. Paths resolve from
// this file's location so it runs from any working directory.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSS_FILE = join(ROOT, 'frontend', 'src', 'index.css');

// ---------- brace-aware CSS rule scanner ----------
// Walk `text` and yield every top-level rule as { selector, body, start, end }.
// A rule = the text from a `{` to its matching `}`, where `selector` is
// the text before the `{` and `body` is the text inside the braces.
// Nested braces (inside @media, @supports, etc.) are tracked by depth.
function* ruleBlocks(text) {
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open === -1) break;
    const selector = text.slice(i, open);
    let depth = 1;
    let j = open + 1;
    while (j < text.length && depth > 0) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}') depth--;
      j++;
    }
    const body = text.slice(open + 1, j - 1);
    i = j;
    yield { selector, body, start: i - (j - i), end: j };
  }
}

// Does a selector string target the html.dark mode?
function isDarkSelector(sel) {
  // Match `html.dark` as a distinct token (not part of `no-html-dark`).
  return /\bhtml\.dark\b/.test(sel);
}

// Does a CSS declaration look like it actually sets a value (not just
// `inherit`, `initial`, `unset`, or empty/comment-only)?
function hasRealDeclaration(body) {
  // Strip comments.
  const noComments = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  // Find declaration breaks: `prop: value;` or `prop: value` (last decl).
  const declRe = /\s*([a-zA-Z-][a-zA-Z0-9-]*)\s*:\s*([^;]+)\s*;?/g;
  let m;
  let hasReal = false;
  while ((m = declRe.exec(noComments)) !== null) {
    const value = m[2].trim();
    // Skip inherited-value keywords and empty values.
    if (/^(inherit|initial|unset|revert|none|normal|none\s*$)/i.test(value)) continue;
    // Skip pure whitespace / comment remnants.
    if (value.length === 0) continue;
    hasReal = true;
    break;
  }
  return hasReal;
}

const css = readFileSync(CSS_FILE, 'utf8');

// Walk every rule; for each dark-mode rule, verify it has a real declaration.
const violations = [];
for (const { selector, body } of ruleBlocks(css)) {
  if (!isDarkSelector(selector)) continue;

  // Multi-selectors: split on comma, check each.
  const parts = selector.split(',').map(s => s.trim()).filter(Boolean);
  for (const part of parts) {
    // Only check parts that are html.dark selectors.
    if (!isDarkSelector(part)) continue;

    if (!hasRealDeclaration(body)) {
      // Reconstruct the file location for the error message.
      violations.push({
        selector: part.trim(),
        body: body.trim() || '(empty)',
      });
    }
  }
}

if (violations.length > 0) {
  console.error(`✗ ${violations.length} html.dark rule${violations.length === 1 ? ' has' : 's have'} no meaningful CSS property override (empty or only inherited values):`);
  for (const v of violations) {
    console.error(`  ${v.selector} { ${v.body} }`);
  }
  console.error('\nFix: add a real property declaration inside each rule, e.g.' +
    ' `html.dark .bg-white { background-color: #17191d; }` or `html.dark .text-cyan-800 { color: #a5f3fc; }`.');
  process.exit(1);
}

// Count the dark-mode rules we checked.
let ruleCount = 0;
for (const { selector } of ruleBlocks(css)) {
  if (isDarkSelector(selector)) {
    ruleCount += selector.split(',').filter(Boolean).length;
  }
}

console.log(`✓ ${ruleCount} html.dark rule${ruleCount !== 1 ? 's' : ''} checked — every one contains a real CSS property override.`);
