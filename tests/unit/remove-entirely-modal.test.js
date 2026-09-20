import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import RemoveEntirelyModal from '../../shared/components/reviewers/RemoveEntirelyModal';

const SUGGESTION_ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      suggestionId: SUGGESTION_ID,
      requestId: '22222222-2222-4222-8222-222222222222',
      requestNumber: 'R-1',
      honorarium: null,
      hasSubmittedReview: true,
      answerRowCount: 2,
      contactId: null,
      contactAssociations: null,
      reviewFile: {
        folder: 'REQ-1/Reviewer_Uploads/Jane',
        filename: 'review.pdf',
        wmkf_reviewsharepointfolder: 'REQ-1/Reviewer_Uploads/Jane',
        wmkf_reviewfilename: 'review.pdf',
      },
      reviewSharePointFolder: 'REQ-1/Reviewer_Uploads/Jane',
      reviewFilename: 'review.pdf',
      reviewFileCleanupPreview: {
        deletionPolicy: 'legacy_primary_filename_only',
        deleteFiles: [{ id: 'sp-1', name: 'review.pdf' }],
        preserveFiles: [{ id: 'sp-2', name: 'older-review.pdf' }],
      },
    }),
  }));
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('discloses submitted-review rows separately from best-effort SharePoint cleanup', async () => {
  render(
    <RemoveEntirelyModal
      candidate={{ suggestionId: SUGGESTION_ID, name: 'Dr Reviewer' }}
      onClose={jest.fn()}
      onRemoved={jest.fn()}
    />,
  );

  expect(await screen.findByText(/Submitted-review Dataverse rows/)).toBeInTheDocument();
  expect(screen.getByText(/best-effort cleanup of uploaded SharePoint file/)).toBeInTheDocument();
  expect(screen.getByText(/SharePoint review pointer recorded for audit:/)).toHaveTextContent(
    'REQ-1/Reviewer_Uploads/Jane / review.pdf',
  );
  expect(screen.getByText(/SharePoint cleanup preview:/)).toHaveTextContent(
    'delete review.pdf; preserve older-review.pdf',
  );
  expect(screen.queryByText(/^Their submitted review$/)).not.toBeInTheDocument();
});

test('keeps removal available while disclosing that Graph cleanup will be skipped', async () => {
  global.fetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({
      suggestionId: SUGGESTION_ID,
      hasSubmittedReview: true,
      answerRowCount: 1,
      contactId: null,
      reviewSharePointFolder: 'REQ-1/Reviewer_Uploads/Jane',
      reviewFilename: 'review.pdf',
      reviewFileCleanupPreview: {
        deletionPolicy: 'skip_on_resolution_failure',
        deleteFiles: [],
        preserveFiles: [],
        error: 'Graph 503',
      },
    }),
  });

  render(
    <RemoveEntirelyModal
      candidate={{ suggestionId: SUGGESTION_ID, name: 'Dr Reviewer' }}
      onClose={jest.fn()}
      onRemoved={jest.fn()}
    />,
  );

  expect(await screen.findByText(/cleanup preview unavailable/)).toHaveTextContent(
    'file cleanup will be skipped and audited',
  );
  expect(screen.getByRole('button', { name: 'Remove entirely' })).toBeEnabled();
});

test('T4 request bytes: the preflight GET uses the exact URL', async () => {
  render(<RemoveEntirelyModal candidate={{ suggestionId: SUGGESTION_ID, name: 'Dr Reviewer' }} onClose={jest.fn()} onRemoved={jest.fn()} />);
  await screen.findByText(/Submitted-review Dataverse rows/);
  expect(global.fetch).toHaveBeenCalledWith(
    `/api/reviewer-finder/my-candidates?mode=removal-preflight&suggestionId=${encodeURIComponent(SUGGESTION_ID)}`,
    expect.objectContaining({ method: 'GET' }),
  );
});

