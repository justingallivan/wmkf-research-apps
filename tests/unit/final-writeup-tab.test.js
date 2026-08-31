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
    }));
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
