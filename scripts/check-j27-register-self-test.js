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
 *   RED    malformed register row → configuration error (exit 2)
 *   GREEN  tag names an existing id
 *   WARN   bare `J27:` marker without an id → listed, exit 0
 *   SKIP   backtick-wrapped `J27:` self-reference is not a tag
 *   GREEN  excerpt present only in the second of two site files
 *   GREEN  `…`-split excerpt with one fragment present
 *   GREEN  wrapped `//` comment and inner backticks in the source
 *   GREEN  bare memory basename resolves through `.claude-memory/`
 *   GREEN  sibling basename resolves through the previous token's directory
 *   GREEN  glob site with a match; route-shaped `/api/...` token ignored
 *   SKIP   `rejected` row with an absent excerpt is closed, not stale
 *   INFO   prose-only row is unverifiable, exit 0
 *   BASE   the real repository baseline is green before and after
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { registerTmpFixture } = require('./lib/selftest-fixture');

const repoRoot = path.resolve(__dirname, '..');
const GATE = path.join(repoRoot, 'scripts', 'check-j27-register.js');

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
  write(root, 'lib/b.js', "// nothing here\n");
  write(root, 'lib/c.js', "export const NEEDLE_IN_SECOND_FILE = true;\n");
  write(root, 'lib/wrapped.js', "  // Always exclude concept rows — they never need outside\n  // reviewers. Uses `akoya_requeststatus` here.\n");
  write(root, '.claude-memory/project-thing.md', "- Single-submission may change the picker default.\n");
  write(root, 'scripts/find-first.js', "* Find 2025 candidates.\n");
  write(root, 'scripts/find-second.js', "* Second sibling script.\n");
  write(root, 'tests/unit/intake-one.test.js', "form_key 'phase-ii-research-2026-06'\n");
  write(root, 'docs/notes.md', "The `J27:` marker convention is described here, not used.\n");
  write(root, 'docs/plan.md', "- **J27:** every complete proposal receives an assessment.\n");
  return HEADER
    + row('J27-001', '`lib/a.js:1`', '`D26-only hide`')
    + row('J27-002', '`lib/b.js`; `lib/c.js:1`', '`NEEDLE_IN_SECOND_FILE`')
    + row('J27-003', '`lib/a.js`', '`absent fragment text` … `const x = 1;`')
    + row('J27-004', '`lib/wrapped.js:1`', '`// Always exclude concept rows — they never need outside reviewers. Uses akoya_requeststatus here.`')
    + row('J27-005', 'memory `project-thing.md` L1', '`Single-submission may change the picker default.`')
    + row('J27-006', '`scripts/find-first.js`, `find-second.js`', '`Second sibling script.`')
    + row('J27-007', '`tests/unit/intake-*.test.js`; `/api/workbench/dashboard`', "`'phase-ii-research-2026-06'`")
    + row('J27-008', '`lib/b.js`', '`this excerpt is gone`', '**rejected (already retired)**.')
    + row('J27-009', 'work queue item 6; Dataverse: akoya_request', 'plain prose, no backticks');
}

function main() {
  console.log('check-j27-register self-test');

  const baseline = runGate([]);
  check('real repository baseline is green before fixtures', baseline.status === 0, baseline.output.split('\n').slice(-6).join('\n'));

  // ---- green tree
  {
    const { dir, cleanup } = registerTmpFixture('j27-register-green-');
    const register = greenFixture(dir);
    write(dir, 'docs/J27_TRANSITION_REGISTER.md', register);
    const r = runGate(['--root', dir]);
    check('green tree exits 0', r.status === 0, r.output);
    check('green tree: tag with existing id listed as ok', /lib\/a\.js:1 → J27-001/.test(r.output), r.output);
    check('green tree: bare J27: marker listed without id (warning, not error)', /docs\/plan\.md:1 → \(no id\)/.test(r.output) && /1 marker\(s\) without a register id/.test(r.output), r.output);
    check('green tree: backtick-wrapped `J27:` self-reference is not a tag', !/docs\/notes\.md/.test(r.output), r.output);
    check('green tree: second-file excerpt (J27-002) not stale', !/J27-002 stale/.test(r.output), r.output);
    check('green tree: ellipsis-split excerpt (J27-003) not stale', !/J27-003 stale/.test(r.output), r.output);
    check('green tree: wrapped comment + inner backticks (J27-004) not stale', !/J27-004 stale/.test(r.output), r.output);
    check('green tree: memory basename shorthand (J27-005) not stale', !/J27-005 stale/.test(r.output), r.output);
    check('green tree: sibling basename shorthand (J27-006) not stale', !/J27-006 stale/.test(r.output), r.output);
    check('green tree: glob site + route token (J27-007) not stale', !/J27-007 stale/.test(r.output), r.output);
    check('green tree: rejected row (J27-008) closed, not stale', !/J27-008/.test(r.output) && /1 closed/.test(r.output), r.output);
    check('green tree: prose-only row (J27-009) unverifiable, not stale', /J27-009 unverifiable/.test(r.output), r.output);
    check('green tree: row counts 7 ok / 0 stale / 1 unverifiable / 1 closed', /rows: 7 ok, 0 stale, 1 unverifiable, 1 closed/.test(r.output), r.output);
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
  check('real repository baseline is green after fixtures', after.status === 0, after.output.split('\n').slice(-6).join('\n'));

  if (failures > 0) {
    console.error(`check-j27-register self-test FAILED: ${failures} assertion(s).`);
    process.exit(1);
  }
  console.log('check-j27-register self-test OK.');
}

main();
