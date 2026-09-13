/** @jest-environment node */
const zlib = require('zlib');
const JSZip = require('jszip');
const { renderReviewPanelEntryDocuments } = require('../../lib/services/review-panel-documents');
const { REVIEW_PANEL_NOT_ASSESSABLE_REPORT_LINE } = require('../../lib/services/review-panel-questions');

// Mirrors the traced production shape (S/2026-09-13 owner report): chair
// ratingMatrix is an object keyed by question key -> string, disagreements is
// an array of { topic, positions: { [seatKey]: string }, significance }, and
// seat answers carry an array field (impactAreas) alongside plain strings.
const QUESTIONS = [
  { key: 'priorWork', label: 'Prior work', type: 'richtext', order: 1 },
  { key: 'riskLevel', label: 'Risk level', type: 'picklist', order: 2 },
  { key: 'riskDetail', label: 'Risk detail', type: 'richtext', order: 3 },
  { key: 'impactAreas', label: 'Impact areas', type: 'multiselect', order: 4 },
  { key: 'foreseenImpacts', label: 'Foreseen impacts', type: 'richtext', order: 5 },
  { key: 'overallAssessment', label: 'Overall assessment', type: 'richtext', order: 6 },
  { key: 'additionalComments', label: 'Additional comments', type: 'richtext', order: 7 },
  { key: 'methodsAppropriate', label: 'Methods appropriate', type: 'picklist', order: 8 },
];

const SEAT_LABELS = { 'seat.claude': 'Claude reviewer', 'seat.openai': 'OpenAI reviewer' };

const BASE_REPORT = {
  title: 'Review Panel — R-2026-001',
  institution: 'Fixture University',
  questions: QUESTIONS,
  seatLabels: SEAT_LABELS,
  chair: {
    ratingMatrix: {
      priorWork: 'Well established track record.',
      riskLevel: 'Low',
      riskDetail: 'No material risks identified.',
      impactAreas: 'Regional water systems and local ecology.',
      foreseenImpacts: 'Improved monitoring capacity.',
      overallAssessment: 'Strong candidate for funding.',
      additionalComments: 'None.',
      methodsAppropriate: 'Yes',
    },
    consensus: ['Strong methods'],
    disagreements: [
      { topic: 'Budget realism', positions: { 'seat.claude': 'Adequate given scope.', 'seat.openai': 'Insufficient for stated timeline.' }, significance: 'Could shift funding tier.' },
    ],
    keyStrengths: ['Novel approach'],
    keyConcerns: ['Timeline risk'],
    questionsForPI: ['Clarify staffing'],
    resolvableVsFundamental: 'Resolvable',
    panelRecommendation: 'Fund with conditions',
    confidenceNote: 'High confidence',
  },
  seats: [
    {
      seatKey: 'seat.claude', label: 'Claude reviewer', vendor: 'anthropic', model: 'claude-fable-5-1',
      answers: {
        priorWork: 'Strong.', riskLevel: 'Low', riskDetail: 'None noted.',
        impactAreas: ['Local ecology', 'Regional water'], foreseenImpacts: 'Positive.',
        overallAssessment: 'Fund.', additionalComments: 'None.', methodsAppropriate: 'Yes',
        teamCapacity: { status: 'not_assessable' },
      },
    },
    {
      seatKey: 'seat.openai', label: 'OpenAI reviewer', vendor: 'openai', model: 'gpt-5.6-sol',
      answers: {
        priorWork: 'Adequate.', riskLevel: 'Moderate', riskDetail: 'Some concerns.',
        impactAreas: ['Regional water'], foreseenImpacts: 'Mixed.',
        overallAssessment: 'Fund with conditions.', additionalComments: 'None.', methodsAppropriate: 'Yes',
        teamCapacity: { status: 'not_assessable' },
      },
    },
  ],
  cost: { totalCents: 12345, unknownCount: 0 },
};

async function docxText(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  return zip.file('word/document.xml').async('string');
}

