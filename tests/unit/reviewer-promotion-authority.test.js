/** @jest-environment node */

const {
  REQUIRED_STAGES,
  STAGE_CONTRACT_VERSIONS,
  getCandidatePromotionAuthority,
} = require('../../lib/services/reviewer-promotion-authority');

const CHECKED_AT = '2026-08-02T00:00:00.000Z';
const REQUEST_ID = '11111111-1111-1111-1111-111111111111';
const CANDIDATE_KEY = 'suggestion:33333333-3333-3333-3333-333333333333';
const GENERIC_DATAVERSE_GUID = '17e1c7ae-c844-f111-88b5-000d3a3065b8';

function authority() {
  return {
    authorityState: 'current',
    requestId: REQUEST_ID,
    candidateKey: CANDIDATE_KEY,
    versions: Object.fromEntries(REQUIRED_STAGES.map((stage) => [stage, `${stage}-source-v1`])),
  };
}

function candidate(overrides = {}) {
  const currentAuthority = authority();
  return {
    candidateKey: CANDIDATE_KEY,
    rosterStatus: 'active',
    stageFreshness: Object.fromEntries(REQUIRED_STAGES.map((stage) => [stage, {
      state: 'current',
      contractVersion: STAGE_CONTRACT_VERSIONS[stage],
      sourceVersion: currentAuthority.versions[stage],
      resultVersion: `${stage}-result-v1`,
      completedAt: CHECKED_AT,
    }])),
    identityDecision: 'confirmed',
    coauthorCheckStatus: 'complete',
    coauthorCheckFailures: [],
    eligibilityCheckStatus: 'complete',
    eligibilityStatus: 'unknown',
    emailAction: 'ready',
    addressTrustStatus: 'quick_check',
    ...overrides,
  };
}

function serverDecision(row, snapshot = authority()) {
  return getCandidatePromotionAuthority(row, {
    serverAuthoritative: true,
    authoritative: snapshot,
    requestId: REQUEST_ID,
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

  const missingResult = candidate({
    stageFreshness: {
      ...candidate().stageFreshness,
      contact: {
        ...candidate().stageFreshness.contact,
        resultVersion: '',
      },
    },
  });
  expect(serverDecision(missingResult)).toMatchObject({ code: 'stage_authority_stale', stage: 'contact' });
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

test('allows only matching server-issued complete-negative coauthor N/A receipts', () => {
  const snapshot = authority();
  const row = candidate({
    stageFreshness: {
      ...candidate().stageFreshness,
      coauthor_coi: {
        state: 'not_applicable',
        reasonCode: 'no_proposal_authors',
        contractVersion: STAGE_CONTRACT_VERSIONS.coauthor_coi,
        sourceVersion: snapshot.versions.coauthor_coi,
        resultVersion: 'coauthor-na-result-v1',
        completedAt: CHECKED_AT,
      },
    },
    coauthorCheckStatus: 'not_applicable',
  });
  expect(serverDecision(row, snapshot)).toMatchObject({ decision: 'ready' });

  expect(serverDecision({
    ...row,
    stageFreshness: {
      ...row.stageFreshness,
      coauthor_coi: { ...row.stageFreshness.coauthor_coi, reasonCode: 'client_not_applicable' },
    },
  }, snapshot)).toMatchObject({ code: 'stage_authority_missing', stage: 'coauthor_coi' });
});

test('current non-authoritative identity and its downstream N/A receipts remain non-promotable', () => {
  const snapshot = authority();
  const row = candidate({
    identityDecision: 'ambiguous',
    stageFreshness: {
      ...candidate().stageFreshness,
      institution_domains: {
        ...candidate().stageFreshness.institution_domains,
        state: 'not_applicable',
        reasonCode: 'identity_not_authoritative',
      },
      institution_coi: {
        ...candidate().stageFreshness.institution_coi,
        state: 'not_applicable',
        reasonCode: 'identity_not_authoritative',
      },
      coauthor_coi: {
        ...candidate().stageFreshness.coauthor_coi,
        state: 'not_applicable',
        reasonCode: 'identity_not_authoritative',
      },
      eligibility: {
        ...candidate().stageFreshness.eligibility,
        state: 'not_applicable',
        reasonCode: 'identity_not_authoritative',
      },
      contact: {
        ...candidate().stageFreshness.contact,
        state: 'not_applicable',
        reasonCode: 'identity_not_authoritative',
      },
      address_trust: {
        ...candidate().stageFreshness.address_trust,
        state: 'not_applicable',
        reasonCode: 'identity_not_authoritative',
      },
    },
  });

  expect(serverDecision(row, snapshot)).toMatchObject({
    code: 'identity_not_authoritative',
    stage: 'identity',
  });
});

test('keeps a server-attested generic Dataverse person GUID promotion-authoritative', () => {
  const row = candidate({
    identityDecision: null,
    identityEvidence: {
      staffConfirmation: {
        state: 'confirmed',
        canonicalPersonId: GENERIC_DATAVERSE_GUID,
        canonicalPersonEtag: 'W/"dataverse-person-v1"',
        actorId: 'staff-1',
        confirmedAt: CHECKED_AT,
      },
    },
  });

  expect(serverDecision(row)).toMatchObject({ decision: 'ready' });
});

test('complete negative contact evidence never becomes promotion authority', () => {
  const snapshot = authority();
  const row = candidate({
    emailAction: 'missing_email',
    addressTrustStatus: 'not_applicable',
    stageFreshness: {
      ...candidate().stageFreshness,
      address_trust: {
        ...candidate().stageFreshness.address_trust,
        state: 'not_applicable',
        reasonCode: 'missing_email',
      },
    },
  });
  expect(serverDecision(row, snapshot)).toMatchObject({
    code: 'contact_not_promotable',
    stage: 'contact',
  });
});

test('unknown completed states fail closed', () => {
  const row = candidate({
    stageFreshness: {
      ...candidate().stageFreshness,
      institution_domains: { ...candidate().stageFreshness.institution_domains, state: 'mystery' },
    },
  });
  expect(serverDecision(row)).toMatchObject({
    code: 'stage_authority_unrecognized',
    stage: 'institution_domains',
  });
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
