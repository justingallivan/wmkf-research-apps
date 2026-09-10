/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PreSiteDistributionPanel from '../../shared/components/workbench/PreSiteDistributionPanel';

jest.mock('../../shared/components/Layout', () => ({
  Card: ({ children }) => <div>{children}</div>,
}));

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const ARTIFACT_ID = '22222222-2222-4222-8222-222222222222';

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

const BRIEFING_LINK_ID = '12121212-1212-4212-8212-121212121212';

// Since 2026-09-10 a prepared attempt attaches nothing and always carries the
// briefing link; `mode` is kept only so legacy-shaped history rows can be built.
function preparedAttempt(mode = 'none') {
  const attachments = mode === 'none' ? [] : [
    ...(mode === 'pdf' ? [] : [{
      kind: 'docx', filename: 'PreSite_1002379.docx', webUrl: 'https://sharepoint.test/frozen.docx', size: 2048,
    }]),
    ...(mode === 'docx' ? [] : [{
      kind: 'pdf', filename: 'PreSite_1002379.pdf', webUrl: 'https://sharepoint.test/frozen.pdf', size: 4096,
    }]),
  ];
  return {
    operationId: '33333333-3333-4333-8333-333333333333',
    requestId: REQUEST_ID,
    previewHash: 'a'.repeat(64),
    attachmentMode: mode,
    briefingLinkId: BRIEFING_LINK_ID,
    to: ['staff@example.org'],
    cc: ['consultant@example.org'],
    subject: 'Pre-Site Visit materials — 1002379',
    bodyText: 'The briefing page linked below has the materials.',
    state: 'prepared',
    transportAccepted: false,
    attachments,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn().mockResolvedValue(response({ success: true, attempts: [] }));
});

afterEach(() => jest.restoreAllMocks());

test('offers no attachment choice; the default message names the briefing page as the carrier', async () => {
  render(
    <PreSiteDistributionPanel
      requestId={REQUEST_ID}
      requestNumber="1002379"
      sourceArtifact={{ artifactId: ARTIFACT_ID }}
    />,
  );
  expect(await screen.findByRole('heading', { name: 'Send Site Visit materials' })).toBeInTheDocument();
  expect(screen.queryByRole('group', { name: 'Document attachment' })).not.toBeInTheDocument();
  expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Message')).toHaveValue(
    'The deliberation briefing page linked below has the Site Visit writeup, every completed review, and the proposal narrative.',
  );
});

test('offers material links by display label with no calendar controls', async () => {
  render(
    <PreSiteDistributionPanel
      requestId={REQUEST_ID}
      requestNumber="1002379"
      sourceArtifact={{ artifactId: ARTIFACT_ID }}
      materials={[{
        artifactId: '44444444-4444-4444-8444-444444444444',
        filename: 'Applicant Slides.pdf',
        artifactTypeLabel: 'Applicant Slides',
      }]}
    />,
  );

  expect(await screen.findByRole('heading', { name: 'Send Site Visit materials' })).toBeInTheDocument();
  // Calendar attachments have no UI (owner decision S466: unused).
  expect(screen.queryByText(/add-to-calendar/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/Calendar and material links/)).not.toBeInTheDocument();
  // Materials show the display label; the SharePoint filename stays in a tooltip.
  expect(screen.getByRole('group', { name: 'Include links to materials' })).toBeInTheDocument();
  const materialLabel = screen.getByText('Applicant Slides');
  expect(materialLabel).toHaveAttribute('title', 'Applicant Slides.pdf');
  expect(screen.queryByText(/Applicant Slides\.pdf/)).not.toBeInTheDocument();
});

