/** @jest-environment node */
/**
 * Stage 0: real receipt producers → actual Dataverse HTTP payloads → real DTO
 * → real closeout. External OAuth, Graph, and PostgreSQL are isolated only at
 * their boundary. This does not exercise route auth or a live Dataverse server.
 */
jest.mock('@vercel/postgres', () => ({
  sql: jest.fn(() => { throw new Error('Unexpected PostgreSQL access in receipt harness'); }),
}));
jest.mock('../../lib/services/review-draft-service', () => ({
  __esModule: true, default: { deleteBySuggestion: jest.fn(async () => 1) },
}));
jest.mock('../../lib/services/review-synthesis-job-service', () => ({
  getReviewSynthesisJobState: jest.fn(async () => ({ current: false, status: 'idle', attempts: 0 })),
}));
jest.mock('../../lib/services/reviewer-acceptance-job-service', () => ({
  cancelReviewerAcceptanceJobsForSuggestion: jest.fn(async () => []),
}));

import { DynamicsService } from '../../lib/services/dynamics-service';
import { GraphService } from '../../lib/services/graph-service';
import ReviewDraftService from '../../lib/services/review-draft-service';
import { withDalContext } from '../../lib/dataverse/core/context';
import * as suggestions from '../../lib/dataverse/adapters/reviewer-suggestion';
import { submitReview } from '../../lib/services/external-review/submit-service';
import { submitManualReviewEntry } from '../../lib/services/review-manager/manual-review-entry-service';
import { writeReviewFiles } from '../../lib/services/review-upload';
import { markReceivedNoFile } from '../../lib/services/review-manager/mark-received-no-file-service';
import { getReviewers } from '../../lib/services/review-manager/reviewers-service';
import { closeReview } from '../../lib/services/review-manager/close-review-service';
import { transitionReviewersTerminal } from '../../lib/services/review-manager/terminal-transition-service';
import { sendOneThankYou } from '../../lib/services/reviewer-thankyou-sweep';
import { ensureIndividualReviewFile } from '../../lib/services/review-documents/individual-file-service';
import { PRODUCTION_HOSTS } from '../../lib/dataverse/core/target-registry';
import { sql } from '@vercel/postgres';
import { invalidate, questionSetVersion } from '../../lib/external/review-question-fetcher';
import { REVIEW_STATUS_MAP, HONORARIUM_ELIGIBILITY_MAP, RESPONSE_TYPE_MAP } from '../../shared/config/reviewerLifecycle';
import { createReviewerEngagementTransport } from '../helpers/reviewer-engagement-transport';

const SET = 'wmkf_appreviewersuggestions';
const ANSWER_SET = 'wmkf_appreviewanswers';
const ID = '11111111-1111-4111-8111-111111111111';
const REQUEST = '22222222-2222-4222-8222-222222222222';
const PERSON = '33333333-3333-4333-8333-333333333333';
const HONORARIUM = '44444444-4444-4444-8444-444444444444';
const ACTOR = '55555555-5555-4555-8555-555555555555';
const RECEIVED_AT = '2026-08-30T12:00:00.000Z';
const QUESTIONS = [
  { key: 'affiliation', order: 0, label: 'Affiliation', type: 'string', required: true, maxLength: 500 },
  { key: 'impactAreas', order: 1, label: 'Impact areas', type: 'multiselect', required: true, options: [{ value: 1, label: 'Tools' }, { value: 3, label: 'Broad interest' }] },
  { key: 'riskLevel', order: 2, label: 'Risk', type: 'picklist', required: true, options: [{ value: 1, label: 'Low' }, { value: 2, label: 'Medium' }] },
  { key: 'overallAssessment', order: 3, label: 'Overall', type: 'picklist', required: true, options: [{ value: 4, label: 'Excellent' }] },
  { key: 'comments', order: 4, label: 'Comments', type: 'richtext', required: true, maxLength: 5000 },
];
const ANSWERS = { affiliation: 'Example University', impactAreas: [3, 1], riskLevel: 2, overallAssessment: 4, comments: '<p>Strong <script>alert(1)</script>proposal.</p>' };
const VERSION = questionSetVersion(QUESTIONS);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7'), Buffer.alloc(50, 32)]);
const ENV_KEYS = ['DYNAMICS_URL', 'DATAVERSE_TARGET_INTERLOCK', 'DYNAMICS_IMPERSONATION_ENABLED', 'VIRUS_SCAN_ENABLED', 'VERCEL_ENV', 'REVIEW_DOCX_SHAREPOINT_WRITE', 'SHAREPOINT_SITE_URL'];
let originalEnv;
let transport;
let errorSpy;
let transports;
const inContext = (operation) => withDalContext('stage0-receipt-contract', operation);
const writes = () => transport.requests.filter((request) => request.method !== 'GET');

