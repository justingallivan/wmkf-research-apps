/** @jest-environment node */
const JSZip = require('jszip');
const { renderReviewPanelEntryDocuments } = require('../../lib/services/review-panel-documents');
const { REVIEW_PANEL_NOT_ASSESSABLE_REPORT_LINE } = require('../../lib/services/review-panel-questions');

const BASE_REPORT = {
  title: 'Review Panel — R-2026-001',
  institution: 'Fixture University',
  chair: {
    ratingMatrix: { 'seat.claude': 4, 'seat.openai': 3 },
    consensus: ['Strong methods'],
    disagreements: ['Budget realism'],
    keyStrengths: ['Novel approach'],
    keyConcerns: ['Timeline risk'],
    questionsForPI: ['Clarify staffing'],
    resolvableVsFundamental: 'Resolvable',
    panelRecommendation: 'Fund with conditions',
    confidenceNote: 'High confidence',
  },
  seats: [
    { seatKey: 'seat.claude', label: 'Claude reviewer', vendor: 'anthropic', model: 'claude-fable-5-1', answers: { significance: 'Strong.', teamCapacity: { status: 'not_assessable' } } },
    { seatKey: 'seat.openai', label: 'OpenAI reviewer', vendor: 'openai', model: 'gpt-5.6-sol', answers: { significance: 'Adequate.', teamCapacity: { status: 'not_assessable' } } },
  ],
  cost: { totalCents: 12345, unknownCount: 0 },
};

async function docxText(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  return zip.file('word/document.xml').async('string');
}

test('renders DOCX and PDF editions with matching sha256 refs', async () => {
  const result = await renderReviewPanelEntryDocuments(BASE_REPORT);
  expect(Buffer.isBuffer(result.docx)).toBe(true);
  expect(Buffer.isBuffer(result.pdf)).toBe(true);
  expect(result.docxSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(result.pdfSha256).toMatch(/^[a-f0-9]{64}$/);
});

test('the fixed D7 teamCapacity line is present even though the fixture seat answer carries a status object, not text', async () => {
  const result = await renderReviewPanelEntryDocuments(BASE_REPORT);
  const text = await docxText(result.docx);
  expect(text).toContain(REVIEW_PANEL_NOT_ASSESSABLE_REPORT_LINE);
});

test('per-seat vendor and pinned model labels appear in the DOCX', async () => {
  const result = await renderReviewPanelEntryDocuments(BASE_REPORT);
  const text = await docxText(result.docx);
  expect(text).toContain('Claude reviewer');
  expect(text).toContain('claude-fable-5-1');
  expect(text).toContain('OpenAI reviewer');
  expect(text).toContain('gpt-5.6-sol');
});

test('cost section prints a known total when unknownCount is 0', async () => {
  const result = await renderReviewPanelEntryDocuments(BASE_REPORT);
  const text = await docxText(result.docx);
  expect(text).toContain('Cost for this request: $123.45');
  expect(text).not.toContain('withheld');
});

test('cost section withholds the total (and prints no dollar figure) when unknownCount > 0 — proves suppression, not absence, since the fixture has a known total', async () => {
  const report = { ...BASE_REPORT, cost: { totalCents: 12345, unknownCount: 2 } };
  const result = await renderReviewPanelEntryDocuments(report);
  const text = await docxText(result.docx);
  expect(text).toContain('Cost for this request withheld: 2 attempt(s) with unknown outcome.');
  expect(text).not.toContain('$123.45');
});
