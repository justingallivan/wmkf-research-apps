/** @jest-environment node */

import { SignJWT } from 'jose';
import crypto from 'crypto';

import {
  buildApplicantAnchorRefreshReceipt,
  deriveReviewerPromotionAuthoritySnapshot,
  projectApplicantWarmInputs,
  readReviewerWarmValidation,
  resolveReviewerProposalMetadata,
  opaqueVersion,
} from '../../lib/services/workbench/reviewer-warm-validation-service';
import { CONTRACT_VERSIONS, STAGES } from '../../lib/services/reviewer-stage-freshness';
import {
  applicantAnchorSourceVersion,
  buildReviewerStageDependencySnapshot,
  buildRosterPersistenceReceipt,
} from '../../lib/services/workbench/reviewer-stage-source-versions';
import { getCandidatePromotionAuthority } from '../../lib/services/reviewer-promotion-authority';
import { GraphService } from '../../lib/services/graph-service';
import { ReviewerIdentityRuntime } from '../../lib/services/reviewer-identity-runtime';
import * as coauthorCoi from '../../lib/services/discovery/coauthor-coi';
import * as reviewerRosterStore from '../../lib/services/reviewer-roster-store';
import {
  identityAttestationProjection,
  legacyIdentityAttestationProjection,
} from '../../lib/services/reviewer-candidate-attestation';
import fs from 'fs';

const REQUEST_ID = '11111111-1111-1111-1111-111111111111';

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('base64url');
}

// Katherine's production receipt shape is v2: identity and eligibility are
// bound, but the later contact digest did not yet exist. Keep the fixture
// historical rather than minting today's v4 token so the warm bridge covers
// the actual pre-migration row without broadening promotion authority.
async function mintHistoricalV2Attestation(candidate, {
  issuedAt = '2026-07-29T00:00:00.000Z',
  alg = 'HS256',
} = {}) {
  const issuedAtSeconds = Date.parse(issuedAt) / 1000;
  const identity = identityAttestationProjection(candidate);
  return new SignJWT({
    typ: 'reviewer-auto-identity',
    requestId: REQUEST_ID,
    candidateKey: identity.candidateKey,
    rosterCandidateKey: candidate.candidateKey,
    projectionVersion: 2,
    baseIdentityDigest: digest(legacyIdentityAttestationProjection(candidate)),
    identityDigest: digest(identity),
    eligibilityStatus: 'unknown',
    eligibilityDigest: digest({ status: 'unknown', reason: null, evidence: null }),
  })
    .setProtectedHeader({ alg, typ: 'JWT' })
    .setIssuedAt(issuedAtSeconds)
    .setExpirationTime(issuedAtSeconds + (14 * 24 * 60 * 60))
    .sign(new TextEncoder().encode(process.env.NEXTAUTH_SECRET));
}

function katherinePersistedLegacyCandidate() {
  return {
    candidateKey: 'candidate:katherine-ferrara|email:kwferrar%40stanford.edu|orcid:0000-0002-1825-0097|affiliation:stanford-university',
    rosterStatus: 'active',
    stageFreshness: null,
    stageRefresh: null,
    // This is injected by reviewer-roster-store from the active Postgres row,
    // not stored in the candidate JSON supplied by a browser.
    rosterUpdatedAt: '2026-07-29 18:21:00.929+00',
    provenance: { kind: 'literature_retrieved' },
    name: 'Katherine Ferrara',
    // Production has a legacy top-level label while the nested resolver is
    // the current contact authority. The fallback must use the latter.
    identityStatus: 'verified',
    orcid: '0000-0002-1825-0097',
    email: 'kwferrar@stanford.edu',
    emailSource: 'scholarly_multi',
    emailPersistAllowed: true,
    contactEnrichment: {
      email: 'kwferrar@stanford.edu',
      emailSource: 'scholarly_multi',
      emailPersistAllowed: true,
      dataverseContactEvidence: {
        status: 'known',
        matchKey: 'orcid',
        checkedAt: '2026-07-29T18:20:56.724Z',
      },
      identity: {
        status: 'probable',
        resolverVersion: 'works-first-v1',
        resolvedAt: '2026-07-29T18:20:22.776Z',
      },
    },
  };
}

function request(overrides = {}) {
  return {
    akoya_requestid: REQUEST_ID,
    akoya_requestnum: '1002788',
    _wmkf_potentialreviewer1_value: '22222222-2222-2222-2222-222222222222',
    _wmkf_potentialreviewer1_value_formatted: 'Alice Applicant',
    _wmkf_projectleader_value: '33333333-3333-3333-3333-333333333333',
    _wmkf_projectleader_value_formatted: 'Pat Principal Investigator',
    _akoya_applicantid_value: '44444444-4444-4444-4444-444444444444',
    _akoya_applicantid_value_formatted: 'Example University',
    wmkf_organizationname: 'Example University',
    wmkf_excludedreviewers: 'Exclude Jane Example because of a collaboration.',
    ...overrides,
  };
}