test('prepare carries no attachment mode, the preview shows the briefing link and no attachments, and send needs exact-preview confirmation', async () => {
  global.fetch
    .mockResolvedValueOnce(response({ success: true, attempts: [] }))
    .mockResolvedValueOnce(response({ success: true, attempt: preparedAttempt() }))
    .mockResolvedValueOnce(response({
      success: true,
      attempt: { ...preparedAttempt(), state: 'sent', transportAccepted: true },
    }))
    .mockResolvedValueOnce(response({
      success: true,
      attempts: [{ ...preparedAttempt(), state: 'sent', transportAccepted: true, createdAt: '2026-08-23T12:00:00Z' }],
    }));
  render(
    <PreSiteDistributionPanel
      requestId={REQUEST_ID}
      requestNumber="1002379"
      sourceArtifact={{ artifactId: ARTIFACT_ID }}
    />,
  );
  await screen.findByText(/No email previews/);
  fireEvent.change(screen.getByLabelText('To'), { target: { value: 'staff@example.org' } });
  fireEvent.change(screen.getByLabelText('Cc'), { target: { value: 'consultant@example.org' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create preview' }));

  expect(await screen.findByText('Email preview')).toBeInTheDocument();
  const prepareCall = global.fetch.mock.calls.find(([url]) => url.endsWith('/prepare'));
  const prepareBody = JSON.parse(prepareCall[1].body);
  expect(prepareBody).toMatchObject({
    requestId: REQUEST_ID,
    expectedArtifactId: ARTIFACT_ID,
    to: 'staff@example.org',
    cc: 'consultant@example.org',
  });
  expect(prepareBody).not.toHaveProperty('attachmentMode');
  expect(screen.getByText(/Link included/)).toBeInTheDocument();
  expect(screen.queryByText('Attachments:')).not.toBeInTheDocument();
  expect(screen.queryByText(/PreSite_1002379/)).not.toBeInTheDocument();
  expect(screen.getByText(/later edits are not included/i)).toBeInTheDocument();
  const send = screen.getByRole('button', { name: 'Send email' });
  expect(send).toBeDisabled();
  fireEvent.click(screen.getByLabelText(/I reviewed the recipients/));
  fireEvent.click(send);

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    '/api/workbench/pre-site-visit/distribution/send',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        requestId: REQUEST_ID,
        operationId: preparedAttempt().operationId,
        previewHash: preparedAttempt().previewHash,
      }),
    }),
  ));
  expect(await screen.findByText(/accepted this exact email for transport/i)).toBeInTheDocument();
});

