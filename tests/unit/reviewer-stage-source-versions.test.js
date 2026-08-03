/** @jest-environment node */

const fs = require('fs');

const {
  CONTRACT_VERSIONS,
  STAGES,
  applicantAnchorSourceVersion,
  buildReviewerStageDependencySnapshot,
  buildRosterPersistenceReceipt,
  expiredLeaseRecoverySourceVersion,
  rosterPersistenceSourceVersion,
} = require('../../lib/services/workbench/reviewer-stage-source-versions');

const REQUEST_ID = '11111111-1111-1111-1111-111111111111';
const CANDIDATE_KEY = 'person:22222222-2222-2222-2222-222222222222';
const STORED_CANDIDATE_KEY = 'candidate:katherine%20ferrara|email:kwferrar%40stanford.edu|orcid:-|affiliation:stanford%20university';
const COMPLETED_AT = '2026-08-02T00:00:00.000Z';

function resultVersion(index) {
  return index.toString(16).repeat(64);
}

function receipt(stage, sourceVersion, index, overrides = {}) {
  return {
    state: 'current',
    contractVersion: CONTRACT_VERSIONS[stage],
    sourceVersion,
    resultVersion: resultVersion(index),
    completedAt: COMPLETED_AT,
    reasonCode: null,
    failureCode: null,
    ...overrides,
  };
}

function candidate() {
  return {
    candidateKey: CANDIDATE_KEY,
    provenance: { kind: 'proposal_named' },
    name: 'Dr. Example Reviewer',
    affiliation: 'Example University',
    potentialReviewerId: '22222222-2222-2222-2222-222222222222',
    personEtag: 'W/"person-etag-v1"',
    proposalAuthorVersion: 'a'.repeat(64),
    identityDecision: 'confirmed',
    institutionDomainEvidence: {
      inputFingerprint: 'd'.repeat(64),
      anchoredDomains: ['example.edu'],
    },
    trustedInstitutionDomains: ['example.edu'],
    email: 'reviewer@example.edu',
    emailSource: 'faculty_page',
    emailAction: 'ready',
    addressTrustStatus: 'quick_check',
    stageFreshness: {},
  };
}

test('applicant anchor accepts only the opaque server slot version', () => {
  const applicant = {
    candidateKey: 'suggestion:22222222-2222-4222-8222-222222222222',
    provenance: { kind: 'applicant_suggested' },
  };
  expect(applicantAnchorSourceVersion({ candidate: applicant, applicantInputVersion: 'applicant-input-v1' })).toBeNull();
  expect(applicantAnchorSourceVersion({ candidate: applicant, applicantInputVersion: 'a'.repeat(64) }))
    .toBe('a'.repeat(64));
});

test('expired-lease recovery source is a deterministic, server-scoped marker and rejects invalid targets', () => {
  const source = expiredLeaseRecoverySourceVersion({
    requestId: REQUEST_ID.toUpperCase(),
    candidateKey: CANDIDATE_KEY,
    stage: 'contact',
  });

  expect(source).toMatch(/^[a-f0-9]{64}$/);
  expect(source).toBe(expiredLeaseRecoverySourceVersion({
    requestId: REQUEST_ID,
    candidateKey: CANDIDATE_KEY,
    stage: 'contact',
  }));
  expect(source).not.toBe(expiredLeaseRecoverySourceVersion({
    requestId: REQUEST_ID,
    candidateKey: CANDIDATE_KEY,
    stage: 'eligibility',
  }));
  expect(expiredLeaseRecoverySourceVersion({
    requestId: 'browser-provided-request', candidateKey: CANDIDATE_KEY, stage: 'contact',
  })).toBeNull();
  expect(expiredLeaseRecoverySourceVersion({
    requestId: REQUEST_ID, candidateKey: 'candidate:browser-row', stage: 'contact',
  })).toBeNull();
  expect(expiredLeaseRecoverySourceVersion({
    requestId: REQUEST_ID, candidateKey: STORED_CANDIDATE_KEY, stage: 'contact',
  })).toMatch(/^[a-f0-9]{64}$/);
});

