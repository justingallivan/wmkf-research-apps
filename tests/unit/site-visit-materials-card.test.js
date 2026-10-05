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

test('a saved collection with no liaison email names the gap without rendering null as a recipient', async () => {
  global.fetch = jest.fn(async () => response({ success: true, collection: collection({ contacts: { pi: { role: 'pi', name: 'Franklin Cat', email: 'franklin@example.edu' }, liaison: { role: 'liaison', name: null, email: null }, liaisonStatus: 'found' } }) }));
  render(<SiteVisitMaterialsCard requestId={REQUEST_ID} requestNumber="1003222" />);
  const sentTo = await screen.findByText(/Franklin Cat.*Liaison email missing from saved recipients/);
  expect(sentTo).toHaveTextContent('Franklin Cat (franklin@example.edu)');
  expect(sentTo).not.toHaveTextContent('null');
});

// Liaison plan reader 4: "No institution Liaison" only for an explicit none.
test.each([
  ['explicit none', { liaison: null, liaisonStatus: 'none' }, /No institution Liaison/, /not verified/],
  ['a legacy snapshot without status', { liaison: null }, /Liaison not verified/, /No institution Liaison/],
])('saved recipients label for %s', async (_label, extra, shown, hidden) => {
  global.fetch = jest.fn(async () => response({ success: true, collection: collection({ contacts: { pi: { role: 'pi', name: 'Franklin Cat', email: 'franklin@example.edu' }, ...extra } }) }));
  render(<SiteVisitMaterialsCard requestId={REQUEST_ID} requestNumber="1003222" />);
  const sentTo = await screen.findByText(shown);
  expect(sentTo).not.toHaveTextContent(hidden);
});

