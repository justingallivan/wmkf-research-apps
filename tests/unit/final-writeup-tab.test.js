/** @jest-environment jsdom */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import FinalWriteupTab from '../../shared/components/workbench/FinalWriteupTab';

jest.mock('../../shared/components/Layout', () => ({
  Card: ({ children }) => <div>{children}</div>,
}));

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_ID = '22222222-2222-4222-8222-222222222222';
const FINAL_ID = '33333333-3333-4333-8333-333333333333';

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function readyStatus(canStart = true) {
  return {
    success: true,
    available: true,
    phase: 'ready',
    canStart,
    sourceArtifactId: SOURCE_ID,
    sourceFile: { name: '1002379 Pre-Site Visit.docx' },
  };
}

function finalArtifact() {
  return {
    artifactId: FINAL_ID,
    sourceArtifactId: SOURCE_ID,
    groupReview: { startedAt: '2026-08-30T19:05:00Z' },
    file: {
      name: '1002379 Pre-Site Visit.docx',
      webUrl: 'https://sharepoint.test/site-visit.docx',
    },
  };
}

function groupReviewStatus(canAdvance = false) {
  return {
    success: true,
    available: true,
    phase: 'group-review',
    canStart: false,
    canAdvance,
    sourceArtifactId: SOURCE_ID,
    artifact: finalArtifact(),
  };
}

function leadershipArtifact() {
  return {
    ...finalArtifact(),
    leadershipReview: {
      startedAt: '2026-09-07T20:00:00Z',
      startedById: '44444444-4444-4444-8444-444444444444',
      startedByName: 'Justin Gallivan',
    },
  };
}

function leadershipReviewStatus() {
  return {
    success: true,
    available: true,
    phase: 'leadership-review',
    canStart: false,
    canAdvance: false,
    sourceArtifactId: SOURCE_ID,
    artifact: leadershipArtifact(),
  };
}

