/** @jest-environment node */
/**
 * Grant Cycle link helpers (docs/plans/MEETING_DATE_RETIREMENT_PLAN_2026-10-29.md
 * §5b item 1): every filter, expand and calendar read checks the restriction on
 * wmkf_grantcycle explicitly, for both a table block and a field block on
 * wmkf_cyclecode, before any transport call.
 */

import { DynamicsService } from '../../lib/services/dynamics-service';
import { bypassDynamicsRestrictions, withDynamicsContext } from '../../lib/services/dynamics-context';
import * as interlock from '../../lib/dataverse/core/interlock';
import {
  linkedCycleFilter,
  linkedCycleExpand,
  linkedCycleCode,
  noLinkedCycleFilter,
  getCycleDatesById,
  listBoardDates,
  findCycleByCode,
  listModernCycles,
  listBoardDatesOrNone,
} from '../../lib/dataverse/adapters/operations-grant-cycle';
import { getById, aggregateLinkedCycles, findByIds, findByRequestNumber, findByPotentialReviewerSlots } from '../../lib/dataverse/adapters/grant-request';

jest.mock('../../lib/dataverse/core/interlock', () => ({
  assertDataverseOperationAllowed: jest.fn(),
}));

const CYCLE_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const PROGRAM_ID = '11111111-1111-4111-8111-111111111111';
const TABLE_BLOCK = [{ table_name: 'wmkf_grantcycle', field_name: null }];
const FIELD_BLOCK = [{ table_name: 'wmkf_grantcycle', field_name: 'wmkf_cyclecode' }];

let originalUrl;
let fetchMock;
let tokenMock;

beforeEach(() => {
  originalUrl = process.env.DYNAMICS_URL;
  process.env.DYNAMICS_URL = 'https://example.crm.dynamics.com';
  tokenMock = jest.spyOn(DynamicsService, 'getAccessToken').mockResolvedValue('test-token');
  fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ value: [] }),
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  if (originalUrl === undefined) delete process.env.DYNAMICS_URL;
  else process.env.DYNAMICS_URL = originalUrl;
});

const open = (fn) => bypassDynamicsRestrictions('grant-cycle-link-test', fn);
const restricted = (restrictions, fn) => withDynamicsContext({ restrictions }, fn);

describe('linkedCycleFilter / linkedCycleExpand', () => {
  test('build the navigation filter and expand for a modern code', () => {
    expect(open(() => linkedCycleFilter('J27'))).toBe("wmkf_GrantCycle/wmkf_cyclecode eq 'J27'");
    expect(open(() => linkedCycleExpand())).toBe('wmkf_GrantCycle($select=wmkf_cyclecode)');
    // Sandbox read 2026-10-30: partitions requests with linkedCycleCode null.
    expect(open(() => noLinkedCycleFilter())).toBe(
      "(_wmkf_grantcycle_value eq null or not (startswith(wmkf_GrantCycle/wmkf_cyclecode,'J') or startswith(wmkf_GrantCycle/wmkf_cyclecode,'D')))",
    );
  });

  test.each(['j27', 'X27', 'J2', '', null, undefined, "J27' or 1 eq 1"])('filter refuses a non-modern code %p', (code) => {
    expect(() => open(() => linkedCycleFilter(code))).toThrow('modern J/D code');
  });

  test.each([
    ['table', TABLE_BLOCK],
    ['field', FIELD_BLOCK],
  ])('%s restriction on wmkf_grantcycle blocks the filter and the expand', (_kind, restrictions) => {
    expect(() => restricted(restrictions, () => noLinkedCycleFilter())).toThrow('Access denied');
    expect(() => restricted(restrictions, () => linkedCycleFilter('D26'))).toThrow('Access denied');
    expect(() => restricted(restrictions, () => linkedCycleExpand())).toThrow('Access denied');
  });

  test('fail closed outside a restriction context', () => {
    expect(() => linkedCycleFilter('D26')).toThrow('Restrictions not initialized');
    expect(() => linkedCycleExpand()).toThrow('Restrictions not initialized');
  });
});

describe('linkedCycleCode', () => {
  test('reads the modern code from an expanded request row', () => {
    expect(linkedCycleCode({ wmkf_GrantCycle: { wmkf_cyclecode: 'D26', wmkf_grantcycleid: CYCLE_ID } })).toBe('D26');
  });

  test.each([
    ['no link', { wmkf_GrantCycle: null }],
    ['not expanded', { _wmkf_grantcycle_value: CYCLE_ID }],
    ['historical code', { wmkf_GrantCycle: { wmkf_cyclecode: '2014-D' } }],
    ['blank code', { wmkf_GrantCycle: { wmkf_cyclecode: '' } }],
    ['no row', null],
  ])('%s → no cycle', (_label, row) => {
    expect(linkedCycleCode(row)).toBeNull();
  });
});

describe('calendar reads check the restriction before any request', () => {
  const reads = [
    ['getCycleDatesById', () => getCycleDatesById(CYCLE_ID)],
    ['listBoardDates', () => listBoardDates()],
    ['findCycleByCode', () => findCycleByCode('D26')],
    ['listModernCycles', () => listModernCycles()],
  ];

  test.each(reads.flatMap(([name, read]) => [
    [name, 'table', TABLE_BLOCK, read],
    [name, 'field', FIELD_BLOCK, read],
  ]))('%s: %s restriction throws', async (_name, _kind, restrictions, read) => {
    await expect(restricted(restrictions, read)).rejects.toThrow('Access denied');
    expect(tokenMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test.each(reads)('%s still reads with an unrestricted context', async (_name, read) => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ value: [], wmkf_cyclecode: 'D26' }) });
    await expect(open(read)).resolves.toBeDefined();
    expect(fetchMock).toHaveBeenCalled();
  });
});