function metadata(overrides = {}) {
  return {
    driveId: 'drive-1',
    id: 'item-1',
    eTag: 'etag-1',
    versionId: 'version-1',
    lastModified: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function buckets(...entries) {
  return entries.length ? entries : [{ library: 'akoya_request', folder: 'Request/1002788', source: 'dynamics' }];
}

function metadataDeps({ entries = new Map(), bucketList = buckets() } = {}) {
  const getFileMetadataByPath = jest.fn(async (library, folder, filename) => (
    entries.get(`${library}::${folder}::${filename}`) || null
  ));
  return {
    getRequestSharePointBuckets: jest.fn(async () => bucketList),
    getFileMetadataByPath,
  };
}

function currentReceipt(stage, sourceVersion, index, overrides = {}) {
  return {
    state: 'current',
    contractVersion: CONTRACT_VERSIONS[stage],
    sourceVersion,
    resultVersion: index.toString(16).repeat(64),
    completedAt: '2026-08-02T00:00:00.000Z',
    reasonCode: null,
    failureCode: null,
    ...overrides,
  };
}

function completePromotionCandidate({ proposalContentVersion, requestCoiContextVersion }) {
  const candidate = {
    candidateKey: 'person:55555555-5555-4555-8555-555555555555',
    rosterStatus: 'active',
    rosterUpdatedAt: 'roster-v1',
    provenance: { kind: 'proposal_named' },
    name: 'Dr. Complete Reviewer',
    affiliation: 'Example University',
    canonicalPersonId: '55555555-5555-4555-8555-555555555555',
    personEtag: 'W/"person-v1"',
    proposalContentVersion,
    proposalAuthorVersion: 'a'.repeat(64),
    identityDecision: 'confirmed',
    institutionDomainEvidence: { inputFingerprint: 'd'.repeat(64), anchoredDomains: ['example.edu'] },
    trustedInstitutionDomains: ['example.edu'],
    coauthorCheckStatus: 'complete',
    coauthorCheckFailures: [],
    eligibilityCheckStatus: 'complete',
    eligibilityStatus: 'unknown',
    email: 'reviewer@example.edu',
    emailSource: 'faculty_page',
    emailAction: 'ready',
    addressTrustStatus: 'quick_check',
    warmCacheVersion: 1,
    stageFreshness: {},
  };
  const anchorVersion = applicantAnchorSourceVersion({ candidate });
  candidate.stageFreshness.applicant_anchor = currentReceipt('applicant_anchor', anchorVersion, 1, {
    state: 'not_applicable', reasonCode: 'server_not_applicable',
  });
  let snapshot = buildReviewerStageDependencySnapshot({
    candidate,
    requestId: REQUEST_ID,
    proposalContentVersion,
    requestCoiContextVersion,
  });
  candidate.stageFreshness.identity = currentReceipt('identity', snapshot.versions.identity, 2);
  snapshot = buildReviewerStageDependencySnapshot({ candidate, requestId: REQUEST_ID, proposalContentVersion, requestCoiContextVersion });
  candidate.stageFreshness.institution_domains = currentReceipt('institution_domains', snapshot.versions.institution_domains, 3);
  snapshot = buildReviewerStageDependencySnapshot({ candidate, requestId: REQUEST_ID, proposalContentVersion, requestCoiContextVersion });
  candidate.stageFreshness.institution_coi = currentReceipt('institution_coi', snapshot.versions.institution_coi, 4);
  candidate.stageFreshness.coauthor_coi = currentReceipt('coauthor_coi', snapshot.versions.coauthor_coi, 5);
  snapshot = buildReviewerStageDependencySnapshot({ candidate, requestId: REQUEST_ID, proposalContentVersion, requestCoiContextVersion });
  candidate.stageFreshness.eligibility = currentReceipt('eligibility', snapshot.versions.eligibility, 6);
  candidate.stageFreshness.contact = currentReceipt('contact', snapshot.versions.contact, 7);
  snapshot = buildReviewerStageDependencySnapshot({ candidate, requestId: REQUEST_ID, proposalContentVersion, requestCoiContextVersion });
  candidate.stageFreshness.address_trust = currentReceipt('address_trust', snapshot.versions.address_trust, 8);
  candidate.stageFreshness.roster_persistence = buildRosterPersistenceReceipt({
    candidateKey: candidate.candidateKey,
    stageFreshness: candidate.stageFreshness,
    completedAt: '2026-08-02T00:00:00.000Z',
  });
  return candidate;
}

test('promotion authority rejects a non-GUID request before any authority read', async () => {
  const getRequestById = jest.fn();
  const result = await deriveReviewerPromotionAuthoritySnapshot({
    requestId: 'not-a-request-guid',
    candidate: { candidateKey: 'person:canonical-reviewer' },
    deps: { getRequestById },
  });

  expect(result).toEqual({
    authorityState: 'stale', requestId: null, candidateKey: null, versions: {},
  });
  expect(getRequestById).not.toHaveBeenCalled();
});

test('a non-stage malformed lease makes an otherwise current promotion snapshot unavailable', async () => {
  const deps = {
    ...metadataDeps({ entries: new Map([[
      'akoya_request::Request/1002788/Reviewer Materials::Proposal_1002788.pdf', metadata(),
    ]]) }),
    getRequestById: jest.fn(async () => request()),
  };
  const seed = await deriveReviewerPromotionAuthoritySnapshot({
    requestId: REQUEST_ID,
    candidate: {
      candidateKey: 'person:55555555-5555-4555-8555-555555555555',
      provenance: { kind: 'proposal_named' },
      name: 'Dr. Complete Reviewer',
      affiliation: 'Example University',
    },
    deps,
  });
  const candidate = completePromotionCandidate({
    proposalContentVersion: seed.proposalContentVersion,
    requestCoiContextVersion: seed.requestCoiContextVersion,
  });
  const current = await deriveReviewerPromotionAuthoritySnapshot({ requestId: REQUEST_ID, candidate, deps });
  expect(current).toMatchObject({ authorityState: 'current', plan: { cacheOutcome: 'hit' } });

  const malformedLeaseCandidate = { ...candidate, stageRefresh: { historical: 'corrupt-lease' } };
  const blocked = await deriveReviewerPromotionAuthoritySnapshot({
    requestId: REQUEST_ID,
    candidate: malformedLeaseCandidate,
    deps,
  });

  expect(blocked).toMatchObject({
    authorityState: 'stale',
    plan: { leaseRepairRequired: true, promotionAuthority: 'blocked_refresh_required' },
  });
  expect(blocked.plan.cacheOutcome).not.toBe('hit');
  expect(getCandidatePromotionAuthority(malformedLeaseCandidate, {
    serverAuthoritative: true,
    requestId: REQUEST_ID,
    authoritative: blocked,
  })).toMatchObject({ decision: 'blocked', code: 'promotion_authority_unavailable' });
});

test('uses the exact canonical reviewer path before the current-cycle fallback', async () => {
  const canonicalPath = 'akoya_request::Request/1002788/Reviewer Materials::Proposal_1002788.pdf';
  const fallbackPath = 'akoya_request::Request/1002788/Phase I::ProjectDescription.pdf';
  const deps = metadataDeps({ entries: new Map([[canonicalPath, metadata()], [fallbackPath, metadata({ id: 'fallback' })]]) });

  const result = await resolveReviewerProposalMetadata({
    requestId: REQUEST_ID,
    requestNumber: '1002788',
    deps,
  });

  expect(result).toMatchObject({ state: 'current', binding: 'canonical' });
  expect(result.proposalContentVersion).toMatch(/^[a-f0-9]{64}$/);
  expect(deps.getFileMetadataByPath).toHaveBeenCalledWith(
    'akoya_request',
    'Request/1002788/Reviewer Materials',
    'Proposal_1002788.pdf',
  );
  expect(deps.getFileMetadataByPath).not.toHaveBeenCalledWith(
    'akoya_request',
    'Request/1002788/Phase I',
    'ProjectDescription.pdf',
  );
});

test('uses only the exact Phase I ProjectDescription fallback when canonical metadata is absent', async () => {
  const fallbackPath = 'akoya_request::Request/1002788/Phase I::ProjectDescription.pdf';
  const deps = metadataDeps({ entries: new Map([[fallbackPath, metadata({ id: 'fallback' })]]) });

  const result = await resolveReviewerProposalMetadata({ requestId: REQUEST_ID, requestNumber: '1002788', deps });

  expect(result).toMatchObject({ state: 'current', binding: 'fallback' });
  expect(deps.getFileMetadataByPath).toHaveBeenNthCalledWith(
    2,
    'akoya_request',
    'Request/1002788/Phase I',
    'ProjectDescription.pdf',
  );
});

test('keeps GraphService as the receiver when production metadata dependency is used', async () => {
  const graphMetadata = jest.spyOn(GraphService, 'getFileMetadataByPath')
    .mockImplementation(function getMetadataWithStaticReceiver(library, folder, filename) {
      expect(this).toBe(GraphService);
      expect([library, folder, filename]).toEqual([
        'akoya_request',
        'Request/1002788/Reviewer Materials',
        'Proposal_1002788.pdf',
      ]);
      return Promise.resolve(metadata());
    });

  try {
    const result = await resolveReviewerProposalMetadata({
      requestId: REQUEST_ID,
      requestNumber: '1002788',
      deps: { getRequestSharePointBuckets: jest.fn(async () => buckets()) },
    });
    expect(result).toMatchObject({ state: 'current', binding: 'canonical' });
  } finally {
    graphMetadata.mockRestore();
  }
});

test('fails closed for duplicate or missing canonical/fallback bindings', async () => {
  const duplicateBuckets = buckets(
    { library: 'akoya_request', folder: 'Request/A', source: 'dynamics' },
    { library: 'akoya_request', folder: 'Request/B', source: 'dynamics' },
  );
  const duplicateDeps = metadataDeps({
    bucketList: duplicateBuckets,
    entries: new Map([
      ['akoya_request::Request/A/Reviewer Materials::Proposal_1002788.pdf', metadata({ id: 'a' })],
      ['akoya_request::Request/B/Reviewer Materials::Proposal_1002788.pdf', metadata({ id: 'b' })],
    ]),
  });
  const duplicate = await resolveReviewerProposalMetadata({ requestId: REQUEST_ID, requestNumber: '1002788', deps: duplicateDeps });
  expect(duplicate).toEqual({ state: 'stale', reasonCode: 'proposal_binding_changed', proposalContentVersion: null });

  const missing = await resolveReviewerProposalMetadata({
    requestId: REQUEST_ID,
    requestNumber: '1002788',
    deps: metadataDeps(),
  });
  expect(missing).toEqual({ state: 'stale', reasonCode: 'proposal_binding_changed', proposalContentVersion: null });
});

test('fails closed when Graph metadata lacks a bounded identity or stable change token', async () => {
  const canonicalPath = 'akoya_request::Request/1002788/Reviewer Materials::Proposal_1002788.pdf';
  for (const incomplete of [
    metadata({ driveId: null }),
    metadata({ id: '' }),
    metadata({ eTag: null, versionId: null, lastModified: null }),
    metadata({ eTag: 'x'.repeat(1025), versionId: null, lastModified: null }),
  ]) {
    const result = await resolveReviewerProposalMetadata({
      requestId: REQUEST_ID,
      requestNumber: '1002788',
      deps: metadataDeps({ entries: new Map([[canonicalPath, incomplete]]) }),
    });
    expect(result).toEqual({ state: 'stale', reasonCode: 'proposal_binding_changed', proposalContentVersion: null });
  }
});

test('makes a Graph metadata fault fail closed without using a download or Blob path', async () => {
  const deps = metadataDeps();
  deps.getFileMetadataByPath.mockRejectedValueOnce(new Error('Graph unavailable'));
  const download = jest.spyOn(GraphService, 'downloadFileByPath');
  const upload = jest.spyOn(GraphService, 'uploadFile');

  const result = await resolveReviewerProposalMetadata({ requestId: REQUEST_ID, requestNumber: '1002788', deps });

  expect(result).toEqual({ state: 'error', reasonCode: 'authority_stale', proposalContentVersion: null });
  expect(download).not.toHaveBeenCalled();
  expect(upload).not.toHaveBeenCalled();
  const source = fs.readFileSync(require.resolve('../../lib/services/workbench/reviewer-warm-validation-service'), 'utf8');
  expect(source).not.toMatch(/downloadFile|uploadFile|@vercel\/blob|extractExcludedReviewers|ensureApplicantRecommended|executePrompt/);
  download.mockRestore();
  upload.mockRestore();
});

test('fails closed before Graph metadata reads when the authoritative request does not match the roster scope', async () => {
  const deps = metadataDeps({ entries: new Map([[
    'akoya_request::Request/1002788/Reviewer Materials::Proposal_1002788.pdf', metadata(),
  ]]) });

  const result = await readReviewerWarmValidation({
    requestId: REQUEST_ID,
    roster: { active: [] },
    deps: {
      ...deps,
      getRequestById: jest.fn(async () => request({
        akoya_requestid: '99999999-9999-9999-9999-999999999999',
      })),
    },
  });

  expect(result).toEqual({
    state: 'error',
    reasonCode: 'authority_stale',
    candidatePlans: [],
  });
  expect(deps.getRequestSharePointBuckets).not.toHaveBeenCalled();
  expect(deps.getFileMetadataByPath).not.toHaveBeenCalled();
});

test('applicant input fingerprints are deterministic and their response projection has no raw people, emails, or exclusion prose', () => {
  const first = projectApplicantWarmInputs(request());
  const second = projectApplicantWarmInputs(request());
  const changed = projectApplicantWarmInputs(request({ wmkf_excludedreviewers: 'Different exclusion.' }));

  expect(first).toEqual(second);
  expect(changed.applicantInputVersion).not.toBe(first.applicantInputVersion);
  expect(first).toMatchObject({
    state: 'current',
    applicantInputVersion: expect.stringMatching(/^[a-f0-9]{64}$/),
    summary: { recommendationSlotCount: 1, hasExclusions: true, hasPi: true, hasApplicantOrganization: true },
  });
  const responseText = JSON.stringify(first);
  expect(responseText).not.toContain('Alice Applicant');
  expect(responseText).not.toContain('Jane Example');
  expect(responseText).not.toContain('Example University');
});

test('keeps panel state current and plans a historical stored row without fabricating a cache hit', async () => {
  const req = request();
  const proposal = await resolveReviewerProposalMetadata({
    requestId: REQUEST_ID,
    requestNumber: req.akoya_requestnum,
    deps: metadataDeps({ entries: new Map([[
      'akoya_request::Request/1002788/Reviewer Materials::Proposal_1002788.pdf', metadata(),
    ]]) }),
  });
  const candidate = {
    candidateKey: 'candidate:secret%20candidate|email:secret%40example.edu|orcid:-|affiliation:example%20university',
    name: 'Secret Candidate',
    email: 'secret@example.edu',
    provenance: { kind: 'proposal_named' },
    warmCacheVersion: 1,
    applicantInputVersion: 'legacy-request-wide-input-version',
    proposalContentVersion: proposal.proposalContentVersion,
    stageFreshness: Object.fromEntries(STAGES.map((stage) => [stage, {
      state: 'current',
      contractVersion: CONTRACT_VERSIONS[stage],
      sourceVersion: `legacy-${stage}`,
      resultVersion: `legacy-${stage}-result`,
      completedAt: '2026-08-01T00:00:00.000Z',
    }])),
  };
  const deps = metadataDeps({ entries: new Map([[
    'akoya_request::Request/1002788/Reviewer Materials::Proposal_1002788.pdf', metadata(),
  ]]) });

  const result = await readReviewerWarmValidation({
    requestId: REQUEST_ID,
    roster: { active: [candidate] },
    deps: { ...deps, getRequestById: jest.fn(async () => req) },
  });

  expect(result).toMatchObject({
    state: 'current',
    proposalBinding: 'canonical',
    candidatePlans: [{
      candidateKey: candidate.candidateKey,
      promotionAuthority: 'blocked_refresh_required',
    }],
  });
  expect(result.candidatePlans[0].cacheOutcome).not.toBe('hit');
  expect(result.candidatePlans[0].refreshes).toEqual(expect.arrayContaining([
    expect.objectContaining({ stage: 'identity', reason: 'stage_contract_changed' }),
  ]));
  expect(result.candidatePlans[0].currentStages).toEqual([]);
  const responseText = JSON.stringify(result);
  expect(responseText).not.toContain('Secret Candidate');
  expect(responseText).not.toContain('secret@example.edu');
  expect(responseText).not.toContain('Jane Example');
  expect(responseText).not.toContain('Reviewer Materials');
  expect(responseText).not.toContain('Proposal_1002788.pdf');
});

test('projects Katherine-shaped signed v2 legacy evidence as selectable while retaining blocked promotion authority', async () => {
  const identity = jest.spyOn(ReviewerIdentityRuntime, 'evaluateSuggestion');
  const coauthor = jest.spyOn(coauthorCoi, 'checkCoauthorHistory');
  const stageWrite = jest.spyOn(reviewerRosterStore, 'completeStageRefreshWithEvidence');
  const coldWrite = jest.spyOn(reviewerRosterStore, 'recordSurfacedWithStageEvidence');
  const priorSecret = process.env.NEXTAUTH_SECRET;
  process.env.NEXTAUTH_SECRET = 'reviewer-warm-legacy-test-secret';
  const candidate = {
    candidateKey: 'person:55555555-5555-4555-8555-555555555555',
    rosterStatus: 'active',
    name: 'Katherine Ferrara',
    identityStatus: 'probable',
    email: 'kwferrar@stanford.edu',
    emailSource: 'scholarly_multi',
    emailPersistAllowed: true,
    contactEnrichment: {
      email: 'kwferrar@stanford.edu',
      emailSource: 'scholarly_multi',
      emailPersistAllowed: true,
      identity: {
        status: 'probable',
        resolverVersion: 'works-first-v1',
        resolvedAt: '2026-07-29T12:00:00.000Z',
        anchors: [{ type: 'orcid', canonicalKey: 'orcid:0000-0002-1825-0097' }],
      },
    },
  };
  try {
    candidate.automatedIdentityAttestation = await mintHistoricalV2Attestation(candidate);
    const result = await readReviewerWarmValidation({
      requestId: REQUEST_ID,
      roster: { active: [candidate] },
      deps: {
        ...metadataDeps({ entries: new Map([[
          'akoya_request::Request/1002788/Reviewer Materials::Proposal_1002788.pdf', metadata(),
        ]]) }),
        getRequestById: jest.fn(async () => request()),
      },
    });

    expect(result).toMatchObject({ state: 'current' });
    expect(result.candidatePlans[0]).toMatchObject({
      candidateKey: candidate.candidateKey,
      cacheOutcome: 'miss',
      promotionAuthority: 'blocked_refresh_required',
      legacySelection: {
        version: 1,
        state: 'selectable',
        evidenceCheckedAt: '2026-07-29T00:00:00.000Z',
      },
    });
    expect(result.candidatePlans[0].currentStages).toEqual([]);
    expect(result.candidatePlans[0].refreshes).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: 'identity', reason: 'warm_cache_version_changed' }),
    ]));
    expect(identity).not.toHaveBeenCalled();
    expect(coauthor).not.toHaveBeenCalled();
    expect(stageWrite).not.toHaveBeenCalled();
    expect(coldWrite).not.toHaveBeenCalled();
    const promotionSnapshot = await deriveReviewerPromotionAuthoritySnapshot({
      requestId: REQUEST_ID,
      candidate,
      deps: {
        ...metadataDeps({ entries: new Map([[
          'akoya_request::Request/1002788/Reviewer Materials::Proposal_1002788.pdf', metadata(),
        ]]) }),
        getRequestById: jest.fn(async () => request()),
      },
    });
    expect(promotionSnapshot).toMatchObject({
      authorityState: 'stale',
      plan: { cacheOutcome: 'miss', promotionAuthority: 'blocked_refresh_required' },
    });
    expect(getCandidatePromotionAuthority(candidate, {
      serverAuthoritative: true,
      requestId: REQUEST_ID,
      authoritative: promotionSnapshot,
    })).toMatchObject({ decision: 'blocked' });
    expect(identity).not.toHaveBeenCalled();
    expect(coauthor).not.toHaveBeenCalled();
    expect(stageWrite).not.toHaveBeenCalled();
    expect(coldWrite).not.toHaveBeenCalled();
  } finally {
    if (priorSecret === undefined) delete process.env.NEXTAUTH_SECRET;
    else process.env.NEXTAUTH_SECRET = priorSecret;
    identity.mockRestore();
    coauthor.mockRestore();
    stageWrite.mockRestore();
    coldWrite.mockRestore();
  }
});

