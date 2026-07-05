#!/usr/bin/env node
/**
 * Stage 3 OData escape law gate (docs/ODATA_ESCAPE_CONSOLIDATION_PLAN.md, Stage 3).
 * Owner-approved S332: prevent NEW hand-rolled OData single-quote-doubling
 * escapes from reappearing now that Stages 0-2 consolidated every in-scope
 * site onto `odata.escape`.
 *
 * Fails CI if a hand-rolled escape (`<receiver>.replace(/'/g, "''")`, or the
 * single-quoted-replacement variant `<receiver>.replace(/'/g, '\'\'')`, with
 * flexible whitespace) appears anywhere under lib/, pages/, shared/, or
 * modules/ (.js/.mjs) EXCEPT:
 *   - lib/dataverse/core/odata.js itself -- the canonical `escape()` primitive
 *     this law protects; it necessarily contains the pattern it forbids
 *     elsewhere.
 *   - the dynamics-explorer exempt dir (pages/api/dynamics-explorer/),
 *     mirroring check-dataverse-access-layer.js's EXEMPT_DIRS
 *     (scripts/check-dataverse-access-layer.js:75-76).
 *   - comment-only mentions. Comment detection: `//` line comments and
 *     `/* *\/` block comments are stripped from the source BEFORE pattern
 *     matching, replacing comment characters with whitespace (not deleting
 *     them) so line numbers in the surviving text stay aligned with the
 *     original file. This is the "strip comments first" approach named in
 *     the plan (not a `//`/`*`-prefix heuristic) -- it correctly clears a
 *     multi-line JSDoc mention like grant-request.js:99 without needing to
 *     special-case block-comment continuation lines.
 *
 * The receiver before `.replace(` is unconstrained by design, so the pattern
 * catches bare identifiers (`key.replace(...)`), member expressions
 * (`sourceProfile.azure_email.replace(...)`), and `String(x)` wrappers
 * (`String(value).replace(...)`) alike -- the exact variants Stages 0-2
 * removed.
 *
 * Does NOT flag HTML (`&#39;`) or XML (`&apos;`) entity escapes: those
 * replace the quote with a different string, not the doubled single-quote
 * literal this law targets. Never scans scripts/ -- one-off tooling is
 * out of scope per the plan's Out-of-scope section.
 */

const fs = require('fs');
const path = require('path');
const { walkTree } = require('./lib/walk-files');

const DEFAULT_ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = ['lib', 'pages', 'shared', 'modules'];
const JS_EXT_RE = /\.(?:js|mjs)$/;
const EXCLUDE_DIR = /(^|\/)(node_modules|\.git|\.next)(\/|$)/;

// The canonical primitive this law protects -- necessarily contains the
// pattern it forbids everywhere else.
const EXEMPT_FILES = new Set([
  'lib/dataverse/core/odata.js',
]);

// Mirrors scripts/check-dataverse-access-layer.js EXEMPT_DIRS (~:75-76): the
// dynamics-explorer power-tool surface is out of scope for this law too
// (docs/ODATA_ESCAPE_CONSOLIDATION_PLAN.md Out-of-scope section).
const EXEMPT_DIRS = [
  'pages/api/dynamics-explorer/',
];

// Matches `<receiver>.replace(/'/g, "''")` and the single-quoted-replacement
// variant `<receiver>.replace(/'/g, '\'\'')`, with flexible whitespace around
// the arguments. Only the `.replace(...)` call tail is constrained -- the
// receiver expression before the dot is unconstrained.
const ESCAPE_CALL_RE = /\.replace\(\s*\/'\/g\s*,\s*(?:"''"|'\\'\\'')\s*\)/g;

function parseArgs(argv) {
  const args = { root: DEFAULT_ROOT };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--root') {
      const value = argv[++i];
      if (!value) throw new Error('--root requires a directory');
      args.root = path.resolve(value);
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return args;
}

function usage() {
  return [
    'Usage: node scripts/check-odata-escape.js [--root <dir>]',
    '',
    'Fails if a hand-rolled OData single-quote-doubling escape appears under',
    'lib/, pages/, shared/, or modules/ outside lib/dataverse/core/odata.js and',
    'the dynamics-explorer exempt dir. Comment-only mentions are not flagged.',
    'Use odata.escape(value) from lib/dataverse/core/odata.js instead.',
  ].join('\n');
}

function toRel(root, full) {
  return path.relative(root, full).split(path.sep).join('/');
}

function isExemptRel(rel) {
  if (EXEMPT_FILES.has(rel)) return true;
  return EXEMPT_DIRS.some((dir) => rel.startsWith(dir));
}

function collectFiles(root) {
  const files = [];
  for (const relDir of SCAN_DIRS) {
    const base = path.join(root, relDir);
    if (!fs.existsSync(base)) continue;
    walkTree(base, {
      repoRoot: root,
      shouldExcludeRel: (rel) => EXCLUDE_DIR.test(rel),
      onFile: (full) => {
        if (!JS_EXT_RE.test(full)) return;
        const rel = toRel(root, full);
        if (EXCLUDE_DIR.test(rel) || isExemptRel(rel)) return;
        files.push(full);
      },
    });
  }
  return files.sort();
}

// Strip `//` line comments and `/* */` block comments, replacing comment
// characters with spaces (never deleting newlines) so byte offsets in the
// surviving text stay line-aligned with the original file.
function stripComments(text) {
  let out = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  out = out.replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
  return out;
}

function findViolations(file, root) {
  const rel = toRel(root, file);
  const text = fs.readFileSync(file, 'utf8');
  const stripped = stripComments(text);
  const lines = text.split('\n');
  const violations = [];
  ESCAPE_CALL_RE.lastIndex = 0;
  let m;
  while ((m = ESCAPE_CALL_RE.exec(stripped)) !== null) {
    const lineNo = stripped.slice(0, m.index).split('\n').length;
    violations.push({ rel, line: lineNo, text: (lines[lineNo - 1] || '').trim() });
  }
  return violations;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return 0;
  }

  const files = collectFiles(args.root);
  const violations = [];
  for (const file of files) violations.push(...findViolations(file, args.root));

  if (violations.length > 0) {
    console.error(`odata-escape-law FAILED: ${violations.length} hand-rolled OData escape(s) found.`);
    console.error("Use odata.escape(value) from lib/dataverse/core/odata.js instead of inlining .replace(/'/g, \"''\").");
    for (const v of violations) {
      console.error(`  + ${v.rel}:${v.line} | ${v.text}`);
    }
    return 1;
  }

  console.log(`odata-escape-law OK — ${files.length} file(s) scanned; 0 hand-rolled OData escapes found.`);
  return 0;
}

if (require.main === module) {
  try {
    process.exit(main());
  } catch (err) {
    console.error(err.message || err);
    process.exit(2);
  }
}

module.exports = { collectFiles, findViolations, stripComments, main };
