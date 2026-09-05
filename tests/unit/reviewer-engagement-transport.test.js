/** @jest-environment node */
import { createReviewerEngagementTransport } from '../helpers/reviewer-engagement-transport';

const SET = 'wmkf_appreviewersuggestions';
const ANSWERS = 'wmkf_appreviewanswers';
const ID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const BASE = 'https://reviewer-harness.invalid/api/data/v9.2/';
const URL = `${BASE}${SET}(${ID})`;
const row = (fields = {}) => ({ wmkf_appreviewersuggestionid: ID, wmkf_selected: true, wmkf_notes: 'Before', ...fields });
let transport;
beforeEach(() => { transport = createReviewerEngagementTransport({ [SET]: [row()] }); });
const update = (fields, headers = {}) => transport.fetch(URL, { method: 'PATCH', headers, body: JSON.stringify(fields) });

// Independent wire fixture rather than the production serializer: tests below
// challenge the fake itself while composed suites exercise the real serializer.
function batch(operations) {
  const inner = operations.map((op, index) => [
    '--changeset_fixture', 'Content-Type: application/http', 'Content-Transfer-Encoding: binary',
    `Content-ID: ${index + 1}`, '', `${op.method || 'PATCH'} ${BASE}${op.path} HTTP/1.1`,
    ...(op.ifMatch ? [`If-Match: ${op.ifMatch}`] : []), 'Content-Type: application/json', '', JSON.stringify(op.body || {}),
  ].join('\r\n'));
  return transport.fetch(`${BASE}$batch`, {
    method: 'POST', headers: { 'Content-Type': 'multipart/mixed; boundary=batch_fixture' },
    body: ['--batch_fixture', 'Content-Type: multipart/mixed; boundary=changeset_fixture', '',
      ...inner, '--changeset_fixture--', '--batch_fixture--', ''].join('\r\n'),
  });
}

test('exact stale If-Match rejects; missing If-Match deliberately models unconditional writes', async () => {
  const stale = transport.get(SET, ID)._etag;
  const current = transport.patch(SET, ID, { wmkf_notes: 'Winner' });
  expect((await update({ wmkf_notes: 'Lost' }, { 'If-Match': stale })).status).toBe(412);
  expect(transport.get(SET, ID)).toEqual(current);
  expect((await update({ wmkf_notes: 'Explicit unconditional write' })).status).toBe(204);
  expect(transport.get(SET, ID).wmkf_notes).toBe('Explicit unconditional write');
  expect((await update({ wmkf_notes: 'Wrong weak-tag spelling' }, { 'If-Match': transport.get(SET, ID)._etag.replace('W/', '') })).status).toBe(412);
});

test('generated tags never collide with explicitly seeded tags and snapshots cannot mutate stored state', () => {
  transport.seed(SET, row({ _etag: 'W/"2"' }));
  const before = transport.get(SET, ID);
  const after = transport.patch(SET, ID, { wmkf_notes: 'Changed' });
  expect(after._etag).not.toBe(before._etag);
  before.wmkf_notes = 'Mutating the caller snapshot';
  after.wmkf_notes = 'Mutating another returned snapshot';
  expect(transport.get(SET, ID).wmkf_notes).toBe('Changed');
});

test('missing ETags stay missing in projections and stale versioned writes cannot match them', async () => {
  transport.seed(SET, row({ _etag: null }));
  expect(await (await transport.fetch(URL)).json()).not.toHaveProperty('@odata.etag');
  expect((await update({ wmkf_notes: 'Must not land' }, { 'If-Match': 'W/"1"' })).status).toBe(412);
  expect(transport.get(SET, ID).wmkf_notes).toBe('Before');
});

test('wildcard requires an existing row; unknown target cannot silently upsert a parent', async () => {
  expect((await update({ wmkf_notes: 'Existing' }, { 'If-Match': '*' })).status).toBe(204);
  const missing = `${BASE}${SET}(${OTHER})`;
  expect((await transport.fetch(missing, { method: 'PATCH', headers: { 'If-Match': '*' }, body: '{}' })).status).toBe(412);
  expect((await transport.fetch(missing, { method: 'PATCH', body: '{}' })).status).toBe(404);
});