function suggestion(fields = {}) {
  return {
    wmkf_appreviewersuggestionid: ID, _wmkf_request_value: REQUEST, _wmkf_potentialreviewer_value: PERSON,
    _wmkf_honorariumrequest_value: HONORARIUM, wmkf_selected: true, wmkf_accepted: true,
    wmkf_declined: false, wmkf_reviewstatus: REVIEW_STATUS_MAP.materials_sent,
    wmkf_responsetype: RESPONSE_TYPE_MAP.accepted, wmkf_reviewreceivedat: null,
    wmkf_completedat: null, wmkf_materialssentat: '2026-08-01T12:00:00.000Z',
    wmkf_Request: { akoya_requestid: REQUEST, akoya_requestnum: '1001289' },
    wmkf_PotentialReviewer: { wmkf_lastname: 'Reviewer', wmkf_name: 'Sample Reviewer' },
    ...fields,
  };
}

function initialize(fields = {}) {
  transport = createReviewerEngagementTransport({
    [SET]: [suggestion(fields)],
    akoya_requests: [
      { akoya_requestid: REQUEST, akoya_requestnum: '1001289', akoya_title: 'Lifecycle contract', wmkf_meetingdate: '2026-12-01' },
      { akoya_requestid: HONORARIUM, akoya_requestnum: 'HON-1', wmkf_authorizationtoremitpaymentflag: false },
    ],
    wmkf_potentialreviewerses: [{ wmkf_potentialreviewersid: PERSON, wmkf_name: 'Sample Reviewer', wmkf_emailaddress: 'reviewer@example.test' }],
    wmkf_reviewquestions: QUESTIONS.map((question, index) => ({
      wmkf_reviewquestionid: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      statecode: 0, wmkf_questionkey: question.key, wmkf_questionorder: question.order,
      wmkf_questiontext: question.label, wmkf_questiontype: question.type, wmkf_required: question.required,
      wmkf_maxlength: question.maxLength, wmkf_options: question.options ? JSON.stringify(question.options) : null,
    })),
  }, { origin: process.env.DYNAMICS_URL });
  transports.push(transport);
  global.fetch.mockImplementation(transport.fetch);
  invalidate();
}

beforeEach(() => {
  jest.clearAllMocks();
  originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.DYNAMICS_URL = 'https://reviewer-harness.invalid';
  // Synthetic hostname, with no external networking. The actual DAL context
  // guard remains on and is exercised separately below.
  process.env.DATAVERSE_TARGET_INTERLOCK = 'off';
  process.env.DYNAMICS_IMPERSONATION_ENABLED = 'true';
  process.env.VIRUS_SCAN_ENABLED = 'false';
  jest.spyOn(DynamicsService, 'getAccessToken').mockResolvedValue('fixture-oauth-token');
  jest.spyOn(GraphService, 'getDriveId').mockResolvedValue('fixture-drive');
  jest.spyOn(GraphService, 'uploadFile').mockResolvedValue({ id: 'fixture-file', name: 'review.pdf' });
  jest.spyOn(GraphService, 'deleteFile').mockResolvedValue(undefined);
  jest.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = jest.spyOn(console, 'error');
  transports = [];
  initialize();
});

afterEach(() => {
  try {
    for (const instance of transports) expect(instance.unexpectedRequests).toEqual([]);
    expect(sql).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  } finally {
    jest.restoreAllMocks();
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
    invalidate();
  }
});

