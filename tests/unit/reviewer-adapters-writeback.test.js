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
import { upsertByPotentialReviewer, updateById as updateResearcherById } from '../../lib/dataverse/adapters/researcher.js';
import {
  create as createPotentialReviewer,
  clearEmailForEdit,
  update as updatePotentialReviewer,
  upsertByEmail as upsertPotentialReviewerByEmail,
} from '../../lib/dataverse/adapters/potential-reviewer.js';

function err412() { const e = new Error('Precondition Failed'); e.status = 412; return e; }
function duplicateConflict() {
  const e = new Error('A record with matching key values already exists');
  e.status = 412;
  return e;
}

const ENGAGEMENT_STAMP_RESET_PAYLOAD = {
  wmkf_accepted: false,
  wmkf_declined: false,
  wmkf_responsetype: null,
  wmkf_reviewstatus: null,
  wmkf_externaltokenrevoked: true,
  wmkf_invited: false,
  wmkf_emailsentat: null,
  wmkf_respondremindersentat: null,
  wmkf_remindersentat: null,
  wmkf_remindercount: null,
  wmkf_materialssentat: null,
  wmkf_reviewreceivedat: null,
  wmkf_responsereceivedat: null,
  wmkf_thankyousentat: null,
  wmkf_completedat: null,
  wmkf_withdrawnsufficientat: null,
  wmkf_proposalfirstaccessed: null,
};
const ENGAGEMENT_STAMP_RESET_FIELDS = Object.keys(ENGAGEMENT_STAMP_RESET_PAYLOAD);

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
  test.each([
    ['unengaged applicant row', { wmkf_selected: false }, 'promotion_required', 'recommended'],
    ['declined applicant row', { wmkf_selected: false, wmkf_declined: true }, 'restore_required', 'declined'],
    ['already-invited applicant row', { wmkf_selected: true, wmkf_invited: true }, 'already_handled', 'invited'],
  ])('%s unions provenance without selecting or resetting engagement', async (_label, engagement, outcome, stage) => {
    jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({
      records: [{
        wmkf_appreviewersuggestionid: 'sug-applicant',
        _etag: 'W/"applicant"',
        wmkf_sources: 'applicant',
        wmkf_applicantdisposition: 100000000,
        ...engagement,
      }],
    });
    const patch = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);

    const result = await ensureStaffManualCandidate({
      potentialReviewerId: 'pr-applicant',
      requestId: 'req-applicant',
      sources: ['staff_manual', 'referred'],
    }, { actingUserSystemId: 'u1' });

    expect(result).toEqual({
      id: 'sug-applicant',
      created: false,
      selected: false,
      outcome,
      stage,
    });
    const payload = patch.mock.calls[0][2];
    expect(payload).toEqual({ wmkf_sources: 'applicant,staff_manual,referred' });
    expect(payload).not.toHaveProperty('wmkf_selected');
    for (const field of ENGAGEMENT_STAMP_RESET_FIELDS) expect(payload).not.toHaveProperty(field);
  });

  test('source-only applicant provenance stays unselected and preserves completed engagement', async () => {
    jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({
      records: [{
        wmkf_appreviewersuggestionid: 'sug-1',
        _etag: 'W/"1"',
        wmkf_sources: 'pubmed,applicant',
        wmkf_selected: false, // soft-deleted (the "X")
        wmkf_applicantdisposition: null,
        wmkf_suggestionlabel: 'Existing label',
        wmkf_matchreason: 'Existing reason',
        // stale engagement stamps left over from the pre-removal lifecycle
        wmkf_invited: true,
        wmkf_emailsentat: '2026-07-02T00:00:00Z',
        wmkf_respondremindersentat: '2026-07-03T00:00:00Z',
        wmkf_remindersentat: '2026-07-04T00:00:00Z',
        wmkf_remindercount: 2,
        wmkf_materialssentat: '2026-07-05T00:00:00Z',
        wmkf_reviewreceivedat: '2026-07-06T00:00:00Z',
        wmkf_responsereceivedat: '2026-07-07T00:00:00Z',
        wmkf_thankyousentat: '2026-07-08T00:00:00Z',
        wmkf_completedat: '2026-07-09T00:00:00Z',
        wmkf_withdrawnsufficientat: '2026-07-10T00:00:00Z',
        wmkf_proposalfirstaccessed: '2026-07-11T00:00:00Z',
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

    expect(out).toEqual({
      id: 'sug-1',
      created: false,
      selected: false,
      outcome: 'already_handled',
      stage: 'completed',
    });
    expect(create).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith('wmkf_appreviewersuggestions', 'sug-1', {
      wmkf_sources: 'pubmed,applicant,staff_manual',
    }, { actingUserSystemId: 'u1', ifMatch: 'W/"1"' });
    const payload = patch.mock.calls[0][2];
    expect(payload).not.toHaveProperty('wmkf_selected');
    for (const field of ENGAGEMENT_STAMP_RESET_FIELDS) expect(payload).not.toHaveProperty(field);
  });

  test.each([
    ['declined removed row', { wmkf_selected: false, wmkf_declined: true }, 'restore_required', 'declined'],
    ['already-selected row', { wmkf_selected: true }, 'already_handled', 'selected'],
    ['already-invited row', { wmkf_selected: true, wmkf_invited: true }, 'already_handled', 'invited'],
  ])('re-adding a non-applicant %s returns a typed remedy without lifecycle mutation', async (_label, engagement, outcome, stage) => {
    jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({
      records: [{
        wmkf_appreviewersuggestionid: 'sug-live',
        _etag: 'W/"live"',
        wmkf_sources: 'staff_manual',
        wmkf_applicantdisposition: null,
        ...engagement,
        wmkf_emailsentat: '2026-07-02T00:00:00Z',
      }],
    });
    const patch = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);

    const out = await ensureStaffManualCandidate({
      potentialReviewerId: 'pr-1',
      requestId: 'req-1',
      sources: ['staff_manual', 'referred'],
    }, { actingUserSystemId: 'u1' });

    expect(out).toEqual({
      id: 'sug-live',
      created: false,
      selected: engagement.wmkf_selected === true,
      outcome,
      stage,
    });
    const [, , payload] = patch.mock.calls[0];
    expect(payload).toEqual({ wmkf_sources: 'staff_manual,referred' });
    expect(payload).not.toHaveProperty('wmkf_selected');
    for (const field of ENGAGEMENT_STAMP_RESET_FIELDS) {
      expect(payload).not.toHaveProperty(field);
    }
  });

  test('re-adding an unengaged removed non-applicant row still selects it', async () => {
    jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({
      records: [{
        wmkf_appreviewersuggestionid: 'sug-removed',
        _etag: 'W/"removed"',
        wmkf_sources: 'pubmed',
        wmkf_selected: false,
        wmkf_applicantdisposition: null,
      }],
    });
    const patch = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);

    const out = await ensureStaffManualCandidate({
      potentialReviewerId: 'pr-1',
      requestId: 'req-1',
    }, { actingUserSystemId: 'u1' });

    expect(out).toEqual({ id: 'sug-removed', created: false, selected: true });
    expect(patch.mock.calls[0][2]).toEqual({
      wmkf_sources: 'pubmed,staff_manual',
      wmkf_selected: true,
      ...ENGAGEMENT_STAMP_RESET_PAYLOAD,
    });
  });

  test('412 on removed-row re-add re-reads and does not reset stamps if the row is now active', async () => {
    jest.spyOn(DynamicsService, 'queryRecords')
      .mockResolvedValueOnce({
        records: [{
          wmkf_appreviewersuggestionid: 'sug-race',
          _etag: 'W/"1"',
          wmkf_sources: 'pubmed',
          wmkf_selected: false,
          wmkf_applicantdisposition: null,
        }],
      })
      .mockResolvedValueOnce({
        records: [{
          wmkf_appreviewersuggestionid: 'sug-race',
          _etag: 'W/"2"',
          wmkf_sources: 'pubmed,invited_elsewhere',
          wmkf_selected: true,
          wmkf_applicantdisposition: null,
          wmkf_invited: true,
          wmkf_emailsentat: '2026-07-05T00:00:00Z',
          wmkf_remindersentat: '2026-07-06T00:00:00Z',
          wmkf_reviewreceivedat: '2026-07-07T00:00:00Z',
        }],
      });
    const patch = jest.spyOn(DynamicsService, 'updateRecord')
      .mockRejectedValueOnce(err412())
      .mockResolvedValueOnce(undefined);

    const out = await ensureStaffManualCandidate({
      potentialReviewerId: 'pr-1',
      requestId: 'req-1',
    }, { actingUserSystemId: 'u1' });

    expect(out).toEqual({
      id: 'sug-race',
      created: false,
      selected: true,
      outcome: 'already_handled',
      stage: 'review_received',
    });
    expect(patch).toHaveBeenCalledTimes(2);
    expect(patch.mock.calls[0][2]).toMatchObject(ENGAGEMENT_STAMP_RESET_PAYLOAD);
    expect(patch.mock.calls[0][3]).toEqual({ actingUserSystemId: 'u1', ifMatch: 'W/"1"' });

    const [, , retryPayload, retryOpts] = patch.mock.calls[1];
    expect(retryPayload).toEqual({
      wmkf_sources: 'pubmed,invited_elsewhere,staff_manual',
    });
    for (const field of ENGAGEMENT_STAMP_RESET_FIELDS) {
      expect(retryPayload).not.toHaveProperty(field);
    }
    expect(retryOpts).toEqual({ actingUserSystemId: 'u1', ifMatch: 'W/"2"' });
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

  test.each([
    ['unengaged winner', { wmkf_selected: false }, 'promotion_required', 'recommended'],
    ['declined winner', { wmkf_selected: false, wmkf_declined: true }, 'restore_required', 'declined'],
    ['invited winner', { wmkf_selected: true, wmkf_invited: true }, 'already_handled', 'invited'],
  ])('create-conflict recovery keeps an applicant %s provenance-only', async (_label, engagement, outcome, stage) => {
    jest.spyOn(DynamicsService, 'queryRecords')
      .mockResolvedValueOnce({ records: [] })
      .mockResolvedValueOnce({
        records: [{
          wmkf_appreviewersuggestionid: 'sug-race-winner',
          _etag: 'W/"winner"',
          wmkf_sources: 'applicant',
          wmkf_applicantdisposition: 100000000,
          ...engagement,
        }],
      });
    jest.spyOn(DynamicsService, 'createRecord').mockRejectedValue(duplicateConflict());
    const patch = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);

    const out = await ensureStaffManualCandidate({
      potentialReviewerId: 'pr-race',
      requestId: 'req-race',
      sources: ['staff_manual', 'referred'],
    }, { actingUserSystemId: 'u1' });

    expect(out).toEqual({
      id: 'sug-race-winner',
      created: false,
      selected: false,
      outcome,
      stage,
    });
    expect(patch).toHaveBeenCalledWith(
      'wmkf_appreviewersuggestions',
      'sug-race-winner',
      { wmkf_sources: 'applicant,staff_manual,referred' },
      { actingUserSystemId: 'u1', ifMatch: 'W/"winner"' },
    );
    expect(patch.mock.calls[0][2]).not.toHaveProperty('wmkf_selected');
    for (const field of ENGAGEMENT_STAMP_RESET_FIELDS) {
      expect(patch.mock.calls[0][2]).not.toHaveProperty(field);
    }
  });

  test('applicant provenance-only 412 retry re-reads engagement before retrying', async () => {
    jest.spyOn(DynamicsService, 'queryRecords')
      .mockResolvedValueOnce({
        records: [{
          wmkf_appreviewersuggestionid: 'sug-app-race',
          _etag: 'W/"1"',
          wmkf_sources: 'applicant',
          wmkf_applicantdisposition: 100000000,
          wmkf_selected: false,
        }],
      })
      .mockResolvedValueOnce({
        records: [{
          wmkf_appreviewersuggestionid: 'sug-app-race',
          _etag: 'W/"2"',
          wmkf_sources: 'applicant,updated_elsewhere',
          wmkf_applicantdisposition: 100000000,
          wmkf_selected: true,
          wmkf_invited: true,
        }],
      });
    const patch = jest.spyOn(DynamicsService, 'updateRecord')
      .mockRejectedValueOnce(err412())
      .mockResolvedValueOnce(undefined);

    const out = await ensureStaffManualCandidate({
      potentialReviewerId: 'pr-app-race',
      requestId: 'req-app-race',
      sources: ['staff_manual', 'referred'],
    }, { actingUserSystemId: 'u1' });

    expect(out).toEqual({
      id: 'sug-app-race',
      created: false,
      selected: false,
      outcome: 'already_handled',
      stage: 'invited',
    });
    expect(patch).toHaveBeenCalledTimes(2);
    expect(patch.mock.calls[0][2]).toEqual({ wmkf_sources: 'applicant,staff_manual,referred' });
    expect(patch.mock.calls[0][3]).toEqual({ actingUserSystemId: 'u1', ifMatch: 'W/"1"' });
    expect(patch.mock.calls[1][2]).toEqual({
      wmkf_sources: 'applicant,updated_elsewhere,staff_manual,referred',
    });
    expect(patch.mock.calls[1][3]).toEqual({ actingUserSystemId: 'u1', ifMatch: 'W/"2"' });
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

  // Prod 400 fix (req 1002833, "Hongjun Song"): wmkf_primaryaffiliation has a hard
  // 500-char Dynamics cap; a longer (multi-institution OpenAlex) affiliation 400s the
  // whole write. Clamp at the adapter so it never blocks a candidate save.
  test('clamps a >500-char affiliation to the column cap', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({ wmkf_potentialreviewersid: 'pr-long' });
    const update = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);

    const longAff = 'A'.repeat(640);
    await upsertByPotentialReviewer('pr-long', { affiliation: longAff });
    const written = update.mock.calls[0][2].wmkf_primaryaffiliation;
    expect(written.length).toBeLessThanOrEqual(500);
    expect(written.endsWith('…')).toBe(true);
  });

  // wmkf_department has a known 255 cap (schema wave6) — the sibling free-text
  // column; clamp it too (Codex S285 review Medium) so it can't 400 a later write.
  test('clamps a >255-char department to its 255 cap', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({ wmkf_potentialreviewersid: 'pr-dept' });
    const update = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);
    await upsertByPotentialReviewer('pr-dept', { department: 'D'.repeat(400) });
    const written = update.mock.calls[0][2].wmkf_department;
    expect(written.length).toBeLessThanOrEqual(255);
    expect(written.endsWith('…')).toBe(true);
  });

  // updateById is a distinct write path (the dynamic-map loop), not the fillIfEmpty
  // path above — cover its clamp too (Codex S285 review Low: coverage breadth).
  test('updateById clamps affiliation + department on the map-loop path', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({ wmkf_potentialreviewersid: 'pr-upd' });
    const update = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);
    await updateResearcherById('pr-upd', { affiliation: 'A'.repeat(700), department: 'B'.repeat(300) });
    const diff = update.mock.calls[0][2];
    expect(diff.wmkf_primaryaffiliation.length).toBeLessThanOrEqual(500);
    expect(diff.wmkf_department.length).toBeLessThanOrEqual(255);
  });

  test('potential-reviewer.create also clamps wmkf_primaryaffiliation to 500', async () => {
    const create = jest.spyOn(DynamicsService, 'createRecord').mockResolvedValue({ wmkf_potentialreviewersid: 'pr-new' });
    await createPotentialReviewer({ name: 'Hongjun Song', affiliation: 'B'.repeat(700) });
    const payload = create.mock.calls[0][1];
    expect(payload.wmkf_primaryaffiliation.length).toBeLessThanOrEqual(500);
    expect(payload.wmkf_organizationname.length).toBeLessThanOrEqual(100); // shadow still capped
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

  // Manual and contested sources are authoritative safety downgrades and must
  // overwrite a stale trusted value; ordinary search sources stay fill-only.
  test("emailSource:'manual'/'search_contested' OVERWRITE an existing source; ordinary search stays fill-only", async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({
      wmkf_potentialreviewersid: 'pr-3', wmkf_emailsource: 'orcid',
    });
    const update = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);

    await upsertByPotentialReviewer('pr-3', { email: 'x@y.edu', emailSource: 'manual' });
    expect(update.mock.calls[0][2].wmkf_emailsource).toBe('manual'); // staff assertion wins

    update.mockClear();
    await upsertByPotentialReviewer('pr-3', { email: 'x@y.edu', emailSource: 'search_contested' });
    expect(update.mock.calls[0][2].wmkf_emailsource).toBe('search_contested');

    update.mockClear();
    await upsertByPotentialReviewer('pr-3', { email: 'x@y.edu', emailSource: 'serp_search' });
    expect(update.mock.calls[0][2].wmkf_emailsource).toBeUndefined(); // ordinary search: fill-only, not overwritten
  });

  // S387: the narrow scholarly_multi upgrade became a general tier rule, because
  // fill-if-empty pinned a person's address tier to whatever source happened to be
  // recorded first. Live case (request 1002874): a stored `serp_search` kept an address
  // research-only — unsendable — after another request's enrichment found the SAME
  // address embedded in the reviewer's own PubMed affiliation string (`affiliation`).
  test('a stronger tier upgrades a weaker stored source for the same address', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({
      wmkf_potentialreviewersid: 'pr-5',
      wmkf_emailaddress: 'pmali@ucsd.edu',
      wmkf_emailsource: 'serp_search',
      _etag: 'W/"5"',
    });
    const update = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);

    await upsertByPotentialReviewer('pr-5', { email: 'pmali@ucsd.edu', emailSource: 'affiliation' });
    expect(update.mock.calls[0][2].wmkf_emailsource).toBe('affiliation');
    expect(update.mock.calls[0][3].ifMatch).toBe('W/"5"');
  });

  test('a weaker tier never downgrades a stored source, and an equal tier never churns it', async () => {
    const get = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({
      wmkf_potentialreviewersid: 'pr-6',
      wmkf_emailaddress: 'same@y.edu',
      wmkf_emailsource: 'affiliation',
      _etag: 'W/"6"',
    });
    const update = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);

    // Weaker (research_only) — must not touch the field.
    await upsertByPotentialReviewer('pr-6', { email: 'same@y.edu', emailSource: 'serp_search' });
    expect(update.mock.calls[0][2].wmkf_emailsource).toBeUndefined();

    // Equal tier (quick_check → quick_check).
    update.mockClear();
    await upsertByPotentialReviewer('pr-6', { email: 'same@y.edu', emailSource: 'scholarly_single' });
    expect(update.mock.calls[0][2].wmkf_emailsource).toBeUndefined();

    // A staff attestation is not displaced by a same-tier machine source.
    get.mockResolvedValue({
      wmkf_potentialreviewersid: 'pr-6',
      wmkf_emailaddress: 'same@y.edu',
      wmkf_emailsource: 'staff_verified',
      _etag: 'W/"6"',
    });
    update.mockClear();
    await upsertByPotentialReviewer('pr-6', { email: 'same@y.edu', emailSource: 'affiliation' });
    expect(update.mock.calls[0][2].wmkf_emailsource).toBeUndefined();
  });

  // Reversed after adversarial review: a stored HUMAN assertion is terminal against
  // machine evidence, including READY-tier evidence. Promoting it would delete that
  // recipient's send-time acknowledgement on every request sharing the person row.
  test.each([
    ['manual', 'orcid'],
    ['manual', 'institution_page'],
    ['manual', 'scholarly_multi'],
    ['staff_verified', 'orcid'],
    ['staff_verified', 'institution_page'],
    ['staff_verified', 'scholarly_multi'],
  ])('stored %s is NOT upgraded by ready-tier %s', async (stored, incoming) => {
    jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({
      wmkf_potentialreviewersid: 'pr-8',
      wmkf_emailaddress: 'same@y.edu',
      wmkf_emailsource: stored,
      _etag: 'W/"8"',
    });
    const update = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);

    await upsertByPotentialReviewer('pr-8', { email: 'same@y.edu', emailSource: incoming });
    expect(update.mock.calls[0][2].wmkf_emailsource).toBeUndefined();
    expect(update.mock.calls[0][3]?.ifMatch).toBeUndefined();
  });

  test('an upgrade requires the same address, a known incoming source, and an ETag', async () => {
    const get = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({
      wmkf_potentialreviewersid: 'pr-7',
      wmkf_emailaddress: 'same@y.edu',
      wmkf_emailsource: 'serp_search',
      _etag: 'W/"7"',
    });
    const update = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);

    // Different address — the source describes one specific address, so no relabelling.
    await upsertByPotentialReviewer('pr-7', { email: 'other@y.edu', emailSource: 'affiliation' });
    expect(update.mock.calls[0][2].wmkf_emailsource).toBeUndefined();

    // Unrecognized incoming source earns no precedence.
    update.mockClear();
    await upsertByPotentialReviewer('pr-7', { email: 'same@y.edu', emailSource: 'not_a_real_source' });
    expect(update.mock.calls[0][2].wmkf_emailsource).toBeUndefined();

    // No ETag → no unconditional overwrite.
    get.mockResolvedValue({
      wmkf_potentialreviewersid: 'pr-7',
      wmkf_emailaddress: 'same@y.edu',
      wmkf_emailsource: 'serp_search',
    });
    update.mockClear();
    await upsertByPotentialReviewer('pr-7', { email: 'same@y.edu', emailSource: 'affiliation' });
    expect(update.mock.calls[0][2].wmkf_emailsource).toBeUndefined();
    expect(update.mock.calls[0][3]?.ifMatch).toBeUndefined();
  });

  test('scholarly_multi upgrades only the exact stored email and never displaces a ready source', async () => {
    const get = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({
      wmkf_potentialreviewersid: 'pr-4',
      wmkf_emailaddress: 'same@y.edu',
      wmkf_emailsource: 'pubmed',
      _etag: 'W/"4"',
    });
    const update = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);

    await upsertByPotentialReviewer('pr-4', { email: 'same@y.edu', emailSource: 'scholarly_multi' });
    expect(update.mock.calls[0][2].wmkf_emailsource).toBe('scholarly_multi');
    expect(update.mock.calls[0][3].ifMatch).toBe('W/"4"');

    update.mockClear();
    await upsertByPotentialReviewer('pr-4', { email: 'different@y.edu', emailSource: 'scholarly_multi' });
    expect(update.mock.calls[0][2].wmkf_emailsource).toBeUndefined();

    get.mockResolvedValue({
      wmkf_potentialreviewersid: 'pr-4',
      wmkf_emailaddress: 'same@y.edu',
      wmkf_emailsource: 'orcid',
    });
    update.mockClear();
    await upsertByPotentialReviewer('pr-4', { email: 'same@y.edu', emailSource: 'scholarly_multi' });
    expect(update.mock.calls[0][2].wmkf_emailsource).toBeUndefined();
  });
});

