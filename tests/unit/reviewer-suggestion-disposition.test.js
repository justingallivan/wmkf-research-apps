/**
 * Phase 0.7 coverage for the applicant-disposition guard on the
 * wmkf_appreviewersuggestion adapter.
 *
 * - notExcludedFilter() is null-safe (keeps null-disposition rows, the normal
 *   case) — a bare `ne` would drop them because Dataverse omits rows whose
 *   filter evaluates to null.
 * - findById is the action chokepoint: it THROWS on an applicant-excluded row
 *   so the email/token/complete paths can't act on a reviewer the applicant
 *   asked us not to use.
 * - list readers (findByRequest) carry the disposition guard in their filter.
 * - upsert never silently converts an excluded row into a selected candidate.
 *
 * @jest-environment node
 */

import { jest } from '@jest/globals';
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import * as suggestionAdapter from '../../lib/dataverse/adapters/reviewer-suggestion.js';

const {
  notExcludedFilter,
  isExcluded,
  findById,
  findByRequest,
  findApplicantRecommendedByRequest,
  upsert,
  updateLifecycle,
  ensureApplicantRecommended,
  restore,
  APPLICANT_DISPOSITION_EXCLUDED,
  APPLICANT_DISPOSITION_MAP,
  REVIEW_STATUS_MAP,
} = suggestionAdapter;

const REVIEW_STATUS_COMPLETE = 100000004;