const PRODUCERS = [
  ['external full', 4, false, () => submitReview({ suggestion: transport.get(SET, ID), body: { answers: ANSWERS, setVersion: VERSION } })],
  ['staff full', 4, true, () => submitManualReviewEntry({ suggestionId: ID, answers: ANSWERS, setVersion: VERSION, actingUserSystemId: ACTOR })],
  ['staff file upload', 3, true, () => writeReviewFiles({ suggestionId: ID, files: [{ filename: 'review.pdf', buffer: PDF }], structuredData: ANSWERS, opts: { source: 'staff_upload', actingUserSystemId: ACTOR } })],
  ['external file upload', 3, false, () => writeReviewFiles({ suggestionId: ID, files: [{ filename: 'review.pdf', buffer: PDF }], structuredData: ANSWERS, opts: { source: 'reviewer_self_token' } })],
  ['partial no-file', 1, true, () => markReceivedNoFile({ suggestionId: ID, structuredData: { riskLevel: 2 }, actingUserSystemId: ACTOR })],
  ['empty no-file', 0, true, () => markReceivedNoFile({ suggestionId: ID, actingUserSystemId: ACTOR })],
];
const dto = async () => {
  const result = await inContext(() => getReviewers({ proposalId: REQUEST }));
  expect(result.totalReviewers).toBe(1);
  return result.proposals[0].reviewers[0];
};
const close = (extra = {}) => inContext(() => closeReview({ suggestionId: ID, authorizedRequestId: REQUEST, disposition: 'eligible', actingUserSystemId: ACTOR, ...extra }));

test.each(PRODUCERS)('%s commits receipt → real GET DTO → conditional closeout without inventing answers', async (_name, answerCount, staff, produce) => {
  const initialTag = transport.get(SET, ID)._etag;
  const honorariumBefore = transport.get('akoya_requests', HONORARIUM);
  expect(await inContext(produce)).toMatchObject({ ok: true });
  const stored = transport.get(SET, ID);
  expect(stored).toMatchObject({ wmkf_reviewstatus: REVIEW_STATUS_MAP.review_received, wmkf_reviewreceivedat: expect.any(String), wmkf_completedat: null });
  expect(stored.wmkf_reviewuploadedbystaff === true).toBe(staff);
  expect(transport.rows(ANSWER_SET)).toHaveLength(answerCount);
  const receiptWrite = writes()[0];
  const parent = receiptWrite.operations?.at(-1) || receiptWrite;
  expect(parent.headers['If-Match']).toBe(initialTag);
  expect(parent.body.wmkf_reviewstatus).toBe(REVIEW_STATUS_MAP.review_received);
  expect(receiptWrite.headers.MSCRMCallerID).toBe(staff ? ACTOR : undefined);
  if (answerCount) expect(receiptWrite.operations).toHaveLength(answerCount + 1);
  else expect(receiptWrite.method).toBe('PATCH');

  const received = await dto();
  expect(received).toMatchObject({ reviewStatus: 'review_received', responseType: 'accepted', submitted: true, completedAt: null, honorariumEligibility: null });
  expect(received.answers).toHaveLength(answerCount);
  expect(received.reviewerRiskLevel).toBe(answerCount ? 2 : null);
  expect(received.reviewerOverallAssessment).toBe(answerCount >= 3 ? 4 : null);
  expect(received.answers.some((answer) => answer.questionKey === 'comments')).toBe(answerCount === 4);
  if (answerCount === 4) expect(received.answers.find((answer) => answer.questionKey === 'comments').answerHtml).toBe('<p>Strong proposal.</p>');

  const result = await close();
  expect(result.status).toBe('closed');
  expect(transport.get(SET, ID)).toMatchObject({ wmkf_reviewstatus: REVIEW_STATUS_MAP.complete, wmkf_completedat: result.completedAt, wmkf_reviewreceivedat: stored.wmkf_reviewreceivedat, wmkf_honorariumeligibility: HONORARIUM_ELIGIBILITY_MAP.eligible });
  expect(await dto()).toMatchObject({ reviewStatus: 'complete', submitted: true, completedAt: result.completedAt, honorariumEligibility: 'eligible' });
  expect(transport.rows(ANSWER_SET)).toHaveLength(answerCount);
  expect(transport.get('akoya_requests', HONORARIUM)).toEqual(honorariumBefore);
  expect(writes().flatMap((write) => write.operations || [write]).every((write) => write.entitySet !== 'akoya_requests')).toBe(true);
});

