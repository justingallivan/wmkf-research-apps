/**
 * @jest-environment node
 *
 * The real reviewer dependency triad (createReviewerSourceDependencies) wired
 * for exportTestRequestSourceBundle. Fake Dataverse (client.get) and Graph
 * transports only -- never live. Covers Opus round 1 P2-5 and round 2's
 * P2-A (GUID validation), P2-B (request/person ownership), P2-C's marker
 * flag (markerColumnPresent, no isolation-switch read), and the P3 file
 * checks (primary-filename presence, before/after re-verify, metadata-only
 * second pass).
 */
import { createReviewerSourceDependencies } from '../../lib/services/test-requests/source-bundle-reviewers.js';
import { exportTestRequestSourceBundle } from '../../lib/services/test-requests/source-bundle.js';

const REQUEST_ID = 'e43ae6ea-698f-f111-8076-6045bd018a07';
const OTHER_REQUEST_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const SUGGESTION_ID = 'c3f00000-1111-2222-3333-444455556666';
const PERSON_ID = 'd4f00000-1111-2222-3333-444455556666';
const OTHER_PERSON_ID = 'ffffffff-1111-4fff-8fff-ffffffffffff';

function ok(body) { return { ok: true, status: 200, body }; }

function makeFakeClient({ suggestionListRows, suggestionRow, personRow, answerRows, suggestionListNextLink } = {}) {
  const calls = [];
  return {
    calls,
    async get(path) {
      calls.push(path);
      if (path.startsWith(`/wmkf_appreviewersuggestions?`)) {
        return ok({ value: suggestionListRows, ...(suggestionListNextLink ? { '@odata.nextLink': 'https://next' } : {}) });
      }
      if (path.startsWith(`/wmkf_appreviewersuggestions(${SUGGESTION_ID})`)) {
        return ok(suggestionRow);
      }
      if (path.startsWith(`/wmkf_potentialreviewerses(${PERSON_ID})`)) {
        return ok(personRow);
      }
      if (path.startsWith('/wmkf_appreviewanswers?')) {
        return ok({ value: answerRows || [] });
      }
      throw new Error(`unexpected path in fake client: ${path}`);
    },
  };
}

function makeFakeGraph({ files = [] } = {}) {
  const fileBytes = new Map(files.map((f) => [f.id, f.buffer]));
  return {
    downloadCount: 0,
    async getDriveId() { return 'b!drive-id'; },
    async listFiles() { return files.map(({ buffer, ...rest }) => rest); },
    async getFileMetadataById(driveId, itemId) {
      const file = files.find((f) => f.id === itemId);
      return { id: file.id, name: file.name, size: file.buffer.length, mimeType: file.mimeType, eTag: file.eTag, versionId: file.versionId };
    },
    async downloadFile(driveId, itemId) {
      this.downloadCount += 1;
      const buffer = fileBytes.get(itemId);
      return { filename: files.find((f) => f.id === itemId).name, size: buffer.length, buffer };
    },
    getSharePointTargetInfo() {
      return { registered: true, key: 'akoyago-shared', hostname: 'appriver3651007194.sharepoint.com', pathname: '/sites/akoyago' };
    },
  };
}

function baseSuggestionRow(over = {}) {
  return {
    wmkf_appreviewersuggestionid: SUGGESTION_ID,
    _wmkf_potentialreviewer_value: PERSON_ID,
    _wmkf_request_value: REQUEST_ID,
    wmkf_suggestionlabel: 'Suggestion 1',
    wmkf_programarea: 'Science',
    wmkf_relevancescore: 90,
    wmkf_matchreason: 'Strong match',
    wmkf_sources: 'literature_retrieved',
    wmkf_selected: true,
    wmkf_invited: true,
    wmkf_accepted: true,
    wmkf_declined: false,
    wmkf_responsetype: 100000000,
    wmkf_emailsentat: '2026-01-01T00:00:00Z',
    wmkf_responsereceivedat: '2026-01-02T00:00:00Z',
    wmkf_materialssentat: '2026-01-03T00:00:00Z',
    wmkf_reviewreceivedat: '2026-01-10T00:00:00Z',
    wmkf_completedat: '2026-01-10T00:00:00Z',
    wmkf_thankyousentat: '2026-01-10T00:00:00Z',
    wmkf_reviewstatus: 100000003,
    wmkf_revieweraffiliation: 'Analytical Engine Institute',
    wmkf_reviewuploadedbystaff: false,
    wmkf_reviewerfirstname: 'Ada',
    wmkf_reviewerlastname: 'Lovelace',
    wmkf_reviewernickname: null,
    wmkf_reviewertitle: 'Dr',
    wmkf_applicantdisposition: null,
    wmkf_reviewsharepointfolder: `1003222_E43AE6EA/Reviewer_Uploads/smith_1a2b3c4d/attempt_${'a'.repeat(32)}`,
    wmkf_reviewfilename: 'review.pdf',
    '@odata.etag': 'W/"sug-1"',
    ...over,
  };
}

