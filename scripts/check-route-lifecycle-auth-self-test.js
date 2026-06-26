#!/usr/bin/env node
'use strict';

/**
 * Binding self-test for scripts/check-route-lifecycle-auth.js.
 *
 * Exercises the pure logic with synthetic source/entries (positive = must be
 * flagged, negative = must pass), then asserts the live repo baseline is clean by
 * running the real gate. No real files are mutated.
 */

const path = require('path');
const { execSync } = require('child_process');
const gate = require('./check-route-lifecycle-auth.js');

const repoRoot = path.resolve(__dirname, '..');
const failures = [];
function check(name, cond) { if (!cond) failures.push(name); }

// ── parseAcceptedKeysFromSource ─────────────────────────────────────────────
function keys(src) {
  return gate.parseAcceptedKeysFromSource(src).calls.map((c) => ({ keys: c.keys, unparseable: c.unparseable }));
}

const literal = keys(`async function h(req,res){ const a = await requireAppAccess(req, res, 'reviewer-finder', 'reviewers'); }`);
check('literal args parsed', literal.length === 1 && gate.setsEqual(literal[0].keys, ['reviewer-finder', 'reviewers']) && !literal[0].unparseable);

const constStr = keys(`const APP_KEY='expertise-finder'; function h(req,res){ requireAppAccess(req,res,APP_KEY); }`);
check('const string arg resolved', constStr.length === 1 && gate.setsEqual(constStr[0].keys, ['expertise-finder']) && !constStr[0].unparseable);

const spread = keys(`const APP_KEYS=['a','b']; function h(req,res){ requireAppAccess(req,res,...APP_KEYS); }`);
check('spread of const array resolved', spread.length === 1 && gate.setsEqual(spread[0].keys, ['a', 'b']) && !spread[0].unparseable);

const dynamic = keys(`function h(req,res,k){ requireAppAccess(req,res,k); }`);
check('unresolvable identifier marks unparseable', dynamic.length === 1 && dynamic[0].unparseable);

const noGuard = keys(`function h(req,res){ return res.json({}); }`);
check('no requireAppAccess -> no calls', noGuard.length === 0);

// ── evaluateEntry (synthetic fileSetsFor) ───────────────────────────────────
function fileSetsForStub(map) {
  return (routePath) => map[routePath];
}

// Positive: declared array disagrees with actual route guard.
const wrong = gate.evaluateEntry('/api/x', { hasGuardAppKeys: true, guardAppKeys: ['reviewers'] },
  fileSetsForStub({ '/api/x': { fileSets: [{ file: '/r/a.js', sets: [['reviewer-finder', 'reviewers']], unparseable: false, noGuard: false }] } }));
check('mismatch is flagged', wrong.length > 0);

// Negative: declared array matches actual.
const right = gate.evaluateEntry('/api/x', { hasGuardAppKeys: true, guardAppKeys: ['reviewer-finder', 'reviewers'] },
  fileSetsForStub({ '/api/x': { fileSets: [{ file: '/r/a.js', sets: [['reviewers', 'reviewer-finder']], unparseable: false, noGuard: false }] } }));
check('matching set passes', right.length === 0);

// Positive: missing guardAppKeys entirely.
const missing = gate.evaluateEntry('/api/x', { hasGuardAppKeys: false },
  fileSetsForStub({ '/api/x': { fileSets: [] } }));
check('missing guardAppKeys is flagged', missing.length > 0);

// Positive: unparseable guard fails closed.
const unparse = gate.evaluateEntry('/api/x', { hasGuardAppKeys: true, guardAppKeys: ['reviewers'] },
  fileSetsForStub({ '/api/x': { fileSets: [{ file: '/r/a.js', sets: [[]], unparseable: true, noGuard: false }] } }));
check('unparseable guard fails closed', unparse.length > 0);

// Positive: handler missing a guard when array declared.
const handlerNoGuard = gate.evaluateEntry('/api/x', { hasGuardAppKeys: true, guardAppKeys: ['reviewers'] },
  fileSetsForStub({ '/api/x': { fileSets: [{ file: '/r/a.js', sets: [], unparseable: false, noGuard: true }] } }));
check('handler without guard is flagged when array declared', handlerNoGuard.length > 0);

// Negative: null + guardNote + genuinely heterogeneous passes.
const heteroOk = gate.evaluateEntry('/api/x', { hasGuardAppKeys: true, guardAppKeys: null, guardNote: 'varies' },
  fileSetsForStub({ '/api/x': { fileSets: [
    { file: '/r/a.js', sets: [['reviewers']], unparseable: false, noGuard: false },
    { file: '/r/b.js', sets: [['reviewer-finder', 'reviewers']], unparseable: false, noGuard: false },
  ] } }));
check('null + heterogeneous passes', heteroOk.length === 0);

// Positive: null but actually uniform is flagged (can't dodge a uniform set with null).
const fakeHetero = gate.evaluateEntry('/api/x', { hasGuardAppKeys: true, guardAppKeys: null, guardNote: 'varies' },
  fileSetsForStub({ '/api/x': { fileSets: [
    { file: '/r/a.js', sets: [['reviewers']], unparseable: false, noGuard: false },
    { file: '/r/b.js', sets: [['reviewers']], unparseable: false, noGuard: false },
  ] } }));
check('null but uniform is flagged', fakeHetero.length > 0);

// Positive: null without guardNote is flagged.
const nullNoNote = gate.evaluateEntry('/api/x', { hasGuardAppKeys: true, guardAppKeys: null },
  fileSetsForStub({ '/api/x': { fileSets: [
    { file: '/r/a.js', sets: [['reviewers']], unparseable: false, noGuard: false },
    { file: '/r/b.js', sets: [['reviewer-finder', 'reviewers']], unparseable: false, noGuard: false },
  ] } }));
check('null without guardNote is flagged', nullNoNote.length > 0);

// Positive: null + a guardless route fails closed (Q1 — an aliased/missing guard
// in a heterogeneous namespace must NOT be silently accepted).
const heteroGuardless = gate.evaluateEntry('/api/x', { hasGuardAppKeys: true, guardAppKeys: null, guardNote: 'varies' },
  fileSetsForStub({ '/api/x': { fileSets: [
    { file: '/r/a.js', sets: [['reviewers']], unparseable: false, noGuard: false },
    { file: '/r/b.js', sets: [], unparseable: false, noGuard: true },
  ] } }));
check('null + a guardless route is flagged', heteroGuardless.length > 0);

// Positive: resolver error (handler not found) fails closed.
const resolveErr = gate.evaluateEntry('/api/x', { hasGuardAppKeys: true, guardAppKeys: ['reviewers'] },
  fileSetsForStub({ '/api/x': { error: 'no route file or directory' } }));
check('handler resolution error fails closed', resolveErr.length > 0);

// ── live baseline clean ─────────────────────────────────────────────────────
let baselineStatus = 0;
let baselineOut = '';
try {
  baselineOut = execSync(`node ${JSON.stringify(path.join(repoRoot, 'scripts', 'check-route-lifecycle-auth.js'))}`, {
    cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8',
  });
} catch (e) { baselineStatus = e.status || 1; baselineOut = (e.stdout || '') + (e.stderr || ''); }
check('live baseline is clean', baselineStatus === 0);

if (failures.length) {
  console.error('route-lifecycle-auth self-test FAILED:\n  - ' + failures.join('\n  - '));
  if (baselineStatus !== 0) console.error('\nBaseline gate output:\n' + baselineOut);
  process.exit(1);
}
console.log('route-lifecycle-auth self-test OK — logic fixtures handled, live baseline clean.');