test.each(PRODUCERS)('%s refuses an existing receipt and both terminal states through its real guard', async (_name, _count, _staff, produce) => {
  for (const fields of [
    { wmkf_reviewreceivedat: RECEIVED_AT },
    { wmkf_reviewstatus: REVIEW_STATUS_MAP.withdrew },
    { wmkf_reviewstatus: REVIEW_STATUS_MAP.released },
  ]) {
    initialize(fields);
    const before = transport.get(SET, ID);
    let result;
    try { result = await inContext(produce); } catch (error) { result = error.body; }
    expect(result).toMatchObject({ ok: false });
    expect(writes()).toHaveLength(0);
    expect(transport.get(SET, ID)).toEqual(before);
    expect(transport.rows(ANSWER_SET)).toEqual([]);
  }
  expect(GraphService.uploadFile).not.toHaveBeenCalled();
});

test('full authoring keeps external legacy setVersion compatibility and mandatory staff version', async () => {
  await expect(inContext(() => submitManualReviewEntry({ suggestionId: ID, answers: ANSWERS }))).rejects.toMatchObject({ body: { reason: 'set_changed' } });
  expect(writes()).toHaveLength(0);
  await expect(inContext(() => submitReview({ suggestion: transport.get(SET, ID), body: { answers: ANSWERS } }))).resolves.toMatchObject({ ok: true });
});

test.each(['stale', 'missing'])('staff full rejects %s question version before atomic writes', async (version) => {
  await expect(inContext(() => submitManualReviewEntry({ suggestionId: ID, answers: ANSWERS, setVersion: version === 'stale' ? 'old' : undefined }))).rejects.toMatchObject({ httpStatus: 409, body: { reason: 'set_changed' } });
  expect(writes()).toHaveLength(0);
});

test('stale If-Match rolls back an already-upserted child and preserves the competing row', async () => {
  const pause = transport.pauseNext((request) => request.entitySet === '$batch');
  const pending = inContext(() => submitManualReviewEntry({ suggestionId: ID, answers: ANSWERS, setVersion: VERSION }));
  const rejection = expect(pending).rejects.toMatchObject({ httpStatus: 409, body: { reason: 'conflict' } });
  const request = await pause.reached;
  const parentTag = request.operations.at(-1).headers['If-Match'];
  const winner = transport.patch(SET, ID, { wmkf_notes: 'Concurrent edit wins' });
  expect(parentTag).not.toBe(winner._etag);
  pause.release();
  await rejection;
  expect(request.operations[0].entitySet).toBe(ANSWER_SET);
  expect(transport.rows(ANSWER_SET)).toEqual([]);
  expect(transport.get(SET, ID)).toEqual(winner);
  expect(ReviewDraftService.deleteBySuggestion).not.toHaveBeenCalled();
});

test('closeout uses its authorized version even if the real adapter rereads a newer row', async () => {
  initialize({ wmkf_reviewreceivedat: RECEIVED_AT, wmkf_reviewstatus: REVIEW_STATUS_MAP.review_received });
  const pause = transport.pauseNext((request) => request.method === 'GET' && request.key === ID, { stage: 'after' });
  const pending = close();
  const rejection = expect(pending).rejects.toMatchObject({ body: { code: 'conflict' } });
  await pause.reached;
  const winner = transport.patch(SET, ID, { wmkf_notes: 'Another staff member edited' });
  pause.release();
  await rejection;
  expect(transport.get(SET, ID)).toEqual(winner);
  expect(writes()).toHaveLength(1);
  expect(writes()[0].status).toBe(412);
  expect(writes()[0].headers['If-Match']).not.toBe(winner._etag);
});

