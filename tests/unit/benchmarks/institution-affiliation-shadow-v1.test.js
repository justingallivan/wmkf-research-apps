const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  buildArtifact,
} = require('../../../benchmarks/institution-affiliation-compatibility/v1/run-shadow-evaluation');
const {
  assessAffiliationRelationship,
  evaluateAffiliationPolicy,
} = require('../../../lib/services/institution-affiliation-assessment');
const {
  projectInstitutionStage2Presentation,
} = require('../../../lib/services/institution-affiliation-stage2');

const ROOT = path.join(
  process.cwd(),
  'benchmarks',
  'institution-affiliation-compatibility',
  'v1',
);
const CASES_PATH = path.join(ROOT, 'cases', 'source-aware-25.json');
const SNAPSHOT_PATH = path.join(ROOT, 'provider-snapshots', 'ror-2026-08-19d.json');
const RESULT_PATH = path.join(ROOT, 'results', 'source-aware-25-shadow-2026-08-19c.json');

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

test('frozen source-aware fixture and provider snapshot are complete and correlated', () => {
  const fixture = JSON.parse(fs.readFileSync(CASES_PATH, 'utf8'));
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
  expect(fixture.cases).toHaveLength(25);
  expect(snapshot.cases).toHaveLength(25);
  expect(snapshot.casesSha256).toBe(sha256(CASES_PATH));
  expect(snapshot.metrics.providerFailures).toBe(0);
  for (const testCase of fixture.cases) {
    expect(testCase.evidenceAssertion.sourceReference).toBeTruthy();
    expect(testCase.recordedAssertion.sourceReference).toBeTruthy();
    expect(testCase.independentIdentity).toMatchObject({ excludesAffiliation: true });
    expect(typeof testCase.independentIdentity.sufficient).toBe('boolean');
    expect(testCase.adjudication.relationship).toBeTruthy();
    expect(testCase.adjudication.action).toBeTruthy();
    expect(testCase.adjudication.rationale).toBeTruthy();
  }
});

test('offline shadow evaluation meets the Stage 1 hard gates', () => {
  const fixture = JSON.parse(fs.readFileSync(CASES_PATH, 'utf8'));
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
  const artifact = buildArtifact(fixture, snapshot);
  expect(artifact.result).toBe('GO_FOR_SHADOW_CONTRACT');
  expect(artifact.summary).toMatchObject({
    relationshipMatches: 25,
    actionMatches: 25,
    siblingEntityCollapses: 0,
    unsafeActionClears: 0,
    challengedCasesNonblocking: 3,
    providerFailuresInLiveCapture: 0,
  });
});

test('frozen readable artifact matches the deterministic evaluator', () => {
  const fixture = JSON.parse(fs.readFileSync(CASES_PATH, 'utf8'));
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
  const frozen = JSON.parse(fs.readFileSync(RESULT_PATH, 'utf8'));
  const rebuilt = buildArtifact(fixture, snapshot);
  expect(frozen.result).toBe(rebuilt.result);
  expect(frozen.summary).toEqual(rebuilt.summary);
  expect(frozen.rows).toEqual(rebuilt.rows);
});

test.each([
  'source25-83ce8914d857',
  'source25-97d16b3bdc69',
  'source25-24810991224e',
])('%s is compatible and nonblocking when independent identity is sufficient', (caseId) => {
  const fixture = JSON.parse(fs.readFileSync(CASES_PATH, 'utf8'));
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
  const artifact = buildArtifact(fixture, snapshot);
  const row = artifact.rows.find((item) => item.caseId === caseId);
  expect(['same', 'parent_child']).toContain(row.after.relationship);
  expect(row.after.action).toBe('allow_if_other_identity_gates_pass');
  expect(row.after.effect).not.toBe('hold');
  expect(row.after.effect).not.toBe('veto');
});

test('Stage 2 card projection preserves every frozen source/time distinction', () => {
  const fixture = JSON.parse(fs.readFileSync(CASES_PATH, 'utf8'));
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
  const cases = new Map(fixture.cases.map((entry) => [entry.caseId, entry]));
  const rows = snapshot.cases.map((provider) => {
    const testCase = cases.get(provider.caseId);
    const assessment = assessAffiliationRelationship({
      evidenceAssertion: provider.evidenceAssertion,
      recordedAssertion: provider.recordedAssertion,
    });
    const policy = evaluateAffiliationPolicy({
      assessment,
      consumer: 'candidate_card',
      independentIdentity: testCase.independentIdentity,
    });
    return {
      caseId: provider.caseId,
      assessment,
      policy,
      presentation: projectInstitutionStage2Presentation({
        assessment,
        policy,
        consumer: 'candidate_card',
      }),
    };
  });

  expect(rows).toHaveLength(25);
  expect(rows.filter((row) => (
    row.assessment.evidenceContext === 'current_conflict'
      && row.presentation.kind !== 'current_conflict'
  ))).toEqual([]);
  expect(rows.filter((row) => (
    row.assessment.evidenceContext.startsWith('historical_')
      && row.presentation.kind !== 'historical'
  ))).toEqual([]);
  expect(rows.filter((row) => (
    row.assessment.evidenceContext === 'compatible_with_additional'
      && row.presentation.kind !== 'additional'
  ))).toEqual([]);
  expect(rows.filter((row) => (
    row.presentation.kind !== 'current_conflict'
      && /current affiliations conflict/i.test(row.presentation.heading || '')
  ))).toEqual([]);
  expect(rows.filter((row) => (
    row.policy.effect === 'hold' && row.presentation.remedies.length === 0
  ))).toEqual([]);
});