describe('grant-request.getById expand', () => {
  test('passes the expand through the real transport and returns the nested row', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ akoya_requestid: REQUEST_ID, wmkf_GrantCycle: { wmkf_cyclecode: 'D26', wmkf_grantcycleid: CYCLE_ID } }),
    });
    const row = await open(() => getById(REQUEST_ID, { select: ['akoya_requestid'], expand: linkedCycleExpand() }));
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get('$expand')).toBe('wmkf_GrantCycle($select=wmkf_cyclecode)');
    expect(url.searchParams.get('$select')).toBe('akoya_requestid');
    expect(linkedCycleCode(row)).toBe('D26');
  });

  test('without expand the request carries no $expand', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ akoya_requestid: REQUEST_ID }) });
    await open(() => getById(REQUEST_ID, { select: ['akoya_requestid'] }));
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.has('$expand')).toBe(false);
  });

  test('expand without select is refused', async () => {
    await expect(open(() => getById(REQUEST_ID, { expand: 'wmkf_GrantCycle($select=wmkf_cyclecode)' })))
      .rejects.toThrow('expand requires select');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('a table block on wmkf_grantcycle stops the expanded read', async () => {
    await expect(restricted(TABLE_BLOCK, () => getById(REQUEST_ID, {
      select: ['akoya_requestid'],
      expand: 'wmkf_GrantCycle($select=wmkf_cyclecode)',
    }))).rejects.toThrow('Access denied');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('grant-request.aggregateLinkedCycles', () => {
  const load = () => open(() => aggregateLinkedCycles({ grantProgramIds: [PROGRAM_ID] }));

  test('groups by the linked row code with an inner link and the program condition', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ value: [{ cyclecode: 'D26', count: 12 }] }) });
    await expect(load()).resolves.toEqual([{ cyclecode: 'D26', count: 12 }]);
    const xml = new URL(fetchMock.mock.calls[0][0]).searchParams.get('fetchXml');
    expect(xml).toContain('<link-entity name="wmkf_grantcycle" from="wmkf_grantcycleid" to="wmkf_grantcycle" link-type="inner" alias="gc">');
    expect(xml).toContain('<attribute name="wmkf_cyclecode" alias="cyclecode" groupby="true"/>');
    expect(xml).toContain(`<condition attribute="wmkf_grantprogram" operator="in"><value>${PROGRAM_ID}</value></condition>`);
    expect(xml).not.toContain('wmkf_meetingdate');
  });

  test.each([
    { '@Microsoft.Dynamics.CRM.morerecords': true },
    { '@odata.nextLink': 'https://example.crm.dynamics.com/next-page' },
    { '@Microsoft.Dynamics.CRM.fetchxmlpagingcookie': '<cookie page="1" />' },
  ])('refuses a partial result: %j', async (metadata) => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ value: [{ cyclecode: 'D26', count: 1 }], ...metadata }) });
    await expect(load()).rejects.toThrow('refusing partial cycle options');
  });

  test.each([
    ['table', TABLE_BLOCK],
    ['field', FIELD_BLOCK],
  ])('%s restriction on wmkf_grantcycle throws before transport', async (_kind, restrictions) => {
    await expect(restricted(restrictions, () => aggregateLinkedCycles({ grantProgramIds: [PROGRAM_ID] })))
      .rejects.toThrow('Access denied');
    expect(tokenMock).not.toHaveBeenCalled();
  });

  test('refuses invalid program ids and a missing context', async () => {
    await expect(open(() => aggregateLinkedCycles({ grantProgramIds: ['nope'] }))).rejects.toThrow('valid program IDs');
    await expect(aggregateLinkedCycles({ grantProgramIds: [PROGRAM_ID] })).rejects.toThrow('Restrictions not initialized');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('listBoardDatesOrNone', () => {
  test('returns the Board dates when the calendar reads', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ value: [{ wmkf_cyclecode: 'D26', wmkf_meetingdate: '2026-12-10' }] }) });
    await expect(open(() => listBoardDatesOrNone())).resolves.toEqual([{ wmkf_cyclecode: 'D26', wmkf_meetingdate: '2026-12-10' }]);
  });

  test('returns no dates when the calendar read fails', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    await expect(open(() => listBoardDatesOrNone())).resolves.toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  test.each([
    ['table', TABLE_BLOCK],
    ['field', FIELD_BLOCK],
  ])('%s restriction still throws', async (_kind, restrictions) => {
    await expect(restricted(restrictions, () => listBoardDatesOrNone())).rejects.toThrow('Access denied');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('grant-request list reads forward expand', () => {
  test.each([
    ['findByIds', () => findByIds([REQUEST_ID], { select: ['akoya_requestid'], expand: linkedCycleExpand() })],
    ['findByRequestNumber', () => findByRequestNumber('1002912', { select: ['akoya_requestid'], expand: linkedCycleExpand() })],
    ['findByPotentialReviewerSlots', () => findByPotentialReviewerSlots(CYCLE_ID, { expand: linkedCycleExpand() })],
  ])('%s', async (_name, read) => {
    await open(read);
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('$expand')).toBe('wmkf_GrantCycle($select=wmkf_cyclecode)');
  });

  test.each([
    ['findByIds', () => findByIds([REQUEST_ID], { select: ['akoya_requestid'] })],
    ['findByRequestNumber', () => findByRequestNumber('1002912', { select: ['akoya_requestid'] })],
  ])('%s without expand sends none', async (_name, read) => {
    await open(read);
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.has('$expand')).toBe(false);
  });
});