test('closeout repeat makes no write; later correction preserves completion and receipt timestamps', async () => {
  initialize({ wmkf_reviewreceivedat: RECEIVED_AT, wmkf_reviewstatus: REVIEW_STATUS_MAP.review_received });
  const first = await close();
  const completed = transport.get(SET, ID);
  const count = writes().length;
  await expect(close()).resolves.toMatchObject({ status: 'unchanged', completedAt: first.completedAt });
  expect(writes()).toHaveLength(count);
  expect(transport.get(SET, ID)).toEqual(completed);
  await expect(close({ disposition: 'not_eligible', notes: 'Did not meet the agreed scope' })).resolves.toMatchObject({ status: 'corrected', completedAt: first.completedAt });
  expect(writes().at(-1).body).toEqual({ wmkf_honorariumeligibility: HONORARIUM_ELIGIBILITY_MAP.not_eligible, wmkf_notes: 'Did not meet the agreed scope' });
  expect(transport.get(SET, ID)).toMatchObject({ wmkf_completedat: first.completedAt, wmkf_reviewreceivedat: RECEIVED_AT });
});

test.each([
  [{ _wmkf_request_value: HONORARIUM }, {}, 'request_changed'],
  [{ _etag: null }, {}, 'missing_etag'],
  [{ wmkf_selected: false }, {}, 'not_selected'],
  [{ wmkf_accepted: false }, {}, 'not_accepted'],
  [{ wmkf_honorariumoptout: true }, {}, 'eligible_opted_out'],
  [{ _wmkf_honorariumrequest_value: null }, {}, 'eligible_missing_honorarium'],
  [{}, { disposition: 'not_eligible', notes: '   ' }, 'notes_required'],
  [{}, { notes: 'x'.repeat(2001) }, 'invalid_notes'],
  [{ wmkf_reviewstatus: REVIEW_STATUS_MAP.complete, wmkf_honorariumeligibility: 999 }, {}, 'unknown_existing_disposition'],
])('closeout blocks invalid prerequisite %j (%s)', async (fields, args, code) => {
  initialize({ wmkf_reviewreceivedat: RECEIVED_AT, wmkf_reviewstatus: REVIEW_STATUS_MAP.review_received, ...fields });
  const before = transport.get(SET, ID);
  await expect(close(args)).rejects.toMatchObject({ body: { code } });
  expect(writes()).toHaveLength(0);
  expect(transport.get(SET, ID)).toEqual(before);
});

test.each([REVIEW_STATUS_MAP.accepted, 999, null])('baseline legacy receipt with raw status %s is submitted in DTO but cannot close out', async (status) => {
  initialize({ wmkf_reviewreceivedat: RECEIVED_AT, wmkf_reviewstatus: status });
  expect(await dto()).toMatchObject({ reviewStatus: 'accepted', submitted: true, reviewReceivedAt: RECEIVED_AT, completedAt: null });
  await expect(close()).rejects.toMatchObject({ body: { code: 'invalid_source_status' } });
  expect(writes()).toHaveLength(0);
});

test('unknown stored eligibility stays visible as unknown through the real DTO', async () => {
  initialize({ wmkf_reviewreceivedat: RECEIVED_AT, wmkf_reviewstatus: REVIEW_STATUS_MAP.complete, wmkf_honorariumeligibility: 999 });
  expect(await dto()).toMatchObject({ reviewStatus: 'complete', honorariumEligibility: 'unknown' });
});

test.each([{ wmkf_honorariumoptout: true }, { _wmkf_honorariumrequest_value: null }])('no-payment applicability accepts its valid complement %j', async (fields) => {
  initialize({ wmkf_reviewreceivedat: RECEIVED_AT, wmkf_reviewstatus: REVIEW_STATUS_MAP.review_received, ...fields });
  await expect(close({ disposition: 'not_applicable' })).resolves.toMatchObject({ status: 'closed' });
  expect(await dto()).toMatchObject({ honorariumEligibility: 'not_applicable' });
});

test('the real transport refuses an adapter write without trusted DAL context', async () => {
  await expect(suggestions.patchReviewReceipt(ID, { wmkf_notes: 'Unauthorized write' })).rejects.toThrow(/trusted|context/i);
  expect(transport.requests).toHaveLength(0);
});

