/**
 * @jest-environment node
 *
 * Static guard (Recipes 3-5 plan, "Recipe composition"): no
 * `recipe === 'reviews'` / `recipe !== 'reviews'` comparison (either operand
 * order, with or without `?? 'basic'`, single or double quotes) may exist
 * anywhere in the Factory OUTSIDE `recipe-capabilities.js` (the predicate
 * module itself, which legitimately names the literal to build its rank
 * table/tests). Every such comparison must instead go through
 * `recipeSeedsReviewers`/`recipeSeedsPreSite`.
 *
 * Scans lib/services/test-requests/**\/*.js and the two Factory scripts, per
 * the build brief. Comments/prose mentioning `'reviews'` are NOT matched --
 * only actual comparison operators next to a `recipe`-shaped identifier.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const EXEMPT_FILE = path.join('lib', 'services', 'test-requests', 'recipe-capabilities.js');

function listJsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJsFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function targetFiles() {
  const dir = path.join(ROOT, 'lib', 'services', 'test-requests');
  const files = listJsFiles(dir).map((f) => path.relative(ROOT, f));
  return [
    ...files,
    path.join('scripts', 'rehearse-test-request-sandbox.mjs'),
    path.join('scripts', 'export-test-request-source-bundle.mjs'),
  ];
}

// One identifier (dotted path allowed, e.g. `manifest.recipe`, optionally
// `(x ?? 'basic')`), a comparison operator, and the string literal 'reviews'
// (either quote style), in either operand order.
const IDENT = String.raw`\(?[A-Za-z_$][\w.]*(?:\s*\?\?\s*['"]basic['"])?\)?`;
const OP = String.raw`[=!]==?`;
// Slice 5a: the later cumulative recipes' names are guarded the same way --
// their inputs go through one capability predicate each (recipeSeedsPreSite,
// recipeSeedsFinalWriteup), never a recipe-name comparison.
const LIT = String.raw`['"](?:reviews|pre_site_visit|final_writeup|site_visit_materials)['"]`;
const FORWARD = new RegExp(String.raw`${IDENT}\s*${OP}\s*${LIT}`);
const BACKWARD = new RegExp(String.raw`${LIT}\s*${OP}\s*${IDENT}`);

/** Only lines that plausibly compare a `recipe`-shaped identifier -- guards against matching unrelated string comparisons that happen to mention 'reviews'. */
function isRecipeComparisonLine(line) {
  if (!/recipe/i.test(line)) return false;
  return FORWARD.test(line) || BACKWARD.test(line);
}

describe('static guard: no recipe === \'reviews\' comparison outside recipe-capabilities.js', () => {
  test('self-check: the detector matches every canonical comparison form', () => {
    const positives = [
      "recipe === 'reviews'",
      'recipe !== "reviews"',
      "'reviews' === recipe",
      '"reviews" !== recipe',
      "manifest.recipe === 'reviews'",
      "(manifest.recipe ?? 'basic') === 'reviews'",
      "existing.recipe === 'reviews'",
      "run.recipe === 'reviews'",
      "args.recipe === 'reviews'",
      "parsed.recipe !== 'reviews'",
      "run.recipe === 'final_writeup'",
      "'pre_site_visit' !== manifest.recipe",
      "args.recipe === \"site_visit_materials\"",
    ];
    for (const line of positives) {
      expect(isRecipeComparisonLine(line)).toBe(true);
    }
    const negatives = [
      '// a `reviews` manifest must bind to the CURRENT review-file copy policy',
      "recipe-name comparison against 'reviews'",
      "LEDGER_RECIPES = Object.freeze(['basic', 'initial_assessment', 'reviews'])",
      "return rankOrThrow(recipe) >= RANK.get('reviews');",
    ];
    for (const line of negatives) {
      expect(isRecipeComparisonLine(line)).toBe(false);
    }
  });

  test('no target file outside recipe-capabilities.js contains a recipe/\'reviews\' comparison', () => {
    const offenders = [];
    for (const relPath of targetFiles()) {
      if (relPath === EXEMPT_FILE) continue;
      const full = path.join(ROOT, relPath);
      if (!fs.existsSync(full)) continue;
      const lines = fs.readFileSync(full, 'utf8').split('\n');
      lines.forEach((line, index) => {
        if (isRecipeComparisonLine(line)) {
          offenders.push(`${relPath}:${index + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
