/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import SiteVisitMaterialsCard from '../../shared/components/meeting-tracker/SiteVisitMaterialsCard';

jest.mock('../../shared/components/Layout', () => ({
  __esModule: true,
  Button: ({ children, loading, ...props }) => <button {...props}>{children}</button>,
}));
jest.mock('../../shared/context/ProfileContext', () => ({ useProfile: () => ({ currentProfile: { id: 7 }, status: 'ready' }) }));

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

test('before a collection exists the card opens a preview composer and sends action=create with reviewed content', async () => {
  global.fetch = jest.fn(async (url, options = {}) => {
    if (url.includes('materials-email-preferences')) return response({ shared: { subject: 'Subject', body: '{{checklist}}' }, template: { subject: 'Subject', body: '{{checklist}}' } });
    if (options.method === 'POST') {
      const body = JSON.parse(options.body);
      if (body.action === 'preview') return response({ subject: 'Subject', bodyText: 'Rendered', proof: 'proof', recipients: [{ email: 'pi@example.edu' }], secureLinkPlaceholder: true });
      return response({ success: true, collection: collection(), invitationSent: true });
    }
    return response({ success: true, collection: null });
  });
  render(<SiteVisitMaterialsCard requestId={REQUEST_ID} requestNumber="1003222" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Request materials' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Refresh preview' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).not.toBeDisabled());
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(global.fetch.mock.calls.some(([, o]) => o?.method === 'POST' && JSON.parse(o.body).action === 'create')).toBe(true));
  const calls = global.fetch.mock.calls.filter(([, o]) => o?.method === 'POST');
  const [url, options] = calls[calls.length - 1];
  expect(url).toBe(`/api/meeting-tracker/visits/${REQUEST_ID}/materials`);
  expect(JSON.parse(options.body)).toEqual(expect.objectContaining({ action: 'create', proof: 'proof', emailTemplate: expect.any(Object) }));
});

test('a created collection opens the resend composer and surfaces preview failures', async () => {
  global.fetch = jest.fn(async (url, options = {}) => {
    if (url.includes('materials-email-preferences')) return response({ shared: { subject: 'Subject', body: '{{checklist}}' }, template: { subject: 'Subject', body: '{{checklist}}' } });
    if (options.method === 'POST') return response({ error: 'preview unavailable' }, 503);
    return response({ success: true, collection: collection({ invitedAt: null }) });
  });
  render(<SiteVisitMaterialsCard requestId={REQUEST_ID} requestNumber="1003222" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Send invitation' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Refresh preview' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('preview unavailable');
});

test('existing collection preserves waive, ready, and unavailable behaviors', async () => {
  global.fetch = jest.fn(async (url, options = {}) => {
    if (options.method === 'POST') {
      const body = JSON.parse(options.body);
      if (body.action === 'waive') return response({ success: true, collection: collection({ state: 'received', missing: [], checklist: collection().checklist.map((item) => (item.received ? item : { ...item, waived: true })) }) });
      return response({ success: true, collection: collection() });
    }
    return response({ success: true, collection: collection() });
  });
  render(<SiteVisitMaterialsCard requestId={REQUEST_ID} requestNumber="1003222" />);
  fireEvent.click((await screen.findAllByRole('button', { name: 'Waive' }))[0]);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm the files open' })).toBeInTheDocument());
  const waive = global.fetch.mock.calls.find(([, o]) => o?.method === 'POST' && JSON.parse(o.body).action === 'waive');
  expect(JSON.parse(waive[1].body)).toEqual({ action: 'waive', key: 'presentation_source', waived: true });
});

test('late request A load cannot overwrite request B', async () => {
  const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  let resolveA;
  global.fetch = jest.fn((url) => {
    if (url.includes(a)) return new Promise((resolve) => { resolveA = resolve; });
    return Promise.resolve(response({ success: true, collection: collection({ requestId: b }) }));
  });
  const view = render(<SiteVisitMaterialsCard requestId={a} requestNumber="1003222" />);
  view.rerender(<SiteVisitMaterialsCard requestId={b} requestNumber="1003222" />);
  await screen.findByText(/Pat Investigator/);
  resolveA(response({ success: true, collection: collection({ requestId: a, state: 'closed' }) }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(screen.queryByText(/Closed\. The contributor link has expired/)).not.toBeInTheDocument();
  expect(screen.getByText(/Waiting on the applicant|Every required item/)).toBeInTheDocument();
});

test('StrictMode effect replay still loads the current request', async () => {
  global.fetch = jest.fn(async () => response({ success: true, collection: collection() }));
  render(<StrictMode><SiteVisitMaterialsCard requestId={REQUEST_ID} requestNumber="1003222" /></StrictMode>);
  expect(await screen.findByText(/Pat Investigator/)).toBeInTheDocument();
});
