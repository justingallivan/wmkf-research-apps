/**
 * @jest-environment node
 *
 * Contract tests for reconcileProfile (lib/services/dynamics-identity-service.js)
 * written BEFORE Wave-4 conversion to the systemusers adapter (data-access-layer
 * migration). `@vercel/postgres` sql and DynamicsService.queryRecords are mocked
 * at the transport boundary, so these stay valid whether the caller issues the
 * systemusers query directly or via lib/dataverse/adapters/system-user.js — same
 * select/filter/top, same DynamicsService call.
 */

jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));
import { sql } from '@vercel/postgres';
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import { reconcileProfile, RECONCILE_RESULT } from '../../lib/services/dynamics-identity-service.js';

afterEach(() => jest.restoreAllMocks());

beforeEach(() => {
  sql.mockReset();
});

describe('reconcileProfile — golden path (LINKED)', () => {
  test('matches a systemuser by email and links it', async () => {
    sql.mockResolvedValueOnce({
      rows: [{ id: 1, azure_email: 'jane@example.org', dynamics_systemuser_id: null }],
    });
    const query = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({
      records: [{ systemuserid: 'su-1', fullname: 'Jane PD', isdisabled: false, internalemailaddress: 'jane@example.org' }],
    });
    sql.mockResolvedValueOnce({ rows: [] }); // UPDATE

    const out = await reconcileProfile(1);

    expect(out).toEqual({
      profileId: 1,
      result: RECONCILE_RESULT.LINKED,
      systemuserid: 'su-1',
      fullname: 'Jane PD',
    });
    expect(query).toHaveBeenCalledWith('systemusers', {
      select: 'systemuserid,fullname,isdisabled,internalemailaddress',
      filter: "internalemailaddress eq 'jane@example.org'",
      top: 1,
    });
  });
});

describe('reconcileProfile — NO_MATCH', () => {
  test('no systemuser found for the email', async () => {
    sql.mockResolvedValueOnce({
      rows: [{ id: 2, azure_email: 'nobody@example.org', dynamics_systemuser_id: null }],
    });
    jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [] });
    sql.mockResolvedValueOnce({ rows: [] }); // timestamp stamp

    const out = await reconcileProfile(2);
    expect(out).toEqual({ profileId: 2, result: RECONCILE_RESULT.NO_MATCH });
  });
});

describe('reconcileProfile — failure path', () => {
  test('profile not found or inactive returns ERROR without querying Dynamics', async () => {
    sql.mockResolvedValueOnce({ rows: [] });
    const query = jest.spyOn(DynamicsService, 'queryRecords');

    const out = await reconcileProfile(999);
    expect(out).toEqual({ profileId: 999, result: RECONCILE_RESULT.ERROR, error: 'Profile not found or inactive' });
    expect(query).not.toHaveBeenCalled();
  });

  test('silent mode swallows a Dynamics query error and returns ERROR', async () => {
    sql.mockResolvedValueOnce({
      rows: [{ id: 3, azure_email: 'boom@example.org', dynamics_systemuser_id: null }],
    });
    jest.spyOn(DynamicsService, 'queryRecords').mockRejectedValue(new Error('dataverse down'));

    const out = await reconcileProfile(3, { silent: true });
    expect(out).toEqual({ profileId: 3, result: RECONCILE_RESULT.ERROR, error: 'dataverse down' });
  });

  test('non-silent mode rethrows a Dynamics query error', async () => {
    sql.mockResolvedValueOnce({
      rows: [{ id: 4, azure_email: 'boom@example.org', dynamics_systemuser_id: null }],
    });
    jest.spyOn(DynamicsService, 'queryRecords').mockRejectedValue(new Error('dataverse down'));

    await expect(reconcileProfile(4)).rejects.toThrow('dataverse down');
  });
});

describe('reconcileProfile — no azure_email', () => {
  test('skipped without querying Dynamics', async () => {
    sql.mockResolvedValueOnce({ rows: [{ id: 5, azure_email: null, dynamics_systemuser_id: null }] });
    const query = jest.spyOn(DynamicsService, 'queryRecords');

    const out = await reconcileProfile(5);
    expect(out).toEqual({ profileId: 5, result: RECONCILE_RESULT.SKIPPED_NO_EMAIL });
    expect(query).not.toHaveBeenCalled();
  });
});
