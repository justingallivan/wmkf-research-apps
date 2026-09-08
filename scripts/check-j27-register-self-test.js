#!/usr/bin/env node
'use strict';
/**
 * Self-test for scripts/check-j27-register.js.
 *
 * Builds a temp `--root` fixture tree with its own `--register` (never
 * touches the real register or tracked tree), runs the gate as a child
 * process so the exit code is what /start sees, and proves each rule with a
 * fixture that would pass if the rule were removed:
 *
 *   RED    tag names an id absent from the register
 *   RED    row excerpt absent from an existing site file
 *   RED    row site path missing
 *   RED    glob site with no match
 *   RED    two-site row: fragment present in only one file → stale naming the other
 *   RED    glob site: fragment present in only one match → stale naming the other
 *   RED    malformed register row → configuration error (exit 2)
 *   GREEN  tag names an existing id
 *   WARN   comment-led bare `J27:` marker (`//`) without an id → listed, exit 0
 *   WARN   comment-led bare `J27:` marker (`<!--`) without an id → listed, exit 0
 *   SKIP   backtick-wrapped `J27:` self-reference is not a tag
 *   SKIP   bold-label `**J27:**` lead-in is not a marker (not comment-led)
 *   SKIP   mid-line prose `for J27: whether` is not a marker (not comment-led)
 *   GREEN  two-site row: fragment present in each of two files
 *   GREEN  `…`-split excerpt with one fragment present
 *   GREEN  wrapped `//` comment and inner backticks in the source
 *   GREEN  bare memory basename resolves through `.claude-memory/`
 *   GREEN  sibling basename resolves through the previous token's directory
 *   GREEN  glob site with a match; route-shaped `/api/...` token ignored
 *   SKIP   `rejected` row with an absent excerpt is closed, not stale
 *   INFO   prose-only row is unverifiable, exit 0
 *   BASE   the real repository baseline is green before and after, tolerant
 *          only of stale rows named in KNOWN_OWNER_PENDING (2026-09-08:
 *          J27-023, owner ruling pending — see docs/J27_TRANSITION_REGISTER.md §10)
 *
 * Phase 0 additions (2026-09-08, site-to-fragment binding —
 * docs/plans/J27_REGISTER_PER_SITE_RECONCILIATION_PLAN_2026-09-08.md §2):
 *
 *   RED    swapped bindings: fragment bound to a.js is present only in b.js → both stale
 *   RED    bound fragment absent from its file fails even when a bag fragment matches it
 *   RED    a common 8-char bag token does not rescue a bound file
 *   RED    directory-only site fails (no more existence-only pass)
 *   RED    glob-bound fragment present in only one match → stale naming the other
 *   GREEN  `->` (ASCII) and `→` (Unicode) arrows both parse a binding
 *   GREEN  a fully-bound multi-file row (every file bound and matching) passes
 *   INFO   `closed.` disposition is NOT closed — the row is checked (goes stale here) —
 *          and prints a disposition-vocabulary warning
 *
 * Opus review of Phase 0 (`987ba3c9`) additions, 2026-09-08:
 *
 *   RED    C1: binding path that resolves nowhere → stale `binding path unresolved: <token>`
 *   RED    C1: binding path that resolves, but not to a cited `site` file →
 *          stale `binding path not in site: <file>`
 *   RED    C2: bound-vs-bag isolation proven with the ASCII `->` arrow too
 *          (the prior Unicode-only fixture left `->` mutation-coverage vacuous)
 *   RED    C3a: a bound pair whose fragment is < 8 chars is STALE
 *          (`binding fragment too short: <path>`), not silently dropped
 *   RED    C3b: an unpaired path-like span never becomes a bag fragment, so
 *          it cannot vacuously match a file that quotes its own path
 *   STRICT UNBOUND (owner decision 2026-09-08, "we don't need drift"):
 *   RED    a pure-bag two-file row (no bindings at all) is now stale,
 *          `unbound: <both files>`, even though the bag matches both
 *   RED    a partially-bound multi-file row is stale on its unbound file
 *          even when the bag would have matched that file too
 *   INFO   `#### J27:` (multiple `#`) is comment-led like `# J27:`
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { registerTmpFixture } = require('./lib/selftest-fixture');

const repoRoot = path.resolve(__dirname, '..');
const GATE = path.join(repoRoot, 'scripts', 'check-j27-register.js');

// Rows the real register is KNOWINGLY stale on, pending an owner ruling —
// see docs/J27_TRANSITION_REGISTER.md §10 (matrix-review conditions
// follow-up, Codex adversarial review at 65eb4bfe, finding 2). J27-023's
// `scripts/audit-grant-cycle-shortcode-domain.js` binding was removed
// because the file's fragment, while verbatim, is not this row's fact; the
// citation stays in `site` with a drift note and AS evidence, and the file
// is left unbound so the row is honestly STALE rather than green on a
// non-fact match. Remove the entry here the same commit the owner rules.
const KNOWN_OWNER_PENDING = ['J27-023'];

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures += 1;
  console.error(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`);
}

function runGate(args) {
  try {
    return { status: 0, output: execFileSync('node', [GATE, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { status: e.status || 1, output: (e.stdout || '') + (e.stderr || '') };
  }
}

// True when the gate's stale-row list contains nothing but ids from
// KNOWN_OWNER_PENDING (the real-register baseline case) — used instead of
// a bare `status === 0` check for the real-repository baseline runs, since
// KNOWN_OWNER_PENDING rows make the gate legitimately exit 1.
function staleIdsOnlyKnownPending(output) {
  const staleIds = [...output.matchAll(/^ {2}✗ (J27-\d{3}) stale\b/gm)].map((m) => m[1]);
  const unexpected = staleIds.filter((id) => !KNOWN_OWNER_PENDING.includes(id));
  return { ok: staleIds.length > 0 && unexpected.length === 0, staleIds, unexpected };
}

function write(root, rel, body) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}

const HEADER = '| id | site | excerpt | Dep | Ev | Q | disposition / notes |\n|---|---|---|---|---|---|---|\n';
function row(id, site, excerpt, disposition = 'open.') {
  return `| ${id} | ${site} | ${excerpt} | D26 | SV | – | ${disposition} |\n`;
}

// A tree + register where every rule is green.
function greenFixture(root) {
  write(root, 'lib/a.js', "// J27: J27-001 D26-only hide\nconst x = 1;\n");
  write(root, 'lib/b.js', "export const NEEDLE_IN_SECOND_FILE = true;\n");
  write(root, 'lib/c.js', "export const NEEDLE_IN_SECOND_FILE = true;\n");
  write(root, 'lib/wrapped.js', "  // Always exclude concept rows — they never need outside\n  // reviewers. Uses `akoya_requeststatus` here.\n");
  write(root, '.claude-memory/project-thing.md', "- Single-submission may change the picker default.\n");
  write(root, 'scripts/find-first.js', "* Find 2025 candidates.\n");
  write(root, 'scripts/find-second.js', "* Second sibling script.\n");
  write(root, 'tests/unit/intake-one.test.js', "form_key 'phase-ii-research-2026-06'\n");
  write(root, 'tests/unit/glob-a.test.js', "const GLOB_A_NEEDLE_TEXT = true;\n");
  write(root, 'tests/unit/glob-b.test.js', "// no needle here\n");
  write(root, 'docs/notes.md', "The `J27:` marker convention is described here, not used.\nStill open for J27: whether this changes.\n");
  write(root, 'docs/plan.md', "- **J27:** every complete proposal receives an assessment.\n");
  write(root, 'lib/marker-comment.js', "// J27: pending refactor, no id yet\nconst y = 2;\n");
  write(root, 'docs/html-comment.md', "<!-- J27: pending row, no id yet -->\n");
  // Phase 0 binding-syntax fixtures.
  write(root, 'lib/swap-a.js', "export const SWAP_B_ONLY = true;\n");
  write(root, 'lib/swap-b.js', "export const SWAP_A_ONLY = true;\n");
  write(root, 'lib/bound-vs-bag.js', "const TEMPLATE = 1; // generic 8-char bag word, no bound marker\n");
  write(root, 'lib/some-dir/.keep', "placeholder\n");
  write(root, 'lib/arrow-ascii.js', "export const ARROW_ASCII_MARK = true;\n");
  write(root, 'lib/arrow-unicode.js', "export const ARROW_UNICODE_MARK = true;\n");
  write(root, 'lib/mix-bound.js', "export const MIX_BOUND_MARK = true;\n");
  write(root, 'lib/mix-bag.js', "export const MIX_BAG_MARK = true;\n");
  write(root, 'lib/closed-disposition.js', "export const NOTHING_HERE = true;\n");
  // Opus review (C1/C2/C3/strict-unbound) fixtures.
  write(root, 'lib/arrow-ascii-bound-vs-bag.js', "const TEMPLATE = 1; // generic 8-char bag word only\n");
  write(root, 'lib/short-binding.js', "export const IRRELEVANT = true;\n");
  write(root, 'lib/self-referential.js', "// see lib/self-referential.js for details\n");
  write(root, 'dir/a.js', "export const DIR_A_MARK = true;\n");
  write(root, 'otherdir/c.js', "export const OTHERDIR_C_MARK = true;\n");
  write(root, 'tests/unit/perfile-a.test.js', "const PERFILE_A_MARK = true;\n");
  write(root, 'tests/unit/perfile-b.test.js', "const PERFILE_B_MARK = true;\n");
  return HEADER
    + row('J27-001', '`lib/a.js:1`', '`D26-only hide`')
    + row('J27-002', '`lib/b.js`; `lib/c.js:1`', '`lib/b.js` → `NEEDLE_IN_SECOND_FILE` · `lib/c.js` → `NEEDLE_IN_SECOND_FILE`')
    + row('J27-003', '`lib/a.js`', '`absent fragment text` … `const x = 1;`')
    + row('J27-004', '`lib/wrapped.js:1`', '`// Always exclude concept rows — they never need outside reviewers. Uses akoya_requeststatus here.`')
    + row('J27-005', 'memory `project-thing.md` L1', '`Single-submission may change the picker default.`')
    + row('J27-007', '`tests/unit/intake-*.test.js`; `/api/workbench/dashboard`', "`'phase-ii-research-2026-06'`")
    + row('J27-008', '`lib/b.js`', '`this excerpt is gone`', '**rejected (already retired)**.')
    + row('J27-009', 'work queue item 6; Dataverse: akoya_request', 'plain prose, no backticks');
}

function main() {
  console.log('check-j27-register self-test');

  const baseline = runGate([]);
  const baselineTolerance = staleIdsOnlyKnownPending(baseline.output);
  check(
    'real repository baseline before fixtures: stale only on KNOWN_OWNER_PENDING rows',
    baseline.status === 0 || baselineTolerance.ok,
    baseline.status === 0
      ? '(baseline is fully green — remove KNOWN_OWNER_PENDING once true)'
      : `unexpected stale: ${JSON.stringify(baselineTolerance.unexpected)}\n${baseline.output.split('\n').slice(-6).join('\n')}`,
  );

  // ---- green tree
  {
    const { dir, cleanup } = registerTmpFixture('j27-register-green-');
    const register = greenFixture(dir);
    write(dir, 'docs/J27_TRANSITION_REGISTER.md', register);
    const r = runGate(['--root', dir]);
    check('green tree exits 0', r.status === 0, r.output);
    check('green tree: tag with existing id listed as ok', /lib\/a\.js:1 → J27-001/.test(r.output), r.output);
    check('green tree: comment-led bare J27: marker (//) listed without id', /lib\/marker-comment\.js:1 → \(no id\)/.test(r.output), r.output);
    check('green tree: comment-led bare J27: marker (<!--) listed without id', /docs\/html-comment\.md:1 → \(no id\)/.test(r.output), r.output);
    check('green tree: 2 marker(s) without a register id', /2 marker\(s\) without a register id/.test(r.output), r.output);
    check('green tree: backtick-wrapped `J27:` self-reference is not a tag', !/docs\/notes\.md:1/.test(r.output), r.output);
    check('green tree: mid-line prose "for J27: whether" is not a marker', !/docs\/notes\.md:2/.test(r.output), r.output);
    check('green tree: bold-label "**J27:**" lead-in is not a marker', !/docs\/plan\.md/.test(r.output), r.output);
    check('green tree: two-file row, each file bound to its own fragment (J27-002) not stale', !/J27-002 stale/.test(r.output), r.output);
    check('green tree: ellipsis-split excerpt (J27-003) not stale', !/J27-003 stale/.test(r.output), r.output);
    check('green tree: wrapped comment + inner backticks (J27-004) not stale', !/J27-004 stale/.test(r.output), r.output);
    check('green tree: memory basename shorthand (J27-005) not stale', !/J27-005 stale/.test(r.output), r.output);
    check('green tree: glob site + route token (J27-007) not stale', !/J27-007 stale/.test(r.output), r.output);
    check('green tree: rejected row (J27-008) closed, not stale', !/J27-008/.test(r.output) && /1 closed/.test(r.output), r.output);
    check('green tree: prose-only row (J27-009) unverifiable, not stale', /J27-009 unverifiable/.test(r.output), r.output);
    check('green tree: row counts 6 ok / 0 stale / 1 unverifiable / 1 closed', /rows: 6 ok, 0 stale, 1 unverifiable, 1 closed/.test(r.output), r.output);
    cleanup();
  }

  // ---- red: swapped bindings (fragment bound to a.js is present only in b.js)
  {
    const { dir, cleanup } = registerTmpFixture('j27-register-swap-binding-');
    write(dir, 'docs/J27_TRANSITION_REGISTER.md', greenFixture(dir)
      + row('J27-092', '`lib/swap-a.js`; `lib/swap-b.js`', '`lib/swap-a.js` → `SWAP_A_ONLY` · `lib/swap-b.js` → `SWAP_B_ONLY`'));
    const r = runGate(['--root', dir]);
    check('swapped bindings: exits 1', r.status === 1, r.output);
    check('swapped bindings: both files named stale (each fails its own bound fragment)', /J27-092 .*no excerpt fragment found in lib\/swap-a\.js, lib\/swap-b\.js/.test(r.output), r.output);
    cleanup();
  }

  // ---- red: bound fragment absent even though a bag fragment (8-char generic token) matches
  {
    const { dir, cleanup } = registerTmpFixture('j27-register-bound-vs-bag-');
    write(dir, 'docs/J27_TRANSITION_REGISTER.md', greenFixture(dir)
      + row('J27-093', '`lib/bound-vs-bag.js`', '`lib/bound-vs-bag.js` → `UNIQUE_BOUND_MARK` · `TEMPLATE`'));
    const r = runGate(['--root', dir]);
    check('bound-vs-bag: exits 1 (bound file ignores the bag entirely)', r.status === 1, r.output);
    check('bound-vs-bag: names the file despite the matching bag token', /J27-093 .*no excerpt fragment found in lib\/bound-vs-bag\.js/.test(r.output), r.output);
    cleanup();
  }

  // ---- red: directory-only site no longer passes on existence
  {
    const { dir, cleanup } = registerTmpFixture('j27-register-directory-site-');
    write(dir, 'docs/J27_TRANSITION_REGISTER.md', greenFixture(dir)
      + row('J27-094', '`lib/some-dir`', '`anything at all here`'));
    const r = runGate(['--root', dir]);
    check('directory-only site: exits 1', r.status === 1, r.output);
    check('directory-only site: reason names the directory', /J27-094 .*directory site needs a file: lib\/some-dir/.test(r.output), r.output);
    cleanup();
  }

  // ---- red: glob-bound fragment present in only one match
  {
    const { dir, cleanup } = registerTmpFixture('j27-register-glob-bound-one-frag-');
    write(dir, 'docs/J27_TRANSITION_REGISTER.md', greenFixture(dir)
      + row('J27-095', '`tests/unit/glob-*.test.js`', '`tests/unit/glob-*.test.js` → `GLOB_A_NEEDLE_TEXT`'));
    const r = runGate(['--root', dir]);
    check('glob-bound one-frag: exits 1', r.status === 1, r.output);
    check('glob-bound one-frag: names the match lacking the bound fragment', /J27-095 .*no excerpt fragment found in tests\/unit\/glob-b\.test\.js/.test(r.output), r.output);
    check('glob-bound one-frag: matching file is not named', !/no excerpt fragment found in [^\n]*glob-a\.test\.js/.test(r.output), r.output);
    cleanup();
  }

  // ---- green: `->` and `→` arrows both parse; a fully-bound multi-file row passes
  {
    const { dir, cleanup } = registerTmpFixture('j27-register-arrows-and-fully-bound-');
    write(dir, 'docs/J27_TRANSITION_REGISTER.md', greenFixture(dir)
      + row('J27-096', '`lib/arrow-ascii.js`', '`lib/arrow-ascii.js` -> `ARROW_ASCII_MARK`')
      + row('J27-097', '`lib/arrow-unicode.js`', '`lib/arrow-unicode.js` → `ARROW_UNICODE_MARK`')
      + row('J27-098', '`lib/mix-bound.js`; `lib/mix-bag.js`', '`lib/mix-bound.js` → `MIX_BOUND_MARK` · `lib/mix-bag.js` → `MIX_BAG_MARK`'));
    const r = runGate(['--root', dir]);
    check('ASCII "->" arrow binding (J27-096) not stale', !/J27-096 stale/.test(r.output), r.output);
    check('Unicode "→" arrow binding (J27-097) not stale', !/J27-097 stale/.test(r.output), r.output);
    check('fully-bound multi-file row (J27-098, every file bound and matching) not stale', !/J27-098 stale/.test(r.output), r.output);
    cleanup();
  }

  // ---- STRICT UNBOUND (owner decision 2026-09-08): pure-bag multi-file row is now stale
  {
    const { dir, cleanup } = registerTmpFixture('j27-register-strict-unbound-pure-bag-');
    write(dir, 'docs/J27_TRANSITION_REGISTER.md', greenFixture(dir)
      + row('J27-089', '`lib/mix-bound.js`; `lib/mix-bag.js`', '`MIX_BOUND_MARK` · `MIX_BAG_MARK`'));
    const r = runGate(['--root', dir]);
    check('strict unbound, pure bag: exits 1 even though the bag matches both files', r.status === 1, r.output);
    check('strict unbound, pure bag: reason names both unbound files', /J27-089 .*unbound: lib\/mix-bound\.js, lib\/mix-bag\.js/.test(r.output), r.output);
    cleanup();
  }

  // ---- STRICT UNBOUND: partially-bound row is stale on its unbound file even though the bag matches it
  {
    const { dir, cleanup } = registerTmpFixture('j27-register-strict-unbound-partial-');
    write(dir, 'docs/J27_TRANSITION_REGISTER.md', greenFixture(dir)
      + row('J27-101', '`lib/mix-bound.js`; `lib/mix-bag.js`', '`lib/mix-bound.js` → `MIX_BOUND_MARK` · `MIX_BAG_MARK`'));
    const r = runGate(['--root', dir]);
    check('strict unbound, partial: exits 1 (mix-bag.js is unbound, bag match does not save it)', r.status === 1, r.output);
    check('strict unbound, partial: reason names only the unbound file', /J27-101 .*unbound: lib\/mix-bag\.js/.test(r.output) && !/J27-101 .*unbound: lib\/mix-bound\.js/.test(r.output), r.output);
    cleanup();
  }

  // ---- C1 (Opus review): binding path that resolves nowhere at all
  {
    const { dir, cleanup } = registerTmpFixture('j27-register-binding-unresolved-');
    write(dir, 'docs/J27_TRANSITION_REGISTER.md', greenFixture(dir)
      + row('J27-102', '`lib/mix-bound.js`', '`lib/does-not-exist-anywhere.js` → `SOME_FRAGMENT_TEXT`'));
    const r = runGate(['--root', dir]);
    check('C1 binding unresolved: exits 1', r.status === 1, r.output);
    check('C1 binding unresolved: names the unresolved token', /J27-102 .*binding path unresolved: lib\/does-not-exist-anywhere\.js/.test(r.output), r.output);
    cleanup();
  }

  // ---- C1 (Opus review): binding path resolves, but to a file this row does not cite
  {
    const { dir, cleanup } = registerTmpFixture('j27-register-binding-not-in-site-');
    write(dir, 'docs/J27_TRANSITION_REGISTER.md', greenFixture(dir)
      + row('J27-103', '`lib/mix-bag.js`', '`lib/swap-a.js` → `SWAP_A_ONLY`'));
    const r = runGate(['--root', dir]);
    check('C1 binding not in site: exits 1', r.status === 1, r.output);
    check('C1 binding not in site: names the real file that is not a cited site', /J27-103 .*binding path not in site: lib\/swap-a\.js/.test(r.output), r.output);
    cleanup();
  }

  // ---- C1 re-review (2026-09-08): equivalent-spelling binding is in-site, not stale
  // (site cited via bare memory shorthand; binding spelled as the expanded path)
  {
    const { dir, cleanup } = registerTmpFixture('j27-register-binding-equivalent-spelling-');
    write(dir, 'docs/J27_TRANSITION_REGISTER.md', greenFixture(dir)
      + row('J27-109', 'memory `project-thing.md` L1', '`.claude-memory/project-thing.md` → `Single-submission may change the picker default.`'));
    const r = runGate(['--root', dir]);
    check('C1 re-review, equivalent spelling: not stale', !/J27-109 stale/.test(r.output), r.output);
    check('C1 re-review, equivalent spelling: not reported not-in-site', !/J27-109 .*binding path not in site/.test(r.output), r.output);
    cleanup();
  }

  // ---- C1 re-review (2026-09-08): per-file bindings under a glob site, all matches bound -> ok
  {
    const { dir, cleanup } = registerTmpFixture('j27-register-binding-glob-per-file-all-');
    write(dir, 'docs/J27_TRANSITION_REGISTER.md', greenFixture(dir)
      + row('J27-107', '`tests/unit/perfile-*.test.js`', '`tests/unit/perfile-a.test.js` → `PERFILE_A_MARK` · `tests/unit/perfile-b.test.js` → `PERFILE_B_MARK`'));
    const r = runGate(['--root', dir]);
    check('C1 re-review, glob per-file bindings (all matches bound): not stale', !/J27-107 stale/.test(r.output), r.output);
    check('C1 re-review, glob per-file bindings (all matches bound): not reported not-in-site', !/J27-107 .*binding path not in site/.test(r.output), r.output);
    cleanup();
  }

  // ---- C1 re-review (2026-09-08): per-file bindings under a glob site, one match left unbound -> stale naming it
  {
    const { dir, cleanup } = registerTmpFixture('j27-register-binding-glob-per-file-partial-');
    write(dir, 'docs/J27_TRANSITION_REGISTER.md', greenFixture(dir)
      + row('J27-108', '`tests/unit/perfile-*.test.js`', '`tests/unit/perfile-a.test.js` → `PERFILE_A_MARK`'));
    const r = runGate(['--root', dir]);
    check('C1 re-review, glob per-file bindings (one match unbound): exits 1', r.status === 1, r.output);
    check('C1 re-review, glob per-file bindings (one match unbound): names it via STRICT UNBOUND', /J27-108 .*unbound: tests\/unit\/perfile-b\.test\.js/.test(r.output), r.output);
    cleanup();
  }

  // ---- regression fix (2026-09-08, integration re-review): a bare-basename
  // binding must resolve via the FULL set of sibling directories `site`
  // walked through, not just the last one. `site` here crosses TWO
  // directories (`dir` then `otherdir`), mirroring the real J27-040 shape:
  // the bare `b.js` token sits between them and its sibling context (`dir`)
  // is not the LAST directory `site` ends on (`otherdir`). Before this fix,
  // a `b.js` binding resolved against only that final directory and
  // wrongly went `binding path unresolved`.
  {
    const { dir, cleanup } = registerTmpFixture('j27-register-binding-sibling-lastdir-');
    write(dir, 'dir/b.js', "export const DIR_B_MARK = true;\n");
    write(dir, 'docs/J27_TRANSITION_REGISTER.md', greenFixture(dir)
      + row('J27-110', '`dir/a.js`; `b.js`; `otherdir/c.js`', '`dir/a.js` → `DIR_A_MARK` · `b.js` → `DIR_B_MARK` · `otherdir/c.js` → `OTHERDIR_C_MARK`'));
    const r = runGate(['--root', dir]);
    check('binding sibling lastDir (cross-directory site): bare-basename binding resolves via the earlier sibling directory, not stale', !/J27-110 stale/.test(r.output), r.output);
    check('binding sibling lastDir (cross-directory site): not reported as an unresolved binding', !/J27-110 .*binding path unresolved/.test(r.output), r.output);
    cleanup();
  }

  // ---- regression fix (2026-09-08): red twin -- `b.js` genuinely does not exist anywhere
  {
    const { dir, cleanup } = registerTmpFixture('j27-register-binding-sibling-lastdir-missing-');
    write(dir, 'docs/J27_TRANSITION_REGISTER.md', greenFixture(dir)
      + row('J27-111', '`dir/a.js`; `b.js`; `otherdir/c.js`', '`dir/a.js` → `DIR_A_MARK` · `b.js` → `DIR_B_MARK` · `otherdir/c.js` → `OTHERDIR_C_MARK`'));
    const r = runGate(['--root', dir]);
    check('binding sibling lastDir, missing file: exits 1', r.status === 1, r.output);
    check('binding sibling lastDir, missing file: reason names b.js as a missing site', /J27-111 .*site path missing: b\.js/.test(r.output), r.output);
    cleanup();
  }

  // ---- C2 (Opus review): bound-vs-bag isolation proven with the ASCII "->" arrow too
  {
    const { dir, cleanup } = registerTmpFixture('j27-register-ascii-bound-vs-bag-');
    write(dir, 'docs/J27_TRANSITION_REGISTER.md', greenFixture(dir)
      + row('J27-104', '`lib/arrow-ascii-bound-vs-bag.js`', '`lib/arrow-ascii-bound-vs-bag.js` -> `ARROW_ASCII_UNIQUE_MARK` · `TEMPLATE`'));
    const r = runGate(['--root', dir]);
    check('C2 ASCII bound-vs-bag: exits 1 (bound file ignores the bag entirely)', r.status === 1, r.output);
    check('C2 ASCII bound-vs-bag: names the file despite the matching bag token', /J27-104 .*no excerpt fragment found in lib\/arrow-ascii-bound-vs-bag\.js/.test(r.output), r.output);
    cleanup();
  }

  // ---- C3a (Opus review): bound pair whose fragment is too short is stale, not silently dropped
  {
    const { dir, cleanup } = registerTmpFixture('j27-register-binding-too-short-');
    write(dir, 'docs/J27_TRANSITION_REGISTER.md', greenFixture(dir)
      + row('J27-105', '`lib/short-binding.js`', '`lib/short-binding.js` → `abc`'));
    const r = runGate(['--root', dir]);
    check('C3a binding too short: exits 1 (not silently dropped as unverifiable)', r.status === 1, r.output);
    check('C3a binding too short: names the path', /J27-105 .*binding fragment too short: lib\/short-binding\.js/.test(r.output), r.output);
    cleanup();
  }

  // ---- C3b (Opus review): an unpaired path-like span never becomes a bag fragment
  {
    const { dir, cleanup } = registerTmpFixture('j27-register-path-like-bag-exclusion-');
    write(dir, 'docs/J27_TRANSITION_REGISTER.md', greenFixture(dir)
      + row('J27-106', '`lib/self-referential.js`', '`lib/self-referential.js` => `REAL_MARKER_NOT_PRESENT`'));
    const r = runGate(['--root', dir]);
    check('C3b path-like bag exclusion: exits 1 (self-referential path text does not vacuously rescue)', r.status === 1, r.output);
    check('C3b path-like bag exclusion: names the file', /J27-106 .*no excerpt fragment found in lib\/self-referential\.js/.test(r.output), r.output);
    cleanup();
  }

  // ---- info: `#### J27:` (multiple `#`) is comment-led like `# J27:`
  {
    const { dir, cleanup } = registerTmpFixture('j27-register-multi-hash-marker-');
    write(dir, 'docs/J27_TRANSITION_REGISTER.md', greenFixture(dir));
    write(dir, 'docs/multi-hash.md', "#### J27: heading-style marker, no id yet\n");
    const r = runGate(['--root', dir]);
    check('"#### J27:" is comment-led, listed as a marker without an id', /docs\/multi-hash\.md:1 → \(no id\)/.test(r.output), r.output);
    cleanup();
  }

  // ---- info: `closed.` disposition is not in the vocabulary and is not closed
  {
    const { dir, cleanup } = registerTmpFixture('j27-register-disposition-vocab-');
    write(dir, 'docs/J27_TRANSITION_REGISTER.md', greenFixture(dir)
      + row('J27-099', '`lib/closed-disposition.js`', '`text not present in the file`', 'closed.'));
    const r = runGate(['--root', dir]);
    check('"closed." disposition: row is checked, not skipped (goes stale on its absent fragment)', /J27-099 .*no excerpt fragment found in lib\/closed-disposition\.js/.test(r.output), r.output);
    check('"closed." disposition: prints the vocabulary warning', /J27-099 disposition not in vocabulary: closed/.test(r.output), r.output);
    cleanup();
  }

  // ---- red: two-site row, fragment present in only one of two files
  {
    const { dir, cleanup } = registerTmpFixture('j27-register-two-site-one-frag-');
    write(dir, 'docs/J27_TRANSITION_REGISTER.md', greenFixture(dir)
      + row('J27-090', '`scripts/find-first.js`, `find-second.js`', '`Second sibling script.`'));
    const r = runGate(['--root', dir]);
    check('two-site one-frag: exits 1', r.status === 1, r.output);
    check('two-site one-frag: no bindings at all → STRICT UNBOUND names both files (superseded by the 2026-09-08 owner decision; was a per-site bag miss before bindings existed)', /J27-090 .*unbound: scripts\/find-first\.js, scripts\/find-second\.js/.test(r.output), r.output);
    cleanup();
  }

  // ---- red: glob site, fragment present in only one match
  {
    const { dir, cleanup } = registerTmpFixture('j27-register-glob-one-frag-');
    write(dir, 'docs/J27_TRANSITION_REGISTER.md', greenFixture(dir)
      + row('J27-091', '`tests/unit/glob-*.test.js`', '`GLOB_A_NEEDLE_TEXT`'));
    const r = runGate(['--root', dir]);
    check('glob one-frag: exits 1', r.status === 1, r.output);
    check('glob one-frag: no bindings at all → STRICT UNBOUND names both matches (superseded by the 2026-09-08 owner decision; was a per-site bag miss before bindings existed)', /J27-091 .*unbound: tests\/unit\/glob-a\.test\.js, tests\/unit\/glob-b\.test\.js/.test(r.output), r.output);
    cleanup();
  }

  // ---- red: unknown id in a tag
  {
    const { dir, cleanup } = registerTmpFixture('j27-register-unknown-id-');
    write(dir, 'docs/J27_TRANSITION_REGISTER.md', greenFixture(dir));
    write(dir, 'lib/z.js', "// J27: J27-999 not a row\n");
    const r = runGate(['--root', dir]);
    check('unknown id: exits 1', r.status === 1, r.output);
    check('unknown id: names the file and id', /lib\/z\.js:1 — tag names unknown register id J27-999/.test(r.output), r.output);
    cleanup();
  }

  // ---- red: stale excerpt
  {
    const { dir, cleanup } = registerTmpFixture('j27-register-stale-excerpt-');
    write(dir, 'docs/J27_TRANSITION_REGISTER.md', greenFixture(dir) + row('J27-010', '`lib/b.js:1`', '`this text is not in lib/b.js`'));
    const r = runGate(['--root', dir]);
    check('stale excerpt: exits 1', r.status === 1, r.output);
    check('stale excerpt: J27-010 reported with the file', /J27-010 .*no excerpt fragment found in lib\/b\.js/.test(r.output), r.output);
    cleanup();
  }

  // ---- red: missing site path, and glob with no match
  {
    const { dir, cleanup } = registerTmpFixture('j27-register-missing-site-');
    write(dir, 'docs/J27_TRANSITION_REGISTER.md', greenFixture(dir)
      + row('J27-011', '`lib/gone.js:1`', '`anything at all here`')
      + row('J27-012', '`tests/unit/nothing-*.test.js`', '`anything at all here`'));
    const r = runGate(['--root', dir]);
    check('missing site: exits 1', r.status === 1, r.output);
    check('missing site: J27-011 site path missing', /J27-011 .*site path missing: lib\/gone\.js/.test(r.output), r.output);
    check('missing site: unmatched glob J27-012 site path missing', /J27-012 .*site path missing: tests\/unit\/nothing-\*\.test\.js/.test(r.output), r.output);
    cleanup();
  }

  // ---- config error: malformed row
  {
    const { dir, cleanup } = registerTmpFixture('j27-register-malformed-');
    write(dir, 'docs/J27_TRANSITION_REGISTER.md', greenFixture(dir) + '| J27-013 | `lib/a.js` | only three cells |\n');
    const r = runGate(['--root', dir]);
    check('malformed row: exits 2 (configuration error)', r.status === 2, r.output);
    check('malformed row: message names the row', /row J27-013 has 3 cells, expected 7/.test(r.output), r.output);
    cleanup();
  }

  // ---- Codex adversarial review, 2026-09-08: row-disappearance bypass.
  // ROW_ID_RE required exact `| J27-###` spacing; a row using any other
  // valid-Markdown spacing was silently skipped (never parsed, never
  // checked, gate exits 0) instead of being recognised and evaluated.
  // Both fixtures below cite a missing site file, so a SKIPPED row would
  // leave the gate green (wrong) while a RECOGNISED row goes red naming it.

  // ---- red: no space after the opening pipe must still be recognised
  {
    const { dir, cleanup } = registerTmpFixture('j27-register-no-space-after-pipe-');
    write(dir, 'docs/J27_TRANSITION_REGISTER.md', greenFixture(dir)
      + '|J27-014|`lib/nope.js`|`anything at all here`|D26|SV|–|open.|\n');
    const r = runGate(['--root', dir]);
    check('no space after opening pipe: recognised as a row, not skipped (exits 1)', r.status === 1, r.output);
    check('no space after opening pipe: J27-014 site path missing', /J27-014 .*site path missing: lib\/nope\.js/.test(r.output), r.output);
    cleanup();
  }

  // ---- red: leading whitespace before the pipe must still be recognised
  {
    const { dir, cleanup } = registerTmpFixture('j27-register-leading-whitespace-row-');
    write(dir, 'docs/J27_TRANSITION_REGISTER.md', greenFixture(dir)
      + row('J27-015', '`lib/also-nope.js`', '`anything at all here`').replace(/^\| /, '  | '));
    const r = runGate(['--root', dir]);
    check('leading whitespace before pipe: recognised as a row, not skipped (exits 1)', r.status === 1, r.output);
    check('leading whitespace before pipe: J27-015 site path missing', /J27-015 .*site path missing: lib\/also-nope\.js/.test(r.output), r.output);
    cleanup();
  }

  // ---- config error: malformed J27-like id fails closed, not silently skipped
  {
    const { dir, cleanup } = registerTmpFixture('j27-register-malformed-id-short-');
    write(dir, 'docs/J27_TRANSITION_REGISTER.md', greenFixture(dir) + row('J27-16', '`lib/a.js`', '`D26-only hide`'));
    const r = runGate(['--root', dir]);
    check('malformed id (two digits): exits 2 (configuration error)', r.status === 2, r.output);
    check('malformed id (two digits): message names the bad id', /malformed register id: J27-16\b/.test(r.output), r.output);
    cleanup();
  }
  {
    const { dir, cleanup } = registerTmpFixture('j27-register-malformed-id-long-');
    write(dir, 'docs/J27_TRANSITION_REGISTER.md', greenFixture(dir) + row('J27-0170', '`lib/a.js`', '`D26-only hide`'));
    const r = runGate(['--root', dir]);
    check('malformed id (four digits): exits 2 (configuration error)', r.status === 2, r.output);
    check('malformed id (four digits): message names the bad id', /malformed register id: J27-0170\b/.test(r.output), r.output);
    cleanup();
  }

  // ---- config error: duplicate id
  {
    const { dir, cleanup } = registerTmpFixture('j27-register-duplicate-');
    write(dir, 'docs/J27_TRANSITION_REGISTER.md', greenFixture(dir) + row('J27-001', '`lib/a.js`', '`D26-only hide`'));
    const r = runGate(['--root', dir]);
    check('duplicate id: exits 2 (configuration error)', r.status === 2 && /duplicate register id J27-001/.test(r.output), r.output);
    cleanup();
  }

  // ---- --register override
  {
    const { dir, cleanup } = registerTmpFixture('j27-register-override-');
    greenFixture(dir);
    write(dir, 'alt-register.md', HEADER + row('J27-001', '`lib/a.js:1`', '`D26-only hide`'));
    const r = runGate(['--root', dir, '--register', path.join(dir, 'alt-register.md')]);
    check('--register override is honored', r.status === 0 && /1 register row\(s\)/.test(r.output), r.output);
    cleanup();
  }

  const after = runGate([]);
  const afterTolerance = staleIdsOnlyKnownPending(after.output);
  check(
    'real repository baseline after fixtures: stale only on KNOWN_OWNER_PENDING rows',
    after.status === 0 || afterTolerance.ok,
    after.status === 0
      ? '(baseline is fully green — remove KNOWN_OWNER_PENDING once true)'
      : `unexpected stale: ${JSON.stringify(afterTolerance.unexpected)}\n${after.output.split('\n').slice(-6).join('\n')}`,
  );

  if (failures > 0) {
    console.error(`check-j27-register self-test FAILED: ${failures} assertion(s).`);
    process.exit(1);
  }
  console.log('check-j27-register self-test OK.');
}

main();