test('the materials card lists a shared PI and liaison email once', async () => {
  global.fetch = jest.fn(async () => response({ success: true, collection: collection({ contacts: {
    pi: { role: 'pi', name: 'Franklin Cat', email: 'franklin@example.edu' },
    liaison: { role: 'liaison', name: 'Franklin Cat', email: 'FRANKLIN@example.edu' },
  } }) }));
  render(<SiteVisitMaterialsCard requestId={REQUEST_ID} requestNumber="1003222" />);
  const sentTo = await screen.findByText(/Franklin Cat \(franklin@example.edu\)/);
  expect(sentTo.textContent.match(/Franklin Cat \(/g)).toHaveLength(1);
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

test('queued applicant upload is visible beside the previous receipt and blocks ready confirmation', async () => {
  const queued = collection({
    state: 'received',
    uploadJobs: [{ jobId: 'job-1', slot: 'presentation_pdf', status: 'queued', filename: 'new.pdf' }],
    processingCount: 1,
    attentionCount: 0,
  });
  global.fetch = jest.fn(async () => response({ success: true, collection: queued }));
  render(<SiteVisitMaterialsCard requestId={REQUEST_ID} requestNumber="1003222" />);

  expect(await screen.findAllByText('Upload received. We’re checking and saving the file.')).toHaveLength(2);
  expect(screen.getByText(/Previously received .*1003222 Site Visit Presentation\.pdf/)).toBeInTheDocument();
  expect(screen.getByText(/Confirm readiness after every upload is finished/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Confirm the files open' })).not.toBeInTheDocument();
});

test('needs-attention jobs remain visible after collection close and carry coordinator contact', async () => {
  const attention = collection({
    state: 'closed',
    programCoordinator: { name: 'Casey Coordinator', email: 'casey@wmkeck.org' },
    uploadJobs: [{ jobId: 'job-2', slot: 'presentation_source', status: 'needs_attention', filename: 'new.pptx' }],
    processingCount: 0,
    attentionCount: 1,
  });
  global.fetch = jest.fn(async () => response({ success: true, collection: attention }));
  render(<SiteVisitMaterialsCard requestId={REQUEST_ID} requestNumber="1003222" />);

  expect(await screen.findByText(/Needs coordinator attention before replacement is safe/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'casey@wmkeck.org' })).toHaveAttribute('href', 'mailto:casey%40wmkeck.org');
  expect(screen.getByText('Closed. The contributor link has expired.')).toBeInTheDocument();
});

test('staff card shows safe scan reason alongside terminal and coordinator-attention states', async () => {
  const diagnosed = collection({
    programCoordinator: { name: 'Casey Coordinator', email: 'casey@wmkeck.org' },
    uploadJobs: [
      { jobId: 'failed', slot: 'presentation_pdf', status: 'failed', errorCode: 'infected', scanRejection: { category: 'blocked_content', flags: ['embedded_macro'] } },
      { jobId: 'attention', slot: 'presentation_source', status: 'needs_attention', errorCode: 'infected', scanRejection: { category: 'signature_match', flags: [] } },
    ],
  });
  global.fetch = jest.fn(async () => response({ success: true, collection: diagnosed }));
  render(<SiteVisitMaterialsCard requestId={REQUEST_ID} requestNumber="1003222" />);

  expect(await screen.findByText(/The security scan rejected this file because it contains embedded macro/)).toBeInTheDocument();
  expect(screen.getByText(/Needs coordinator attention before replacement is safe/)).toBeInTheDocument();
  expect(screen.getByText('The security scan identified a known threat.')).toBeInTheDocument();
});

test.each(['missing', 'closed'])('received checklist and other files open in a new tab when collection is %s', async (state) => {
  const data = collection({ state, other: [{ artifactId: 'other', filename: 'Supporting.pdf', receivedAt: '2026-10-01', webUrl: 'https://tenant.sharepoint.com/supporting.pdf' }] });
  data.checklist[0].received.webUrl = 'https://tenant.sharepoint.com/presentation.pdf';
  global.fetch = jest.fn(async () => response({ success: true, collection: data }));
  render(<SiteVisitMaterialsCard requestId={REQUEST_ID} />);
  const links = await screen.findAllByRole('link', { name: /^Open file:/ });
  expect(links).toHaveLength(2);
  expect(links[0]).toHaveAttribute('href', data.checklist[0].received.webUrl);
  expect(links[1]).toHaveAttribute('href', data.other[0].webUrl);
  for (const link of links) {
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAccessibleName(/opens in a new tab/);
  }
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test.each([undefined, '', 'not a URL', 'javascript:alert(1)', 'http://tenant.sharepoint.com/file', 'https://user:password@tenant.sharepoint.com/file'])('does not offer an unsafe or absent file URL: %s', async (webUrl) => {
  const data = collection({ other: [{ artifactId: 'other', filename: 'Supporting.pdf', webUrl }] });
  data.checklist[0].received.webUrl = webUrl;
  global.fetch = jest.fn(async () => response({ success: true, collection: data }));
  render(<SiteVisitMaterialsCard requestId={REQUEST_ID} />);
  await screen.findByText(/1003222 Site Visit Presentation.pdf/);
  expect(screen.queryByRole('link', { name: /^Open file:/ })).not.toBeInTheDocument();
});

test('pending replacement opens only the previous receipt and never the unfinished job', async () => {
  const data = collection({ uploadJobs: [{ jobId: 'pending', slot: 'presentation_pdf', status: 'processing', webUrl: 'https://tenant.sharepoint.com/pending.pdf' }, { jobId: 'other-pending', slot: 'other', status: 'processing', filename: 'Unfinished.pdf', webUrl: 'https://tenant.sharepoint.com/unfinished.pdf' }] });
  data.checklist[0].received.webUrl = 'https://tenant.sharepoint.com/previous.pdf';
  global.fetch = jest.fn(async () => response({ success: true, collection: data }));
  render(<SiteVisitMaterialsCard requestId={REQUEST_ID} />);
  const link = await screen.findByRole('link', { name: /^Open file:/ });
  expect(link).toHaveAttribute('href', 'https://tenant.sharepoint.com/previous.pdf');
  expect(screen.getByText(/Previously received/)).toBeInTheDocument();
});

describe('staff replacement upload (staff replacement plan §3.4)', () => {
  const mockPut = jest.fn(async () => ({}));
  beforeAll(() => { jest.doMock('@vercel/blob/client', () => ({ put: (...args) => mockPut(...args) })); });
  beforeEach(() => mockPut.mockClear());

  test('a closed collection still offers upload on every row; a waived row with a staff file is not struck through', async () => {
    const closed = collection({
      status: 'closed', state: 'closed',
      checklist: [
        { key: 'presentation_pdf', label: 'Presentation (PDF)', required: true, waived: false, received: { artifactId: 'a', filename: 'p.pdf', receivedAt: '2026-10-01T00:00:00Z' } },
        { key: 'participant_bios', label: 'Participant bios (PDF or Word)', required: true, waived: true, received: { artifactId: 'b', filename: 'bios.pdf', receivedAt: '2026-10-05T00:00:00Z', uploadedByStaff: true } },
      ],
    });
    global.fetch = jest.fn(async () => response({ success: true, collection: closed }));
    render(<SiteVisitMaterialsCard requestId={REQUEST_ID} requestNumber="1003222" />);
    expect(await screen.findAllByRole('button', { name: 'Upload updated file' })).toHaveLength(2);
    const bios = screen.getByText('Participant bios (PDF or Word)');
    expect(bios.className).not.toMatch(/line-through/);
    expect(screen.getByText(/bios\.pdf · staff upload · waived/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Waive' })).toBeNull();
  });

  test('choosing a file mints a staff token, uploads to staging, finalizes, and reloads the card', async () => {
    const posts = [];
    global.fetch = jest.fn(async (url, options = {}) => {
      if (options.method === 'POST') {
        posts.push([url, JSON.parse(options.body)]);
        if (url.endsWith('/staff-upload-token')) return response({ ok: true, slot: 'presentation_pdf', stagingId: '22222222-2222-4222-8222-222222222222', pathname: 'p', clientToken: 'ct', contentType: 'application/pdf' });
        if (url.endsWith('/staff-finalize')) return response({ ok: true, slot: 'presentation_pdf', filename: 'p.pdf' });
      }
      return response({ success: true, collection: collection() });
    });
    render(<SiteVisitMaterialsCard requestId={REQUEST_ID} requestNumber="1003222" />);
    await screen.findByRole('button', { name: 'Upload updated file' });
    const file = new File(['%PDF'], 'Updated deck.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByTestId('staff-upload-input-presentation_pdf'), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Presentation (PDF) saved.'));
    expect(posts.map(([url]) => url.split('/materials/')[1])).toEqual(['staff-upload-token', 'staff-finalize']);
    expect(posts[0][1]).toEqual({ slot: 'presentation_pdf', filename: 'Updated deck.pdf', contentType: 'application/pdf', size: 4 });
    expect(posts[1][1]).toEqual({ stagingId: '22222222-2222-4222-8222-222222222222', slot: 'presentation_pdf' });
    expect(mockPut).toHaveBeenCalledWith('p', file, expect.objectContaining({ access: 'private', token: 'ct' }));
    expect(global.fetch.mock.calls.filter(([url, o]) => url.endsWith('/materials') && o?.method !== 'POST').length).toBeGreaterThanOrEqual(2);
  });

  test('a refused finalize shows its reason and does not claim success', async () => {
    global.fetch = jest.fn(async (url, options = {}) => {
      if (options.method === 'POST') {
        if (url.endsWith('/staff-upload-token')) return response({ ok: true, stagingId: '22222222-2222-4222-8222-222222222222', pathname: 'p', clientToken: 'ct', contentType: 'application/pdf' });
        return response({ ok: false, reason: 'slot_busy' }, 409);
      }
      return response({ success: true, collection: collection() });
    });
    render(<SiteVisitMaterialsCard requestId={REQUEST_ID} requestNumber="1003222" />);
    await screen.findByRole('button', { name: 'Upload updated file' });
    fireEvent.change(screen.getByTestId('staff-upload-input-presentation_pdf'), { target: { files: [new File(['%PDF'], 'd.pdf', { type: 'application/pdf' })] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Another upload for this item is still being saved');
    expect(screen.queryByText('Presentation (PDF) saved.')).toBeNull();
  });
});