// wmkf_name is stored raw (Dynamics does not recompute it), so the adapter must
// normalize whitespace on every write or padded/double-spaced values persist
// (agent-wiki dataverse-dynamics note; the " Test 3 Reviewer " prod finding).
// S387 (second adversarial review): an address must never be written without its
// provenance. The `update` path was fixed first; these lock the CREATE/UPSERT/CLEAR paths,
// which the review found still split the two writes.
describe('potential-reviewer — address and provenance are written together', () => {
  test('create carries emailSource in the same payload as the address', async () => {
    const create = jest.spyOn(DynamicsService, 'createRecord').mockResolvedValue({ wmkf_potentialreviewersid: 'pr-9' });
    await createPotentialReviewer({ name: 'Ada Reviewer', email: 'ada@x.edu', emailSource: 'manual' });
    expect(create.mock.calls[0][1]).toMatchObject({
      wmkf_emailaddress: 'ada@x.edu',
      wmkf_emailsource: 'manual',
    });
  });

  test('create without a source to assert is unchanged (no empty source written)', async () => {
    const create = jest.spyOn(DynamicsService, 'createRecord').mockResolvedValue({ wmkf_potentialreviewersid: 'pr-9' });
    await createPotentialReviewer({ name: 'Ada Reviewer', email: 'ada@x.edu' });
    expect(create.mock.calls[0][1].wmkf_emailaddress).toBe('ada@x.edu');
    expect(create.mock.calls[0][1]).not.toHaveProperty('wmkf_emailsource');
  });

  test('upsertByEmail (create branch) carries emailSource with the address', async () => {
    jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [] });
    const create = jest.spyOn(DynamicsService, 'createRecord').mockResolvedValue({ wmkf_potentialreviewersid: 'pr-10' });
    await upsertPotentialReviewerByEmail(
      { name: 'Ada Reviewer', email: 'ada@x.edu', emailSource: 'affiliation' },
      { existing: null },
    );
    expect(create.mock.calls[0][1]).toMatchObject({
      wmkf_emailaddress: 'ada@x.edu',
      wmkf_emailsource: 'affiliation',
    });
  });
});