test('restores Katherine-shaped persisted selection after a rotated automated-attestation secret without granting promotion authority', async () => {
  const identity = jest.spyOn(ReviewerIdentityRuntime, 'evaluateSuggestion');
  const coauthor = jest.spyOn(coauthorCoi, 'checkCoauthorHistory');
  const stageWrite = jest.spyOn(reviewerRosterStore, 'completeStageRefreshWithEvidence');
  const coldWrite = jest.spyOn(reviewerRosterStore, 'recordSurfacedWithStageEvidence');
  const priorSecret = process.env.NEXTAUTH_SECRET;
  const candidate = katherinePersistedLegacyCandidate();
  try {
    process.env.NEXTAUTH_SECRET = 'historical-rotated-secret';
    candidate.automatedIdentityAttestation = await mintHistoricalV2Attestation(candidate);
    process.env.NEXTAUTH_SECRET = 'current-secret-that-cannot-verify-history';

    const result = await readReviewerWarmValidation({
      requestId: REQUEST_ID,
      roster: { active: [candidate] },
      deps: {
        ...metadataDeps({ entries: new Map([[
          'akoya_request::Request/1002788/Reviewer Materials::Proposal_1002788.pdf', metadata(),
        ]]) }),
        getRequestById: jest.fn(async () => request()),
      },
    });

    expect(result.candidatePlans[0]).toMatchObject({
      candidateKey: candidate.candidateKey,
      cacheOutcome: 'miss',
      promotionAuthority: 'blocked_refresh_required',
      legacySelection: {
        version: 1,
        state: 'selectable',
        evidenceCheckedAt: '2026-07-29T18:20:22.776Z',
      },
    });
    expect(result.candidatePlans[0].refreshes).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: 'identity', reason: 'warm_cache_version_changed' }),
    ]));
    expect(identity).not.toHaveBeenCalled();
    expect(coauthor).not.toHaveBeenCalled();
    expect(stageWrite).not.toHaveBeenCalled();
    expect(coldWrite).not.toHaveBeenCalled();

    const promotionSnapshot = await deriveReviewerPromotionAuthoritySnapshot({
      requestId: REQUEST_ID,
      candidate,
      deps: {
        ...metadataDeps({ entries: new Map([[
          'akoya_request::Request/1002788/Reviewer Materials::Proposal_1002788.pdf', metadata(),
        ]]) }),
        getRequestById: jest.fn(async () => request()),
      },
    });
    expect(promotionSnapshot).toMatchObject({
      authorityState: 'stale',
      plan: { cacheOutcome: 'miss', promotionAuthority: 'blocked_refresh_required' },
    });
    expect(getCandidatePromotionAuthority(candidate, {
      serverAuthoritative: true,
      requestId: REQUEST_ID,
      authoritative: promotionSnapshot,
    })).toMatchObject({ decision: 'blocked' });
  } finally {
    if (priorSecret === undefined) delete process.env.NEXTAUTH_SECRET;
    else process.env.NEXTAUTH_SECRET = priorSecret;
    identity.mockRestore();
    coauthor.mockRestore();
    stageWrite.mockRestore();
    coldWrite.mockRestore();
  }
});

