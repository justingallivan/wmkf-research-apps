/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

// Site Visit redesign §3.2: each item is a row whose name opens the file; row and card actions live in "…" menus.
const rowOf = (key) => screen.getByTestId(`materials-row-${key}`);
function openMenu(trigger) { if (trigger.getAttribute('aria-expanded') !== 'true') fireEvent.click(trigger); }
function rowMenuItem(key, label) {
  openMenu(within(rowOf(key)).getByRole('button', { name: /^More actions for/ }));
  return screen.getByRole('menuitem', { name: label });
}
async function cardMenuItem(label) {
  openMenu(await screen.findByRole('button', { name: 'More actions for applicant materials' }));
  return screen.getByRole('menuitem', { name: label });
}

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
  fireEvent.click(await cardMenuItem('Send invitation'));
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
  await screen.findByTestId('materials-row-presentation_source');
  fireEvent.click(rowMenuItem('presentation_source', 'Waive'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm the files open' })).toBeInTheDocument());
  const waive = global.fetch.mock.calls.find(([, o]) => o?.method === 'POST' && JSON.parse(o.body).action === 'waive');
  expect(JSON.parse(waive[1].body)).toEqual({ action: 'waive', key: 'presentation_source', waived: true });
});

test.each([
  ['missing', { state: 'missing' }, 'Send reminder', ['Confirm the files open']],
  ['received', { state: 'received', missing: [] }, 'Confirm the files open', ['Send reminder']],
  ['closed', { state: 'closed' }, null, ['Send reminder', 'Confirm the files open']],
])('the heading offers one next step for a %s collection', async (_label, overrides, shown, hidden) => {
  global.fetch = jest.fn(async () => response({ success: true, collection: collection(overrides) }));
  render(<SiteVisitMaterialsCard requestId={REQUEST_ID} requestNumber="1003222" />);
  await screen.findByTestId('materials-metadata');
  if (shown) expect(screen.getByRole('button', { name: shown })).toBeInTheDocument();
  for (const name of hidden) expect(screen.queryByRole('button', { name })).toBeNull();
  // Copy link and invitation live in the card menu, not as footer buttons.
  expect(screen.queryByRole('button', { name: 'Copy contributor link' })).toBeNull();
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
  // The item name is the link (redesign §3.2); there is no separate Open file control.
  const links = [await screen.findByRole('link', { name: 'Presentation (PDF)' }), screen.getByRole('link', { name: 'Other: Supporting.pdf' })];
  expect(links[0]).toHaveAttribute('href', data.checklist[0].received.webUrl);
  expect(links[1]).toHaveAttribute('href', data.other[0].webUrl);
  for (const link of links) {
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  }
  expect(screen.queryByRole('link', { name: /^Open file/ })).toBeNull();
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test.each([undefined, '', 'not a URL', 'javascript:alert(1)', 'http://tenant.sharepoint.com/file', 'https://user:password@tenant.sharepoint.com/file'])('does not offer an unsafe or absent file URL: %s', async (webUrl) => {
  const data = collection({ other: [{ artifactId: 'other', filename: 'Supporting.pdf', webUrl }] });
  data.checklist[0].received.webUrl = webUrl;
  global.fetch = jest.fn(async () => response({ success: true, collection: data }));
  render(<SiteVisitMaterialsCard requestId={REQUEST_ID} />);
  await screen.findByText(/1003222 Site Visit Presentation.pdf/);
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});

test('pending replacement opens only the previous receipt and never the unfinished job', async () => {
  const data = collection({ uploadJobs: [{ jobId: 'pending', slot: 'presentation_pdf', status: 'processing', webUrl: 'https://tenant.sharepoint.com/pending.pdf' }, { jobId: 'other-pending', slot: 'other', status: 'processing', filename: 'Unfinished.pdf', webUrl: 'https://tenant.sharepoint.com/unfinished.pdf' }] });
  data.checklist[0].received.webUrl = 'https://tenant.sharepoint.com/previous.pdf';
  global.fetch = jest.fn(async () => response({ success: true, collection: data }));
  render(<SiteVisitMaterialsCard requestId={REQUEST_ID} />);
  const link = await screen.findByRole('link', { name: 'Presentation (PDF)' });
  expect(link).toHaveAttribute('href', 'https://tenant.sharepoint.com/previous.pdf');
  expect(screen.getAllByRole('link')).toHaveLength(1);
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
    await screen.findByTestId('materials-row-presentation_pdf');
    expect(rowMenuItem('presentation_pdf', 'Upload updated file')).toBeEnabled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(rowMenuItem('participant_bios', 'Upload updated file')).toBeEnabled();
    expect(screen.queryByRole('menuitem', { name: 'Waive' })).toBeNull();
    const bios = rowOf('participant_bios');
    expect(bios.innerHTML).not.toMatch(/line-through/);
    expect(bios).toHaveTextContent(/bios\.pdf · staff upload · waived/);
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
    await screen.findByTestId('materials-row-presentation_pdf');
    const file = new File(['%PDF'], 'Updated deck.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByTestId('staff-upload-input-presentation_pdf'), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Presentation (PDF) saved.'));
    expect(posts.map(([url]) => url.split('/materials/')[1])).toEqual(['staff-upload-token', 'staff-finalize']);
    expect(posts[0][1]).toEqual({ slot: 'presentation_pdf', filename: 'Updated deck.pdf', contentType: 'application/pdf', size: 4 });
    expect(posts[1][1]).toEqual({ stagingId: '22222222-2222-4222-8222-222222222222', slot: 'presentation_pdf' });
    expect(mockPut).toHaveBeenCalledWith('p', file, expect.objectContaining({ access: 'private', token: 'ct' }));
    expect(global.fetch.mock.calls.filter(([url, o]) => url.endsWith('/materials') && o?.method !== 'POST').length).toBeGreaterThanOrEqual(2);
  });

  // Codex adversarial review 2026-10-05: a retryable or lost finalize must be retried with the SAME staging id,
  // so the generation key reuses the registry row and finishes retiring the predecessor.
  const STAGING = '22222222-2222-4222-8222-222222222222';
  function finalizeScript(outcomes) {
    const posts = [];
    global.fetch = jest.fn(async (url, options = {}) => {
      if (options.method === 'POST') {
        posts.push([url.split('/materials/')[1], JSON.parse(options.body)]);
        if (url.endsWith('/staff-upload-token')) return response({ ok: true, stagingId: STAGING, pathname: 'p', clientToken: 'ct', contentType: 'application/pdf' });
        const next = outcomes.shift();
        if (next === 'lost') throw new TypeError('Failed to fetch');
        return response(next.body, next.status);
      }
      return response({ success: true, collection: collection() });
    });
    return posts;
  }
  const choose = async () => {
    render(<SiteVisitMaterialsCard requestId={REQUEST_ID} requestNumber="1003222" />);
    await screen.findByTestId('materials-row-presentation_pdf');
    fireEvent.change(screen.getByTestId('staff-upload-input-presentation_pdf'), { target: { files: [new File(['%PDF'], 'd.pdf', { type: 'application/pdf' })] } });
  };

  test.each([
    ['a lost response', 'lost'],
    ['supersede_failed', { status: 503, body: { ok: false, reason: 'supersede_failed' } }],
  ])('after %s, Retry re-finalizes the same staging id without minting or uploading again', async (_label, first) => {
    const posts = finalizeScript([first, { status: 200, body: { ok: true, slot: 'presentation_pdf', filename: 'p.pdf' } }]);
    await choose();
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Presentation (PDF) saved.'));
    expect(posts.map(([path]) => path)).toEqual(['staff-upload-token', 'staff-finalize', 'staff-finalize']);
    expect(posts[1][1]).toEqual({ stagingId: STAGING, slot: 'presentation_pdf' });
    expect(posts[2][1]).toEqual({ stagingId: STAGING, slot: 'presentation_pdf' });
    expect(mockPut).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  test('an unresolved finalize blocks another file and Retry preserves the original staging id', async () => {
    const posts = finalizeScript([
      { status: 503, body: { ok: false, reason: 'supersede_failed' } },
      { status: 200, body: { ok: true, slot: 'presentation_pdf', filename: 'p.pdf' } },
    ]);
    await choose();
    const retry = await screen.findByRole('button', { name: 'Retry' });
    const input = screen.getByTestId('staff-upload-input-presentation_pdf');
    await waitFor(() => expect(rowMenuItem('presentation_pdf', 'Upload updated file')).toBeDisabled());
    expect(input).toBeDisabled();
    expect(screen.getByText('Press Retry to finish saving the earlier file first.')).toBeInTheDocument();

    fireEvent.change(input, { target: { files: [new File(['%PDF C'], 'C.pdf', { type: 'application/pdf' })] } });
    expect(posts.map(([path]) => path)).toEqual(['staff-upload-token', 'staff-finalize']);
    expect(screen.getByRole('button', { name: 'Retry' })).toBe(retry);
    fireEvent.click(retry);

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Presentation (PDF) saved.'));
    expect(posts.map(([path]) => path)).toEqual(['staff-upload-token', 'staff-finalize', 'staff-finalize']);
    expect(posts[1][1]).toEqual({ stagingId: STAGING, slot: 'presentation_pdf' });
    expect(posts[2][1]).toEqual({ stagingId: STAGING, slot: 'presentation_pdf' });
    expect(mockPut).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    await waitFor(() => expect(rowMenuItem('presentation_pdf', 'Upload updated file')).toBeEnabled());
    expect(input).toBeEnabled();
  });

  test('a final rejection clears the staged upload: no Retry is offered', async () => {
    finalizeScript([{ status: 422, body: { ok: false, reason: 'extension_not_allowed' } }]);
    await choose();
    expect(await screen.findByRole('alert')).toHaveTextContent('That file type is not accepted for this item.');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(rowMenuItem('presentation_pdf', 'Upload updated file')).toBeEnabled();
    expect(screen.getByTestId('staff-upload-input-presentation_pdf')).toBeEnabled();
  });

  test('upload status, errors and Retry stay inside their own row; the menu item opens that row\'s file picker', async () => {
    finalizeScript([{ status: 503, body: { ok: false, reason: 'supersede_failed' } }]);
    const linked = collection();
    linked.checklist[0].received.webUrl = 'https://sp.example/deck.pdf';
    const scripted = global.fetch;
    global.fetch = jest.fn(async (url, options = {}) => (options.method === 'POST' ? scripted(url, options) : response({ success: true, collection: linked })));
    await choose();
    await screen.findByRole('button', { name: 'Retry' });
    const row = rowOf('presentation_pdf');
    expect(within(row).getByRole('link', { name: 'Presentation (PDF)' })).toHaveAttribute('href', 'https://sp.example/deck.pdf');
    expect(row).toContainElement(screen.getByTestId('staff-upload-input-presentation_pdf'));
    expect(row).toContainElement(screen.getByRole('alert'));
    expect(row).toContainElement(screen.getByRole('button', { name: 'Retry' }));
  });

  test('a missing row that becomes received on refresh keeps an unfinished upload and its Retry (Codex review, commit 5)', async () => {
    const posts = [];
    let received = false;
    let finalizes = 0;
    const withReceipt = () => {
      const data = collection();
      if (received) data.checklist[1].received = { artifactId: 's', filename: 'deck.pptx', receivedAt: '2026-10-06T00:00:00Z', uploadedByStaff: true };
      return data;
    };
    global.fetch = jest.fn(async (url, options = {}) => {
      if (options.method === 'POST') {
        const body = JSON.parse(options.body);
        posts.push([url.split('/materials')[1], body]);
        if (url.endsWith('/staff-upload-token')) return response({ ok: true, stagingId: STAGING, pathname: 'p', clientToken: 'ct', contentType: 'application/vnd.ms-powerpoint' });
        if (url.endsWith('/staff-finalize')) {
          finalizes += 1;
          if (finalizes === 1) { received = true; return response({ ok: false, reason: 'supersede_failed' }, 503); }
          return response({ ok: true, slot: 'presentation_source', filename: 'deck.pptx' });
        }
        if (body.action === 'waive') return response({ success: true, collection: withReceipt() });
      }
      return response({ success: true, collection: withReceipt() });
    });
    render(<SiteVisitMaterialsCard requestId={REQUEST_ID} requestNumber="1003222" />);
    await screen.findByTestId('materials-row-presentation_source');
    fireEvent.change(screen.getByTestId('staff-upload-input-presentation_source'), { target: { files: [new File(['ppt'], 'deck.pptx', { type: 'application/vnd.ms-powerpoint' })] } });
    const retry = await within(rowOf('presentation_source')).findByRole('button', { name: 'Retry' });
    // Another action refreshes the collection, which now shows this slot's receipt.
    fireEvent.click(rowMenuItem('participant_bios', 'Waive'));
    await waitFor(() => expect(rowOf('presentation_source')).toHaveTextContent('Received'));
    expect(within(rowOf('presentation_source')).getByRole('button', { name: 'Retry' })).toBe(retry);
    fireEvent.click(retry);
    await waitFor(() => expect(posts.filter(([path]) => path === '/staff-finalize')).toHaveLength(2));
    const finalizeBodies = posts.filter(([path]) => path === '/staff-finalize').map(([, body]) => body);
    expect(finalizeBodies[1]).toEqual(finalizeBodies[0]);
    expect(finalizeBodies[1].stagingId).toBe(STAGING);
  });

  test('the row menu\'s Upload updated file opens that row\'s file picker', async () => {
    global.fetch = jest.fn(async () => response({ success: true, collection: collection() }));
    const click = jest.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function record() { record.target = this; });
    render(<SiteVisitMaterialsCard requestId={REQUEST_ID} requestNumber="1003222" />);
    await screen.findByTestId('materials-row-presentation_pdf');
    fireEvent.click(rowMenuItem('presentation_pdf', 'Upload updated file'));
    expect(click).toHaveBeenCalledTimes(1);
    expect(click.mock.contexts[0]).toBe(screen.getByTestId('staff-upload-input-presentation_pdf'));
    click.mockRestore();
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
    await screen.findByTestId('materials-row-presentation_pdf');
    fireEvent.change(screen.getByTestId('staff-upload-input-presentation_pdf'), { target: { files: [new File(['%PDF'], 'd.pdf', { type: 'application/pdf' })] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Another upload for this item is still being saved');
    expect(screen.queryByText('Presentation (PDF) saved.')).toBeNull();
  });
});