function basePersonRow(over = {}) {
  return {
    wmkf_potentialreviewersid: PERSON_ID,
    wmkf_emailaddress: 'ada@example.edu',
    wmkf_name: 'Ada Lovelace',
    wmkf_firstname: 'Ada',
    wmkf_lastname: 'Lovelace',
    wmkf_areaofexpertise: 'Computing',
    wmkf_primaryaffiliation: 'Analytical Engine Institute',
    wmkf_academicrank: 'Professor',
    wmkf_primarydepartment: 'Mathematics',
    wmkf_maininstitution: 'Analytical Engine Institute',
    '@odata.etag': 'W/"person-1"',
    ...over,
  };
}

function baseAnswerRow(over = {}) {
  return {
    wmkf_questionkey: 'impact',
    wmkf_questionorder: 1,
    wmkf_questiontext: 'Impact?',
    wmkf_questiontype: 'picklist',
    wmkf_answerhtml: '<p>High</p>',
    wmkf_answertext: 'High',
    wmkf_answervalue: '1',
    wmkf_answervalues: null,
    wmkf_questionoptions: null,
    '@odata.etag': 'W/"answer-1"',
    ...over,
  };
}

const REVIEW_FILE = {
  id: '01REVIEW', name: 'review.pdf', mimeType: 'application/pdf',
  eTag: '"{ETAG},1"', versionId: '1.0', buffer: Buffer.from('review file bytes'),
};

const ENTRY = { suggestionId: SUGGESTION_ID, personId: PERSON_ID, requestId: REQUEST_ID };

describe('createReviewerSourceDependencies — markerColumnPresent is required (P2-C forward hazard)', () => {
  test('throws when markerColumnPresent is omitted', () => {
    expect(() => createReviewerSourceDependencies({ client: makeFakeClient(), graph: makeFakeGraph() }))
      .toThrow(/markerColumnPresent/);
  });

  test('throws when markerColumnPresent is not a boolean', () => {
    expect(() => createReviewerSourceDependencies({ client: makeFakeClient(), graph: makeFakeGraph(), markerColumnPresent: 'true' }))
      .toThrow(/markerColumnPresent/);
  });
});