test.each([
  ['unresolved nested identity', (candidate) => { candidate.contactEnrichment.identity.status = 'unresolved'; }],
  ['unready contact', (candidate) => { candidate.emailPersistAllowed = false; }],
  ['missing exact ORCID binding', (candidate) => { delete candidate.orcid; }],
  ['stale resolver evidence despite a fresh roster row', (candidate) => { candidate.contactEnrichment.identity.resolvedAt = '2025-12-01T00:00:00.000Z'; }],
  ['stale Dataverse evidence despite a fresh roster row', (candidate) => { candidate.contactEnrichment.dataverseContactEvidence.checkedAt = '2025-12-01T00:00:00.000Z'; }],
  ['missing Dataverse evidence timestamp', (candidate) => { delete candidate.contactEnrichment.dataverseContactEvidence.checkedAt; }],
  ['stale server roster bound', (candidate) => { candidate.rosterUpdatedAt = '2025-12-01 00:00:00+00'; }],
  ['missing server roster evidence', (candidate) => { delete candidate.rosterUpdatedAt; }],
  ['applicant recommendation lane', (candidate) => { candidate.isApplicantRecommended = true; }],
  ['ambiguous suggestion lane', (candidate) => { candidate.candidateKey = 'suggestion:11111111-1111-1111-1111-111111111111'; }],
  ['known coauthor conflict', (candidate) => { candidate.hasCoauthorCOI = true; }],
  ['ineligible row', (candidate) => { candidate.eligibilityStatus = 'ineligible'; }],
  ['deceased row', (candidate) => { candidate.eligibilityStatus = 'deceased'; }],
])('rotated-signature legacy fallback fails closed for %s', async (_label, mutate) => {
  const priorSecret = process.env.NEXTAUTH_SECRET;
  const candidate = katherinePersistedLegacyCandidate();
  try {
    mutate(candidate);
    process.env.NEXTAUTH_SECRET = 'historical-rotated-secret';
    candidate.automatedIdentityAttestation = await mintHistoricalV2Attestation(candidate);
    process.env.NEXTAUTH_SECRET = 'current-secret-that-cannot-verify-history';
    const result = await readReviewerWarmValidation({
      requestId: REQUEST_ID,
      roster: { active: [candidate] },
      deps: {
        ...metadataDeps({ entries: new Map([[
          'akoya_request::Request/1002788/Reviewer Materials::Proposal_1002788.pdf', metadata(),
        ]]) }),
        getRequestById: jest.fn(async () => request()),
      },
    });

    expect(result.candidatePlans[0].legacySelection).toBeNull();
    expect(result.candidatePlans[0].promotionAuthority).toBe('blocked_refresh_required');
  } finally {
    if (priorSecret === undefined) delete process.env.NEXTAUTH_SECRET;
    else process.env.NEXTAUTH_SECRET = priorSecret;
  }
});

