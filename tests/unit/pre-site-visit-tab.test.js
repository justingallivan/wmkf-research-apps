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
        operationStatus: 100000001,
        file: {
          name: '1002379 Pre-Site Visit.docx',
          webUrl: 'https://sharepoint.test/pre-site.docx',
        },
      },
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn(async () => successResponse());
});
afterEach(() => {
  jest.restoreAllMocks();
});

test('shows the governed SharePoint Word link for the current request', async () => {
  render(<PreSiteVisitTab requestId={REQUEST_ID} />);

  expect(screen.getByText(/current published prompt version in Admin controls the Claude model/i))
    .toBeInTheDocument();
  expect(screen.getByText(/saved in SharePoint/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Generate Word draft' }));

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    '/api/workbench/pre-site-visit',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ requestId: REQUEST_ID }),
      signal: expect.any(AbortSignal),
    }),
  ));
  const link = await screen.findByRole('link', { name: /Open 1002379 Pre-Site Visit\.docx in Word/i });
  expect(link).toHaveAttribute('href', 'https://sharepoint.test/pre-site.docx');
});

test('shows a server error without creating a Word link', async () => {
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
  expect(screen.queryByRole('link', { name: /Open .* in Word/i })).not.toBeInTheDocument();
});

test('a late response for a prior request cannot publish a stale Word link', async () => {
  let resolveFirst;
  global.fetch.mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }));
  const { rerender } = render(<PreSiteVisitTab requestId={REQUEST_ID} />);

  fireEvent.click(screen.getByRole('button', { name: 'Generate Word draft' }));
  rerender(<PreSiteVisitTab requestId={OTHER_REQUEST_ID} />);
  await act(async () => { resolveFirst(successResponse()); });

  await waitFor(() => expect(screen.getByRole('button', { name: 'Generate Word draft' })).toBeEnabled());
  expect(screen.queryByRole('link', { name: /Open .* in Word/i })).not.toBeInTheDocument();
});
