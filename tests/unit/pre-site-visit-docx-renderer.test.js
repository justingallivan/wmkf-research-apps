import fs from 'fs/promises';
import JSZip from 'jszip';
import {
  defaultPreSiteVisitTemplatePath,
  renderPreSiteVisitDocx,
} from '../../lib/services/pre-site-visit/docx-renderer';
import { PROPOSAL_CORE_KEYS } from '../../shared/config/prompts/pre-site-visit-proposal-core';

function proposalCoreFixture() {
  return Object.fromEntries(PROPOSAL_CORE_KEYS.map((key) => [key, `${key} test content.`]));
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
    proposalCore: proposalCoreFixture(),
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
    proposalCore: proposalCoreFixture(),
  };
  const first = await renderPreSiteVisitDocx(input);
  const second = await renderPreSiteVisitDocx(input);
  expect(second.equals(first)).toBe(true);
});

test('pins title alignment and visible amount-value spacing in the retained template', async () => {
  const template = await fs.readFile(defaultPreSiteVisitTemplatePath());
  const zip = await JSZip.loadAsync(template);
  const documentXml = await zip.file('word/document.xml').async('string');
  const cells = wordTableCells(documentXml);

  expect(cellContaining(cells, 'Project Title')).toContain('<w:vAlign w:val="top"/>');
  expect(cellContaining(cells, 'DV:ProjectTitle')).toContain('<w:vAlign w:val="top"/>');
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

test('pins the compact 2pt single divider above the executive summary', async () => {
  const template = await fs.readFile(defaultPreSiteVisitTemplatePath());
  const zip = await JSZip.loadAsync(template);
  const documentXml = await zip.file('word/document.xml').async('string');
  const divider = wordTables(documentXml).find((table) => table.includes('<w:tcBorders>'));

  expect(divider).toBeDefined();
  expect(divider).toContain('<w:trHeight w:val="40" w:hRule="exact"/>');
  expect(divider).toContain(
    '<w:top w:val="single" w:sz="16" w:space="0" w:color="000000"/>',
  );
  for (const side of ['left', 'bottom', 'right']) {
    expect(divider).toContain(`<w:${side} w:val="nil"/>`);
  }
  expect(divider).toContain(
    '<w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/>',
  );
  expect(documentXml.match(
    /<w:spacing w:before="0" w:after="0" w:line="120" w:lineRule="exact"\/>/g,
  )).toHaveLength(2);
});

test('expands the two long-form AI slots into multiple Word paragraphs', async () => {
  const core = proposalCoreFixture();
  core.backgroundAndImpact = 'Background paragraph one.\n\nBackground paragraph two.';
  core.detailedMethodology = 'Methods paragraph one.\n\nMethods paragraph two.';
  const output = await renderPreSiteVisitDocx({
    documentFields: documentFieldsFixture(),
    proposalCore: core,
  });
  const rendered = await JSZip.loadAsync(output);
  const documentXml = await rendered.file('word/document.xml').async('string');

  expect(documentXml).toContain('Background paragraph one.');
  expect(documentXml).toContain('Background paragraph two.');
  expect((documentXml.match(/Background paragraph/g) || [])).toHaveLength(2);
  expect((documentXml.match(/Methods paragraph/g) || [])).toHaveLength(2);
});

test('rejects a multi-paragraph personnel section before opening the template', async () => {
  const core = proposalCoreFixture();
  core.personnelDetails = 'First person.\n\nSecond person.';
  await expect(renderPreSiteVisitDocx({
    documentFields: documentFieldsFixture(),
    proposalCore: core,
  })).rejects.toThrow('personnelDetails');
});

test('replaces unavailable optional Dataverse fields with blanks rather than inventing values', async () => {
  const fields = documentFieldsFixture();
  fields.invitedAmount = null;
  fields.totalProjectBudget = null;
  const output = await renderPreSiteVisitDocx({
    documentFields: fields,
    proposalCore: proposalCoreFixture(),
  });
  const rendered = await JSZip.loadAsync(output);
  const xml = await wordXml(rendered);

  expect(xml).not.toContain('[[DV:InvitedAmount]]');
  expect(xml).not.toContain('[[DV:TotalProjectBudget]]');
  expect(xml).not.toContain('undefined');
  expect(xml).not.toContain('null');
});
