/**
 * @jest-environment node
 */

jest.mock('../../lib/dataverse/adapters/reviewer-suggestion.js', () => ({
  updateLifecycle: jest.fn(),
}));

import { changeReviewDeadline } from '../../lib/services/reviewer-engagement/change-review-deadline';
import { updateLifecycle } from '../../lib/dataverse/adapters/reviewer-suggestion';

const SUGGESTION_ID = '11111111-1111-4111-8111-111111111111';
const ETAG = 'W/"etag-value"';

beforeEach(() => {
  updateLifecycle.mockReset();
});

test('writes the override and a current granted-at timestamp atomically', async () => {
  updateLifecycle.mockResolvedValue({ ok: true });

  await changeReviewDeadline({
    suggestionId: SUGGESTION_ID,
    reviewDueDateOverride: '2099-09-15',
    ifMatch: ETAG,
    actingUserSystemId: 'user-1',
  });

  expect(updateLifecycle).toHaveBeenCalledTimes(1);
  const [id, updates, options] = updateLifecycle.mock.calls[0];
  expect(id).toBe(SUGGESTION_ID);
  expect(updates.reviewDueDateOverride).toBe('2099-09-15');
  expect(new Date(updates.reviewDueDateExtensionGrantedAt).getTime()).not.toBeNaN();
  expect(options).toEqual({ actingUserSystemId: 'user-1', ifMatch: ETAG });
});

test('passes a null reviewDueDateOverride through unchanged (clearing an extension is valid input)', async () => {
  updateLifecycle.mockResolvedValue({ ok: true });

  await changeReviewDeadline({
    suggestionId: SUGGESTION_ID,
    reviewDueDateOverride: null,
    ifMatch: ETAG,
    actingUserSystemId: 'user-1',
  });

  expect(updateLifecycle).toHaveBeenCalledWith(
    SUGGESTION_ID,
    { reviewDueDateOverride: null, reviewDueDateExtensionGrantedAt: null },
    { actingUserSystemId: 'user-1', ifMatch: ETAG },
  );
});

test('propagates a 412 conflict from the adapter unmodified', async () => {
  const conflict = Object.assign(new Error('changed'), { status: 412 });
  updateLifecycle.mockRejectedValueOnce(conflict);

  await expect(changeReviewDeadline({
    suggestionId: SUGGESTION_ID,
    reviewDueDateOverride: '2099-09-15',
    ifMatch: ETAG,
    actingUserSystemId: 'user-1',
  })).rejects.toBe(conflict);
});

test('propagates any other adapter error unmodified, with no validation added', async () => {
  const failure = new Error('reviewer-suggestion.updateLifecycle: refusing to mutate an applicant-excluded suggestion');
  updateLifecycle.mockRejectedValueOnce(failure);

  await expect(changeReviewDeadline({
    suggestionId: SUGGESTION_ID,
    reviewDueDateOverride: '2099-09-15',
    ifMatch: ETAG,
    actingUserSystemId: 'user-1',
  })).rejects.toBe(failure);
});
