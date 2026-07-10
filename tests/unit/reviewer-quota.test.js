/**
 * Reviewer quota → PD notify (Phase 4) — count-after-write threshold + the
 * conditional null→set (If-Match) "notify once" concurrency gate.
 */

const getRecord = jest.fn();
const updateRecord = jest.fn();
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: { getRecord: (...a) => getRecord(...a), updateRecord: (...a) => updateRecord(...a) },
}));
const countAcceptedForRequest = jest.fn();
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  countAcceptedForRequest: (...a) => countAcceptedForRequest(...a),
}));
jest.mock('../../lib/services/program-director-resolver', () => ({
  resolveProgramDirectorEmailForRequest: jest.fn(async () => 'pd@keck.org'),
}));
const notify = jest.fn(async () => {});
jest.mock('../../lib/services/notification-service', () => ({ __esModule: true, default: { notify: (...a) => notify(...a) } }));

const { maybeNotifyQuotaReached } = require('../../lib/services/reviewer-quota');

const REQ = 'req-1';
function request(over = {}) {
  return {
    akoya_requestid: REQ, akoya_requestnum: 'R-1',
    wmkf_desiredcount: 3, wmkf_quotanotifiedat: null,
    _wmkf_programdirector_value: 'pd-1', _etag: 'W/"5"',
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  updateRecord.mockResolvedValue(undefined);
});

test('count reaches desired + marker null → conditional set (If-Match) then notify PD', async () => {
  getRecord.mockResolvedValue(request());
  countAcceptedForRequest.mockResolvedValue(3);
  const r = await maybeNotifyQuotaReached({ requestId: REQ });
  expect(r).toMatchObject({ notified: true, count: 3, desired: 3 });
  expect(updateRecord).toHaveBeenCalledWith(
    'akoya_requests', REQ,
    expect.objectContaining({ wmkf_quotanotifiedat: expect.any(String) }),
    expect.objectContaining({ ifMatch: 'W/"5"' }),
  );
  expect(notify).toHaveBeenCalledTimes(1);
  expect(notify.mock.calls[0][0]).toMatchObject({
    type: 'reviewer_quota_reached',
    emailAdmins: true,
    explicitRecipients: ['pd@keck.org'],
  });
  expect(notify.mock.calls[0][0].category).toBeUndefined();
});

test('PD email unresolvable → still notified (marker owns once-only), empty explicitRecipients, no category fallback', async () => {
  const resolver = require('../../lib/services/program-director-resolver');
  resolver.resolveProgramDirectorEmailForRequest.mockResolvedValueOnce(null);
  getRecord.mockResolvedValue(request());
  countAcceptedForRequest.mockResolvedValue(3);
  const r = await maybeNotifyQuotaReached({ requestId: REQ });
  expect(r).toMatchObject({ notified: true, count: 3, desired: 3 });
  expect(notify).toHaveBeenCalledTimes(1);
  expect(notify.mock.calls[0][0]).toMatchObject({
    type: 'reviewer_quota_reached',
    emailAdmins: true,
    explicitRecipients: [],
  });
  expect(notify.mock.calls[0][0].category).toBeUndefined();
});

test('below desired → no marker write, no notify', async () => {
  getRecord.mockResolvedValue(request());
  countAcceptedForRequest.mockResolvedValue(2);
  const r = await maybeNotifyQuotaReached({ requestId: REQ });
  expect(r).toMatchObject({ notified: false, reason: 'below_quota' });
  expect(updateRecord).not.toHaveBeenCalled();
  expect(notify).not.toHaveBeenCalled();
});

test('already notified (marker set) → skip without counting or notifying', async () => {
  getRecord.mockResolvedValue(request({ wmkf_quotanotifiedat: '2026-06-01T00:00:00Z' }));
  const r = await maybeNotifyQuotaReached({ requestId: REQ });
  expect(r).toMatchObject({ notified: false, reason: 'already_notified' });
  expect(countAcceptedForRequest).not.toHaveBeenCalled();
  expect(notify).not.toHaveBeenCalled();
});

test('no desired count configured → skip', async () => {
  getRecord.mockResolvedValue(request({ wmkf_desiredcount: null }));
  const r = await maybeNotifyQuotaReached({ requestId: REQ });
  expect(r).toMatchObject({ notified: false, reason: 'no_quota_configured' });
  expect(notify).not.toHaveBeenCalled();
});

test('412 then re-read shows marker SET (another accept won) → no double-notify', async () => {
  // Initial read: marker null. Re-read after the 412: marker now set by the winner.
  getRecord
    .mockResolvedValueOnce(request())
    .mockResolvedValueOnce(request({ wmkf_quotanotifiedat: '2026-06-01T00:00:00Z' }));
  countAcceptedForRequest.mockResolvedValue(4);
  updateRecord.mockRejectedValueOnce(Object.assign(new Error('precondition failed'), { status: 412 }));
  const r = await maybeNotifyQuotaReached({ requestId: REQ });
  expect(r).toMatchObject({ notified: false, reason: 'lost_notify_race' });
  expect(notify).not.toHaveBeenCalled();
});

test('412 from an UNRELATED akoya_request write (marker still null) → retries and notifies (Codex finding #1)', async () => {
  // First write 412s (e.g. a concurrent campaign-config/triage write bumped the ETag); the
  // re-read shows the marker is STILL null, so we must retry — not silently lose the notify.
  getRecord
    .mockResolvedValueOnce(request({ _etag: 'W/"5"' }))
    .mockResolvedValueOnce(request({ _etag: 'W/"6"', wmkf_quotanotifiedat: null }));
  countAcceptedForRequest.mockResolvedValue(3);
  updateRecord
    .mockRejectedValueOnce(Object.assign(new Error('precondition failed'), { status: 412 }))
    .mockResolvedValueOnce(undefined);
  const r = await maybeNotifyQuotaReached({ requestId: REQ });
  expect(r.notified).toBe(true);
  // The retry used the FRESH etag from the re-read.
  expect(updateRecord).toHaveBeenLastCalledWith('akoya_requests', REQ, expect.any(Object), { ifMatch: 'W/"6"' });
  expect(notify).toHaveBeenCalledTimes(1);
});

test('marker write succeeds but notify throws → still reported notified (marker owns once-only)', async () => {
  getRecord.mockResolvedValue(request());
  countAcceptedForRequest.mockResolvedValue(3);
  notify.mockRejectedValueOnce(new Error('SMTP down'));
  const r = await maybeNotifyQuotaReached({ requestId: REQ });
  expect(r.notified).toBe(true); // the threshold transition happened; alert delivery is best-effort
});
