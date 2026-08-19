#!/usr/bin/env node

/**
 * Deterministic offline Stage 1 evaluation over the frozen source-aware cases
 * and normalized ROR snapshot. Produces a new artifact and never changes
 * production behavior.
 */

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  assessAffiliationRelationship,
  evaluateAffiliationPolicy,
} = require('../../../lib/services/institution-affiliation-assessment');

const ROOT = __dirname;
const CASES_PATH = path.join(ROOT, 'cases', 'source-aware-25.json');
const SNAPSHOT_PATH = path.join(ROOT, 'provider-snapshots', 'ror-2026-08-19d.json');
const RESULT_JSON = path.join(ROOT, 'results', 'source-aware-25-shadow-2026-08-19c.json');
const RESULT_MD = path.join(ROOT, 'results', 'source-aware-25-shadow-2026-08-19c.md');
const CHALLENGED = new Set([
  'source25-83ce8914d857',
  'source25-97d16b3bdc69',
  'source25-24810991224e',
]);

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function oldRelationship(oldLabel) {
  if (!oldLabel) return null;
  if (oldLabel.startsWith('same_organization')) return 'same';
  if (oldLabel === 'distinct_organizations') return 'distinct';
  if (oldLabel === 'related_independent_organizations' || oldLabel === 'related-surface') {
    return 'related_other';
  }
  return null;
}

function completeAssertion(assertion) {
  return Boolean(
    assertion?.rawText
      && assertion?.sourceType
      && assertion?.sourceReference
      && assertion?.currentness
      && Object.prototype.hasOwnProperty.call(assertion, 'authorSpecific')
      && Array.isArray(assertion?.segments)
      && assertion.segments.length > 0,
  );
}

function relationshipCounts(rows) {
  return rows.reduce((counts, row) => {
    counts[row.after.relationship] = (counts[row.after.relationship] || 0) + 1;
    return counts;
  }, {});
}

function contextCounts(rows) {
  return rows.reduce((counts, row) => {
    counts[row.after.evidenceContext] = (counts[row.after.evidenceContext] || 0) + 1;
    return counts;
  }, {});
}

function buildArtifact(fixture, snapshot) {
  const snapshots = new Map(snapshot.cases.map((entry) => [entry.caseId, entry]));
  const rows = fixture.cases.map((testCase) => {
    const provider = snapshots.get(testCase.caseId);
    if (!provider) throw new Error(`provider snapshot missing ${testCase.caseId}`);
    const assessment = assessAffiliationRelationship({
      evidenceAssertion: provider.evidenceAssertion,
      recordedAssertion: provider.recordedAssertion,
    });
    const policy = evaluateAffiliationPolicy({
      assessment,
      consumer: 'candidate_selectability',
      independentIdentity: testCase.independentIdentity,
    });
    const priorRelationship = oldRelationship(testCase.oldLabel);
    const held = policy.effect === 'hold' || policy.effect === 'veto';
    const expectedHeld = testCase.adjudication.action.startsWith('hold_');
    return {
      caseId: testCase.caseId,
      sourceReferences: [
        testCase.evidenceAssertion.sourceReference,
        testCase.recordedAssertion.sourceReference,
      ],
      currentBooleanObserved: testCase.oldLabel ? false : null,
      oldLabel: testCase.oldLabel,
      oldLabelRevision: Boolean(testCase.oldLabel && priorRelationship !== testCase.adjudication.relationship),
      independentIdentity: testCase.independentIdentity,
      adjudication: testCase.adjudication,
      after: {
        relationship: assessment.relationship,
        direction: assessment.direction,
        evidenceContext: assessment.evidenceContext,
        matchedSegments: assessment.matchedSegments,
        additionalAffiliations: assessment.additionalAffiliations.map((segment) => segment.rawText),
        action: policy.action,
        effect: policy.effect,
        reason: policy.reason,
        remedies: policy.remedies,
      },
      sourceComplete: completeAssertion(testCase.evidenceAssertion)
        && completeAssertion(testCase.recordedAssertion),
      relationshipMatch: assessment.relationship === testCase.adjudication.relationship,
      actionMatch: policy.action === testCase.adjudication.action,
      siblingCollapse: testCase.adjudication.relationship === 'sibling'
        && (assessment.relationship === 'same' || assessment.relationship === 'parent_child'),
      unsafeActionClear: expectedHeld && !held,
      manufacturedReview: !expectedHeld && held,
      providerFailureCase: testCase.providerMode === 'forced_failure',
      honestProviderFailureCopy: testCase.providerMode === 'forced_failure'
        && policy.reason.includes('provider_failure')
        && !policy.reason.includes('mismatch'),
      remedyCovered: !held || policy.remedies.length > 0,
    };
  });

  const count = (predicate) => rows.filter(predicate).length;
  const challengedRows = rows.filter((row) => CHALLENGED.has(row.caseId));
  const summary = {
    totalCases: rows.length,
    sourceCompleteCases: count((row) => row.sourceComplete),
    currentBooleanObservedFalse: count((row) => row.currentBooleanObserved === false),
    relationshipMatches: count((row) => row.relationshipMatch),
    actionMatches: count((row) => row.actionMatch),
    siblingEntityCollapses: count((row) => row.siblingCollapse),
    unsafeActionClears: count((row) => row.unsafeActionClear),
    manufacturedReviews: count((row) => row.manufacturedReview),
    providerFailureCases: count((row) => row.providerFailureCase),
    providerFailureCasesWithHonestCopy: count((row) => row.honestProviderFailureCopy),
    heldCases: count((row) => row.after.effect === 'hold' || row.after.effect === 'veto'),
    heldCasesWithRemedy: count((row) => (
      (row.after.effect === 'hold' || row.after.effect === 'veto') && row.remedyCovered
    )),
    oldLabelRevisions: count((row) => row.oldLabelRevision),
    oldLabeledCases: count((row) => Boolean(row.oldLabel)),
    challengedCasesNonblocking: challengedRows.filter((row) => (
      row.after.action === 'allow_if_other_identity_gates_pass'
    )).length,
    providerFailuresInLiveCapture: snapshot.metrics.providerFailures,
    relationships: relationshipCounts(rows),
    evidenceContexts: contextCounts(rows),
  };
  const go = summary.totalCases === 25
    && summary.sourceCompleteCases === 25
    && summary.relationshipMatches === 25
    && summary.actionMatches === 25
    && summary.siblingEntityCollapses === 0
    && summary.unsafeActionClears === 0
    && summary.providerFailureCasesWithHonestCopy === summary.providerFailureCases
    && summary.heldCasesWithRemedy === summary.heldCases
    && summary.challengedCasesNonblocking === 3
    && summary.providerFailuresInLiveCapture === 0;
  return {
    title: 'Source-aware institution affiliation Stage 1 shadow evaluation',
    generatedAt: new Date().toISOString(),
    authority: 'shadow_only_no_runtime_callers',
    result: go ? 'GO_FOR_SHADOW_CONTRACT' : 'HOLD_FOR_REVIEW',
    selection: fixture.selection,
    summary,
    rows,
    provenance: {
      gitHead: process.env.GIT_HEAD || null,
      casesSha256: sha256(CASES_PATH),
      providerSnapshotSha256: sha256(SNAPSHOT_PATH),
      providerCapturedAt: snapshot.capturedAt,
      provider: snapshot.provider,
      providerMetrics: snapshot.metrics,
    },
    limitations: [
      'The benchmark independent-identity input is an explicit counterfactual policy input, not a production runtime authority receipt.',
      'The live roster retains a machine-verifiable non-affiliation identity breakdown for only a small subset of current mismatch rows; Stage 3 remains blocked until that execution-point contract exists.',
      'Publication observation dates are null where the legacy production capture did not retain an exact work reference; currentness is explicitly historical rather than inferred as current.',
    ],
  };
}

