/**
 * Create-only retained individual-review DOCX contract.
 *
 * @jest-environment node
 */

const graph = {
  getSiteId: jest.fn(),
  getDriveId: jest.fn(),
  getFileMetadataByPath: jest.fn(),
  uploadFile: jest.fn(),
  downloadFile: jest.fn(),
  getFileMetadataById: jest.fn(),
  deleteFile: jest.fn(),
};
jest.mock('../../lib/services/graph-service', () => ({
  SHAREPOINT_CANONICAL_SITE_URL: 'https://appriver3651007194.sharepoint.com/sites/akoyaGO',
  GraphService: graph,
}));

const hashGovernedDocxContent = jest.fn();
jest.mock('../../lib/services/initial-assessment/artifact-service', () => ({
  hashGovernedDocxContent: (...args) => hashGovernedDocxContent(...args),
}));

const buildIndividualReviewDocx = jest.fn();
jest.mock('../../lib/services/review-documents/individual-review-builder', () => ({
  buildIndividualReviewDocx: (...args) => buildIndividualReviewDocx(...args),
}));

const suggestion = {
  findReviewDocxFilingCandidates: jest.fn(),
  getByIdWithSelect: jest.fn(),
  isExcluded: jest.fn((row) => row.wmkf_applicantdisposition === 100000001),
  patchReviewReceipt: jest.fn(),
};
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => suggestion);

const getRequestById = jest.fn();
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({
  getById: (...args) => getRequestById(...args),
}));

const getReviewerById = jest.fn();
jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => ({
  getByIdWithSelect: (...args) => getReviewerById(...args),
}));

const fetchAnswersBySuggestion = jest.fn();
jest.mock('../../lib/services/review-answers', () => ({
  fetchAnswersBySuggestion: (...args) => fetchAnswersBySuggestion(...args),
}));

const assertDataverseOperationAllowed = jest.fn();
jest.mock('../../lib/dataverse/core/interlock', () => ({
  assertDataverseOperationAllowed: (...args) => assertDataverseOperationAllowed(...args),
  classifyDeployment: () => process.env.VERCEL_ENV === 'production' ? 'production' : 'local',
  resolveInterlockMode: () => process.env.DATAVERSE_TARGET_INTERLOCK || 'off',
}));

const recordEvent = jest.fn();
jest.mock('../../lib/services/operational-event-service', () => ({
  __esModule: true,
  default: { recordEvent: (...args) => recordEvent(...args) },
}));

const {
  buildGeneratedReviewPath,
  ensureIndividualReviewFile,
  inspectIndividualReviewFileCandidate,
  sweepMissingIndividualReviewFiles,
} = require('../../lib/services/review-documents/individual-file-service');

const SUGGESTION_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_SUGGESTION_ID = '44444444-4444-4444-8444-444444444444';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const REVIEWER_ID = '33333333-3333-4333-8333-333333333333';
const FOLDER = '1002903_22222222222242228222222222222222/Reviewer_Uploads/Generated/11111111111141118111111111111111';
const SECOND_FOLDER = '1002903_22222222222242228222222222222222/Reviewer_Uploads/Generated/44444444444444448444444444444444';
const FILENAME = 'Review-1002903.docx';
const DOCX = Buffer.from('generated-docx');
const ITEM = {
  siteId: 'site-1', driveId: 'drive-1', id: 'item-1', name: FILENAME,
  size: DOCX.length, eTag: 'item-etag', versionId: '1.0',
};
const ANSWERS = [{
  questionKey: 'q1', questionOrder: 1, questionText: 'Question one?',
  questionType: 'richtext', answerHtml: '<p>Answer.</p>', answerText: 'Answer.',
  answerValue: null, answerValues: null, answerValuesUnreadable: false,
  questionOptions: null, questionOptionsUnreadable: false,
}];

