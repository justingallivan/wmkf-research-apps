/** @jest-environment node */
import { canEditCalendar, latestChanges, loadCalendar, saveDate } from '../../lib/services/cycle-calendar-service';
import { CYCLE_CALENDAR_DATE_COLUMNS } from '../../shared/config/cycleCalendar';

jest.mock('../../lib/services/board-writeups/config', () => ({ eligibleStaff: jest.fn(), getRole: jest.fn() }));
jest.mock('../../lib/dataverse/adapters/operations-grant-cycle', () => ({
  listModernCycles: jest.fn(), updateCycleDates: jest.fn(), getChangeHistory: jest.fn(),
}));

const SARAH = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const J27_ID = '33333333-3333-3333-3333-333333333333';
const actor = { profileId: 7, systemUserId: SARAH };

function row(code, boardDate, extra = {}) {
  return { wmkf_grantcycleid: code === 'J27' ? J27_ID : '44444444-4444-4444-4444-444444444444', wmkf_cyclecode: code, wmkf_name: code, wmkf_meetingdate: `${boardDate}T00:00:00Z`, _etag: 'W/"101"', ...extra };
}

function deps(overrides = {}) {
  return {
    listModernCycles: jest.fn().mockResolvedValue([row('D26', '2026-12-10'), row('J27', '2027-06-10'), row('J15', '2015-06-10'), row('D2026', '2026-12-10')]),
    updateCycleDates: jest.fn().mockResolvedValue(undefined),
    getChangeHistory: jest.fn().mockResolvedValue({ details: [], moreRecords: false }),
    eligibleStaff: jest.fn().mockResolvedValue({ systemUserId: SARAH, profileId: 7, isSuperuser: false }),
    getRole: jest.fn(async role => ({ value: role === 'grantsManager' ? { systemUserId: SARAH } : { systemUserId: OTHER } })),
    impersonationEnabled: () => true,
    now: () => new Date('2026-10-29T03:00:00Z'), // Oct 28 in Pacific time
    ...overrides,
  };
}

const goodSave = { cycleCode: 'J27', column: 'wmkf_researchreviewsduedate', value: '2027-03-17', etag: 'W/"101"' };

describe('canEditCalendar', () => {
  test('assigned Grants Manager may edit; eligibility checked without Reviewer app access', async () => {
    const d = deps();
    expect(await canEditCalendar(actor, d)).toBe(true);
    expect(d.eligibleStaff).toHaveBeenCalledWith(SARAH, { app: false });
  });
  test('assigned Program Coordinator may edit', async () => {
    const d = deps({ getRole: jest.fn(async role => ({ value: role === 'programCoordinator' ? { systemUserId: SARAH } : null })) });
    expect(await canEditCalendar(actor, d)).toBe(true);
  });
  test('staff member holding neither role may not edit', async () => {
    const d = deps({ getRole: jest.fn(async () => ({ value: { systemUserId: OTHER } })) });
    expect(await canEditCalendar(actor, d)).toBe(false);
  });
  test('superuser may edit without a role', async () => {
    const d = deps({ eligibleStaff: jest.fn().mockResolvedValue({ systemUserId: SARAH, profileId: 7, isSuperuser: true }), getRole: jest.fn(async () => ({ value: null })) });
    expect(await canEditCalendar(actor, d)).toBe(true);
  });
  test('profile mismatch, missing Dynamics identity or ineligible staff cannot edit', async () => {
    expect(await canEditCalendar({ ...actor, profileId: 8 }, deps())).toBe(false);
    expect(await canEditCalendar({ profileId: 7, systemUserId: null }, deps())).toBe(false);
    expect(await canEditCalendar(actor, deps({ eligibleStaff: jest.fn().mockRejectedValue(new Error('disabled')) }))).toBe(false);
  });
});