describe('potential-reviewer.wmkf_name whitespace normalization', () => {
  test('create trims ends and collapses internal runs', async () => {
    const create = jest.spyOn(DynamicsService, 'createRecord').mockResolvedValue({ wmkf_potentialreviewersid: 'pr-1' });

    await createPotentialReviewer({ name: ' Test 3 Reviewer ' });
    expect(create.mock.calls[0][1].wmkf_name).toBe('Test 3 Reviewer');
    // first/last still come clean from splitName
    expect(create.mock.calls[0][1].wmkf_firstname).toBe('Test');
    expect(create.mock.calls[0][1].wmkf_lastname).toBe('3 Reviewer');

    create.mockClear();
    await createPotentialReviewer({ name: 'Yongmin  Liu' }); // double internal space
    expect(create.mock.calls[0][1].wmkf_name).toBe('Yongmin Liu');
  });

  test('upsertByEmail (create branch) normalizes wmkf_name', async () => {
    const create = jest.spyOn(DynamicsService, 'createRecord').mockResolvedValue({ wmkf_potentialreviewersid: 'pr-2' });
    await upsertPotentialReviewerByEmail({ name: '  Jane   Doe  ', email: null });
    expect(create.mock.calls[0][1].wmkf_name).toBe('Jane Doe');
  });

  test('upsertByEmail reuses a provided existing row without querying by email', async () => {
    const existing = {
      wmkf_potentialreviewersid: 'pr-existing',
      wmkf_emailaddress: 'EXISTING@example.edu',
      wmkf_name: null,
      wmkf_primaryaffiliation: 'Existing University',
    };
    const query = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({
      records: [{
        wmkf_potentialreviewersid: 'pr-drifted',
        wmkf_emailaddress: 'existing@example.edu',
        wmkf_primaryaffiliation: 'Applicant University',
      }],
    });
    const update = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);
    const create = jest.spyOn(DynamicsService, 'createRecord').mockResolvedValue({ wmkf_potentialreviewersid: 'pr-new' });

    const out = await upsertPotentialReviewerByEmail(
      { name: 'Existing Person', email: ' existing@example.edu ', affiliation: 'New University' },
      { actingUserSystemId: 'user-1', existing },
    );

    expect(query).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith('wmkf_potentialreviewerses', 'pr-existing', expect.objectContaining({
      wmkf_name: 'Existing Person',
    }), { actingUserSystemId: 'user-1' });
    expect(update.mock.calls[0][2].wmkf_primaryaffiliation).toBeUndefined();
    expect(out).toEqual({
      id: 'pr-existing',
      created: false,
      reusedAffiliation: 'Existing University',
    });
  });

  test('upsertByEmail treats existing:null as a checked miss and does not query by email', async () => {
    const query = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({
      records: [{
        wmkf_potentialreviewersid: 'pr-drifted',
        wmkf_emailaddress: 'miss@example.edu',
        wmkf_primaryaffiliation: 'Applicant University',
      }],
    });
    const create = jest.spyOn(DynamicsService, 'createRecord').mockResolvedValue({ wmkf_potentialreviewersid: 'pr-new' });

    const out = await upsertPotentialReviewerByEmail(
      { name: 'Checked Miss', email: 'miss@example.edu', affiliation: 'Different University' },
      { actingUserSystemId: 'user-1', existing: null },
    );

    expect(query).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith('wmkf_potentialreviewerses', expect.objectContaining({
      wmkf_emailaddress: 'miss@example.edu',
      wmkf_primaryaffiliation: 'Different University',
    }), { actingUserSystemId: 'user-1' });
    expect(out).toEqual({ id: 'pr-new', created: true, reusedAffiliation: null });
  });

  test('upsertByEmail converges to the active exact-email owner after a concurrent create wins', async () => {
    jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({
      records: [{
        wmkf_potentialreviewersid: 'pr-winner',
        wmkf_emailaddress: 'race@example.edu',
        statecode: 0,
        wmkf_name: null,
      }],
    });
    const duplicate = Object.assign(
      new Error('0x80060892 Entity Key violated DuplicateAttributes><wmkf_emailaddress>race@example.edu</'),
      { status: 412 },
    );
    jest.spyOn(DynamicsService, 'createRecord').mockRejectedValue(duplicate);
    const update = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);

    const out = await upsertPotentialReviewerByEmail(
      { name: 'Race Winner', email: 'Race@Example.edu', emailSource: 'manual' },
      { existing: null, actingUserSystemId: 'user-1' },
    );

    expect(out).toMatchObject({ id: 'pr-winner', created: false });
    expect(update).toHaveBeenCalledWith(
      'wmkf_potentialreviewerses',
      'pr-winner',
      expect.objectContaining({ wmkf_name: 'Race Winner' }),
      { actingUserSystemId: 'user-1' },
    );
  });

  test('upsertByEmail refuses an inactive exact-email owner', async () => {
    const existing = {
      wmkf_potentialreviewersid: 'pr-inactive',
      wmkf_emailaddress: 'inactive@example.edu',
      statecode: 1,
    };

    await expect(upsertPotentialReviewerByEmail(
      { name: 'Inactive Owner', email: 'inactive@example.edu' },
      { existing },
    )).rejects.toMatchObject({ code: 'inactive_email_owner', status: 409 });
  });

  test('update normalizes wmkf_name (empty existing → written clean)', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({}); // no existing value → a real diff
    const update = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);
    await updatePotentialReviewer('pr-3', { name: ' Test 3 Reviewer ' });
    expect(update.mock.calls[0][2].wmkf_name).toBe('Test 3 Reviewer');
  });

  test('ordinary update ignores an empty email instead of clearing shared contact', async () => {
    const get = jest.spyOn(DynamicsService, 'getRecord');
    const update = jest.spyOn(DynamicsService, 'updateRecord');

    await updatePotentialReviewer('pr-3', { email: '', emailSource: 'manual' });

    expect(get).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  test('explicit email clear requires and passes the exact address/source/ETag', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({
      wmkf_potentialreviewersid: 'pr-3',
      wmkf_emailaddress: 'Person@Example.edu',
      wmkf_emailsource: 'manual',
      _etag: 'W/"11"',
    });
    const update = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);

    await expect(clearEmailForEdit('pr-3', {
      expectedEmail: 'person@example.edu',
      expectedEmailSource: 'manual',
      expectedEtag: 'W/"11"',
      reason: 'staff_removed_incorrect_address',
    }, { actingUserSystemId: 'user-1' })).resolves.toMatchObject({ cleared: true });

    expect(update).toHaveBeenCalledWith(
      'wmkf_potentialreviewerses',
      'pr-3',
      { wmkf_emailaddress: null, wmkf_emailsource: null },
      { actingUserSystemId: 'user-1', ifMatch: 'W/"11"' },
    );
  });

  test('explicit email clear fails closed when the shared person changed', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({
      wmkf_potentialreviewersid: 'pr-3',
      wmkf_emailaddress: 'new@example.edu',
      wmkf_emailsource: 'manual',
      _etag: 'W/"12"',
    });
    const update = jest.spyOn(DynamicsService, 'updateRecord');

    await expect(clearEmailForEdit('pr-3', {
      expectedEmail: 'old@example.edu',
      expectedEmailSource: 'manual',
      expectedEtag: 'W/"11"',
      reason: 'staff_removed_incorrect_address',
    })).rejects.toMatchObject({ code: 'contact_clear_conflict', status: 409 });
    expect(update).not.toHaveBeenCalled();
  });
});