test('rotated-signature legacy fallback rejects a malformed automated receipt', async () => {
  const candidate = katherinePersistedLegacyCandidate();
  candidate.automatedIdentityAttestation = 'not-a-signed-attestation';
  const result = await readReviewerWarmValidation({
    requestId: REQUEST_ID,
    roster: { active: [candidate] },
    deps: {
      ...metadataDeps({ entries: new Map([[
        'akoya_request::Request/1002788/Reviewer Materials::Proposal_1002788.pdf', metadata(),
      ]]) }),
      getRequestById: jest.fn(async () => request()),
    },
  });

  expect(result.candidatePlans[0].legacySelection).toBeNull();
});

test('rotated-signature legacy fallback rejects an algorithm the verifier did not allow', async () => {
  const priorSecret = process.env.NEXTAUTH_SECRET;
  const candidate = katherinePersistedLegacyCandidate();
  try {
    process.env.NEXTAUTH_SECRET = 'historical-rotated-secret';
    candidate.automatedIdentityAttestation = await mintHistoricalV2Attestation(candidate, { alg: 'HS384' });
    process.env.NEXTAUTH_SECRET = 'current-secret-that-cannot-verify-history';
    const result = await readReviewerWarmValidation({
      requestId: REQUEST_ID,
      roster: { active: [candidate] },
      deps: {
        ...metadataDeps({ entries: new Map([[
          'akoya_request::Request/1002788/Reviewer Materials::Proposal_1002788.pdf', metadata(),
        ]]) }),
        getRequestById: jest.fn(async () => request()),
      },
    });

    expect(result.candidatePlans[0].legacySelection).toBeNull();
  } finally {
    if (priorSecret === undefined) delete process.env.NEXTAUTH_SECRET;
    else process.env.NEXTAUTH_SECRET = priorSecret;
  }
});

