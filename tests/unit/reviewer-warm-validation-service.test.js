/** @jest-environment node */

import {
  projectApplicantWarmInputs,
  readReviewerWarmValidation,
  resolveReviewerProposalMetadata,
  opaqueVersion,
} from '../../lib/services/workbench/reviewer-warm-validation-service';
import { CONTRACT_VERSIONS, STAGES } from '../../lib/services/reviewer-stage-freshness';
import { GraphService } from '../../lib/services/graph-service';
import fs from 'fs';

const REQUEST_ID = '11111111-1111-1111-1111-111111111111';

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

test('keeps panel state current without fabricating a full candidate-stage cache hit', async () => {
  const req = request();
  const proposal = await resolveReviewerProposalMetadata({
    requestId: REQUEST_ID,
    requestNumber: req.akoya_requestnum,
    deps: metadataDeps({ entries: new Map([[
      'akoya_request::Request/1002788/Reviewer Materials::Proposal_1002788.pdf', metadata(),
    ]]) }),
  });
  const candidate = {
    candidateKey: 'suggestion:55555555-5555-5555-5555-555555555555',
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
    candidatePlans: [{
      candidateKey: candidate.candidateKey,
      promotionAuthority: 'blocked_refresh_required',
    }],
  });
  expect(result.candidatePlans[0].cacheOutcome).not.toBe('hit');
  expect(result.candidatePlans[0].refreshes).toEqual(expect.arrayContaining([
    expect.objectContaining({ stage: 'identity', reason: 'stage_contract_changed' }),
  ]));
  expect(result.candidatePlans[0].currentStages).toEqual(['applicant_anchor']);
  const responseText = JSON.stringify(result);
  expect(responseText).not.toContain('Secret Candidate');
  expect(responseText).not.toContain('secret@example.edu');
  expect(responseText).not.toContain('Jane Example');
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

test('treats a general-search candidate applicant anchor as not applicable, not as a request-wide applicant slot', async () => {
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
  expect(result.candidatePlans[0].refreshes).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ stage: 'applicant_anchor' }),
  ]));
  expect(result.candidatePlans[0].cacheOutcome).toBe('partial_hit');
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
  expect(result.candidatePlans[0].currentStages).toContain('applicant_anchor');
  expect(result.candidatePlans[0].refreshes).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ stage: 'applicant_anchor' }),
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
