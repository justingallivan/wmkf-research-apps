#!/usr/bin/env node
/**
 * scripts/check-memory-router-self-test.js
 *
 * Self-test for check-memory-router.js. Builds synthetic memory-store fixtures
 * in a temp dir and asserts validateStore() flags exactly the expected
 * failures. Keeps the gate honest the same way the other check:*:self-test
 * scripts do. Writes its fixtures under os.tmpdir(), never into .claude-memory.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { validateStore, MAX_LINES } = require('./check-memory-router.js');

let failures = 0;
function assert(cond, label) {
  if (cond) { console.log(`  ok   ${label}`); }
  else { console.error(`  FAIL ${label}`); failures++; }
}

function mkStore(memoryMd, topicFiles) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memrouter-'));
  fs.writeFileSync(path.join(dir, 'MEMORY.md'), memoryMd);
  for (const [name, body] of Object.entries(topicFiles || {})) {
    fs.writeFileSync(path.join(dir, name), body);
  }
  return dir;
}

const goodTopic = '---\nname: x\ndescription: y\nmetadata:\n  type: project\n  status: active\n---\n\nbody\n';

// 1. Clean store → no errors.
{
  const dir = mkStore('# Router\n- thing: a.md\n', { 'a.md': goodTopic });
  const { errors } = validateStore(dir);
  assert(errors.length === 0, 'clean store passes');
}

// 2. Broken link → error.
{
  const dir = mkStore('# Router\n- thing: missing.md\n', { 'a.md': goodTopic });
  const { errors } = validateStore(dir);
  assert(errors.some((e) => e.includes('missing.md')), 'broken link flagged');
}

// 3. Topic file with no status → error.
{
  const dir = mkStore('# Router\n', { 'a.md': '---\nname: x\nmetadata:\n  type: project\n---\nbody\n' });
  const { errors } = validateStore(dir);
  assert(errors.some((e) => e.includes('no `status:`')), 'missing status flagged');
}

// 4. Topic file with bogus status → error.
{
  const dir = mkStore('# Router\n', { 'a.md': '---\nstatus: wibble\n---\nbody\n' });
  const { errors } = validateStore(dir);
  assert(errors.some((e) => e.includes('unrecognized status')), 'bogus status flagged');
}

// 5. Oversized MEMORY.md (too many lines) → error.
{
  const big = '# Router\n' + Array(MAX_LINES + 5).fill('- x: a.md').join('\n') + '\n';
  const dir = mkStore(big, { 'a.md': goodTopic });
  const { errors } = validateStore(dir);
  assert(errors.some((e) => e.includes('hard cap')), 'oversized MEMORY.md flagged');
}

// 6. Missing MEMORY.md → error.
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memrouter-'));
  const { errors } = validateStore(dir);
  assert(errors.some((e) => e.includes('MEMORY.md missing')), 'missing MEMORY.md flagged');
}

if (failures) {
  console.error(`memory-router self-test FAILED — ${failures} case(s).`);
  process.exit(1);
}
console.log('memory-router self-test OK — 6/6 cases behaved as expected.');
