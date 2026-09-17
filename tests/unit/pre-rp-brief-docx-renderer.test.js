/**
 * Pre-Research Presentation Brief renderer + fingerprint.
 * docs/plans/PRE_RESEARCH_PRESENTATION_BRIEF_PLAN_2026-09-16.md §5 slice 2.
 */
import fs from 'fs/promises';
import JSZip from 'jszip';
import {
  briefInputFingerprint,
  canonicalBriefInputState,
  defaultPreRpBriefTemplatePath,
  renderBrief,
  REQUEST_FINGERPRINT_FIELDS,
  REVIEW_FINGERPRINT_FIELDS,
} from '../../lib/services/pre-rp-brief/docx-renderer';

const DV_TOKENS = Object.freeze({
  institutionName: '[[DV:InstitutionName]]',
  projectTitle: '[[DV:ProjectTitle]]',
  principalInvestigator: '[[DV:PrincipalInvestigator]]',
  programDirector: '[[DV:ProgramDirector]]',
});
const ABSTRACT_TOKEN = '[[DV:Abstract]]';
const REFEREE_TOKEN = '[[STAFF:RefereeSentences]]';

/**
 * Build a minimal, valid-enough OOXML template package for renderer
 * unit tests, independent of the tracked template file. Each DV/abstract
 * token gets its own paragraph with a single run, except
 * `projectTitleRuns`, which lets a test split that token's text node
 * across several runs in the same paragraph (finding 5a).
 *
 * `headerPart` and `headerReference` are independent (Round-2 finding 3):
 * `headerPart` emits the `word/header1.xml` part (the parts guard fires on
 * this alone), while `headerReference` emits only the `<w:headerReference>`
 * element in `sectPr` with no corresponding part, isolating the second,
 * otherwise-unreachable guard in renderBrief.
 */