test('editing the message after a preview invalidates it', async () => {
  global.fetch
    .mockResolvedValueOnce(response({ success: true, attempts: [] }))
    .mockResolvedValueOnce(response({ success: true, attempt: preparedAttempt() }));
  render(
    <PreSiteDistributionPanel
      requestId={REQUEST_ID}
      requestNumber="1002379"
      sourceArtifact={{ artifactId: ARTIFACT_ID }}
    />,
  );
  await screen.findByText(/No email previews/);
  fireEvent.change(screen.getByLabelText('To'), { target: { value: 'staff@example.org' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create preview' }));
  expect(await screen.findByText('Email preview')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Edited after preview.' } });
  expect(screen.queryByText('Email preview')).not.toBeInTheDocument();
});

test('a preview without a briefing link cannot be sent (defense: the server refuses to prepare one)', async () => {
  global.fetch
    .mockResolvedValueOnce(response({ success: true, attempts: [] }))
    .mockResolvedValueOnce(response({ success: true, attempt: { ...preparedAttempt(), briefingLinkId: null } }));
  render(
    <PreSiteDistributionPanel
      requestId={REQUEST_ID}
      requestNumber="1002379"
      sourceArtifact={{ artifactId: ARTIFACT_ID }}
    />,
  );
  await screen.findByText(/No email previews/);
  fireEvent.change(screen.getByLabelText('To'), { target: { value: 'staff@example.org' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create preview' }));
  expect(await screen.findByText(/No link — this preview cannot be sent/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: /I reviewed the recipients/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Send email' }));
  expect(global.fetch.mock.calls.some(([url]) => String(url).endsWith('/send'))).toBe(false);
});

test('adds curated recipients without replacing manual addresses or creating To/Cc conflicts', async () => {
  global.fetch = jest.fn(async (url) => {
    if (String(url).includes('/history')) return response({ success: true, attempts: [] });
    if (String(url).includes('/recipient-options')) {
      return response({
        success: true,
        recipients: [
          { key: 'recipient-option-0', category: 'staff', name: 'Alice Staff', email: 'alice@example.org' },
          { key: 'recipient-option-1', category: 'consultant', name: 'Casey Consultant', email: 'casey@example.org' },
        ],
      });
    }
    throw new Error('Unexpected fetch: ' + url);
  });
  render(
    <PreSiteDistributionPanel
      requestId={REQUEST_ID}
      requestNumber="1002379"
      sourceArtifact={{ artifactId: ARTIFACT_ID }}
    />,
  );
  await screen.findByText(/No email previews/);
  fireEvent.change(screen.getByLabelText('To'), { target: { value: 'manual@example.org' } });
  fireEvent.change(screen.getByLabelText('Cc'), { target: { value: 'casey@example.org' } });

  fireEvent.click(screen.getAllByRole('button', { name: 'Add from directory' })[0]);
  const alice = await screen.findByRole('checkbox', { name: /Alice Staff/ });
  const casey = screen.getByRole('checkbox', { name: /Casey Consultant/ });
  expect(casey).toBeDisabled();
  expect(screen.getByText('Already in Cc')).toBeInTheDocument();
  fireEvent.click(alice);
  fireEvent.click(screen.getByRole('button', { name: 'Add 1 recipient' }));

  expect(screen.getByLabelText('To')).toHaveValue('manual@example.org, alice@example.org');
  expect(screen.getByLabelText('Cc')).toHaveValue('casey@example.org');
});

test('recipient picker traps focus, closes with Escape, and restores the directory trigger', async () => {
  global.fetch = jest.fn(async (url) => {
    if (String(url).includes('/history')) return response({ success: true, attempts: [] });
    if (String(url).includes('/recipient-options')) {
      return response({
        success: true,
        recipients: [{
          key: 'recipient-option-0',
          category: 'staff',
          name: 'Alice Staff',
          email: 'alice@example.org',
        }],
      });
    }
    throw new Error('Unexpected fetch: ' + url);
  });
  render(
    <PreSiteDistributionPanel
      requestId={REQUEST_ID}
      requestNumber="1002379"
      sourceArtifact={{ artifactId: ARTIFACT_ID }}
    />,
  );
  await screen.findByText(/No email previews/);
  const trigger = screen.getAllByRole('button', { name: 'Add from directory' })[0];
  trigger.focus();
  fireEvent.click(trigger);

  const filter = await screen.findByLabelText('Filter recipients');
  expect(filter).toHaveFocus();
  const closeButton = screen.getByRole('button', { name: 'Close' });
  const cancel = screen.getByRole('button', { name: 'Cancel' });
  cancel.focus();
  fireEvent.keyDown(window, { key: 'Tab' });
  expect(closeButton).toHaveFocus();
  fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
  expect(cancel).toHaveFocus();
  cancel.blur();
  expect(document.body).toHaveFocus();
  fireEvent.keyDown(window, { key: 'Tab' });
  expect(closeButton).toHaveFocus();

  fireEvent.keyDown(window, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(trigger).toHaveFocus();
});

test('directory failure leaves manual recipient entry available', async () => {
  global.fetch = jest.fn(async (url) => (
    String(url).includes('/history')
      ? response({ success: true, attempts: [] })
      : response({ error: 'Directory unavailable' }, 503)
  ));
  render(
    <PreSiteDistributionPanel
      requestId={REQUEST_ID}
      requestNumber="1002379"
      sourceArtifact={{ artifactId: ARTIFACT_ID }}
    />,
  );
  await screen.findByText(/No email previews/);
  fireEvent.click(screen.getAllByRole('button', { name: 'Add from directory' })[0]);
  expect(await screen.findByRole('alert')).toHaveTextContent('Directory unavailable');
  fireEvent.change(screen.getByLabelText('To'), { target: { value: 'manual@example.org' } });
  expect(screen.getByLabelText('To')).toHaveValue('manual@example.org');
  expect(screen.getByRole('button', { name: 'Create preview' })).toBeEnabled();
});

test('surfaces an in-progress prepare response instead of accepting it as a preview', async () => {
  global.fetch
    .mockResolvedValueOnce(response({ success: true, attempts: [] }))
    .mockResolvedValueOnce(response({
      error: 'The same frozen snapshot is already being prepared. Retry shortly.',
      inProgress: true,
    }, 202));
  render(
    <PreSiteDistributionPanel
      requestId={REQUEST_ID}
      requestNumber="1002379"
      sourceArtifact={{ artifactId: ARTIFACT_ID }}
    />,
  );
  await screen.findByText(/No email previews/);
  fireEvent.change(screen.getByLabelText('To'), { target: { value: 'staff@example.org' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create preview' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(/already being prepared/i);
  expect(screen.queryByText('Email preview')).not.toBeInTheDocument();
});

test('turns a stale material response into a recoverable notice and requires a fresh confirmation', async () => {
  global.fetch
    .mockResolvedValueOnce(response({ success: true, attempts: [] }))
    .mockResolvedValueOnce(response({ success: true, attempt: preparedAttempt('pdf') }))
    .mockResolvedValueOnce(response({
      error: 'A linked Site Visit material changed after preview. Prepare a new exact preview.',
      code: 'distribution_material_stale',
    }, 409))
    .mockResolvedValueOnce(response({ success: true, attempt: preparedAttempt('pdf') }));

  render(
    <PreSiteDistributionPanel
      requestId={REQUEST_ID}
      requestNumber="1002379"
      sourceArtifact={{ artifactId: ARTIFACT_ID }}
    />,
  );

  await screen.findByText(/No email previews/);
  fireEvent.change(screen.getByLabelText('To'), { target: { value: 'staff@example.org' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create preview' }));
  await screen.findByText('Email preview');
  const confirmation = screen.getByLabelText(/I reviewed the recipients/);
  fireEvent.click(confirmation);
  fireEvent.click(screen.getByRole('button', { name: 'Send email' }));

  const notice = await screen.findByRole('status');
  expect(notice).toHaveTextContent(/preview is out of date.*Create a new preview/i);
  expect(screen.queryByText('Email preview')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Create preview' }));
  await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  expect(await screen.findByText('Email preview')).toBeInTheDocument();
});

test('history renders superseded previews quietly, real failures red, and GUIDs behind Details', async () => {
  const base = preparedAttempt('pdf');
  const dynamicsId = '5b5018bc-9ca0-f111-b8dc-70a8a59cded0';
  global.fetch.mockResolvedValueOnce(response({
    success: true,
    attempts: [
      {
        ...base,
        operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        state: 'sent',
        transportAccepted: true,
        createdAt: '2026-08-25T12:00:00Z',
        dynamicsEmailId: dynamicsId,
      },
      {
        ...base,
        operationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        createdAt: '2026-08-25T11:00:00Z',
        lastError: 'A linked Site Visit material changed after preview. Prepare a new exact preview.',
        lastErrorCode: 'distribution_material_stale',
      },
      {
        ...base,
        operationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        createdAt: '2026-08-25T10:00:00Z',
        lastError: 'The persisted Dynamics email activity could not be found.',
        lastErrorCode: 'distribution_email_missing',
      },
      {
        // Stale code BUT a Dynamics activity exists: the earlier send may have
        // transported before its outcome was lost — must NOT read as never-sent.
        ...base,
        operationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        createdAt: '2026-08-25T09:00:00Z',
        lastError: 'A linked Site Visit material changed after preview. Prepare a new exact preview.',
        lastErrorCode: 'distribution_material_stale',
        dynamicsEmailId: '33ce6346-d89f-f111-b8db-6045bd07a06d',
      },
    ],
  }));

  render(
    <PreSiteDistributionPanel
      requestId={REQUEST_ID}
      requestNumber="1002379"
      sourceArtifact={{ artifactId: ARTIFACT_ID }}
    />,
  );

  expect(await screen.findByText('Sent')).toBeInTheDocument();
  expect(screen.getByText('Superseded')).toBeInTheDocument();
  expect(screen.getByText('Failed')).toBeInTheDocument();

  // The stale preview shows the quiet explanation, not the imperative error.
  expect(screen.getByText(/went stale before it was sent/)).toBeInTheDocument();
  expect(screen.queryByText(/Prepare a new exact preview/)).not.toBeInTheDocument();

  // A stale attempt WITH a Dynamics activity is ambiguous, never "Superseded":
  // the original email may have transported before its outcome was lost.
  expect(screen.getByText('Send outcome unconfirmed')).toBeInTheDocument();
  expect(screen.getByText(/original email may have gone out/)).toBeInTheDocument();
  expect(screen.getAllByText('Superseded')).toHaveLength(1);
  // The genuine failure keeps its message.
  expect(screen.getByText(/could not be found/)).toBeInTheDocument();

  // The Dynamics GUID appears only inside the Details disclosure.
  const sentItem = screen.getByText('Sent').closest('li');
  const details = sentItem.querySelector('details');
  expect(details.textContent).toContain(dynamicsId);
  expect(sentItem.textContent.replace(details.textContent, '')).not.toContain(dynamicsId);
});

test('history labels only attempts whose To and Cc addresses all equal From as test sends', async () => {
  const base = preparedAttempt('pdf');
  global.fetch.mockResolvedValueOnce(response({
    success: true,
    attempts: [
      {
        ...base,
        operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        subject: 'Internal test distribution',
        from: 'sender@example.org',
        to: ['Sender@Example.org'],
        cc: ['SENDER@example.org'],
        state: 'sent',
        transportAccepted: true,
        createdAt: '2026-08-25T12:00:00Z',
      },
      {
        ...base,
        operationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        subject: 'Real distribution',
        from: 'sender@example.org',
        to: ['board@example.org'],
        cc: [],
        state: 'sent',
        transportAccepted: true,
        createdAt: '2026-08-25T11:00:00Z',
      },
    ],
  }));

  render(
    <PreSiteDistributionPanel
      requestId={REQUEST_ID}
      requestNumber="1002379"
      sourceArtifact={{ artifactId: ARTIFACT_ID }}
    />,
  );

  const testRow = (await screen.findByText('Internal test distribution')).closest('li');
  const realRow = screen.getByText('Real distribution').closest('li');
  expect(testRow).toHaveTextContent('Test send');
  expect(realRow).not.toHaveTextContent('Test send');
  expect(screen.getAllByText('Test send')).toHaveLength(1);
});

test('groups history under local calendar-day headers with the newest day first', async () => {
  const base = preparedAttempt('pdf');
  const olderCreatedAt = new Date(2020, 0, 2, 12).toISOString();
  const newerCreatedAt = new Date(2020, 0, 3, 12).toISOString();
  global.fetch.mockResolvedValueOnce(response({
    success: true,
    attempts: [
      {
        ...base,
        operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        subject: 'Older distribution',
        createdAt: olderCreatedAt,
      },
      {
        ...base,
        operationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        subject: 'First newer distribution',
        createdAt: newerCreatedAt,
      },
      {
        ...base,
        operationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        subject: 'Second newer distribution',
        createdAt: new Date(2020, 0, 3, 10).toISOString(),
      },
    ],
  }));

  render(
    <PreSiteDistributionPanel
      requestId={REQUEST_ID}
      requestNumber="1002379"
      sourceArtifact={{ artifactId: ARTIFACT_ID }}
    />,
  );

  await screen.findByText('Older distribution');
  const headers = screen.getAllByRole('heading', { level: 4 }).map((heading) => heading.textContent);
  expect(headers).toEqual([
    new Date(newerCreatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
    new Date(olderCreatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
  ]);
  const newestDaySubjects = Array.from(
    screen.getAllByRole('heading', { level: 4 })[0].closest('section').querySelectorAll('li'),
    (row) => row.querySelector('p').textContent,
  );
  expect(newestDaySubjects).toEqual(['First newer distribution', 'Second newer distribution']);
});

test('reports loaded history and the server-derived sent flag through onHistory', async () => {
  const attempts = [{ ...preparedAttempt('pdf'), state: 'sent', transportAccepted: true, createdAt: '2026-08-25T12:00:00Z' }];
  global.fetch.mockResolvedValueOnce(response({ success: true, attempts, currentSourceEverSent: true }));
  const onHistory = jest.fn();

  render(
    <PreSiteDistributionPanel
      requestId={REQUEST_ID}
      requestNumber="1002379"
      sourceArtifact={{ artifactId: ARTIFACT_ID }}
      onHistory={onHistory}
    />,
  );

  await waitFor(() => expect(onHistory).toHaveBeenCalledWith({
    attempts,
    currentSourceEverSent: true,
    latestSendFailure: null,
  }));
});

test('collapsed mode folds the composer behind a Send-materials-again disclosure', async () => {
  render(
    <PreSiteDistributionPanel
      requestId={REQUEST_ID}
      requestNumber="1002379"
      sourceArtifact={{ artifactId: ARTIFACT_ID }}
      collapsed
    />,
  );

  expect(await screen.findByText('Send materials again')).toBeInTheDocument();
  expect(screen.getByText(/already been sent/)).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Send Site Visit materials' })).not.toBeInTheDocument();
  // The composer remains reachable inside the disclosure.
  expect(screen.getByRole('button', { name: 'Create preview' })).toBeInTheDocument();
});

test('keeps non-stale send failures as errors', async () => {
  global.fetch
    .mockResolvedValueOnce(response({ success: true, attempts: [] }))
    .mockResolvedValueOnce(response({ success: true, attempt: preparedAttempt('pdf') }))
    .mockResolvedValueOnce(response({
      error: 'The persisted Dynamics email activity could not be found.',
      code: 'distribution_email_missing',
    }, 409));

  render(
    <PreSiteDistributionPanel
      requestId={REQUEST_ID}
      requestNumber="1002379"
      sourceArtifact={{ artifactId: ARTIFACT_ID }}
    />,
  );

  await screen.findByText(/No email previews/);
  fireEvent.change(screen.getByLabelText('To'), { target: { value: 'staff@example.org' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create preview' }));
  await screen.findByText('Email preview');
  fireEvent.click(screen.getByLabelText(/I reviewed the recipients/));
  fireEvent.click(screen.getByRole('button', { name: 'Send email' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(/could not be found/i);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

test('an unreadable briefing link still offers Issue new link but never Copy', async () => {
  global.fetch = jest.fn()
    .mockResolvedValueOnce(response({ success: true, attempts: [], briefingLink: { id: 'l', url: null, unreadable: true, expiresAt: null } }))
    .mockResolvedValueOnce(response({ success: true, link: { id: 'm', url: 'https://apps.test/external/briefing/new', unreadable: false, expiresAt: '2026-10-08T00:00:00Z' } }));
  render(
    <PreSiteDistributionPanel
      requestId={REQUEST_ID}
      requestNumber="1002379"
      sourceArtifact={{ artifactId: ARTIFACT_ID }}
    />,
  );
  await screen.findByText(/can no longer be read on the server/);
  expect(screen.queryByText('Copy link')).toBeNull();
  fireEvent.click(screen.getByText('Issue new link'));
  await screen.findByText(/stops the current one immediately/);
  fireEvent.click(screen.getByText('Issue new link'));
  await waitFor(() => expect(screen.getByText('https://apps.test/external/briefing/new')).toBeInTheDocument());
  expect(global.fetch.mock.calls[1][0]).toBe('/api/workbench/pre-site-visit/briefing-link');
  expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toEqual({ requestId: REQUEST_ID, action: 'reissue', expectedLinkId: 'l' });
});

test('a superseded reissue refreshes the header from history instead of revoking the newer link', async () => {
  global.fetch = jest.fn()
    .mockResolvedValueOnce(response({ success: true, attempts: [], briefingLink: { id: 'l', url: 'https://apps.test/external/briefing/old', expiresAt: null } }))
    .mockResolvedValueOnce(response({ error: 'The briefing link was replaced by another action. Refresh to see the current link.', code: 'briefing_link_superseded' }, 409))
    .mockResolvedValueOnce(response({ success: true, attempts: [], briefingLink: { id: 'm', url: 'https://apps.test/external/briefing/newer', expiresAt: null } }));
  render(
    <PreSiteDistributionPanel
      requestId={REQUEST_ID}
      requestNumber="1002379"
      sourceArtifact={{ artifactId: ARTIFACT_ID }}
    />,
  );
  await screen.findByText('https://apps.test/external/briefing/old');
  fireEvent.click(screen.getByText('Issue new link'));
  await screen.findByText(/stops the current one immediately/);
  fireEvent.click(screen.getByText('Issue new link'));
  await screen.findByText('https://apps.test/external/briefing/newer');
  expect(screen.getByText(/replaced by another action/)).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledTimes(3);
});
