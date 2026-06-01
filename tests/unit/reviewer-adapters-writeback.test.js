/**
 * @jest-environment node
 *
 * Guards the S211 enrich-recommended writeback safety fixes (Codex rounds 2–3):
 *  - reviewer-suggestion.setMatchReason — atomic, ETag-conditional, fail-closed on
 *    excluded, single-field PATCH, retry-once-on-412.
 *  - researcher.upsertByPotentialReviewer — race-safe (catch duplicate → re-query
 *    → update) so a concurrent create can't leave a duplicate sidecar.
 */
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import { setMatchReason, APPLICANT_DISPOSITION_EXCLUDED } from '../../lib/dataverse/adapters/reviewer-suggestion.js';
import { upsertByPotentialReviewer } from '../../lib/dataverse/adapters/researcher.js';

function err412() { const e = new Error('Precondition Failed'); e.status = 412; return e; }
function errDup() { const e = new Error('A record with these values already exists. 0x80040237'); e.status = 412; return e; }

afterEach(() => jest.restoreAllMocks());

describe('reviewer-suggestion.setMatchReason — atomic match-reason write', () => {
  test('fail-closed on excluded disposition → no PATCH', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({
      wmkf_applicantdisposition: APPLICANT_DISPOSITION_EXCLUDED, _etag: 'W/"1"',
    });
    const patch = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);

    const out = await setMatchReason('sug-1', 'reason');
    expect(out).toEqual({ updated: false, skippedExcluded: true });
    expect(patch).not.toHaveBeenCalled();
  });

  test('clean path → single PATCH with If-Match + only wmkf_matchreason', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({
      wmkf_applicantdisposition: null, _etag: 'W/"7"',
    });
    const patch = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);

    const out = await setMatchReason('sug-2', 'Recommended by applicant. [Institution COI: …]', { actingUserSystemId: 'u1' });
    expect(out).toEqual({ updated: true });
    expect(patch).toHaveBeenCalledTimes(1);
    const [entitySet, id, body, opts] = patch.mock.calls[0];
    expect(entitySet).toBe('wmkf_appreviewersuggestions');
    expect(id).toBe('sug-2');
    expect(body).toEqual({ wmkf_matchreason: 'Recommended by applicant. [Institution COI: …]' });
    expect(opts).toEqual({ ifMatch: 'W/"7"', actingUserSystemId: 'u1' });
  });

  test('412 on first PATCH → re-read + retry once (succeeds)', async () => {
    jest.spyOn(DynamicsService, 'getRecord')
      .mockResolvedValueOnce({ wmkf_applicantdisposition: null, _etag: 'W/"1"' })
      .mockResolvedValueOnce({ wmkf_applicantdisposition: null, _etag: 'W/"2"' });
    const patch = jest.spyOn(DynamicsService, 'updateRecord')
      .mockRejectedValueOnce(err412())
      .mockResolvedValueOnce(undefined);

    const out = await setMatchReason('sug-3', 'reason');
    expect(out).toEqual({ updated: true });
    expect(patch).toHaveBeenCalledTimes(2);
    expect(patch.mock.calls[1][3].ifMatch).toBe('W/"2"'); // fresh etag on retry
  });

  test('retry also 412 → throws (no infinite loop)', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({ wmkf_applicantdisposition: null, _etag: 'W/"1"' });
    jest.spyOn(DynamicsService, 'updateRecord').mockRejectedValue(err412());
    await expect(setMatchReason('sug-4', 'reason')).rejects.toThrow();
  });

  test('row excluded by the time of the 412 retry → fail-closed, no further PATCH', async () => {
    jest.spyOn(DynamicsService, 'getRecord')
      .mockResolvedValueOnce({ wmkf_applicantdisposition: null, _etag: 'W/"1"' })
      .mockResolvedValueOnce({ wmkf_applicantdisposition: APPLICANT_DISPOSITION_EXCLUDED, _etag: 'W/"2"' });
    const patch = jest.spyOn(DynamicsService, 'updateRecord').mockRejectedValueOnce(err412());

    const out = await setMatchReason('sug-5', 'reason');
    expect(out).toEqual({ updated: false, skippedExcluded: true });
    expect(patch).toHaveBeenCalledTimes(1); // only the first (failed) attempt
  });
});

describe('researcher.upsertByPotentialReviewer — race-safe', () => {
  test('duplicate on create → re-query + update (no duplicate row)', async () => {
    // getByPotentialReviewer: first null (so we attempt create), then the raced row.
    jest.spyOn(DynamicsService, 'queryRecords')
      .mockResolvedValueOnce({ records: [] })
      .mockResolvedValueOnce({ records: [{ wmkf_appresearcherid: 'res-1' }] });
    const create = jest.spyOn(DynamicsService, 'createRecord').mockRejectedValue(errDup());
    const update = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);

    const out = await upsertByPotentialReviewer('pr-1', { name: 'Dr. R', hIndex: 5 });
    expect(create).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][1]).toBe('res-1'); // updated the raced row
    expect(out).toEqual({ id: 'res-1', created: false });
  });

  test('non-duplicate create error propagates', async () => {
    jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [] });
    const boom = new Error('500 server error'); boom.status = 500;
    jest.spyOn(DynamicsService, 'createRecord').mockRejectedValue(boom);
    await expect(upsertByPotentialReviewer('pr-2', { name: 'Dr. S' })).rejects.toThrow('500 server error');
  });
});