// Keys mirror a real RetrieveRecordChangeHistory response captured by
// scripts/probe-audit-history-shape.cjs (2026-10-28, structure only); values are synthetic.
const FV = '@OData.Community.Display.V1.FormattedValue';
function attributeDetail({ createdon, user, newValue = {}, oldValue = {} }) {
  return {
    '@odata.type': '#Microsoft.Dynamics.CRM.AttributeAuditDetail',
    AuditRecord: {
      '@odata.type': '#Microsoft.Dynamics.CRM.audit', auditid: 'a', action: 2, [`action${FV}`]: 'Update', operation: 2,
      [`operation${FV}`]: 'Update', attributemask: '1', objecttypecode: 'wmkf_grantcycle', _objectid_value: J27_ID,
      _userid_value: SARAH, ...(user ? { [`_userid_value${FV}`]: user } : {}), ...(createdon ? { createdon, [`createdon${FV}`]: 'x' } : {}),
      transactionid: 't', versionnumber: 1,
    },
    DeletedAttributes: {}, InvalidNewValueAttributes: [], LocLabelLanguageCode: 0, NewValue: newValue, OldValue: oldValue,
  };
}
// The J27 row's only entry before any edit: no @odata.type and no value sides.
const AUDIT_ENABLED_ENTRY = { AuditRecord: { createdon: '2026-10-29T02:00:00Z', [`_userid_value${FV}`]: 'App' } };

describe('latestChanges', () => {
  test('keeps the newest change per column and sees cleared dates in OldValue', () => {
    const { changes, complete } = latestChanges([
      attributeDetail({ createdon: '2026-10-29T10:00:00Z', user: 'Duncan Spore', newValue: { wmkf_researchreviewsduedate: '2027-03-17T00:00:00Z', [`wmkf_researchreviewsduedate${FV}`]: '3/17/2027' } }),
      attributeDetail({ createdon: '2026-10-30T10:00:00Z', user: 'Sarah Hibler', oldValue: { wmkf_researchreviewsduedate: '2027-03-17T00:00:00Z' } }),
      attributeDetail({ createdon: '2026-10-31T10:00:00Z', user: 'Connor Noda', newValue: { wmkf_name: 'x', [`wmkf_researchproposalduedate${FV}`]: '12/7/2026' } }),
      AUDIT_ENABLED_ENTRY,
    ]);
    expect(complete).toBe(true);
    expect(changes.get('wmkf_researchreviewsduedate')).toEqual({ changedAt: '2026-10-30T10:00:00Z', changedBy: 'Sarah Hibler', value: null });
    expect(changes.has('wmkf_name')).toBe(false);
    expect(changes.has('wmkf_researchproposalduedate')).toBe(false);
  });
  test('the audit-enabled entry alone is complete history with no changes', () => {
    const { changes, complete } = latestChanges([AUDIT_ENABLED_ENTRY]);
    expect(complete).toBe(true);
    expect(changes.size).toBe(0);
  });
  test.each([
    ['missing AuditRecord', { NewValue: { wmkf_researchreviewsduedate: '2027-03-17T00:00:00Z' } }],
    ['missing createdon', attributeDetail({ user: 'Sarah Hibler', newValue: { wmkf_researchreviewsduedate: '2027-03-17T00:00:00Z' } })],
    ['missing user name', attributeDetail({ createdon: '2026-10-30T10:00:00Z', newValue: { wmkf_researchreviewsduedate: '2027-03-17T00:00:00Z' } })],
  ])('a tracked change with %s makes history incomplete', (_name, detail) => {
    expect(latestChanges([detail]).complete).toBe(false);
  });
  test('a paged collection is incomplete', () => {
    expect(latestChanges([], { moreRecords: true }).complete).toBe(false);
  });
});

