/**
 * @jest-environment node
 *
 * Pins the safety logic of the manual reviewer-binding production smoke
 * (scripts/smoke-reviewer-binding.js) without any live writes: the frozen
 * job payload (repeat + opted-out + no board identity), whole-second event
 * timestamps, the clean-init precondition, the Wave 13 assertion set (a
 * legacy-fallback run must FAIL), the acceptance-email negative assertion,
 * and the no-cleanup-while-active rule.
 */
import {
  assertApprovedRequest,
  assertCleanInitRow,
  assertDrainAttribution,
  assertJobOutcome,
  assertWave13Binding,
  buildSmokeJobArgs,
  buildSmokeKey,
  canCleanup,
  isWholeSecondIso,
  parsePopulationCounts,
  secondEqual,
  wholeSecondIso,
} from '../../scripts/lib/smoke-reviewer-binding-core.js';

const ORCID = '0000-0002-1825-0097';
const ACCEPTED_AT = '2026-07-14T10:00:00.000Z';
const SUGGESTION = { wmkf_appreviewersuggestionid: '11111111-1111-4111-8111-111111111111', wmkf_accepted: true };
const REVIEWER = { wmkf_potentialreviewersid: '33333333-3333-4333-8333-333333333333' };

function unboundPersonRow(overrides = {}) {
  return {
    _etag: 'W/"1"',
    wmkf_identitybindingversion: null,
    wmkf_identitybindingsource: null,
    wmkf_identitybindinganchor: null,
    wmkf_identityboundat: null,
    wmkf_identityderivedbindingversion: null,
    wmkf_identityfieldlineagejson: null,
    wmkf_googlescholarid: null,
    wmkf_googlescholarurl: null,
    wmkf_hindex: null,
    wmkf_i10index: null,
    wmkf_totalcitations: null,
    wmkf_orcid: null,
    wmkf_orcidurl: null,
    ...overrides,
  };
}

// The person row exactly as Dataverse returns it after a successful durable
// init: second-precision timestamps (no fractional part on round-trip).
function boundPersonRow(overrides = {}) {
  return {
    ...unboundPersonRow(),
    wmkf_identitybindingversion: 1,
    wmkf_identitybindingsource: 'self_reported',
    wmkf_identitybindinganchor: `orcid:${ORCID}`,
    wmkf_identityboundat: '2026-07-14T10:00:00Z',
    wmkf_identityderivedbindingversion: null,
    wmkf_identityfieldlineagejson: JSON.stringify({
      schemaVersion: 1,
      fields: {
        wmkf_orcid: { source: 'self_reported', bindingVersion: 1 },
        wmkf_orcidurl: { source: 'self_reported', bindingVersion: 1 },
      },
    }),
    wmkf_orcid: ORCID,
    wmkf_orcidurl: `https://orcid.org/${ORCID}`,
    wmkf_identitystatus: 'confirmed',
    wmkf_identityconfidenceband: 'high',
    wmkf_identityresolverversion: 'self-report@accept',
    wmkf_identityresolvedat: '2026-07-14T10:00:00Z',
    wmkf_identityevidencesummary: 'Reviewer self-confirmed this ORCID on the authenticated invitation form (magic-link).',
    wmkf_identityverifiedanchorsjson: JSON.stringify([{
      type: 'self_reported_orcid',
      canonicalKey: `orcid:${ORCID}`,
      sourceUrl: `https://orcid.org/${ORCID}`,
      verifier: 'reviewerSelfReport@self-report@accept',
    }]),
    ...overrides,
  };
}

