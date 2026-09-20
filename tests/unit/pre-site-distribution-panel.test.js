/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  expect(await screen.findByRole('heading', { name: 'Send deliberation materials' })).toBeInTheDocument();
  expect(screen.queryByRole('group', { name: 'Document attachment' })).not.toBeInTheDocument();
  expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Message')).toHaveValue(
    'The deliberation briefing page linked below has the Pre-Research Presentation Brief, every completed review, the proposal, and the research presentation materials.',
  );
});

test('loads the admin Share subject and message and renders the request-number token', async () => {
  global.fetch.mockResolvedValueOnce(response({
    success: true,
    attempts: [],
    emailDefaults: {
      subjectTemplate: 'Justin notes — {{requestNumber}}',
      bodyTemplate: 'Dear colleagues, please use the briefing page.',
      configured: true,
      unavailable: false,
    },
  }));
  render(
    <PreSiteDistributionPanel
      requestId={REQUEST_ID}
      requestNumber="1002379"
      sourceArtifact={{ artifactId: ARTIFACT_ID }}
    />,
  );
  await waitFor(() => expect(screen.getByLabelText('Subject')).toHaveValue('Justin notes — 1002379'));
  expect(screen.getByLabelText('Message')).toHaveValue('Dear colleagues, please use the briefing page.');
  expect(screen.queryByText(/not fully configured/i)).toBeNull();
});

test('does not overwrite a staff edit when the async Share defaults arrive', async () => {
  let resolveHistory;
  global.fetch.mockReturnValueOnce(new Promise((resolve) => { resolveHistory = resolve; }));
  render(
    <PreSiteDistributionPanel
      requestId={REQUEST_ID}
      requestNumber="1002379"
      sourceArtifact={{ artifactId: ARTIFACT_ID }}
    />,
  );
  fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'My in-progress subject' } });
  resolveHistory(response({
    success: true,
    attempts: [],
    emailDefaults: {
      subjectTemplate: 'Admin subject — {{requestNumber}}',
      bodyTemplate: 'Admin message',
      configured: true,
      unavailable: false,
    },
  }));
  await screen.findByText(/No email previews/);
  expect(screen.getByLabelText('Subject')).toHaveValue('My in-progress subject');
});

