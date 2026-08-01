import { reviewerEngagementProjection } from '../../shared/utils/reviewer-engagement';

test.each([
  [{ wmkf_selected: false }, false, null],
  [{ wmkf_selected: true }, true, 'selected'],
  [{ wmkf_selected: false, wmkf_invited: true }, true, 'invited'],
  [{ selected: false, declined: true }, true, 'declined'],
  [{ accepted: true, reviewReceivedAt: '2026-08-01' }, true, 'review_received'],
  [{ wmkf_completedat: '2026-08-01' }, true, 'completed'],
])('projects raw and DTO engagement with terminal-stage precedence', (row, handled, stage) => {
  expect(reviewerEngagementProjection(row)).toMatchObject({ handled, stage });
});
