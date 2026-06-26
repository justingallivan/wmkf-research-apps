#!/usr/bin/env node
'use strict';

/**
 * Binding self-test for scripts/check-scaffolding-tokens.js.
 *
 * Unit-tests scanText() (positives must flag, negatives must not — including the
 * inline/backticked review-note form that must stay legal), then runs the real
 * gate against an opt-in temp fixture dir to prove the end-to-end path catches a
 * leaked file, and asserts the live repo baseline is clean.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { scanText } = require('./check-scaffolding-tokens.js');

const repoRoot = path.resolve(__dirname, '..');
const failures = [];
function check(name, cond) { if (!cond) failures.push(name); }

// Build a bare token without writing a literal bare-line tag in this source file.
const open = '<';
const close = '<' + '/';
const tok = (name, closing) => (closing ? close : open) + name + '>';

// ── Positives: bare-line tags must be flagged ───────────────────────────────
check('bare closing content tag flagged', scanText(tok('content', true)).length === 1);
check('bare closing invoke tag flagged', scanText(tok('invoke', true)).length === 1);
check('bare antml parameter tag flagged', scanText(tok('antml:parameter', false)).length === 1);
check('indented bare tag flagged', scanText('   ' + tok('content', true) + '   ').length === 1);
check('two leaked tags at EOF flagged', scanText(`- done\n${tok('content', true)}\n${tok('invoke', true)}\n`).length === 2);
check('two adjacent tags on one line flagged', scanText(tok('content', true) + tok('invoke', true)).length === 2);

// ── Negatives: legitimate mentions must NOT be flagged ───────────────────────
check('inline backticked mention not flagged',
  scanText('- **[LOW] Stray `' + tok('content', true) + '`/`' + tok('invoke', true) + '` tags at EOF** -> fixed.').length === 0);
check('mid-line tag not flagged', scanText('text before ' + tok('content', true) + ' text after').length === 0);
check('tag inside fenced block not flagged',
  scanText('```\n' + tok('content', true) + '\n```').length === 0);
check('unrelated html-ish tag not flagged', scanText('</div>').length === 0);
check('plain prose not flagged', scanText('Just normal documentation text.').length === 0);

// ── End-to-end: real gate catches a leaked temp file, passes when clean ──────
const tmpRel = path.join('docs', 'agent-wiki', '_scaffold_tokens_selftest_tmp');
const tmpAbs = path.join(repoRoot, tmpRel);
function cleanup() { if (fs.existsSync(tmpAbs)) fs.rmSync(tmpAbs, { recursive: true, force: true }); }
function runGate() {
  try {
    return { status: 0, output: execSync(`node ${JSON.stringify(path.join(repoRoot, 'scripts', 'check-scaffolding-tokens.js'))}`, {
      cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, SCAFFOLD_TOKENS_INCLUDE_SELFTEST_TMP: tmpRel },
    }) };
  } catch (e) { return { status: e.status || 1, output: (e.stdout || '') + (e.stderr || '') }; }
}

try {
  cleanup();
  fs.mkdirSync(tmpAbs, { recursive: true });
  fs.writeFileSync(path.join(tmpAbs, 'leaked.md'), `# doc\nbody\n${tok('content', true)}\n`);
  const dirty = runGate();
  check('gate FAILS on a leaked temp file', dirty.status !== 0);
  fs.writeFileSync(path.join(tmpAbs, 'leaked.md'), `# doc\nbody, all clean\n`);
  const clean = runGate();
  check('gate PASSES when temp file is clean', clean.status === 0);
} finally {
  cleanup();
}

// ── Live baseline clean (no temp dir) ───────────────────────────────────────
let baselineStatus = 0;
let baselineOut = '';
try {
  baselineOut = execSync(`node ${JSON.stringify(path.join(repoRoot, 'scripts', 'check-scaffolding-tokens.js'))}`, {
    cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (e) { baselineStatus = e.status || 1; baselineOut = (e.stdout || '') + (e.stderr || ''); }
check('live baseline is clean', baselineStatus === 0);

if (failures.length) {
  console.error('scaffolding-tokens self-test FAILED:\n  - ' + failures.join('\n  - '));
  if (baselineStatus !== 0) console.error('\nBaseline gate output:\n' + baselineOut);
  process.exit(1);
}
console.log('scaffolding-tokens self-test OK — bare-line leaks flagged, inline/fenced mentions allowed, baseline clean.');