describe('loadCalendar', () => {
  test('lists recent modern cycles in Board-date order and defaults to the nearest upcoming one', async () => {
    const result = await loadCalendar(actor, deps());
    expect(result.cycles.map(c => c.code)).toEqual(['D26', 'J27']);
    expect(result.defaultCycleCode).toBe('D26');
    expect(result.canEdit).toBe(true);
    expect(result.savingAvailable).toBe(true);
    const j27 = result.cycles[1];
    expect(j27.board.value).toBe('2027-06-10');
    expect(j27.dates.map(x => x.column)).toEqual(CYCLE_CALENDAR_DATE_COLUMNS.map(x => x.column));
    expect(j27.dates.every(x => x.value === null)).toBe(true);
  });
  test('a failed history read still shows dates and flags history as unavailable', async () => {
    const d = deps({ getChangeHistory: jest.fn().mockRejectedValue(Object.assign(new Error('no'), { status: 403 })) });
    const result = await loadCalendar(actor, d);
    expect(result.cycles.every(c => c.historyAvailable === false)).toBe(true);
    expect(result.cycles[0].dates[0]).toMatchObject({ changedBy: null, changedAt: null });
  });
  test('incomplete history makes no per-date claims even for parsable entries', async () => {
    const d = deps({ getChangeHistory: jest.fn().mockResolvedValue({
      details: [attributeDetail({ createdon: '2026-10-30T10:00:00Z', user: 'Sarah Hibler', newValue: { wmkf_researchproposalduedate: '2026-12-07T00:00:00Z' } })],
      moreRecords: true,
    }) });
    const result = await loadCalendar(actor, d);
    expect(result.cycles.every(c => c.historyAvailable === false)).toBe(true);
    expect(result.cycles[0].dates[0]).toMatchObject({ changedBy: null, changedAt: null });
  });
  test.each([
    ['history newer than the displayed value (edit between the two reads)', '2026-12-07T00:00:00Z', '2026-12-09T00:00:00Z'],
    ['displayed value changed outside auditing', '2026-12-10T00:00:00Z', '2026-12-07T00:00:00Z'],
    ['date shown but latest audit cleared it', '2026-12-07T00:00:00Z', null],
    ['audited value unreadable', '2026-12-07T00:00:00Z', 'not a date'],
  ])('no attribution when %s', async (_name, shown, audited) => {
    const d = deps({
      listModernCycles: jest.fn().mockResolvedValue([row('J27', '2027-06-10', { wmkf_researchproposalduedate: shown })]),
      getChangeHistory: jest.fn().mockResolvedValue({
        details: [attributeDetail({ createdon: '2026-10-30T10:00:00Z', user: 'Duncan Spore',
          ...(audited === null ? { oldValue: { wmkf_researchproposalduedate: '2026-12-07T00:00:00Z' } } : { newValue: { wmkf_researchproposalduedate: audited } }) })],
        moreRecords: false,
      }),
    });
    const result = await loadCalendar(actor, d);
    expect(result.cycles[0].dates[0]).toMatchObject({ changedBy: null, changedAt: null });
  });
  test('a cleared date shown as Not set is attributed to whoever cleared it', async () => {
    const d = deps({
      listModernCycles: jest.fn().mockResolvedValue([row('J27', '2027-06-10')]),
      getChangeHistory: jest.fn().mockResolvedValue({
        details: [attributeDetail({ createdon: '2026-10-30T10:00:00Z', user: 'Sarah Hibler', oldValue: { wmkf_researchproposalduedate: '2026-12-07T00:00:00Z' } })],
        moreRecords: false,
      }),
    });
    const result = await loadCalendar(actor, d);
    expect(result.cycles[0].dates[0]).toMatchObject({ value: null, changedBy: 'Sarah Hibler' });
  });
  test('complete history attributes each date', async () => {
    const d = deps({ getChangeHistory: jest.fn().mockResolvedValue({
      details: [AUDIT_ENABLED_ENTRY, attributeDetail({ createdon: '2026-10-30T10:00:00Z', user: 'Sarah Hibler', newValue: { wmkf_researchproposalduedate: '2026-12-07T00:00:00Z' } })],
      moreRecords: false,
    }), listModernCycles: jest.fn().mockResolvedValue([row('D26', '2026-12-10', { wmkf_researchproposalduedate: '2026-12-07T00:00:00Z' })]) });
    const result = await loadCalendar(actor, d);
    expect(result.cycles[0].historyAvailable).toBe(true);
    expect(result.cycles[0].dates[0]).toMatchObject({ column: 'wmkf_researchproposalduedate', changedBy: 'Sarah Hibler', changedAt: '2026-10-30T10:00:00Z' });
  });
  test('date values are taken as calendar dates, never shifted by time zone', async () => {
    const d = deps({ listModernCycles: jest.fn().mockResolvedValue([row('J27', '2027-06-10', { wmkf_researchproposalduedate: '2026-12-07T00:00:00Z' })]) });
    const result = await loadCalendar(actor, d);
    expect(result.cycles[0].dates[0]).toMatchObject({ column: 'wmkf_researchproposalduedate', value: '2026-12-07' });
  });
});

