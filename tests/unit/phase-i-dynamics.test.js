/**
 * @jest-environment jsdom
 *
 * T5 (client-request-layer Stage 5a, plan §5) matrix for
 * pages/phase-i-dynamics.js: :76 lookup-grant POST and :104 summarize POST,
 * ahead of migrating both onto requestEnvelope. Both sites parse the body
 * with a bare `.json()` BEFORE their `!ok` check today, so an unparseable
 * non-2xx body (axis e) throws the raw SyntaxError today (D3 exposure).
 * Parse-error policy chosen for this file: D3-accept (the plan's public
 * default, `preferParseError: false`) — the migrated site surfaces its own
 * status-templated fallback message instead of the raw parser error, same
 * as every other Stage 5a site that didn't have a specific reason to
 * override the default.
 *
 * No test mounted this page before (phase-i-dynamics-summarize-route.test.js
 * tests the API route, not the page).
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PhaseIDynamics from '../../pages/phase-i-dynamics';

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
    <button type="button" onClick={() => onFilesUploaded([{ url: 'https://example.test/f.pdf', pathname: 'f.pdf', access: 'public', filename: 'f.pdf' }])}>
      mock-upload
    </button>
  ),
}));
// D9 (pre-existing, out of scope here): the real ErrorAlert reads `error`,
// this call site passes `message`, so the real component never renders the
// text. Mocked as expertise-finder-batch-cycle.test.js mocks it, so the
// matrix can assert the *state the page computed*.
jest.mock('../../shared/components/ErrorAlert', () => ({
  __esModule: true,
  default: ({ message, error }) => ((message || error) ? <p role="alert">{message || error}</p> : null),
}));

function lookup(number = '1002807') {
  fireEvent.change(screen.getByPlaceholderText('e.g. 1002807'), { target: { value: number } });
  fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
}

describe(':76 lookup-grant POST', () => {
  test('T5(a) 2xx JSON renders the found request', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ found: true, requestId: 'req-1', header: { title: 'A Grant' } }),
    }));
    render(<PhaseIDynamics />);
    lookup();
    expect(await screen.findByText('A Grant')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/api/grant-reporting/lookup-grant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestNumber: '1002807' }),
    });
  });

  test('T5(b) non-2xx {error} throws that message verbatim, as today', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: 'Dynamics is down' }) }));
    render(<PhaseIDynamics />);
    lookup();
    expect(await screen.findByRole('alert')).toHaveTextContent('Dynamics is down');
  });

  test('T5(c) network rejection surfaces its own message, as today', async () => {
    global.fetch = jest.fn(async () => { throw new Error('network down'); });
    render(<PhaseIDynamics />);
    lookup();
    expect(await screen.findByRole('alert')).toHaveTextContent('network down');
  });

  test('T5(d) malformed 2xx body (bare .json()) rejects, surfacing the native parse error, as today', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } }));
    render(<PhaseIDynamics />);
    lookup();
    expect(await screen.findByRole('alert')).toHaveTextContent('Unexpected token <');
  });

  test('T5(e) unparseable non-2xx body (e.g. a 502 HTML page) falls back to the status-templated message (D3-accept)', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 502, json: async () => { throw new SyntaxError('<html>Bad gateway</html>'); } }));
    render(<PhaseIDynamics />);
    lookup();
    expect(await screen.findByRole('alert')).toHaveTextContent('<html>Bad gateway</html>'); // pre-migration: bare .json() parses before the ok check, so the raw SyntaxError surfaces (D3 exposure)
  });
});

describe(':104 summarize POST', () => {
  async function renderReadyToSummarize() {
    global.fetch = jest.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({
        found: true, requestId: 'req-1', header: { title: 'A Grant' },
        documents: { files: [], proposalBestGuess: null },
      }),
    }));
    render(<PhaseIDynamics />);
    lookup();
    await screen.findByText('A Grant');
    fireEvent.click(screen.getByText('mock-upload'));
    await screen.findByText('f.pdf');
  }

  test('T5(a) 2xx JSON stores the result and the exact request body is unchanged', async () => {
    await renderReadyToSummarize();
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ summary: 'Narrative text' }) }));
    fireEvent.click(screen.getByRole('button', { name: /Run summary/ }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledWith('/api/phase-i-dynamics/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestGuid: 'req-1',
        fileRef: { source: 'upload', fileUrl: 'https://example.test/f.pdf', pathname: 'f.pdf', access: 'public', filename: 'f.pdf' },
        summaryLength: 1,
        summaryLevel: 'technical-non-expert',
        overwrite: false,
      }),
    });
  });

  test('T5(f) status 409 with body.conflict surfaces the conflict dialog before the ok check, as today', async () => {
    await renderReadyToSummarize();
    global.fetch = jest.fn(async () => ({
      ok: false, status: 409,
      json: async () => ({ conflict: { existingLength: 40, existingContent: 'old text' } }),
    }));
    fireEvent.click(screen.getByRole('button', { name: /Run summary/ }));
    expect(await screen.findByText('This request already has a summary')).toBeInTheDocument();
  });

  test('T5(b) non-2xx {error, details} throws the combined message, as today', async () => {
    await renderReadyToSummarize();
    global.fetch = jest.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: 'Claude failed', details: 'timeout' }) }));
    fireEvent.click(screen.getByRole('button', { name: /Run summary/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Claude failed: timeout');
  });

  test('T5(e) unparseable non-2xx body (e.g. a 502 HTML page) falls back to the status-templated message (D3-accept)', async () => {
    await renderReadyToSummarize();
    global.fetch = jest.fn(async () => ({ ok: false, status: 502, json: async () => { throw new SyntaxError('<html>Bad gateway</html>'); } }));
    fireEvent.click(screen.getByRole('button', { name: /Run summary/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('<html>Bad gateway</html>'); // pre-migration: bare .json() parses before the ok check, so the raw SyntaxError surfaces (D3 exposure)
  });
});
