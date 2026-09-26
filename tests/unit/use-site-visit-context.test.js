/**
 * @jest-environment jsdom
 *
 * Headless Site Visit context (S466): the logistics editor is gone from the
 * Workbench, but the composer still derives calendar/materials/suggestions
 * from the wmkf_sitevisit read. This suite pins the derivation and the
 * fail-open contract.
 */

import { render, screen, waitFor } from '@testing-library/react';
import useSiteVisitContext from '../../shared/components/workbench/useSiteVisitContext';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';

function Harness({ requestId }) {
  const context = useSiteVisitContext(requestId);
  return <pre data-testid="context">{JSON.stringify(context)}</pre>;
}

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

afterEach(() => jest.restoreAllMocks());

test('derives siteVisit, materials, and suggested recipients from the logistics read', async () => {
  const visit = {
    activityId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    organizer: { kind: 'staff', profileId: 7 },
    requiredAttendees: [
      { kind: 'staff', profileId: 9 },
      { kind: 'manual', email: 'guest@example.org' },
    ],
    optionalAttendees: [{ kind: 'roster', rosterId: 'r1' }],
  };
  global.fetch = jest.fn(async (url) => (
    String(url).includes('/logistics')
      ? response({
        siteVisit: visit,
        materials: [{ artifactId: 'm1', filename: 'Slides.pdf', artifactTypeLabel: 'Applicant Slides' }],
      })
      : response({
        staff: [
          { kind: 'staff', profileId: 7, email: 'organizer@wmkeck.org' },
          { kind: 'staff', profileId: 9, email: 'required@wmkeck.org' },
        ],
        external: [{ kind: 'roster', rosterId: 'r1', email: 'optional@example.org' }],
      })
  ));

  render(<Harness requestId={REQUEST_ID} />);

  await waitFor(() => expect(JSON.parse(screen.getByTestId('context').textContent)).toEqual({
    siteVisit: visit,
    materials: [{ artifactId: 'm1', filename: 'Slides.pdf', artifactTypeLabel: 'Applicant Slides' }],
    suggestedTo: ['organizer@wmkeck.org', 'required@wmkeck.org', 'guest@example.org'],
    suggestedCc: ['optional@example.org'],
  }));
});

test.each([
  ['a non-2xx directory response', () => response({ error: 'nope' }, 500)],
  ['a directory network rejection', () => Promise.reject(new Error('offline'))],
])('keeps the visit when only the recipient directory fails (%s)', async (_label, directory) => {
  const visit = { activityId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', organizer: { kind: 'staff', profileId: 7 }, requiredAttendees: [{ kind: 'manual', email: 'guest@example.org' }], optionalAttendees: [] };
  global.fetch = jest.fn(async (url) => (
    String(url).includes('/logistics') ? response({ siteVisit: visit, materials: [] }) : directory()
  ));

  render(<Harness requestId={REQUEST_ID} />);

  await waitFor(() => expect(JSON.parse(screen.getByTestId('context').textContent)).toEqual({
    siteVisit: visit,
    materials: [],
    suggestedTo: ['guest@example.org'],
    suggestedCc: [],
  }));
});

test('yields empty suggestions when no visit is scheduled', async () => {
  global.fetch = jest.fn(async (url) => (
    String(url).includes('/logistics')
      ? response({ siteVisit: null, materials: [] })
      : response({ staff: [], external: [] })
  ));

  render(<Harness requestId={REQUEST_ID} />);

  await waitFor(() => expect(JSON.parse(screen.getByTestId('context').textContent)).toEqual({
    siteVisit: null,
    materials: [],
    suggestedTo: [],
    suggestedCc: [],
  }));
});

test('fails open: a load error reports unavailable (never a false "no visit") and does not throw', async () => {
  global.fetch = jest.fn(async () => response({ error: 'nope' }, 500));

  render(<Harness requestId={REQUEST_ID} />);

  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByTestId('context').textContent).toBe('{"unavailable":true}'));
});

test('does not fetch without a requestId', async () => {
  global.fetch = jest.fn();
  render(<Harness requestId={null} />);
  expect(global.fetch).not.toHaveBeenCalled();
  expect(screen.getByTestId('context').textContent).toBe('null');
});

// T5 gap-fill (Stage 5a): network rejection and axis (e) — a non-2xx
// response whose body cannot be parsed — both stay fail-open, never throw.
// Since 2026-09-25 a settled failure reports `{ unavailable: true }` rather
// than staying null, so a failed read is never mistaken for "no visit".
test('fails open on a network rejection', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
  render(<Harness requestId={REQUEST_ID} />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByTestId('context').textContent).toBe('{"unavailable":true}'));
});

test('axis (e): fails open on a non-2xx unparseable body', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 502, json: () => Promise.reject(new SyntaxError('Unexpected token <')) });
  render(<Harness requestId={REQUEST_ID} />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByTestId('context').textContent).toBe('{"unavailable":true}'));
});
