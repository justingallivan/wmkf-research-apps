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
    headers: {
      get: () => 'attachment; filename="Phase II Pre-Site Visit Writeup 1002379.docx"',
    },
    blob: async () => new Blob(['docx']),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn(async () => successResponse());
  global.URL.createObjectURL = jest.fn(() => 'blob:pre-site-visit');
  global.URL.revokeObjectURL = jest.fn();
  jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
});

test('downloads a generated Word draft for the current request', async () => {
  render(<PreSiteVisitTab requestId={REQUEST_ID} />);

  expect(screen.getByText(/current published prompt version in Admin controls the Claude model/i))
    .toBeInTheDocument();
  expect(screen.getByText(/does not yet save the Word file in SharePoint/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Generate Word draft' }));

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    '/api/workbench/pre-site-visit',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ requestId: REQUEST_ID }),
      signal: expect.any(AbortSignal),
    }),
  ));
  await screen.findByText(/Downloaded Phase II Pre-Site Visit Writeup 1002379\.docx/);
  expect(global.URL.createObjectURL).toHaveBeenCalled();
  expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:pre-site-visit');
});

test('shows a server error without creating a download', async () => {
  global.fetch.mockResolvedValueOnce({
    ok: false,
    status: 409,
    json: async () => ({ error: 'No usable AI proposal narrative was found.' }),
  });
  render(<PreSiteVisitTab requestId={REQUEST_ID} />);

  fireEvent.click(screen.getByRole('button', { name: 'Generate Word draft' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'No usable AI proposal narrative was found.',
  );
  expect(global.URL.createObjectURL).not.toHaveBeenCalled();
});

test('a late response for a prior request cannot trigger a stale download', async () => {
  let resolveFirst;
  global.fetch.mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }));
  const { rerender } = render(<PreSiteVisitTab requestId={REQUEST_ID} />);

  fireEvent.click(screen.getByRole('button', { name: 'Generate Word draft' }));
  rerender(<PreSiteVisitTab requestId={OTHER_REQUEST_ID} />);
  await act(async () => { resolveFirst(successResponse()); });

  await waitFor(() => expect(screen.getByRole('button', { name: 'Generate Word draft' })).toBeEnabled());
  expect(global.URL.createObjectURL).not.toHaveBeenCalled();
  expect(screen.queryByText(/Downloaded Phase II/)).not.toBeInTheDocument();
});
