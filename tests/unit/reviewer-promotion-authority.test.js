/** @jest-environment node */

const {
  REQUIRED_STAGES,
  STAGE_CONTRACT_VERSIONS,
  getCandidatePromotionAuthority,
} = require('../../lib/services/reviewer-promotion-authority');

const CHECKED_AT = '2026-08-02T00:00:00.000Z';

function authority() {
  return {
    authorityState: 'current',
    versions: Object.fromEntries(REQUIRED_STAGES.map((stage) => [stage, `${stage}-source-v1`])),
  };
}

function candidate(overrides = {}) {
  const currentAuthority = authority();
  return {
    candidateKey: 'suggestion:33333333-3333-3333-3333-333333333333',
    rosterStatus: 'active',
    stageFreshness: Object.fromEntries(REQUIRED_STAGES.map((stage) => [stage, {
      state: 'current',
      contractVersion: STAGE_CONTRACT_VERSIONS[stage],
      sourceVersion: currentAuthority.versions[stage],
      completedAt: CHECKED_AT,
    }])),
    coauthorCheckStatus: 'complete',
    coauthorCheckFailures: [],
    eligibilityCheckStatus: 'complete',
    eligibilityStatus: 'unknown',
    ...overrides,
  };
}

function serverDecision(row, snapshot = authority()) {
  return getCandidatePromotionAuthority(row, {
    serverAuthoritative: true,
    authoritative: snapshot,
  });
}

test('requires a complete current server snapshot, rather than trusting a current roster receipt', () => {
  expect(serverDecision(candidate(), null)).toMatchObject({
    decision: 'blocked',
    code: 'promotion_authority_unavailable',
  });
  expect(getCandidatePromotionAuthority(candidate())).toMatchObject({
    decision: 'blocked',
    code: 'promotion_authority_unavailable',
  });
});

test('requires each receipt to equal the current server-derived source version and canonical ISO timestamp', () => {
  const staleVersion = candidate({
    stageFreshness: {
      ...candidate().stageFreshness,
      contact: {
        ...candidate().stageFreshness.contact,
        sourceVersion: 'client-claimed-contact-source',
      },
    },
  });
  expect(serverDecision(staleVersion)).toMatchObject({ code: 'stage_authority_stale', stage: 'contact' });

  const nonCanonicalDate = candidate({
    stageFreshness: {
      ...candidate().stageFreshness,
      contact: {
        ...candidate().stageFreshness.contact,
        completedAt: '2026-08-02T00:00:00Z',
      },
    },
  });
  expect(serverDecision(nonCanonicalDate)).toMatchObject({ code: 'stage_authority_stale', stage: 'contact' });
});

test.each([
  ['missing', undefined, 'stage_authority_missing'],
  ['stale', { state: 'stale' }, 'stage_authority_stale'],
  ['refreshing', { state: 'refreshing' }, 'stage_authority_stale'],
  ['incomplete', { state: 'incomplete' }, 'stage_authority_incomplete'],
  ['failed', { state: 'failed' }, 'stage_authority_incomplete'],
  ['error', { state: 'error' }, 'stage_authority_incomplete'],
])('fails closed when identity authority is %s', (_label, receipt, code) => {
  const row = candidate({
    stageFreshness: {
      ...candidate().stageFreshness,
      ...(receipt === undefined ? { identity: undefined } : { identity: receipt }),
    },
  });
  expect(serverDecision(row)).toMatchObject({ code, stage: 'identity' });
});

test('allows only matching server-issued coauthor and eligibility N/A receipts', () => {
  const snapshot = authority();
  const row = candidate({
    stageFreshness: {
      ...candidate().stageFreshness,
      coauthor_coi: {
        state: 'not_applicable',
        reason: 'server_not_applicable',
        contractVersion: STAGE_CONTRACT_VERSIONS.coauthor_coi,
        sourceVersion: snapshot.versions.coauthor_coi,
        completedAt: CHECKED_AT,
      },
      eligibility: {
        state: 'not_applicable',
        reason: 'server_not_applicable',
        contractVersion: STAGE_CONTRACT_VERSIONS.eligibility,
        sourceVersion: snapshot.versions.eligibility,
        completedAt: CHECKED_AT,
      },
    },
    coauthorCheckStatus: 'not_applicable',
    eligibilityCheckStatus: 'not_applicable',
  });
  expect(serverDecision(row, snapshot)).toMatchObject({ decision: 'ready' });

  expect(serverDecision({
    ...row,
    stageFreshness: {
      ...row.stageFreshness,
      coauthor_coi: { ...row.stageFreshness.coauthor_coi, reason: 'client_not_applicable' },
    },
  }, snapshot)).toMatchObject({ code: 'stage_authority_missing', stage: 'coauthor_coi' });
});

test('requires clean completed coauthor screening and complete eligibility, while completed unknown remains eligible', () => {
  expect(serverDecision(candidate())).toMatchObject({ decision: 'ready' });
  expect(serverDecision(candidate({ coauthorCheckFailures: ['provider_timeout'] }))).toMatchObject({
    code: 'coauthor_check_incomplete',
  });
  expect(serverDecision(candidate({ coauthorCheckStatus: 'incomplete' }))).toMatchObject({
    code: 'coauthor_check_incomplete',
  });
  expect(serverDecision(candidate({ eligibilityCheckStatus: 'error' }))).toMatchObject({
    code: 'eligibility_check_incomplete',
  });
});

test('direct conflicts and eligibility exclusions block even if authority context is unavailable', () => {
  expect(serverDecision(candidate({ hasCoauthorCOI: true }), null)).toMatchObject({ code: 'coauthor_conflict' });
  expect(serverDecision(candidate({ hasInstitutionCOI: true }), null)).toMatchObject({ code: 'institution_coi' });
  expect(serverDecision(candidate({ eligibilityStatus: 'deceased' }), null)).toMatchObject({ code: 'candidate_ineligible' });
  expect(serverDecision(candidate({ rosterStatus: 'ineligible' }), null)).toMatchObject({ code: 'roster_status_not_promotable' });
});
