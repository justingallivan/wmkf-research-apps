import fs from 'fs/promises';
import JSZip from 'jszip';
import {
  defaultPreSiteVisitTemplatePath,
  PRE_SITE_VISIT_TEMPLATE,
  renderPreSiteVisitDocx,
} from '../../lib/services/pre-site-visit/docx-renderer';
import { PROPOSAL_CORE_KEYS } from '../../shared/config/prompts/pre-site-visit-proposal-core';
import { PRE_SITE_VISIT_CONTRACT } from '../../shared/config/requestDocument';

function proposalCoreFixture() {
  const core = Object.fromEntries(PROPOSAL_CORE_KEYS.map((key) => [key, `${key} test content.`]));
  core.personnelOverview = 'personnelOverview test content. Ada Lovelace (PI) and Grace Hopper (co-PI) provide complementary expertise.';
  return core;
}

function documentFieldsFixture() {
  return {
    institutionName: 'Applicant University',
    cityState: 'Atlanta, GA',
    internalProgram: 'Medical Research',
    projectTitle: 'A test project',
    meetingDate: 'December 2026',
    requestedAmount: '$900,000',
    programDirector: 'Pat Director',
    invitedAmount: '$1,000,000',
    totalProjectBudget: '$3,500,000',
    institutionalFundingHistory: 'Applicant University has received 8 awards totaling $9.15 million from WMKF. The most recent grant was awarded in June 2026 to develop chemical tools to restore the function of defective proteins.',
  };
}

function personnelNamesFixture() {
  return ['Ada Lovelace', 'Grace Hopper'];
}

async function wordXml(zip) {
  const names = Object.keys(zip.files).filter((name) => name.startsWith('word/') && name.endsWith('.xml'));
  const xml = (await Promise.all(names.map((name) => zip.file(name)?.async('string')))).filter(Boolean);
  return xml
    .flatMap((part) => Array.from(part.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)))
    .map((match) => match[1]
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&'))
    .join('');
}

function wordTableCells(documentXml) {
  return Array.from(documentXml.matchAll(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g))
    .map((match) => match[0]);
}

function wordTables(documentXml) {
  return Array.from(documentXml.matchAll(/<w:tbl(?:\s[^>]*)?>[\s\S]*?<\/w:tbl>/g))
    .map((match) => match[0]);
}

function wordTableRows(tableXml) {
  return Array.from(tableXml.matchAll(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g))
    .map((match) => match[0]);
}

function wordParagraphs(documentXml) {
  return Array.from(documentXml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g))
    .map((match) => match[0]);
}

function cellContaining(cells, text) {
  const cell = cells.find((candidate) => candidate.includes(text));
  if (!cell) throw new Error(`Could not find Word table cell containing ${text}`);
  return cell;
}

