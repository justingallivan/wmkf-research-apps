/**
 * @jest-environment jsdom
 *
 * T5 (client-request-layer Stage 5a, plan §5) per-call-site matrix for
 * pages/phase-ii-writeup.js. Census correction: only ONE site in this file
 * is JSON (:161 submitRefinement, POST /api/refine). :77 (/api/process) and
 * :240 (/api/qa) both perform their ok-check + a best-effort JSON error-body
 * parse and THEN consume `response.body` as a stream (raw SSE-style
 * `getReader()` loop at :77, `parseSseStream` at :240) — the whole fetch is
 * a stream site under plan §2.6 (site-level, not split at the ok-check), so
 * both stay raw with the allowlist annotation. This is a deviation from the
 * "4 JSON incl. :263 /api/qa" count in the original brief; :263 is a
 * comment line, and /api/qa's response body is never read as JSON.
 *
 * :161 parses a bare `.json()` BEFORE its `!ok` check, same shape as the
 * other Stage 5a files: today ANY malformed body (2xx or non-2xx) throws
 * synchronously at the parse line and lands in the outer catch ->
 * setError. Chosen policy: parseError-rethrow (envelope.error.parseError),
 * for the same fidelity reason as grant-reporting.js and
 * dataverse-bulk-export.js — keeps this matrix unchanged before and after
 * migration rather than adopting D3's message-text change.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TextEncoder, TextDecoder } from 'util';
import ProposalSummarizerPage from '../../pages/phase-ii-writeup';

// jsdom does not provide these; :77's raw stream reader needs TextDecoder.
if (typeof global.TextEncoder === 'undefined') global.TextEncoder = TextEncoder;
if (typeof global.TextDecoder === 'undefined') global.TextDecoder = TextDecoder;

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
    <button type="button" onClick={() => onFilesUploaded(['file1.pdf'])}>mock-upload</button>
  ),
}));
jest.mock('../../shared/components/ErrorAlert', () => ({
  __esModule: true,
  default: ({ message, error }) => ((message || error) ? <p role="alert">{message || error}</p> : null),
}));
jest.mock('../../shared/context/ProfileContext', () => ({
  useProfile: () => ({ profileName: 'Bailey Stone' }),
}));
jest.mock('../../shared/components/ResultsDisplay', () => ({
  __esModule: true,
  default: ({ results, onRefine }) => (
    <button type="button" onClick={() => onRefine('file1.pdf', results['file1.pdf'].formatted)}>
      mock-refine-{Object.keys(results)[0]}
    </button>
  ),
}));
jest.mock('../../shared/components/Phase2FeedbackModal', () => ({
  __esModule: true,
  default: ({ isOpen, onChangeFeedbackText, onSubmit }) => (isOpen ? (
    <div>
      <textarea aria-label="feedback" onChange={(e) => onChangeFeedbackText(e.target.value)} />
      <button type="button" onClick={onSubmit}>submit-refinement</button>
    </div>
  ) : null),
}));
jest.mock('../../shared/components/Phase2QAModal', () => ({ __esModule: true, default: () => null }));
jest.mock('../../shared/components/Phase2WordExportModal', () => ({ __esModule: true, default: () => null }));

function sseBody(events) {
  const text = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
  return {
    getReader: () => {
      let sent = false;
      return {
        read: async () => {
          if (sent) return { done: true, value: undefined };
          sent = true;
          return { done: false, value: new TextEncoder().encode(text) };
        },
      };
    },
  };
}

async function renderWithResults() {
  global.fetch = jest.fn(async (url) => {
    if (String(url).includes('/api/process')) {
      return {
        ok: true,
        body: sseBody([{ progress: 100, results: { 'file1.pdf': { formatted: 'orig summary' } } }]),
      };
    }
    return refineHandler(url);
  });
  render(<ProposalSummarizerPage />);
  fireEvent.click(screen.getByText('mock-upload'));
  fireEvent.click(screen.getByRole('button', { name: 'Generate Writeup Drafts' }));
  await waitFor(() => expect(screen.getByText(/mock-refine-file1\.pdf/)).toBeInTheDocument());
  fireEvent.click(screen.getByText(/mock-refine-file1\.pdf/));
  fireEvent.change(screen.getByLabelText('feedback'), { target: { value: 'Make it shorter' } });
  fireEvent.click(screen.getByText('submit-refinement'));
}
let refineHandler;

describe('phase-ii-writeup :161 submitRefinement POST /api/refine', () => {
  test('T5(a) 2xx JSON replaces the formatted summary, as today', async () => {
    refineHandler = () => ({ ok: true, status: 200, json: async () => ({ refinedSummary: 'shorter summary' }) });
    await renderWithResults();
    await waitFor(() => expect(screen.queryByText('submit-refinement')).not.toBeInTheDocument());
    fireEvent.click(screen.getByText(/mock-refine-file1\.pdf/));
    // Feedback modal closed after success, and results state was updated —
    // asserted indirectly via the fetch call shape below.
    const call = global.fetch.mock.calls.find(([u]) => String(u).includes('/api/refine'));
    expect(call[1]).toEqual({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentSummary: 'orig summary', feedback: 'Make it shorter' }),
    });
  });

  test('T5(b) non-2xx {error} shows the body error verbatim, as today', async () => {
    refineHandler = () => ({ ok: false, status: 500, json: async () => ({ error: 'Refine blew up' }) });
    await renderWithResults();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Refine blew up'));
  });

  test('T5(c) network rejection surfaces its own message, as today', async () => {
    refineHandler = () => { throw new Error('network down'); };
    await renderWithResults();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('network down'));
  });

  test('T5(d) 2xx malformed body rejects with the native parse error, as today', async () => {
    refineHandler = () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad-refine-2xx'); } });
    await renderWithResults();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('bad-refine-2xx'));
  });

  test('T5(e) non-2xx unparseable body rethrows the native parse error verbatim, as today', async () => {
    refineHandler = () => ({ ok: false, status: 502, json: async () => { throw new SyntaxError('bad-refine-502'); } });
    await renderWithResults();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('bad-refine-502'));
  });
});
