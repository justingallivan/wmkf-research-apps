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