test.each([
  ['missing server address attestation', (candidate) => { const next = { ...candidate }; delete next.addressTrustReceipt; return next; }],
  ['ambiguous identity', (candidate) => ({ ...candidate, identityStatus: 'unresolved' })],
  ['modern receipt marker', (candidate) => ({ ...candidate, warmCacheVersion: 1 })],
])('receipt-less legacy projection fails closed for %s', async (_label, mutate) => {
  const candidate = mutate({
    candidateKey: 'person:55555555-5555-4555-8555-555555555555',
    identityStatus: 'probable',
    email: 'legacy.reviewer@example.edu',
    emailSource: 'faculty_page',
    emailPersistAllowed: true,
    addressTrustReceipt: {
      receiptId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', personConfirmed: true,
      email: 'legacy.reviewer@example.edu', requestId: REQUEST_ID,
      candidateKey: 'person:55555555-5555-4555-8555-555555555555',
      actorProfileId: 'profile-1', actorSystemUserId: 'actor-1',
      evidenceType: 'institution_page', evidenceUrl: 'https://example.edu/legacy-reviewer', note: null,
      attestedAt: '2026-08-02T10:00:00.000Z',
      canonicalPersonId: '55555555-5555-4555-8555-555555555555', canonicalPersonEtag: 'W/"legacy-person-v1"',
    },
  });
  const result = await readReviewerWarmValidation({
    requestId: REQUEST_ID,
    roster: { active: [candidate] },
    deps: {
      ...metadataDeps({ entries: new Map([[
        'akoya_request::Request/1002788/Reviewer Materials::Proposal_1002788.pdf', metadata(),
      ]]) }),
      getRequestById: jest.fn(async () => request()),
    },
  });

  expect(result.candidatePlans[0].legacySelection).toBeNull();
  expect(result.candidatePlans[0].promotionAuthority).toBe('blocked_refresh_required');
});

test('warm validation never runs evidence providers or roster writers for a provider-ready cached row', async () => {
  const identity = jest.spyOn(ReviewerIdentityRuntime, 'evaluateSuggestion');
  const coauthor = jest.spyOn(coauthorCoi, 'checkCoauthorHistory');
  const download = jest.spyOn(GraphService, 'downloadFileByPath');
  const stageWrite = jest.spyOn(reviewerRosterStore, 'completeStageRefreshWithEvidence');
  const coldWrite = jest.spyOn(reviewerRosterStore, 'recordSurfacedWithStageEvidence');
  const candidate = {
    candidateKey: 'person:55555555-5555-5555-5555-555555555555',
    provenance: { kind: 'proposal_named' },
    name: 'Provider-ready Reviewer',
    affiliation: 'Example University',
    email: 'reviewer@example.edu',
    identityDecision: 'confirmed',
    proposalAuthorVersion: 'proposal-authors:v1',
    warmCacheVersion: 1,
    stageFreshness: {},
  };
  try {
    await readReviewerWarmValidation({
      requestId: REQUEST_ID,
      roster: { active: [candidate] },
      deps: {
        ...metadataDeps({ entries: new Map([[
          'akoya_request::Request/1002788/Reviewer Materials::Proposal_1002788.pdf', metadata(),
        ]]) }),
        getRequestById: jest.fn(async () => request()),
      },
    });

    expect(identity).not.toHaveBeenCalled();
    expect(coauthor).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
    expect(stageWrite).not.toHaveBeenCalled();
    expect(coldWrite).not.toHaveBeenCalled();
  } finally {
    identity.mockRestore();
    coauthor.mockRestore();
    download.mockRestore();
    stageWrite.mockRestore();
    coldWrite.mockRestore();
  }
});

test('warm validation surfaces an expired lease owner before ordinary upstream refreshes', async () => {
  const candidate = {
    candidateKey: 'person:55555555-5555-5555-5555-555555555555',
    provenance: { kind: 'proposal_named' },
    name: 'Expired Lease Reviewer',
    warmCacheVersion: 1,
    stageFreshness: {},
    stageRefresh: {
      contact: {
        refreshAttemptId: 'expired-contact-attempt',
        refreshStartedAt: '2020-08-01T00:00:00.000Z',
      },
    },
  };
  const result = await readReviewerWarmValidation({
    requestId: REQUEST_ID,
    roster: { active: [candidate] },
    deps: {
      ...metadataDeps({ entries: new Map([[
        'akoya_request::Request/1002788/Reviewer Materials::Proposal_1002788.pdf', metadata(),
      ]]) }),
      getRequestById: jest.fn(async () => request()),
    },
  });

  expect(result.candidatePlans[0].refreshes[0]).toMatchObject({
    stage: 'contact',
    reason: 'prior_refresh_incomplete',
    action: 'recover_expired_lease',
  });
  expect(result.candidatePlans[0].refreshes).toEqual(expect.arrayContaining([
    expect.objectContaining({ stage: 'applicant_anchor' }),
  ]));
});

test('warm validation projects a malformed lease as an operator-only repair', async () => {
  const candidate = {
    candidateKey: 'person:56565656-5656-5656-5656-565656565656',
    provenance: { kind: 'proposal_named' },
    name: 'Malformed Lease Reviewer',
    warmCacheVersion: 1,
    stageFreshness: {},
    stageRefresh: {
      contact: {
        refreshAttemptId: '',
        refreshStartedAt: '2026-08-02T12:00:00.000Z',
      },
    },
  };
  const result = await readReviewerWarmValidation({
    requestId: REQUEST_ID,
    roster: { active: [candidate] },
    deps: {
      ...metadataDeps({ entries: new Map([[
        'akoya_request::Request/1002788/Reviewer Materials::Proposal_1002788.pdf', metadata(),
      ]]) }),
      getRequestById: jest.fn(async () => request()),
    },
  });

  expect(result.candidatePlans[0]).toMatchObject({
    candidateKey: candidate.candidateKey,
    leaseRepairRequired: true,
  });
  expect(result.candidatePlans[0].refreshes).toEqual(expect.arrayContaining([
    expect.objectContaining({
      stage: 'contact',
      reason: 'stage_incomplete',
      action: 'operator_repair_required',
    }),
  ]));
});

