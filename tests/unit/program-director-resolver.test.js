/**
 * Contract test for lib/services/program-director-resolver.js.
 * Golden path: resolveProgramDirectorEmailForRequest resolves the request's PD
 * email through the request read + systemuser read. Failure path: a request
 * read failure returns null (caller falls back to category routing).
 *
 * @jest-environment node
 */
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: { queryRecords: jest.fn(), getRecord: jest.fn() },
}));

import { DynamicsService } from '../../lib/services/dynamics-service';
import {
  resolveByEmail,
  resolveProgramDirectorEmailForRequest,
  clearResolverCache,
} from '../../lib/services/program-director-resolver';

const REQUEST_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PD_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

beforeEach(() => {
  clearResolverCache();
  DynamicsService.getRecord.mockReset();
});

test('resolves the PD email via the request read then the systemuser read', async () => {
  DynamicsService.getRecord.mockImplementation((entity, id, opts) => {
    if (entity === 'akoya_requests') {
      expect(id).toBe(REQUEST_ID);
      expect(opts).toEqual({ select: '_wmkf_programdirector_value' });
      return Promise.resolve({ _wmkf_programdirector_value: PD_ID });
    }
    if (entity === 'systemusers') {
      expect(id).toBe(PD_ID);
      expect(opts).toEqual({ select: 'internalemailaddress,isdisabled' });
      return Promise.resolve({ internalemailaddress: 'PD@Example.com', isdisabled: false });
    }
    throw new Error(`unexpected entity ${entity}`);
  });

  const email = await resolveProgramDirectorEmailForRequest(REQUEST_ID);
  expect(email).toBe('pd@example.com');
});

test('request with no PD assigned resolves to null (no systemuser read)', async () => {
  DynamicsService.getRecord.mockResolvedValue({});
  const email = await resolveProgramDirectorEmailForRequest(REQUEST_ID);
  expect(email).toBeNull();
  expect(DynamicsService.getRecord).toHaveBeenCalledTimes(1);
});

test('request read failure → null (caller falls back to category routing)', async () => {
  DynamicsService.getRecord.mockRejectedValue(new Error('boom'));
  const email = await resolveProgramDirectorEmailForRequest(REQUEST_ID);
  expect(email).toBeNull();
});

test('invalid requestId short-circuits to null without a query', async () => {
  const email = await resolveProgramDirectorEmailForRequest(null);
  expect(email).toBeNull();
  expect(DynamicsService.getRecord).not.toHaveBeenCalled();
});

// Stage 0 characterization pin (OData Escape Consolidation Plan, site 9):
// resolveByEmail doubles an embedded single quote in the internalemailaddress
// filter literal. Survives the odata.escape swap unchanged.
test('resolveByEmail doubles single quotes in the internalemailaddress filter', async () => {
  DynamicsService.queryRecords.mockReset();
  DynamicsService.queryRecords.mockResolvedValue({ records: [] });
  await resolveByEmail("o'brien@example.com");
  const options = DynamicsService.queryRecords.mock.calls[0][1];
  expect(options.filter).toContain("internalemailaddress eq 'o''brien@example.com'");
});

// skipCache: recipient decisions at the moment of a durable event must not reuse a
// warm entry, or a reassignment inside the 10-minute TTL routes to the former PD.
test('skipCache re-reads the assignment instead of serving the warm entry', async () => {
  let pd = PD_ID;
  let email = 'first@example.com';
  DynamicsService.getRecord.mockImplementation((entity) => {
    if (entity === 'akoya_requests') return Promise.resolve({ _wmkf_programdirector_value: pd });
    return Promise.resolve({ internalemailaddress: email, isdisabled: false });
  });

  expect(await resolveProgramDirectorEmailForRequest(REQUEST_ID)).toBe('first@example.com');

  // Staff reassigns the request to a different PD.
  pd = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  email = 'second@example.com';

  // Cached read still returns the stale address...
  expect(await resolveProgramDirectorEmailForRequest(REQUEST_ID)).toBe('first@example.com');
  // ...while skipCache sees the current assignment.
  expect(await resolveProgramDirectorEmailForRequest(REQUEST_ID, { skipCache: true }))
    .toBe('second@example.com');
  // And the refreshed value is what later cached callers get.
  expect(await resolveProgramDirectorEmailForRequest(REQUEST_ID)).toBe('second@example.com');
});

test('skipCache still returns null for a PD disabled since the warm read', async () => {
  let disabled = false;
  DynamicsService.getRecord.mockImplementation((entity) => {
    if (entity === 'akoya_requests') return Promise.resolve({ _wmkf_programdirector_value: PD_ID });
    return Promise.resolve({ internalemailaddress: 'pd@example.com', isdisabled: disabled });
  });

  expect(await resolveProgramDirectorEmailForRequest(REQUEST_ID)).toBe('pd@example.com');
  disabled = true;
  expect(await resolveProgramDirectorEmailForRequest(REQUEST_ID, { skipCache: true })).toBeNull();
});
