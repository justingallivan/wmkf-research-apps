const draftManifest = require('../../docs/audits/reviewer-holistic-evaluation-manifest-v1.json');
const { execFileSync } = require('child_process');
const {
  validateCommitReferences,
  validateManifest,
} = require('../../scripts/validate-reviewer-holistic-evaluation-manifest');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function frozenManifest() {
  const manifest = clone(draftManifest);
  const proposalIds = Array.from({ length: 10 }, (_, index) => `proposal-${index + 1}`);
  manifest.status = 'frozen';
  manifest.baseline.commit = 'a'.repeat(40);
  manifest.redesign.startingCommit = 'b'.repeat(40);
  manifest.redesign.pipelineVersion = 'reviewer-holistic/v1';
  manifest.identityBenchmark.fixtureVersion = 'identity-fixtures/v1';
  manifest.proposalEvaluation.proposalIds = proposalIds;
  manifest.proposalEvaluation.documentHashes = Object.fromEntries(
    proposalIds.map((id, index) => [id, String(index % 10).repeat(64)]),
  );
  manifest.runtimeConfig = {
    promptRowId: 'reviewer-analyze',
    promptVersion: 'v1',
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
  test('tracked draft is structurally valid but not frozen', () => {
    expect(validateManifest(draftManifest)).toEqual({ ok: true, errors: [] });
    const frozenCheck = validateManifest(draftManifest, { requireFrozen: true });
    expect(frozenCheck.ok).toBe(false);
    expect(frozenCheck.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'status' }),
      expect.objectContaining({ path: 'baseline.commit' }),
      expect.objectContaining({ path: 'proposalEvaluation.proposalIds' }),
    ]));
  });

  test('complete frozen manifest passes the hard precondition', () => {
    expect(validateManifest(frozenManifest(), { requireFrozen: true })).toEqual({ ok: true, errors: [] });
  });

  test('manifest rejects an adjudicator under the single-reviewer policy', () => {
    const manifest = clone(draftManifest);
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
    const manifest = clone(draftManifest);
    manifest.clientMaySelectArm = true;
    expect(validateManifest(manifest).errors).toContainEqual({
      path: 'clientMaySelectArm',
      message: 'unknown top-level field',
    });
  });

  test('unknown nested freeze fields fail closed', () => {
    const manifest = clone(draftManifest);
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
});
