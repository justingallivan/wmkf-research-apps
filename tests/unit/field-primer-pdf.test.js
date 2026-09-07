/**
 * Unit tests for shared/utils/field-primer-pdf.js — the Field Primer PDF
 * export (S493). Follows tests/unit/review-report-renderers.test.js: spy on
 * PDFReportBuilder's primitives to prove WHAT reached the page, and still
 * build real bytes so a pdf-lib encoding failure surfaces here rather than in
 * the browser.
 *
 * @jest-environment node
 */

import { TextDecoder as NodeTextDecoder } from 'util';
import { PDFReportBuilder } from '../../shared/utils/pdf-export';
import { generateFieldPrimerPdf, fieldPrimerPdfFilename } from '../../shared/utils/field-primer-pdf';
import { renderPrimerMarkdown } from '../../lib/services/field-primer-service';

afterEach(() => jest.restoreAllMocks());

const META = {
  requestNumber: '1002852',
  title: 'Structural principles of poly(ADP-ribose)',
  institution: 'Johns Hopkins University',
  pi: 'Anthony Leung',
};

function envelope(primer, over = {}) {
  return {
    schema: 'field-primer/v1',
    generatedAt: '2026-09-07T20:20:00.000Z',
    model: 'claude-sonnet-5',
    runId: 'run-abc',
    primer,
    ...over,
  };
}

const FULL_PRIMER = {
  field_overview: 'ADP-ribosylation biology studies how cells attach and remove ADP-ribose units.',
  subareas: [{ name: 'PAR structural biology', description: 'Polymer conformation' }],
  key_methods: [{ name: 'cryo-EM', description: 'Near-atomic structures' }],
  frontiers: [{ frontier: 'Polymer-length control', why_now: 'New synthesis routes' }],
  communities: [{ name: 'PARP field', description: 'Meets at Keystone' }],
  venues: ['Nature Structural Biology', 'Molecular Cell'],
  experts: [{ name: 'Ada Lovelace', affiliation: 'Cambridge', why_relevant: 'Defined the polymer assay' }],
  proposal_placement: 'The proposal sits in the structural half of the field.',
  caveats: 'Expert names are orienting only.',
};

// Collect every string that reached a text primitive, in call order.
function spyOnBuilder() {
  const calls = [];
  const record = (kind) => (...args) => { calls.push([kind, ...args]); return undefined; };
  jest.spyOn(PDFReportBuilder.prototype, 'addSection').mockImplementation(record('section'));
  jest.spyOn(PDFReportBuilder.prototype, 'addParagraph').mockImplementation(record('paragraph'));
  jest.spyOn(PDFReportBuilder.prototype, 'addBulletList').mockImplementation(record('bullets'));
  jest.spyOn(PDFReportBuilder.prototype, 'addMetadata').mockImplementation(record('meta'));
  jest.spyOn(PDFReportBuilder.prototype, 'addTitle').mockImplementation(record('title'));
  jest.spyOn(PDFReportBuilder.prototype, 'addHighlightBox').mockImplementation(record('highlight'));
  return calls;
}

const sections = (calls) => calls.filter(([k]) => k === 'section').map(([, t]) => t);
const flat = (calls) => JSON.stringify(calls);