describe('discoverReviewers', () => {
  test('returns (suggestionId, personId, requestId) triples for the request', async () => {
    const client = makeFakeClient({
      suggestionListRows: [{ wmkf_appreviewersuggestionid: SUGGESTION_ID, _wmkf_potentialreviewer_value: PERSON_ID }],
    });
    const deps = createReviewerSourceDependencies({ client, graph: makeFakeGraph(), markerColumnPresent: false });
    const result = await deps.discoverReviewers({ akoya_requestid: REQUEST_ID });
    expect(result.errors).toEqual([]);
    expect(result.reviewers).toEqual([{ suggestionId: SUGGESTION_ID, personId: PERSON_ID, requestId: REQUEST_ID }]);
  });

  test('refuses a continuation link (bounded read) rather than silently paging', async () => {
    const client = makeFakeClient({
      suggestionListRows: [{ wmkf_appreviewersuggestionid: SUGGESTION_ID, _wmkf_potentialreviewer_value: PERSON_ID }],
      suggestionListNextLink: true,
    });
    const deps = createReviewerSourceDependencies({ client, graph: makeFakeGraph(), markerColumnPresent: false });
    await expect(deps.discoverReviewers({ akoya_requestid: REQUEST_ID })).rejects.toThrow(/bounded read limit/);
  });

  // P2-B: the discover query's request scope. Asserting the exact filter
  // string is the discriminating test -- Opus's N5 mutation (dropping the
  // `_wmkf_request_value eq <id>` scope) passed all 9 round-1 tests because
  // the fake client's routing ignored the filter content entirely.
  test('scopes the query to the exact request id (mutation N5)', async () => {
    const client = makeFakeClient({ suggestionListRows: [] });
    const deps = createReviewerSourceDependencies({ client, graph: makeFakeGraph(), markerColumnPresent: false });
    await deps.discoverReviewers({ akoya_requestid: REQUEST_ID });
    const listCall = client.calls.find((c) => c.startsWith('/wmkf_appreviewersuggestions?'));
    expect(listCall).toBeDefined();
    const decoded = decodeURIComponent(listCall).replace(/\+/g, ' ');
    expect(decoded).toContain(`_wmkf_request_value eq ${REQUEST_ID}`);
  });

  // P2-A: GUID validation at every interpolation site.
  test('refuses a non-GUID source.akoya_requestid', async () => {
    const client = makeFakeClient({ suggestionListRows: [] });
    const deps = createReviewerSourceDependencies({ client, graph: makeFakeGraph(), markerColumnPresent: false });
    await expect(deps.discoverReviewers({ akoya_requestid: 'not-a-guid' }))
      .rejects.toMatchObject({ code: 'reviewer_source_invalid_identity' });
  });

  test('refuses a discovered suggestion with no (or a malformed) person id -- clearly, not a 400', async () => {
    const client = makeFakeClient({
      suggestionListRows: [{ wmkf_appreviewersuggestionid: SUGGESTION_ID, _wmkf_potentialreviewer_value: null }],
    });
    const deps = createReviewerSourceDependencies({ client, graph: makeFakeGraph(), markerColumnPresent: false });
    await expect(deps.discoverReviewers({ akoya_requestid: REQUEST_ID }))
      .rejects.toMatchObject({ code: 'reviewer_source_invalid_identity' });
  });

  test('refuses a discovered row with a malformed suggestion id', async () => {
    const client = makeFakeClient({
      suggestionListRows: [{ wmkf_appreviewersuggestionid: 'not-a-guid', _wmkf_potentialreviewer_value: PERSON_ID }],
    });
    const deps = createReviewerSourceDependencies({ client, graph: makeFakeGraph(), markerColumnPresent: false });
    await expect(deps.discoverReviewers({ akoya_requestid: REQUEST_ID }))
      .rejects.toMatchObject({ code: 'reviewer_source_invalid_identity' });
  });
});

describe('P2-A: GUID validation at hydration entry points', () => {
  test('hydrateReviewer refuses a malformed suggestionId', async () => {
    const client = makeFakeClient({});
    const deps = createReviewerSourceDependencies({ client, graph: makeFakeGraph(), markerColumnPresent: false });
    await expect(deps.hydrateReviewer({ suggestionId: 'bad', personId: PERSON_ID, requestId: REQUEST_ID }))
      .rejects.toMatchObject({ code: 'reviewer_source_invalid_identity' });
  });

  test('hydrateReviewer refuses a malformed personId', async () => {
    const client = makeFakeClient({});
    const deps = createReviewerSourceDependencies({ client, graph: makeFakeGraph(), markerColumnPresent: false });
    await expect(deps.hydrateReviewer({ suggestionId: SUGGESTION_ID, personId: 'bad', requestId: REQUEST_ID }))
      .rejects.toMatchObject({ code: 'reviewer_source_invalid_identity' });
  });

  test('readCurrentReviewerIdentity refuses a malformed requestId', async () => {
    const client = makeFakeClient({});
    const deps = createReviewerSourceDependencies({ client, graph: makeFakeGraph(), markerColumnPresent: false });
    await expect(deps.readCurrentReviewerIdentity({ suggestionId: SUGGESTION_ID, personId: PERSON_ID, requestId: 'bad' }))
      .rejects.toMatchObject({ code: 'reviewer_source_invalid_identity' });
  });
});

