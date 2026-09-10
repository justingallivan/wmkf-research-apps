/**
 * selectActiveSiteVisit — one deterministic row regardless of Dataverse order.
 * @jest-environment node
 */
import { selectActiveSiteVisit } from '../../lib/services/deliberation-briefing/site-visit-selection';

const a = { activityid: 'b', scheduledstart: '2026-10-05T16:00:00Z', scheduledend: '2026-10-05T20:00:00Z' };
const b = { activityid: 'a', scheduledstart: '2026-10-01T16:00:00Z', scheduledend: '2026-10-01T20:00:00Z' };
const noEnd = { activityid: 'c', scheduledstart: null, scheduledend: null };

test('earliest scheduled end wins in either input order; rows without dates sort last', () => {
  expect(selectActiveSiteVisit([a, b, noEnd]).activityid).toBe('a');
  expect(selectActiveSiteVisit([noEnd, a, b]).activityid).toBe('a');
  expect(selectActiveSiteVisit([noEnd]).activityid).toBe('c');
  expect(selectActiveSiteVisit([])).toBeNull();
  expect(selectActiveSiteVisit(undefined)).toBeNull();
});

test('ties on end time break on activity id', () => {
  const t1 = { activityid: 'z', scheduledend: '2026-10-01T20:00:00Z' };
  const t2 = { activityid: 'y', scheduledend: '2026-10-01T20:00:00Z' };
  expect(selectActiveSiteVisit([t1, t2]).activityid).toBe('y');
});