test('batch failure after one existing-child mutation rolls back children, new children, and parent', async () => {
  transport.seed(ANSWERS, { wmkf_appreviewanswerid: OTHER, _wmkf_appreviewersuggestion_value: ID, wmkf_questionkey: 'riskLevel', wmkf_answervalue: 1 });
  const parentBefore = transport.get(SET, ID);
  const childrenBefore = transport.rows(ANSWERS);
  const result = await batch([
    { path: `${ANSWERS}(_wmkf_appreviewersuggestion_value=${ID},wmkf_questionkey='riskLevel')`, body: { wmkf_answervalue: 2 } },
    { path: `${ANSWERS}(_wmkf_appreviewersuggestion_value=${ID},wmkf_questionkey='comments')`, body: { wmkf_answertext: 'Losing narrative' } },
    { path: `${SET}(${ID})`, body: { wmkf_reviewreceivedat: '2026-09-01' }, ifMatch: 'W/"stale"' },
  ]);
  expect(await result.text()).toContain('HTTP/1.1 412');
  expect(transport.rows(ANSWERS)).toEqual(childrenBefore);
  expect(transport.get(SET, ID)).toEqual(parentBefore);
});

test('batch success commits parent and alternate-key children together', async () => {
  const result = await batch([
    { path: `${ANSWERS}(_wmkf_appreviewersuggestion_value=${ID},wmkf_questionkey='riskLevel')`, body: { wmkf_answervalue: 2 } },
    { path: `${SET}(${ID})`, body: { wmkf_reviewreceivedat: '2026-09-01' }, ifMatch: transport.get(SET, ID)._etag },
  ]);
  expect((await result.text()).match(/HTTP\/1.1 204/g)).toHaveLength(2);
  expect(transport.rows(ANSWERS)).toEqual([expect.objectContaining({ _wmkf_appreviewersuggestion_value: ID, wmkf_questionkey: 'riskLevel', wmkf_answervalue: 2 })]);
  expect(transport.get(SET, ID).wmkf_reviewreceivedat).toBe('2026-09-01');
});

test('query projection and null-safe filters operate on stored rows before the projection', async () => {
  transport.seed(SET, row({ wmkf_appreviewersuggestionid: OTHER, wmkf_selected: false, wmkf_applicantdisposition: 1 }));
  const query = new URLSearchParams({ $filter: 'wmkf_selected eq true and (wmkf_applicantdisposition eq null or wmkf_applicantdisposition ne 1)', $select: 'wmkf_appreviewersuggestionid' });
  const result = await (await transport.fetch(`${BASE}${SET}?${query}`)).json();
  expect(result.value).toEqual([{ wmkf_appreviewersuggestionid: ID, '@odata.etag': transport.get(SET, ID)._etag }]);
  expect(result['@odata.count']).toBe(1);
});

test.each(['before', 'after'])('%s-read pause controls whether the returned snapshot sees a concurrent change', async (stage) => {
  const pause = transport.pauseNext((request) => request.method === 'GET', { stage });
  const pending = transport.fetch(URL);
  await pause.reached;
  transport.patch(SET, ID, { wmkf_notes: 'Concurrent' });
  pause.release();
  expect((await (await pending).json()).wmkf_notes).toBe(stage === 'before' ? 'Concurrent' : 'Before');
});

test.each([
  `${BASE}${SET}?$filter=contains(wmkf_notes,'Before')`,
  `${BASE}${SET}?$filter=wmkf_selected%20eq%20true%20trailing`,
  `${BASE}${SET}?$apply=aggregate(wmkf_selected)`,
  `${BASE}unknown_entity`,
  'https://example.com/api/data/v9.2/akoya_requests',
])('unknown network or unsupported query fails loudly: %s', async (url) => {
  await expect(transport.fetch(url)).rejects.toThrow();
  expect(transport.unexpectedRequests).toEqual([expect.objectContaining({ url, method: 'GET' })]);
});