function baseRow(overrides = {}) {
  return {
    wmkf_appreviewersuggestionid: SUGGESTION_ID,
    _wmkf_request_value: REQUEST_ID,
    _wmkf_potentialreviewer_value: REVIEWER_ID,
    wmkf_reviewreceivedat: '2026-09-02T17:30:00.000Z',
    wmkf_selected: true,
    wmkf_applicantdisposition: null,
    wmkf_grantcyclecode: 'D26',
    wmkf_reviewsharepointfolder: null,
    wmkf_reviewfilename: null,
    _etag: 'W/"1"',
    ...overrides,
  };
}

function exactPointer(overrides = {}) {
  return baseRow({
    wmkf_reviewsharepointfolder: FOLDER,
    wmkf_reviewfilename: FILENAME,
    _etag: 'W/"2"',
    ...overrides,
  });
}

const OLD_ENV = process.env;
beforeEach(() => {
  jest.clearAllMocks();
  process.env = {
    ...OLD_ENV,
    VERCEL_ENV: 'production',
    DATAVERSE_TARGET_INTERLOCK: 'on',
    REVIEW_DOCX_SHAREPOINT_WRITE: 'on',
    REVIEW_DOCX_SHAREPOINT_CYCLE: 'D26',
    SHAREPOINT_SITE_URL: 'https://appriver3651007194.sharepoint.com/sites/akoyaGO',
    DYNAMICS_URL: 'https://wmkf.crm.dynamics.com',
  };
  suggestion.getByIdWithSelect.mockResolvedValue(baseRow());
  getRequestById.mockResolvedValue({
    akoya_requestid: REQUEST_ID,
    akoya_requestnum: '1002903',
    akoya_title: 'Proposal',
    wmkf_organizationname: 'University',
    wmkf_meetingdate: '2026-12-03T00:00:00Z',
  });
  getReviewerById.mockResolvedValue({ wmkf_potentialreviewersid: REVIEWER_ID, wmkf_name: 'Reviewer' });
  fetchAnswersBySuggestion.mockResolvedValue({ [SUGGESTION_ID]: ANSWERS });
  buildIndividualReviewDocx.mockResolvedValue({
    filename: FILENAME,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    content: DOCX,
  });
  hashGovernedDocxContent.mockResolvedValue('gdc1:semantic-hash');
  graph.getSiteId.mockResolvedValue('site-1');
  graph.getDriveId.mockResolvedValue('drive-1');
  graph.getFileMetadataByPath.mockResolvedValue(null);
  graph.uploadFile.mockResolvedValue(ITEM);
  graph.downloadFile.mockResolvedValue({ buffer: DOCX, filename: FILENAME, size: DOCX.length });
  graph.getFileMetadataById.mockResolvedValue(ITEM);
  graph.deleteFile.mockResolvedValue(undefined);
  suggestion.patchReviewReceipt.mockResolvedValue(undefined);
  recordEvent.mockResolvedValue(null);
});
afterEach(() => { process.env = OLD_ENV; });

test('builds the deterministic Generated path from server-owned identities', () => {
  expect(buildGeneratedReviewPath({
    requestId: REQUEST_ID,
    requestNumber: '1002903',
    suggestionId: SUGGESTION_ID,
  })).toEqual({ folder: FOLDER, filename: FILENAME });
});

test('classifies complete and partial pointers before rendering or Graph access', async () => {
  suggestion.getByIdWithSelect.mockResolvedValueOnce(exactPointer());
  await expect(inspectIndividualReviewFileCandidate(SUGGESTION_ID, { cycleCode: 'D26' }))
    .resolves.toMatchObject({ status: 'already_filed' });

  suggestion.getByIdWithSelect.mockResolvedValueOnce(baseRow({ wmkf_reviewfilename: FILENAME }));
  await expect(inspectIndividualReviewFileCandidate(SUGGESTION_ID, { cycleCode: 'D26' }))
    .resolves.toMatchObject({ status: 'partial_pointer' });
  expect(buildIndividualReviewDocx).not.toHaveBeenCalled();
  expect(graph.getFileMetadataByPath).not.toHaveBeenCalled();
});

