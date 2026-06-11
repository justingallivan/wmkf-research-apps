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
const { validateStore, MAX_LINES, TARGET_BYTES, MAX_PROSE_LEN } = require('./check-memory-router.js');

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

// 7. Over-TARGET_BYTES (but under MAX_LINES and no long prose line) → error.
//    Many medium lines: each ~120 chars of prose (< MAX_PROSE_LEN), count < MAX_LINES.
{
  const lineCount = 130;
  const body = '# Router\n' + Array(lineCount).fill('- ' + 'x'.repeat(120)).join('\n') + '\n';
  assert(Buffer.byteLength(body, 'utf8') > TARGET_BYTES, 'fixture 7 is actually over TARGET_BYTES');
  assert(body.split('\n').length <= MAX_LINES, 'fixture 7 stays under MAX_LINES');
  const dir = mkStore(body, { 'a.md': goodTopic });
  const { errors } = validateStore(dir);
  assert(errors.some((e) => e.includes('byte')), 'over-TARGET bytes flagged (hardened cap)');
}

// 8. A single over-long `- ` router-prose line → error.
{
  const longProse = 'word '.repeat(60); // ~300 chars, > MAX_PROSE_LEN
  const dir = mkStore(`# Router\n- ${longProse} a.md\n`, { 'a.md': goodTopic });
  const { errors } = validateStore(dir);
  assert(errors.some((e) => e.includes('router-prose cap')), 'over-length router prose flagged');
}

// 9. A `- ` line routing to MANY .md files but with SHORT prose → no prose error.
//    Proves file-ref lists are not penalized (the design's whole point).
{
  const manyFiles = Array(15).fill(0).map((_, i) => `topic-${i}.md`).join('; ');
  const topics = {};
  for (let i = 0; i < 15; i++) topics[`topic-${i}.md`] = goodTopic;
  const dir = mkStore(`# Router\n- Reviewer stuff: ${manyFiles}\n`, topics);
  const { errors } = validateStore(dir);
  assert(!errors.some((e) => e.includes('router-prose cap')), 'many-file router line is not prose-flagged');
  assert(errors.length === 0, 'many-file router line passes cleanly');
}

if (failures) {
  console.error(`memory-router self-test FAILED — ${failures} case(s).`);
  process.exit(1);
}
console.log('memory-router self-test OK — 9/9 cases behaved as expected.');
