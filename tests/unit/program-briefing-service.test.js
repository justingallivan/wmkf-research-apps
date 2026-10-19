/** @jest-environment node */
jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({ queryAllRequests: jest.fn() }));
jest.mock('../../lib/dataverse/adapters/request-document.js', () => ({ findByRequests: jest.fn() }));
jest.mock('../../lib/services/post-presentation-materials/staff-text-service.js', () => ({ readStaffPresentationText: jest.fn() }));
jest.mock('../../lib/services/post-presentation-materials/discussion-sentiment-reader.js', () => ({ getDeliberationSentiments: jest.fn(), DELIBERATION_SENTIMENT_MAX_REQUESTS: 50 }));

import { loadProgramBriefing, summaryExcerpt } from '../../lib/services/meeting-tracker/program-briefing-service.js';
import { RESEARCH_PROGRAM_IDS } from '../../shared/config/researchPrograms.js';
import { REQUEST_DOCUMENT_ARTIFACT_TYPE as TYPE, REQUEST_DOCUMENT_OPERATION_STATUS as OP } from '../../shared/config/requestDocument.js';

const id = (n) => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const request = (n, program = 0) => ({ akoya_requestid: id(n), akoya_requestnum: String(1000 + n), akoya_title: `Proposal ${n}`, _akoya_programid_value: RESEARCH_PROGRAM_IDS[program], _akoya_applicantid_value_formatted: `Institution ${n}`, wmkf_meetingdate: '2026-12-03T00:00:00Z' });
const document = (n, type = TYPE.TRANSCRIPT_SUMMARY) => ({ _wmkf_request_value: id(n), wmkf_requestdocumentid: id(n + type), wmkf_artifacttype: type, wmkf_operationstatus: OP.READY, wmkf_sharepointdriveid: 'drive', wmkf_sharepointitemid: 'item', createdon: '2026-10-19T00:00:00Z' });
let deps;
beforeEach(() => {
  deps = {
    schemaReady: () => true,
    queryRequests: jest.fn(async () => ({ records: [request(1), request(2, 1)], capped: false })),
    findDocuments: jest.fn(async () => ({ records: [document(1), document(1, TYPE.STAFF_DISCUSSION_SUMMARY), document(2)], capped: false })),
    readText: jest.fn(async () => ({ ok: true, text: 'What was presented\n\nA novel approach to imaging.\n\nQuestions and answers\nMore detail.', item: { stale: false, publishedAt: '2026-10-19' } })),
    readSentiments: jest.fn(async () => ({ [id(1)]: { status: 'current', sentiment: { headline: 'Support with reservations.' } }, [id(2)]: { status: 'none', sentiment: null } })),
    now: () => new Date('2026-10-19T12:00:00Z'),
  };
});
const load = (args = { cycleCode: 'D26', profileId: 7 }) => loadProgramBriefing(args, deps);

test('groups by canonical lookup, keeps missing proposals, and reads summaries through the integrity reader', async () => {
  const body = await load();
  expect(body.groups.map((g) => [g.key, g.proposals.length])).toEqual([['se', 1], ['mr', 1]]);
  expect(body.groups[0].proposals[0]).toMatchObject({ institution: 'Institution 1', proposalSummary: { status: 'current', text: 'A novel approach to imaging.' }, discussion: { status: 'current' } });
  expect(body.groups[1].proposals[0]).toMatchObject({ discussionSummary: { status: 'missing', text: null }, discussion: { status: 'none', sentiment: null } });
  expect(deps.readSentiments).toHaveBeenCalledWith([id(1), id(2)], { profileId: 7 });
  expect(deps.readText).toHaveBeenCalledWith({ requestId: id(1), documentId: document(1).wmkf_requestdocumentid });
  expect(deps.queryRequests.mock.calls[0][0].filter).toContain('_akoya_programid_value');
  expect(deps.queryRequests.mock.calls[0][0].filter).toContain('Phase II Pending');
});

test('catalog uses the working-cycle calendar and does not read documents or sentiments', async () => {
  deps.queryRequests.mockResolvedValue({ records: [request(1), { ...request(2), wmkf_meetingdate: '2026-06-03T00:00:00Z' }] });
  expect(await load({ profileId: 7 })).toMatchObject({ defaultCycleCode: 'D26', cycles: [{ code: 'D26' }, { code: 'J26' }] });
  expect(deps.findDocuments).not.toHaveBeenCalled(); expect(deps.readSentiments).not.toHaveBeenCalled();
});

