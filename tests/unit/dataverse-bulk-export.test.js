/**
 * @jest-environment jsdom
 *
 * T5 (client-request-layer Stage 5a, plan §5) per-call-site matrix for
 * pages/dataverse-bulk-export.js ahead of migrating its 2 JSON sites onto
 * requestEnvelope. Both :208 (metadata) and :328 (preview) parse a bare
 * `.json()` BEFORE their `!ok` check, so today ANY malformed body (2xx or
 * non-2xx) throws synchronously and lands in the outer `catch`. Chosen
 * policy: parseError-rethrow at both sites (throw envelope.error.parseError
 * when set), which reproduces this exactly and keeps the matrix
 * byte-identical before and after migration. :364 (run) drives a raw SSE
 * stream past its initial ok-check and stays raw/allowlisted (§2.6) —
 * not covered here.
 *
 * ErrorAlert is mocked to render `message || error` so this file's
 * pre-existing D9 defect (topError passed as `message`, which the real
 * ErrorAlert component does not read) doesn't hide the state under test;
 * the real prop mismatch at :471 is untouched (D9 fix is a separate lane).
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DataverseBulkExport from '../../pages/dataverse-bulk-export';

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
jest.mock('../../shared/components/ErrorAlert', () => ({
  __esModule: true,
  default: ({ message, error }) => ((message || error) ? <p role="alert">{message || error}</p> : null),
}));

function routeFetch(handlers) {
  return jest.fn(async (url, options = {}) => {
    for (const h of handlers) {
      if (String(url).includes(h.match)) return h.respond(options);
    }
    throw new Error(`Unmocked fetch: ${url}`);
  });
}

const OK_METADATA = { ok: true, status: 200, json: async () => ({ statuses: [], programs: [] }) };

describe('dataverse-bulk-export :208 metadata GET (on mount)', () => {
  test('T5(a) 2xx JSON clears loading with no error, as today', async () => {
    global.fetch = routeFetch([{ match: 'metadata', respond: () => OK_METADATA }]);
    render(<DataverseBulkExport />);
    await waitFor(() => expect(screen.queryByText(/Loading the live taxonomy/)).not.toBeInTheDocument());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('T5(b) non-2xx {message} shows the body message verbatim, as today', async () => {
    global.fetch = routeFetch([{ match: 'metadata', respond: () => ({ ok: false, status: 500, json: async () => ({ message: 'Taxonomy service down' }) }) }]);
    render(<DataverseBulkExport />);
    await waitFor(() => expect(screen.getByText('Taxonomy service down')).toBeInTheDocument());
  });

  test('T5(c) network rejection surfaces its own message, as today', async () => {
    global.fetch = jest.fn(async () => { throw new Error('network down'); });
    render(<DataverseBulkExport />);
    await waitFor(() => expect(screen.getByText('network down')).toBeInTheDocument());
  });

  test('T5(d) 2xx malformed body rejects with the native parse error, as today', async () => {
    global.fetch = routeFetch([{ match: 'metadata', respond: () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad-meta-2xx'); } }) }]);
    render(<DataverseBulkExport />);
    await waitFor(() => expect(screen.getByText('bad-meta-2xx')).toBeInTheDocument());
  });

  test('T5(e) non-2xx unparseable body rethrows the native parse error verbatim, as today', async () => {
    global.fetch = routeFetch([{ match: 'metadata', respond: () => ({ ok: false, status: 502, json: async () => { throw new SyntaxError('bad-meta-502'); } }) }]);
    render(<DataverseBulkExport />);
    await waitFor(() => expect(screen.getByText('bad-meta-502')).toBeInTheDocument());
  });
});

describe('dataverse-bulk-export :328 preview POST', () => {
  async function doPreview() {
    render(<DataverseBulkExport />);
    await waitFor(() => expect(screen.queryByText(/Loading the live taxonomy/)).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Preview \(true count/ }));
  }

  test('T5(a) 2xx JSON renders the preview panel, as today', async () => {
    global.fetch = routeFetch([
      { match: 'metadata', respond: () => OK_METADATA },
      { match: 'preview', respond: () => ({ ok: true, status: 200, json: async () => ({ resultToken: 'tok-1', trueTotal: 5 }) }) },
    ]);
    await doPreview();
    await waitFor(() => expect(screen.getByText(/Preview — review before you run/)).toBeInTheDocument());
    const call = global.fetch.mock.calls.find(([u]) => String(u).includes('preview'));
    expect(call[0]).toBe('/api/dataverse-export/preview');
    expect(call[1].method).toBe('POST');
    expect(call[1].headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(call[1].body)).toEqual({ querySpec: expect.objectContaining({ version: 1, filters: [] }) });
  });

  test('T5(b) non-2xx body renders as a structured preview error, as today', async () => {
    global.fetch = routeFetch([
      { match: 'metadata', respond: () => OK_METADATA },
      { match: 'preview', respond: () => ({ ok: false, status: 400, json: async () => ({ error: 'INVALID_QUERYSPEC', message: 'Bad spec' }) }) },
    ]);
    await doPreview();
    await waitFor(() => expect(screen.getByText('Bad spec')).toBeInTheDocument());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('T5(c) network rejection surfaces via the top error banner, as today', async () => {
    global.fetch = routeFetch([
      { match: 'metadata', respond: () => OK_METADATA },
      { match: 'preview', respond: () => { throw new Error('preview network down'); } },
    ]);
    await doPreview();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('preview network down'));
  });

  test('T5(d) 2xx malformed body surfaces via the top error banner with the native message, as today', async () => {
    global.fetch = routeFetch([
      { match: 'metadata', respond: () => OK_METADATA },
      { match: 'preview', respond: () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad-preview-2xx'); } }) },
    ]);
    await doPreview();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('bad-preview-2xx'));
  });

  test('T5(e) non-2xx unparseable body surfaces via the top error banner with the native message (rule ii: distinct code path preserved, not routed into setPreviewError)', async () => {
    global.fetch = routeFetch([
      { match: 'metadata', respond: () => OK_METADATA },
      { match: 'preview', respond: () => ({ ok: false, status: 502, json: async () => { throw new SyntaxError('bad-preview-502'); } }) },
    ]);
    await doPreview();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('bad-preview-502'));
    expect(screen.queryByText(/Preview failed/)).not.toBeInTheDocument();
  });
});