describe('P2-B: ownership check on every read, both passes', () => {
  test('hydrateReviewer refuses a suggestion belonging to a different request', async () => {
    const client = makeFakeClient({ suggestionRow: baseSuggestionRow({ _wmkf_request_value: OTHER_REQUEST_ID }) });
    const deps = createReviewerSourceDependencies({ client, graph: makeFakeGraph(), markerColumnPresent: false });
    await expect(deps.hydrateReviewer(ENTRY)).rejects.toMatchObject({ code: 'reviewer_source_invalid_identity' });
  });

  test('hydrateReviewer refuses a suggestion belonging to a different person', async () => {
    const client = makeFakeClient({ suggestionRow: baseSuggestionRow({ _wmkf_potentialreviewer_value: OTHER_PERSON_ID }) });
    const deps = createReviewerSourceDependencies({ client, graph: makeFakeGraph(), markerColumnPresent: false });
    await expect(deps.hydrateReviewer(ENTRY)).rejects.toMatchObject({ code: 'reviewer_source_invalid_identity' });
  });

  test('readCurrentReviewerIdentity refuses a suggestion belonging to a different request (second pass ownership)', async () => {
    const client = makeFakeClient({ suggestionRow: baseSuggestionRow({ _wmkf_request_value: OTHER_REQUEST_ID }) });
    const deps = createReviewerSourceDependencies({ client, graph: makeFakeGraph(), markerColumnPresent: false });
    await expect(deps.readCurrentReviewerIdentity(ENTRY)).rejects.toMatchObject({ code: 'reviewer_source_invalid_identity' });
  });

  test('readCurrentReviewerIdentity refuses a suggestion belonging to a different person (second pass ownership)', async () => {
    const client = makeFakeClient({ suggestionRow: baseSuggestionRow({ _wmkf_potentialreviewer_value: OTHER_PERSON_ID }) });
    const deps = createReviewerSourceDependencies({ client, graph: makeFakeGraph(), markerColumnPresent: false });
    await expect(deps.readCurrentReviewerIdentity(ENTRY)).rejects.toMatchObject({ code: 'reviewer_source_invalid_identity' });
  });
});