test('requires a rich-text row and rejects malformed self-describing snapshots', async () => {
  fetchAnswersBySuggestion.mockResolvedValueOnce({
    [SUGGESTION_ID]: [{ ...ANSWERS[0], questionType: 'picklist', answerValue: 1 }],
  });
  await expect(inspectIndividualReviewFileCandidate(SUGGESTION_ID, { cycleCode: 'D26' }))
    .resolves.toMatchObject({ status: 'not_structured' });

  fetchAnswersBySuggestion.mockResolvedValueOnce({
    [SUGGESTION_ID]: [ANSWERS[0], { ...ANSWERS[0] }],
  });
  await expect(inspectIndividualReviewFileCandidate(SUGGESTION_ID, { cycleCode: 'D26' }))
    .resolves.toMatchObject({ status: 'invalid_snapshot', error: { code: 'invalid_snapshot' } });
});

test('literal-off flag reaches no Graph mutation or pointer write', async () => {
  process.env.REVIEW_DOCX_SHAREPOINT_WRITE = 'off';
  const result = await ensureIndividualReviewFile(SUGGESTION_ID, { cycleCode: 'D26' });
  expect(result).toMatchObject({ status: 'target_guard_failed', error: { code: 'write_disabled' } });
  expect(graph.uploadFile).not.toHaveBeenCalled();
  expect(suggestion.patchReviewReceipt).not.toHaveBeenCalled();
});

test('creates with conflictBehavior=fail, conditionally commits exact pointers, and verifies by stable id', async () => {
  suggestion.getByIdWithSelect
    .mockResolvedValueOnce(baseRow())
    .mockResolvedValueOnce(exactPointer())
    .mockResolvedValueOnce(exactPointer());

  const result = await ensureIndividualReviewFile(SUGGESTION_ID, { cycleCode: 'D26' });
  expect(result).toMatchObject({ status: 'created', semanticHash: 'gdc1:semantic-hash', item: { id: 'item-1' } });
  expect(buildIndividualReviewDocx).toHaveBeenCalledWith(expect.objectContaining({
    generatedAtIso: '2026-09-02T17:30:00.000Z',
    answerSnapshot: ANSWERS,
  }));
  expect(graph.uploadFile).toHaveBeenCalledWith(
    'akoya_request', FOLDER, FILENAME, DOCX, expect.any(String),
    { conflictBehavior: 'fail', siteId: 'site-1', driveId: 'drive-1' },
  );
  expect(suggestion.patchReviewReceipt).toHaveBeenCalledWith(SUGGESTION_ID, {
    wmkf_reviewsharepointfolder: FOLDER,
    wmkf_reviewfilename: FILENAME,
  }, { ifMatch: 'W/"1"' });
  expect(assertDataverseOperationAllowed).toHaveBeenCalledWith(expect.objectContaining({
    method: 'PATCH',
    url: `https://wmkf.crm.dynamics.com/api/data/v9.2/wmkf_appreviewersuggestions(${SUGGESTION_ID})`,
  }));
});

test('reconciles matching pre-existing content without overwriting it', async () => {
  graph.getFileMetadataByPath.mockResolvedValue(ITEM);
  suggestion.getByIdWithSelect
    .mockResolvedValueOnce(baseRow())
    .mockResolvedValueOnce(exactPointer())
    .mockResolvedValueOnce(exactPointer());
  const result = await ensureIndividualReviewFile(SUGGESTION_ID, { cycleCode: 'D26' });
  expect(result.status).toBe('reconciled');
  expect(graph.uploadFile).not.toHaveBeenCalled();
  expect(graph.deleteFile).not.toHaveBeenCalled();
});