function completeCandidate() {
  const row = candidate();
  const requestCoiContextVersion = 'request-coi:v1';
  const proposalContentVersion = 'proposal:v1';
  const applicantAnchor = applicantAnchorSourceVersion({ candidate: row });
  row.stageFreshness.applicant_anchor = receipt('applicant_anchor', applicantAnchor, 1, {
    state: 'not_applicable',
    reasonCode: 'server_not_applicable',
  });

  let snapshot = buildReviewerStageDependencySnapshot({
    candidate: row,
    requestId: REQUEST_ID,
    proposalContentVersion,
    requestCoiContextVersion,
  });
  row.stageFreshness.identity = receipt('identity', snapshot.versions.identity, 2);
  snapshot = buildReviewerStageDependencySnapshot({ candidate: row, requestId: REQUEST_ID, proposalContentVersion, requestCoiContextVersion });
  row.stageFreshness.institution_domains = receipt('institution_domains', snapshot.versions.institution_domains, 3);
  snapshot = buildReviewerStageDependencySnapshot({ candidate: row, requestId: REQUEST_ID, proposalContentVersion, requestCoiContextVersion });
  row.stageFreshness.institution_coi = receipt('institution_coi', snapshot.versions.institution_coi, 4);
  row.stageFreshness.coauthor_coi = receipt('coauthor_coi', snapshot.versions.coauthor_coi, 5);
  snapshot = buildReviewerStageDependencySnapshot({ candidate: row, requestId: REQUEST_ID, proposalContentVersion, requestCoiContextVersion });
  row.stageFreshness.eligibility = receipt('eligibility', snapshot.versions.eligibility, 6);
  row.stageFreshness.contact = receipt('contact', snapshot.versions.contact, 7);
  snapshot = buildReviewerStageDependencySnapshot({ candidate: row, requestId: REQUEST_ID, proposalContentVersion, requestCoiContextVersion });
  row.stageFreshness.address_trust = receipt('address_trust', snapshot.versions.address_trust, 8);
  const terminal = buildRosterPersistenceReceipt({
    candidateKey: row.candidateKey,
    stageFreshness: row.stageFreshness,
    completedAt: COMPLETED_AT,
  });
  row.stageFreshness.roster_persistence = terminal;
  return { row, requestCoiContextVersion, proposalContentVersion, terminal };
}

test('derives deterministic full-stage source versions only from server-owned inputs and sealed upstream result versions', () => {
  const { row, requestCoiContextVersion, proposalContentVersion, terminal } = completeCandidate();
  const first = buildReviewerStageDependencySnapshot({
    candidate: row,
    requestId: REQUEST_ID,
    proposalContentVersion,
    requestCoiContextVersion,
  });
  const second = buildReviewerStageDependencySnapshot({
    candidate: row,
    requestId: REQUEST_ID,
    proposalContentVersion,
    requestCoiContextVersion,
  });

  expect(first).toEqual(second);
  expect(Object.keys(first.versions)).toEqual(STAGES);
  expect(Object.values(first.versions)).toEqual(expect.arrayContaining([
    expect.stringMatching(/^[a-f0-9]{64}$/),
  ]));
  expect(Object.values(first.versions).every((value) => /^[a-f0-9]{64}$/.test(value))).toBe(true);
  expect(first.versions.roster_persistence).toBe(terminal.sourceVersion);
  expect(first.legacyEvidenceDependencies.eligibility).toEqual(expect.objectContaining({
    institutionDomainsResultVersion: row.stageFreshness.institution_domains.resultVersion,
  }));
  expect(first.legacyEvidenceDependencies.contact).toEqual(expect.objectContaining({
    institutionDomainsResultVersion: row.stageFreshness.institution_domains.resultVersion,
  }));
});

test('missing sealed proposal-author input fails closed for coauthor and terminal source versions', () => {
  const { row, requestCoiContextVersion, proposalContentVersion } = completeCandidate();
  delete row.proposalAuthorVersion;

  const snapshot = buildReviewerStageDependencySnapshot({
    candidate: row,
    requestId: REQUEST_ID,
    proposalContentVersion,
    requestCoiContextVersion,
  });

  expect(snapshot.versions.coauthor_coi).toBeNull();
  expect(snapshot.versions.roster_persistence).toBeNull();
});

test('a legacy prose-like proposal-author marker cannot make coauthor evidence warm-current', () => {
  const { row, requestCoiContextVersion, proposalContentVersion } = completeCandidate();
  row.proposalAuthorVersion = 'proposal-authors:v1';

  const snapshot = buildReviewerStageDependencySnapshot({
    candidate: row,
    requestId: REQUEST_ID,
    proposalContentVersion,
    requestCoiContextVersion,
  });

  expect(snapshot.versions.coauthor_coi).toBeNull();
  expect(snapshot.versions.roster_persistence).toBeNull();
});

test('a producer-sealed institution input fingerprint keeps warm source parity after raw contact data is stripped', () => {
  const { row, requestCoiContextVersion, proposalContentVersion } = completeCandidate();
  const coldProjection = {
    ...row,
    contactEnrichment: {
      affiliation: 'A different unpersisted affiliation',
      tierResults: {
        orcid: {
          affiliations: [{
            current: true,
            organization: 'A different unpersisted organization',
            disambiguatedOrganizationId: 'https://ror.org/03yrm5c26',
            disambiguationSource: 'ROR',
          }],
        },
      },
    },
  };
  const warmProjection = { ...coldProjection };
  delete warmProjection.contactEnrichment;

  const cold = buildReviewerStageDependencySnapshot({
    candidate: coldProjection,
    requestId: REQUEST_ID,
    proposalContentVersion,
    requestCoiContextVersion,
  });
  const warm = buildReviewerStageDependencySnapshot({
    candidate: warmProjection,
    requestId: REQUEST_ID,
    proposalContentVersion,
    requestCoiContextVersion,
  });

  expect(cold.versions.institution_domains).toBe(warm.versions.institution_domains);
});

