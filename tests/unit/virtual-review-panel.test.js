/**
 * @jest-environment jsdom
 *
 * T5 (client-request-layer Stage 5a, plan §5) matrix for pages/virtual-review-panel.js
 * :1030 providers GET uses requestEnvelope. Non-2xx errors preserve defaults
 * and are visible; malformed 2xx remains tolerant. The :1070 review-run POST is an SSE stream
 * (response.body.getReader()) and is out of scope for this file's matrix.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import VirtualReviewPanel from '../../pages/virtual-review-panel';

jest.mock('../../shared/components/Layout', () => ({
  __esModule: true,
  default: ({ children }) => <div>{children}</div>,
  PageHeader: ({ title }) => <h1>{title}</h1>,
  Card: ({ children }) => <section>{children}</section>,
  Button: ({ children, loading: _loading, ...props }) => <button {...props}>{children}</button>,
}));
jest.mock('../../shared/components/RequireAppAccess', () => ({
  __esModule: true,
  default: ({ children }) => <>{children}</>,
}));
jest.mock('../../shared/components/FileUploaderSimple', () => ({
  __esModule: true,
  default: ({ onFilesUploaded }) => (
    <button type="button" onClick={() => onFilesUploaded([{ url: 'https://example.test/file.pdf', filename: 'file.pdf' }])}>
      mock-upload
    </button>
  ),
}));

function providersFetch(handler) {
  return jest.fn(async () => handler());
}

test('T5(a) 2xx JSON with a providers array overrides the default model labels', async () => {
  global.fetch = providersFetch(() => ({
    ok: true, status: 200, json: async () => ({ providers: [{ key: 'claude', model: 'claude-custom' }] }),
  }));
  render(<VirtualReviewPanel />);
  await waitFor(() => expect(screen.getByText('claude-custom')).toBeInTheDocument());
});

test('T5(b) non-2xx body preserves defaults and shows the error', async () => {
  global.fetch = providersFetch(() => ({
    ok: false, status: 500, json: async () => ({ providers: [{ key: 'openai', model: 'gpt-from-error-body' }] }),
  }));
  render(<VirtualReviewPanel />);
  fireEvent.click(await screen.findByRole('button', { name: 'Show details' }));
  expect(await screen.findByText('Request failed (500)')).toBeInTheDocument();
  expect(screen.getByText('gpt-4o')).toBeInTheDocument();
});

test('T5(c) network rejection keeps the PROVIDER_INFO defaults, as today', async () => {
  global.fetch = jest.fn(async () => { throw new Error('network down'); });
  render(<VirtualReviewPanel />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  expect(screen.getByText('gpt-4o')).toBeInTheDocument();
});

test('T5(d) malformed 2xx body keeps the PROVIDER_INFO defaults, as today (tolerant)', async () => {
  global.fetch = providersFetch(() => ({
    ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); },
  }));
  render(<VirtualReviewPanel />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  expect(screen.getByText('gpt-4o')).toBeInTheDocument();
});

test('T5(e) unparseable non-2xx body (e.g. a 502 HTML page) keeps the PROVIDER_INFO defaults, as today', async () => {
  global.fetch = providersFetch(() => ({
    ok: false, status: 502, json: async () => { throw new SyntaxError('<html>Bad gateway</html>'); },
  }));
  render(<VirtualReviewPanel />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  expect(screen.getByText('gpt-4o')).toBeInTheDocument();
});

test('submit stream errors reach the real ErrorAlert call site', async () => {
  const originalTextDecoder = global.TextDecoder;
  global.TextDecoder = class { decode() { return ''; } };
  global.fetch = jest.fn()
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    })
    .mockResolvedValueOnce({
      body: {
        getReader: () => ({
          read: async () => { throw new Error('stream unavailable'); },
        }),
      },
    });
  render(<VirtualReviewPanel />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: 'mock-upload' }));
  fireEvent.click(screen.getByRole('button', { name: 'Run Virtual Review Panel' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Show details' }));
  expect(await screen.findByText('stream unavailable')).toBeInTheDocument();
  global.TextDecoder = originalTextDecoder;
});