test.each([{ capped: true }, { hasMore: true }, { records: null }])('incomplete membership refuses a printable success: %j', async (extra) => {
  deps.queryRequests.mockResolvedValue({ records: [request(1)], ...extra });
  await expect(load()).rejects.toMatchObject({ httpStatus: 503, body: { code: 'briefing_membership_incomplete' } });
});

test.each([{ _akoya_programid_value: id(40) }, { akoya_requestid: 'bad' }, { wmkf_meetingdate: '2026-06-01' }])('unclassifiable/out-of-scope membership fails closed: %j', async (extra) => {
  deps.queryRequests.mockResolvedValue({ records: [{ ...request(1), ...extra }] });
  await expect(load()).rejects.toMatchObject({ httpStatus: 503 });
});

test('stale summaries and stale sentiment never leak text', async () => {
  deps.readText.mockResolvedValue({ ok: true, text: 'STALE SECRET', item: { stale: true } });
  deps.readSentiments.mockResolvedValue({ [id(1)]: { status: 'out_of_date', sentiment: { headline: 'STALE SECRET' } } });
  const body = await load();
  expect(JSON.stringify(body)).not.toContain('STALE SECRET');
  expect(body.groups[0].proposals[0]).toMatchObject({ proposalSummary: { status: 'out_of_date', text: null }, discussion: { status: 'out_of_date', sentiment: null } });
});

test('source outages remain unavailable, not missing or no-analysis', async () => {
  deps.findDocuments.mockResolvedValue({ records: [document(1)], capped: true });
  deps.readSentiments.mockRejectedValue(new Error('private database detail'));
  const body = await load();
  expect(body.groups[0].proposals[0]).toMatchObject({ proposalSummary: { status: 'unavailable' }, discussion: { status: 'unavailable' } });
  expect(deps.readText).not.toHaveBeenCalled();
  expect(JSON.stringify(body)).not.toContain('database detail');
});

test('one failed file leaves the other summaries usable', async () => {
  deps.readText.mockRejectedValueOnce(new Error('Graph failed'));
  const p = (await load()).groups[0].proposals[0];
  expect(p.proposalSummary.status).toBe('unavailable'); expect(p.discussionSummary.status).toBe('current');
});

test('consumer access refusal is not swallowed as a data gap', async () => {
  deps.readSentiments.mockRejectedValue({ code: 'sentiment_read_forbidden', httpStatus: 403 });
  await expect(load()).rejects.toMatchObject({ httpStatus: 403 });
});

test('51 proposals are read within the existing 50-ID sentiment cap', async () => {
  deps.queryRequests.mockResolvedValue({ records: Array.from({ length: 51 }, (_, i) => request(i + 1)) });
  deps.findDocuments.mockResolvedValue({ records: [] });
  await load();
  expect(deps.readSentiments.mock.calls.map(([ids]) => ids.length)).toEqual([50, 1]);
});

test('empty cycle is explicit and makes no downstream reads', async () => {
  deps.queryRequests.mockResolvedValue({ records: [] });
  expect((await load()).groups.map((g) => g.proposals)).toEqual([[], []]);
  expect(deps.findDocuments).not.toHaveBeenCalled(); expect(deps.readSentiments).not.toHaveBeenCalled();
});

test.each(['bad', '', ['D26']])('rejects invalid cycle before querying: %j', async (cycleCode) => {
  await expect(load({ cycleCode, profileId: 7 })).rejects.toMatchObject({ httpStatus: 400 });
  expect(deps.queryRequests).not.toHaveBeenCalled();
});

test('excerpts preserve edited prose and mark truncation without inventing a summary', () => {
  expect(summaryExcerpt('Main points raised\n\nSupport for the approach.\n\nQuestions and concerns\nBudget.')).toEqual({ text: 'Support for the approach.', excerpt: false });
  const long = 'Edited summary without headings. '.repeat(60);
  const excerpt = summaryExcerpt(long);
  expect(excerpt.excerpt).toBe(true); expect(excerpt.text.length).toBeLessThanOrEqual(801);
  expect(long.startsWith(excerpt.text.slice(0, -1))).toBe(true);
});

 test('a published summary with broken backing is unavailable rather than missing', async () => {
  deps.findDocuments.mockResolvedValue({ records: [{ ...document(1), wmkf_sharepointitemid: null }] });
  const body = await load();
  expect(body.groups[0].proposals[0].proposalSummary).toEqual({ status: 'unavailable', text: null });
  expect(body.groups[0].proposals[0].discussionSummary.status).toBe('missing');
  expect(deps.readText).not.toHaveBeenCalled();
});