describe('hydrateReviewer', () => {
  test('markerColumnPresent=false: no marker in the person select, personIsSynthetic false, no address exported', async () => {
    const client = makeFakeClient({ suggestionRow: baseSuggestionRow(), personRow: basePersonRow(), answerRows: [baseAnswerRow()] });
    const deps = createReviewerSourceDependencies({ client, graph: makeFakeGraph({ files: [REVIEW_FILE] }), markerColumnPresent: false });
    const hydrated = await deps.hydrateReviewer(ENTRY);
    expect(hydrated.personIsSynthetic).toBe(false);
    expect(hydrated.person.wmkf_emailaddress).toBeNull();
    const personCall = client.calls.find((c) => c.includes('wmkf_potentialreviewerses'));
    expect(personCall).not.toMatch(/wmkf_issyntheticreviewer/);
  });

  test('markerColumnPresent=true and marker true: address exported, reviewForm uploaded, files hydrated', async () => {
    const client = makeFakeClient({
      suggestionRow: baseSuggestionRow(),
      personRow: basePersonRow({ wmkf_issyntheticreviewer: true }),
      answerRows: [baseAnswerRow()],
    });
    const deps = createReviewerSourceDependencies({ client, graph: makeFakeGraph({ files: [REVIEW_FILE] }), markerColumnPresent: true });
    const hydrated = await deps.hydrateReviewer(ENTRY);
    expect(hydrated.personIsSynthetic).toBe(true);
    expect(hydrated.person.wmkf_emailaddress).toBe('ada@example.edu');
    expect(hydrated.reviewForm).toBe('uploaded');
    expect(hydrated.files).toHaveLength(1);
    expect(hydrated.files[0].suggestionId).toBe(SUGGESTION_ID);
    expect(hydrated.files[0].contentHash).toMatch(/^[0-9a-f]{64}$/);
    const personCall = client.calls.find((c) => c.includes('wmkf_potentialreviewerses'));
    expect(decodeURIComponent(personCall)).toMatch(/wmkf_issyntheticreviewer/);
  });

  test('markerColumnPresent=true and marker false: no address exported even though the column is present', async () => {
    const client = makeFakeClient({
      suggestionRow: baseSuggestionRow(),
      personRow: basePersonRow({ wmkf_issyntheticreviewer: false }),
      answerRows: [baseAnswerRow()],
    });
    const deps = createReviewerSourceDependencies({ client, graph: makeFakeGraph({ files: [REVIEW_FILE] }), markerColumnPresent: true });
    const hydrated = await deps.hydrateReviewer(ENTRY);
    expect(hydrated.personIsSynthetic).toBe(false);
    expect(hydrated.person.wmkf_emailaddress).toBeNull();
  });

  test('unreceived review (no pointers, no stamp) hydrates with no files', async () => {
    const client = makeFakeClient({
      suggestionRow: baseSuggestionRow({ wmkf_reviewsharepointfolder: null, wmkf_reviewfilename: null, wmkf_reviewreceivedat: null }),
      personRow: basePersonRow(),
      answerRows: [],
    });
    const deps = createReviewerSourceDependencies({ client, graph: makeFakeGraph(), markerColumnPresent: false });
    const hydrated = await deps.hydrateReviewer(ENTRY);
    expect(hydrated.reviewForm).toBe('unreceived');
    expect(hydrated.files).toEqual([]);
  });

  // P3: the primary filename must actually be among the listed files.
  test('refuses when wmkf_reviewfilename is not among the listed files', async () => {
    const client = makeFakeClient({
      suggestionRow: baseSuggestionRow({ wmkf_reviewfilename: 'not-the-real-file.pdf' }),
      personRow: basePersonRow(),
      answerRows: [],
    });
    const deps = createReviewerSourceDependencies({ client, graph: makeFakeGraph({ files: [REVIEW_FILE] }), markerColumnPresent: false });
    await expect(deps.hydrateReviewer(ENTRY)).rejects.toThrow(/does not contain the primary filename/);
  });

  // P3: before/after re-verify mirrors hydrateSelectedDocument.
  test('refuses when the file changes between the pre-download read and the post-download re-read', async () => {
    const graph = makeFakeGraph({ files: [REVIEW_FILE] });
    let call = 0;
    const realGetMeta = graph.getFileMetadataById.bind(graph);
    graph.getFileMetadataById = async (driveId, itemId) => {
      call += 1;
      const meta = await realGetMeta(driveId, itemId);
      // Second call (the post-download re-read) reports a changed eTag.
      return call === 2 ? { ...meta, eTag: '"{ETAG},2"' } : meta;
    };
    const client = makeFakeClient({ suggestionRow: baseSuggestionRow(), personRow: basePersonRow(), answerRows: [] });
    const deps = createReviewerSourceDependencies({ client, graph, markerColumnPresent: false });
    await expect(deps.hydrateReviewer(ENTRY)).rejects.toThrow(/changed while its bytes were being verified/);
  });
});

describe('readCurrentReviewerIdentity', () => {
  test('returns the identity subset matching hydratedReviewerIdentity\'s shape', async () => {
    const client = makeFakeClient({ suggestionRow: baseSuggestionRow(), personRow: basePersonRow(), answerRows: [baseAnswerRow()] });
    const deps = createReviewerSourceDependencies({ client, graph: makeFakeGraph({ files: [REVIEW_FILE] }), markerColumnPresent: false });
    const identity = await deps.readCurrentReviewerIdentity(ENTRY);
    expect(identity).toEqual({
      suggestionId: SUGGESTION_ID,
      suggestionEtag: 'W/"sug-1"',
      personId: PERSON_ID,
      personEtag: 'W/"person-1"',
      answers: [{ questionKey: 'impact', eTag: 'W/"answer-1"' }],
      files: [{ graphItemId: '01REVIEW', eTag: '"{ETAG},1"', versionId: '1.0' }],
    });
  });

  // P3: the second pass must never download bytes.
  test('never calls downloadFile, even for an uploaded review', async () => {
    const client = makeFakeClient({ suggestionRow: baseSuggestionRow(), personRow: basePersonRow(), answerRows: [] });
    const graph = makeFakeGraph({ files: [REVIEW_FILE] });
    const downloadFile = jest.spyOn(graph, 'downloadFile');
    const deps = createReviewerSourceDependencies({ client, graph, markerColumnPresent: false });
    await deps.readCurrentReviewerIdentity(ENTRY);
    expect(downloadFile).not.toHaveBeenCalled();
  });
});