test('fills split-run Dataverse and AI placeholders while retaining the template package', async () => {
  const template = await fs.readFile(defaultPreSiteVisitTemplatePath());
  const original = await JSZip.loadAsync(template);
  const { docx: output } = await renderPreSiteVisitDocx({
    documentFields: documentFieldsFixture(),
    proposalCore: {
      ...proposalCoreFixture(),
      personnelDetails: 'Ada Lovelace (PI) leads modeling; Grace Hopper (co-PI) leads experiments.',
    },
    personnelNames: personnelNamesFixture(),
    templateBuffer: template,
  });
  const rendered = await JSZip.loadAsync(output);
  const xml = await wordXml(rendered);

  expect(Object.keys(rendered.files).sort()).toEqual(Object.keys(original.files).sort());
  expect(xml).toContain('Applicant University');
  expect(xml).toContain('Atlanta, GA');
  expect(xml).toContain('executiveSummary test content.');
  expect(xml).not.toMatch(/\[\[(?:DV|AI):/);
  expect(xml).toContain('[[STAFF:GraphicalAbstractImage]]');
  expect(xml).toContain('[[STAFF:GraphicalAbstractCaption]]');
  expect(xml).toContain('Institutional Funding History:Applicant University has received 8 awards totaling $9.15 million from WMKF.');
});

test('refuses to render without an institutional funding history sentence', async () => {
  const fields = documentFieldsFixture();
  delete fields.institutionalFundingHistory;
  await expect(renderPreSiteVisitDocx({
    documentFields: fields,
    proposalCore: proposalCoreFixture(),
    personnelNames: personnelNamesFixture(),
  })).rejects.toThrow(/Institutional funding history is required/);
});

test('produces byte-identical DOCX output for identical inputs', async () => {
  const input = {
    documentFields: documentFieldsFixture(),
    proposalCore: {
      ...proposalCoreFixture(),
      personnelDetails: 'Ada Lovelace (PI) leads modeling; Grace Hopper (co-PI) leads experiments.',
    },
    personnelNames: personnelNamesFixture(),
  };
  const { docx: first } = await renderPreSiteVisitDocx(input);
  const { docx: second } = await renderPreSiteVisitDocx(input);
  expect(second.equals(first)).toBe(true);
});

test('selects render-contract v7 over the zero-inset v6 template bytes', () => {
  expect(PRE_SITE_VISIT_TEMPLATE).toEqual({
    id: 'phase-ii-pre-site-visit',
    version: 7,
    relativePath: 'shared/templates/pre-site-visit/phase-ii-pre-site-visit-v6.docx',
  });
  expect(PRE_SITE_VISIT_CONTRACT.templateId).toBe(PRE_SITE_VISIT_TEMPLATE.id);
  expect(PRE_SITE_VISIT_CONTRACT.templateVersion).toBe(String(PRE_SITE_VISIT_TEMPLATE.version));
});

test('pins top title alignment and visible metadata-value spacing in the retained template', async () => {
  const template = await fs.readFile(defaultPreSiteVisitTemplatePath());
  const zip = await JSZip.loadAsync(template);
  const documentXml = await zip.file('word/document.xml').async('string');
  const cells = wordTableCells(documentXml);

  expect(cellContaining(cells, 'Project Title')).not.toMatch(/<w:vAlign w:val="(?:center|bottom)"\/>/);
  expect(cellContaining(cells, 'DV:ProjectTitle')).not.toMatch(/<w:vAlign w:val="(?:center|bottom)"\/>/);
  expect(cellContaining(cells, '>Recommendation<')).toContain('<w:noWrap/>');
  for (const placeholder of [
    'DV:RequestedAmount',
    'DV:InvitedAmount',
    'DV:TotalProjectBudget',
  ]) {
    expect(cellContaining(cells, placeholder)).toMatch(
      /<w:tcMar>[\s\S]*?<w:left w:w="144" w:type="dxa"\/>[\s\S]*?<\/w:tcMar>/,
    );
  }
});

test('pins every left metadata value to zero cell inset and zero paragraph indent', async () => {
  const template = await fs.readFile(defaultPreSiteVisitTemplatePath());
  const zip = await JSZip.loadAsync(template);
  const documentXml = await zip.file('word/document.xml').async('string');
  const metadataTable = wordTables(documentXml).find((table) => table.includes('Project Title'));
  const rows = wordTableRows(metadataTable);

  expect(rows).toHaveLength(5);
  for (const row of rows) {
    const valueCell = wordTableCells(row)[1];
    expect(valueCell).toMatch(
      /<w:tcMar>[\s\S]*?<w:left w:w="0" w:type="dxa"\/>[\s\S]*?<\/w:tcMar>/,
    );
    for (const paragraph of wordParagraphs(valueCell)) {
      expect(paragraph).toMatch(/<w:ind\b[^>]*w:left="0"[^>]*w:firstLine="0"[^>]*\/>/);
    }
  }
  expect(cellContaining(wordTableCells(metadataTable), 'STAFF:Recommendation')).not.toContain(
    '<w:left w:w="144" w:type="dxa"/>',
  );
});

test('pins one blank line after Project Title and single-spaced metadata rows', async () => {
  const template = await fs.readFile(defaultPreSiteVisitTemplatePath());
  const zip = await JSZip.loadAsync(template);
  const documentXml = await zip.file('word/document.xml').async('string');
  const metadataTable = wordTables(documentXml).find((table) => table.includes('Project Title'));
  const rows = wordTableRows(metadataTable);
  const zeroAfterSpacing = /<w:spacing w:after="0"\/>/g;

  expect(rows).toHaveLength(5);
  expect(rows[0]).toContain('Project Title');
  expect(rows[1]).not.toMatch(/<w:t(?:\s|>)/);
  expect(rows[1]).not.toContain('<w:hideMark/>');
  expect(rows[2]).toContain('Meeting Date');
  expect(rows[3]).toContain('Staff Lead');
  expect(rows[4]).toContain('Recommendation');
  for (const row of rows) {
    const cellCount = (row.match(/<w:tc(?:\s[^>]*)?>/g) || []).length;
    expect(row.match(zeroAfterSpacing)).toHaveLength(cellCount);
  }
});

test('pins a fixed 1.5-inch metadata label column across every first-page row', async () => {
  const template = await fs.readFile(defaultPreSiteVisitTemplatePath());
  const zip = await JSZip.loadAsync(template);
  const documentXml = await zip.file('word/document.xml').async('string');
  const metadataTable = wordTables(documentXml).find((table) => table.includes('Project Title'));
  const rows = wordTableRows(metadataTable);
  const expectedGrid = [2160, 4090, 2520, 1310];
  const expectedRows = [
    [2160, 7920],
    expectedGrid,
    expectedGrid,
    expectedGrid,
    expectedGrid,
  ];

  expect(metadataTable).toContain('<w:tblW w:w="10080" w:type="dxa"/>');
  expect(metadataTable).toContain('<w:tblLayout w:type="fixed"/>');
  expect(Array.from(metadataTable.matchAll(/<w:gridCol\b[^>]*w:w="(\d+)"[^>]*\/>/g))
    .map((match) => Number(match[1]))).toEqual(expectedGrid);
  expect(expectedGrid.reduce((sum, width) => sum + width, 0)).toBe(10080);

  expect(rows.map((row) => (
    Array.from(row.matchAll(/<w:tcW\b[^>]*w:w="(\d+)"[^>]*w:type="dxa"[^>]*\/>/g))
      .map((match) => Number(match[1]))
  ))).toEqual(expectedRows);
  expect(rows.every((row) => !/<w:tcW\b[^>]*w:type="(?:auto|pct)"/.test(row))).toBe(true);
});

test('pins the divider and one blank line above the executive summary', async () => {
  const template = await fs.readFile(defaultPreSiteVisitTemplatePath());
  const zip = await JSZip.loadAsync(template);
  const documentXml = await zip.file('word/document.xml').async('string');
  const metadataTable = wordTables(documentXml).find((table) => table.includes('Project Title'));
  const paragraphs = wordParagraphs(documentXml);
  const dividerIndex = paragraphs.findIndex((paragraph) => paragraph.includes('<w:pBdr>'));
  const divider = paragraphs[dividerIndex];
  const afterMetadata = documentXml.slice(documentXml.indexOf(metadataTable) + metadataTable.length);
  const afterDivider = afterMetadata.slice(afterMetadata.indexOf(divider) + divider.length);

  expect(divider).toBeDefined();
  expect(divider).toContain(
    '<w:bottom w:val="single" w:sz="12" w:space="1" w:color="auto"/>',
  );
  expect(divider).toContain(
    '<w:spacing w:after="0"/>',
  );
  expect(afterMetadata).toMatch(/^\s*<w:p[\s\S]*?<w:pBdr>/);
  expect(afterDivider).toMatch(/^\s*<w:p(?:(?!<w:t).)*<\/w:p>\s*<w:p[\s\S]*?Executive Summary/);
  expect(wordTables(documentXml).find((table) => table.includes(
    '<w:top w:val="single" w:sz="8" w:space="0" w:color="000000"/>',
  ))).toBeUndefined();
});

test('adds 6pt after the four first-page list paragraphs and removes the blank before the page break', async () => {
  const { docx: output } = await renderPreSiteVisitDocx({
    documentFields: documentFieldsFixture(),
    proposalCore: {
      ...proposalCoreFixture(),
      personnelDetails: 'Ada Lovelace (PI) leads modeling; Grace Hopper (co-PI) leads experiments.',
    },
    personnelNames: personnelNamesFixture(),
  });
  const rendered = await JSZip.loadAsync(output);
  const documentXml = await rendered.file('word/document.xml').async('string');
  const paragraphs = wordParagraphs(documentXml);

  for (const field of [
    'impactOverview',
    'methodologyOverview',
    'personnelOverview',
    'keckFundingRationale',
  ]) {
    const paragraph = paragraphs.find((candidate) => candidate.includes(`${field} test content.`));
    expect(paragraph).toBeDefined();
    expect(paragraph).toMatch(/<w:spacing\b[^>]*w:after="120"[^>]*\/>/);
  }

  const firstPageBreak = paragraphs.findIndex((paragraph) => (
    /<w:br\b[^>]*w:type="page"[^>]*\/>/.test(paragraph)
  ));
  expect(firstPageBreak).toBeGreaterThan(0);
  expect(paragraphs[firstPageBreak - 1]).toContain('keckFundingRationale test content.');
});

test('expands the two long-form AI slots into multiple Word paragraphs', async () => {
  const core = proposalCoreFixture();
  core.backgroundAndImpact = 'Background paragraph one.\n\nBackground paragraph two.\n\nBackground paragraph three.';
  core.detailedMethodology = 'Methods paragraph one.\n\nMethods paragraph two.\n\nMethods paragraph three.';
  core.personnelDetails = 'Ada Lovelace (PI) leads modeling; Grace Hopper (co-PI) leads experiments.';
  const { docx: output } = await renderPreSiteVisitDocx({
    documentFields: documentFieldsFixture(),
    proposalCore: core,
    personnelNames: personnelNamesFixture(),
  });
  const rendered = await JSZip.loadAsync(output);
  const documentXml = await rendered.file('word/document.xml').async('string');

  expect(documentXml).toContain('Background paragraph one.');
  expect(documentXml).toContain('Background paragraph two.');
  expect((documentXml.match(/Background paragraph/g) || [])).toHaveLength(3);
  expect((documentXml.match(/Methods paragraph/g) || [])).toHaveLength(3);
});

test('collapses a multi-paragraph personnel section instead of rejecting the draft', async () => {
  const core = proposalCoreFixture();
  core.personnelDetails = 'Ada Lovelace (PI) leads modeling.\n\nGrace Hopper (co-PI) leads experiments.';
  const { docx: output } = await renderPreSiteVisitDocx({
    documentFields: documentFieldsFixture(),
    proposalCore: core,
    personnelNames: personnelNamesFixture(),
  });
  const rendered = await JSZip.loadAsync(output);
  const xml = await wordXml(rendered);
  expect(xml).toContain('Ada Lovelace (PI) leads modeling. Grace Hopper (co-PI) leads experiments.');
});

test('replaces unavailable optional Dataverse fields with blanks rather than inventing values', async () => {
  const fields = documentFieldsFixture();
  fields.invitedAmount = null;
  fields.totalProjectBudget = null;
  const { docx: output } = await renderPreSiteVisitDocx({
    documentFields: fields,
    proposalCore: {
      ...proposalCoreFixture(),
      personnelDetails: 'Ada Lovelace (PI) leads modeling; Grace Hopper (co-PI) leads experiments.',
    },
    personnelNames: personnelNamesFixture(),
  });
  const rendered = await JSZip.loadAsync(output);
  const xml = await wordXml(rendered);

  expect(xml).not.toContain('[[DV:InvitedAmount]]');
  expect(xml).not.toContain('[[DV:TotalProjectBudget]]');
  expect(xml).not.toContain('undefined');
  expect(xml).not.toContain('null');
});

test('underlines only authoritative roster names in both Personnel sections', async () => {
  const core = proposalCoreFixture();
  core.personnelOverview = 'Ada Lovelace and Grace Hopper provide complementary expertise.';
  core.personnelDetails = 'Ada Lovelace (PI) leads modeling; Grace Hopper (co-PI) leads experiments.';
  const { docx: output } = await renderPreSiteVisitDocx({
    documentFields: documentFieldsFixture(),
    proposalCore: core,
    personnelNames: personnelNamesFixture(),
  });
  const rendered = await JSZip.loadAsync(output);
  const documentXml = await rendered.file('word/document.xml').async('string');
  const paragraphs = wordParagraphs(documentXml);
  const overview = paragraphs.find((paragraph) => paragraph.includes('provide complementary expertise'));
  const details = paragraphs.find((paragraph) => paragraph.includes('leads modeling'));

  expect(overview).toBeDefined();
  expect(overview).toMatch(/<w:u w:val="single"\/><\/w:rPr><w:t>Ada Lovelace<\/w:t>/);
  expect(overview).toMatch(/<w:u w:val="single"\/><\/w:rPr><w:t>Grace Hopper<\/w:t>/);
  expect(overview).not.toMatch(/<w:u w:val="single"\/><\/w:rPr><w:t[^>]*>\s*and/);
  expect(details).toBeDefined();
  expect(details).toMatch(/<w:u w:val="single"\/><\/w:rPr><w:t>Ada Lovelace<\/w:t>/);
  expect(details).toMatch(/<w:u w:val="single"\/><\/w:rPr><w:t>Grace Hopper<\/w:t>/);
  expect(details).not.toMatch(/<w:u w:val="single"\/><\/w:rPr><w:t[^>]*>\s*\(PI\)/);
  expect(details).not.toMatch(/<w:u w:val="single"\/><\/w:rPr><w:t[^>]*>\s*leads/);
});

test('renders a page-one Personnel summary that omits a roster name without underlining it', async () => {
  const core = proposalCoreFixture();
  core.personnelOverview = 'Ada Lovelace (PI) provides complementary expertise.';
  core.personnelDetails = 'Ada Lovelace (PI) leads modeling; Grace Hopper (co-PI) leads experiments.';

  const { docx: output } = await renderPreSiteVisitDocx({
    documentFields: documentFieldsFixture(),
    proposalCore: core,
    personnelNames: personnelNamesFixture(),
  });
  expect(output).toBeInstanceOf(Buffer);
});

test('renders a detailed Personnel section that omits a roster name', async () => {
  const core = proposalCoreFixture();
  core.personnelDetails = 'Ada Lovelace (PI) leads modeling.';

  const { docx: output } = await renderPreSiteVisitDocx({
    documentFields: documentFieldsFixture(),
    proposalCore: core,
    personnelNames: personnelNamesFixture(),
  });
  expect(output).toBeInstanceOf(Buffer);
});

// Slice 4 (plan §4.5): [[STAFF:RefereeSection]] is CONDITIONAL, not manual —
// filled when a referee section is supplied, preserved exactly once when not.
describe('RefereeSection (Slice 4, conditional placeholder)', () => {
  test('preserves the token exactly once and emits no diagnostics when refereeSection is null', async () => {
    const { docx: output, diagnostics } = await renderPreSiteVisitDocx({
      documentFields: documentFieldsFixture(),
      proposalCore: proposalCoreFixture(),
      personnelNames: personnelNamesFixture(),
      refereeSection: null,
    });
    const rendered = await JSZip.loadAsync(output);
    const xml = await wordXml(rendered);
    expect((xml.match(/\[\[STAFF:RefereeSection\]\]/g) || [])).toHaveLength(1);
    expect(diagnostics).toEqual([]);
  });

  test('fills the token exactly once, removes it, and underlines the supplied reviewer names ONLY in that paragraph', async () => {
    const { docx: output, diagnostics } = await renderPreSiteVisitDocx({
      documentFields: documentFieldsFixture(),
      proposalCore: {
        ...proposalCoreFixture(),
        personnelDetails: 'Ada Lovelace (PI) leads modeling; Dr. Reviewer was consulted informally.',
      },
      personnelNames: personnelNamesFixture(),
      refereeSection: {
        text: 'We received one review with a score of Excellent. The reviewer was Dr. Reviewer of Institute X.',
        names: ['Dr. Reviewer'],
      },
    });
    const rendered = await JSZip.loadAsync(output);
    const documentXml = await rendered.file('word/document.xml').async('string');
    const xml = await wordXml(rendered);

    expect(xml).not.toContain('[[STAFF:RefereeSection]]');
    expect(xml).toContain('We received one review with a score of Excellent.');

    const paragraphs = wordParagraphs(documentXml);
    const referee = paragraphs.find((p) => p.includes('The reviewer was'));
    expect(referee).toBeDefined();
    expect(referee).toMatch(/<w:u w:val="single"\/><\/w:rPr><w:t>Dr\. Reviewer<\/w:t>/);
    // Institution text is never underlined — only the reviewer name run.
    expect(referee).not.toMatch(/<w:u w:val="single"\/><\/w:rPr><w:t[^>]*>\s*of Institute X/);

    // Reviewer names appear in the Personnel-details paragraph as plain text
    // (they must NOT be underlined there, and must not trigger
    // personnel_name_not_matched — they were never joined into
    // personnelNames). This is the discriminating half of the assertion:
    // the name is present in both paragraphs, but underlined in only one.
    const details = paragraphs.find((p) => p.includes('leads modeling'));
    expect(details).toBeDefined();
    expect(details).toContain('Dr. Reviewer');
    expect(details).not.toMatch(/<w:u w:val="single"\/><\/w:rPr><w:t[^>]*>Dr\. Reviewer/);

    expect(diagnostics).toEqual([]);
  });

  test('emits referee_name_not_matched for a supplied name with zero underlines (e.g. the template splits the run)', async () => {
    const { diagnostics } = await renderPreSiteVisitDocx({
      documentFields: documentFieldsFixture(),
      proposalCore: proposalCoreFixture(),
      personnelNames: personnelNamesFixture(),
      refereeSection: {
        text: 'We received one review with a score of Excellent.',
        // "Dr. Unmatched" never appears anywhere in the referee text (or
        // template) — zero underlines, matching a template-vs-text mismatch.
        names: ['Dr. Unmatched'],
      },
    });
    expect(diagnostics).toEqual([{ code: 'referee_name_not_matched', name: 'Dr. Unmatched' }]);
  });

  async function templateWithDuplicatedRefereeToken() {
    const template = await fs.readFile(defaultPreSiteVisitTemplatePath());
    const zip = await JSZip.loadAsync(template);
    const documentXml = await zip.file('word/document.xml').async('string');
    const paragraphs = Array.from(documentXml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g));
    // The token can be split across multiple <w:t> runs in the real
    // template, so match on the paragraph's LOGICAL text (all <w:t> content
    // concatenated), the same way the renderer itself detects the token
    // paragraph, rather than a raw substring search on the paragraph's XML.
    const tokenParagraph = paragraphs.find((match) => Array.from(
      match[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g),
    ).map((run) => run[1]).join('').includes('[[STAFF:RefereeSection]]'));
    expect(tokenParagraph).toBeDefined();
    const insertAt = tokenParagraph.index + tokenParagraph[0].length;
    // Duplicate the exact, whole, well-formed <w:p>...</w:p> element that
    // holds the token right after itself — this stays well-formed XML
    // (unlike ad hoc string surgery), giving the template two occurrences.
    const duplicated = `${documentXml.slice(0, insertAt)}${tokenParagraph[0]}${documentXml.slice(insertAt)}`;
    zip.file('word/document.xml', duplicated);
    return zip.generateAsync({ type: 'nodebuffer' });
  }

  test('throws "Expected exactly one template occurrence" when a referee section is supplied against a template with two tokens (wrap-up item 1)', async () => {
    const templateBuffer = await templateWithDuplicatedRefereeToken();
    await expect(renderPreSiteVisitDocx({
      documentFields: documentFieldsFixture(),
      proposalCore: proposalCoreFixture(),
      personnelNames: personnelNamesFixture(),
      refereeSection: { text: 'We received one review.', names: [] },
      templateBuffer,
    })).rejects.toThrow(/Expected exactly one template occurrence of \[\[STAFF:RefereeSection\]\]; found 2\./);
  });

  test('throws "survive exactly once" when no referee section is supplied against a template with two tokens (wrap-up item 1)', async () => {
    const templateBuffer = await templateWithDuplicatedRefereeToken();
    await expect(renderPreSiteVisitDocx({
      documentFields: documentFieldsFixture(),
      proposalCore: proposalCoreFixture(),
      personnelNames: personnelNamesFixture(),
      refereeSection: null,
      templateBuffer,
    })).rejects.toThrow(/Expected \[\[STAFF:RefereeSection\]\] to survive exactly once when no referee section is supplied; found 2\./);
  });

  test('treats a blank/whitespace-only refereeSection.text as null — token preserved, no fill (wrap-up item 2)', async () => {
    const { docx: output, diagnostics } = await renderPreSiteVisitDocx({
      documentFields: documentFieldsFixture(),
      proposalCore: proposalCoreFixture(),
      personnelNames: personnelNamesFixture(),
      refereeSection: { text: '   ', names: [] },
    });
    const rendered = await JSZip.loadAsync(output);
    const xml = await wordXml(rendered);
    expect((xml.match(/\[\[STAFF:RefereeSection\]\]/g) || [])).toHaveLength(1);
    expect(diagnostics).toEqual([]);
  });

});
