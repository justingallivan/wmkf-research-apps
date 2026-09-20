/**
 * @jest-environment jsdom
 *
 * T5 (client-request-layer Stage 5a, plan §5) matrix for pages/virtual-review-panel.js
 * :1030 providers GET, ahead of migrating it onto requestEnvelope. D1-preserve:
 * the pre-image has no `ok` check — `.then(res => res.json()).then(data => {...})
 * .catch(() => { use defaults })` — so a non-2xx body with a `providers` array is
 * still applied today, and any parse/network failure silently keeps the
 * PROVIDER_INFO defaults. The :1070 review-run POST is an SSE stream
 * (response.body.getReader()) and is out of scope for this file's matrix.
 */
import { render, screen, waitFor } from '@testing-library/react';
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
  default: () => <div />,
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

test('T5(b) non-2xx body with a providers array is still applied, as today (D1-preserve, no ok check)', async () => {
  global.fetch = providersFetch(() => ({
    ok: false, status: 500, json: async () => ({ providers: [{ key: 'openai', model: 'gpt-from-error-body' }] }),
  }));
  render(<VirtualReviewPanel />);
  await waitFor(() => expect(screen.getByText('gpt-from-error-body')).toBeInTheDocument());
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
