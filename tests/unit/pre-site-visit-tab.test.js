/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PreSiteVisitTab from '../../shared/components/workbench/PreSiteVisitTab';

jest.mock('../../shared/components/Layout', () => ({
  Card: ({ children }) => <div>{children}</div>,
}));

const REQUEST_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_REQUEST_ID = '33333333-3333-3333-3333-333333333333';

function successResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      artifact: {
        artifactId: '22222222-2222-2222-8222-222222222222',
        operationStatus: 100000001,
        file: {
          name: '1002379 Pre-Site Visit.docx',
          webUrl: 'https://sharepoint.test/pre-site.docx',
        },
      },
    }),
  };
}

function statusResponse({ currentArtifact = null, pendingArtifact = null } = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ success: true, currentArtifact, pendingArtifact }),
  };
}

function readyArtifact() {
  return {
    artifactId: '22222222-2222-2222-8222-222222222222',
    operationStatus: 100000001,
    file: {
      name: '1002379 Pre-Site Visit.docx',
      webUrl: 'https://sharepoint.test/pre-site.docx',
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn(async (_url, options = {}) => (
    options.method === 'POST' ? successResponse() : statusResponse()
  ));
});
afterEach(() => {
  jest.restoreAllMocks();
});

test('shows compact actions and keeps generation details behind help', async () => {
  render(<PreSiteVisitTab requestId={REQUEST_ID} />);

  expect(screen.queryByText(/current published Admin prompt/i)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'About Pre Site Visit Word drafts' }));
  expect(screen.getByText(/current published Admin prompt/i)).toBeInTheDocument();
  expect(screen.getByText(/saved in SharePoint/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Generate Word Draft' }));

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    '/api/workbench/pre-site-visit',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ requestId: REQUEST_ID }),
      signal: expect.any(AbortSignal),
    }),
  ));
  const edit = await screen.findByRole('link', { name: 'Edit' });
  expect(edit).toHaveAttribute('href', 'https://sharepoint.test/pre-site.docx');
  expect(edit).toHaveAttribute('target', '_blank');
  expect(screen.getByRole('link', { name: 'Download' }))
    .toHaveAttribute('href', 'https://sharepoint.test/pre-site.docx?download=1');
  expect(screen.getByRole('button', { name: 'Regenerate Word Draft' })).toBeEnabled();
  expect(screen.getByText('Draft ready · 1002379 Pre-Site Visit.docx')).toBeInTheDocument();
});

test('loads existing Ready actions without another generation request', async () => {
  global.fetch.mockResolvedValueOnce(statusResponse({ currentArtifact: readyArtifact() }));
  render(<PreSiteVisitTab requestId={REQUEST_ID} />);

  const link = await screen.findByRole('link', { name: 'Edit' });
  expect(link).toHaveAttribute('href', 'https://sharepoint.test/pre-site.docx');
  expect(screen.getByRole('link', { name: 'Download' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Regenerate Word Draft' })).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(global.fetch).toHaveBeenCalledWith(
    `/api/workbench/pre-site-visit?requestId=${REQUEST_ID}`,
    expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) }),
  );
});

test('recovers a Ready Word link after the generation connection is interrupted', async () => {
  let getCount = 0;
  global.fetch.mockImplementation(async (_url, options = {}) => {
    if (options.method === 'POST') throw new TypeError('Failed to fetch');
    getCount += 1;
    return getCount === 1
      ? statusResponse()
      : statusResponse({ currentArtifact: readyArtifact() });
  });
  render(<PreSiteVisitTab requestId={REQUEST_ID} />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

  fireEvent.click(screen.getByRole('button', { name: 'Generate Word Draft' }));

  const link = await screen.findByRole('link', { name: 'Edit' });
  expect(link).toHaveAttribute('href', 'https://sharepoint.test/pre-site.docx');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(global.fetch.mock.calls.filter(([, options = {}]) => options.method === 'POST')).toHaveLength(1);
  expect(global.fetch.mock.calls.filter(([, options = {}]) => options.method === 'GET')).toHaveLength(2);
});

test('shows a server error without creating a Word link', async () => {
  global.fetch.mockImplementation(async (_url, options = {}) => {
    if (options.method !== 'POST') return statusResponse();
    return {
      ok: false,
      status: 409,
      json: async () => ({ error: 'No usable AI proposal narrative was found.' }),
    };
  });
  render(<PreSiteVisitTab requestId={REQUEST_ID} />);

  fireEvent.click(screen.getByRole('button', { name: 'Generate Word Draft' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'No usable AI proposal narrative was found.',
  );
  expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument();
});

test('requires confirmation before regenerating an existing draft', async () => {
  global.fetch.mockResolvedValueOnce(statusResponse({ currentArtifact: readyArtifact() }));
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
  render(<PreSiteVisitTab requestId={REQUEST_ID} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Regenerate Word Draft' }));

  expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Edits in the current Word file'));
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('a late response for a prior request cannot publish a stale Word link', async () => {
  let resolveFirst;
  global.fetch.mockImplementation((_url, options = {}) => {
    if (options.method !== 'POST') return Promise.resolve(statusResponse());
    return new Promise((resolve) => { resolveFirst = resolve; });
  });
  const { rerender } = render(<PreSiteVisitTab requestId={REQUEST_ID} />);

  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: 'Generate Word Draft' }));
  rerender(<PreSiteVisitTab requestId={OTHER_REQUEST_ID} />);
  await act(async () => { resolveFirst(successResponse()); });

  await waitFor(() => expect(screen.getByRole('button', { name: 'Generate Word Draft' })).toBeEnabled());
  expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument();
});
