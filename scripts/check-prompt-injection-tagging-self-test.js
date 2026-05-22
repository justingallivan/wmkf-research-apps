#!/usr/bin/env node
/**
 * Binding self-test for scripts/check-prompt-injection-tagging.js.
 *
 * The gate's detection is exposed as pure functions (`checkSurface`,
 * `findUnregisteredPromptFiles`), so this self-test drives them directly with
 * synthetic surfaces and a fake `readFile` — no temp files, no fixture-path
 * race with other gates. It then runs the real gate to confirm the live
 * registry is green.
 *
 * Per the CLAUDE.md mandatory gate order: every detection branch the gate
 * relies on has a fixture here.
 */

const path = require('path');
const { execSync } = require('child_process');
const {
  checkSurface,
  findUnregisteredPromptFiles,
} = require('./check-prompt-injection-tagging.js');

const repoRoot = path.resolve(__dirname, '..');
let failures = 0;

function assert(name, cond) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    console.error(`  ✗ ${name}`);
    failures += 1;
  }
}

// ── checkSurface ──────────────────────────────────────────────────────────

// A fake readFile keyed by path.
function fakeReader(map) {
  return (p) => (p in map ? map[p] : null);
}

// 1. migrated surface with both markers present → no errors.
{
  const surface = {
    id: 'fx-good',
    status: 'migrated',
    promptFiles: ['p.js'],
    callSiteFiles: ['c.js'],
  };
  const reader = fakeReader({
    'p.js': 'uses buildUntrustedContentPreamble here',
    'c.js': 'uses wrapUntrustedContent here',
  });
  assert(
    'migrated surface with both markers passes',
    checkSurface(surface, reader).errors.length === 0,
  );
}

// 2. migrated surface, prompt file missing the preamble marker → error.
{
  const surface = {
    id: 'fx-no-preamble',
    status: 'migrated',
    promptFiles: ['p.js'],
    callSiteFiles: ['c.js'],
  };
  const reader = fakeReader({
    'p.js': 'a prompt with no hardening',
    'c.js': 'uses wrapUntrustedContent here',
  });
  const errs = checkSurface(surface, reader).errors;
  assert(
    'migrated surface missing preamble marker is flagged',
    errs.length === 1 && /buildUntrustedContentPreamble/.test(errs[0]),
  );
}

// 3. migrated surface, call-site file missing the wrap marker → error.
{
  const surface = {
    id: 'fx-no-wrap',
    status: 'migrated',
    promptFiles: ['p.js'],
    callSiteFiles: ['c.js'],
  };
  const reader = fakeReader({
    'p.js': 'uses buildUntrustedContentPreamble here',
    'c.js': 'a route that interpolates raw text',
  });
  const errs = checkSurface(surface, reader).errors;
  assert(
    'migrated surface missing wrap marker is flagged',
    errs.length === 1 && /wrapUntrustedContent/.test(errs[0]),
  );
}

// 4. migrated surface, a registered file does not exist → error. The present
// file carries both markers so the missing-file error is the only one.
{
  const surface = {
    id: 'fx-missing-file',
    status: 'migrated',
    promptFiles: ['gone.js'],
    callSiteFiles: ['c.js'],
  };
  const reader = fakeReader({
    'c.js': 'uses wrapUntrustedContent and buildUntrustedContentPreamble',
  });
  const errs = checkSurface(surface, reader).errors;
  assert(
    'migrated surface with a missing file is flagged',
    errs.length === 1 && /missing/.test(errs[0]),
  );
}

// 4b. union logic — preamble in the prompt file, wrapper in the call-site
// file: the surface passes even though no single file has both markers.
{
  const surface = {
    id: 'fx-union',
    status: 'migrated',
    promptFiles: ['p.js'],
    callSiteFiles: ['c.js'],
  };
  const reader = fakeReader({
    'p.js': 'only buildUntrustedContentPreamble here',
    'c.js': 'only wrapUntrustedContent here',
  });
  assert(
    'markers split across prompt + call-site files pass (union)',
    checkSurface(surface, reader).errors.length === 0,
  );
}

// 5. pending surface is never enforced, even with no files.
{
  const surface = { id: 'fx-pending', status: 'pending' };
  assert(
    'pending surface produces no errors',
    checkSurface(surface, fakeReader({})).errors.length === 0,
  );
}

// 5b. multimodal surface — preamble present, no wrapper. Passes: the untrusted
// content is an image/document content block, so there is no text to wrap.
{
  const surface = {
    id: 'fx-multimodal',
    status: 'migrated',
    multimodal: true,
    promptFiles: ['p.js'],
  };
  const reader = fakeReader({ 'p.js': 'only buildUntrustedContentPreamble here' });
  assert(
    'multimodal surface with preamble only (no wrapper) passes',
    checkSurface(surface, reader).errors.length === 0,
  );
}