describe('whole-second event timestamps', () => {
  test('wholeSecondIso floors milliseconds to .000Z', () => {
    expect(wholeSecondIso(new Date('2026-07-14T10:00:00.347Z'))).toBe(ACCEPTED_AT);
    expect(wholeSecondIso(new Date('2026-07-14T10:00:00.999Z'))).toBe(ACCEPTED_AT);
  });

  test('isWholeSecondIso accepts .000Z and bare-second forms, rejects fractional', () => {
    expect(isWholeSecondIso(ACCEPTED_AT)).toBe(true);
    expect(isWholeSecondIso('2026-07-14T10:00:00Z')).toBe(true);
    expect(isWholeSecondIso('2026-07-14T10:00:00.347Z')).toBe(false);
    expect(isWholeSecondIso('not-a-date')).toBe(false);
  });

  test('secondEqual compares at Dataverse storage fidelity', () => {
    expect(secondEqual('2026-07-14T10:00:00Z', ACCEPTED_AT)).toBe(true);
    expect(secondEqual('2026-07-14T10:00:01Z', ACCEPTED_AT)).toBe(false);
    expect(secondEqual(null, ACCEPTED_AT)).toBe(false);
  });
});

describe('buildSmokeJobArgs', () => {
  const args = () => buildSmokeJobArgs({
    acceptanceKey: 'smoke-key',
    acceptedAt: ACCEPTED_AT,
    suggestion: SUGGESTION,
    request: { akoya_requestid: 'r-1' },
    reviewer: REVIEWER,
    orcid: ORCID,
  });

  test('freezes the side-effect-excluding payload shape', () => {
    const built = args();
    expect(built).toMatchObject({
      isAcceptRepeat: true,
      optedOut: true,
      status: 'queued',
      acceptOrcidRaw: ORCID,
      acks: null,
      body: { honorariumOptOut: true },
    });
    // The board-identity capture must see NO key at all → nothing_to_write.
    expect(built.body).not.toHaveProperty('boardIdentity');
    expect(built.body).not.toHaveProperty('address');
    expect(built.body).not.toHaveProperty('contactEdits');
  });

  test('rejects a millisecond-bearing acceptedAt (replay identity would not round-trip)', () => {
    expect(() => buildSmokeJobArgs({
      acceptanceKey: 'k',
      acceptedAt: '2026-07-14T10:00:00.347Z',
      suggestion: SUGGESTION,
      reviewer: REVIEWER,
      orcid: ORCID,
    })).toThrow(/whole-second/);
  });

  test.each([
    ['acceptanceKey', { acceptanceKey: null }],
    ['suggestion id', { suggestion: {} }],
    ['reviewer id', { reviewer: {} }],
    ['orcid', { orcid: '' }],
  ])('rejects a missing %s', (_label, override) => {
    expect(() => buildSmokeJobArgs({
      acceptanceKey: 'k',
      acceptedAt: ACCEPTED_AT,
      suggestion: SUGGESTION,
      reviewer: REVIEWER,
      orcid: ORCID,
      ...override,
    })).toThrow();
  });
});

describe('assertCleanInitRow', () => {
  test('passes a fully unbound clean row', () => {
    expect(assertCleanInitRow(unboundPersonRow())).toEqual({ ok: true, problems: [] });
  });

  test('fails when a binding field is populated', () => {
    const out = assertCleanInitRow(unboundPersonRow({ wmkf_identitybindingversion: 1 }));
    expect(out.ok).toBe(false);
    expect(out.problems.join(' ')).toContain('wmkf_identitybindingversion');
  });

  test('fails when a legacy identity value would trigger the typed fallback', () => {
    const out = assertCleanInitRow(unboundPersonRow({ wmkf_hindex: 12 }));
    expect(out.ok).toBe(false);
    expect(out.problems.join(' ')).toContain('legacy_classification_required');
  });

  test('fails when lineage JSON exists without a binding', () => {
    const out = assertCleanInitRow(unboundPersonRow({ wmkf_identityfieldlineagejson: '{}' }));
    expect(out.ok).toBe(false);
  });
});

