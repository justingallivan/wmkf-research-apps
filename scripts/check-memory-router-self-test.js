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
const path = require('path');
const { registerTmpFixture } = require('./lib/selftest-fixture');
const { validateStore, countUniqueDirectLeafRefs, MAX_LINES, TARGET_BYTES, WARN_BYTES, NOTICE_BYTES, MAX_PROSE_LEN } = require('./check-memory-router.js');

let failures = 0;
function assert(cond, label) {
  if (cond) { console.log(`  ok   ${label}`); }
  else { console.error(`  FAIL ${label}`); failures++; }
}

function mkStore(memoryMd, topicFiles) {
  const { dir } = registerTmpFixture('memrouter-');
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

// 4a. Status nested under metadata: in frontmatter → OK (the auto-memory shape).
{
  const dir = mkStore('# Router\n', { 'a.md': '---\nname: x\nmetadata:\n  type: reference\n  status: active\n---\nbody\n' });
  const { errors } = validateStore(dir);
  assert(errors.length === 0, 'status nested under metadata passes');
}

// 4b. Status only in the BODY (not frontmatter) → error (old /m regex was fooled).
{
  const dir = mkStore('# Router\n', { 'a.md': '---\nname: x\n---\n\nbody mentions status: active here\n' });
  const { errors } = validateStore(dir);
  assert(errors.some((e) => e.includes('no `status:` key in frontmatter')), 'body-only status is rejected');
}

// 4c. No frontmatter at all (status in body) → error.
{
  const dir = mkStore('# Router\n', { 'a.md': '# no frontmatter\nstatus: active\n\nbody\n' });
  const { errors } = validateStore(dir);
  assert(errors.some((e) => e.includes('missing YAML frontmatter')), 'missing frontmatter flagged');
}

// 4d. Quoted status value in frontmatter → OK.
{
  const dir = mkStore('# Router\n', { 'a.md': '---\nstatus: "active"\n---\nbody\n' });
  const { errors } = validateStore(dir);
  assert(errors.length === 0, 'quoted status value passes');
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
  const { dir } = registerTmpFixture('memrouter-');
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

// 10. Bytes in the early-warning band (WARN_BYTES < bytes <= TARGET_BYTES) →
//     warning, NOT error. Many short lines so prose/line caps stay clear.
{
  const line = '- ' + 'x'.repeat(100); // ~102 bytes, prose 100 < cap
  let body = '# Router\n';
  while (Buffer.byteLength(body, 'utf8') <= WARN_BYTES) body += line + '\n';
  assert(Buffer.byteLength(body, 'utf8') > WARN_BYTES, 'fixture 10 is over WARN_BYTES');
  assert(Buffer.byteLength(body, 'utf8') <= TARGET_BYTES, 'fixture 10 stays under TARGET_BYTES');
  assert(body.split('\n').length <= MAX_LINES, 'fixture 10 stays under MAX_LINES');
  const dir = mkStore(body, { 'a.md': goodTopic });
  const { errors, warnings } = validateStore(dir);
  assert(errors.length === 0, 'early-warning band does not fail');
  assert(warnings.some((w) => w.includes('hard cap')), 'early-warning band warns');
}

// Exact-byte fixture builder for the notice-band cases: '# Router\n' (9 bytes)
// + filler + '\n'. The filler line does not start with '- ', so the prose cap
// never applies; line count stays tiny.
function exactBytesStore(targetBytes) {
  const header = '# Router\n';
  const body = header + 'x'.repeat(targetBytes - Buffer.byteLength(header, 'utf8') - 1) + '\n';
  if (Buffer.byteLength(body, 'utf8') !== targetBytes) {
    throw new Error(`fixture builder produced ${Buffer.byteLength(body, 'utf8')} bytes, wanted ${targetBytes}`);
  }
  return body;
}

// 11 (plan fixture a). Exactly NOTICE_BYTES → exactly one notice warning, no
// errors — pins the >= comparator at the boundary.
{
  const dir = mkStore(exactBytesStore(NOTICE_BYTES), { 'a.md': goodTopic });
  const { errors, warnings } = validateStore(dir);
  assert(errors.length === 0, 'exact NOTICE_BYTES store does not fail');
  assert(warnings.filter((w) => w.includes('routine-audit trigger')).length === 1, 'exact NOTICE_BYTES store gets exactly one notice');
  assert(!warnings.some((w) => w.includes('hard cap')), 'exact NOTICE_BYTES store gets no near-cap warning');
}

// 12 (plan fixture b). One byte under NOTICE_BYTES → no byte warning at all.
{
  const dir = mkStore(exactBytesStore(NOTICE_BYTES - 1), { 'a.md': goodTopic });
  const { errors, warnings } = validateStore(dir);
  assert(errors.length === 0, 'sub-notice store does not fail');
  assert(warnings.length === 0, 'sub-notice store gets no byte warning');
}

// 13 (plan fixture c). Inside the notice band (well under WARN_BYTES) →
// notice text, not near-cap text.
{
  const dir = mkStore(exactBytesStore(NOTICE_BYTES + 108), { 'a.md': goodTopic });
  const { errors, warnings } = validateStore(dir);
  assert(errors.length === 0, 'notice-band store does not fail');
  assert(warnings.some((w) => w.includes('routine-audit trigger')), 'notice-band store gets the notice');
  assert(!warnings.some((w) => w.includes('hard cap')), 'notice-band store gets no near-cap warning');
}

// 14 (plan fixture d). One byte over WARN_BYTES → near-cap warning ONLY
// (ladder exclusivity: the notice must not also fire).
{
  const dir = mkStore(exactBytesStore(WARN_BYTES + 1), { 'a.md': goodTopic });
  const { errors, warnings } = validateStore(dir);
  assert(errors.length === 0, 'warn-band store does not fail');
  assert(warnings.some((w) => w.includes('hard cap')), 'warn-band store gets the near-cap warning');
  assert(!warnings.some((w) => w.includes('routine-audit trigger')), 'warn-band store does not also get the notice');
}

// 15 (plan fixture e). Threshold ladder ordering + numeric sanity — a future
// edit to the thresholds module cannot silently invert or corrupt the ladder.
{
  assert(Number.isFinite(NOTICE_BYTES) && Number.isFinite(WARN_BYTES) && Number.isFinite(TARGET_BYTES), 'thresholds are finite numbers');
  assert(NOTICE_BYTES < WARN_BYTES && WARN_BYTES < TARGET_BYTES, 'NOTICE_BYTES < WARN_BYTES < TARGET_BYTES ordering holds');
}

// 16 (R4). Unique leaf-reference metric deduplicates direct topic refs and
// excludes docs/wiki paths even when their basename matches a topic file.
{
  const raw = '# Router\n- leaves: a.md; a.md; b.md; ../docs/a.md; docs/guide.md\n';
  assert(
    countUniqueDirectLeafRefs(raw, ['a.md', 'b.md', 'c.md']) === 2,
    'unique direct leaf refs deduplicate leaves and exclude hub/doc links',
  );
}

if (failures) {
  console.error(`memory-router self-test FAILED — ${failures} case(s).`);
  process.exit(1);
}
console.log('memory-router self-test OK — 20/20 cases behaved as expected.');
