/**
 * @jest-environment node
 */

const fs = require('fs');
const path = require('path');
const {
  buildArtifact,
  markdown,
} = require('../../../benchmarks/institution-pair-consistency/run-unresolved-smoke');

const FIXTURE = path.join(
  process.cwd(),
  'benchmarks/institution-pair-consistency/smoke/unresolved-25-2026-08-18.json',
);

function loadFixture() {
  return JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
}

describe('frozen 25-case unresolved institution smoke', () => {
  test('has the frozen population split and no retained direct identifiers', () => {
    const fixture = loadFixture();
    expect(fixture.cases).toHaveLength(25);
    expect(fixture.cases.filter((row) => row.caseKind === 'institution_pair')).toHaveLength(15);
    expect(fixture.cases.filter((row) => row.caseKind === 'insufficient_pair_evidence')).toHaveLength(10);
    expect(new Set(fixture.cases.map((row) => row.caseId)).size).toBe(25);

    const serialized = JSON.stringify(fixture);
    expect(serialized).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(serialized).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    expect(serialized).not.toContain('candidate_key');
    expect(serialized).not.toContain('request_id');
  });

  test('shadow comparison eliminates six manufactured reviews without an unsafe clear', () => {
    const artifact = buildArtifact(loadFixture());
    expect(artifact.authority).toBe('shadow_only_not_wired_to_production');
    expect(artifact.summary).toMatchObject({
      totalCases: 25,
      expectedAutoClears: 8,
      beforeAutoClears: 0,
      proposedAutoClears: 6,
      manufacturedReviewsBefore: 8,
      manufacturedReviewsRemaining: 2,
      unsafeProposedAutoClears: 0,
      surfacedWithoutRemedy: 0,
      expectedDispositionMatches: 23,
    });
    expect(artifact.rows.filter((row) => row.unsafeAutoClear)).toEqual([]);
    expect(artifact.rows.filter((row) => !row.actionableIfSurfaced)).toEqual([]);
  });

  test('readable report states the shadow boundary and both safety gates', () => {
    const report = markdown(buildArtifact(loadFixture()));
    expect(report).toContain('shadow only; not wired to production authority');
    expect(report).toContain('Unsafe proposed automatic clears: **0**');
    expect(report).toContain('Surfaced cases without a remedy: **0**');
    expect(report).toContain('unresolved-f9b213526332');
  });
});
