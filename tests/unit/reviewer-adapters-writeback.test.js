/**
 * @jest-environment node
 *
 * Guards the S211 enrich-recommended writeback safety fixes (Codex rounds 2–3):
 *  - reviewer-suggestion.setMatchReason — atomic, ETag-conditional, fail-closed on
 *    excluded, single-field PATCH, retry-once-on-412.
 *  - researcher.upsertByPotentialReviewer — post-collapse (S213) writes bibliometrics
 *    directly onto the person (no sidecar create/race path); metrics overwrite,
 *    descriptive fields fill-if-empty, affiliation → wmkf_primaryaffiliation.
 */
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import { setMatchReason, ensureStaffManualCandidate, APPLICANT_DISPOSITION_EXCLUDED } from '../../lib/dataverse/adapters/reviewer-suggestion.js';
import { upsertByPotentialReviewer } from '../../lib/dataverse/adapters/researcher.js';

function err412() { const e = new Error('Precondition Failed'); e.status = 412; return e; }

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

describe('reviewer-suggestion.ensureStaffManualCandidate — source union + excluded wins', () => {
  test('existing non-excluded row is re-selected and unions staff_manual without clobbering sources', async () => {
    jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({
      records: [{
        wmkf_appreviewersuggestionid: 'sug-1',
        wmkf_sources: 'pubmed,applicant',
        wmkf_selected: false,
        wmkf_applicantdisposition: null,
        wmkf_suggestionlabel: 'Existing label',
        wmkf_matchreason: 'Existing reason',
      }],
    });
    const patch = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);
    const create = jest.spyOn(DynamicsService, 'createRecord').mockResolvedValue(undefined);

    const out = await ensureStaffManualCandidate({
      potentialReviewerId: 'pr-1',
      requestId: 'req-1',
      suggestionLabel: 'New label',
      matchReason: 'Manual note',
    }, { actingUserSystemId: 'u1' });

    expect(out).toEqual({ id: 'sug-1', created: false, selected: true });
    expect(create).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith('wmkf_appreviewersuggestions', 'sug-1', {
      wmkf_sources: 'pubmed,applicant,staff_manual',
      wmkf_selected: true,
    }, { actingUserSystemId: 'u1' });
  });

  test('existing excluded row is not resurrected', async () => {
    jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({
      records: [{
        wmkf_appreviewersuggestionid: 'sug-ex',
        wmkf_sources: 'applicant',
        wmkf_selected: false,
        wmkf_applicantdisposition: APPLICANT_DISPOSITION_EXCLUDED,
      }],
    });
    const patch = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);

    const out = await ensureStaffManualCandidate({
      potentialReviewerId: 'pr-1',
      requestId: 'req-1',
    });

    expect(out).toEqual({ id: 'sug-ex', created: false, selected: false, skippedExcluded: true });
    expect(patch).not.toHaveBeenCalled();
  });

  test('new row writes staff_manual and request/person binds', async () => {
    jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [] });
    const create = jest.spyOn(DynamicsService, 'createRecord').mockResolvedValue({
      wmkf_appreviewersuggestionid: 'sug-new',
    });

    const out = await ensureStaffManualCandidate({
      potentialReviewerId: 'pr-2',
      requestId: 'req-2',
      suggestionLabel: 'Proposal — Reviewer',
      grantCycleCode: 'J26',
      programArea: 'Science',
      matchReason: 'Manual note',
    });

    expect(out).toEqual({ id: 'sug-new', created: true, selected: true });
    expect(create).toHaveBeenCalledWith('wmkf_appreviewersuggestions', expect.objectContaining({
      wmkf_suggestionlabel: 'Proposal — Reviewer',
      wmkf_grantcyclecode: 'J26',
      wmkf_programarea: 'Science',
      wmkf_matchreason: 'Manual note',
      wmkf_sources: 'staff_manual',
      wmkf_selected: true,
      'wmkf_PotentialReviewer@odata.bind': '/wmkf_potentialreviewerses(pr-2)',
      'wmkf_Request@odata.bind': '/akoya_requests(req-2)',
    }), { actingUserSystemId: undefined });
  });
});

describe('researcher.upsertByPotentialReviewer — writes bibliometrics onto the person (S213 collapse)', () => {
  test('updates the person row (no create); metrics overwrite, affiliation → wmkf_primaryaffiliation', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({ wmkf_potentialreviewersid: 'pr-1' });
    const create = jest.spyOn(DynamicsService, 'createRecord').mockResolvedValue(undefined);
    const update = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);

    const out = await upsertByPotentialReviewer('pr-1', { hIndex: 5, affiliation: 'MIT' });

    expect(create).not.toHaveBeenCalled();        // no sidecar create path anymore
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][1]).toBe('pr-1'); // wrote to the person id
    const payload = update.mock.calls[0][2];
    expect(payload.wmkf_hindex).toBe(5);
    expect(payload.wmkf_primaryaffiliation).toBe('MIT');
    expect(out).toEqual({ id: 'pr-1', created: false });
  });

  test('descriptive fields fill-if-empty; metrics always overwrite', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({
      wmkf_potentialreviewersid: 'pr-2', wmkf_primaryaffiliation: 'Existing U', wmkf_hindex: 3,
    });
    const update = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);

    await upsertByPotentialReviewer('pr-2', { affiliation: 'New U', hIndex: 9 });
    const payload = update.mock.calls[0][2];
    expect(payload.wmkf_primaryaffiliation).toBeUndefined(); // already set → not overwritten
    expect(payload.wmkf_hindex).toBe(9);                     // metric always overwrites
  });
});
