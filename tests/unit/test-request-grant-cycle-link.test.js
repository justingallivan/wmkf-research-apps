/**
 * Meeting-date retirement step 5 (docs/plans/MEETING_DATE_RETIREMENT_PLAN_2026-10-29.md):
 * an admin Factory clone links to a destination Grant Cycle row and takes its
 * meeting date and fiscal year from that row's Board date.
 */
import { jest } from '@jest/globals';
import { cloneCycleFromCalendarRow } from '../../lib/services/test-requests/sandbox-clone.js';
import { listDestinationGrantCycles, resolveDestinationGrantCycle } from '../../lib/services/test-requests/basic-clone-steps.js';

const CYCLE_ID = '16161616-1616-4161-8161-161616161616';
const ok = (body) => ({ ok: true, status: 200, body });

describe('cloneCycleFromCalendarRow', () => {
  test('takes the meeting date and the "Month YYYY" fiscal year from the Board date, never from the cycle letter', () => {
    expect(cloneCycleFromCalendarRow({ grantCycleId: CYCLE_ID.toUpperCase(), cycleCode: 'D26', boardDate: '2026-12-10' })).toEqual({
      grantCycleId: CYCLE_ID, cycleCode: 'D26', meetingDate: '2026-12-10', fiscalYear: 'December 2026',
    });
    expect(cloneCycleFromCalendarRow({ grantCycleId: CYCLE_ID, cycleCode: 'J27', boardDate: '2027-06-03' }).fiscalYear).toBe('June 2027');
    // A test row whose Board date is not in its letter's month keeps the date's own month.
    expect(cloneCycleFromCalendarRow({ grantCycleId: CYCLE_ID, cycleCode: 'D97', boardDate: '2097-11-30' }).fiscalYear).toBe('November 2097');
  });

  test('refuses a row with no valid Board date, a non-GUID id, or a historical code', () => {
    expect(() => cloneCycleFromCalendarRow({ grantCycleId: CYCLE_ID, cycleCode: 'D27', boardDate: null })).toThrow(/D27 has no Board date/);
    expect(() => cloneCycleFromCalendarRow({ grantCycleId: CYCLE_ID, cycleCode: 'D27', boardDate: '2027-02-30' })).toThrow(/no Board date/);
    expect(() => cloneCycleFromCalendarRow({ grantCycleId: 'D26', cycleCode: 'D26', boardDate: '2026-12-10' })).toThrow(/row is invalid/);
    expect(() => cloneCycleFromCalendarRow({ grantCycleId: CYCLE_ID, cycleCode: 'FY2019', boardDate: '2019-12-01' })).toThrow(/row is invalid/);
  });
});

describe('listDestinationGrantCycles', () => {
  test('reads J/D rows through the given client and returns code and Board date in Board-date order, no ids', async () => {
    const get = jest.fn(async () => ok({
      value: [
        { wmkf_grantcycleid: CYCLE_ID, wmkf_cyclecode: 'J27', wmkf_meetingdate: '2027-06-03T00:00:00Z' },
        { wmkf_grantcycleid: CYCLE_ID, wmkf_cyclecode: 'D27', wmkf_meetingdate: null },
        { wmkf_grantcycleid: CYCLE_ID, wmkf_cyclecode: 'Dx1', wmkf_meetingdate: '2020-12-01T00:00:00Z' },
        { wmkf_grantcycleid: CYCLE_ID, wmkf_cyclecode: 'D26', wmkf_meetingdate: '2026-12-10T00:00:00Z' },
      ],
    }));
    expect(await listDestinationGrantCycles({ get })).toEqual([
      { cycleCode: 'D26', boardDate: '2026-12-10' },
      { cycleCode: 'J27', boardDate: '2027-06-03' },
      { cycleCode: 'D27', boardDate: null },
    ]);
    const path = decodeURIComponent(get.mock.calls[0][0]);
    expect(path).toMatch(/^\/wmkf_grantcycles\?\$select=wmkf_grantcycleid,wmkf_cyclecode,wmkf_meetingdate&/);
    expect(path).toContain("startswith(wmkf_cyclecode,'J') or startswith(wmkf_cyclecode,'D')");
  });

  test('refuses a failed or paged read', async () => {
    await expect(listDestinationGrantCycles({ get: async () => ({ ok: false, status: 403, text: 'no' }) })).rejects.toThrow(/Grant Cycle list failed \(403\)/);
    await expect(listDestinationGrantCycles({ get: async () => ok({ value: [], '@odata.nextLink': 'x' }) })).rejects.toThrow(/missing or paged/);
  });
});

describe('resolveDestinationGrantCycle', () => {
  test('resolves exactly one row by code, filtered by the escaped code, into the clone cycle values', async () => {
    const get = jest.fn(async () => ok({ value: [{ wmkf_grantcycleid: CYCLE_ID, wmkf_cyclecode: 'D99', wmkf_meetingdate: '2099-12-03T00:00:00Z' }] }));
    expect(await resolveDestinationGrantCycle({ get }, 'D99')).toEqual({
      grantCycleId: CYCLE_ID, cycleCode: 'D99', meetingDate: '2099-12-03', fiscalYear: 'December 2099',
    });
    const path = decodeURIComponent(get.mock.calls[0][0]);
    expect(path).toContain("$filter=wmkf_cyclecode eq 'D99'");
    expect(path).toContain('$top=2');
  });

  test('refuses a bad code before any read, and zero or two rows after it', async () => {
    const get = jest.fn();
    await expect(resolveDestinationGrantCycle({ get }, "D26' or 1 eq 1")).rejects.toThrow(/J or D and two digits/);
    await expect(resolveDestinationGrantCycle({ get }, 'd26')).rejects.toThrow(/J or D and two digits/);
    expect(get).not.toHaveBeenCalled();
    await expect(resolveDestinationGrantCycle({ get: async () => ok({ value: [] }) }, 'J99')).rejects.toThrow(/found 0/);
    const row = { wmkf_grantcycleid: CYCLE_ID, wmkf_cyclecode: 'J99', wmkf_meetingdate: '2099-06-04T00:00:00Z' };
    await expect(resolveDestinationGrantCycle({ get: async () => ok({ value: [row, row] }) }, 'J99')).rejects.toThrow(/found 2/);
  });

  test('refuses the one row when it has no Board date', async () => {
    const get = async () => ok({ value: [{ wmkf_grantcycleid: CYCLE_ID, wmkf_cyclecode: 'D27', wmkf_meetingdate: null }] });
    await expect(resolveDestinationGrantCycle({ get }, 'D27')).rejects.toThrow(/D27 has no Board date/);
  });
});
