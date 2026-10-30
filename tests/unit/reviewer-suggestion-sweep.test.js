/** @jest-environment node */
import { jest } from '@jest/globals';
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import { sweepStaleInvites } from '../../lib/services/reviewer-suggestion-sweep.js';
import { REVIEW_STATUS_MAP, RESPONSE_TYPE_MAP } from '../../shared/config/reviewerLifecycle.js';

const SUGGESTION_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_ID = '33333333-3333-4333-8333-333333333333';
const ETAG = 'W/"fresh-42"';
const OLD_DATE = '2020-02-01';
const NOW = new Date('2026-09-04T12:00:00.000Z');

// A parent request read with the linked cycle's code and calendar Board date
// (meeting-date retirement step 4): the sweep closes on the Board date.
function parentRow(requestId, boardDate, cycleCode = 'D26') {
  return { akoya_requestid: requestId, wmkf_GrantCycle: { wmkf_cyclecode: cycleCode, wmkf_meetingdate: boardDate } };
}

function pending(overrides = {}) {
  return {
    wmkf_appreviewersuggestionid: SUGGESTION_ID,
    wmkf_selected: true,
    wmkf_emailsentat: '2020-01-01T00:00:00.000Z',
    _wmkf_request_value: REQUEST_ID,
    wmkf_accepted: false,
    wmkf_declined: false,
    wmkf_responsetype: null,
    wmkf_responsereceivedat: null,
    wmkf_reviewreceivedat: null,
    wmkf_completedat: null,
    wmkf_withdrawnsufficientat: null,
    wmkf_reviewstatus: null,
    wmkf_applicantdisposition: null,
    _etag: ETAG,
    ...overrides,
  };
}

