/** @jest-environment node */

/**
 * Direct unit test for `lib/services/reviewer-engagement/claim-reminder.js`
 * (Reviewer Lifecycle Stage 3G): `claimReviewDueReminder` is the review-due
 * fire-once claim extracted verbatim from `reviewer-reminder-sweep.js`'s
 * `kind !== 'respond'` branch. Behavior-preserving — no new validation:
 * a missing `ifMatch` is passed through as-is (the adapter/write layer, not
 * this function, decides what to do with it), and every error the adapter
 * throws (412 or otherwise) propagates untouched for the sweep's own catch
 * to map.
 */

const updateLifecycle = jest.fn(async () => undefined);
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  updateLifecycle: (...a) => updateLifecycle(...a),
}));

const { claimReviewDueReminder } = require('../../lib/services/reviewer-engagement/claim-reminder');

const SUG = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('claimReviewDueReminder', () => {
  test('same-version claim calls updateLifecycle with actingUserSystemId/ifMatch and exactly the two mapped fields', async () => {
    updateLifecycle.mockResolvedValueOnce(undefined);

    await claimReviewDueReminder({
      id: SUG,
      claimPatch: { wmkf_remindersentat: '2026-09-06T00:00:00.000Z', wmkf_remindercount: 2 },
      claimIfMatch: 'W/"200"',
      actingUserSystemId: 'u-1',
    });

    expect(updateLifecycle).toHaveBeenCalledTimes(1);
    expect(updateLifecycle).toHaveBeenCalledWith(
      SUG,
      { reminderSentAt: '2026-09-06T00:00:00.000Z', reminderCount: 2 },
      { actingUserSystemId: 'u-1', ifMatch: 'W/"200"' },
    );
  });

  test('a 412 from updateLifecycle propagates untouched', async () => {
    const err = Object.assign(new Error('precondition failed'), { status: 412 });
    updateLifecycle.mockRejectedValueOnce(err);

    await expect(claimReviewDueReminder({
      id: SUG,
      claimPatch: { wmkf_remindersentat: '2026-09-06T00:00:00.000Z', wmkf_remindercount: 1 },
      claimIfMatch: 'W/"200"',
      actingUserSystemId: 'u-1',
    })).rejects.toBe(err);
  });

  test('a non-412 error from updateLifecycle propagates untouched', async () => {
    const err = new Error('transport failure');
    updateLifecycle.mockRejectedValueOnce(err);

    await expect(claimReviewDueReminder({
      id: SUG,
      claimPatch: { wmkf_remindersentat: '2026-09-06T00:00:00.000Z', wmkf_remindercount: 1 },
      claimIfMatch: 'W/"200"',
      actingUserSystemId: 'u-1',
    })).rejects.toBe(err);
  });

  test('missing ifMatch is passed through as-is (undefined), no validation added', async () => {
    updateLifecycle.mockResolvedValueOnce(undefined);

    await claimReviewDueReminder({
      id: SUG,
      claimPatch: { wmkf_remindersentat: '2026-09-06T00:00:00.000Z', wmkf_remindercount: 1 },
      claimIfMatch: undefined,
      actingUserSystemId: null,
    });

    expect(updateLifecycle).toHaveBeenCalledWith(
      SUG,
      { reminderSentAt: '2026-09-06T00:00:00.000Z', reminderCount: 1 },
      { actingUserSystemId: null, ifMatch: undefined },
    );
  });
});
