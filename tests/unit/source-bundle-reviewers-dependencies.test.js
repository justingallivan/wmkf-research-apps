/**
 * @jest-environment node
 *
 * P2-5 (Opus round 1): the real reviewer dependency triad
 * (createReviewerSourceDependencies) wired for exportTestRequestSourceBundle.
 * Fake Dataverse (client.get) and Graph transports only -- never live.
 */
import { createReviewerSourceDependencies } from '../../lib/services/test-requests/source-bundle-reviewers.js';
import { exportTestRequestSourceBundle } from '../../lib/services/test-requests/source-bundle.js';

const REQUEST_ID = 'e43ae6ea-698f-f111-8076-6045bd018a07';
const SUGGESTION_ID = 'c3f00000-1111-2222-3333-444455556666';
const PERSON_ID = 'd4f00000-1111-2222-3333-444455556666';

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
    async getDriveId() { return 'b!drive-id'; },
    async listFiles() { return files.map(({ buffer, ...rest }) => rest); },
    async getFileMetadataById(driveId, itemId) {
      const file = files.find((f) => f.id === itemId);
      return { id: file.id, name: file.name, size: file.buffer.length, mimeType: file.mimeType, eTag: file.eTag, versionId: file.versionId };
    },
    async downloadFile(driveId, itemId) {
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

afterEach(() => { delete process.env.SYNTHETIC_REVIEWER_ISOLATION; });

describe('discoverReviewers', () => {
  test('returns the (suggestionId, personId) pairs for the request', async () => {
    const client = makeFakeClient({
      suggestionListRows: [{ wmkf_appreviewersuggestionid: SUGGESTION_ID, _wmkf_potentialreviewer_value: PERSON_ID }],
    });
    const deps = createReviewerSourceDependencies({ client, graph: makeFakeGraph() });
    const result = await deps.discoverReviewers({ akoya_requestid: REQUEST_ID });
    expect(result.errors).toEqual([]);
    expect(result.reviewers).toEqual([{ suggestionId: SUGGESTION_ID, personId: PERSON_ID }]);
  });

  test('refuses a continuation link (bounded read) rather than silently paging', async () => {
    const client = makeFakeClient({
      suggestionListRows: [{ wmkf_appreviewersuggestionid: SUGGESTION_ID, _wmkf_potentialreviewer_value: PERSON_ID }],
      suggestionListNextLink: true,
    });
    const deps = createReviewerSourceDependencies({ client, graph: makeFakeGraph() });
    await expect(deps.discoverReviewers({ akoya_requestid: REQUEST_ID })).rejects.toThrow(/bounded read limit/);
  });
});

describe('hydrateReviewer', () => {
  test('with the switch OFF: no marker in the person select, personIsSynthetic false, no address exported', async () => {
    const client = makeFakeClient({ suggestionRow: baseSuggestionRow(), personRow: basePersonRow(), answerRows: [baseAnswerRow()] });
    const deps = createReviewerSourceDependencies({ client, graph: makeFakeGraph({ files: [REVIEW_FILE] }) });
    const hydrated = await deps.hydrateReviewer({ suggestionId: SUGGESTION_ID, personId: PERSON_ID });
    expect(hydrated.personIsSynthetic).toBe(false);
    expect(hydrated.person.wmkf_emailaddress).toBeNull();
    const personCall = client.calls.find((c) => c.includes('wmkf_potentialreviewerses'));
    expect(personCall).not.toMatch(/wmkf_issyntheticreviewer/);
  });

  test('with the switch ON and marker true: address exported, reviewForm uploaded, files hydrated', async () => {
    process.env.SYNTHETIC_REVIEWER_ISOLATION = 'on';
    const client = makeFakeClient({
      suggestionRow: baseSuggestionRow(),
      personRow: basePersonRow({ wmkf_issyntheticreviewer: true }),
      answerRows: [baseAnswerRow()],
    });
    const deps = createReviewerSourceDependencies({ client, graph: makeFakeGraph({ files: [REVIEW_FILE] }) });
    const hydrated = await deps.hydrateReviewer({ suggestionId: SUGGESTION_ID, personId: PERSON_ID });
    expect(hydrated.personIsSynthetic).toBe(true);
    expect(hydrated.person.wmkf_emailaddress).toBe('ada@example.edu');
    expect(hydrated.reviewForm).toBe('uploaded');
    expect(hydrated.files).toHaveLength(1);
    expect(hydrated.files[0].suggestionId).toBe(SUGGESTION_ID);
    expect(hydrated.files[0].contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('with the switch ON and marker false: no address exported even though the switch is on', async () => {
    process.env.SYNTHETIC_REVIEWER_ISOLATION = 'on';
    const client = makeFakeClient({
      suggestionRow: baseSuggestionRow(),
      personRow: basePersonRow({ wmkf_issyntheticreviewer: false }),
      answerRows: [baseAnswerRow()],
    });
    const deps = createReviewerSourceDependencies({ client, graph: makeFakeGraph({ files: [REVIEW_FILE] }) });
    const hydrated = await deps.hydrateReviewer({ suggestionId: SUGGESTION_ID, personId: PERSON_ID });
    expect(hydrated.personIsSynthetic).toBe(false);
    expect(hydrated.person.wmkf_emailaddress).toBeNull();
  });

  test('unreceived review (no pointers, no stamp) hydrates with no files', async () => {
    const client = makeFakeClient({
      suggestionRow: baseSuggestionRow({ wmkf_reviewsharepointfolder: null, wmkf_reviewfilename: null, wmkf_reviewreceivedat: null }),
      personRow: basePersonRow(),
      answerRows: [],
    });
    const deps = createReviewerSourceDependencies({ client, graph: makeFakeGraph() });
    const hydrated = await deps.hydrateReviewer({ suggestionId: SUGGESTION_ID, personId: PERSON_ID });
    expect(hydrated.reviewForm).toBe('unreceived');
    expect(hydrated.files).toEqual([]);
  });
});

describe('readCurrentReviewerIdentity', () => {
  test('returns the identity subset matching hydratedReviewerIdentity\'s shape', async () => {
    const client = makeFakeClient({ suggestionRow: baseSuggestionRow(), personRow: basePersonRow(), answerRows: [baseAnswerRow()] });
    const deps = createReviewerSourceDependencies({ client, graph: makeFakeGraph({ files: [REVIEW_FILE] }) });
    const identity = await deps.readCurrentReviewerIdentity({ suggestionId: SUGGESTION_ID, personId: PERSON_ID });
    expect(identity).toEqual({
      suggestionId: SUGGESTION_ID,
      suggestionEtag: 'W/"sug-1"',
      personId: PERSON_ID,
      personEtag: 'W/"person-1"',
      answers: [{ questionKey: 'impact', eTag: 'W/"answer-1"' }],
      files: [{ graphItemId: '01REVIEW', eTag: '"{ETAG},1"', versionId: '1.0' }],
    });
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

  test('produces a v3 bundle with the reviewer wired for real (fake transports)', async () => {
    const client = makeFakeClient({
      suggestionListRows: [{ wmkf_appreviewersuggestionid: SUGGESTION_ID, _wmkf_potentialreviewer_value: PERSON_ID }],
      suggestionRow: baseSuggestionRow(),
      personRow: basePersonRow(),
      answerRows: [baseAnswerRow()],
    });
    const deps = createReviewerSourceDependencies({ client, graph: makeFakeGraph({ files: [REVIEW_FILE] }) });
    const bundle = await exportTestRequestSourceBundle(
      { sourceRequestNumber: '1003222', dataverseHost: 'wmkf.crm.dynamics.com', exportedAt: new Date('2026-09-23T12:00:00Z') },
      { ...documentDeps(), ...deps },
    );
    expect(bundle.version).toBe(3);
    expect(bundle.reviewers).toHaveLength(1);
    expect(bundle.reviewers[0].suggestionId).toBe(SUGGESTION_ID);
  });

  test('a request with zero suggestions still gets a v3 bundle with an EMPTY reviewers array', async () => {
    const client = makeFakeClient({ suggestionListRows: [] });
    const deps = createReviewerSourceDependencies({ client, graph: makeFakeGraph() });
    const bundle = await exportTestRequestSourceBundle(
      { sourceRequestNumber: '1003222', dataverseHost: 'wmkf.crm.dynamics.com', exportedAt: new Date('2026-09-23T12:00:00Z') },
      { ...documentDeps(), ...deps },
    );
    expect(bundle.version).toBe(3);
    expect(bundle.reviewers).toEqual([]);
  });
});