describe('end-to-end through exportTestRequestSourceBundle', () => {
  function documentDeps() {
    return {
      readSourceRow: jest.fn(async () => ({
        akoya_requestid: REQUEST_ID, akoya_requestnum: '1003222', akoya_requesttype: 100000001, versionnumber: 1,
      })),
      discoverDocuments: jest.fn(async () => ({ documents: [], errors: [] })),
      assertReadLimits: jest.fn(),
      hydrateDocument: jest.fn(),
      getDriveId: jest.fn(),
      getFileMetadataById: jest.fn(),
      readSourceRevision: jest.fn(async () => '1'),
    };
  }

  test('produces a v3 bundle with the reviewer wired for real (fake transports), file downloaded exactly once', async () => {
    const client = makeFakeClient({
      suggestionListRows: [{ wmkf_appreviewersuggestionid: SUGGESTION_ID, _wmkf_potentialreviewer_value: PERSON_ID }],
      suggestionRow: baseSuggestionRow(),
      personRow: basePersonRow(),
      answerRows: [baseAnswerRow()],
    });
    const graph = makeFakeGraph({ files: [REVIEW_FILE] });
    const downloadFile = jest.spyOn(graph, 'downloadFile');
    const deps = createReviewerSourceDependencies({ client, graph, markerColumnPresent: false });
    const bundle = await exportTestRequestSourceBundle(
      { sourceRequestNumber: '1003222', dataverseHost: 'wmkf.crm.dynamics.com', exportedAt: new Date('2026-09-23T12:00:00Z') },
      { ...documentDeps(), ...deps },
    );
    expect(bundle.version).toBe(3);
    expect(bundle.reviewers).toHaveLength(1);
    expect(bundle.reviewers[0].suggestionId).toBe(SUGGESTION_ID);
    // hydrateReviewer downloads once; readCurrentReviewerIdentity (the
    // fence's second pass) must not download again.
    expect(downloadFile).toHaveBeenCalledTimes(1);
  });

  test('the primary file (matching wmkf_reviewfilename) is ordered first, regardless of the folder listing order', async () => {
    const secondaryFile = { id: '01SECONDARY', name: 'appendix.pdf', mimeType: 'application/pdf', eTag: '"{SEC},1"', versionId: '1.0', buffer: Buffer.from('secondary bytes') };
    // The folder listing returns the secondary file BEFORE the primary one --
    // graph.listFiles carries no ordering guarantee.
    const graph = makeFakeGraph({ files: [secondaryFile, REVIEW_FILE] });
    const client = makeFakeClient({
      suggestionListRows: [{ wmkf_appreviewersuggestionid: SUGGESTION_ID, _wmkf_potentialreviewer_value: PERSON_ID }],
      suggestionRow: baseSuggestionRow({ wmkf_reviewfilename: 'review.pdf' }),
      personRow: basePersonRow(),
      answerRows: [baseAnswerRow()],
    });
    const deps = createReviewerSourceDependencies({ client, graph, markerColumnPresent: false });
    const hydrated = await deps.hydrateReviewer(ENTRY);
    expect(hydrated.files).toHaveLength(2);
    expect(hydrated.files[0].name).toBe('review.pdf');
    expect(hydrated.files[1].name).toBe('appendix.pdf');
  });

  test('a request with zero suggestions still gets a v3 bundle with an EMPTY reviewers array', async () => {
    const client = makeFakeClient({ suggestionListRows: [] });
    const deps = createReviewerSourceDependencies({ client, graph: makeFakeGraph(), markerColumnPresent: false });
    const bundle = await exportTestRequestSourceBundle(
      { sourceRequestNumber: '1003222', dataverseHost: 'wmkf.crm.dynamics.com', exportedAt: new Date('2026-09-23T12:00:00Z') },
      { ...documentDeps(), ...deps },
    );
    expect(bundle.version).toBe(3);
    expect(bundle.reviewers).toEqual([]);
  });
});