test('a missing receipt ETag fails closed instead of letting the fake invent a lock', async () => {
  initialize({ _etag: null });
  await expect(inContext(() => markReceivedNoFile({ suggestionId: ID }))).rejects.toMatchObject({ body: { reason: 'conflict' } });
  expect(writes()).toHaveLength(0);
});

test.each(['external', 'staff'])('%s full submission wins an external-versus-staff receipt race with no losing answer leakage', async (winnerName) => {
  const initial = transport.get(SET, ID);
  const external = () => inContext(() => submitReview({ suggestion: initial, body: { answers: { ...ANSWERS, comments: '<p>External winner text</p>' }, setVersion: VERSION } }));
  const staff = () => inContext(() => submitManualReviewEntry({ suggestionId: ID, answers: { ...ANSWERS, comments: '<p>Staff winner text</p>' }, setVersion: VERSION, actingUserSystemId: ACTOR }));
  const pause = transport.pauseNext((request) => request.entitySet === '$batch');
  const loser = winnerName === 'external' ? staff() : external();
  const rejection = expect(loser).rejects.toMatchObject({ body: { reason: 'conflict' } });
  await pause.reached;
  await (winnerName === 'external' ? external() : staff());
  const winningParent = transport.get(SET, ID);
  const winningAnswers = transport.rows(ANSWER_SET);
  pause.release();
  await rejection;
  expect(transport.get(SET, ID)).toEqual(winningParent);
  expect(transport.rows(ANSWER_SET)).toEqual(winningAnswers);
  expect((await dto()).answers.find((answer) => answer.questionKey === 'comments').answerText).toBe(winnerName === 'external' ? 'External winner text' : 'Staff winner text');
  expect(ReviewDraftService.deleteBySuggestion).toHaveBeenCalledTimes(1);
});

test.each(['withdrew', 'released'])('%s wins while a full receipt is paused; answer children roll back', async (terminalStatus) => {
  const pause = transport.pauseNext((request) => request.entitySet === '$batch');
  const pending = inContext(() => submitManualReviewEntry({ suggestionId: ID, answers: ANSWERS, setVersion: VERSION }));
  const rejection = expect(pending).rejects.toMatchObject({ body: { reason: 'conflict' } });
  await pause.reached;
  const result = await inContext(() => transitionReviewersTerminal({ requestId: REQUEST, suggestionIds: [ID], terminalStatus, actingUserSystemId: ACTOR }));
  expect(result).toMatchObject({ transitioned: 1 });
  const winner = transport.get(SET, ID);
  pause.release();
  await rejection;
  expect(transport.get(SET, ID)).toEqual(winner);
  expect(winner).toMatchObject({ wmkf_reviewstatus: REVIEW_STATUS_MAP[terminalStatus], wmkf_reviewreceivedat: null, wmkf_externaltokenrevoked: true });
  expect(transport.rows(ANSWER_SET)).toEqual([]);
  expect(Boolean(transport.get('akoya_requests', HONORARIUM))).toBe(terminalStatus !== 'withdrew');
  expect(ReviewDraftService.deleteBySuggestion).not.toHaveBeenCalled();
});

test.each(['withdrew', 'released'])('full receipt wins after %s authorizes its row; terminal mutation and honorarium deletion cannot land', async (terminalStatus) => {
  const pause = transport.pauseNext((request) => request.method === 'GET' && request.key === ID, { stage: 'after' });
  const terminal = inContext(() => transitionReviewersTerminal({ requestId: REQUEST, suggestionIds: [ID], terminalStatus, actingUserSystemId: ACTOR }));
  await pause.reached;
  await inContext(() => submitManualReviewEntry({ suggestionId: ID, answers: ANSWERS, setVersion: VERSION }));
  const winner = transport.get(SET, ID);
  const winningAnswers = transport.rows(ANSWER_SET);
  pause.release();
  await expect(terminal).resolves.toMatchObject({ transitioned: 0, results: [{ suggestionId: ID, status: 'changed_skipped' }] });
  expect(transport.get(SET, ID)).toEqual(winner);
  expect(transport.rows(ANSWER_SET)).toEqual(winningAnswers);
  expect(transport.get('akoya_requests', HONORARIUM)).not.toBeNull();
});

