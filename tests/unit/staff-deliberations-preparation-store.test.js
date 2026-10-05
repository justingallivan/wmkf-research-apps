/** @jest-environment node */
import { claimNextPreparation, upsertDuePreparation } from '../../lib/services/pre-site-visit/preparation-store.js';

it('keeps a blocked receipt blocked until its source schedule revision changes', async () => {
  let statement = '';
  const client = { query: jest.fn(async (sql) => { statement = sql; return { rows: [] }; }) };
  await upsertDuePreparation({
    requestId: 'aaaaaaaa-0000-4000-8000-000000000001',
    programId: 'bbbbbbbb-0000-4000-8000-000000000001',
    cycleCode: 'D26',
    siteVisitId: 'cccccccc-0000-4000-8000-000000000001',
    scheduledEnd: '2026-12-01T18:00:00Z',
    eventModifiedOn: '2026-11-01T12:00:00Z',
    stateCode: 10,
    statusCode: 11,
    initialState: 'pending',
  }, client);
  expect(statement).toContain("WHEN staff_deliberations_preparations.state IN ('prepared','running','pending')");
  expect(statement).toContain("WHEN staff_deliberations_preparations.state='blocked'");
  expect(statement).toContain('event_modified_on IS DISTINCT FROM EXCLUDED.event_modified_on');
  expect(statement).toContain('ELSE staff_deliberations_preparations.next_attempt_at END');
});

it('does not shorten an existing retry backoff on a repeated scheduler scan', async () => {
  let statement = '';
  const client = { query: jest.fn(async (sql) => { statement = sql; return { rows: [] }; }) };
  await upsertDuePreparation({
    requestId: 'aaaaaaaa-0000-4000-8000-000000000001',
    programId: 'bbbbbbbb-0000-4000-8000-000000000001',
    cycleCode: 'D26',
    siteVisitId: 'cccccccc-0000-4000-8000-000000000001',
    scheduledEnd: '2026-12-01T18:00:00Z',
    eventModifiedOn: '2026-11-01T12:00:00Z',
    stateCode: 10,
    statusCode: 11,
    initialState: 'pending',
  }, client);
  expect(statement).toContain("WHEN staff_deliberations_preparations.state IN ('prepared','running','pending')");
  expect(statement).toContain('ELSE staff_deliberations_preparations.next_attempt_at END');
  expect(statement).not.toContain("next_attempt_at=CASE WHEN staff_deliberations_preparations.state='pending' THEN NOW()");
});

it('keeps a claimed receipt leased beyond the cron function maximum duration', async () => {
  const client = { query: jest.fn(async () => ({ rows: [] })) };
  await claimNextPreparation({}, client);
  expect(client.query.mock.calls[0][0]).toContain('lease_expires_at=NOW()+');
  expect(client.query.mock.calls[0][1][1]).toBe(420_000);
});

it('requeues only a staff-correction receipt when a complete Review checkpoint is observed', async () => {
  let statement = '';
  const client = { query: jest.fn(async (sql) => { statement = sql; return { rows: [] }; }) };
  await upsertDuePreparation({
    requestId: 'aaaaaaaa-0000-4000-8000-000000000001',
    programId: 'bbbbbbbb-0000-4000-8000-000000000001',
    cycleCode: 'D26',
    siteVisitId: 'cccccccc-0000-4000-8000-000000000001',
    scheduledEnd: '2026-12-01T18:00:00Z',
    eventModifiedOn: '2026-11-01T12:00:00Z',
    stateCode: 10,
    statusCode: 11,
    correctionEpoch: 'reopen-cycle-1',
    initialState: 'pending',
    resumeCorrection: true,
  }, client);
  expect(client.query.mock.calls[0][1][12]).toBe(true);
  expect(statement).toContain("last_error_code='correction_reopen_requires_staff'");
  expect(statement).toContain('AND $13::boolean THEN \'pending\'');
});


it('scopes a Factory test claim to one exact request and keeps normal claims unscoped', async () => {
  const client = { query: jest.fn(async () => ({ rows: [] })) };
  const requestId = 'aaaaaaaa-0000-4000-8000-000000000001';
  await claimNextPreparation({ requestId }, client);
  expect(client.query.mock.calls[0][0]).toContain('AND request_id=$3::uuid');
  expect(client.query.mock.calls[0][1][2]).toBe(requestId);

  await claimNextPreparation({}, client);
  expect(client.query.mock.calls[1][0]).not.toContain('request_id=$3::uuid');
  expect(client.query.mock.calls[1][1]).toHaveLength(2);
});

it('rejects an invalid scoped request ID instead of falling through to a global claim', async () => {
  const client = { query: jest.fn(async () => ({ rows: [] })) };
  await expect(claimNextPreparation({ requestId: null }, client)).rejects.toThrow('Scoped receipt claim requires a valid request GUID');
  expect(client.query).not.toHaveBeenCalled();
});