test('an authoritative identity without sealed institution-domain inputs fails closed for warm validation', () => {
  const { row, requestCoiContextVersion, proposalContentVersion } = completeCandidate();
  const withoutSealedInput = {
    ...row,
    institutionDomainEvidence: { anchoredDomains: ['example.edu'] },
  };
  const snapshot = buildReviewerStageDependencySnapshot({
    candidate: withoutSealedInput,
    requestId: REQUEST_ID,
    proposalContentVersion,
    requestCoiContextVersion,
  });

  expect(snapshot.versions.institution_domains).toBeNull();
  expect(snapshot.versions.eligibility).toBeNull();
  expect(snapshot.versions.contact).toBeNull();
  expect(snapshot.versions.roster_persistence).toBeNull();
});

test('permits an unsealed domain fingerprint only for the explicit pre-projection preview', () => {
  const { row, requestCoiContextVersion, proposalContentVersion } = completeCandidate();
  delete row.institutionDomainEvidence.inputFingerprint;
  row.contactEnrichment = {
    tierResults: {
      orcid: { affiliations: [{ current: true, organization: 'Example University' }] },
    },
  };
  const warm = buildReviewerStageDependencySnapshot({
    candidate: row, requestId: REQUEST_ID, proposalContentVersion, requestCoiContextVersion,
  });
  const preview = buildReviewerStageDependencySnapshot({
    candidate: row, requestId: REQUEST_ID, proposalContentVersion, requestCoiContextVersion,
    allowUnsealedDomainPreview: true,
  });

  expect(warm.versions.institution_domains).toBeNull();
  expect(preview.versions.institution_domains).toMatch(/^[a-f0-9]{64}$/);
});

test('uses only the contact-projector canonical person pair, never raw candidate person fields', () => {
  const { row, requestCoiContextVersion, proposalContentVersion } = completeCandidate();
  const raw = buildReviewerStageDependencySnapshot({
    candidate: row, requestId: REQUEST_ID, proposalContentVersion, requestCoiContextVersion,
  });
  const noRawPerson = { ...row };
  delete noRawPerson.potentialReviewerId;
  delete noRawPerson.personEtag;
  const withoutRaw = buildReviewerStageDependencySnapshot({
    candidate: noRawPerson, requestId: REQUEST_ID, proposalContentVersion, requestCoiContextVersion,
  });
  const projected = buildReviewerStageDependencySnapshot({
    candidate: {
      ...noRawPerson,
      canonicalPersonId: '22222222-2222-4222-8222-222222222222',
      canonicalPersonEtag: 'W/"server-read-v2"',
      personEtag: 'W/"server-read-v2"',
    },
    requestId: REQUEST_ID, proposalContentVersion, requestCoiContextVersion,
  });

  expect(raw.versions.contact).toBe(withoutRaw.versions.contact);
  expect(projected.versions.contact).not.toBe(withoutRaw.versions.contact);
});

test('keeps the source builder and domain fingerprint utility outside producer import graphs', () => {
  const sourceBuilder = fs.readFileSync(
    require.resolve('../../lib/services/workbench/reviewer-stage-source-versions'),
    'utf8',
  );
  const fingerprint = fs.readFileSync(
    require.resolve('../../lib/services/workbench/institution-domain-input-fingerprint'),
    'utf8',
  );

  expect(sourceBuilder).not.toMatch(/reviewer-stage-producers/);
  expect(fingerprint).not.toMatch(/reviewer-stage-producers|contact-enrichment/);
});

test('terminal helper rejects incomplete, unknown, malformed-completed, or result-versionless upstream evidence', () => {
  const { row } = completeCandidate();
  const incomplete = { ...row.stageFreshness, contact: { ...row.stageFreshness.contact, state: 'failed', completedAt: null } };
  const unknown = { ...row.stageFreshness, eligibility: { ...row.stageFreshness.eligibility, state: 'mystery' } };
  const missingResult = { ...row.stageFreshness, address_trust: { ...row.stageFreshness.address_trust, resultVersion: '' } };
  const explainedCurrent = { ...row.stageFreshness, identity: { ...row.stageFreshness.identity, reasonCode: 'provider prose' } };
  const malformedNa = {
    ...row.stageFreshness,
    applicant_anchor: { ...row.stageFreshness.applicant_anchor, reasonCode: 'unrecognized_reason' },
  };
  const naWithFailure = {
    ...row.stageFreshness,
    applicant_anchor: { ...row.stageFreshness.applicant_anchor, failureCode: 'retryable_failure' },
  };

  for (const stageFreshness of [incomplete, unknown, missingResult, explainedCurrent, malformedNa, naWithFailure]) {
    expect(buildRosterPersistenceReceipt({ candidateKey: CANDIDATE_KEY, stageFreshness, completedAt: COMPLETED_AT })).toBeNull();
    expect(rosterPersistenceSourceVersion({ candidateKey: CANDIDATE_KEY, stageFreshness })).toBeNull();
  }
});