describe('assertWave13Binding', () => {
  test('passes the exact persisted first self_reported binding', () => {
    expect(assertWave13Binding(boundPersonRow(), { orcid: ORCID, acceptedAt: ACCEPTED_AT }))
      .toEqual({ ok: true, problems: [] });
  });

  test('FAILS a legacy-fallback row (legacy ORCID written, no binding) — the false-confidence mode', () => {
    const legacyOnly = unboundPersonRow({
      wmkf_orcid: ORCID,
      wmkf_orcidurl: `https://orcid.org/${ORCID}`,
      wmkf_identitystatus: 'confirmed',
    });
    const out = assertWave13Binding(legacyOnly, { orcid: ORCID, acceptedAt: ACCEPTED_AT });
    expect(out.ok).toBe(false);
    expect(out.problems.join(' ')).toContain('transitional fallback');
  });

  test('fails a version bump (retry did not replay as a no-op)', () => {
    const out = assertWave13Binding(boundPersonRow({ wmkf_identitybindingversion: 2 }), { orcid: ORCID, acceptedAt: ACCEPTED_AT });
    expect(out.ok).toBe(false);
    expect(out.problems.join(' ')).toContain('expected 1');
  });

  test.each([
    ['wrong source', { wmkf_identitybindingsource: 'automated' }],
    ['wrong anchor', { wmkf_identitybindinganchor: 'orcid:0000-0001-5109-3700' }],
    ['boundAt off by a second', { wmkf_identityboundat: '2026-07-14T10:00:01Z' }],
    ['derived version set', { wmkf_identityderivedbindingversion: 1 }],
    ['lineage drift', { wmkf_identityfieldlineagejson: JSON.stringify({ schemaVersion: 1, fields: { wmkf_orcid: { source: 'automated', bindingVersion: 1 }, wmkf_orcidurl: { source: 'automated', bindingVersion: 1 } } }) }],
    ['non-confirmed decision', { wmkf_identitystatus: 'probable' }],
    ['wrong resolver version', { wmkf_identityresolverversion: 'resolver@1' }],
    ['missing evidence summary', { wmkf_identityevidencesummary: null }],
    ['drifted evidence summary', { wmkf_identityevidencesummary: 'confirmed — resolver evidence' }],
    ['missing anchors JSON', { wmkf_identityverifiedanchorsjson: null }],
    ['anchors for a different ORCID', { wmkf_identityverifiedanchorsjson: JSON.stringify([{ type: 'self_reported_orcid', canonicalKey: 'orcid:0000-0001-5109-3700', sourceUrl: 'https://orcid.org/0000-0001-5109-3700', verifier: 'reviewerSelfReport@self-report@accept' }]) }],
  ])('fails on %s', (_label, override) => {
    expect(assertWave13Binding(boundPersonRow(override), { orcid: ORCID, acceptedAt: ACCEPTED_AT }).ok).toBe(false);
  });

  test.each([
    ['wmkf_googlescholarid', 'abc123'],
    ['wmkf_googlescholarurl', 'https://scholar.google.com/citations?user=abc123'],
    ['wmkf_hindex', 12],
    ['wmkf_i10index', 3],
    ['wmkf_totalcitations', 400],
  ])('fails when untouched identity field %s was written', (field, value) => {
    const out = assertWave13Binding(boundPersonRow({ [field]: value }), { orcid: ORCID, acceptedAt: ACCEPTED_AT });
    expect(out.ok).toBe(false);
    expect(out.problems.join(' ')).toContain(field);
  });
});

describe('assertApprovedRequest — double-entry fixture authorization', () => {
  const APPROVED = '22222222-2222-4222-8222-222222222222';

  test('passes when the resolved GUID equals the approval (case-insensitive)', () => {
    expect(assertApprovedRequest(APPROVED.toUpperCase(), APPROVED)).toEqual({ ok: true, problems: [] });
  });

  test('fails when the resolved request differs from the approval', () => {
    const out = assertApprovedRequest('99999999-9999-4999-8999-999999999999', APPROVED);
    expect(out.ok).toBe(false);
    expect(out.problems.join(' ')).toContain('unapproved request');
  });

  test.each([
    ['missing', undefined],
    ['not a GUID', 'REQ-123'],
    ['empty', ''],
  ])('fails when the approval id is %s', (_label, approved) => {
    expect(assertApprovedRequest(APPROVED, approved).ok).toBe(false);
  });
});

