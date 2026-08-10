/**
 * @jest-environment jsdom
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ArtifactVersionHistory from '../../shared/components/workbench/ArtifactVersionHistory';

const REQUEST_ID = '33333333-3333-3333-3333-333333333333';

function mockFetch(body, ok = true, status = 200) {
  global.fetch = jest.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

it('does not fetch version history until staff open the disclosure', () => {
  mockFetch({ status: 'current', versions: [], hasMore: false, limit: 20 });
  render(<ArtifactVersionHistory requestId={REQUEST_ID} />);

  expect(global.fetch).not.toHaveBeenCalled();
});

it('lists versions newest-first with the editor name and a current marker', async () => {
  mockFetch({
    status: 'current',
    hasMore: false,
    limit: 20,
    versions: [
      { versionId: '3.0', isCurrent: true, lastModifiedBy: 'Justin Gallivan', lastModified: '2026-08-03T00:00:00Z' },
      { versionId: '2.0', isCurrent: false, lastModifiedBy: 'Connor Example', lastModified: '2026-08-02T00:00:00Z' },
    ],
  });
  render(<ArtifactVersionHistory requestId={REQUEST_ID} />);
  await userEvent.click(screen.getByRole('button', { name: 'View version history' }));

  await waitFor(() => expect(screen.getByText('Version 3.0')).toBeInTheDocument());
  expect(screen.getByText('current')).toBeInTheDocument();
  // Attribution is the audit surface, not decoration — it must render.
  expect(screen.getByText('Justin Gallivan')).toBeInTheDocument();
  expect(screen.getByText('Connor Example')).toBeInTheDocument();
});

it('says so when the list is truncated instead of implying it is complete', async () => {
  mockFetch({
    status: 'current',
    hasMore: true,
    limit: 20,
    versions: [{ versionId: '3.0', isCurrent: true }],
  });
  render(<ArtifactVersionHistory requestId={REQUEST_ID} />);
  await userEvent.click(screen.getByRole('button', { name: 'View version history' }));

  await waitFor(() => expect(
    screen.getByText(/Showing the 20 most recent versions/),
  ).toBeInTheDocument());
});

it('reports an unavailable history without implying the document is damaged', async () => {
  mockFetch({ status: 'unavailable', versions: [], hasMore: false, limit: 0 });
  render(<ArtifactVersionHistory requestId={REQUEST_ID} />);
  await userEvent.click(screen.getByRole('button', { name: 'View version history' }));

  await waitFor(() => expect(
    screen.getByText(/version history is unavailable right now/i),
  ).toBeInTheDocument());
});

it('surfaces a failed request as an error rather than an empty list', async () => {
  mockFetch({ error: 'Failed to load version history (500)' }, false, 500);
  render(<ArtifactVersionHistory requestId={REQUEST_ID} />);
  await userEvent.click(screen.getByRole('button', { name: 'View version history' }));

  await waitFor(() => expect(
    screen.getByText('Failed to load version history (500)'),
  ).toBeInTheDocument());
});

it('offers no restore control — that half is blocked on administrator evidence', async () => {
  mockFetch({
    status: 'current',
    hasMore: false,
    limit: 20,
    versions: [
      { versionId: '3.0', isCurrent: true },
      { versionId: '2.0', isCurrent: false },
    ],
  });
  render(<ArtifactVersionHistory requestId={REQUEST_ID} />);
  await userEvent.click(screen.getByRole('button', { name: 'View version history' }));

  await waitFor(() => expect(screen.getByText('Version 2.0')).toBeInTheDocument());
  expect(screen.queryByRole('button', { name: /restore/i })).not.toBeInTheDocument();
});
