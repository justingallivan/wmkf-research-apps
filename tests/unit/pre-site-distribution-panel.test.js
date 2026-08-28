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

function preparedAttempt(mode = 'both') {
  const attachments = [
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
    to: ['staff@example.org'],
    cc: ['consultant@example.org'],
    subject: 'Pre-Site Visit materials — 1002379',
    bodyText: 'Please find the frozen materials attached.',
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

test('offers Word, PDF, and both as explicit attachment choices', async () => {
  render(
    <PreSiteDistributionPanel
      requestId={REQUEST_ID}
      requestNumber="1002379"
      sourceArtifact={{ artifactId: ARTIFACT_ID }}
    />,
  );
  expect(await screen.findByLabelText('Word document')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Send Site Visit materials' })).toBeInTheDocument();
  expect(screen.getByLabelText('PDF')).toBeChecked();
  expect(screen.getByLabelText('Word and PDF')).toBeInTheDocument();
});

test('explains calendar and material-link choices in plain language', async () => {
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

  expect(await screen.findByRole('group', { name: 'Document attachment' })).toBeInTheDocument();
  expect(screen.getByRole('group', { name: 'Calendar and material links' })).toBeInTheDocument();
  expect(screen.getByLabelText(/Attach an add-to-calendar file \(.ics\)/i)).toBeDisabled();
  expect(screen.getByText(/saved organizer is included in To automatically.*does not request an RSVP/i))
    .toBeInTheDocument();
  expect(screen.getByText(/No scheduled Site Visit is on file for this request/))
    .toBeInTheDocument();
  expect(screen.getByText('Include links to materials')).toBeInTheDocument();
});

test('binds the chosen mode into prepare and requires exact-preview confirmation before send', async () => {
  global.fetch
    .mockResolvedValueOnce(response({ success: true, attempts: [] }))
    .mockResolvedValueOnce(response({ success: true, attempt: preparedAttempt('both') }))
    .mockResolvedValueOnce(response({
      success: true,
      attempt: { ...preparedAttempt('both'), state: 'sent', transportAccepted: true },
    }))
    .mockResolvedValueOnce(response({
      success: true,
      attempts: [{ ...preparedAttempt('both'), state: 'sent', transportAccepted: true, createdAt: '2026-08-23T12:00:00Z' }],
    }));
  render(
    <PreSiteDistributionPanel
      requestId={REQUEST_ID}
      requestNumber="1002379"
      sourceArtifact={{ artifactId: ARTIFACT_ID }}
    />,
  );
  await screen.findByText(/No email previews/);
  fireEvent.click(screen.getByLabelText('Word and PDF'));
  fireEvent.change(screen.getByLabelText('To'), { target: { value: 'staff@example.org' } });
  fireEvent.change(screen.getByLabelText('Cc'), { target: { value: 'consultant@example.org' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create preview' }));

  expect(await screen.findByText('Email preview')).toBeInTheDocument();
  const prepareCall = global.fetch.mock.calls.find(([url]) => url.endsWith('/prepare'));
  expect(JSON.parse(prepareCall[1].body)).toMatchObject({
    requestId: REQUEST_ID,
    expectedArtifactId: ARTIFACT_ID,
    attachmentMode: 'both',
    to: 'staff@example.org',
    cc: 'consultant@example.org',
  });
  expect(screen.getByText(/PreSite_1002379.docx/)).toBeInTheDocument();
  expect(screen.getByText(/PreSite_1002379.pdf/)).toBeInTheDocument();
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

test('changing attachment selection invalidates a prepared preview', async () => {
  global.fetch
    .mockResolvedValueOnce(response({ success: true, attempts: [] }))
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
  expect(await screen.findByText('Email preview')).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Word document'));
  expect(screen.queryByText('Email preview')).not.toBeInTheDocument();
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
  }));
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