test('marks an applicant-lane candidate missing when its exact potential reviewer id is not a current slot', async () => {
  const candidate = {
    candidateKey: 'suggestion:55555555-5555-5555-5555-555555555555',
    isApplicantRecommended: true,
    potentialReviewerId: '66666666-6666-6666-6666-666666666666',
    warmCacheVersion: 1,
  };
  const result = await readReviewerWarmValidation({
    requestId: REQUEST_ID,
    roster: { active: [candidate] },
    deps: {
      ...metadataDeps({ entries: new Map([[
        'akoya_request::Request/1002788/Reviewer Materials::Proposal_1002788.pdf', metadata(),
      ]]) }),
      getRequestById: jest.fn(async () => request()),
    },
  });

  expect(result).toMatchObject({ state: 'current' });
  expect(result.candidatePlans[0]).toMatchObject({
    candidateKey: candidate.candidateKey,
    cacheOutcome: 'miss',
  });
  expect(result.candidatePlans[0].refreshes).toEqual(expect.arrayContaining([
    expect.objectContaining({ stage: 'applicant_anchor', reason: 'candidate_missing' }),
  ]));
});

test('does not mint a current general-search applicant anchor during warm validation', async () => {
  const candidate = {
    candidateKey: 'orcid:0000-0002-1825-0097',
    warmCacheVersion: 1,
    // This deliberately disagrees with the request's slots. General-search
    // candidates must not inherit applicant-anchor invalidation from it.
    applicantInputVersion: 'old-request-wide-input-version',
    stageFreshness: {
      applicant_anchor: {
        state: 'current',
        contractVersion: CONTRACT_VERSIONS.applicant_anchor,
        sourceVersion: 'old-request-wide-input-version',
        resultVersion: 'old-request-wide-result',
        completedAt: '2026-08-01T00:00:00.000Z',
      },
    },
  };
  const result = await readReviewerWarmValidation({
    requestId: REQUEST_ID,
    roster: { active: [candidate] },
    deps: {
      ...metadataDeps({ entries: new Map([[
        'akoya_request::Request/1002788/Reviewer Materials::Proposal_1002788.pdf', metadata(),
      ]]) }),
      getRequestById: jest.fn(async () => request()),
    },
  });

  expect(result).toMatchObject({ state: 'current' });
  expect(result.candidatePlans[0].currentStages).not.toContain('applicant_anchor');
  expect(result.candidatePlans[0].refreshes).toEqual(expect.arrayContaining([
    expect.objectContaining({ stage: 'applicant_anchor', reason: 'stage_contract_changed' }),
  ]));
  expect(result.candidatePlans[0].cacheOutcome).toBe('miss');
});

test('accepts only a producer-written canonical general-search applicant N/A receipt', async () => {
  const candidateKey = 'orcid:0000-0002-1825-0097';
  const sourceVersion = opaqueVersion('reviewer-warm-applicant-anchor-not-applicable:v1', { candidateKey });
  const candidate = {
    candidateKey,
    warmCacheVersion: 1,
    stageFreshness: {
      applicant_anchor: {
        state: 'not_applicable',
        contractVersion: CONTRACT_VERSIONS.applicant_anchor,
        sourceVersion,
        resultVersion: sourceVersion,
        completedAt: '2026-08-01T00:00:00.000Z',
        reasonCode: 'server_not_applicable',
      },
    },
  };
  const result = await readReviewerWarmValidation({
    requestId: REQUEST_ID,
    roster: { active: [candidate] },
    deps: {
      ...metadataDeps({ entries: new Map([[
        'akoya_request::Request/1002788/Reviewer Materials::Proposal_1002788.pdf', metadata(),
      ]]) }),
      getRequestById: jest.fn(async () => request()),
    },
  });

  expect(result.candidatePlans[0].currentStages).toContain('applicant_anchor');
  expect(result.candidatePlans[0].refreshes).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ stage: 'applicant_anchor' }),
  ]));
});

test('uses an exact applicant slot fingerprint without granting unrelated stage authority', async () => {
  const slotVersion = opaqueVersion('reviewer-warm-applicant-slot:v1', {
    requestId: REQUEST_ID,
    personId: '22222222-2222-2222-2222-222222222222',
    slots: [1],
  });
  const candidate = {
    candidateKey: 'suggestion:55555555-5555-5555-5555-555555555555',
    isApplicantRecommended: true,
    potentialReviewerId: '22222222-2222-2222-2222-222222222222',
    warmCacheVersion: 1,
    stageFreshness: {
      applicant_anchor: {
        state: 'current',
        contractVersion: CONTRACT_VERSIONS.applicant_anchor,
        sourceVersion: slotVersion,
        resultVersion: 'slot-result-version',
        completedAt: '2026-08-01T00:00:00.000Z',
      },
    },
  };
  const result = await readReviewerWarmValidation({
    requestId: REQUEST_ID,
    roster: { active: [candidate] },
    deps: {
      ...metadataDeps({ entries: new Map([[
        'akoya_request::Request/1002788/Reviewer Materials::Proposal_1002788.pdf', metadata(),
      ]]) }),
      getRequestById: jest.fn(async () => request()),
    },
  });

  expect(result).toMatchObject({ state: 'current' });
  expect(result.candidatePlans[0].currentStages).toContain('applicant_anchor');
  expect(result.candidatePlans[0].cacheOutcome).toBe('partial_hit');
  expect(result.candidatePlans[0].refreshes).toEqual(expect.arrayContaining([
    expect.objectContaining({ stage: 'identity', reason: 'stage_missing' }),
  ]));
});

