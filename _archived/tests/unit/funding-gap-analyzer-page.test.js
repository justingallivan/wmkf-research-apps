/** @jest-environment jsdom */
import { TextDecoder, TextEncoder } from 'util';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// jsdom does not provide these; the page decodes the stream with TextDecoder.
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
    <button type="button" onClick={() => onFilesUploaded([{ filename: 'proposal.pdf', url: 'https://blob/p.pdf' }])}>
      Pick file
    </button>
  ),
}));

import FundingGapAnalyzer from '../../pages/funding-gap-analyzer';

function sseResponse(frames) {
  const encoder = new TextEncoder();
  const reads = frames.map((frame) => ({ done: false, value: encoder.encode(`data: ${JSON.stringify(frame)}\n\n`) }));
  return {
    ok: true,
    body: {
      getReader: () => ({
        read: jest.fn(async () => reads.shift() || { done: true, value: undefined }),
      }),
    },
  };
}

async function runAnalysis(frames) {
  global.fetch.mockImplementation(async () => sseResponse(frames));
  render(<FundingGapAnalyzer />);
  fireEvent.click(screen.getByText('Pick file'));
  fireEvent.click(screen.getByText(/Analyze Funding Gaps/));
}

test('shows the server error when the stream ends with an error frame', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  await runAnalysis([
    { progress: 10, message: 'Extracting proposal details' },
    { error: 'Failed to process document', complete: true },
  ]);

  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Failed to process document'));
  expect(screen.queryByText('Analysis complete!')).not.toBeInTheDocument();
  console.error.mockRestore();
});

test('still skips frames that are not valid JSON', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  const encoder = new TextEncoder();
  const reads = [
    { done: false, value: encoder.encode('data: {not json\n\n') },
    { done: false, value: encoder.encode(`data: ${JSON.stringify({ complete: true, results: {}, progress: 100 })}\n\n`) },
  ];
  global.fetch.mockImplementation(async () => ({
    ok: true,
    body: { getReader: () => ({ read: jest.fn(async () => reads.shift() || { done: true }) }) },
  }));
  render(<FundingGapAnalyzer />);
  fireEvent.click(screen.getByText('Pick file'));
  fireEvent.click(screen.getByText(/Analyze Funding Gaps/));

  await waitFor(() => expect(screen.getByText('Funding Gap Analysis Results')).toBeInTheDocument());
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  console.error.mockRestore();
});
