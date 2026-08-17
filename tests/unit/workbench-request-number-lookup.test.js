/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorkbenchDashboard } from '../../pages/workbench';

const push = jest.fn();

jest.mock('next/router', () => ({
  useRouter: () => ({ push }),
}));

jest.mock('../../shared/components/Layout', () => ({
  __esModule: true,
  default: ({ children }) => <div>{children}</div>,
  PageHeader: ({ title }) => <h1>{title}</h1>,
  Card: ({ children }) => <div>{children}</div>,
}));

jest.mock('../../shared/components/RequireAppAccess', () => ({
  __esModule: true,
  default: ({ children }) => children,
}));

jest.mock('../../shared/components/workbench/ReviewerStatusIndicator', () => ({
  __esModule: true,
  default: () => null,
}));

const REQUEST_ID = '11111111-1111-1111-1111-111111111111';

function response({ ok = true, status = 200, body = {} } = {}) {
  return { ok, status, json: async () => body };
}

function cycleResponse() {
  return response({ body: { success: true, cycles: [], defaultCycleCode: null } });
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn().mockResolvedValueOnce(cycleResponse());
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('opens a historical request through the existing request-number resolver', async () => {
  global.fetch.mockResolvedValueOnce(response({
    body: { success: true, requestId: REQUEST_ID, requestNumber: '1002379' },
  }));
  render(<WorkbenchDashboard />);

  fireEvent.change(screen.getByLabelText('Open request by number'), {
    target: { value: '1002379' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Open request' }));

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    '/api/workbench/resolve-request?requestNumber=1002379',
  ));
  await waitFor(() => expect(push).toHaveBeenCalledWith(
    `/workbench/${REQUEST_ID}?n=1002379`,
  ));
  expect(screen.getByText(/without changing their status/i)).toBeInTheDocument();
});

test('keeps an unknown request on the dashboard with the server error', async () => {
  global.fetch.mockResolvedValueOnce(response({
    ok: false,
    status: 404,
    body: { error: 'No request found for number 9999999' },
  }));
  render(<WorkbenchDashboard />);

  fireEvent.change(screen.getByLabelText('Open request by number'), {
    target: { value: '9999999' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Open request' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'No request found for number 9999999',
  );
  expect(push).not.toHaveBeenCalled();
});

test('requires a request number without calling the resolver', async () => {
  render(<WorkbenchDashboard />);

  fireEvent.click(screen.getByRole('button', { name: 'Open request' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('Enter a request number.');
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(push).not.toHaveBeenCalled();
});

test('a slower superseded lookup cannot navigate after a newer request opens', async () => {
  let resolveFirst;
  global.fetch
    .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }))
    .mockResolvedValueOnce(response({
      body: { success: true, requestId: REQUEST_ID, requestNumber: '1002379' },
    }));
  render(<WorkbenchDashboard />);

  const input = screen.getByLabelText('Open request by number');
  fireEvent.change(input, { target: { value: '1002000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Open request' }));
  fireEvent.change(input, { target: { value: '1002379' } });
  fireEvent.click(screen.getByRole('button', { name: 'Open request' }));

  await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
  expect(push).toHaveBeenLastCalledWith(`/workbench/${REQUEST_ID}?n=1002379`);

  await act(async () => {
    resolveFirst(response({
      body: {
        success: true,
        requestId: '22222222-2222-2222-2222-222222222222',
        requestNumber: '1002000',
      },
    }));
  });
  expect(push).toHaveBeenCalledTimes(1);
});
