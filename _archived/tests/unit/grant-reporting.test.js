/**
 * @jest-environment jsdom
 *
 * T5 (client-request-layer Stage 5a, plan §5) per-call-site matrix for
 * pages/grant-reporting.js ahead of migrating its 4 JSON sites onto
 * requestEnvelope. Every site parses a bare `.json()` BEFORE its `!ok`
 * check, so today ANY malformed body (2xx or non-2xx) throws synchronously
 * at the parse line, before the `!ok` branch is ever reached, and lands in
 * the outer `catch` -> `setError(err.message)`. Chosen per-file policy:
 * parseError-rethrow, not D3-accept. Rationale: unlike a site that already
 * separates its ok-check from its parse step, these sites collapse both
 * into one `throw`, so preserving the exact native SyntaxError message (by
 * rethrowing `envelope.error.parseError` when set) costs nothing extra and
 * keeps this T5 matrix byte-identical before and after migration, rather
 * than deliberately accepting a message-text regression the file's own
 * shape doesn't require.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import GrantReportingPage from '../../pages/grant-reporting';

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
  default: () => <div data-testid="uploader" />,
}));
jest.mock('../../shared/components/ErrorAlert', () => ({
  __esModule: true,
  default: ({ message, error }) => ((message || error) ? <p role="alert">{message || error}</p> : null),
}));

function routeFetch(handler) {
  return jest.fn(async (url, options = {}) => handler(String(url), options));
}

async function doLookup() {
  render(<GrantReportingPage />);
  fireEvent.change(screen.getByPlaceholderText('e.g. 1001289'), { target: { value: 'R-100' } });
  fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
}

describe('grant-reporting :141 lookup-grant POST', () => {
  test('T5(a) 2xx JSON populates the lookup state, as today', async () => {
    global.fetch = routeFetch(() => ({
      ok: true, status: 200,
      json: async () => ({ found: true, requestId: 'req-1', header: {}, documents: {} }),
    }));
    await doLookup();
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/grant-reporting/lookup-grant',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestNumber: 'R-100' }),
      }),
    ));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('T5(b) non-2xx {error} shows the body error verbatim, as today', async () => {
    global.fetch = routeFetch(() => ({ ok: false, status: 404, json: async () => ({ error: 'Not found' }) }));
    await doLookup();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Not found'));
  });

  test('T5(c) network rejection surfaces its own message, as today', async () => {
    global.fetch = jest.fn(async () => { throw new Error('network down'); });
    await doLookup();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('network down'));
  });

  test('T5(e) non-2xx unparseable body (502 HTML) rethrows the native parse error verbatim, as today (policy: parseError-rethrow, not D3-accept — see file header)', async () => {
    global.fetch = routeFetch(() => ({
      ok: false, status: 502, json: async () => { throw new SyntaxError('bad-gateway-marker'); },
    }));
    await doLookup();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('bad-gateway-marker'));
  });

  test('T5(d) 2xx malformed body still rejects with the native parse error (strict, unaffected by migration)', async () => {
    global.fetch = routeFetch(() => ({
      ok: true, status: 200, json: async () => { throw new SyntaxError('bad-json-marker'); },
    }));
    await doLookup();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('bad-json-marker'));
  });
});

describe('grant-reporting :169 extract POST (mode: full)', () => {
  const REPORT_KEY = 'RequestArchive3::Year 1::Report.docx';
  async function doExtract() {
    global.fetch = routeFetch((url) => {
      if (url.includes('lookup-grant')) {
        return {
          ok: true, status: 200,
          json: async () => ({
            found: true, requestId: 'req-1', header: {},
            documents: {
              reportBestGuess: REPORT_KEY,
              files: [{ library: 'RequestArchive3', folder: 'Year 1', name: 'Report.docx' }],
            },
          }),
        };
      }
      return extractHandler(url);
    });
    render(<GrantReportingPage />);
    fireEvent.change(screen.getByPlaceholderText('e.g. 1001289'), { target: { value: 'R-100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Extract & Analyze' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Extract & Analyze' }));
  }
  let extractHandler;

  test('T5(b) extract non-2xx {error, details} concatenates the detail suffix, as today', async () => {
    extractHandler = () => ({ ok: false, status: 500, json: async () => ({ error: 'Extraction blew up', details: 'timeout' }) });
    await doExtract();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Extraction blew up: timeout'));
  });

  test('T5(e) extract non-2xx unparseable body rethrows the native parse error verbatim, as today', async () => {
    extractHandler = () => ({ ok: false, status: 503, json: async () => { throw new SyntaxError('bad-extract-marker'); } });
    await doExtract();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('bad-extract-marker'));
  });
});

describe('grant-reporting :208 regenerate POST and :241 regenerate-goals POST', () => {
  const REPORT_KEY = 'RequestArchive3::Year 1::Report.docx';
  const PROPOSAL_KEY = 'RequestArchive3::Year 1::Proposal.docx';

  async function setUpFormData() {
    global.fetch = routeFetch((url) => {
      if (url.includes('lookup-grant')) {
        return {
          ok: true, status: 200,
          json: async () => ({
            found: true, requestId: 'req-1', header: {},
            documents: {
              reportBestGuess: REPORT_KEY,
              proposalBestGuess: PROPOSAL_KEY,
              files: [
                { library: 'RequestArchive3', folder: 'Year 1', name: 'Report.docx' },
                { library: 'RequestArchive3', folder: 'Year 1', name: 'Proposal.docx' },
              ],
            },
          }),
        };
      }
      if (url.includes('extract') && JSON.parse(String(global.fetch.mock.calls.at(-1)[1].body)).mode === 'full') {
        return { ok: true, status: 200, json: async () => ({ header: {}, counts: {}, narratives: { project_impacts: 'orig' }, goalsAssessment: { summary: 'orig-goals' } }) };
      }
      return regenHandler(url);
    });
    render(<GrantReportingPage />);
    fireEvent.change(screen.getByPlaceholderText('e.g. 1001289'), { target: { value: 'R-100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Extract & Analyze' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Extract & Analyze' }));
    await waitFor(() => expect(screen.getByText('Project Impacts')).toBeInTheDocument());
  }
  let regenHandler;

  test('T5(b) regenerate non-2xx {error, details} concatenates the detail suffix, as today', async () => {
    regenHandler = () => ({ ok: false, status: 500, json: async () => ({ error: 'Regen blew up', details: 'timeout' }) });
    await setUpFormData();
    fireEvent.click(screen.getAllByTitle('Regenerate this field')[0]);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Regen blew up: timeout'));
  });

  test('T5(b) regenerate-goals non-2xx {error} shows the body error verbatim, as today', async () => {
    regenHandler = () => ({ ok: false, status: 500, json: async () => ({ error: 'Goals regen blew up' }) });
    await setUpFormData();
    fireEvent.click(screen.getByRole('button', { name: /Regenerate all goals/ }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Goals regen blew up'));
  });
});
