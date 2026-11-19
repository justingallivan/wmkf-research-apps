/**
 * Proposal list store — replaceItems keeps marks by reading them under the
 * link lock (docs/plans/J27_PROPOSAL_LIST_EMAILS_PLAN_2026-11-18.md).
 *
 * @jest-environment node
 */
const mockClient = { query: jest.fn(), release: jest.fn() };
jest.mock('@vercel/postgres', () => ({ db: { connect: jest.fn(async () => mockClient) }, sql: jest.fn() }));

import { replaceItems } from '../../lib/services/proposal-lists/list-store';

const LINK = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REQ_A = '11111111-1111-4111-8111-111111111111';
const REQ_B = '22222222-2222-4222-8222-222222222222';
const snapshot = [
  { requestId: REQ_A, requestNumber: '1001', title: 'A', institution: 'U', projectLeader: 'P', section: 'Physics' },
  { requestId: REQ_B, requestNumber: '1002', title: 'B', institution: 'U', projectLeader: 'P', section: 'Physics' },
];

function script({ live = true, marks = [] } = {}) {
  mockClient.query.mockImplementation(async (text) => {
    if (/FOR UPDATE/.test(text)) return { rows: live ? [{ id: LINK }] : [] };
    if (/^SELECT request_id, highlighted/.test(text)) return { rows: marks };
    return { rows: [] };
  });
}

beforeEach(() => jest.clearAllMocks());

test('locks the link, then reads the marks, then replaces the items with those marks kept', async () => {
  script({ marks: [{ request_id: REQ_A.toUpperCase(), highlighted: true, own_institution: false }, { request_id: REQ_B, highlighted: false, own_institution: true }] });
  expect(await replaceItems(LINK, snapshot)).toBe(true);
  const texts = mockClient.query.mock.calls.map(([text]) => text.trim().split(/\s+/).slice(0, 3).join(' '));
  const lock = mockClient.query.mock.calls.findIndex(([text]) => /FOR UPDATE/.test(text));
  const read = mockClient.query.mock.calls.findIndex(([text]) => /^SELECT request_id, highlighted/.test(text));
  const del = mockClient.query.mock.calls.findIndex(([text]) => /^DELETE FROM proposal_list_items/.test(text));
  expect(texts[0]).toBe('BEGIN');
  expect(lock).toBeGreaterThan(0);
  expect(read).toBeGreaterThan(lock);
  expect(del).toBeGreaterThan(read);
  const inserts = mockClient.query.mock.calls.filter(([text]) => /INSERT INTO proposal_list_items/.test(text)).map(([, params]) => params);
  // params: link, request id, number, title, institution, leader, section, highlighted, own institution
  expect(inserts.map((p) => [p[2], p[7], p[8]])).toEqual([['1001', true, false], ['1002', false, true]]);
  expect(texts.at(-1)).toBe('COMMIT');
});

test('marks handed in by a caller are ignored; only stored marks count', async () => {
  script({ marks: [] });
  await replaceItems(LINK, snapshot.map((item) => ({ ...item, highlighted: true, ownInstitution: true })));
  const inserts = mockClient.query.mock.calls.filter(([text]) => /INSERT INTO proposal_list_items/.test(text)).map(([, params]) => params);
  expect(inserts.map((p) => [p[7], p[8]])).toEqual([[false, false], [false, false]]);
});

test('a link that is not live is left untouched', async () => {
  script({ live: false, marks: [{ request_id: REQ_A, highlighted: true, own_institution: false }] });
  expect(await replaceItems(LINK, snapshot)).toBe(false);
  expect(mockClient.query.mock.calls.some(([text]) => /DELETE|INSERT/.test(text))).toBe(false);
});