test('projects only allowlisted canonical evidence dates and derives the applicant refresh receipt from the exact slot', async () => {
  const slotVersion = opaqueVersion('reviewer-warm-applicant-slot:v1', {
    requestId: REQUEST_ID,
    personId: '22222222-2222-2222-2222-222222222222',
    slots: [1],
  });
  const validCandidate = {
    candidateKey: 'suggestion:55555555-5555-5555-5555-555555555555',
    isApplicantRecommended: true,
    potentialReviewerId: '22222222-2222-2222-2222-222222222222',
    name: 'Private Candidate Name',
    email: 'private-candidate@example.edu',
    warmCacheVersion: 1,
    stageFreshness: {
      applicant_anchor: {
        state: 'current',
        contractVersion: CONTRACT_VERSIONS.applicant_anchor,
        sourceVersion: slotVersion,
        resultVersion: 'slot-result-version',
        completedAt: '2026-08-01T00:00:00.000Z',
      },
    },
  };
  const invalidDateCandidate = {
    ...validCandidate,
    candidateKey: 'suggestion:66666666-6666-6666-6666-666666666666',
    stageFreshness: {
      applicant_anchor: {
        ...validCandidate.stageFreshness.applicant_anchor,
        completedAt: 'not-an-iso-date',
      },
    },
  };
  const invalidKeyCandidate = {
    ...validCandidate,
    candidateKey: 'legacy row without a canonical key',
  };
  const receipt = buildApplicantAnchorRefreshReceipt({
    request: request(),
    candidate: validCandidate,
    completedAt: '2026-08-02T12:00:00.000Z',
  });
  expect(receipt).toEqual({
    state: 'current',
    contractVersion: 1,
    sourceVersion: slotVersion,
    resultVersion: slotVersion,
    completedAt: '2026-08-02T12:00:00.000Z',
  });

  const result = await readReviewerWarmValidation({
    requestId: REQUEST_ID,
    roster: { active: [validCandidate, invalidDateCandidate, invalidKeyCandidate] },
    deps: {
      ...metadataDeps({ entries: new Map([[
        'akoya_request::Request/1002788/Reviewer Materials::Proposal_1002788.pdf', metadata(),
      ]]) }),
      getRequestById: jest.fn(async () => request()),
    },
  });

  expect(result.candidatePlans).toEqual(expect.arrayContaining([
    expect.objectContaining({
      candidateKey: validCandidate.candidateKey,
      evidenceCheckedDates: { applicant_anchor: '2026-08-01T00:00:00.000Z' },
    }),
    expect.objectContaining({
      candidateKey: invalidDateCandidate.candidateKey,
      evidenceCheckedDates: {},
    }),
  ]));
  expect(result.candidatePlans).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ candidateKey: null }),
    expect.objectContaining({ candidateKey: invalidKeyCandidate.candidateKey }),
  ]));
  const responseText = JSON.stringify(result);
  expect(responseText).not.toContain('Private Candidate Name');
  expect(responseText).not.toContain('private-candidate@example.edu');
});

test('keeps a general-search applicant anchor not applicable when the proposal panel is stale', async () => {
  const candidate = {
    candidateKey: 'orcid:0000-0002-1825-0097',
    warmCacheVersion: 1,
    applicantInputVersion: 'old-request-wide-input-version',
  };
  const result = await readReviewerWarmValidation({
    requestId: REQUEST_ID,
    roster: { active: [candidate] },
    // No binding is found, making the panel stale without failing the request
    // recommendation-slot read.
    deps: { ...metadataDeps(), getRequestById: jest.fn(async () => request()) },
  });

  expect(result).toMatchObject({ state: 'stale', reasonCode: 'proposal_binding_changed' });
  expect(result.candidatePlans[0]).toMatchObject({
    candidateKey: candidate.candidateKey,
    promotionAuthority: 'blocked_refresh_required',
  });
  expect(result.candidatePlans[0].currentStages).not.toContain('applicant_anchor');
  expect(result.candidatePlans[0].refreshes).toEqual(expect.arrayContaining([
    expect.objectContaining({ stage: 'applicant_anchor', reason: 'stage_missing' }),
  ]));
});

test('keeps an exact applicant-slot comparison when the proposal panel is stale', async () => {
  const slotVersion = opaqueVersion('reviewer-warm-applicant-slot:v1', {
    requestId: REQUEST_ID,
    personId: '22222222-2222-2222-2222-222222222222',
    slots: [1],
  });
  const candidate = {
    candidateKey: 'suggestion:55555555-5555-5555-5555-555555555555',
    isApplicantRecommended: true,
    potentialReviewerId: '22222222-2222-2222-2222-222222222222',
    warmCacheVersion: 1,
    stageFreshness: {
      applicant_anchor: {
        state: 'current',
        contractVersion: CONTRACT_VERSIONS.applicant_anchor,
        sourceVersion: slotVersion,
        resultVersion: 'slot-result-version',
        completedAt: '2026-08-01T00:00:00.000Z',
      },
    },
  };
  const result = await readReviewerWarmValidation({
    requestId: REQUEST_ID,
    roster: { active: [candidate] },
    deps: { ...metadataDeps(), getRequestById: jest.fn(async () => request()) },
  });

  expect(result).toMatchObject({ state: 'stale', reasonCode: 'proposal_binding_changed' });
  expect(result.candidatePlans[0].currentStages).toContain('applicant_anchor');
  expect(result.candidatePlans[0].refreshes).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ stage: 'applicant_anchor' }),
  ]));
  expect(result.candidatePlans[0].promotionAuthority).toBe('blocked_refresh_required');
});

test('fails closed for an ambiguous suggestion row without applicant or non-applicant provenance', async () => {
  const candidate = {
    candidateKey: 'suggestion:55555555-5555-5555-5555-555555555555',
    warmCacheVersion: 1,
    stageFreshness: {
      applicant_anchor: {
        state: 'current',
        contractVersion: CONTRACT_VERSIONS.applicant_anchor,
        sourceVersion: 'legacy-applicant-anchor',
        resultVersion: 'legacy-applicant-result',
        completedAt: '2026-08-01T00:00:00.000Z',
      },
    },
  };
  const result = await readReviewerWarmValidation({
    requestId: REQUEST_ID,
    roster: { active: [candidate] },
    deps: {
      ...metadataDeps({ entries: new Map([[
        'akoya_request::Request/1002788/Reviewer Materials::Proposal_1002788.pdf', metadata(),
      ]]) }),
      getRequestById: jest.fn(async () => request()),
    },
  });

  expect(result).toMatchObject({ state: 'current' });
  expect(result.candidatePlans[0]).toMatchObject({
    candidateKey: candidate.candidateKey,
    cacheOutcome: 'miss',
  });
  expect(result.candidatePlans[0].refreshes).toEqual(expect.arrayContaining([
    expect.objectContaining({ stage: 'applicant_anchor', reason: 'candidate_missing' }),
  ]));
  expect(result.candidatePlans[0].currentStages).not.toContain('applicant_anchor');
});

test('does not guess a historical manual file binding from a roster cache key', async () => {
  const deps = metadataDeps({ entries: new Map([[
    'akoya_request::Request/1002788/Reviewer Materials::Proposal_1002788.pdf', metadata(),
  ]]) });
  const result = await readReviewerWarmValidation({
    requestId: REQUEST_ID,
    roster: {
      active: [{
        candidateKey: 'suggestion:55555555-5555-5555-5555-555555555555',
        enrichedProposalKey: 'akoya_request::Historical/Other::Narrative.pdf',
      }],
    },
    deps: { ...deps, getRequestById: jest.fn(async () => request()) },
  });

  expect(result).toMatchObject({ state: 'stale', reasonCode: 'proposal_binding_changed' });
  expect(JSON.stringify(result)).not.toContain('Historical/Other');
});
