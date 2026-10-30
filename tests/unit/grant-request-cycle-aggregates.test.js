/** @jest-environment node */
/**
 * grant-request cycle/status aggregates: the linked-cycle dropdown counts
 * (`aggregateLinkedCycles`, transport limits and akoya_request restrictions;
 * the wmkf_grantcycle restriction cases live in grant-cycle-link.test.js) and
 * the status aggregate.
 */

import { DynamicsService } from '../../lib/services/dynamics-service';
import { bypassDynamicsRestrictions, withDynamicsContext } from '../../lib/services/dynamics-context';
import * as interlock from '../../lib/dataverse/core/interlock';
import { RESEARCH_PROGRAM_IDS } from '../../shared/config/researchPrograms';
import { aggregateLinkedCycles, aggregateStatusesByGrantProgram } from '../../lib/dataverse/adapters/grant-request';

jest.mock('../../lib/dataverse/core/interlock', () => ({
  assertDataverseOperationAllowed: jest.fn(),
}));

let originalUrl;
let fetchMock;
let tokenMock;

beforeEach(() => {
  originalUrl = process.env.DYNAMICS_URL;
  process.env.DYNAMICS_URL = 'https://example.crm.dynamics.com';
  tokenMock = jest.spyOn(DynamicsService, 'getAccessToken').mockResolvedValue('test-token');
  interlock.assertDataverseOperationAllowed.mockReset();
  fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ value: [], '@Microsoft.Dynamics.CRM.morerecords': false }),
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  if (originalUrl === undefined) delete process.env.DYNAMICS_URL;
  else process.env.DYNAMICS_URL = originalUrl;
});

const load = () => bypassDynamicsRestrictions('cycle-aggregate-test', () => aggregateLinkedCycles({ programIds: RESEARCH_PROGRAM_IDS }));

test('returns every cycle beyond the ordinary 100-row page', async () => {
  const rows = Array.from({ length: 150 }, (_, index) => ({
    cyclecode: `${index % 2 ? 'J' : 'D'}${String(index).padStart(2, '0')}`, count: 1,
  }));
  // Simulate the transport limit: using the ordinary read headers loses rows.
  fetchMock.mockImplementation(async (_url, { headers }) => ({
    ok: true,
    json: async () => ({
      value: rows.slice(0, Number(/odata.maxpagesize=(\d+)/.exec(headers.Prefer)?.[1])),
      '@Microsoft.Dynamics.CRM.morerecords': !headers.Prefer.includes('maxpagesize=5000'),
    }),
  }));
  await expect(load()).resolves.toEqual(rows);
  const [url, options] = fetchMock.mock.calls[0];
  const xml = new URL(url).searchParams.get('fetchXml');
  expect(xml).toContain('count="5000" page="1"');
  expect(xml).not.toContain('wmkf_meetingdate');
  expect(xml).not.toContain('aggregatelimit');
  expect(xml).toContain(`<condition attribute="akoya_programid" operator="in">${RESEARCH_PROGRAM_IDS.map((id) => `<value>${id}</value>`).join('')}</condition>`);
  expect(options.signal).toBeInstanceOf(AbortSignal);
  expect(interlock.assertDataverseOperationAllowed).toHaveBeenCalled();
});

test.each([
  { '@Microsoft.Dynamics.CRM.morerecords': true },
  { '@odata.nextLink': 'https://example.crm.dynamics.com/next-page' },
  { '@Microsoft.Dynamics.CRM.fetchxmlpagingcookie': '<cookie page="1" />' },
])('rejects partial groups when continuation metadata is present: %j', async (metadata) => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({
    value: [{ cyclecode: 'D26', count: 20 }], ...metadata,
  }) });
  await expect(load()).rejects.toThrow('refusing partial cycle options');
});

test('rejects a full page even when continuation metadata is absent', async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({
    value: Array.from({ length: 5000 }, () => ({ cyclecode: 'D26', count: 1 })),
  }) });
  await expect(load()).rejects.toThrow('refusing partial cycle options');
});

test('rejects malformed responses and propagates server failure', async () => {
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
  await expect(load()).rejects.toThrow('Invalid linked cycle aggregation response');
  fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
  await expect(load()).rejects.toThrow('Linked cycle aggregation failed (500)');
});

test('refuses calls without restriction context before acquiring a token', async () => {
  await expect(aggregateLinkedCycles()).rejects.toThrow('Restrictions not initialized');
  expect(tokenMock).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
});

test('supports the broad Grant Program lookup and checks its DAL field', async () => {
  const grantProgramId = '11111111-1111-4111-8111-111111111111';
  await expect(bypassDynamicsRestrictions('cycle-aggregate-test', () => (
    aggregateLinkedCycles({ grantProgramIds: [grantProgramId] })
  ))).resolves.toEqual([]);
  const xml = new URL(fetchMock.mock.calls[0][0]).searchParams.get('fetchXml');
  expect(xml).toContain(`<condition attribute="wmkf_grantprogram" operator="in"><value>${grantProgramId}</value></condition>`);
  await expect(withDynamicsContext({ restrictions: [{
    table_name: 'akoya_request', field_name: 'wmkf_grantprogram',
  }] }, () => aggregateLinkedCycles({ grantProgramIds: [grantProgramId] }))).rejects.toThrow('Access denied');
});

test('status aggregation fails closed when the broad lookup field is not allowed', async () => {
  const grantProgramId = '11111111-1111-4111-8111-111111111111';
  await expect(withDynamicsContext({ restrictions: [{
    table_name: 'akoya_request', field_name: 'akoya_requeststatus',
  }] }, () => aggregateStatusesByGrantProgram(grantProgramId))).rejects.toThrow('Access denied');
  expect(tokenMock).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
});

test('status aggregation emits the Dataverse lookup filter for the broad program id', async () => {
  const grantProgramId = '11111111-1111-4111-8111-111111111111';
  await expect(bypassDynamicsRestrictions('cycle-aggregate-test', () => (
    aggregateStatusesByGrantProgram(grantProgramId)
  ))).resolves.toEqual(expect.objectContaining({ results: [] }));
  const requestUrl = String(fetchMock.mock.calls[0]?.[0] || '');
  expect(decodeURIComponent(requestUrl).replace(/\+/g, ' ')).toContain(
    `_wmkf_grantprogram_value eq ${grantProgramId}`,
  );
});

test.each([null, 'akoya_requestid', 'wmkf_grantcycle', 'akoya_programid', 'wmkf_grantprogram'])(
  'enforces the table/field restriction %s before transport', async (fieldName) => {
    await expect(withDynamicsContext({ restrictions: [{
      table_name: 'akoya_request', field_name: fieldName,
    }] }, () => aggregateLinkedCycles(fieldName === 'wmkf_grantprogram'
      ? { grantProgramIds: ['11111111-1111-4111-8111-111111111111'] }
      : { programIds: RESEARCH_PROGRAM_IDS }))).rejects.toThrow('Access denied');
    expect(tokenMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  },
);

test('preserves target-interlock denial before fetch', async () => {
  interlock.assertDataverseOperationAllowed.mockImplementation(() => {
    throw new Error('Target denied');
  });
  await expect(load()).rejects.toThrow('Target denied');
  expect(fetchMock).not.toHaveBeenCalled();
});


test.each([undefined, [], ['<value>injection</value>']])('rejects missing or invalid program scope %j before transport', async (programIds) => {
  await expect(bypassDynamicsRestrictions('cycle-aggregate-test', () => (
    aggregateLinkedCycles({ programIds })
  ))).rejects.toThrow('requires valid program IDs');
  expect(fetchMock).not.toHaveBeenCalled();
});