// pdf-lib writes each page's content stream FlateDecode-compressed and each
// shown string as a hex string literal (`<...> Tj`) since the builder embeds
// standard (non-embedded-subset) fonts — inflate each content stream and
// decode the hex Tj operands directly rather than depending on a full PDF
// text-extraction library (pdf-parse's bundled pdfjs cannot inflate pdf-lib's
// output here).
function pdfText(bytes) {
  const raw = Buffer.from(bytes).toString('latin1');
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match;
  let text = '';
  while ((match = streamRe.exec(raw))) {
    let inflated;
    try { inflated = zlib.inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1'); }
    catch { continue; }
    const tjRe = /<([0-9A-Fa-f]+)>\s*Tj/g;
    let tj;
    while ((tj = tjRe.exec(inflated))) {
      text += Buffer.from(tj[1], 'hex').toString('latin1') + '\n';
    }
  }
  return text;
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

test('a chair consensus/seat answer with WinAnsi-incompatible characters (arrows, comparison operators, em dash, curly quotes, Greek) renders both editions without throwing', async () => {
  const report = {
    ...BASE_REPORT,
    chair: {
      ...BASE_REPORT.chair,
      consensus: ['Funding tier → higher band', 'Risk ≥ threshold — proceed with “conditions”'],
    },
    seats: [
      { ...BASE_REPORT.seats[0], answers: { ...BASE_REPORT.seats[0].answers, significance: 'Effect size α is large; risk ≥ baseline.' } },
      BASE_REPORT.seats[1],
    ],
  };

  const result = await renderReviewPanelEntryDocuments(report);
  expect(Buffer.isBuffer(result.pdf)).toBe(true);
  expect(Buffer.isBuffer(result.docx)).toBe(true);
  const text = await docxText(result.docx);
  expect(text).toContain('Funding tier');
});

describe('rating matrix and disagreements render as labelled text, never raw JSON or [object Object] (regression for the 2026-09-13 production report defect)', () => {
  test('neither PDF nor DOCX ever prints [object Object] or a raw JSON rating-matrix key', async () => {
    const result = await renderReviewPanelEntryDocuments(BASE_REPORT);
    const docx = await docxText(result.docx);
    const pdf = await pdfText(result.pdf);
    for (const text of [docx, pdf]) {
      expect(text).not.toContain('[object Object]');
      expect(text).not.toContain('"priorWork":');
    }
  });

  test('rating matrix renders one labelled block per question, using the question label rather than the raw key', async () => {
    const result = await renderReviewPanelEntryDocuments(BASE_REPORT);
    const docx = await docxText(result.docx);
    expect(docx).toContain('Prior work');
    expect(docx).toContain('Well established track record.');
    expect(docx).toContain('Risk level');
    expect(docx).toContain('Methods appropriate');
  });

  test('rating matrix falls back to a humanised key when a chair field has no matching question label', async () => {
    const report = { ...BASE_REPORT, chair: { ...BASE_REPORT.chair, ratingMatrix: { ...BASE_REPORT.chair.ratingMatrix, unlistedField: 'Some text.' } } };
    const result = await renderReviewPanelEntryDocuments(report);
    const docx = await docxText(result.docx);
    expect(docx).toContain('Unlisted Field');
    expect(docx).toContain('Some text.');
  });

  test('disagreements render the topic, each seat\'s labelled position, and the significance line — never "- [object Object]"', async () => {
    const result = await renderReviewPanelEntryDocuments(BASE_REPORT);
    const docx = await docxText(result.docx);
    expect(docx).not.toContain('[object Object]');
    expect(docx).toContain('Budget realism');
    expect(docx).toContain('Claude reviewer: Adequate given scope.');
    expect(docx).toContain('OpenAI reviewer: Insufficient for stated timeline.');
    expect(docx).toContain('Significance: Could shift funding tier.');
  });

  test('a plain-string disagreement item still renders as a bullet (backward-compatible shape)', async () => {
    const report = { ...BASE_REPORT, chair: { ...BASE_REPORT.chair, disagreements: ['Budget realism'] } };
    const result = await renderReviewPanelEntryDocuments(report);
    const docx = await docxText(result.docx);
    expect(docx).toContain('- Budget realism');
  });

  test('a disagreement position for a seat key with no seatLabels entry falls back to the raw key', async () => {
    const report = {
      ...BASE_REPORT,
      seatLabels: undefined,
      chair: { ...BASE_REPORT.chair, disagreements: [{ topic: 'X', positions: { 'seat.claude': 'A' }, significance: 'Y' }] },
    };
    const result = await renderReviewPanelEntryDocuments(report);
    const docx = await docxText(result.docx);
    expect(docx).toContain('seat.claude: A');
  });

  test('per-seat sections use the same question labels and order as the rating matrix, including the impactAreas array field', async () => {
    const result = await renderReviewPanelEntryDocuments(BASE_REPORT);
    const docx = await docxText(result.docx);
    expect(docx).toContain('Impact areas');
    expect(docx).toContain('- Local ecology');
    expect(docx).toContain('- Regional water');
    // Both the rating matrix and the seat sections use the "Prior work" label, never the raw "priorWork" key.
    expect(docx).not.toContain('priorWork');
  });

  test('the fixed D7 teamCapacity line still renders through the generic renderValue path', async () => {
    const result = await renderReviewPanelEntryDocuments(BASE_REPORT);
    const docx = await docxText(result.docx);
    expect(docx).toContain(REVIEW_PANEL_NOT_ASSESSABLE_REPORT_LINE);
  });

  test('missing questions/seatLabels (older callers) fall back gracefully rather than throwing', async () => {
    const { questions, seatLabels, ...rest } = BASE_REPORT;
    const result = await renderReviewPanelEntryDocuments(rest);
    expect(Buffer.isBuffer(result.docx)).toBe(true);
    expect(Buffer.isBuffer(result.pdf)).toBe(true);
    const docx = await docxText(result.docx);
    expect(docx).toContain('Prior Work'); // humanized from priorWork
    expect(docx).not.toContain('[object Object]');
  });
});

describe('formats option — selective rendering (review-panel-worker.js skips a format already saved on the entry)', () => {
  test('formats: ["pdf"] renders only the PDF, leaving docx/docxSha256 null', async () => {
    const result = await renderReviewPanelEntryDocuments(BASE_REPORT, { formats: ['pdf'] });
    expect(result.docx).toBeNull();
    expect(result.docxSha256).toBeNull();
    expect(Buffer.isBuffer(result.pdf)).toBe(true);
    expect(result.pdfSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  test('formats: ["docx"] renders only the DOCX, leaving pdf/pdfSha256 null', async () => {
    const result = await renderReviewPanelEntryDocuments(BASE_REPORT, { formats: ['docx'] });
    expect(result.pdf).toBeNull();
    expect(result.pdfSha256).toBeNull();
    expect(Buffer.isBuffer(result.docx)).toBe(true);
    expect(result.docxSha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