function markdown(artifact) {
  const s = artifact.summary;
  const lines = [
    '# Source-aware institution affiliation Stage 1 shadow evaluation',
    '',
    `Generated: ${artifact.generatedAt}`,
    '',
    `Verdict: **${artifact.result}**`,
    '',
    'Status: **shadow only; no production caller, selectability rule, or durable write consumes this result.**',
    '',
    '## Headline',
    '',
    `- Source-complete cases: **${s.sourceCompleteCases}/${s.totalCases}**`,
    `- Relationship matches: **${s.relationshipMatches}/${s.totalCases}**`,
    `- Consumer-action matches: **${s.actionMatches}/${s.totalCases}**`,
    `- Sibling entity collapses: **${s.siblingEntityCollapses}**`,
    `- Unsafe action clears: **${s.unsafeActionClears}**`,
    `- Manufactured reviews: **${s.manufacturedReviews}**`,
    `- Provider-failure copy checks: **${s.providerFailureCasesWithHonestCopy}/${s.providerFailureCases}**`,
    `- Held cases with a remedy: **${s.heldCasesWithRemedy}/${s.heldCases}**`,
    `- Challenged regressions nonblocking: **${s.challengedCasesNonblocking}/3**`,
    `- Live-capture provider failures: **${s.providerFailuresInLiveCapture}**`,
    `- Old-label revisions: **${s.oldLabelRevisions}/${s.oldLabeledCases}**`,
    '',
    '## Slice denominators',
    '',
    `Relationships: ${Object.entries(s.relationships).map(([key, value]) => `${key}=${value}`).join(', ')}.`,
    '',
    `Evidence contexts: ${Object.entries(s.evidenceContexts).map(([key, value]) => `${key}=${value}`).join(', ')}.`,
    '',
    '## Case results',
    '',
    '| Case | Adjudicated relationship → action | Shadow relationship → action | Result |',
    '|---|---|---|---|',
  ];
  for (const row of artifact.rows) {
    const result = row.relationshipMatch && row.actionMatch ? 'match' : 'REVIEW';
    lines.push(`| ${row.caseId} | ${row.adjudication.relationship} → ${row.adjudication.action} | ${row.after.relationship} (${row.after.evidenceContext}) → ${row.after.action} | ${result} |`);
  }
  lines.push(
    '',
    '## Promotion boundary',
    '',
    ...artifact.limitations.map((item) => `- ${item}`),
    '',
    'Passing this artifact permits continued shadow evaluation only. It does not authorize Stage 2 UI behavior or Stage 3 identity/selectability/write authority.',
  );
  return `${lines.join('\n')}\n`;
}

function main() {
  for (const resultPath of [RESULT_JSON, RESULT_MD]) {
    if (fs.existsSync(resultPath)) throw new Error(`Refusing to overwrite frozen result: ${resultPath}`);
  }
  const fixture = JSON.parse(fs.readFileSync(CASES_PATH, 'utf8'));
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
  if (snapshot.casesSha256 !== sha256(CASES_PATH)) {
    throw new Error('provider snapshot does not match the frozen case input');
  }
  const artifact = buildArtifact(fixture, snapshot);
  fs.mkdirSync(path.dirname(RESULT_JSON), { recursive: true });
  fs.writeFileSync(RESULT_JSON, `${JSON.stringify(artifact, null, 2)}\n`);
  fs.writeFileSync(RESULT_MD, markdown(artifact));
  process.stdout.write(`${JSON.stringify({ result: artifact.result, summary: artifact.summary }, null, 2)}\n`);
  if (artifact.result !== 'GO_FOR_SHADOW_CONTRACT') process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { buildArtifact, markdown, oldRelationship };