test('offers no material checkboxes and no calendar controls; the briefing page is the carrier', async () => {
  render(
    <PreSiteDistributionPanel
      requestId={REQUEST_ID}
      requestNumber="1002379"
      sourceArtifact={{ artifactId: ARTIFACT_ID }}
    />,
  );

  expect(await screen.findByRole('heading', { name: 'Send deliberation materials' })).toBeInTheDocument();
  // Calendar attachments have no UI (owner decision S466: unused).
  expect(screen.queryByText(/add-to-calendar/i)).not.toBeInTheDocument();
  // Material links retired (owner 2026-09-10): no "Include links to materials" group.
  expect(screen.queryByRole('group', { name: 'Include links to materials' })).not.toBeInTheDocument();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Message').value).toContain('the research presentation materials');
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
  expect(await screen.findByText('Sent for delivery.')).toBeInTheDocument();
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

test('H3c/B10: a brief_reviews_required prepare failure shows named, non-generic copy', async () => {
  // No `error` string in the body (discriminating: the generic `!response.ok`
  // path would fall back to "Preview preparation failed (409)" with no body
  // text to borrow from, so passing requires the dedicated code branch).
  global.fetch
    .mockResolvedValueOnce(response({ success: true, attempts: [] }))
    .mockResolvedValueOnce(response({ code: 'brief_reviews_required' }, 409));
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

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(/has no received reviews yet/i);
  expect(alert).not.toHaveTextContent(/Preview preparation failed/i);
  expect(screen.queryByText('Email preview')).not.toBeInTheDocument();
});

test('review bundle (plan §11): a review_bundle_incomplete prepare failure shows named copy, not the generic failure', async () => {
  global.fetch
    .mockResolvedValueOnce(response({ success: true, attempts: [] }))
    // No `error` string (discriminating: the generic fallback would show
    // "Preview preparation failed (409)", so passing requires the dedicated branch).
    .mockResolvedValueOnce(response({ code: 'review_bundle_incomplete' }, 409));
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

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(/has no retained file yet/i);
  expect(alert).not.toHaveTextContent(/Preview preparation failed/i);
});

test('review bundle (plan §11): a review_bundle_part_invalid prepare failure shows named, non-generic copy', async () => {
  // No `error` string in the body — discriminating: the generic fallback
  // would show "Preview preparation failed (409)".
  global.fetch
    .mockResolvedValueOnce(response({ success: true, attempts: [] }))
    .mockResolvedValueOnce(response({ code: 'review_bundle_part_invalid' }, 502));
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

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(/not a valid PDF/i);
  expect(alert).not.toHaveTextContent(/Preview preparation failed/i);
});

test('review bundle (plan §11): a review_bundle_unavailable prepare failure shows named, non-generic copy', async () => {
  global.fetch
    .mockResolvedValueOnce(response({ success: true, attempts: [] }))
    .mockResolvedValueOnce(response({ code: 'review_bundle_unavailable' }, 502));
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

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(/could not be assembled from SharePoint/i);
  expect(alert).not.toHaveTextContent(/Preview preparation failed/i);
});

test('review bundle (plan §11): a review_bundle_too_large prepare failure shows named copy, not the generic failure', async () => {
  global.fetch
    .mockResolvedValueOnce(response({ success: true, attempts: [] }))
    // No `error` string (discriminating, see above).
    .mockResolvedValueOnce(response({ code: 'review_bundle_too_large' }, 409));
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

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(/too large to assemble/i);
  expect(alert).not.toHaveTextContent(/Preview preparation failed/i);
});

// Codex adversarial review (2026-09-17, round 5 finding 1): mirrors the
// brief_reviews_required test above for the new 409
// brief_regeneration_in_progress code (a guarded regeneration is live for
// this request's brief).
test('a brief_regeneration_in_progress prepare failure shows named, non-generic copy', async () => {
  global.fetch
    .mockResolvedValueOnce(response({ success: true, attempts: [] }))
    .mockResolvedValueOnce(response({ code: 'brief_regeneration_in_progress' }, 409));
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

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(/replacement brief is being generated/i);
  expect(alert).not.toHaveTextContent(/Preview preparation failed/i);
  expect(screen.queryByText('Email preview')).not.toBeInTheDocument();
});

test('a late recipient suggestion that seeds a blank field invalidates the prepared preview and its confirmation', async () => {
  global.fetch
    .mockResolvedValueOnce(response({ success: true, attempts: [] }))
    .mockResolvedValueOnce(response({ success: true, attempt: preparedAttempt() }));
  const { rerender } = render(
    <PreSiteDistributionPanel
      requestId={REQUEST_ID}
      requestNumber="1002379"
      sourceArtifact={{ artifactId: ARTIFACT_ID }}
      suggestedCc={[]}
    />,
  );
  await screen.findByText(/No email previews/);
  fireEvent.change(screen.getByLabelText('To'), { target: { value: 'staff@example.org' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create preview' }));
  expect(await screen.findByText('Email preview')).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText(/I reviewed the recipients/));
  expect(screen.getByRole('button', { name: 'Send email' })).toBeEnabled();

  rerender(
    <PreSiteDistributionPanel
      requestId={REQUEST_ID}
      requestNumber="1002379"
      sourceArtifact={{ artifactId: ARTIFACT_ID }}
      suggestedCc={['late-consultant@example.org']}
    />,
  );
  expect(screen.getByLabelText('Cc')).toHaveValue('late-consultant@example.org');
  expect(screen.queryByText('Email preview')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Send email' })).not.toBeInTheDocument();
});

test('a later automatic seed replaces the earlier automatic seed and invalidates a confirmed preview, but never a staff edit', async () => {
  global.fetch
    .mockResolvedValueOnce(response({ success: true, attempts: [] }))
    .mockResolvedValueOnce(response({ success: true, attempt: preparedAttempt() }));
  const props = { requestId: REQUEST_ID, requestNumber: '1002379', sourceArtifact: { artifactId: ARTIFACT_ID } };
  const { rerender } = render(
    <PreSiteDistributionPanel {...props} suggestedTo={['fallback@example.org']} suggestedCc={['first-cc@example.org']} />,
  );
  await screen.findByText(/No email previews/);
  expect(screen.getByLabelText('To')).toHaveValue('fallback@example.org');
  // Staff edit Cc only; To keeps the automatic seed.
  fireEvent.change(screen.getByLabelText('Cc'), { target: { value: 'edited-cc@example.org' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create preview' }));
  expect(await screen.findByText('Email preview')).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText(/I reviewed the recipients/));
  expect(screen.getByRole('button', { name: 'Send email' })).toBeEnabled();

  rerender(
    <PreSiteDistributionPanel {...props} suggestedTo={['attendee@example.org']} suggestedCc={['second-cc@example.org']} />,
  );
  expect(screen.getByLabelText('To')).toHaveValue('attendee@example.org');
  expect(screen.getByLabelText('Cc')).toHaveValue('edited-cc@example.org');
  expect(screen.queryByText('Email preview')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Send email' })).not.toBeInTheDocument();
});

test('a staff-typed recipient is never displaced by later seeds, even when a seed passes through the same value', async () => {
  global.fetch.mockResolvedValueOnce(response({ success: true, attempts: [] }));
  const props = { requestId: REQUEST_ID, requestNumber: '1002379', sourceArtifact: { artifactId: ARTIFACT_ID } };
  const { rerender } = render(<PreSiteDistributionPanel {...props} suggestedTo={['a@example.org']} />);
  await screen.findByText(/No email previews/);
  expect(screen.getByLabelText('To')).toHaveValue('a@example.org');
  fireEvent.change(screen.getByLabelText('To'), { target: { value: 'b@example.org' } });
  // Seed B equals the staff value: ownership must stay with staff.
  rerender(<PreSiteDistributionPanel {...props} suggestedTo={['b@example.org']} />);
  expect(screen.getByLabelText('To')).toHaveValue('b@example.org');
  rerender(<PreSiteDistributionPanel {...props} suggestedTo={['c@example.org']} />);
  expect(screen.getByLabelText('To')).toHaveValue('b@example.org');
  // A staff edit that equals the previous automatic seed is still a staff edit.
  fireEvent.change(screen.getByLabelText('To'), { target: { value: 'a@example.org' } });
  rerender(<PreSiteDistributionPanel {...props} suggestedTo={['d@example.org']} />);
  expect(screen.getByLabelText('To')).toHaveValue('a@example.org');
});

test('a brief_snapshot_invalid prepare failure shows its own copy, distinct from the zero-review reason', async () => {
  global.fetch
    .mockResolvedValueOnce(response({ success: true, attempts: [] }))
    .mockResolvedValueOnce(response({ code: 'brief_snapshot_invalid' }, 409));
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

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(/stored input record could not be read/i);
  expect(alert).not.toHaveTextContent(/has no received reviews yet/i);
  expect(alert).not.toHaveTextContent(/Preview preparation failed/i);
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
  expect(screen.queryByRole('heading', { name: 'Send deliberation materials' })).not.toBeInTheDocument();
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

// Codex adversarial review (2026-09-17, round 5 finding 1): the same
// freshness recheck runs at send time, so this named copy must also appear
// there, and the still-valid preview must not be discarded (unlike the
// STALE_PREVIEW_CODES branch).
test('a brief_regeneration_in_progress send failure shows named copy and keeps the existing preview', async () => {
  global.fetch
    .mockResolvedValueOnce(response({ success: true, attempts: [] }))
    .mockResolvedValueOnce(response({ success: true, attempt: preparedAttempt('pdf') }))
    .mockResolvedValueOnce(response({ code: 'brief_regeneration_in_progress' }, 409));

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

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(/replacement brief is being generated/i);
  expect(screen.getByText('Email preview')).toBeInTheDocument();
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

test('a superseded reissue with no error field falls back to the server-mirrored sentence', async () => {
  global.fetch = jest.fn()
    .mockResolvedValueOnce(response({ success: true, attempts: [], briefingLink: { id: 'l', url: 'https://apps.test/external/briefing/old', expiresAt: null } }))
    .mockResolvedValueOnce(response({ code: 'briefing_link_superseded' }, 409))
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
  expect(screen.getByText('The briefing link was replaced by another action. Refresh to see the current link.')).toBeInTheDocument();
  expect(screen.queryByText(/Request failed \(409\)/)).toBeNull();
});

test('a reissue blocked by an in-progress send with no error field falls back to the server-mirrored sentence', async () => {
  global.fetch = jest.fn()
    .mockResolvedValueOnce(response({ success: true, attempts: [], briefingLink: { id: 'l', url: 'https://apps.test/external/briefing/old', expiresAt: null } }))
    .mockResolvedValueOnce(response({ code: 'briefing_send_in_progress' }, 409))
    .mockResolvedValueOnce(response({ success: true, attempts: [], briefingLink: { id: 'l', url: 'https://apps.test/external/briefing/old', expiresAt: null } }));
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
  await screen.findByText('A send that carries the current briefing link has not finished. Retry it (or wait for it to reconcile) before issuing a new link.');
  expect(screen.queryByText(/Request failed \(409\)/)).toBeNull();
});

test('dialog mode: Add from directory opens the picker above the composer, and Escape closes the picker first', async () => {
  global.fetch = jest.fn(async (url) => {
    if (String(url).includes('/history')) return response({ success: true, attempts: [] });
    if (String(url).includes('/recipient-options')) {
      return response({ success: true, recipients: [{ key: 'r0', category: 'staff', name: 'Alice Staff', email: 'alice@example.org' }] });
    }
    return response({ success: true });
  });
  const onCloseComposer = jest.fn();
  render(
    <PreSiteDistributionPanel
      requestId={REQUEST_ID}
      requestNumber="1002379"
      sourceArtifact={{ artifactId: ARTIFACT_ID }}
      composer="dialog"
      onCloseComposer={onCloseComposer}
      needsLock
    />,
  );
  const composer = await screen.findByRole('dialog', { name: 'Share for the deliberation session' });
  expect(within(composer).getByTestId('composer-lock-note')).toBeInTheDocument();
  // Close is reachable at both ends of a long dialog (owner 2026-09-10).
  expect(within(composer).getAllByRole('button', { name: 'Close' })).toHaveLength(2);
  expect(within(composer).getByRole('button', { name: 'Lock and preview' })).toBeInTheDocument();

  fireEvent.click(within(composer).getAllByRole('button', { name: 'Add from directory' })[0]);
  const picker = await screen.findByRole('dialog', { name: /directory|recipients/i });
  // Stacked above the composer (z-60 over z-50), so it is visible, not painted under.
  expect(picker.closest('[class*="z-[60]"]')).not.toBeNull();

  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: /directory|recipients/i })).not.toBeInTheDocument());
  expect(onCloseComposer).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog', { name: 'Share for the deliberation session' })).toBeInTheDocument();

  fireEvent.keyDown(document, { key: 'Escape' });
  expect(onCloseComposer).toHaveBeenCalledTimes(1);
});

test('the composer shows the deliberation session slot read-only, and the preview reports the session the server bound', async () => {
  const session = { scheduledStartIso: '2026-09-11T18:45:00.000Z', scheduledEndIso: null, ianaTimeZone: 'America/Los_Angeles', meetingLink: 'https://zoom.example/j/1', location: null };
  global.fetch
    .mockResolvedValueOnce(response({ success: true, attempts: [] }))
    .mockResolvedValueOnce(response({ success: true, attempt: { ...preparedAttempt(), session: { ...session, sessionId: 's1' } } }));
  render(
    <PreSiteDistributionPanel
      requestId={REQUEST_ID}
      requestNumber="1002379"
      sourceArtifact={{ artifactId: ARTIFACT_ID }}
      session={session}
    />,
  );
  const slot = await screen.findByTestId('composer-session-slot');
  expect(slot).toHaveTextContent(/Deliberation session: .*Sep 11, 2026.*11:45.*AM\./);
  expect(slot).toHaveTextContent('Join link included.');

  fireEvent.change(screen.getByLabelText('To'), { target: { value: 'staff@example.org' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create preview' }));
  expect(await screen.findByText('Email preview')).toBeInTheDocument();
  expect(screen.getByText('Pre-discussion:').parentElement).toHaveTextContent(/Sep 11, 2026.*Join link included/);
});

test('with no session the slot says not yet scheduled and names the PC', async () => {
  render(
    <PreSiteDistributionPanel
      requestId={REQUEST_ID}
      requestNumber="1002379"
      sourceArtifact={{ artifactId: ARTIFACT_ID }}
    />,
  );
  const slot = await screen.findByTestId('composer-session-slot');
  expect(slot).toHaveTextContent('Deliberation session: not yet scheduled.');
  expect(slot).toHaveTextContent('the PC schedules sessions in Meeting Tracker');
});

// ── Stale-inputs confirmation (plan §3.4b step 3, PRE_RESEARCH_PRESENTATION_BRIEF_PLAN_2026-09-16.md) ─

function staleInputsBody(liveFingerprint = 'b'.repeat(64)) {
  return {
    error: "The request's inputs changed since the brief was generated. Review the changes before sharing.",
    code: 'brief_inputs_stale',
    generatedFingerprint: 'a'.repeat(64),
    liveFingerprint,
    delta: {
      changedRequestFields: ['akoya_title'],
      abstractChanged: true,
      addedReviewerSuggestionIds: ['reviewer-1'],
      removedReviewerSuggestionIds: [],
      changedReviewerSuggestionIds: [],
      generatedReviewCount: 1,
      liveReviewCount: 2,
    },
  };
}

test('a 409 brief_inputs_stale renders the bounded delta and retries only with the returned live fingerprint', async () => {
  global.fetch
    .mockResolvedValueOnce(response({ success: true, attempts: [] }))
    .mockResolvedValueOnce(response(staleInputsBody(), 409))
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

  const notice = await screen.findByTestId('stale-inputs-notice');
  expect(notice).toHaveTextContent("changed since the brief was generated");
  expect(notice).toHaveTextContent('Changed fields: akoya_title');
  expect(notice).toHaveTextContent('The abstract changed.');
  expect(notice).toHaveTextContent('1 reviewer(s) added');
  expect(notice).toHaveTextContent('Reviews: 1 at generation → 2 now');
  expect(screen.queryByText('Email preview')).not.toBeInTheDocument();

  fireEvent.click(within(notice).getByRole('button', { name: /share anyway/i }));

  await waitFor(() => expect(screen.getByText('Email preview')).toBeInTheDocument());
  const retryCall = global.fetch.mock.calls.filter(([url]) => url.endsWith('/prepare'))[1];
  expect(JSON.parse(retryCall[1].body)).toMatchObject({ acknowledgeStaleInputs: 'b'.repeat(64) });
  expect(screen.queryByTestId('stale-inputs-notice')).not.toBeInTheDocument();
});

test('a retry echoing a stale acknowledgement while inputs moved again shows the new delta, not a bare retry', async () => {
  global.fetch
    .mockResolvedValueOnce(response({ success: true, attempts: [] }))
    .mockResolvedValueOnce(response(staleInputsBody('b'.repeat(64)), 409))
    .mockResolvedValueOnce(response(staleInputsBody('c'.repeat(64)), 409));
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
  const firstNotice = await screen.findByTestId('stale-inputs-notice');
  fireEvent.click(within(firstNotice).getByRole('button', { name: /share anyway/i }));

  await waitFor(() => expect(
    global.fetch.mock.calls.filter(([url]) => url.endsWith('/prepare')),
  ).toHaveLength(2));
  const retryBody = JSON.parse(global.fetch.mock.calls.filter(([url]) => url.endsWith('/prepare'))[1][1].body);
  expect(retryBody.acknowledgeStaleInputs).toBe('b'.repeat(64));

  const secondNotice = await screen.findByTestId('stale-inputs-notice');
  expect(screen.queryByText('Email preview')).not.toBeInTheDocument();
  // A follow-up retry must bind to the NEW live fingerprint, not the one just echoed.
  fireEvent.click(within(secondNotice).getByRole('button', { name: /share anyway/i }));
  await waitFor(() => expect(
    global.fetch.mock.calls.filter(([url]) => url.endsWith('/prepare')),
  ).toHaveLength(3));
  const thirdBody = JSON.parse(global.fetch.mock.calls.filter(([url]) => url.endsWith('/prepare'))[2][1].body);
  expect(thirdBody.acknowledgeStaleInputs).toBe('c'.repeat(64));
});

test('the stale-inputs confirmation clears when the form changes', async () => {
  global.fetch
    .mockResolvedValueOnce(response({ success: true, attempts: [] }))
    .mockResolvedValueOnce(response(staleInputsBody(), 409));
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
  await screen.findByTestId('stale-inputs-notice');

  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Edited after the stale-inputs notice.' } });
  expect(screen.queryByTestId('stale-inputs-notice')).not.toBeInTheDocument();
});

test('the stale-inputs confirmation clears when the source artifact id changes', async () => {
  global.fetch
    .mockResolvedValueOnce(response({ success: true, attempts: [] }))
    .mockResolvedValueOnce(response(staleInputsBody(), 409))
    .mockResolvedValue(response({ success: true, attempts: [] }));
  const { rerender } = render(
    <PreSiteDistributionPanel
      requestId={REQUEST_ID}
      requestNumber="1002379"
      sourceArtifact={{ artifactId: ARTIFACT_ID }}
    />,
  );
  await screen.findByText(/No email previews/);
  fireEvent.change(screen.getByLabelText('To'), { target: { value: 'staff@example.org' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create preview' }));
  await screen.findByTestId('stale-inputs-notice');

  rerender(
    <PreSiteDistributionPanel
      requestId={REQUEST_ID}
      requestNumber="1002379"
      sourceArtifact={{ artifactId: 'a-new-brief-artifact-id' }}
    />,
  );
  expect(screen.queryByTestId('stale-inputs-notice')).not.toBeInTheDocument();
});

test('distribution history shows the bounded delta, actor, and time for an acknowledged attempt', async () => {
  global.fetch.mockResolvedValueOnce(response({
    success: true,
    attempts: [{
      ...preparedAttempt(),
      state: 'sent',
      transportAccepted: true,
      createdAt: '2026-09-05T12:00:00Z',
      staleInputsAcknowledged: {
        delta: { changedRequestFields: ['akoya_title'], abstractChanged: false, generatedReviewCount: 1, liveReviewCount: 2 },
        acknowledgedAt: '2026-09-05T11:55:00Z',
        acknowledgedBy: 'actor-system-user-id',
        acknowledgedByName: 'Ada Staff',
      },
    }],
  }));
  render(
    <PreSiteDistributionPanel
      requestId={REQUEST_ID}
      requestNumber="1002379"
      sourceArtifact={{ artifactId: ARTIFACT_ID }}
    />,
  );
  fireEvent.click(await screen.findByText(/Email history/));
  const ack = await screen.findByTestId('stale-inputs-acknowledged');
  expect(ack).toHaveTextContent('Staff acknowledged newer inputs at');
  expect(ack).toHaveTextContent('by Ada Staff');
  // The raw system-user GUID is never shown to staff.
  expect(ack).not.toHaveTextContent('actor-system-user-id');
  expect(ack).toHaveTextContent('Changed fields: akoya_title');
  expect(ack).toHaveTextContent('Reviews: 1 at generation → 2 at share');
});

test('an attempt without an acknowledgement shows no stale-inputs audit line', async () => {
  global.fetch.mockResolvedValueOnce(response({
    success: true,
    attempts: [{ ...preparedAttempt(), state: 'sent', transportAccepted: true, createdAt: '2026-09-05T12:00:00Z' }],
  }));
  render(
    <PreSiteDistributionPanel
      requestId={REQUEST_ID}
      requestNumber="1002379"
      sourceArtifact={{ artifactId: ARTIFACT_ID }}
    />,
  );
  fireEvent.click(await screen.findByText(/Email history/));
  await screen.findByText(preparedAttempt().subject);
  expect(screen.queryByTestId('stale-inputs-acknowledged')).not.toBeInTheDocument();
});