test('T4 axis (b): a non-2xx preflight body surfaces its error verbatim', async () => {
  global.fetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: 'preflight blew up' }) });
  render(<RemoveEntirelyModal candidate={{ suggestionId: SUGGESTION_ID, name: 'Dr Reviewer' }} onClose={jest.fn()} onRemoved={jest.fn()} />);
  expect(await screen.findByText('preflight blew up')).toBeInTheDocument();
});

test('T4 axis (c): a preflight network rejection surfaces its message', async () => {
  global.fetch.mockRejectedValueOnce(new Error('offline'));
  render(<RemoveEntirelyModal candidate={{ suggestionId: SUGGESTION_ID, name: 'Dr Reviewer' }} onClose={jest.fn()} onRemoved={jest.fn()} />);
  expect(await screen.findByText('offline')).toBeInTheDocument();
});

test('T4 axis (e): a non-2xx preflight body that fails to parse falls back to the status message, never silently', async () => {
  global.fetch.mockResolvedValueOnce({ ok: false, status: 502, json: async () => { throw new Error('bad gateway html'); } });
  render(<RemoveEntirelyModal candidate={{ suggestionId: SUGGESTION_ID, name: 'Dr Reviewer' }} onClose={jest.fn()} onRemoved={jest.fn()} />);
  expect(await screen.findByText('Could not load removal preview (502)')).toBeInTheDocument();
});

test('T4: the DELETE sends exact method, headers, and body, and calls onRemoved/onClose on success', async () => {
  const onRemoved = jest.fn();
  const onClose = jest.fn();
  window.confirm = jest.fn(() => true);
  render(<RemoveEntirelyModal candidate={{ suggestionId: SUGGESTION_ID, name: 'Dr Reviewer' }} onClose={onClose} onRemoved={onRemoved} />);
  await screen.findByText(/Submitted-review Dataverse rows/);
  global.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
  fireEvent.click(screen.getByRole('button', { name: 'Remove entirely' }));
  await waitFor(() => expect(onRemoved).toHaveBeenCalledTimes(1));
  expect(global.fetch).toHaveBeenLastCalledWith('/api/reviewer-finder/my-candidates', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ suggestionId: SUGGESTION_ID, mode: 'hard', deleteContact: false }),
  });
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('T4 axis (b, delete): a non-2xx removal body surfaces its error verbatim', async () => {
  window.confirm = jest.fn(() => true);
  render(<RemoveEntirelyModal candidate={{ suggestionId: SUGGESTION_ID, name: 'Dr Reviewer' }} onClose={jest.fn()} onRemoved={jest.fn()} />);
  await screen.findByText(/Submitted-review Dataverse rows/);
  global.fetch.mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ error: 'removal blew up' }) });
  fireEvent.click(screen.getByRole('button', { name: 'Remove entirely' }));
  expect(await screen.findByText('removal blew up')).toBeInTheDocument();
});

test('T4 axis (c, delete): a removal network rejection surfaces its message', async () => {
  window.confirm = jest.fn(() => true);
  render(<RemoveEntirelyModal candidate={{ suggestionId: SUGGESTION_ID, name: 'Dr Reviewer' }} onClose={jest.fn()} onRemoved={jest.fn()} />);
  await screen.findByText(/Submitted-review Dataverse rows/);
  global.fetch.mockRejectedValueOnce(new Error('offline'));
  fireEvent.click(screen.getByRole('button', { name: 'Remove entirely' }));
  expect(await screen.findByText('Network error: offline')).toBeInTheDocument();
});

test('T4 axis (e, delete): a non-2xx removal body that fails to parse falls back to the status message, never silently', async () => {
  window.confirm = jest.fn(() => true);
  render(<RemoveEntirelyModal candidate={{ suggestionId: SUGGESTION_ID, name: 'Dr Reviewer' }} onClose={jest.fn()} onRemoved={jest.fn()} />);
  await screen.findByText(/Submitted-review Dataverse rows/);
  global.fetch.mockResolvedValueOnce({ ok: false, status: 502, json: async () => { throw new Error('bad gateway html'); } });
  fireEvent.click(screen.getByRole('button', { name: 'Remove entirely' }));
  expect(await screen.findByText('Removal failed (502)')).toBeInTheDocument();
});
