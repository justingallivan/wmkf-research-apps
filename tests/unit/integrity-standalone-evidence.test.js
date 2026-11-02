/** @jest-environment jsdom */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TextDecoder, TextEncoder } from 'util';
import IntegrityScreen from '../../pages/integrity-screener';

const mockPdfCalls = [];
jest.mock('../../shared/components/Layout', () => ({
  __esModule: true, default: ({ children }) => <main>{children}</main>,
  PageHeader: () => null, Card: ({ children }) => <section>{children}</section>,
  Button: ({ children, variant, ...props }) => <button {...props}>{children}</button>,
}));
jest.mock('../../shared/components/RequireAppAccess', () => ({ __esModule: true, default: ({ children }) => children }));
jest.mock('../../shared/components/HelpButton', () => () => null);
jest.mock('../../shared/components/ErrorAlert', () => () => null);
jest.mock('../../shared/utils/pdf-export', () => ({
  PDFReportBuilder: jest.fn().mockImplementation(() => {
    const builder = { init: async () => {}, build: async () => new Uint8Array() };
    for (const method of ['addTitle', 'addMetadata', 'addDivider', 'addPage', 'addSection', 'addKeyValue', 'addBadge', 'addParagraph', 'addSpace']) {
      builder[method] = (...args) => { mockPdfCalls.push([method, ...args]); return builder; };
    }
    return builder;
  }), downloadPdf: jest.fn(),
}));

const matched = { title: 'A potential namesake paper', confidence: 100, matchingVersion: 2,
  identityStatus: 'unverified', nameEvidence: 'exact_name', matchedAuthor: 'Yuan He', retractionNature: 'Correction', retentionProvenance: {kind:'retained_legacy_record',recordId:'13045',reviewedAt:'2026-11-02',noticeUrl:'https://example.org/retraction'} };
const result = { name: 'Yuan He', matchingVersion: 2, matchCount: 1, hasConcerns: true,
  sources: {
    retraction_watch: { searched: true, matches: [matched], error: null, dataset: {status:'recorded',generation:'7',checksum:'a'.repeat(64),publishedAt:'2026-11-01T00:00:00.000Z',lastCheckedAt:'2026-11-02T00:00:00.000Z'} },
    pubpeer: { searched: true, error: 'PubPeer search returned invalid or unrelated sources', hasConcerns: false },
    news: { searched: true, summary: 'No concerns found.', hasConcerns: false, error: null },
  },
};
const originalFetch = global.fetch;
const OriginalBlob = global.Blob;
const captured = [];
beforeEach(() => {
  mockPdfCalls.length = 0; captured.length = 0;
  global.TextDecoder = TextDecoder;
  global.Blob = class { constructor(chunks) { this.chunks = chunks; } };
  URL.createObjectURL = jest.fn((blob) => { captured.push(blob.chunks.join('')); return 'blob:fixture'; });
  URL.revokeObjectURL = jest.fn();
  jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  let sent = false;
  global.fetch = jest.fn().mockResolvedValue({ body: { getReader: () => ({ read: async () => {
    if (sent) return { done: true };
    sent = true;
    return { done: false, value: new TextEncoder().encode(`data: ${JSON.stringify({ type: 'complete', results: [result], applicantsWithConcerns: 1, totalMatches: 1 })}\n\n`) };
  } }) } });
});
afterEach(() => { global.fetch = originalFetch; global.Blob = OriginalBlob; jest.restoreAllMocks(); });

async function run() {
  render(<IntegrityScreen />);
  fireEvent.change(screen.getByLabelText('Applicant 1 full name'), { target: { value: 'Yuan He' } });
  fireEvent.click(screen.getByRole('button', { name: 'Screen Applicants' }));
  await screen.findByText('A potential namesake paper');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Screen Applicants' })).toBeEnabled());
}

test('standalone UI and all three exports preserve uncertainty and expose source failure', async () => {
  await run();
  expect(screen.getByText('Exact name match · identity unverified')).toBeInTheDocument();
  expect(screen.getByText('Incomplete source')).toBeInTheDocument();
  expect(screen.getByText('Incomplete source').className).not.toContain('bg-green');
  expect(screen.queryByText(/100%/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Export Markdown' }));
  expect(captured[0]).toContain('Dataset 7');
  expect(screen.getByText(/Retained from prior corpus/)).toBeInTheDocument();
  expect(captured[0]).toContain('Retained from prior corpus');
  expect(captured[0]).toContain('Exact name match · identity unverified');
  expect(captured[0]).toContain('Incomplete screen');
  expect(captured[0]).toContain('invalid or unrelated sources');
  expect(captured[0]).not.toContain('100%');
  fireEvent.click(screen.getByRole('button', { name: 'Export JSON' }));
  const json = JSON.parse(captured[1]);
  expect(json.applicants[0].sources.retraction_watch.matches[0].identityStatus).toBe('unverified');
  expect(json.applicants[0].sources.retraction_watch.matches[0].retentionProvenance.recordId).toBe('13045');
  expect(json.evidenceMeaning).toContain('never a probability');
  fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
  await waitFor(() => expect(mockPdfCalls.some((call) => call.includes('Exact name match · identity unverified'))).toBe(true));
  expect(mockPdfCalls.some((call) => call.includes('Incomplete screen'))).toBe(true);
  expect(JSON.stringify(mockPdfCalls)).toContain('invalid or unrelated sources');
  expect(JSON.stringify(mockPdfCalls)).not.toContain('100%');
  expect(JSON.stringify(mockPdfCalls)).toContain('Dataset 7');
  expect(JSON.stringify(mockPdfCalls)).toContain('Retained from prior corpus');
});
