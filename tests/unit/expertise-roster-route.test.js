/** @jest-environment node */

const mockSqlTag = jest.fn();
const mockSqlQuery = jest.fn();

jest.mock('@vercel/postgres', () => {
  const sql = (...args) => mockSqlTag(...args);
  sql.query = (...args) => mockSqlQuery(...args);
  return { sql };
});
jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(async () => ({ profileId: 42 })),
}));

import handler from '../../pages/api/expertise-finder/roster';

const CONTACT_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_CONTACT_ID = '22222222-2222-4222-8222-222222222222';

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((body) => { res.body = body; return res; });
  res.setHeader = jest.fn();
  return res;
}

async function request(method, body) {
  const res = mockRes();
  await handler({ method, body, query: {} }, res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  console.error.mockRestore();
});

test('create rejects a link plus manual email and accepts a link plus empty email', async () => {
  let res = await request('POST', {
    name: 'Ada', role_type: 'Board', preferred_email: 'ada@example.org', dataverse_contact_id: CONTACT_ID,
  });
  expect(res.statusCode).toBe(400);
  expect(mockSqlTag).not.toHaveBeenCalled();

  mockSqlTag.mockResolvedValueOnce({ rows: [{ id: 1, dataverse_contact_id: CONTACT_ID }] });
  res = await request('POST', {
    name: 'Ada', role_type: 'Board', preferred_email: '', dataverse_contact_id: CONTACT_ID.toUpperCase(),
  });
  expect(res.statusCode).toBe(201);
  const insertValues = mockSqlTag.mock.calls[0].slice(1);
  expect(insertValues).toContain(CONTACT_ID);
  expect(insertValues).toContain(null);
});

test('patch applies the resulting-link rule to unchanged, changed, empty, and unlink combinations', async () => {
  mockSqlTag.mockResolvedValueOnce({ rows: [{ id: 1, dataverse_contact_id: CONTACT_ID, preferred_email: 'old@example.org' }] });
  mockSqlQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] });
  let res = await request('PATCH', { id: 1, preferred_email: ' OLD@example.org ' });
  expect(res.statusCode).toBe(200);
  expect(mockSqlQuery.mock.calls[0][1]).toContain('old@example.org');

  mockSqlTag.mockResolvedValueOnce({ rows: [{ id: 1, dataverse_contact_id: CONTACT_ID, preferred_email: 'old@example.org' }] });
  res = await request('PATCH', { id: 1, preferred_email: 'new@example.org' });
  expect(res.statusCode).toBe(400);

  mockSqlTag.mockResolvedValueOnce({ rows: [{ id: 1, dataverse_contact_id: CONTACT_ID, preferred_email: 'old@example.org' }] });
  mockSqlQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] });
  res = await request('PATCH', { id: 1, preferred_email: '' });
  expect(res.statusCode).toBe(200);
  expect(mockSqlQuery.mock.calls.at(-1)[1]).toContain(null);

  mockSqlTag.mockResolvedValueOnce({ rows: [{ id: 1, dataverse_contact_id: CONTACT_ID, preferred_email: 'old@example.org' }] });
  mockSqlQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] });
  res = await request('PATCH', { id: 1, dataverse_contact_id: '', preferred_email: 'new@example.org' });
  expect(res.statusCode).toBe(200);
  expect(mockSqlQuery.mock.calls.at(-1)[1]).toEqual(expect.arrayContaining([null, 'new@example.org']));
});

test('patch omits an unsubmitted contact field and accepts an explicit relink', async () => {
  mockSqlTag.mockResolvedValueOnce({ rows: [{ id: 1, dataverse_contact_id: CONTACT_ID, preferred_email: null }] });
  mockSqlQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] });
  let res = await request('PATCH', { id: 1, name: 'Renamed' });
  expect(res.statusCode).toBe(200);
  expect(mockSqlQuery.mock.calls[0][0]).not.toContain('dataverse_contact_id =');

  mockSqlTag.mockResolvedValueOnce({ rows: [{ id: 1, dataverse_contact_id: CONTACT_ID, preferred_email: null }] });
  mockSqlQuery.mockResolvedValueOnce({ rows: [{ id: 1, dataverse_contact_id: SECOND_CONTACT_ID }] });
  res = await request('PATCH', { id: 1, dataverse_contact_id: SECOND_CONTACT_ID.toUpperCase() });
  expect(res.statusCode).toBe(200);
  expect(mockSqlQuery.mock.calls.at(-1)[1]).toContain(SECOND_CONTACT_ID);
});

test.each([
  ['create', 'POST', { name: 'Ada', role_type: 'Board', dataverse_contact_id: CONTACT_ID }],
  ['update', 'PATCH', { id: 1, dataverse_contact_id: CONTACT_ID }],
  ['reactivation', 'PATCH', { id: 1, is_active: true }],
])('%s maps the active-contact uniqueness race to a named 409', async (_label, method, body) => {
  const conflictError = Object.assign(new Error('duplicate'), {
    code: '23505',
    constraint: 'idx_expertise_roster_active_contact',
  });
  if (method === 'POST') {
    mockSqlTag.mockRejectedValueOnce(conflictError);
  } else {
    mockSqlTag.mockResolvedValueOnce({ rows: [{ id: 1, dataverse_contact_id: CONTACT_ID, preferred_email: null }] });
    mockSqlQuery.mockRejectedValueOnce(conflictError);
  }
  mockSqlQuery.mockResolvedValueOnce({ rows: [{ id: 9, name: 'Existing Member' }] });

  const res = await request(method, body);
  expect(res.statusCode).toBe(409);
  expect(res.body).toEqual(expect.objectContaining({
    code: 'expertise_roster_contact_conflict',
    conflictingMember: { id: 9, name: 'Existing Member' },
  }));
});

test('soft delete preserves the Contact link for later undo', async () => {
  mockSqlTag.mockResolvedValueOnce({ rows: [{ id: 1, name: 'Ada' }] });
  const res = await request('DELETE', { id: 1 });
  expect(res.statusCode).toBe(200);
  const templateText = mockSqlTag.mock.calls[0][0].join(' ');
  expect(templateText).toContain('SET is_active = false');
  expect(templateText).not.toContain('dataverse_contact_id');
});