const REQUEST_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const PR_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SUGGESTION_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const ENGAGEMENT_STAMP_RESET_PAYLOAD = {
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

let original;
beforeEach(() => {
  original = {
    queryRecords: DynamicsService.queryRecords,
    getRecord: DynamicsService.getRecord,
    createRecord: DynamicsService.createRecord,
    updateRecord: DynamicsService.updateRecord,
  };
  DynamicsService.queryRecords = jest.fn().mockResolvedValue({ records: [] });
  DynamicsService.getRecord = jest.fn().mockResolvedValue(null);
  DynamicsService.createRecord = jest.fn().mockResolvedValue({ wmkf_appreviewersuggestionid: SUGGESTION_ID });
  DynamicsService.updateRecord = jest.fn().mockResolvedValue({});
});
afterEach(() => {
  DynamicsService.queryRecords = original.queryRecords;
  DynamicsService.getRecord = original.getRecord;
  DynamicsService.createRecord = original.createRecord;
  DynamicsService.updateRecord = original.updateRecord;
});

describe('disposition optionset + helpers', () => {
  test('excluded value is 100000001 and distinct from recommended', () => {
    expect(APPLICANT_DISPOSITION_MAP.recommended).toBe(100000000);
    expect(APPLICANT_DISPOSITION_EXCLUDED).toBe(100000001);
  });

  test('notExcludedFilter is null-safe — keeps null-disposition rows', () => {
    const f = notExcludedFilter();
    // Must OR in `eq null` so the common (null) case is not dropped by Dataverse
    // three-valued filter logic.
    expect(f).toBe('(wmkf_applicantdisposition eq null or wmkf_applicantdisposition ne 100000001)');
    expect(f).toContain('eq null or');
  });

  test('isExcluded reflects the excluded optionset value only', () => {
    expect(isExcluded({ wmkf_applicantdisposition: 100000001 })).toBe(true);
    expect(isExcluded({ wmkf_applicantdisposition: 100000000 })).toBe(false);
    expect(isExcluded({ wmkf_applicantdisposition: null })).toBe(false);
    expect(isExcluded({})).toBe(false);
    expect(isExcluded(null)).toBe(false);
  });
});

describe('restore scope guard (Codex S285 review High)', () => {
  test('re-selects a genuinely removed row (selected=false, disposition=null), ETag-guarded', async () => {
    DynamicsService.getRecord.mockResolvedValue({ wmkf_selected: false, wmkf_applicantdisposition: null, _etag: 'W/"42"' });
    await restore(SUGGESTION_ID, { actingUserSystemId: 'SYS-1' });
    // updateLifecycle re-reads then PATCHes wmkf_selected:true.
    const patched = DynamicsService.updateRecord.mock.calls.find((c) => c[2] && 'wmkf_selected' in c[2]);
    expect(patched).toBeTruthy();
    expect(patched[2].wmkf_selected).toBe(true);
    // S343 fresh start: the stale engagement stamps are cleared so the restored
    // row can be invited, reminded, reviewed, and thanked from a clean lifecycle.
    expect(patched[2]).toMatchObject(ENGAGEMENT_STAMP_RESET_PAYLOAD);
    // TOCTOU guard: the write is conditional on the row read by the scope check.
    expect(patched[3]).toMatchObject({ ifMatch: 'W/"42"' });
  });

  test('refuses to restore an applicant-recommended row (must use promotion path)', async () => {
    DynamicsService.getRecord.mockResolvedValue({ wmkf_selected: false, wmkf_applicantdisposition: APPLICANT_DISPOSITION_MAP.recommended });
    await expect(restore(SUGGESTION_ID, { actingUserSystemId: 'SYS-1' })).rejects.toThrow(/non-removed|promotion/i);
    expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
  });

  test('no-op (no PATCH) when the row is already selected', async () => {
    DynamicsService.getRecord.mockResolvedValue({ wmkf_selected: true, wmkf_applicantdisposition: null });
    await restore(SUGGESTION_ID, { actingUserSystemId: 'SYS-1' });
    expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
  });
});

describe('findById action chokepoint', () => {
  test('throws on an applicant-excluded row', async () => {
    DynamicsService.getRecord.mockResolvedValue({
      wmkf_appreviewersuggestionid: SUGGESTION_ID,
      wmkf_applicantdisposition: APPLICANT_DISPOSITION_EXCLUDED,
    });
    await expect(findById(SUGGESTION_ID)).rejects.toThrow(/excluded/i);
  });

  test('returns the row for a normal (null-disposition) suggestion', async () => {
    const row = { wmkf_appreviewersuggestionid: SUGGESTION_ID, wmkf_applicantdisposition: null };
    DynamicsService.getRecord.mockResolvedValue(row);
    await expect(findById(SUGGESTION_ID)).resolves.toBe(row);
  });

  test('returns a recommended row (not excluded) without throwing', async () => {
    const row = {
      wmkf_appreviewersuggestionid: SUGGESTION_ID,
      wmkf_applicantdisposition: APPLICANT_DISPOSITION_MAP.recommended,
    };
    DynamicsService.getRecord.mockResolvedValue(row);
    await expect(findById(SUGGESTION_ID)).resolves.toBe(row);
  });
});

describe('list readers carry the disposition guard', () => {
  test('findByRequest filter excludes applicant-excluded rows', async () => {
    await findByRequest(REQUEST_ID, { selectedOnly: true });
    const filter = DynamicsService.queryRecords.mock.calls[0][1].filter;
    expect(filter).toContain('wmkf_selected eq true');
    expect(filter).toContain(notExcludedFilter());
  });

  test('findApplicantRecommendedByRequest rejects non-GUID request ids', async () => {
    await expect(findApplicantRecommendedByRequest('not-a-guid')).rejects.toThrow(/requestId must be a GUID/);
    expect(DynamicsService.queryRecords).not.toHaveBeenCalled();
  });

  test('findApplicantRecommendedByRequest filters by recommended disposition without selected constraint', async () => {
    await findApplicantRecommendedByRequest(REQUEST_ID);
    const query = DynamicsService.queryRecords.mock.calls[0][1];
    expect(query.filter).toContain(`_wmkf_request_value eq ${REQUEST_ID}`);
    expect(query.filter).toContain('wmkf_applicantdisposition eq 100000000');
    expect(query.filter).toContain(notExcludedFilter());
    expect(query.filter).not.toContain('wmkf_selected');
    expect(query.select).toContain('wmkf_appreviewersuggestionid');
    expect(query.orderby).toBe('createdon desc');
    expect(query.top).toBe(200);
  });
});

// S369 residual 1. Terminality was a UI-only convention: StatusDropdown hides
// itself on terminal rows and the generic PATCH rejected a terminal TARGET, but
// nothing inspected the SOURCE. `{reviewStatus:'complete'}` on a withdrawn row
// therefore reached the close-out branch below and stamped
// wmkf_reviewreceivedat — re-creating the exact aggregateReviewHistory false
// positive the terminal status exists to eliminate. Guarded in the adapter so
// the unguarded batch PATCH path inherits it too.
describe('updateLifecycle refuses to reopen a terminal engagement', () => {
  test.each([
    ['complete', REVIEW_STATUS_MAP.withdrew],
    ['under_review', REVIEW_STATUS_MAP.withdrew],
    ['complete', REVIEW_STATUS_MAP.released],
  ])('refuses %s on a row already in terminal status %s', async (target, terminalValue) => {
    DynamicsService.getRecord.mockResolvedValue({
      wmkf_appreviewersuggestionid: SUGGESTION_ID,
      wmkf_completedat: null,
      wmkf_reviewreceivedat: null,
      wmkf_applicantdisposition: null,
      wmkf_reviewstatus: terminalValue,
    });

    await expect(updateLifecycle(SUGGESTION_ID, { reviewStatus: target }))
      .rejects.toThrow(/out of a terminal review status/);
    expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
  });

  test('allows a non-status write (e.g. notes) on a terminal row', async () => {
    DynamicsService.getRecord.mockResolvedValue({
      wmkf_appreviewersuggestionid: SUGGESTION_ID,
      wmkf_completedat: null,
      wmkf_reviewreceivedat: null,
      wmkf_applicantdisposition: null,
      wmkf_reviewstatus: REVIEW_STATUS_MAP.withdrew,
    });

    await updateLifecycle(SUGGESTION_ID, { notes: 'declined by email' });

    expect(DynamicsService.updateRecord).toHaveBeenCalled();
  });

  test('allows the terminal transition itself (non-terminal source)', async () => {
    DynamicsService.getRecord.mockResolvedValue({
      wmkf_appreviewersuggestionid: SUGGESTION_ID,
      wmkf_completedat: null,
      wmkf_reviewreceivedat: null,
      wmkf_applicantdisposition: null,
      wmkf_reviewstatus: REVIEW_STATUS_MAP.under_review,
    });

    await updateLifecycle(SUGGESTION_ID, { reviewStatus: 'withdrew' });

    const payload = DynamicsService.updateRecord.mock.calls[0][2];
    expect(payload.wmkf_reviewstatus).toBe(REVIEW_STATUS_MAP.withdrew);
    // The close-out stamp branch is keyed strictly to `complete`, so a terminal
    // transition must NOT fabricate a received/completed timestamp.
    expect(payload.wmkf_reviewreceivedat).toBeUndefined();
    expect(payload.wmkf_completedat).toBeUndefined();
  });
});

describe('updateLifecycle stamps close-out timestamps on EVERY complete transition', () => {
  test('stamps completedAt + reviewReceivedAt when both are empty', async () => {
    DynamicsService.getRecord.mockResolvedValue({
      wmkf_appreviewersuggestionid: SUGGESTION_ID,
      wmkf_completedat: null,
      wmkf_reviewreceivedat: null,
      wmkf_applicantdisposition: null,
    });

    await updateLifecycle(SUGGESTION_ID, { reviewStatus: 'complete' });

    const payload = DynamicsService.updateRecord.mock.calls[0][2];
    expect(payload.wmkf_reviewstatus).toBe(REVIEW_STATUS_COMPLETE);
    expect(payload.wmkf_completedat).toEqual(expect.any(String));
    expect(payload.wmkf_reviewreceivedat).toEqual(expect.any(String));
  });

  test('is idempotent — preserves existing close-out timestamps', async () => {
    DynamicsService.getRecord.mockResolvedValue({
      wmkf_appreviewersuggestionid: SUGGESTION_ID,
      wmkf_completedat: '2020-01-01T00:00:00Z',
      wmkf_reviewreceivedat: '2020-02-02T00:00:00Z',
      wmkf_applicantdisposition: null,
    });

    await updateLifecycle(SUGGESTION_ID, { reviewStatus: 'complete' });

    const payload = DynamicsService.updateRecord.mock.calls[0][2];
    expect(payload.wmkf_reviewstatus).toBe(REVIEW_STATUS_COMPLETE);
    expect(payload.wmkf_completedat).toBeUndefined();
    expect(payload.wmkf_reviewreceivedat).toBeUndefined();
  });

  test('does not override a caller-supplied completedAt', async () => {
    DynamicsService.getRecord.mockResolvedValue({ wmkf_completedat: null, wmkf_reviewreceivedat: null, wmkf_applicantdisposition: null });

    await updateLifecycle(SUGGESTION_ID, { reviewStatus: 'complete', completedAt: '2030-12-31T00:00:00Z' });

    const payload = DynamicsService.updateRecord.mock.calls[0][2];
    expect(payload.wmkf_completedat).toBe('2030-12-31T00:00:00Z');
  });

  test('a NON-complete update reads for the exclusion guard but does not stamp', async () => {
    DynamicsService.getRecord.mockResolvedValue({
      wmkf_applicantdisposition: null, wmkf_completedat: null, wmkf_reviewreceivedat: null,
    });
    await updateLifecycle(SUGGESTION_ID, { notes: 'x' });
    expect(DynamicsService.getRecord).toHaveBeenCalled();
    const payload = DynamicsService.updateRecord.mock.calls[0][2];
    expect(payload.wmkf_completedat).toBeUndefined();
    expect(payload.wmkf_reviewreceivedat).toBeUndefined();
  });

  test.each(['withdrew', 'released'])('%s transition stamps no completion timestamps', async (reviewStatus) => {
    DynamicsService.getRecord.mockResolvedValue({
      wmkf_applicantdisposition: null,
      wmkf_completedat: null,
      wmkf_reviewreceivedat: null,
    });
    await updateLifecycle(SUGGESTION_ID, { reviewStatus });
    const payload = DynamicsService.updateRecord.mock.calls[0][2];
    expect(payload.wmkf_reviewstatus).toBe(suggestionAdapter.REVIEW_STATUS_MAP[reviewStatus]);
    expect(payload.wmkf_completedat).toBeUndefined();
    expect(payload.wmkf_reviewreceivedat).toBeUndefined();
  });
});

describe('updateLifecycle fails closed on excluded rows for EVERY write', () => {
  test('refuses to complete an applicant-excluded row', async () => {
    DynamicsService.getRecord.mockResolvedValue({ wmkf_applicantdisposition: APPLICANT_DISPOSITION_EXCLUDED });
    await expect(updateLifecycle(SUGGESTION_ID, { reviewStatus: 'complete' })).rejects.toThrow(/excluded/i);
    expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
  });

  test('refuses a NON-complete lifecycle write on an excluded row too', async () => {
    DynamicsService.getRecord.mockResolvedValue({ wmkf_applicantdisposition: APPLICANT_DISPOSITION_EXCLUDED });
    await expect(updateLifecycle(SUGGESTION_ID, { invited: true })).rejects.toThrow(/excluded/i);
    expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
  });
});

describe('ensureApplicantRecommended (Phase 3 ingestion)', () => {
  test('creates a recommended, unselected, applicant-sourced row when none exists', async () => {
    DynamicsService.queryRecords.mockResolvedValue({ records: [] });

    const result = await ensureApplicantRecommended({
      potentialReviewerId: PR_ID,
      requestId: REQUEST_ID,
      suggestionLabel: 'Title — Jane Doe',
      grantCycleCode: 'D26',
      programArea: 'Medical Research',
      matchReason: 'Recommended by applicant (legacy reviewer slot).',
    });

    expect(result).toEqual({ id: SUGGESTION_ID, created: true, selected: false });
    const payload = DynamicsService.createRecord.mock.calls[0][1];
    expect(payload.wmkf_selected).toBe(false);
    expect(payload.wmkf_applicantdisposition).toBe(APPLICANT_DISPOSITION_MAP.recommended);
    expect(payload.wmkf_sources).toBe('applicant');
    expect(payload['wmkf_PotentialReviewer@odata.bind']).toContain(PR_ID);
    expect(payload['wmkf_Request@odata.bind']).toContain(REQUEST_ID);
  });

  test('merges applicant into existing sources without clobbering, and fills empty label only', async () => {
    DynamicsService.queryRecords.mockResolvedValue({
      records: [{
        wmkf_appreviewersuggestionid: SUGGESTION_ID,
        wmkf_applicantdisposition: null,
        wmkf_sources: 'claude,pubmed',
        wmkf_suggestionlabel: 'Existing label',
      }],
    });

    const result = await ensureApplicantRecommended({
      potentialReviewerId: PR_ID,
      requestId: REQUEST_ID,
      suggestionLabel: 'New label that must not overwrite',
      grantCycleCode: 'D26',
    });

    expect(result).toEqual({ id: SUGGESTION_ID, created: false, selected: true });
    expect(DynamicsService.createRecord).not.toHaveBeenCalled();
    const payload = DynamicsService.updateRecord.mock.calls[0][2];
    expect(payload.wmkf_sources).toBe('claude,pubmed,applicant');
    expect(payload.wmkf_applicantdisposition).toBe(APPLICANT_DISPOSITION_MAP.recommended);
    // selected is NOT written on update — curation state is preserved, never resurrected
    expect(payload.wmkf_selected).toBeUndefined();
    // existing label preserved (not overwritten); empty cycle filled
    expect(payload.wmkf_suggestionlabel).toBeUndefined();
    expect(payload.wmkf_grantcyclecode).toBe('D26');
  });

  test('does NOT resurrect a staff-removed candidate (selected=false stays false)', async () => {
    DynamicsService.queryRecords.mockResolvedValue({
      records: [{
        wmkf_appreviewersuggestionid: SUGGESTION_ID,
        wmkf_applicantdisposition: APPLICANT_DISPOSITION_MAP.recommended,
        wmkf_sources: 'applicant',
        wmkf_suggestionlabel: 'Title — Jane Doe',
        wmkf_selected: false, // staff soft-deleted this candidate
      }],
    });

    const result = await ensureApplicantRecommended({ potentialReviewerId: PR_ID, requestId: REQUEST_ID });

    expect(result).toEqual({ id: SUGGESTION_ID, created: false, selected: false });
    const payload = DynamicsService.updateRecord.mock.calls[0][2];
    // The update must NOT flip wmkf_selected back to true.
    expect(payload.wmkf_selected).toBeUndefined();
  });

  test('is idempotent — re-running with applicant already in sources keeps a single source', async () => {
    DynamicsService.queryRecords.mockResolvedValue({
      records: [{
        wmkf_appreviewersuggestionid: SUGGESTION_ID,
        wmkf_applicantdisposition: APPLICANT_DISPOSITION_MAP.recommended,
        wmkf_sources: 'applicant',
        wmkf_suggestionlabel: 'Title — Jane Doe',
      }],
    });

    await ensureApplicantRecommended({ potentialReviewerId: PR_ID, requestId: REQUEST_ID });

    expect(DynamicsService.createRecord).not.toHaveBeenCalled();
    const payload = DynamicsService.updateRecord.mock.calls[0][2];
    expect(payload.wmkf_sources).toBe('applicant');
  });

  test('excluded wins — never flips an existing excluded row to recommended', async () => {
    DynamicsService.queryRecords.mockResolvedValue({
      records: [{
        wmkf_appreviewersuggestionid: SUGGESTION_ID,
        wmkf_applicantdisposition: APPLICANT_DISPOSITION_EXCLUDED,
        wmkf_sources: 'applicant',
      }],
    });

    const result = await ensureApplicantRecommended({ potentialReviewerId: PR_ID, requestId: REQUEST_ID });

    expect(result).toEqual({ id: SUGGESTION_ID, created: false, selected: false, skippedExcluded: true });
    expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
    expect(DynamicsService.createRecord).not.toHaveBeenCalled();
  });

  test('race-safe — a lost create race re-fetches and converges to an update', async () => {
    // First find: no row. Create: throws (alternate-key conflict). Second find:
    // the row another concurrent run just created.
    DynamicsService.queryRecords
      .mockResolvedValueOnce({ records: [] })
      .mockResolvedValueOnce({ records: [{
        wmkf_appreviewersuggestionid: SUGGESTION_ID,
        wmkf_applicantdisposition: null,
        wmkf_sources: 'claude',
      }] });
    DynamicsService.createRecord.mockRejectedValue(Object.assign(new Error('Duplicate alternate key'), { status: 412 }));

    const result = await ensureApplicantRecommended({ potentialReviewerId: PR_ID, requestId: REQUEST_ID });

    expect(result).toEqual({ id: SUGGESTION_ID, created: false, selected: true });
    const payload = DynamicsService.updateRecord.mock.calls[0][2];
    expect(payload.wmkf_sources).toBe('claude,applicant');
    expect(payload.wmkf_applicantdisposition).toBe(APPLICANT_DISPOSITION_MAP.recommended);
    expect(payload.wmkf_selected).toBeUndefined();
  });

  test('converges when the duplicate is signalled by message even without a conflict status', async () => {
    DynamicsService.queryRecords
      .mockResolvedValueOnce({ records: [] })
      .mockResolvedValueOnce({ records: [{
        wmkf_appreviewersuggestionid: SUGGESTION_ID,
        wmkf_applicantdisposition: null,
        wmkf_sources: 'applicant',
      }] });
    // No HTTP status, but the Dataverse duplicate-key message is present.
    DynamicsService.createRecord.mockRejectedValue(
      new Error('A record with matching key values already exists'),
    );

    const result = await ensureApplicantRecommended({ potentialReviewerId: PR_ID, requestId: REQUEST_ID });

    expect(result).toEqual({ id: SUGGESTION_ID, created: false, selected: true });
    expect(DynamicsService.updateRecord).toHaveBeenCalled();
  });

  test('a NON-conflict create error is surfaced, not masked as success', async () => {
    DynamicsService.queryRecords.mockResolvedValue({ records: [] });
    DynamicsService.createRecord.mockRejectedValue(
      Object.assign(new Error('Insufficient privileges'), { status: 403 }),
    );

    await expect(
      ensureApplicantRecommended({ potentialReviewerId: PR_ID, requestId: REQUEST_ID }),
    ).rejects.toThrow(/privileges/i);
    // Must not refetch-and-converge on a non-conflict failure.
    expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
  });
});

describe('upsert never converts an excluded row into a candidate', () => {
  test('skips mutation and flags skippedExcluded when an excluded row already exists', async () => {
    // findByPotentialReviewerAndRequest (queryRecords) returns the existing
    // excluded engagement row.
    DynamicsService.queryRecords.mockResolvedValue({
      records: [{
        wmkf_appreviewersuggestionid: SUGGESTION_ID,
        wmkf_applicantdisposition: APPLICANT_DISPOSITION_EXCLUDED,
      }],
    });

    const result = await upsert({
      potentialReviewerId: PR_ID,
      requestId: REQUEST_ID,
      relevanceScore: 90,
      sources: 'claude',
      selected: true,
    });

    expect(result).toEqual({ id: SUGGESTION_ID, created: false, skippedExcluded: true });
    expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
  });
});

describe('upsert relevance-score range guard', () => {
  test('0-100 relevance scores reach Dataverse unchanged', async () => {
    DynamicsService.queryRecords.mockResolvedValue({ records: [] });

    await upsert({
      potentialReviewerId: PR_ID,
      requestId: REQUEST_ID,
      relevanceScore: 41,
      sources: 'claude',
      selected: true,
    });
    await upsert({
      potentialReviewerId: PR_ID,
      requestId: REQUEST_ID,
      relevanceScore: 87,
      sources: 'claude',
      selected: true,
    });

    expect(DynamicsService.createRecord.mock.calls[0][1].wmkf_relevancescore).toBe(41);
    expect(DynamicsService.createRecord.mock.calls[1][1].wmkf_relevancescore).toBe(87);
  });

  test('clamps out-of-range relevance scores to Dataverse [0,100]', async () => {
    DynamicsService.queryRecords.mockResolvedValue({ records: [] });

    await upsert({
      potentialReviewerId: PR_ID,
      requestId: REQUEST_ID,
      relevanceScore: 150,
      sources: 'claude',
      selected: true,
    });
    await upsert({
      potentialReviewerId: PR_ID,
      requestId: REQUEST_ID,
      relevanceScore: -5,
      sources: 'claude',
      selected: true,
    });

    expect(DynamicsService.createRecord.mock.calls[0][1].wmkf_relevancescore).toBe(100);
    expect(DynamicsService.createRecord.mock.calls[1][1].wmkf_relevancescore).toBe(0);
  });
});
