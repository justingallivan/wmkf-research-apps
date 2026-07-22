const historicalManifest = require('../../docs/audits/reviewer-holistic-evaluation-manifest-v1.json');
const trackedManifest = require('../../docs/audits/reviewer-holistic-evaluation-manifest-v2.json');
const { execFileSync } = require('child_process');
const {
  validateCommitReferences,
  validateManifest,
} = require('../../scripts/validate-reviewer-holistic-evaluation-manifest');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function frozenManifest() {
  const manifest = clone(trackedManifest);
  const proposalIds = Array.from({ length: 10 }, (_, index) => `proposal-${index + 1}`);
  manifest.status = 'frozen';
  manifest.baseline.commit = 'a'.repeat(40);
  manifest.redesign.startingCommit = 'b'.repeat(40);
  manifest.redesign.implementationCommit = 'c'.repeat(40);
  manifest.redesign.pipelineVersion = 'reviewer-holistic/v1';
  manifest.execution = {
    implementationCommit: 'd'.repeat(40),
    scriptVersion: 'reviewer-holistic-executor/v1',
    artifactVersion: 'reviewer-holistic-execution/v1',
  };
  manifest.evaluationScriptVersion = 'reviewer-holistic-run-plan/v1';
  manifest.identityBenchmark.fixtureVersion = 'identity-fixtures/v1';
  manifest.proposalEvaluation.proposalIds = proposalIds;
  manifest.proposalEvaluation.documentHashes = Object.fromEntries(
    proposalIds.map((id, index) => [id, String(index % 10).repeat(64)]),
  );
  manifest.runtimeConfig = {
    promptRowId: '11111111-1111-4111-8111-111111111111',
    promptVersion: '1',
    promptPayloadHash: 'e'.repeat(64),
    modelIds: ['provider/model-version'],
    modelOverridesHash: 'c'.repeat(64),
    reviewerCount: 15,
    temperature: 0.3,
    exclusionsHash: 'd'.repeat(64),
  };
  manifest.adjudicator = null;
  return manifest;
}

