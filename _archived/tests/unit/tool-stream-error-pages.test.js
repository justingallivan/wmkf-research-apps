/** @jest-environment jsdom */
import { TextDecoder, TextEncoder } from 'util';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// jsdom does not provide these; the pages decode the stream with TextDecoder.
global.TextEncoder = global.TextEncoder || TextEncoder;
global.TextDecoder = global.TextDecoder || TextDecoder;

jest.mock('../../shared/components/Layout', () => ({
  __esModule: true,
  default: ({ children }) => <div>{children}</div>,
  PageHeader: ({ title, children }) => <header><h1>{title}</h1>{children}</header>,
  Card: ({ children }) => <section>{children}</section>,
  Button: ({ children, loading: _loading, ...props }) => <button {...props}>{children}</button>,
}));
jest.mock('../../shared/components/RequireAppAccess', () => ({
  __esModule: true,
  default: ({ children }) => <>{children}</>,
}));
// Render the raw error so the test checks what the page passes to ErrorAlert.
jest.mock('../../shared/components/ErrorAlert', () => ({
  __esModule: true,
  default: ({ error }) => (error ? <div role="alert">{error}</div> : null),
}));
jest.mock('../../shared/components/FileUploaderSimple', () => ({
  __esModule: true,
  default: ({ onFilesUploaded }) => (
    <button type="button" onClick={() => onFilesUploaded([{ filename: 'one.pdf', url: 'https://blob/one.pdf' }])}>
      Pick file
    </button>
  ),
}));
jest.mock('../../shared/utils/pdf-export', () => ({
  PDFReportBuilder: jest.fn(),
  downloadPdf: jest.fn(),
  getRecommendationBadgeType: jest.fn(),
  getRatingBadgeType: jest.fn(),
}));

import LiteratureAnalyzer from '../../pages/literature-analyzer';
import MultiPerspectiveEvaluator from '../../pages/multi-perspective-evaluator';

function streamOf(frames) {
  const encoder = new TextEncoder();
  const reads = frames.map((frame) => ({ done: false, value: encoder.encode(`data: ${JSON.stringify(frame)}\n\n`) }));
  return {
    ok: true,
    body: { getReader: () => ({ read: jest.fn(async () => reads.shift() || { done: true, value: undefined }) }) },
  };
}

const PAGES = [
  ['literature analyzer', LiteratureAnalyzer, /Analyze Papers/, 'Analysis Results'],
  ['multi-perspective evaluator', MultiPerspectiveEvaluator, /Run Multi-Perspective Evaluation/, 'Evaluation Results'],
];

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  console.error.mockRestore();
});

describe.each(PAGES)('%s page', (_name, Page, runLabel, resultsHeading) => {
  async function run(frames) {
    global.fetch.mockImplementation(async () => streamOf(frames));
    render(<Page />);
    fireEvent.click(screen.getByText('Pick file'));
    fireEvent.click(screen.getByText(runLabel));
  }

  test('shows the server error when the stream ends with an error event', async () => {
    await run([
      { progress: 10, message: 'Loading one.pdf...' },
      { event: 'error', message: 'Failed to process document' },
    ]);

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Failed to process document'));
  });

  test('a per-file error event does not end the run', async () => {
    await run([
      { event: 'paper_error', index: 0, filename: 'one.pdf', error: 'Extraction failed' },
      { progress: 100, message: 'Done', results: { papers: [], concepts: [], summary: {} } },
    ]);

    await waitFor(() => expect(screen.getByText(resultsHeading)).toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