function acknowledgementState(overrides = {}) {
  return {
    success: true,
    available: true,
    finalArtifactId: FINAL_ID,
    mayAcknowledge: true,
    personalState: 'unreviewed',
    acknowledgedAt: null,
    publicationVersionId: '1.0',
    publicationLastModified: '2026-08-31T12:00:00.000Z',
    reviewers: [],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn().mockResolvedValue(response(readyStatus()));
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('presents one governed transition action with concise eligibility guidance', async () => {
  render(<FinalWriteupTab requestId={REQUEST_ID} />);

  expect(await screen.findByRole('heading', { name: 'Group review has not started' })).toBeInTheDocument();
  expect(screen.getByText(/same editable working writeup/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Ready for group review' })).toBeEnabled();
  expect(screen.queryByRole('link', { name: 'Edit working writeup in Word' })).not.toBeInTheDocument();
});

test('hides the governed transition from a staff member who is not authorized', async () => {
  global.fetch.mockResolvedValueOnce(response(readyStatus(false)));
  render(<FinalWriteupTab requestId={REQUEST_ID} />);

  expect(await screen.findByText(/Only the lead Program Director or a superuser/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Ready for group review' })).not.toBeInTheDocument();
});

test('contains keyboard focus inside the confirmation dialog', async () => {
  render(<FinalWriteupTab requestId={REQUEST_ID} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Ready for group review' }));
  const dialog = screen.getByRole('dialog', { name: 'Ready for group review?' });
  const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
  const confirm = within(dialog).getByRole('button', { name: 'Ready for group review' });

  expect(confirm).toHaveFocus();
  fireEvent.keyDown(document, { key: 'Tab' });
  expect(cancel).toHaveFocus();
  fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
  expect(confirm).toHaveFocus();
});

test('confirms the irreversible handoff and then exposes only the separate Word launch', async () => {
  global.fetch
    .mockResolvedValueOnce(response(readyStatus()))
    .mockResolvedValueOnce(response({
      success: true,
      artifact: finalArtifact(),
      reused: false,
      inProgress: false,
    }))
    .mockResolvedValueOnce(response({
      error: 'Review tracking is not ready.',
      code: 'final_writeup_acknowledgement_schema_not_ready',
    }, 503));
  render(<FinalWriteupTab requestId={REQUEST_ID} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Ready for group review' }));
  const dialog = screen.getByRole('dialog', { name: 'Ready for group review?' });
  expect(dialog).toHaveTextContent('Word file stays the same');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Ready for group review' }));

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    '/api/workbench/final-writeup',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ requestId: REQUEST_ID, expectedArtifactId: SOURCE_ID }),
      signal: expect.any(AbortSignal),
    }),
  ));
  const open = await screen.findByRole('link', { name: 'Edit working writeup in Word' });
  expect(open).toHaveAttribute('href', 'https://sharepoint.test/site-visit.docx');
  expect(open).toHaveAttribute('target', '_blank');
  expect(screen.queryByRole('button', { name: 'Ready for group review' })).not.toBeInTheDocument();
});

test('names the Site Visit prerequisite when the initial status load reports no source document', async () => {
  global.fetch.mockReset().mockResolvedValueOnce(response({
    error: 'A Site Visit Word document is required before Final Writeup can start.',
    code: 'final_writeup_source_missing',
  }, 409));
  render(<FinalWriteupTab requestId={REQUEST_ID} />);

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(/Check working-writeup preparation in Staff Deliberations/);
  expect(alert).not.toHaveTextContent(/is required before Final Writeup can start/);
});

test('names the Site Visit prerequisite when the server reports no source document', async () => {
  global.fetch
    .mockResolvedValueOnce(response(readyStatus()))
    .mockResolvedValueOnce(response({
      error: 'A Site Visit Word document is required before Final Writeup can start.',
      code: 'final_writeup_source_missing',
    }, 409));
  render(<FinalWriteupTab requestId={REQUEST_ID} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Ready for group review' }));
  const dialog = screen.getByRole('dialog', { name: 'Ready for group review?' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Ready for group review' }));

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(/Check working-writeup preparation in Staff Deliberations/);
  expect(alert).not.toHaveTextContent(/is required before Final Writeup can start/);
});

test('shows positive reviewer initials without a personal action for the responsible PD', async () => {
  global.fetch
    .mockResolvedValueOnce(response(groupReviewStatus()))
    .mockResolvedValueOnce(response(acknowledgementState({
      mayAcknowledge: false,
      personalState: 'not-applicable',
      reviewers: [{
        reviewerId: '44444444-4444-4444-8444-444444444444',
        name: 'Ada Reviewer',
        initials: 'AR',
        state: 'reviewed',
        acknowledgedAt: '2026-08-31T11:05:00.000Z',
      }],
    })));
  render(<FinalWriteupTab requestId={REQUEST_ID} />);

  expect(await screen.findByRole('heading', { name: 'Group review is in progress' })).toBeInTheDocument();
  expect(await screen.findByLabelText(/Ada Reviewer.*Signed off/i)).toHaveTextContent('AR');
  expect(screen.getByText('Signed off by')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Sign off$/ })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Edit working writeup in Word' })).toHaveAttribute('target', '_blank');
});

test('lets a non-owner record review with only request and current-Final fences', async () => {
  global.fetch
    .mockResolvedValueOnce(response(groupReviewStatus()))
    .mockResolvedValueOnce(response(acknowledgementState()))
    .mockResolvedValueOnce(response(acknowledgementState({
      personalState: 'reviewed',
      acknowledgedAt: '2026-08-31T12:05:00.000Z',
      reviewers: [{
        reviewerId: '44444444-4444-4444-8444-444444444444',
        name: 'Ada Reviewer',
        initials: 'AR',
        state: 'reviewed',
        acknowledgedAt: '2026-08-31T12:05:00.000Z',
      }],
    })));
  render(<FinalWriteupTab requestId={REQUEST_ID} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Sign off' }));

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    '/api/workbench/final-writeup/acknowledgement',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        requestId: REQUEST_ID,
        expectedFinalArtifactId: FINAL_ID,
      }),
      signal: expect.any(AbortSignal),
    }),
  ));
  expect(await screen.findByText('Signed off')).toBeInTheDocument();
  expect(screen.getByText(/You signed off on the current version/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Sign off' })).not.toBeInTheDocument();
});

test('offers an explicit latest-version action when the writeup changed after review', async () => {
  global.fetch
    .mockResolvedValueOnce(response(groupReviewStatus()))
    .mockResolvedValueOnce(response(acknowledgementState({
      personalState: 'updated',
      acknowledgedAt: '2026-08-30T12:05:00.000Z',
      reviewers: [{
        reviewerId: '44444444-4444-4444-8444-444444444444',
        name: 'Ada Reviewer',
        initials: 'AR',
        state: 'updated',
        acknowledgedAt: '2026-08-30T12:05:00.000Z',
      }],
    })));
  render(<FinalWriteupTab requestId={REQUEST_ID} />);

  expect(await screen.findByText('Edited since your sign-off')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Sign off latest version' })).toBeEnabled();
  expect(screen.getByLabelText(/Ada Reviewer.*edited since this sign-off/i)).toBeInTheDocument();
});

test('keeps the Word action available when acknowledgement schema is off', async () => {
  global.fetch
    .mockResolvedValueOnce(response(groupReviewStatus()))
    .mockResolvedValueOnce(response({
      error: 'Review tracking is not ready.',
      code: 'final_writeup_acknowledgement_schema_not_ready',
    }, 503));
  render(<FinalWriteupTab requestId={REQUEST_ID} />);

  expect(await screen.findByRole('link', { name: 'Edit working writeup in Word' })).toBeInTheDocument();
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  expect(screen.queryByText('Signed off by')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('isolates acknowledgement errors and provides a bounded retry', async () => {
  global.fetch
    .mockResolvedValueOnce(response(groupReviewStatus()))
    .mockResolvedValueOnce(response({ error: 'Temporary review service failure.' }, 500))
    .mockResolvedValueOnce(response(acknowledgementState()));
  render(<FinalWriteupTab requestId={REQUEST_ID} />);

  expect(await screen.findByText(/Sign-offs could not be loaded/i)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Edit working writeup in Word' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Try loading sign-offs again' }));
  expect(await screen.findByText('Not signed off yet')).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledTimes(3);
});

test('ignores a late status response after the request changes', async () => {
  let resolveFirst;
  global.fetch
    .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
    .mockResolvedValueOnce(response({
      ...readyStatus(),
      sourceFile: { name: 'New request writeup.docx' },
    }));
  const { rerender } = render(<FinalWriteupTab requestId={REQUEST_ID} />);
  const nextRequestId = '99999999-9999-4999-8999-999999999999';
  rerender(<FinalWriteupTab requestId={nextRequestId} />);

  expect(await screen.findByText('New request writeup.docx')).toBeInTheDocument();
  resolveFirst(response({
    ...readyStatus(),
    sourceFile: { name: 'Old request writeup.docx' },
  }));
  await waitFor(() => expect(screen.queryByText('Old request writeup.docx')).not.toBeInTheDocument());
});

test('shows schema-off state without offering an action', async () => {
  global.fetch.mockResolvedValueOnce(response({
    success: true,
    available: false,
    phase: 'unavailable',
    canStart: false,
    artifact: null,
  }));
  render(<FinalWriteupTab requestId={REQUEST_ID} />);

  expect(await screen.findByRole('heading', { name: 'Final Writeup setup is not active' }))
    .toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Ready for group review' })).not.toBeInTheDocument();
});

describe('leadership review stage', () => {
  test('a leadership-stage writeup still loads review tracking and keeps the Word action', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(response(leadershipReviewStatus()))
      .mockResolvedValueOnce(response(acknowledgementState({
        mayAcknowledge: true,
        reviewers: [{
          reviewerId: '99999999-9999-4999-8999-999999999999',
          name: 'Allison Keller',
          initials: 'AK',
          state: 'reviewed',
          acknowledgedAt: '2026-09-07T21:00:00Z',
        }],
      })));
    render(<FinalWriteupTab requestId={REQUEST_ID} />);

    expect(await screen.findByText('Leadership review')).toBeInTheDocument();
    expect(screen.getByText('Final Writeup is with leadership')).toBeInTheDocument();
    expect(screen.getByText(/Moved to leadership review .* by Justin Gallivan\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit working writeup in Word' })).toHaveAttribute(
      'href',
      'https://sharepoint.test/site-visit.docx',
    );
    // The acknowledgement GET fires for the leadership phase, not only group review.
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    expect(global.fetch.mock.calls[1][0]).toContain('/api/workbench/final-writeup/acknowledgement?requestId=');
    expect(await screen.findByText('Signed off by')).toBeInTheDocument();
    expect(screen.getByLabelText(/Allison Keller/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign off' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send to leadership' })).not.toBeInTheDocument();
  });

  test('offers the leadership handoff to the authorized PD only', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(response(groupReviewStatus(false)))
      .mockResolvedValueOnce(response(acknowledgementState({ mayAcknowledge: false, personalState: 'not-applicable' })));
    const { unmount } = render(<FinalWriteupTab requestId={REQUEST_ID} />);
    expect(await screen.findByText('Group review is in progress')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send to leadership' })).not.toBeInTheDocument();
    unmount();

    global.fetch = jest.fn()
      .mockResolvedValueOnce(response(groupReviewStatus(true)))
      .mockResolvedValueOnce(response(acknowledgementState({ mayAcknowledge: false, personalState: 'not-applicable' })));
    render(<FinalWriteupTab requestId={REQUEST_ID} />);
    expect(await screen.findByRole('button', { name: 'Send to leadership' })).toBeInTheDocument();
  });

  test('confirms the leadership handoff with only request and current-Final fences, then shows the new stage', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(response(groupReviewStatus(true)))
      .mockResolvedValueOnce(response(acknowledgementState({ mayAcknowledge: false, personalState: 'not-applicable' })))
      .mockResolvedValueOnce(response({
        success: true,
        phase: 'leadership-review',
        reused: false,
        artifact: leadershipArtifact(),
      }))
      .mockResolvedValueOnce(response(acknowledgementState({ mayAcknowledge: false, personalState: 'not-applicable' })));
    render(<FinalWriteupTab requestId={REQUEST_ID} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Send to leadership' }));
    const dialog = await screen.findByRole('dialog', { name: 'Send to leadership?' });
    expect(within(dialog).getByText(/appears for the President and CSO/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Nobody is notified by this step/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send to leadership' }));

    expect(await screen.findByText('Leadership review')).toBeInTheDocument();
    const [url, init] = global.fetch.mock.calls[2];
    expect(url).toBe('/api/workbench/final-writeup/leadership-review');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ requestId: REQUEST_ID, expectedFinalArtifactId: FINAL_ID });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send to leadership' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit working writeup in Word' })).toBeInTheDocument();
    // Review tracking reloads for the new stage.
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(4));
    expect(global.fetch.mock.calls[3][0]).toContain('/api/workbench/final-writeup/acknowledgement?requestId=');
  });

  test('surfaces a rejected handoff and leaves the group-review stage in place', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(response(groupReviewStatus(true)))
      .mockResolvedValueOnce(response(acknowledgementState({ mayAcknowledge: false, personalState: 'not-applicable' })))
      .mockResolvedValueOnce(response({
        error: 'The writeup lifecycle changed while leadership review was starting. Reload and retry.',
        code: 'final_writeup_leadership_conflict',
      }, 409));
    render(<FinalWriteupTab requestId={REQUEST_ID} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Send to leadership' }));
    const dialog = await screen.findByRole('dialog', { name: 'Send to leadership?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send to leadership' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Reload and retry/);
    expect(screen.getByText('Group review')).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });
});