describe('reviewer holistic evaluation manifest', () => {
  test('historical v1 manifest retains its original identity fixture', () => {
    expect(validateManifest(historicalManifest, { requireFrozen: true })).toEqual({ ok: true, errors: [] });
    expect(historicalManifest.identityBenchmark.fixtureVersion).toBe('reviewer-identity-v1');
  });

  test('manifest v2 changes only its timestamp and identity fixture contract', () => {
    const historicalContract = clone(historicalManifest);
    const activeContract = clone(trackedManifest);
    historicalContract.createdAt = activeContract.createdAt;
    historicalContract.identityBenchmark.fixtureVersion =
      activeContract.identityBenchmark.fixtureVersion;
    expect(activeContract).toEqual(historicalContract);
  });

  test('tracked manifest is complete and frozen', () => {
    expect(validateManifest(trackedManifest, { requireFrozen: true })).toEqual({ ok: true, errors: [] });
    expect(trackedManifest.proposalEvaluation.proposalIds).toHaveLength(10);
    expect(trackedManifest.baseline.commit).toBe('50140eb62dd8f3c04f6d3ab5e131d96711f804d7');
    expect(trackedManifest.redesign).toMatchObject({
      startingCommit: trackedManifest.baseline.commit,
      implementationCommit: '166800a3142179db642af3beefd67b8dcc381173',
      pipelineVersion: 'reviewer-holistic-applicant-neighborhood-seeds-v1',
    });
    expect(trackedManifest.evaluationScriptVersion).toBe('reviewer-holistic-m1-run-plan-v2');
    expect(trackedManifest.execution).toEqual({
      implementationCommit: 'e8796ce535954f5d8678f58b94abea1b9ceea66c',
      scriptVersion: 'reviewer-holistic-m1-executor-v3',
      artifactVersion: 'reviewer-holistic-m1-execution-v1',
    });
    expect(trackedManifest.identityBenchmark.fixtureVersion).toBe('reviewer-identity-v2');
    expect(trackedManifest.runtimeConfig).toMatchObject({
      promptVersion: '2',
      modelIds: ['claude-opus-4-8'],
      reviewerCount: 15,
      temperature: 0.3,
    });
  });

  test('partially populated draft freeze fields fail closed when malformed', () => {
    const manifest = clone(trackedManifest);
    manifest.baseline.commit = 'not-a-sha';
    manifest.runtimeConfig.promptRowId = 'not-a-guid';
    manifest.runtimeConfig.promptPayloadHash = 'not-a-hash';
    manifest.runtimeConfig.modelOverridesHash = 'not-a-hash';
    manifest.runtimeConfig.reviewerCount = 0;
    const result = validateManifest(manifest);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'baseline.commit' }),
      expect.objectContaining({ path: 'runtimeConfig.promptRowId' }),
      expect.objectContaining({ path: 'runtimeConfig.promptPayloadHash' }),
      expect.objectContaining({ path: 'runtimeConfig.modelOverridesHash' }),
      expect.objectContaining({ path: 'runtimeConfig.reviewerCount' }),
    ]));
  });

  test('complete frozen manifest passes the hard precondition', () => {
    expect(validateManifest(frozenManifest(), { requireFrozen: true })).toEqual({ ok: true, errors: [] });
  });

  test('manifest rejects an adjudicator under the single-reviewer policy', () => {
    const manifest = clone(trackedManifest);
    manifest.adjudicator = 'owner';
    expect(validateManifest(manifest).errors).toContainEqual({
      path: 'adjudicator',
      message: 'must be null for the single-reviewer identity benchmark',
    });
  });

  test('frozen manifest rejects duplicate proposals and unpaired hashes', () => {
    const manifest = frozenManifest();
    manifest.proposalEvaluation.proposalIds[9] = manifest.proposalEvaluation.proposalIds[0];
    manifest.proposalEvaluation.documentHashes.orphan = 'e'.repeat(64);
    const result = validateManifest(manifest, { requireFrozen: true });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'proposalEvaluation.proposalIds', message: 'must be unique' }),
      expect.objectContaining({ path: 'proposalEvaluation.documentHashes.orphan' }),
    ]));
  });

  test('unknown top-level fields fail closed', () => {
    const manifest = clone(trackedManifest);
    manifest.clientMaySelectArm = true;
    expect(validateManifest(manifest).errors).toContainEqual({
      path: 'clientMaySelectArm',
      message: 'unknown top-level field',
    });
  });

  test('unknown nested freeze fields fail closed', () => {
    const manifest = clone(trackedManifest);
    manifest.runtimeConfig.clientSelectedArm = 'redesign';
    expect(validateManifest(manifest).errors).toContainEqual({
      path: 'runtimeConfig.clientSelectedArm',
      message: 'unknown field',
    });
  });

  test('frozen commit references must resolve locally', () => {
    const manifest = frozenManifest();
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    manifest.baseline.commit = head;
    manifest.redesign.startingCommit = head;
    manifest.redesign.implementationCommit = head;
    manifest.execution.implementationCommit = head;
    expect(validateCommitReferences(manifest)).toEqual({ ok: true, errors: [] });

    manifest.redesign.startingCommit = '0'.repeat(40);
    expect(validateCommitReferences(manifest)).toEqual({
      ok: false,
      errors: [{
        path: 'redesign.startingCommit',
        message: 'must resolve to a commit in the local repository',
      }],
    });
  });

  test('draft commit-reference checks skip unpinned null fields', () => {
    const manifest = clone(trackedManifest);
    manifest.baseline.commit = null;
    manifest.redesign.startingCommit = null;
    manifest.redesign.implementationCommit = null;
    manifest.execution.implementationCommit = null;
    expect(validateCommitReferences(manifest)).toEqual({ ok: true, errors: [] });
  });
});