describe('assertDrainAttribution — blocking deployed-cron attribution', () => {
  test('passes with a bracketing run and an attested deployment', () => {
    expect(assertDrainAttribution({ bracketingRuns: 1, totalRuns: 3, expectDeployment: '38640dd7' }))
      .toEqual({ ok: true, problems: [] });
  });

  test('fails with zero maintenance runs in the window', () => {
    const out = assertDrainAttribution({ bracketingRuns: 0, totalRuns: 0, expectDeployment: '38640dd7' });
    expect(out.ok).toBe(false);
    expect(out.problems.join(' ')).toContain('cannot be attributed');
  });

  test('fails when runs exist but none bracket the job completion', () => {
    const out = assertDrainAttribution({ bracketingRuns: 0, totalRuns: 4, expectDeployment: '38640dd7' });
    expect(out.ok).toBe(false);
    expect(out.problems.join(' ')).toContain('bracket');
  });

  test('fails without an attested deployment', () => {
    expect(assertDrainAttribution({ bracketingRuns: 1, totalRuns: 1, expectDeployment: '' }).ok).toBe(false);
  });
});

describe('assertJobOutcome', () => {
  test('passes a completed job with no acceptance-confirmation step', () => {
    expect(assertJobOutcome({ status: 'completed', steps: {} })).toEqual({ ok: true, problems: [] });
  });

  test('fails when the email step engaged — negative assertion backed by the dangerous input', () => {
    const out = assertJobOutcome({
      status: 'completed',
      steps: { acceptance_confirmation: { claimedAt: '2026-07-14T10:02:00.000Z' } },
    });
    expect(out.ok).toBe(false);
    expect(out.problems.join(' ')).toContain('acceptance_confirmation');
  });

  test('fails a failed job and surfaces last_error', () => {
    const out = assertJobOutcome({ status: 'failed', last_error: 'boom', steps: {} });
    expect(out.ok).toBe(false);
    expect(out.problems.join(' ')).toContain('boom');
  });

  test('parses string-typed steps columns', () => {
    const out = assertJobOutcome({ status: 'completed', steps: JSON.stringify({ acceptance_confirmation: { sentAt: 'x' } }) });
    expect(out.ok).toBe(false);
  });
});

describe('cleanup guard', () => {
  test.each([
    ['accept_pending', false],
    ['queued', false],
    ['completed', true],
    ['failed', true],
    ['cancelled', true],
  ])('status %s → canCleanup %s', (status, expected) => {
    expect(canCleanup({ status })).toBe(expected);
  });

  test('no job → no cleanup', () => {
    expect(canCleanup(null)).toBe(false);
  });
});

describe('parsePopulationCounts', () => {
  test('parses the preflight population snapshot lines', () => {
    const stdout = [
      'Wave 13 population snapshot (target=prod):',
      '  wmkf_potentialreviewers: 0 row(s) with any Wave 13 field non-null.',
      '  wmkf_appreviewersuggestion: 2 row(s) with any Wave 13 field non-null.',
    ].join('\n');
    expect(parsePopulationCounts(stdout)).toEqual({
      wmkf_potentialreviewers: 0,
      wmkf_appreviewersuggestion: 2,
    });
  });

  test('returns null when the snapshot section is absent', () => {
    expect(parsePopulationCounts('Summary: 0 absent, 10 exact, 0 divergent.')).toBeNull();
  });
});

describe('buildSmokeKey', () => {
  test('is unique per second and carries the source tag', () => {
    const key = buildSmokeKey(new Date('2026-07-14T10:00:00.000Z'));
    expect(key).toBe('smoke-reviewer-binding-20260714100000');
  });
});