// --- Stage 2 T2 contract matrix (client-request-layer migration pins) ---
//
// Pins the visible outcome of each FinalWriteupTab fetch site under network
// rejection, a malformed/empty 2xx body (all five sites are tolerant —
// `.json().catch(() => ({}))` today), and the status-on-success branch in
// start() (202 / body.inProgress). Run green against the UNMIGRATED
// component and again, unchanged, after migration onto
// shared/utils/api-request.js. See
// docs/plans/CLIENT_REQUEST_LAYER_PLAN_2026-09-19.md §5/§6.

function malformed(status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => { throw new SyntaxError('bad json'); } };
}

test('T2 fetchStatus: network rejection surfaces the raw error message', async () => {
  global.fetch = jest.fn().mockRejectedValueOnce(new Error('network down'));
  render(<FinalWriteupTab requestId={REQUEST_ID} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('network down');
});

test('T2 fetchStatus: malformed 2xx body is tolerated as {} (no error, nothing to render)', async () => {
  global.fetch = jest.fn().mockResolvedValueOnce(malformed());
  render(<FinalWriteupTab requestId={REQUEST_ID} />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Ready for group review' })).not.toBeInTheDocument();
});

test('T2 fetchAcknowledgementState: network rejection is isolated to the review-tracking panel', async () => {
  global.fetch = jest.fn()
    .mockResolvedValueOnce(response(groupReviewStatus()))
    .mockRejectedValueOnce(new Error('network down'));
  render(<FinalWriteupTab requestId={REQUEST_ID} />);
  expect(await screen.findByText(/Sign-offs could not be loaded/i)).toBeInTheDocument();
  expect(screen.getByText('network down')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Edit working writeup in Word' })).toBeInTheDocument();
});

test('T2 fetchAcknowledgementState: malformed 2xx body reads as a stale-Final mismatch', async () => {
  global.fetch = jest.fn()
    .mockResolvedValueOnce(response(groupReviewStatus()))
    .mockResolvedValueOnce(malformed());
  render(<FinalWriteupTab requestId={REQUEST_ID} />);
  expect(await screen.findByText(/Sign-offs could not be loaded/i)).toBeInTheDocument();
  expect(screen.getByText(/current Final Writeup changed/i)).toBeInTheDocument();
});

test('T2 start(): network rejection surfaces the raw error message', async () => {
  global.fetch = jest.fn()
    .mockResolvedValueOnce(response(readyStatus()))
    .mockRejectedValueOnce(new Error('network down'));
  render(<FinalWriteupTab requestId={REQUEST_ID} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Ready for group review' }));
  const dialog = screen.getByRole('dialog', { name: 'Ready for group review?' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Ready for group review' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('network down');
});

test('T2 start(): malformed 2xx body is tolerated as {} (no crash, no Edit link)', async () => {
  global.fetch = jest.fn()
    .mockResolvedValueOnce(response(readyStatus()))
    .mockResolvedValueOnce(malformed())
    .mockResolvedValueOnce(response({ error: 'Temporary review service failure.' }, 500));
  render(<FinalWriteupTab requestId={REQUEST_ID} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Ready for group review' }));
  const dialog = screen.getByRole('dialog', { name: 'Ready for group review?' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Ready for group review' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.queryByRole('link', { name: 'Edit working writeup in Word' })).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('T2 start(): a 202 response polls status until the phase leaves the review set', async () => {
  global.fetch = jest.fn()
    .mockResolvedValueOnce(response(readyStatus()))
    .mockResolvedValueOnce(response({ success: true, inProgress: true }, 202))
    .mockResolvedValueOnce(response({ ...readyStatus(), phase: 'starting' }))
    .mockResolvedValueOnce(response(groupReviewStatus()))
    .mockResolvedValueOnce(response(acknowledgementState({ mayAcknowledge: false, personalState: 'not-applicable' })));
  render(<FinalWriteupTab requestId={REQUEST_ID} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Ready for group review' }));
  const dialog = screen.getByRole('dialog', { name: 'Ready for group review?' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Ready for group review' }));
  expect(await screen.findByText(/starting group review/i)).toBeInTheDocument();
  expect(await screen.findByRole('link', { name: 'Edit working writeup in Word' }, { timeout: 5000 })).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledTimes(5);
}, 10000);

test('T2 advance(): network rejection surfaces the raw error message', async () => {
  global.fetch = jest.fn()
    .mockResolvedValueOnce(response(groupReviewStatus(true)))
    .mockResolvedValueOnce(response(acknowledgementState({ mayAcknowledge: false, personalState: 'not-applicable' })))
    .mockRejectedValueOnce(new Error('network down'));
  render(<FinalWriteupTab requestId={REQUEST_ID} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Send to leadership' }));
  const dialog = await screen.findByRole('dialog', { name: 'Send to leadership?' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Send to leadership' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('network down');
});

test('T2 advance(): malformed 2xx body reads as a stale-Final mismatch', async () => {
  global.fetch = jest.fn()
    .mockResolvedValueOnce(response(groupReviewStatus(true)))
    .mockResolvedValueOnce(response(acknowledgementState({ mayAcknowledge: false, personalState: 'not-applicable' })))
    .mockResolvedValueOnce(malformed());
  render(<FinalWriteupTab requestId={REQUEST_ID} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Send to leadership' }));
  const dialog = await screen.findByRole('dialog', { name: 'Send to leadership?' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Send to leadership' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/current Final Writeup changed/i);
  expect(screen.getByText('Group review')).toBeInTheDocument();
});

test('T2 markReviewed(): network rejection is isolated to the review-tracking panel', async () => {
  global.fetch = jest.fn()
    .mockResolvedValueOnce(response(groupReviewStatus()))
    .mockResolvedValueOnce(response(acknowledgementState()))
    .mockRejectedValueOnce(new Error('network down'));
  render(<FinalWriteupTab requestId={REQUEST_ID} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Sign off' }));
  await waitFor(() => expect(screen.getByText('network down')).toBeInTheDocument());
  expect(screen.getByRole('link', { name: 'Edit working writeup in Word' })).toBeInTheDocument();
});

test('T2 markReviewed(): malformed 2xx body reads as a stale-Final mismatch', async () => {
  global.fetch = jest.fn()
    .mockResolvedValueOnce(response(groupReviewStatus()))
    .mockResolvedValueOnce(response(acknowledgementState()))
    .mockResolvedValueOnce(malformed());
  render(<FinalWriteupTab requestId={REQUEST_ID} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Sign off' }));
  await waitFor(() => expect(screen.getByText(/current Final Writeup changed/i)).toBeInTheDocument());
});


test('schedule-blocked lead PD sees a timing explanation rather than a false permission error', async () => {
  global.fetch.mockResolvedValue(response({ ...readyStatus(false), startBlockedReason: 'final_writeup_site_visit_not_ended' }));
  render(<FinalWriteupTab requestId={REQUEST_ID} />);
  expect(await screen.findByText('Group review becomes available after the scheduled presentation ends.')).toBeInTheDocument();
  expect(screen.queryByText('Only the lead Program Director or a superuser can start this stage.')).not.toBeInTheDocument();
});


test('legacy review compatibility is disclosed without disabling an authorized review action', async () => {
  global.fetch.mockResolvedValue(response({ ...readyStatus(true), startCompatibilityReason: 'legacy_review_schedule_unverified' }));
  render(<FinalWriteupTab requestId={REQUEST_ID} />);
  expect(await screen.findByText('This uses the existing completed writeup. Presentation timing has not been verified.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Ready for group review' })).toBeInTheDocument();
});

describe('lead PD sign-off roster (group-review Stage 3)', () => {
  function roster(overrides = {}) {
    return {
      status: 'configured',
      expected: [
        { name: 'Bea Director', state: 'signed', signedAt: '2026-08-31T11:05:00.000Z' },
        { name: 'Cy Director', state: 'signed-edited-since', signedAt: '2026-08-31T11:05:00.000Z' },
        { name: 'Dee Director', state: 'not-yet', signedAt: null },
      ],
      others: [{ name: 'Ada Coordinator', state: 'signed', signedAt: '2026-08-31T11:05:00.000Z' }],
      ...overrides,
    };
  }

  function renderLead(signOffRoster) {
    global.fetch
      .mockResolvedValueOnce(response(groupReviewStatus(true)))
      .mockResolvedValueOnce(response(acknowledgementState({
        mayAcknowledge: false,
        personalState: 'not-applicable',
        signOffRoster,
      })));
    render(<FinalWriteupTab requestId={REQUEST_ID} />);
  }

  async function openLeadershipDialog() {
    await screen.findByLabelText('Sign-offs');
    fireEvent.click(screen.getByRole('button', { name: 'Send to leadership' }));
    return screen.getByRole('dialog', { name: 'Send to leadership?' });
  }

  test('counts signed and edited-since sign-offs and lists other signers separately', async () => {
    renderLead(roster());
    const panel = await screen.findByLabelText('Sign-offs');
    expect(panel).toHaveTextContent('2 of 3 Program Directors signed off.');
    expect(within(panel).getByText('Cy Director').closest('li')).toHaveTextContent('Signed off, edited since');
    expect(within(panel).getByText('Dee Director').closest('li')).toHaveTextContent('Not yet');
    expect(within(panel).getByText('Also signed off')).toBeInTheDocument();
    expect(within(panel).getByText('Ada Coordinator')).toBeInTheDocument();
    expect(screen.queryByText('Signed off by')).not.toBeInTheDocument();
  });

  test('Send to leadership names only the Program Directors who have not signed off', async () => {
    renderLead(roster());
    const dialog = await openLeadershipDialog();
    expect(dialog).toHaveTextContent('1 Program Director hasn’t signed off: Dee Director. You can send anyway.');
    expect(dialog).not.toHaveTextContent('Cy Director');
    expect(within(dialog).getByRole('button', { name: 'Send to leadership' })).toBeEnabled();
  });

  test('Send to leadership says when every Program Director has signed off', async () => {
    renderLead(roster({
      expected: [{ name: 'Bea Director', state: 'signed-edited-since', signedAt: '2026-08-31T11:05:00.000Z' }],
    }));
    const dialog = await openLeadershipDialog();
    expect(dialog).toHaveTextContent('All Program Directors have signed off.');
  });

  test.each([
    ['program-not-configured', /no Program Director list/],
    ['staffing-not-configured', /assignments are not published/],
    ['unavailable', /could not be loaded/],
  ])('%s shows its own note and the dialog makes no sign-off claim', async (status, note) => {
    renderLead(roster({ status, expected: [] }));
    const panel = await screen.findByLabelText('Sign-offs');
    expect(panel).toHaveTextContent(note);
    expect(panel).not.toHaveTextContent(/signed off\.$/);
    expect(panel).not.toHaveTextContent(/\d+ of \d+/);
    const dialog = await openLeadershipDialog();
    expect(dialog).not.toHaveTextContent(/All Program Directors/);
    expect(dialog).not.toHaveTextContent(/hasn’t signed off|haven’t signed off/);
  });

  test('a configured program with no other Program Directors says so instead of claiming everyone signed', async () => {
    renderLead(roster({ expected: [] }));
    const panel = await screen.findByLabelText('Sign-offs');
    expect(panel).toHaveTextContent('No other Program Directors are listed for this grant program.');
    const dialog = await openLeadershipDialog();
    expect(dialog).not.toHaveTextContent(/All Program Directors/);
  });
});

describe('handoff email copy (group-review Stage 4)', () => {
  test.each([
    [true, 'The other Program Directors for this grant program get an email from the lead Program Director with a link to the writeup.', /No email is sent/],
    [false, 'No email is sent. Let colleagues know it is ready.', /are emailed/],
  ])('handoffEmailEnabled=%s: the confirmation states what the server will do', async (enabled, shown, absent) => {
    global.fetch = jest.fn().mockResolvedValue(response({ ...readyStatus(), handoffEmailEnabled: enabled }));
    render(<FinalWriteupTab requestId={REQUEST_ID} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ready for group review' }));
    const dialog = screen.getByRole('dialog', { name: 'Ready for group review?' });
    expect(dialog).toHaveTextContent(shown);
    expect(dialog).not.toHaveTextContent(absent);
  });
});

describe('leadership digest copy (group-review Stage 5)', () => {
  test.each([
    [true, 'Leadership is told in the next daily summary email, sent at midnight.', /Nobody is notified/],
    [false, 'Nobody is notified by this step.', /daily summary email/],
  ])('handoffEmailEnabled=%s: Send to leadership states whether leadership is emailed', async (enabled, shown, absent) => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(response({ ...groupReviewStatus(true), handoffEmailEnabled: enabled }))
      .mockResolvedValueOnce(response(acknowledgementState({ mayAcknowledge: false, personalState: 'not-applicable' })));
    render(<FinalWriteupTab requestId={REQUEST_ID} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Send to leadership' }));
    const dialog = await screen.findByRole('dialog', { name: 'Send to leadership?' });
    expect(dialog).toHaveTextContent(shown);
    expect(dialog).not.toHaveTextContent(absent);
  });
});
