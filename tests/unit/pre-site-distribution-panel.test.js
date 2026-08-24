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
  expect(screen.getByText(/does not request an RSVP.*later changes will not update it automatically/i))
    .toBeInTheDocument();
  expect(screen.getByText('Complete and save Visit logistics above to include the calendar.'))
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
  await screen.findByText(/No frozen distributions/);
  fireEvent.click(screen.getByLabelText('Word and PDF'));
  fireEvent.change(screen.getByLabelText('To'), { target: { value: 'staff@example.org' } });
  fireEvent.change(screen.getByLabelText('Cc'), { target: { value: 'consultant@example.org' } });
  fireEvent.click(screen.getByRole('button', { name: 'Freeze and preview' }));

  expect(await screen.findByText('Exact send preview')).toBeInTheDocument();
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
  const send = screen.getByRole('button', { name: 'Send exact preview' });
  expect(send).toBeDisabled();
  fireEvent.click(screen.getByLabelText(/I confirmed the exact recipients/));
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
  await screen.findByText(/No frozen distributions/);
  fireEvent.change(screen.getByLabelText('To'), { target: { value: 'staff@example.org' } });
  fireEvent.click(screen.getByRole('button', { name: 'Freeze and preview' }));
  expect(await screen.findByText('Exact send preview')).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Word document'));
  expect(screen.queryByText('Exact send preview')).not.toBeInTheDocument();
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
  await screen.findByText(/No frozen distributions/);
  fireEvent.change(screen.getByLabelText('To'), { target: { value: 'staff@example.org' } });
  fireEvent.click(screen.getByRole('button', { name: 'Freeze and preview' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(/already being prepared/i);
  expect(screen.queryByText('Exact send preview')).not.toBeInTheDocument();
});
