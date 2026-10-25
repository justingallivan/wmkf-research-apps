/** @jest-environment node */
// The conditional write primitive remains isolated from notification logic.
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion.js', () => ({ updateLifecycle: jest.fn() }));
import { changeReviewDeadline } from '../../lib/services/reviewer-engagement/change-review-deadline';
import { updateLifecycle } from '../../lib/dataverse/adapters/reviewer-suggestion';
beforeEach(() => jest.clearAllMocks());
test.each(['2099-09-15', null])('conditional deadline command preserves %p and caller ETag/actor', async (date) => {
  updateLifecycle.mockResolvedValue({}); await changeReviewDeadline({ suggestionId: 'id', reviewDueDateOverride: date, ifMatch: 'etag', actingUserSystemId: 'actor' });
  expect(updateLifecycle).toHaveBeenCalledWith('id', { reviewDueDateOverride: date, reviewDueDateExtensionGrantedAt: date === null ? null : expect.any(String) }, { ifMatch: 'etag', actingUserSystemId: 'actor' });
});
test('write failures propagate for service classification', async () => { const error = { status: 412 }; updateLifecycle.mockRejectedValue(error); await expect(changeReviewDeadline({})).rejects.toBe(error); });
