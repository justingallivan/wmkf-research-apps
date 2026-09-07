/**
 * Unit tests for shared/utils/field-primer-docx.js — the full-fidelity Field
 * Primer Word export (S493). Follows tests/unit/review-report-renderers.test.js:
 * build the real .docx and unzip `word/document.xml` to assert what actually
 * landed in the file.
 *
 * These tests exist to prove the TWO things this renderer was added for and the
 * PDF cannot do: real inline bold/italic runs, and Unicode that survives (the
 * PDF's base-14 Helvetica turns a Greek letter into '?').
 *
 * @jest-environment node
 */

import JSZip from 'jszip';
import { generateFieldPrimerDocx, fieldPrimerDocxFilename } from '../../shared/utils/field-primer-docx';

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

async function documentXml(...args) {
  const blob = await generateFieldPrimerDocx(...args);
  expect(blob).toBeInstanceOf(Blob);
  expect(blob.size).toBeGreaterThan(0);
  const archive = await JSZip.loadAsync(await blob.arrayBuffer());
  return archive.file('word/document.xml').async('string');
}

// XML-escaped text as it appears inside a w:t element.
const textNodes = (xml) => [...xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]);

// Every run in the document as { text, bold, italic }, read from the run's OWN
// properties. Asserting on a nearby <w:b/> instead would match a neighbouring
// heading's bold and pass even with the run's emphasis removed.
function runs(xml) {
  return [...xml.matchAll(/<w:r>([\s\S]*?)<\/w:r>/g)].map(([, body]) => {
    const props = body.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/);
    const rPr = props ? props[1] : '';
    const text = [...body.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('');
    return { text, bold: /<w:b\/>/.test(rPr), italic: /<w:i\/>/.test(rPr) };
  });
}
const runFor = (xml, text) => runs(xml).find((r) => r.text === text);