test('reconciles a create race after Graph reports a 409 conflict', async () => {
  const conflict = Object.assign(new Error('name already exists'), { status: 409 });
  graph.getFileMetadataByPath
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(ITEM);
  graph.uploadFile.mockRejectedValueOnce(conflict);
  suggestion.getByIdWithSelect
    .mockResolvedValueOnce(baseRow())
    .mockResolvedValueOnce(exactPointer())
    .mockResolvedValueOnce(exactPointer());

  const result = await ensureIndividualReviewFile(SUGGESTION_ID, { cycleCode: 'D26' });

  expect(result.status).toBe('reconciled');
  expect(graph.uploadFile).toHaveBeenCalledTimes(1);
  expect(graph.downloadFile).toHaveBeenCalledWith('drive-1', 'item-1');
  expect(graph.deleteFile).not.toHaveBeenCalled();
});

test('leaves divergent pre-existing content untouched and does not write pointers', async () => {
  graph.getFileMetadataByPath.mockResolvedValue(ITEM);
  hashGovernedDocxContent
    .mockResolvedValueOnce('gdc1:expected')
    .mockResolvedValueOnce('gdc1:different');
  const result = await ensureIndividualReviewFile(SUGGESTION_ID, { cycleCode: 'D26' });
  expect(result.status).toBe('content_conflict');
  expect(graph.uploadFile).not.toHaveBeenCalled();
  expect(graph.deleteFile).not.toHaveBeenCalled();
  expect(suggestion.patchReviewReceipt).not.toHaveBeenCalled();
});

test('accepts a lost pointer response when exact pointers are visible on reread', async () => {
  const lost = Object.assign(new Error('socket reset'), { noResponse: true });
  suggestion.patchReviewReceipt.mockRejectedValueOnce(lost);
  suggestion.getByIdWithSelect
    .mockResolvedValueOnce(baseRow())
    .mockResolvedValueOnce(exactPointer())
    .mockResolvedValueOnce(exactPointer());
  const result = await ensureIndividualReviewFile(SUGGESTION_ID, { cycleCode: 'D26' });
  expect(result.status).toBe('created');
  expect(suggestion.patchReviewReceipt).toHaveBeenCalledTimes(1);
  expect(graph.deleteFile).not.toHaveBeenCalled();
});

test('deletes only the item created by this invocation when a different pointer wins', async () => {
  const conflict = Object.assign(new Error('precondition'), { status: 412 });
  suggestion.patchReviewReceipt.mockRejectedValueOnce(conflict);
  suggestion.getByIdWithSelect
    .mockResolvedValueOnce(baseRow())
    .mockResolvedValueOnce(exactPointer({
      wmkf_reviewsharepointfolder: 'other/folder',
      wmkf_reviewfilename: 'other.docx',
    }));
  const result = await ensureIndividualReviewFile(SUGGESTION_ID, { cycleCode: 'D26' });
  expect(result.status).toBe('pointer_conflict');
  expect(graph.deleteFile).toHaveBeenCalledWith('drive-1', 'item-1');
});

test('retries a still-empty pointer once, then retains the candidate item for repair', async () => {
  const conflict = Object.assign(new Error('precondition'), { status: 412 });
  suggestion.patchReviewReceipt.mockRejectedValue(conflict);
  suggestion.getByIdWithSelect
    .mockResolvedValueOnce(baseRow())
    .mockResolvedValueOnce(baseRow({ _etag: 'W/"2"' }))
    .mockResolvedValueOnce(baseRow({ _etag: 'W/"3"' }));
  const result = await ensureIndividualReviewFile(SUGGESTION_ID, { cycleCode: 'D26' });
  expect(result.status).toBe('pointer_write_failed');
  expect(suggestion.patchReviewReceipt).toHaveBeenCalledTimes(2);
  expect(graph.deleteFile).not.toHaveBeenCalled();
});

test('disabled sweep performs no Dataverse candidate read and no Graph call', async () => {
  process.env.REVIEW_DOCX_SHAREPOINT_WRITE = '';
  const result = await sweepMissingIndividualReviewFiles();
  expect(result).toMatchObject({ status: 'disabled', scanned: 0, attempted: 0 });
  expect(suggestion.findReviewDocxFilingCandidates).not.toHaveBeenCalled();
  expect(graph.getSiteId).not.toHaveBeenCalled();
  expect(graph.uploadFile).not.toHaveBeenCalled();
});

