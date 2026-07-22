'use strict';

const assert = require('assert');
const path = require('path');
const {
  extractAdversarialReviewReceiptPaths,
  extractNamedSourcePaths,
  findAssumptionQuantityLeaks,
  findUnverifiedReviewerEmailOwnershipClaims,
  findUntracedDiscoveryAsks,
  hasAdversarialReviewWaiver,
  hasNotReadEscape,
  isHighRiskReviewArtifact,
  isQualifiedAdversarialReviewPrompt,
  isPlanDoc,
  transcriptHasReadEvidence,
} = require('./document-guards');

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  ✗ ${name}`);
    console.error(`    ${error.message}`);
  }
}

test('detects plan docs by filename and frontmatter kind', () => {
  assert.strictEqual(isPlanDoc('docs/ROUTE_SERVICE_CONSOLIDATION_PLAN.md', ''), true);
  assert.strictEqual(isPlanDoc('docs/example.md', '---\nkind: plan\n---\nbody'), true);
  assert.strictEqual(isPlanDoc('docs/example.md', '---\nkind: runbook\n---\nbody'), false);
});

test('extracts named pages/lib source paths', () => {
  assert.deepStrictEqual(
    extractNamedSourcePaths('Read pages/api/foo.js and `lib/services/bar.ts:12`; ignore docs/x.md.'),
    ['lib/services/bar.ts', 'pages/api/foo.js']
  );
});

test('flags unresolved quantity assumptions that taint derived plan counts', () => {
  const leaks = findAssumptionQuantityLeaks([
    '# Plan',
    '| Subject | Count |',
    '| Route union | TBD at Stage 0 |',
    '| Wave arithmetic | 10 + 6 + 16 + 17 = 49 routes |',
  ].join('\n'));
  assert.strictEqual(leaks.length > 0, true);
});

test('allows visibly qualified derived counts', () => {
  const leaks = findAssumptionQuantityLeaks([
    '| Subject | Count |',
    '| Route union | TBD at Stage 0 |',
    '| Wave arithmetic | [DERIVED-FROM: scripts/probe.js:12; independent of TBD count] 49 routes |',
  ].join('\n'));
  assert.strictEqual(leaks.length, 0);
});

test('recognizes visible NOT-READ escapes tied to the source path', () => {
  assert.strictEqual(
    hasNotReadEscape('pages/api/foo.js [NOT-READ: pages/api/foo.js — future route]', 'pages/api/foo.js'),
    true
  );
  assert.strictEqual(hasNotReadEscape('[NOT-READ: future route]', 'pages/api/foo.js'), false);
});

test('recognizes transcript Read/Open and shell read evidence', () => {
  const root = path.resolve('/tmp/wmkf-hooks-test');
  const transcript = [
    JSON.stringify({ tool_name: 'Read', tool_input: { file_path: path.join(root, 'pages/api/foo.js') } }),
    JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'rtk nl -ba lib/services/bar.js' } }),
  ].join('\n');
  assert.strictEqual(transcriptHasReadEvidence(transcript, root, 'pages/api/foo.js'), true);
  assert.strictEqual(transcriptHasReadEvidence(transcript, root, 'lib/services/bar.js'), true);
  assert.strictEqual(transcriptHasReadEvidence(transcript, root, 'pages/api/missing.js'), false);
});

test('newlyIntroducedText judges the delta, not the whole document', () => {
  const { newlyIntroducedText } = require('./document-guards');
  const editDelta = newlyIntroducedText(
    { tool_name: 'Edit', tool_input: { old_string: 'names lib/services/old.js here', new_string: 'no paths in the replacement' } },
    '/tmp/wmkf-hooks-test'
  );
  assert.strictEqual(editDelta, 'no paths in the replacement');
  const newFile = newlyIntroducedText(
    { tool_name: 'Write', tool_input: { file_path: '/tmp/wmkf-hooks-test/docs/NEW_PLAN.md', content: 'names pages/api/foo.js' } },
    '/tmp/wmkf-hooks-test'
  );
  assert.strictEqual(newFile, 'names pages/api/foo.js');
});

test('recognizes codegraph_explore output as read evidence', () => {
  const root = path.resolve('/tmp/wmkf-hooks-test');
  const transcript = [
    JSON.stringify({ tool_name: 'mcp__codegraph__codegraph_explore', tool_input: { query: 'send-emails flow' } }),
    JSON.stringify({ type: 'tool_result', content: '<codegraph_context> **`pages/api/review-manager/send-emails.js`** — handler(calls)' }),
  ].join('\n');
  assert.strictEqual(transcriptHasReadEvidence(transcript, root, 'pages/api/review-manager/send-emails.js'), true);
  assert.strictEqual(transcriptHasReadEvidence(transcript, root, 'pages/api/unrelated.js'), false);
});

test('blocks repo-local discovery asks without adjacent trace evidence', () => {
  const misses = findUntracedDiscoveryAsks('P0 review. Check whether any routes stream.');
  assert.strictEqual(misses.length, 1);
});

test('allows discovery asks with adjacent TRACED file-line evidence', () => {
  const prompt = [
    'P0 review.',
    'TRACED:',
    '- pages/api/foo.js:42 checked stream handling; none found.',
    'Check whether any routes stream.',
  ].join('\n');
  assert.strictEqual(findUntracedDiscoveryAsks(prompt).length, 0);
});

test('allows visible delegated-discovery escape', () => {
  const prompt = 'Check whether any external docs exist. [DELEGATED-DISCOVERY: external web research, no local repo source]';
  assert.strictEqual(findUntracedDiscoveryAsks(prompt).length, 0);
});

test('detects an unverified reviewer-email ownership assertion', () => {
  const claims = findUnverifiedReviewerEmailOwnershipClaims(
    '`zhang@mit.edu` is almost certainly a different Zhang or a role mailbox, not Feng Zhang\'s personal address.'
  );
  assert.strictEqual(claims.length, 1);
  assert.deepStrictEqual(claims[0].emails, ['zhang@mit.edu']);
});

test('allows reviewer-email claims with evidence, uncertainty, or enumerated non-claim exemptions', () => {
  assert.strictEqual(findUnverifiedReviewerEmailOwnershipClaims(
    '`zhang@mit.edu` is Feng Zhang\'s published address (https://mcgovern.mit.edu/profile/feng-zhang/).'
  ).length, 0);
  assert.strictEqual(findUnverifiedReviewerEmailOwnershipClaims(
    '`zhang@mit.edu` may be Feng Zhang\'s address [ASSUMED].'
  ).length, 0);
  assert.strictEqual(findUnverifiedReviewerEmailOwnershipClaims(
    'Quoted failure: `zhang@mit.edu` is almost certainly a different Zhang. <!-- assertion-exempt: quoted-example -->'
  ).length, 0);
});

test('does not turn broad prose confidence words or example addresses into ownership violations', () => {
  assert.strictEqual(findUnverifiedReviewerEmailOwnershipClaims(
    'The UI clearly labels support@example.com as a placeholder.'
  ).length, 0);
  assert.strictEqual(findUnverifiedReviewerEmailOwnershipClaims(
    'The resolver is the component that formats the result.'
  ).length, 0);
});

test('recognizes consequential review artifacts and explicit waivers', () => {
  const text = [
    '# Verdict',
    'NEEDS WORK',
    '# Prioritized Findings',
    '## P1',
    'Recommendation: change the execution order.',
  ].join('\n');
  assert.strictEqual(isHighRiskReviewArtifact('docs/audits/example.md', text), true);
  assert.strictEqual(isHighRiskReviewArtifact('docs/audits/example.md', '# Notes\nNo verdict.'), false);
  assert.strictEqual(hasAdversarialReviewWaiver(
    `${text}\n<!-- adversarial-review:waived reason=owner accepted residual -->`
  ), true);
});

test('requires an explicit, adversarial, evidence-bearing review receipt prompt', () => {
  const rel = 'docs/audits/example.md';
  const prompt = [
    `[ADVERSARIAL-REVIEW-RECEIPT: ${rel}]`,
    'Run an adversarial refutation.',
    'For each recommendation, provide file:line evidence and a disconfirming check.',
  ].join('\n');
  assert.deepStrictEqual(extractAdversarialReviewReceiptPaths(prompt), [rel]);
  assert.strictEqual(isQualifiedAdversarialReviewPrompt(prompt, rel), true);
  assert.strictEqual(isQualifiedAdversarialReviewPrompt(
    `[ADVERSARIAL-REVIEW-RECEIPT: ${rel}] Looks good to me.`,
    rel
  ), false);
});

if (failures) {
  console.error(`\ndocument-guards test FAILED — ${failures} case(s).`);
  process.exit(1);
}
console.log('\ndocument-guards test OK');