describe('generateFieldPrimerDocx', () => {
  test('golden: a real .docx carrying every populated section heading in the canonical order', async () => {
    const xml = await documentXml(envelope(FULL_PRIMER), META);
    const nodes = textNodes(xml);

    // Caveats IS a heading here, unlike the PDF's highlight box, so this
    // renderer matches the markdown contract with no exception.
    const headings = [
      'Overview', 'Sub-areas', 'Key methods', 'Frontiers &amp; why now',
      'Active communities', 'Notable venues', 'Field experts (orienting, not vetted)',
      'Where this proposal sits', 'Caveats',
    ];
    const positions = headings.map((h) => nodes.indexOf(h));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);

    expect(nodes).toContain('Field Primer');
    expect(nodes.join(' ')).toContain('Request 1002852');
    expect(nodes.join(' ')).toContain('Johns Hopkins University');
    expect(nodes.join(' ')).toContain('Model claude-sonnet-5');
  });

  test('THE REASON THIS RENDERER EXISTS: a Greek letter survives, where the PDF would emit a question mark', async () => {
    const xml = await documentXml(envelope({
      field_overview: 'β-sheet stacking in α-synuclein fibrils, measured at ±2 Å.',
      subareas: [{ name: 'α-helix packing', description: 'ΔG of folding' }],
    }), META);

    expect(xml).toContain('β-sheet stacking in α-synuclein fibrils');
    expect(xml).toContain('±2 Å');
    expect(xml).toContain('α-helix packing');
    expect(xml).toContain('ΔG of folding');
    expect(xml).not.toContain('?-sheet');
  });

  test('THE OTHER REASON: the name run is bold while its description run beside it is not, and the disclaimer is italic', async () => {
    const xml = await documentXml(envelope(FULL_PRIMER), META);

    // Emphasis is read from each run's own properties, so this fails if the
    // name's bold is dropped even though headings nearby are still bold.
    expect(runFor(xml, 'PAR structural biology')).toEqual({ text: 'PAR structural biology', bold: true, italic: false });
    expect(runFor(xml, 'Polymer conformation')).toEqual({ text: 'Polymer conformation', bold: false, italic: false });
    expect(runFor(xml, 'Ada Lovelace')?.bold).toBe(true);
    expect(runFor(xml, ' (Cambridge)')?.bold).toBe(false);

    const disclaimer = runs(xml).find((r) => r.text.includes('not vetted reviewer suggestions'));
    expect(disclaimer?.italic).toBe(true);
    expect(disclaimer?.bold).toBe(false);
  });

  test('a grounded expert gets a real clickable hyperlink; an unverified one gets neither link nor metrics', async () => {
    const blob = await generateFieldPrimerDocx(envelope({
      experts: [
        { name: 'Confirmed Person', grounding: { status: 'confirmed', affiliationMatch: true, hIndex: 40, orcid: '0000-0002-1825-0097' } },
        { name: 'Unknown Person', grounding: { status: 'unverified', note: 'no match', hIndex: 99, orcid: '0000-0002-1825-0097' } },
      ],
    }), META);
    const archive = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await archive.file('word/document.xml').async('string');
    const rels = await archive.file('word/_rels/document.xml.rels').async('string');
    const nodes = textNodes(xml).join(' ');

    // The hyperlink target lives in the relationships part, which is what makes
    // it clickable rather than plain text.
    expect(rels).toContain('https://orcid.org/0000-0002-1825-0097');
    expect(rels).toContain('TargetMode="External"');
    expect(xml).toContain('<w:hyperlink');
    expect(nodes).toContain('ORCID');

    // Exactly one expert earns that treatment.
    expect((rels.match(/orcid\.org/g) || []).length).toBe(1);
    expect(nodes).toContain('h-index 40');
    expect(nodes).not.toContain('h-index 99');
    expect(nodes).toContain('confirmed, institution match');
    expect(nodes).toContain('unverified: no match');
  });

  test('non-string model output is coerced, not leaked or thrown', async () => {
    const xml = await documentXml(envelope({
      field_overview: { unexpected: 'object' },
      subareas: [null, 'a bare string', { name: 'Real', description: ['array'] }],
      venues: ['Good venue', null, 42, { bad: true }],
      experts: [null, { name: { nested: true } }],
      caveats: ['not', 'a', 'string'],
    }), META);
    const nodes = textNodes(xml);

    expect(nodes.join(' ')).not.toContain('[object Object]');
    expect(nodes.join(' ')).not.toContain('undefined');
    expect(nodes).not.toContain('Overview');
    expect(nodes).toContain('Real');
    expect(nodes.join(' ')).toContain('Good venue · 42');
    expect(nodes.join(' ')).toContain('Unnamed expert');
    expect(nodes).not.toContain('Caveats');
  });

  test('an empty or missing envelope still produces a valid document with no content headings', async () => {
    const xml = await documentXml(undefined, {});
    const nodes = textNodes(xml);
    expect(nodes).toContain('Field Primer');
    for (const heading of ['Overview', 'Sub-areas', 'Field experts (orienting, not vetted)', 'Caveats']) {
      expect(nodes).not.toContain(heading);
    }
    // The disclaimer and the export stamp are unconditional.
    expect(nodes.join(' ')).toContain('not vetted reviewer suggestions');
    expect(nodes.join(' ')).toContain('Exported ');
  });

  test('a malformed generatedAt is shown verbatim rather than as Invalid Date', async () => {
    const xml = await documentXml(envelope(FULL_PRIMER, { generatedAt: 'not-a-date' }), META);
    const nodes = textNodes(xml).join(' ');
    expect(nodes).toContain('Generated not-a-date');
    expect(nodes).not.toContain('Invalid Date');
  });
});

describe('fieldPrimerDocxFilename', () => {
  test('names the file by request number and date, and never emits a path separator', () => {
    const stamp = new Date().toISOString().slice(0, 10);
    expect(fieldPrimerDocxFilename({ requestNumber: '1002852' })).toBe(`field-primer-1002852-${stamp}.docx`);
    expect(fieldPrimerDocxFilename({})).toBe(`field-primer-${stamp}.docx`);
    expect(fieldPrimerDocxFilename({ requestNumber: '../../etc/passwd' })).toBe(`field-primer-etcpasswd-${stamp}.docx`);
    expect(fieldPrimerDocxFilename({ requestNumber: { nope: true } })).toBe(`field-primer-${stamp}.docx`);
  });
});
