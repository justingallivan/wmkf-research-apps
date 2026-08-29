/**
 * View-level grouping for the admin Operational Events card.
 *
 * The discriminating fixture is the real 2026-08-27 card: 86 Graph 429 rows
 * that differ only in TraceId / timestamps must become ONE group; the three
 * rows of a cron incident (dependency timeout, stderr abort, 5xx) must stay
 * THREE groups because they are different event types; a clean row is a
 * group of one and renders exactly as before.
 */

import {
  normalizeSummary,
  eventSignature,
  groupOperationalEvents,
} from '../../shared/utils/operational-event-grouping.js';

const throttle = (id, traceId, at) => ({
  id,
  source: 'vercel-drain',
  environment: 'production',
  event_type: 'runtime_log_error',
  subsystem: '/api/dynamics-explorer/chat',
  status: 'open',
  summary: `[GraphService] searchFiles failed (429): {"error":{"code":"429"},"Instrumentation":{"TraceId":"${traceId}"`,
  first_occurred_at: at,
  last_occurred_at: at,
});

test('rows differing only in trace ids, uuids, and numbers share a signature', () => {
  const a = throttle(1, 'a4535cb5', '2026-08-27T19:05:49.354Z');
  const b = throttle(2, 'f472ae7f', '2026-08-27T19:00:52.707Z');
  expect(eventSignature(a)).toBe(eventSignature(b));
  expect(normalizeSummary('Duration: 30405 ms RequestId: 8caa890f-62be-4d0a-86c9-fb0f3acc9af9'))
    .toBe(normalizeSummary('Duration: 31139 ms RequestId: b0f89ddf-8b34-4525-beed-b5cca1f3fabe'));
});

test('a cron incident stays three groups: different event types are not folded together', () => {
  const base = { source: 'vercel-drain', environment: 'production', subsystem: '/api/cron/drain-review-syntheses', status: 'open', last_occurred_at: 't' };
  const rows = [
    { ...base, id: 1, event_type: 'runtime_dependency_failure', summary: 'workbench.dependency dataverse GET timeout' },
    { ...base, id: 2, event_type: 'runtime_log_error', summary: '[cron:drain-review-syntheses] error: Error: dataverse no-response' },
    { ...base, id: 3, event_type: 'runtime_5xx', summary: 'START RequestId: x\n[GET] /api/cron/drain-review-syntheses status=500' },
  ];
  expect(groupOperationalEvents(rows)).toHaveLength(3);
});

test('the throttle storm folds to one group that keeps every row, newest first, with open members listed', () => {
  const rows = [
    throttle(10, 'aaaaaaaa', '2026-08-27T19:05:49.354Z'),
    { ...throttle(9, 'bbbbbbbb', '2026-08-27T19:05:35.691Z'), status: 'resolved' },
    throttle(8, 'cccccccc', '2026-08-27T19:00:52.707Z'),
    throttle(7, 'dddddddd', '2026-08-27T18:57:37.486Z'),
  ];
  const groups = groupOperationalEvents(rows);
  expect(groups).toHaveLength(1);
  const [g] = groups;
  expect(g.events.map(e => e.id)).toEqual([10, 9, 8, 7]);
  expect(g.newest.id).toBe(10);
  expect(g.oldest.id).toBe(7);
  expect(g.openEvents.map(e => e.id)).toEqual([10, 8, 7]);
});

test('groups keep the list order of first appearance so a new incident is not buried under an old storm', () => {
  const prefs = { id: 50, source: 'vercel-drain', environment: 'production', event_type: 'runtime_log_error', subsystem: '/api/user-preferences', status: 'open', summary: '[dataverse-prefs] setUserPreference error: dataverse failed (403)', last_occurred_at: '2026-08-27T22:24:15.480Z' };
  const rows = [prefs, throttle(2, 'a1b2c3d4', '2026-08-27T19:05:49Z'), throttle(1, 'e5f6a7b8', '2026-08-27T19:00:52Z')];
  expect(groupOperationalEvents(rows).map(g => g.newest.id)).toEqual([50, 2]);
});

test('different subsystems or environments never fold together', () => {
  const a = throttle(1, 'x', 't');
  const b = { ...throttle(2, 'x', 't'), subsystem: '/api/other' };
  const c = { ...throttle(3, 'x', 't'), environment: 'preview' };
  expect(groupOperationalEvents([a, b, c])).toHaveLength(3);
});

test('a single row is a group of one', () => {
  const [g] = groupOperationalEvents([throttle(1, 'x', 't')]);
  expect(g.events).toHaveLength(1);
});
