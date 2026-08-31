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

function groupReviewStatus() {
  return {
    success: true,
    available: true,
    phase: 'group-review',
    canStart: false,
    sourceArtifactId: SOURCE_ID,
    artifact: finalArtifact(),
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

  expect(await screen.findByRole('heading', { name: 'Ready for group review' })).toBeInTheDocument();
  expect(screen.getByText(/same Word document from Staff Deliberations/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Ready for group review' })).toBeEnabled();
  expect(screen.queryByRole('link', { name: 'Edit writeup' })).not.toBeInTheDocument();
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
  const dialog = screen.getByRole('dialog', { name: 'Start group review?' });
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
  const dialog = screen.getByRole('dialog', { name: 'Start group review?' });
  expect(dialog).toHaveTextContent('SharePoint file stays the same');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Ready for group review' }));

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    '/api/workbench/final-writeup',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ requestId: REQUEST_ID, expectedArtifactId: SOURCE_ID }),
      signal: expect.any(AbortSignal),
    }),
  ));
  const open = await screen.findByRole('link', { name: 'Edit writeup' });
  expect(open).toHaveAttribute('href', 'https://sharepoint.test/site-visit.docx');
  expect(open).toHaveAttribute('target', '_blank');
  expect(screen.queryByRole('button', { name: 'Ready for group review' })).not.toBeInTheDocument();
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

  expect(await screen.findByRole('heading', { name: 'Final Writeup is ready' })).toBeInTheDocument();
  expect(await screen.findByLabelText(/Ada Reviewer.*Reviewed/i)).toHaveTextContent('AR');
  expect(screen.getByText('Reviewed by')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Mark reviewed/i })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Edit writeup' })).toHaveAttribute('target', '_blank');
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

  fireEvent.click(await screen.findByRole('button', { name: 'Mark reviewed' }));

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
  expect(await screen.findByText('Reviewed')).toBeInTheDocument();
  expect(screen.getByText(/You reviewed the current version/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Mark reviewed' })).not.toBeInTheDocument();
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

  expect(await screen.findByText('Updated since your review')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Mark latest version reviewed' })).toBeEnabled();
  expect(screen.getByLabelText(/Ada Reviewer.*changed since this review/i)).toBeInTheDocument();
});

test('keeps the Word action available when acknowledgement schema is off', async () => {
  global.fetch
    .mockResolvedValueOnce(response(groupReviewStatus()))
    .mockResolvedValueOnce(response({
      error: 'Review tracking is not ready.',
      code: 'final_writeup_acknowledgement_schema_not_ready',
    }, 503));
  render(<FinalWriteupTab requestId={REQUEST_ID} />);

  expect(await screen.findByRole('link', { name: 'Edit writeup' })).toBeInTheDocument();
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  expect(screen.queryByText('Reviewed by')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('isolates acknowledgement errors and provides a bounded retry', async () => {
  global.fetch
    .mockResolvedValueOnce(response(groupReviewStatus()))
    .mockResolvedValueOnce(response({ error: 'Temporary review service failure.' }, 500))
    .mockResolvedValueOnce(response(acknowledgementState()));
  render(<FinalWriteupTab requestId={REQUEST_ID} />);

  expect(await screen.findByText(/Review tracking could not be loaded/i)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Edit writeup' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Try review tracking again' }));
  expect(await screen.findByText('Needs review')).toBeInTheDocument();
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