describe('saveDate', () => {
  test('writes one allowlisted column with the ETag, impersonating the editor', async () => {
    const d = deps();
    await saveDate(actor, goodSave, d);
    expect(d.updateCycleDates).toHaveBeenCalledWith(J27_ID, 'W/"101"', { wmkf_researchreviewsduedate: '2027-03-17' }, { actingUserSystemId: SARAH });
  });
  test('clearing a date writes null', async () => {
    const d = deps();
    await saveDate(actor, { ...goodSave, value: null }, d);
    expect(d.updateCycleDates).toHaveBeenCalledWith(J27_ID, 'W/"101"', { wmkf_researchreviewsduedate: null }, { actingUserSystemId: SARAH });
  });
  test.each([
    ['Board date', { column: 'wmkf_meetingdate' }],
    ['cycle code', { column: 'wmkf_cyclecode' }],
    ['unknown cycle code shape', { cycleCode: 'D2026' }],
    ['impossible date', { value: '2027-02-30' }],
    ['time-of-day value', { value: '2027-03-17T08:00:00Z' }],
    ['header-shaped ETag', { etag: 'W/"1"\r\nX: y' }],
    ['extra field', { profileId: 99 }],
  ])('rejects %s before any write', async (_name, change) => {
    const d = deps();
    await expect(saveDate(actor, { ...goodSave, ...change }, d)).rejects.toMatchObject({ httpStatus: 400 });
    expect(d.updateCycleDates).not.toHaveBeenCalled();
  });
  test('refuses when impersonation is not configured, before checking roles or writing', async () => {
    const d = deps({ impersonationEnabled: () => false });
    await expect(saveDate(actor, goodSave, d)).rejects.toMatchObject({ httpStatus: 503, code: 'calendar_saving_unavailable' });
    expect(d.eligibleStaff).not.toHaveBeenCalled();
    expect(d.updateCycleDates).not.toHaveBeenCalled();
  });
  test('non-editor is refused without a write', async () => {
    const d = deps({ getRole: jest.fn(async () => ({ value: { systemUserId: OTHER } })) });
    await expect(saveDate(actor, goodSave, d)).rejects.toMatchObject({ httpStatus: 403, code: 'calendar_edit_denied' });
    expect(d.updateCycleDates).not.toHaveBeenCalled();
  });
  test('a concurrent change (412) becomes a reload conflict', async () => {
    const d = deps({ updateCycleDates: jest.fn().mockRejectedValue(Object.assign(new Error('changed'), { status: 412 })) });
    await expect(saveDate(actor, goodSave, d)).rejects.toMatchObject({ httpStatus: 409, code: 'calendar_conflict' });
  });
  test('Dataverse refusing the impersonated write (403) is reported, not retried', async () => {
    const d = deps({ updateCycleDates: jest.fn().mockRejectedValue(Object.assign(new Error('denied'), { status: 403 })) });
    await expect(saveDate(actor, goodSave, d)).rejects.toMatchObject({ httpStatus: 403, code: 'calendar_dataverse_denied' });
    expect(d.updateCycleDates).toHaveBeenCalledTimes(1);
  });
  test('a cycle with no row is not created', async () => {
    const d = deps({ listModernCycles: jest.fn().mockResolvedValue([row('D26', '2026-12-10')]) });
    await expect(saveDate(actor, goodSave, d)).rejects.toMatchObject({ httpStatus: 404 });
    expect(d.updateCycleDates).not.toHaveBeenCalled();
  });
});


test('the observed J27 Leadership email audit shape matches the saved date', async () => {
  const column = 'wmkf_researchleadershipsemifinalistemaildate';
  const detail = {
    '@odata.type': '#Microsoft.Dynamics.CRM.AttributeAuditDetail',
    AuditRecord: { createdon: '2026-10-29T16:16:53.243Z', [`_userid_value${FV}`]: 'Grants Manager' },
    NewValue: {
      '@odata.type': '#Microsoft.Dynamics.CRM.wmkf_grantcycle',
      [column]: '2026-03-01T00:00:00Z', [`${column}${FV}`]: '3/1/2026',
    },
    OldValue: { '@odata.type': '#Microsoft.Dynamics.CRM.wmkf_grantcycle' },
    DeletedAttributes: { Count: 0, Keys: [], Values: [] }, InvalidNewValueAttributes: [],
  };
  const result = await loadCalendar(actor, deps({
    listModernCycles: jest.fn().mockResolvedValue([row('J27', '2027-06-10', { [column]: '2026-03-01T00:00:00Z' })]),
    getChangeHistory: jest.fn().mockResolvedValue({ details: [detail, AUDIT_ENABLED_ENTRY], moreRecords: false }),
  }));
  expect(result.cycles[0].historyAvailable).toBe(true);
  expect(result.cycles[0].dates.find(entry => entry.column === column)).toMatchObject({
    value: '2026-03-01', changedBy: 'Grants Manager', changedAt: '2026-10-29T16:16:53.243Z',
  });
});
