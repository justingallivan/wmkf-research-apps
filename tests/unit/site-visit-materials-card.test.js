/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SiteVisitMaterialsCard from '../../shared/components/meeting-tracker/SiteVisitMaterialsCard';

jest.mock('../../shared/components/Layout', () => ({
  __esModule: true,
  Button: ({ children, loading, ...props }) => <button {...props}>{children}</button>,
}));

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
function response(body, status = 200) { return { ok: status < 300, status, json: async () => body }; }
const collection = (overrides = {}) => ({
  id: 'c1', requestId: REQUEST_ID, status: 'open', state: 'missing', dueAt: '2026-10-05T16:00:00Z', closesAt: '2026-10-14T19:00:00Z', overdue: false,
  checklist: [
    { key: 'presentation_pdf', label: 'Presentation (PDF)', required: true, waived: false, received: { artifactId: 'a', filename: '1003222 Site Visit Presentation.pdf', receivedAt: '2026-10-01T00:00:00Z' } },
    { key: 'presentation_source', label: 'Presentation source (PowerPoint or Keynote)', required: true, waived: false, received: null },
    { key: 'participant_bios', label: 'Participant bios (PDF or Word)', required: true, waived: false, received: null },
  ],
  missing: ['presentation_source', 'participant_bios'], other: [],
  contacts: { pi: { role: 'pi', name: 'Pat Investigator', email: 'pi@example.edu' }, liaison: { role: 'liaison', name: 'Lee Liaison', email: 'liaison@example.edu' } },
  invitedAt: '2026-09-15T17:00:00Z', lastReminderAt: null, reminderCount: 0, readyConfirmedAt: null,
  contributorUrl: 'https://apps.test/external/materials/tok', createdAt: '2026-09-15T17:00:00Z',
  ...overrides,
});

test('before a collection exists the card offers Request materials and posts action=create', async () => {
  global.fetch = jest.fn(async (url, options = {}) => (
    options.method === 'POST' ? response({ success: true, collection: collection(), invitationSent: true }) : response({ success: true, collection: null })
  ));
  render(<SiteVisitMaterialsCard requestId={REQUEST_ID} requestNumber="1003222" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Request materials' }));
  await waitFor(() => expect(screen.getByText('Collection started and the invitation sent.')).toBeInTheDocument());
  const [url, options] = global.fetch.mock.calls.find(([, o]) => o?.method === 'POST');
  expect(url).toBe(`/api/meeting-tracker/visits/${REQUEST_ID}/materials`);
  expect(JSON.parse(options.body)).toEqual({ action: 'create' });
  expect(screen.getByText(/Received .*1003222 Site Visit Presentation\.pdf/)).toBeInTheDocument();
  expect(screen.getAllByText('Missing')).toHaveLength(2);
  expect(screen.getByText(/Pat Investigator \(pi@example\.edu\), Lee Liaison/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Send reminder' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Confirm the files open' })).not.toBeInTheDocument();
});

test('a created collection whose invitation failed shows the failure and offers Send invitation; waive posts the key; received offers the ready confirmation; 503 hides the card', async () => {
  global.fetch = jest.fn(async (url, options = {}) => {
    if (options.method === 'POST') {
      const body = JSON.parse(options.body);
      if (body.action === 'create') return response({ success: true, collection: collection({ invitedAt: null }), invitationSent: false });
      if (body.action === 'waive') return response({ success: true, collection: collection({ state: 'received', missing: [], checklist: collection().checklist.map((item) => (item.received ? item : { ...item, waived: true })) }) });
      return response({ success: true, collection: collection() });
    }
    return response({ success: true, collection: null });
  });
  render(<SiteVisitMaterialsCard requestId={REQUEST_ID} requestNumber="1003222" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Request materials' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('invitation email could not be sent');
  expect(screen.getByRole('button', { name: 'Send invitation' })).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('button', { name: 'Waive' })[0]);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm the files open' })).toBeInTheDocument());
  const waive = global.fetch.mock.calls.find(([, o]) => o?.method === 'POST' && JSON.parse(o.body).action === 'waive');
  expect(JSON.parse(waive[1].body)).toEqual({ action: 'waive', key: 'presentation_source', waived: true });

  global.fetch = jest.fn(async () => response({ error: 'not enabled' }, 503));
  const { container } = render(<SiteVisitMaterialsCard requestId={REQUEST_ID} requestNumber="1003222" />);
  await waitFor(() => expect(container.querySelector('[data-testid="site-visit-materials-card"]')).toBeNull());
});