// 5c. multimodal surface still REQUIRES the preamble — missing it is flagged.
{
  const surface = {
    id: 'fx-multimodal-no-preamble',
    status: 'migrated',
    multimodal: true,
    promptFiles: ['p.js'],
  };
  const reader = fakeReader({ 'p.js': 'a multimodal prompt with no hardening' });
  const errs = checkSurface(surface, reader).errors;
  assert(
    'multimodal surface missing the preamble is still flagged',
    errs.length === 1 && /buildUntrustedContentPreamble/.test(errs[0]),
  );
}

// ── checkSurface — call-site-granular `builders` layer ────────────────────

// 9. The masking bug: a surface with two builders in one file — one carries
// the preamble, the sibling does not. The file-level union check passes (the
// file DOES contain the marker), but the per-builder layer must flag the
// unsafe sibling. This is the #8/#15 false-green that lesson F documents.
{
  const fxSibling = [
    'export function createSafePrompt(text) {',
    '  return `${buildUntrustedContentPreamble()} analyse: ${text}`;',
    '}',
    'export function createUnsafePrompt(text) {',
    '  return `no hardening at all here: ${text}`;',
    '}',
  ].join('\n');
  const surface = {
    id: 'fx-sibling',
    status: 'migrated',
    promptFiles: ['shared/config/prompts/fx-sibling.js'],
    callSiteFiles: ['c.js'],
    builders: ['createSafePrompt', 'createUnsafePrompt'],
  };
  const reader = fakeReader({
    'shared/config/prompts/fx-sibling.js': fxSibling,
    'c.js': 'uses wrapUntrustedContent here',
  });
  const errs = checkSurface(surface, reader).errors;
  assert(
    'call-site-granular: an unsafe sibling builder missing the preamble is flagged',
    errs.length === 1 && /createUnsafePrompt/.test(errs[0]),
  );
}

// 9b. all builders carry the preamble in their own body → passes.
{
  const content = [
    'export function createAPrompt(t) { return `${buildUntrustedContentPreamble()} ${t}`; }',
    'export function createBPrompt(t) { return `${buildUntrustedContentPreamble()} ${t}`; }',
  ].join('\n');
  const surface = {
    id: 'fx-all-safe',
    status: 'migrated',
    promptFiles: ['p.js'],
    callSiteFiles: ['c.js'],
    builders: ['createAPrompt', 'createBPrompt'],
  };
  const reader = fakeReader({ 'p.js': content, 'c.js': 'wrapUntrustedContent' });
  assert(
    'call-site-granular: every builder carrying the preamble passes',
    checkSurface(surface, reader).errors.length === 0,
  );
}

// 9c. drift: a prompt-builder export not in the `builders` list is flagged.
{
  const content = [
    'export function createOnePrompt(t) { return `${buildUntrustedContentPreamble()} ${t}`; }',
    'export function createTwoPrompt(t) { return `${buildUntrustedContentPreamble()} ${t}`; }',
  ].join('\n');
  const surface = {
    id: 'fx-drift',
    status: 'migrated',
    promptFiles: ['p.js'],
    callSiteFiles: ['c.js'],
    builders: ['createOnePrompt'], // createTwoPrompt deliberately omitted
  };
  const reader = fakeReader({ 'p.js': content, 'c.js': 'wrapUntrustedContent' });
  const errs = checkSurface(surface, reader).errors;
  assert(
    'call-site-granular: an undeclared sibling builder is flagged as drift',
    errs.some((e) => /createTwoPrompt/.test(e) && /builders/.test(e)),
  );
}

// ── findUnregisteredPromptFiles ───────────────────────────────────────────

// 6. a prompt file referenced by no surface is reported.
{
  const surfaces = [
    { id: 's1', promptFiles: ['shared/config/prompts/known.js'] },
  ];
  const list = () => [
    'shared/config/prompts/known.js',
    'shared/config/prompts/orphan.js',
  ];
  const unreg = findUnregisteredPromptFiles(surfaces, list);
  assert(
    'an unregistered prompt file is reported',
    unreg.length === 1 && unreg[0].endsWith('orphan.js'),
  );
}

// 7. a fully-registered prompt directory yields no reports.
{
  const surfaces = [
    { id: 's1', promptFiles: ['shared/config/prompts/known.js'] },
  ];
  const list = () => ['shared/config/prompts/known.js'];
  assert(
    'a fully-registered prompt dir reports nothing',
    findUnregisteredPromptFiles(surfaces, list).length === 0,
  );
}

// ── Live gate ─────────────────────────────────────────────────────────────

// 8. the real gate, against the live registry + filesystem, is green.
{
  let ok = true;
  try {
    execSync(`node ${JSON.stringify(path.join(repoRoot, 'scripts', 'check-prompt-injection-tagging.js'))}`, {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    ok = false;
  }
  assert('live gate passes against the current repo', ok);
}

if (failures > 0) {
  console.error(`\nprompt-injection-tagging self-test FAILED — ${failures} case(s).`);
  process.exit(1);
}
console.log('\nprompt-injection-tagging self-test OK — 14/14 cases.');
