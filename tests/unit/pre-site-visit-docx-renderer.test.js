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
  const output = await renderPreSiteVisitDocx({
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
  expect(xml).not.toMatch(/\[\[(?:DV|AI):(?!InstitutionalFundingHistory)/);
  expect(xml).toContain('[[STAFF:GraphicalAbstractImage]]');
  expect(xml).toContain('[[STAFF:GraphicalAbstractCaption]]');
  expect(xml).toContain('[[AI:InstitutionalFundingHistory]]');
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
  const first = await renderPreSiteVisitDocx(input);
  const second = await renderPreSiteVisitDocx(input);
  expect(second.equals(first)).toBe(true);
});

test('selects render-contract v5 over the retained v4 template bytes', () => {
  expect(PRE_SITE_VISIT_TEMPLATE).toEqual({
    id: 'phase-ii-pre-site-visit',
    version: 5,
    relativePath: 'shared/templates/pre-site-visit/phase-ii-pre-site-visit-v4.docx',
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
    'STAFF:Recommendation',
  ]) {
    expect(cellContaining(cells, placeholder)).toMatch(
      /<w:tcMar>[\s\S]*?<w:left w:w="144" w:type="dxa"\/>[\s\S]*?<\/w:tcMar>/,
    );
  }
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
  const output = await renderPreSiteVisitDocx({
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
  const output = await renderPreSiteVisitDocx({
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
  const output = await renderPreSiteVisitDocx({
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
  const output = await renderPreSiteVisitDocx({
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
  const output = await renderPreSiteVisitDocx({
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

  const output = await renderPreSiteVisitDocx({
    documentFields: documentFieldsFixture(),
    proposalCore: core,
    personnelNames: personnelNamesFixture(),
  });
  expect(output).toBeInstanceOf(Buffer);
});

test('renders a detailed Personnel section that omits a roster name', async () => {
  const core = proposalCoreFixture();
  core.personnelDetails = 'Ada Lovelace (PI) leads modeling.';

  const output = await renderPreSiteVisitDocx({
    documentFields: documentFieldsFixture(),
    proposalCore: core,
    personnelNames: personnelNamesFixture(),
  });
  expect(output).toBeInstanceOf(Buffer);
});