async function buildMinimalTemplate({
  projectTitleRuns = null,
  headerPart = false,
  headerReference = false,
} = {}) {
  const zip = new JSZip();
  const projectTitleXml = projectTitleRuns
    ? projectTitleRuns.map((text) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`).join('')
    : `<w:r><w:t>${DV_TOKENS.projectTitle}</w:t></w:r>`;
  const sectPr = (headerPart || headerReference)
    ? '<w:sectPr><w:headerReference w:type="default" r:id="rId1"/></w:sectPr>'
    : '<w:sectPr/>';
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
<w:p><w:r><w:t>${DV_TOKENS.institutionName}</w:t></w:r></w:p>
<w:p>${projectTitleXml}</w:p>
<w:p><w:r><w:t>${DV_TOKENS.principalInvestigator}</w:t></w:r></w:p>
<w:p><w:r><w:t>${DV_TOKENS.programDirector}</w:t></w:r></w:p>
<w:p><w:r><w:t>${ABSTRACT_TOKEN}</w:t></w:r></w:p>
<w:p><w:r><w:t>${REFEREE_TOKEN}</w:t></w:r></w:p>
${sectPr}
</w:body>
</w:document>`;
  zip.file('word/document.xml', documentXml);
  if (headerPart) {
    zip.file('word/header1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>');
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

function requestFixture(overrides = {}) {
  return {
    institutionName: 'Applicant University',
    projectTitle: 'A test project',
    principalInvestigator: 'Ada Lovelace',
    programDirector: 'Pat Director',
    abstract: 'This project studies a phenomenon of interest.',
    ...overrides,
  };
}

function reviewer(overrides = {}) {
  return {
    suggestionId: overrides.suggestionId || 'g1',
    name: 'Dr. Submitted',
    reviewReceivedAt: '2026-06-20T00:00:00Z',
    reviewerOverallAssessment: 5,
    academicRank: 'professor',
    mainInstitution: 'University of Kansas Medical Center',
    reviewerAffiliation: null,
    affiliation: null,
    ...overrides,
  };
}

function envelope({ request = requestFixture(), reviews = [reviewer()] } = {}) {
  return { schemaVersion: 1, artifactType: 'pre-rp-brief', request, reviews };
}

async function wordText(docxBuffer) {
  const zip = await JSZip.loadAsync(docxBuffer);
  const xml = await zip.file('word/document.xml').async('string');
  return Array.from(xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g))
    .map((m) => m[1]
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&'))
    .join('');
}

async function wordXmlParts(docxBuffer) {
  const zip = await JSZip.loadAsync(docxBuffer);
  return Object.keys(zip.files);
}

describe('renderBrief', () => {
  it('fills every token exactly once', async () => {
    const { docx } = await renderBrief(envelope());
    const text = await wordText(docx);
    expect(text).toContain('Applicant University');
    expect(text).toContain('A test project');
    expect(text).toContain('This project studies a phenomenon of interest.');
    expect(text).not.toMatch(/\[\[(?:DV|STAFF):/);
  });

  it('labels the PI and PD by role at fill time without changing the fingerprinted input names', async () => {
    const { docx } = await renderBrief(envelope());
    const text = await wordText(docx);
    expect(text).toContain('PI: Ada Lovelace');
    expect(text).toContain('PD: Pat Director');
    // The prefix is presentation only: the canonical input state (and so the
    // fingerprint) still carries the raw names.
    const state = canonicalBriefInputState(envelope());
    expect(state.request.principalInvestigator).toBe('Ada Lovelace');
    expect(state.request.programDirector).toBe('Pat Director');
  });

  it('produces a package with no header or footer parts', async () => {
    // Discriminating: assert against the SOURCE template first, so this
    // fails if a future template swap reintroduces a header/footer part
    // that the renderer then silently carries through.
    const templateBuffer = await fs.readFile(defaultPreRpBriefTemplatePath());
    const templateParts = await wordXmlParts(templateBuffer);
    expect(templateParts.some((name) => /^word\/(?:header|footer)\d+\.xml$/.test(name))).toBe(false);

    const { docx } = await renderBrief(envelope());
    const parts = await wordXmlParts(docx);
    expect(parts.some((name) => /^word\/(?:header|footer)\d+\.xml$/.test(name))).toBe(false);
    const zip = await JSZip.loadAsync(docx);
    const documentXml = await zip.file('word/document.xml').async('string');
    expect(documentXml).not.toMatch(/<w:(?:header|footer)Reference\b/);
  });

  it('pins the tracked template package to have no SharePoint/Office metadata parts and blanked personal-name fields (Round-2 finding 1)', async () => {
    // Discriminating: this reads the TRACKED template file directly (not a
    // rebuild), so a checked-in regression — e.g. restoring the owner
    // file's original bytes over brief-v1.docx — fails this test even
    // though the build script's own assertions never ran. Asserted on both
    // the template package and the rendered output package, and without
    // depending on the untracked owner file or any personal name literal.
    const templateBuffer = await fs.readFile(defaultPreRpBriefTemplatePath());
    const { docx: renderedBuffer } = await renderBrief(envelope());

    for (const buffer of [templateBuffer, renderedBuffer]) {
      const zip = await JSZip.loadAsync(buffer);
      const partNames = Object.keys(zip.files);
      expect(partNames.some((name) => /^customXml\//.test(name))).toBe(false);
      expect(partNames.includes('docProps/custom.xml')).toBe(false);
      expect(partNames.includes('word/intelligence2.xml')).toBe(false);

      const coreXml = await zip.file('docProps/core.xml').async('string');
      expect(coreXml).toMatch(/<dc:creator><\/dc:creator>/);
      expect(coreXml).toMatch(/<cp:lastModifiedBy><\/cp:lastModifiedBy>/);
      expect(coreXml).not.toMatch(/<cp:lastPrinted>/);
    }
  });

  it('renders one reviewer with the singular lead-in and no Oxford comma', async () => {
    const { docx } = await renderBrief(envelope({
      reviews: [reviewer({ name: 'Jeroen Roelofs', academicRank: 'professor', mainInstitution: 'University of Kansas Medical Center' })],
    }));
    const text = await wordText(docx);
    expect(text).toContain('We received one review with a score of Excellent.');
    expect(text).toContain('The reviewer was Jeroen Roelofs, a professor at University of Kansas Medical Center.');
  });

  it('renders three reviewers with the tally and Oxford-comma roster', async () => {
    const { docx } = await renderBrief(envelope({
      reviews: [
        reviewer({ suggestionId: 'a', name: 'Jeroen Roelofs', reviewerOverallAssessment: 5, academicRank: 'professor', mainInstitution: 'University of Kansas Medical Center' }),
        reviewer({ suggestionId: 'b', name: 'Jonathan Pruneda', reviewerOverallAssessment: 4, academicRank: 'associate professor', mainInstitution: 'Oregon Health & Science University' }),
        reviewer({ suggestionId: 'c', name: 'Wai-Leung Ng', reviewerOverallAssessment: 4, academicRank: 'associate professor', mainInstitution: 'Tufts School of Medicine' }),
      ],
    }));
    const text = await wordText(docx);
    expect(text).toContain('We received three reviews with scores of one Excellent and two Very Good.');
    expect(text).toContain(
      'The reviewers were Jeroen Roelofs, a professor at University of Kansas Medical Center; '
      + 'Jonathan Pruneda, an associate professor at Oregon Health & Science University; '
      + 'and Wai-Leung Ng, an associate professor at Tufts School of Medicine.',
    );
  });

  it('underlines only the reviewer name runs in the referee paragraph', async () => {
    const { docx } = await renderBrief(envelope({
      reviews: [
        reviewer({ suggestionId: 'a', name: 'Jeroen Roelofs', reviewerOverallAssessment: 5 }),
        reviewer({ suggestionId: 'b', name: 'Jonathan Pruneda', reviewerOverallAssessment: 4 }),
      ],
    }));
    const zip = await JSZip.loadAsync(docx);
    const documentXml = await zip.file('word/document.xml').async('string');
    // Discriminating: the underline run must wrap the exact reviewer name,
    // not just appear anywhere in the paragraph.
    expect(documentXml).toMatch(/<w:u w:val="single"\/><\/w:rPr><w:t>Jeroen Roelofs<\/w:t>/);
    expect(documentXml).toMatch(/<w:u w:val="single"\/><\/w:rPr><w:t>Jonathan Pruneda<\/w:t>/);
    // Discriminating: exactly one underline run per reviewer — a regression
    // that underlines the whole paragraph (or every run) would pass the two
    // assertions above but fail this count.
    const refereeParagraph = Array.from(documentXml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g))
      .map((m) => m[0])
      .find((paragraph) => paragraph.includes('We received'));
    expect(refereeParagraph).toBeDefined();
    const underlineCount = (refereeParagraph.match(/<w:u w:val="single"\/>/g) || []).length;
    expect(underlineCount).toBe(2);
    // Discriminating: the plain lead-in text run must NOT be underlined.
    expect(refereeParagraph).not.toMatch(/<w:u w:val="single"\/><\/w:rPr><w:t>We received/);
  });

  it('renders a reviewer without an academic rank as "of Institution"', async () => {
    const { docx } = await renderBrief(envelope({
      reviews: [reviewer({ name: 'No Rank Reviewer', academicRank: null, mainInstitution: 'Institution X' })],
    }));
    const text = await wordText(docx);
    expect(text).toContain('The reviewer was No Rank Reviewer of Institution X.');
    // Discriminating: guard against a regression that always inserts the
    // "a/an <rank> at" clause even when academicRank is absent.
    expect(text).not.toContain('No Rank Reviewer, a');
    expect(text).not.toContain('No Rank Reviewer, an');
  });

  it('flattens an abstract with paragraph breaks into the single Abstract paragraph', async () => {
    const { docx } = await renderBrief(envelope({
      request: requestFixture({ abstract: 'First paragraph of the abstract.\n\nSecond paragraph of the abstract.' }),
    }));
    const text = await wordText(docx);
    expect(text).toContain('First paragraph of the abstract. Second paragraph of the abstract.');
    // Discriminating: guard against a regression that renders the raw
    // newline characters (or drops the second paragraph) instead of a
    // single flattened sentence run.
    expect(text).not.toMatch(/abstract\.\s*\n/);
  });

  it('fails closed on a missing abstract with the named message', async () => {
    await expect(renderBrief(envelope({ request: requestFixture({ abstract: '' }) })))
      .rejects.toThrow('Add the abstract on the Reviews tab first.');
  });

  it('fails closed on a malformed snapshot envelope', async () => {
    await expect(renderBrief({ schemaVersion: 2, artifactType: 'pre-rp-brief', request: requestFixture(), reviews: [] }))
      .rejects.toThrow(/unsupported schemaVersion/);
    await expect(renderBrief({ schemaVersion: 1, artifactType: 'something-else', request: requestFixture(), reviews: [] }))
      .rejects.toThrow(/unexpected artifactType/);
  });

  it.each([
    ['institutionName', 'Institution name'],
    ['projectTitle', 'Project title'],
    ['principalInvestigator', 'Principal investigator'],
    ['programDirector', 'Program director'],
  ])('fails closed on a missing %s with its own named message', async (field, expectedWords) => {
    await expect(renderBrief(envelope({ request: requestFixture({ [field]: '' }) })))
      .rejects.toThrow(new RegExp(expectedWords));
  });

  it('escapes XML-reserved characters in Dataverse and reviewer fields', async () => {
    const { docx } = await renderBrief(envelope({
      request: requestFixture({
        institutionName: 'Tom & Jerry <University> "Research" \'Lab\'',
        projectTitle: 'Cats & Dogs: <A Study>',
      }),
      reviews: [reviewer({ mainInstitution: 'Fish & Chips <Institute>' })],
    }));
    const zip = await JSZip.loadAsync(docx);
    const documentXml = await zip.file('word/document.xml').async('string');
    expect(documentXml).toContain('Tom &amp; Jerry &lt;University&gt; &quot;Research&quot; &apos;Lab&apos;');
    expect(documentXml).toContain('Cats &amp; Dogs: &lt;A Study&gt;');
    expect(documentXml).toContain('Fish &amp; Chips &lt;Institute&gt;');
    // Discriminating: every literal `&` in the raw XML must belong to one of
    // the five predefined entities (or a numeric character reference) — a
    // regression that deletes an encodeXmlText call site would leave a raw
    // `&`, `<`, `>`, `"`, or `'` that this would not catch by itself, so the
    // three toContain assertions above are the ones that actually fail if a
    // call site is removed; this assertion additionally guards against a
    // double-escape bug (e.g. `&amp;amp;`).
    expect(documentXml).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;|#)/);
  });

  it('renders a Dataverse placeholder split across multiple runs in the same paragraph', async () => {
    const templateBuffer = await buildMinimalTemplate({
      projectTitleRuns: ['[[DV:Proj', 'ectTitle', ']]'],
    });
    const { docx } = await renderBrief(envelope(), { templateBuffer });
    const text = await wordText(docx);
    expect(text).toContain('A test project');
    expect(text).not.toMatch(/\[\[(?:DV|STAFF):/);
  });

  it('rejects a template package that still carries a header part', async () => {
    const templateBuffer = await buildMinimalTemplate({ headerPart: true });
    await expect(renderBrief(envelope(), { templateBuffer }))
      .rejects.toThrow(/must not contain header\/footer parts/);
  });

  it('rejects a template whose sectPr still references a header/footer part with no corresponding part (Round-2 finding 3)', async () => {
    // Isolates the second guard in renderBrief: no word/header*.xml part
    // exists, so the parts-presence check cannot fire first, and only the
    // sectPr headerReference/footerReference regex check can reject this.
    const templateBuffer = await buildMinimalTemplate({ headerReference: true, headerPart: false });
    await expect(renderBrief(envelope(), { templateBuffer }))
      .rejects.toThrow(/must not reference a header\/footer part/);
  });
});

describe('briefInputFingerprint', () => {
  it('is stable under reviewer reordering', () => {
    const reviewA = reviewer({ suggestionId: 'a', name: 'Alice' });
    const reviewB = reviewer({ suggestionId: 'b', name: 'Bob' });
    const first = briefInputFingerprint(envelope({ reviews: [reviewA, reviewB] }));
    const second = briefInputFingerprint(envelope({ reviews: [reviewB, reviewA] }));
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when the reviewer name changes', () => {
    const base = briefInputFingerprint(envelope({ reviews: [reviewer({ name: 'Alice' })] }));
    const changed = briefInputFingerprint(envelope({ reviews: [reviewer({ name: 'Alicia' })] }));
    expect(changed).not.toBe(base);
  });

  it('changes when the reviewer academic rank changes', () => {
    const base = briefInputFingerprint(envelope({ reviews: [reviewer({ academicRank: 'professor' })] }));
    const changed = briefInputFingerprint(envelope({ reviews: [reviewer({ academicRank: 'associate professor' })] }));
    expect(changed).not.toBe(base);
  });

  it('changes when the reviewer overall rating changes', () => {
    const base = briefInputFingerprint(envelope({ reviews: [reviewer({ reviewerOverallAssessment: 5 })] }));
    const changed = briefInputFingerprint(envelope({ reviews: [reviewer({ reviewerOverallAssessment: 4 })] }));
    expect(changed).not.toBe(base);
  });

  it('changes when any of the three institution-source fields changes', () => {
    const base = briefInputFingerprint(envelope({ reviews: [reviewer({ mainInstitution: 'Institution A', reviewerAffiliation: null, affiliation: null })] }));
    const changedMain = briefInputFingerprint(envelope({ reviews: [reviewer({ mainInstitution: 'Institution B', reviewerAffiliation: null, affiliation: null })] }));
    const changedReviewer = briefInputFingerprint(envelope({ reviews: [reviewer({ mainInstitution: 'Institution A', reviewerAffiliation: 'Reviewer Affiliation', affiliation: null })] }));
    const changedPerson = briefInputFingerprint(envelope({ reviews: [reviewer({ mainInstitution: 'Institution A', reviewerAffiliation: null, affiliation: 'Person Affiliation' })] }));
    expect(changedMain).not.toBe(base);
    expect(changedReviewer).not.toBe(base);
    expect(changedPerson).not.toBe(base);
  });

  it('changes when the abstract changes', () => {
    const base = briefInputFingerprint(envelope());
    const changed = briefInputFingerprint(envelope({ request: requestFixture({ abstract: 'A different abstract entirely.' }) }));
    expect(changed).not.toBe(base);
  });

  it('fails closed on a malformed envelope', () => {
    expect(() => briefInputFingerprint({ schemaVersion: 1, artifactType: 'pre-rp-brief', request: requestFixture(), reviews: 'not-an-array' }))
      .toThrow(/reviews is not an array/);
  });

  it('pins the exact REQUEST_FINGERPRINT_FIELDS list (Round-2 finding 2)', () => {
    // Discriminating: the perturbation loop below iterates this exported
    // array, so silently dropping a field from it would shrink the loop
    // and leave the suite green. This literal-list assertion fails instead.
    expect([...REQUEST_FINGERPRINT_FIELDS]).toEqual([
      'institutionName',
      'projectTitle',
      'principalInvestigator',
      'programDirector',
      'abstract',
    ]);
  });

  it.each(REQUEST_FINGERPRINT_FIELDS)('moves the digest when request field %s changes', (field) => {
    const base = briefInputFingerprint(envelope());
    const changed = briefInputFingerprint(envelope({
      request: requestFixture({ [field]: `${requestFixture()[field]}-changed` }),
    }));
    expect(changed).not.toBe(base);
  });

  const REVIEW_FIELD_PERTURBATIONS = Object.freeze({
    suggestionId: 'g2',
    reviewReceivedAt: '2026-07-01T00:00:00Z',
    name: 'A Different Name',
    academicRank: 'associate professor',
    reviewerOverallAssessment: 3,
    reviewerAffiliation: 'Some Reviewer Affiliation',
    mainInstitution: 'A Different Institution',
    affiliation: 'Some Personal Affiliation',
  });

  it('pins the exact REVIEW_FINGERPRINT_FIELDS list (Round-2 finding 2)', () => {
    // Discriminating: same rationale as the request-field pin above.
    expect([...REVIEW_FINGERPRINT_FIELDS]).toEqual([
      'suggestionId',
      'reviewReceivedAt',
      'name',
      'academicRank',
      'reviewerOverallAssessment',
      'reviewerAffiliation',
      'mainInstitution',
      'affiliation',
    ]);
  });

  it.each(REVIEW_FINGERPRINT_FIELDS)('moves the digest when review field %s changes', (field) => {
    const base = briefInputFingerprint(envelope());
    const changed = briefInputFingerprint(envelope({
      reviews: [reviewer({ [field]: REVIEW_FIELD_PERTURBATIONS[field] })],
    }));
    expect(changed).not.toBe(base);
  });

  it('does not move the digest when a non-received reviewer is added or renamed', () => {
    const base = briefInputFingerprint(envelope({ reviews: [reviewer()] }));
    const withUnreceived = briefInputFingerprint(envelope({
      reviews: [reviewer(), reviewer({ suggestionId: 'unreceived', name: 'Not Yet Submitted', reviewReceivedAt: null })],
    }));
    expect(withUnreceived).toBe(base);
    const renamedUnreceived = briefInputFingerprint(envelope({
      reviews: [reviewer(), reviewer({ suggestionId: 'unreceived', name: 'A Renamed Non-Reviewer', reviewReceivedAt: null })],
    }));
    expect(renamedUnreceived).toBe(base);
  });

  it('moves the digest when a reviewer flips from not-received to received', () => {
    const base = briefInputFingerprint(envelope({
      reviews: [reviewer(), reviewer({ suggestionId: 'x', name: 'Someone', reviewReceivedAt: null })],
    }));
    const changed = briefInputFingerprint(envelope({
      reviews: [reviewer(), reviewer({ suggestionId: 'x', name: 'Someone', reviewReceivedAt: '2026-08-01T00:00:00Z' })],
    }));
    expect(changed).not.toBe(base);
  });
});