test('a completed review can receive its generated DOCX pointer and thank-you claim, while another receipt is rejected', async () => {
  // The real filer has no sandbox/test preflight mode: scheduled requires
  // production deployment; backfill requires local + Production Dataverse.
  // Classify this inert fixture as scheduled production, keep the interlock
  // intact, and intercept EVERY fetch beneath it. No OAuth or network runs.
  process.env.DYNAMICS_URL = `https://${PRODUCTION_HOSTS[0]}`;
  process.env.VERCEL_ENV = 'production';
  process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
  process.env.REVIEW_DOCX_SHAREPOINT_WRITE = 'on';
  delete process.env.SHAREPOINT_SITE_URL;
  initialize({ wmkf_grantcyclecode: 'D26' });
  await inContext(() => submitManualReviewEntry({ suggestionId: ID, answers: ANSWERS, setVersion: VERSION }));
  const closed = await close();
  const before = transport.get(SET, ID);
  const snapshots = transport.rows(ANSWER_SET);
  let docxBytes;
  let docxItem;
  jest.spyOn(GraphService, 'getSiteId').mockResolvedValue('fixture-site');
  jest.spyOn(GraphService, 'getFileMetadataByPath').mockResolvedValue(null);
  GraphService.uploadFile.mockImplementation(async (_library, _folder, filename, content) => {
    docxBytes = content;
    docxItem = { siteId: 'fixture-site', driveId: 'fixture-drive', id: 'fixture-docx', name: filename, size: content.length, eTag: 'item-1' };
    return docxItem;
  });
  jest.spyOn(GraphService, 'getFileMetadataById').mockImplementation(async () => docxItem);
  jest.spyOn(GraphService, 'downloadFile').mockImplementation(async () => ({ buffer: docxBytes }));
  const filed = await inContext(() => ensureIndividualReviewFile(ID, { cycleCode: 'D26' }));
  expect(filed).toMatchObject({ status: 'created' });
  expect(Buffer.isBuffer(docxBytes)).toBe(true);
  const pointerWrite = writes().at(-1);
  expect(pointerWrite.body).toEqual({ wmkf_reviewsharepointfolder: filed.expectedFolder, wmkf_reviewfilename: filed.expectedFilename });
  expect(pointerWrite.headers['If-Match']).toBe(before._etag);

  const result = { sent: 0, claimFailed: 0, attachmentFailed: 0, sendFailed: 0, errors: [] };
  const email = jest.spyOn(DynamicsService, 'createAndSendEmail').mockImplementation(async () => {
    expect(transport.get(SET, ID).wmkf_thankyousentat).toEqual(expect.any(String));
    return { id: 'fixture-email' };
  });
  await inContext(() => sendOneThankYou({
    subjectTemplate: 'Thank you', bodyTemplate: '<p>Thank you for your review.</p>',
    row: transport.get(SET, ID), request: transport.get('akoya_requests', REQUEST),
    reviewer: transport.get('wmkf_potentialreviewerses', PERSON),
    pd: { systemuserid: ACTOR, fullname: 'Program Director', internalemailaddress: 'pd@example.test' },
    signatureBlock: 'Program Director', actingUserSystemId: ACTOR, result,
  }));
  expect(result).toEqual({ sent: 1, claimFailed: 0, attachmentFailed: 0, sendFailed: 0, errors: [] });
  expect(email).toHaveBeenCalledTimes(1);
  expect(writes().at(-1).body).toEqual({ wmkf_thankyousentat: expect.any(String) });
  expect(transport.get(SET, ID)).toMatchObject({ wmkf_reviewstatus: REVIEW_STATUS_MAP.complete, wmkf_completedat: closed.completedAt, wmkf_reviewreceivedat: before.wmkf_reviewreceivedat });
  expect(transport.rows(ANSWER_SET)).toEqual(snapshots);
  const writeCount = writes().length;
  await expect(inContext(() => markReceivedNoFile({ suggestionId: ID }))).rejects.toMatchObject({ body: { reason: 'review_received_locked' } });
  expect(writes()).toHaveLength(writeCount);
});