test('target preflight fails closed before upload outside Production', async () => {
  process.env.VERCEL_ENV = 'preview';
  const result = await ensureIndividualReviewFile(SUGGESTION_ID, { cycleCode: 'D26' });
  expect(result).toMatchObject({ status: 'target_guard_failed', error: { code: 'scheduled_not_production' } });
  expect(graph.getSiteId).not.toHaveBeenCalled();
  expect(graph.uploadFile).not.toHaveBeenCalled();
});

test('target preflight fails closed before Graph resolution when the interlock is not enforcing', async () => {
  process.env.DATAVERSE_TARGET_INTERLOCK = 'warn';
  const result = await ensureIndividualReviewFile(SUGGESTION_ID, { cycleCode: 'D26' });
  expect(result).toMatchObject({ status: 'target_guard_failed', error: { code: 'interlock_not_enforcing' } });
  expect(graph.getSiteId).not.toHaveBeenCalled();
  expect(graph.uploadFile).not.toHaveBeenCalled();
});

test('target preflight rejects a noncanonical SharePoint site before Graph resolution', async () => {
  process.env.SHAREPOINT_SITE_URL = 'https://appriver3651007194.sharepoint.com/sites/other';
  const result = await ensureIndividualReviewFile(SUGGESTION_ID, { cycleCode: 'D26' });
  expect(result).toMatchObject({ status: 'target_guard_failed', error: { code: 'sharepoint_target_mismatch' } });
  expect(graph.getSiteId).not.toHaveBeenCalled();
  expect(graph.uploadFile).not.toHaveBeenCalled();
});

test('ineligible scanned rows do not consume the mutation attempt cap or starve a later eligible row', async () => {
  suggestion.findReviewDocxFilingCandidates.mockResolvedValue({
    records: [
      { wmkf_appreviewersuggestionid: SUGGESTION_ID },
      { wmkf_appreviewersuggestionid: SECOND_SUGGESTION_ID },
    ],
    capped: false,
  });
  suggestion.getByIdWithSelect
    // Inspect first: structured snapshot absent.
    .mockResolvedValueOnce(baseRow())
    // Inspect second: eligible.
    .mockResolvedValueOnce(baseRow({ wmkf_appreviewersuggestionid: SECOND_SUGGESTION_ID }))
    // Ensure second: authoritative re-read.
    .mockResolvedValueOnce(baseRow({ wmkf_appreviewersuggestionid: SECOND_SUGGESTION_ID }))
    // Pointer readback and final readback.
    .mockResolvedValueOnce(exactPointer({
      wmkf_appreviewersuggestionid: SECOND_SUGGESTION_ID,
      wmkf_reviewsharepointfolder: SECOND_FOLDER,
    }))
    .mockResolvedValueOnce(exactPointer({
      wmkf_appreviewersuggestionid: SECOND_SUGGESTION_ID,
      wmkf_reviewsharepointfolder: SECOND_FOLDER,
    }));
  fetchAnswersBySuggestion
    // Discovery includes both based on their stored rich-text rows. The first
    // becomes ineligible on its fresh inspection read.
    .mockResolvedValueOnce({ [SUGGESTION_ID]: ANSWERS, [SECOND_SUGGESTION_ID]: ANSWERS })
    .mockResolvedValueOnce({ [SUGGESTION_ID]: [] })
    .mockResolvedValueOnce({ [SECOND_SUGGESTION_ID]: ANSWERS })
    .mockResolvedValueOnce({ [SECOND_SUGGESTION_ID]: ANSWERS });

  const result = await sweepMissingIndividualReviewFiles({ scanCap: 10, attemptCap: 1 });
  expect(result).toMatchObject({
    status: 'completed',
    scanned: 2,
    attempted: 1,
    counts: { not_structured: 1, created: 1 },
  });
  expect(result.results.map((row) => row.status)).toEqual(['not_structured', 'created']);
  expect(graph.uploadFile).toHaveBeenCalledTimes(1);
});