describe('generateFieldPrimerPdf', () => {
  test('golden: real PDF bytes, every populated section in the canonical order, request identity in the header', async () => {
    const calls = spyOnBuilder();
    const bytes = await generateFieldPrimerPdf(envelope(FULL_PRIMER), META);

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(new NodeTextDecoder().decode(bytes.slice(0, 4))).toBe('%PDF');
    expect(sections(calls)).toEqual([
      'Overview',
      'Sub-areas',
      'Key methods',
      'Frontiers & why now',
      'Active communities',
      'Notable venues',
      'Field experts (orienting, not vetted)',
      'Where this proposal sits',
    ]);
    expect(calls).toContainEqual(['title', 'Field Primer',
      'Request 1002852  •  Structural principles of poly(ADP-ribose)  •  Johns Hopkins University']);
    expect(calls).toContainEqual(['meta', 'Principal Investigator', 'Anthony Leung']);
    expect(calls).toContainEqual(['meta', 'Model', 'claude-sonnet-5']);
    expect(calls).toContainEqual(['meta', 'Run', 'run-abc']);
    // Caveats render as the highlight box, not a section.
    expect(calls).toContainEqual(['highlight', 'Caveats', 'Expert names are orienting only.']);
  });

  test('the exported file repeats the orientation disclaimer, because a PDF leaves the app', async () => {
    const calls = spyOnBuilder();
    await generateFieldPrimerPdf(envelope(FULL_PRIMER), META);
    const paragraphs = calls.filter(([k]) => k === 'paragraph').map(([, t]) => t);
    expect(paragraphs[0]).toMatch(/Not an evaluation of the proposal, and not vetted reviewer suggestions/);
  });

  test('the grounding legend appears only when an expert actually carries grounding', async () => {
    const without = spyOnBuilder();
    await generateFieldPrimerPdf(envelope(FULL_PRIMER), META);
    expect(flat(without)).not.toMatch(/grounded against OpenAlex/i);
    jest.restoreAllMocks();

    const withGrounding = spyOnBuilder();
    await generateFieldPrimerPdf(envelope({
      ...FULL_PRIMER,
      experts: [{ name: 'Ada Lovelace', grounding: { status: 'confirmed' } }],
    }), META);
    expect(flat(withGrounding)).toMatch(/grounded against OpenAlex/i);
    expect(flat(withGrounding)).toMatch(/NOT proof of identity/);
  });

  test('each grounding status gets its own marker, and an unverified expert gets no metrics or profile links', async () => {
    const calls = spyOnBuilder();
    await generateFieldPrimerPdf(envelope({
      experts: [
        { name: 'Confirmed Person', grounding: { status: 'confirmed', affiliationMatch: true, hIndex: 40, orcid: '0000-0002-1825-0097' } },
        { name: 'Typo Person', grounding: { status: 'corrected', resolvedName: 'Real Person', corroboration: 'topics' } },
        { name: 'Unknown Person', grounding: { status: 'unverified', note: 'no match', hIndex: 99, orcid: '0000-0002-1825-0097' } },
      ],
    }), META);
    const bullets = calls.find(([k]) => k === 'bullets')[1];
    const text = bullets.join('\n');

    expect(text).toMatch(/Confirmed Person \[confirmed, institution match\]/);
    expect(text).toMatch(/likely Real Person, via topics; verify same person/);
    expect(text).toMatch(/Unknown Person \[unverified: no match\]/);
    // Metrics and links are gated to a grounded identity by the shared helper:
    // the unverified expert's h-index and ORCID must not lend it credibility.
    expect(text).toMatch(/h-index 40/);
    expect(text).not.toMatch(/h-index 99/);
    expect(text.match(/ORCID \(https/g)).toHaveLength(1);
  });

  test('non-string model output is coerced, not leaked or thrown: objects, nulls, and non-string venues', async () => {
    const calls = spyOnBuilder();
    const bytes = await generateFieldPrimerPdf(envelope({
      field_overview: { unexpected: 'object' },
      subareas: [null, 'a bare string', { name: 'Real', description: ['array'] }],
      venues: ['Good venue', null, 42, { bad: true }],
      experts: [null, { name: { nested: true } }],
      caveats: ['not', 'a', 'string'],
    }), META);

    expect(new NodeTextDecoder().decode(bytes.slice(0, 4))).toBe('%PDF');
    const dump = flat(calls);
    expect(dump).not.toMatch(/\[object Object\]/);
    expect(dump).not.toMatch(/undefined/);
    // An object overview yields no Overview section rather than a garbage one.
    expect(sections(calls)).not.toContain('Overview');
    // A list keeps only its usable object entries.
    expect(calls.find(([k, heading]) => k === 'section' && heading === 'Sub-areas')).toBeTruthy();
    const subareaBullets = calls.filter(([k]) => k === 'bullets')[0][1];
    expect(subareaBullets).toEqual(['Real']);
    // Venues keep the string and the number, drop null and the object.
    expect(dump).toMatch(/Good venue · 42/);
    // An expert whose name is an object still renders a labelled row.
    expect(dump).toMatch(/Unnamed expert/);
  });

  test('an empty or missing envelope still produces a valid PDF with no content sections', async () => {
    const calls = spyOnBuilder();
    const bytes = await generateFieldPrimerPdf(undefined, {});
    expect(new NodeTextDecoder().decode(bytes.slice(0, 4))).toBe('%PDF');
    expect(sections(calls)).toEqual([]);
    // No subtitle to build from, so the title carries null rather than a stray separator.
    expect(calls).toContainEqual(['title', 'Field Primer', null]);
    // The disclaimer and the export stamp are unconditional.
    expect(flat(calls)).toMatch(/not vetted reviewer suggestions/);
    expect(calls.some(([k, key]) => k === 'meta' && key === 'Exported')).toBe(true);
  });

  test('a malformed generatedAt is shown verbatim rather than as Invalid Date', async () => {
    const calls = spyOnBuilder();
    await generateFieldPrimerPdf(envelope(FULL_PRIMER, { generatedAt: 'not-a-date' }), META);
    expect(calls).toContainEqual(['meta', 'Generated', 'not-a-date']);
    expect(flat(calls)).not.toMatch(/Invalid Date/);
  });
});

// The module header claims this export follows the MARKDOWN renderer's
// headings, not the compact on-screen panel's (those two already disagree with
// each other). Pin it, so the claim is enforced rather than asserted.
test('PDF headings match renderPrimerMarkdown heading-for-heading, with Caveats as the one documented difference', async () => {
  const calls = spyOnBuilder();
  await generateFieldPrimerPdf(envelope(FULL_PRIMER), META);
  const pdfHeadings = sections(calls);

  jest.restoreAllMocks();
  const markdownHeadings = renderPrimerMarkdown(FULL_PRIMER, { title: META.title })
    .split('\n')
    .filter((line) => line.startsWith('## '))
    .map((line) => line.slice(3));

  // Caveats is a highlight box in the PDF (matching the screen's amber
  // callout), so it is the only markdown heading absent from the section list.
  expect([...pdfHeadings, 'Caveats']).toEqual(markdownHeadings);
});

describe('fieldPrimerPdfFilename', () => {
  test('names the file by request number and date, and never emits a path separator', () => {
    const stamp = new Date().toISOString().slice(0, 10);
    expect(fieldPrimerPdfFilename({ requestNumber: '1002852' })).toBe(`field-primer-1002852-${stamp}.pdf`);
    expect(fieldPrimerPdfFilename({})).toBe(`field-primer-${stamp}.pdf`);
    // A hostile or malformed request number cannot escape the filename.
    expect(fieldPrimerPdfFilename({ requestNumber: '../../etc/passwd' })).toBe(`field-primer-etcpasswd-${stamp}.pdf`);
    expect(fieldPrimerPdfFilename({ requestNumber: { nope: true } })).toBe(`field-primer-${stamp}.pdf`);
  });
});