let scanSpy;
let parentSpy;
let readSpy;
let updateSpy;
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(NOW);
  scanSpy = jest.spyOn(DynamicsService, 'queryAllRecords').mockResolvedValue({ records: [pending()] });
  parentSpy = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({
    records: [parentRow(REQUEST_ID, OLD_DATE)],
  });
  readSpy = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue(pending());
  // The cycle restriction check itself is covered in grant-cycle-link.test.js.
  jest.spyOn(DynamicsService, 'checkRestriction').mockImplementation(() => {});
  updateSpy = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue({});
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('sweepStaleInvites', () => {
  it('uses the fresh eligible row version and forwards the actor to the exact expiry patch', async () => {
    scanSpy.mockResolvedValue({ records: [pending({ _etag: 'W/"scan-1"' })] });

    const result = await sweepStaleInvites({ actingUserSystemId: 'staff-1' });

    expect(result).toEqual({ scanned: 1, eligible: 1, swept: 1, skipped: 0, errors: [], dryRun: false });
    expect(readSpy).toHaveBeenCalledTimes(1);
    expect(readSpy).toHaveBeenCalledWith('wmkf_appreviewersuggestions', SUGGESTION_ID, {
      select: expect.any(String),
    });
    expect(readSpy.mock.calls[0][2].select.split(',')).toEqual(expect.arrayContaining([
      'wmkf_selected', 'wmkf_emailsentat', '_wmkf_request_value', 'wmkf_accepted', 'wmkf_declined',
      'wmkf_responsetype', 'wmkf_responsereceivedat', 'wmkf_reviewreceivedat', 'wmkf_reviewstatus',
      'wmkf_completedat', 'wmkf_withdrawnsufficientat', 'wmkf_applicantdisposition',
    ]));
    expect(parentSpy).toHaveBeenCalledTimes(2);
    expect(parentSpy).toHaveBeenLastCalledWith('akoya_requests', {
      select: 'akoya_requestid',
      expand: 'wmkf_GrantCycle($select=wmkf_cyclecode,wmkf_meetingdate)',
      filter: `akoya_requestid eq ${REQUEST_ID}`,
      top: 1,
    });
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith('wmkf_appreviewersuggestions', SUGGESTION_ID, {
      wmkf_responsetype: RESPONSE_TYPE_MAP.no_response,
      wmkf_responsereceivedat: NOW.toISOString(),
    }, { actingUserSystemId: 'staff-1', ifMatch: ETAG });
  });

  it('allows null response booleans and a recommended applicant disposition', async () => {
    readSpy.mockResolvedValue(pending({ wmkf_accepted: null, wmkf_declined: null, wmkf_applicantdisposition: 100000000 }));
    expect(await sweepStaleInvites()).toMatchObject({ swept: 1, skipped: 0, errors: [] });
  });

  it.each([
    ['accepted', { wmkf_accepted: true }],
    ['declined', { wmkf_declined: true }],
    ['removed', { wmkf_selected: false }],
    ['selection missing', { wmkf_selected: null }],
    ['excluded while still selected', { wmkf_applicantdisposition: 100000001 }],
    ['invitation cleared', { wmkf_emailsentat: null }],
    ['empty invitation', { wmkf_emailsentat: '' }],
    ['malformed accepted flag', { wmkf_accepted: 'false' }],
    ['malformed declined flag', { wmkf_declined: 0 }],
    ['response stamp only', { wmkf_responsereceivedat: '2026-09-01' }],
    ['receipt stamp only', { wmkf_reviewreceivedat: '2026-09-01' }],
    ['completion stamp only', { wmkf_completedat: '2026-09-01' }],
    ['sufficient-reviews withdrawal stamp only', { wmkf_withdrawnsufficientat: '2026-09-01' }],
    ...Object.entries(RESPONSE_TYPE_MAP).map(([name, value]) => [`response type ${name}`, { wmkf_responsetype: value }]),
    ['unknown response type', { wmkf_responsetype: 987654321 }],
    ...Object.entries(REVIEW_STATUS_MAP).map(([name, value]) => [`review status ${name}`, { wmkf_reviewstatus: value }]),
    ['unknown review status', { wmkf_reviewstatus: 987654321 }],
  ])('skips a fresh row with %s without overwriting it', async (_name, mutation) => {
    readSpy.mockResolvedValue(pending(mutation));
    expect(await sweepStaleInvites()).toMatchObject({ scanned: 1, eligible: 1, swept: 0, skipped: 1, errors: [] });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it.each([undefined, null, '', ' ', '*', ' W/"42" ', 'W/"42"\n', 'not-an-etag', 'W/""', 'W/"bad\u0000version"', 42])(
    'skips unusable fresh ETag %p even when discovery has a version', async (_etag) => {
      readSpy.mockResolvedValue(pending({ _etag }));
      expect(await sweepStaleInvites()).toMatchObject({ swept: 0, skipped: 1, errors: [] });
      expect(updateSpy).not.toHaveBeenCalled();
    },
  );

  it('accepts a concrete strong ETag without changing its bytes', async () => {
    readSpy.mockResolvedValue(pending({ _etag: '"strong-42"' }));
    expect(await sweepStaleInvites()).toMatchObject({ swept: 1 });
    expect(updateSpy.mock.calls[0][3]).toEqual({ actingUserSystemId: null, ifMatch: '"strong-42"' });
  });

  it.each([null, undefined])('skips missing fresh row %p', async (row) => {
    readSpy.mockResolvedValue(row);
    expect(await sweepStaleInvites()).toMatchObject({ swept: 0, skipped: 1, errors: [] });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('classifies structured Dataverse missing-record errors as skips', async () => {
    readSpy.mockRejectedValue(Object.assign(new Error('gone'), {
      serviceName: 'dataverse', status: 404, dataverseCode: '0x80040217',
    }));
    expect(await sweepStaleInvites()).toMatchObject({ swept: 0, skipped: 1, errors: [] });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it.each([null, OTHER_ID])('skips changed parent %p even when a stale date is available', async (requestId) => {
    readSpy.mockResolvedValue(pending({ _wmkf_request_value: requestId }));
    parentSpy.mockResolvedValue({ records: [
      parentRow(REQUEST_ID, OLD_DATE),
      parentRow(OTHER_ID, OLD_DATE),
    ] });
    expect(await sweepStaleInvites()).toMatchObject({ swept: 0, skipped: 1, errors: [] });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['missing parent', []],
    ['different parent', [parentRow(OTHER_ID, OLD_DATE)]],
    ['missing date', [parentRow(REQUEST_ID, null)]],
    ['invalid date', [parentRow(REQUEST_ID, 'not-a-date')]],
    ['future date', [parentRow(REQUEST_ID, '2030-01-01')]],
    ['cutoff date', [parentRow(REQUEST_ID, NOW.toISOString())]],
    ['no linked cycle', [{ akoya_requestid: REQUEST_ID, wmkf_GrantCycle: null }]],
    ['historical cycle', [parentRow(REQUEST_ID, OLD_DATE, '2014-D')]],
    ['request meeting date only', [{ akoya_requestid: REQUEST_ID, wmkf_meetingdate: OLD_DATE, wmkf_GrantCycle: null }]],
  ])('rechecks parent evidence and skips %s after discovery', async (_name, records) => {
    parentSpy.mockResolvedValueOnce({ records: [parentRow(REQUEST_ID, OLD_DATE)] })
      .mockResolvedValueOnce({ records });
    expect(await sweepStaleInvites()).toMatchObject({ eligible: 1, swept: 0, skipped: 1, errors: [] });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['no linked cycle', { akoya_requestid: REQUEST_ID, wmkf_meetingdate: OLD_DATE, wmkf_GrantCycle: null }],
    ['a cycle with no Board date', parentRow(REQUEST_ID, null, 'D27')],
  ])('never discovers a parent with %s, even when its own meeting date is past', async (_name, row) => {
    parentSpy.mockResolvedValue({ records: [row] });
    expect(await sweepStaleInvites()).toMatchObject({ eligible: 0, swept: 0 });
    expect(readSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('closes on the linked cycle Board date, not the request meeting date', async () => {
    // D26: calendar Board date Dec 10, request meeting date Dec 11 (plan §7 Q4).
    jest.setSystemTime(new Date('2026-12-10T12:00:00.000Z'));
    parentSpy.mockResolvedValue({ records: [
      { ...parentRow(REQUEST_ID, '2026-12-10'), wmkf_meetingdate: '2026-12-11' },
    ] });
    expect(await sweepStaleInvites()).toMatchObject({ eligible: 1, swept: 1 });
  });

  it('leaves discovery rows with invalid or absent Board dates ineligible', async () => {
    parentSpy.mockResolvedValue({ records: [parentRow(REQUEST_ID, 'not-a-date')] });
    expect(await sweepStaleInvites()).toEqual({ scanned: 1, eligible: 0, swept: 0, skipped: 0, errors: [], dryRun: false });
    expect(readSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('skips a PATCH precondition conflict without retry', async () => {
    updateSpy.mockRejectedValue(Object.assign(new Error('changed'), { status: 412 }));
    expect(await sweepStaleInvites()).toMatchObject({ swept: 0, skipped: 1, errors: [] });
    expect(readSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['read', { status: 404 }],
    ['read', { serviceName: 'dataverse', status: 404, dataverseCode: '0xdeadbeef' }],
    ['read', { status: 503 }],
    ['parent', { status: 403 }],
    ['write', { status: 500 }],
    ['write', { status: '412' }],
  ])('retains %s operational failures in errors and proceeds to the next row: %p', async (stage, details) => {
    scanSpy.mockResolvedValue({ records: [pending(), pending({ wmkf_appreviewersuggestionid: OTHER_ID })] });
    readSpy.mockImplementation(async (_entity, id) => pending({ wmkf_appreviewersuggestionid: id }));
    const failure = Object.assign(new Error('x'.repeat(300)), details);
    if (stage === 'read') readSpy.mockRejectedValueOnce(failure);
    if (stage === 'parent') parentSpy.mockResolvedValueOnce({ records: [parentRow(REQUEST_ID, OLD_DATE)] }).mockRejectedValueOnce(failure);
    if (stage === 'write') updateSpy.mockRejectedValueOnce(failure);

    expect(await sweepStaleInvites()).toEqual({
      scanned: 2, eligible: 2, swept: 1, skipped: 0,
      errors: [{ id: SUGGESTION_ID, message: 'x'.repeat(240) }], dryRun: false,
    });
    expect(updateSpy).toHaveBeenLastCalledWith('wmkf_appreviewersuggestions', OTHER_ID, expect.any(Object),
      { actingUserSystemId: null, ifMatch: ETAG });
  });

  it('preserves the hard batch limit and counts unattempted eligible rows as skipped', async () => {
    scanSpy.mockResolvedValue({ records: [pending(), pending({ wmkf_appreviewersuggestionid: OTHER_ID })] });
    expect(await sweepStaleInvites({ maxBatch: 1 })).toEqual({ scanned: 2, eligible: 2, swept: 1, skipped: 1, errors: [], dryRun: false });
    expect(readSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledTimes(1);
  });

  it('does not replace a skipped bounded candidate with a later eligible row', async () => {
    scanSpy.mockResolvedValue({ records: [pending(), pending({ wmkf_appreviewersuggestionid: OTHER_ID })] });
    readSpy.mockResolvedValue(pending({ wmkf_accepted: true }));
    expect(await sweepStaleInvites({ maxBatch: 1 })).toEqual({ scanned: 2, eligible: 2, swept: 0, skipped: 2, errors: [], dryRun: false });
    expect(readSpy).toHaveBeenCalledTimes(1);
    expect(readSpy.mock.calls[0][1]).toBe(SUGGESTION_ID);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('dry run retains discovery counts and batch accounting without fresh reads or writes', async () => {
    scanSpy.mockResolvedValue({ records: [pending(), pending({ wmkf_appreviewersuggestionid: OTHER_ID })] });
    expect(await sweepStaleInvites({ dryRun: true, maxBatch: 1 })).toEqual({
      scanned: 2, eligible: 2, swept: 0, skipped: 1, errors: [], dryRun: true,
    });
    expect(parentSpy).toHaveBeenCalledTimes(1);
    expect(readSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('retains grace-day cutoff semantics during the fresh parent check', async () => {
    parentSpy.mockResolvedValue({ records: [parentRow(REQUEST_ID, '2026-09-03')] });
    expect(await sweepStaleInvites({ graceDays: 2 })).toMatchObject({ eligible: 0, swept: 0 });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('chunks distinct request ids at 25 per OR-filter query', async () => {
    const requestIds = Array.from({ length: 26 }, (_, i) => `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`);
    scanSpy.mockResolvedValue({ records: requestIds.map((id, i) => pending({ wmkf_appreviewersuggestionid: `s${i}`, _wmkf_request_value: id })) });
    parentSpy.mockResolvedValue({ records: [] });
    await sweepStaleInvites();
    expect(parentSpy).toHaveBeenCalledTimes(2);
    expect(parentSpy.mock.calls[0][1].filter.split(' or ')).toEqual(requestIds.slice(0, 25).map((id) => `akoya_requestid eq ${id}`));
    expect(parentSpy.mock.calls[1][1].filter.split(' or ')).toEqual(requestIds.slice(25).map((id) => `akoya_requestid eq ${id}`));
  });

  it('returns the unchanged empty result when discovery has no candidates', async () => {
    scanSpy.mockResolvedValue({ records: [] });
    expect(await sweepStaleInvites()).toEqual({ scanned: 0, eligible: 0, swept: 0, skipped: 0, errors: [], dryRun: false });
    expect(parentSpy).not.toHaveBeenCalled();
    expect(readSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });
});

describe('Test Request isolation (Stage 1c)', () => {
  afterEach(() => { delete process.env.TEST_REQUEST_ISOLATION; });

  function markerRead(marker) {
    readSpy.mockImplementation(async (entitySet) => {
      if (entitySet === 'akoya_requests') {
        if (marker instanceof Error) throw marker;
        return marker;
      }
      return pending();
    });
  }

  it.each([
    ['a test request', { wmkf_istestrequest: true, wmkf_testcreationrunid: OTHER_ID }, 'skippedTestRequest'],
    ['an unreadable marker', new Error('timeout'), 'testStateUnknown'],
  ])('never expires an invitation on %s', async (_label, marker, counter) => {
    process.env.TEST_REQUEST_ISOLATION = 'on';
    markerRead(marker);
    const result = await sweepStaleInvites();
    expect(result).toMatchObject({ eligible: 0, swept: 0, [counter]: 1 });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('still expires an invitation on a verified ordinary request', async () => {
    process.env.TEST_REQUEST_ISOLATION = 'on';
    markerRead({ wmkf_istestrequest: null, wmkf_testcreationrunid: null });
    const result = await sweepStaleInvites();
    expect(result).toMatchObject({ eligible: 1, swept: 1 });
    expect(updateSpy).toHaveBeenCalledTimes(1);
  });
});

