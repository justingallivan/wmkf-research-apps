/** Template-preserving Phase II Pre-Site Visit Word renderer. */

import fs from 'fs/promises';
import path from 'path';
import JSZip from 'jszip';
import { validateAiJson } from '../../utils/ai-output-schema.js';
import {
  PROMPT_OUTPUT_SCHEMA,
  PROPOSAL_CORE_KEYS,
} from '../../../shared/config/prompts/pre-site-visit-proposal-core.js';

export const PRE_SITE_VISIT_TEMPLATE = Object.freeze({
  id: 'phase-ii-pre-site-visit',
  version: 1,
  relativePath: 'shared/templates/pre-site-visit/phase-ii-pre-site-visit-v1.docx',
});

const AI_PLACEHOLDERS = Object.freeze({
  executiveSummary: '[[AI:ExecutiveSummary]]',
  impactOverview: '[[AI:ImpactOverview]]',
  methodologyOverview: '[[AI:MethodologyOverview]]',
  personnelOverview: '[[AI:PersonnelOverview]]',
  keckFundingRationale: '[[AI:KeckFundingRationale]]',
  backgroundAndImpact: '[[AI:BackgroundAndImpact]]',
  detailedMethodology: '[[AI:DetailedMethodology]]',
  personnelDetails: '[[AI:PersonnelDetails]]',
});

const DV_PLACEHOLDERS = Object.freeze({
  institutionName: '[[DV:InstitutionName]]',
  cityState: '[[DV:CityState]]',
  internalProgram: '[[DV:InternalProgram]]',
  projectTitle: '[[DV:ProjectTitle]]',
  meetingDate: '[[DV:MeetingDate]]',
  requestedAmount: '[[DV:RequestedAmount]]',
  programDirector: '[[DV:ProgramDirector]]',
  invitedAmount: '[[DV:InvitedAmount]]',
  totalProjectBudget: '[[DV:TotalProjectBudget]]',
});

const MANUAL_PLACEHOLDERS = Object.freeze([
  '[[STAFF:GraphicalAbstractImage]]',
  '[[STAFF:GraphicalAbstractCaption]]',
  '[[STAFF:Recommendation]]',
  '[[STAFF:RefereeSection]]',
  '[[STAFF:ScientificPresentation]]',
  '[[AI:InstitutionalFundingHistory]]',
]);

const PARAGRAPH_CAPABLE = new Set([
  AI_PLACEHOLDERS.backgroundAndImpact,
  AI_PLACEHOLDERS.detailedMethodology,
]);

function decodeXmlText(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function encodeXmlText(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function textNodes(paragraphXml) {
  const nodes = [];
  const pattern = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  let match;
  let logicalOffset = 0;
  while ((match = pattern.exec(paragraphXml)) !== null) {
    const text = decodeXmlText(match[1]);
    nodes.push({
      fullStart: match.index,
      fullEnd: pattern.lastIndex,
      contentStart: match.index + match[0].indexOf(match[1]),
      contentEnd: match.index + match[0].indexOf(match[1]) + match[1].length,
      text,
      logicalStart: logicalOffset,
      logicalEnd: logicalOffset + text.length,
    });
    logicalOffset += text.length;
  }
  return nodes;
}

function replaceAcrossTextNodes(paragraphXml, placeholder, replacement) {
  const nodes = textNodes(paragraphXml);
  const logical = nodes.map((node) => node.text).join('');
  const placeholderStart = logical.indexOf(placeholder);
  if (placeholderStart < 0) return { xml: paragraphXml, count: 0 };
  const placeholderEnd = placeholderStart + placeholder.length;
  const startIndex = nodes.findIndex((node) => (
    placeholderStart >= node.logicalStart && placeholderStart < node.logicalEnd
  ));
  const endIndex = nodes.findIndex((node) => (
    placeholderEnd > node.logicalStart && placeholderEnd <= node.logicalEnd
  ));
  if (startIndex < 0 || endIndex < 0) {
    throw new Error(`DOCX placeholder spans unsupported Word text nodes: ${placeholder}`);
  }

  const values = nodes.map((node) => node.text);
  const startNode = nodes[startIndex];
  const endNode = nodes[endIndex];
  const prefix = startNode.text.slice(0, placeholderStart - startNode.logicalStart);
  const suffix = endNode.text.slice(placeholderEnd - endNode.logicalStart);
  values[startIndex] = `${prefix}${replacement}${startIndex === endIndex ? suffix : ''}`;
  for (let index = startIndex + 1; index < endIndex; index += 1) values[index] = '';
  if (endIndex > startIndex) values[endIndex] = suffix;

  let output = paragraphXml;
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    output = `${output.slice(0, node.contentStart)}${encodeXmlText(values[index])}${output.slice(node.contentEnd)}`;
  }
  return { xml: output, count: 1 };
}

function splitParagraphs(value) {
  return String(value ?? '')
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.replace(/\s*\r?\n\s*/g, ' ').trim())
    .filter(Boolean);
}

function replacePart(xml, replacements, counts, { expandParagraphs = false } = {}) {
  return xml.replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g, (paragraphXml) => {
    let paragraphs = [paragraphXml];
    for (const [placeholder, rawValue] of replacements) {
      const valueParagraphs = splitParagraphs(rawValue);
      if (
        expandParagraphs
        && PARAGRAPH_CAPABLE.has(placeholder)
        && valueParagraphs.length > 1
        && textNodes(paragraphXml).map((node) => node.text).join('').trim() === placeholder
      ) {
        paragraphs = valueParagraphs.map((value) => {
          const result = replaceAcrossTextNodes(paragraphXml, placeholder, value);
          counts.set(placeholder, (counts.get(placeholder) || 0) + result.count);
          return result.xml;
        });
        continue;
      }
      paragraphs = paragraphs.map((candidate) => {
        const result = replaceAcrossTextNodes(candidate, placeholder, valueParagraphs.join(' '));
        counts.set(placeholder, (counts.get(placeholder) || 0) + result.count);
        return result.xml;
      });
    }
    return paragraphs.join('');
  });
}

function validateProposalCore(proposalCore) {
  const validation = validateAiJson(
    { proposalCore },
    PROMPT_OUTPUT_SCHEMA.validationSchema,
  );
  if (!validation.ok) {
    throw new Error(`Invalid Pre-Site Visit proposal core: ${validation.errors.join(' ')}`);
  }
  for (const key of PROPOSAL_CORE_KEYS) {
    if (!String(proposalCore[key] || '').trim()) {
      throw new Error(`Invalid Pre-Site Visit proposal core: ${key} is empty.`);
    }
  }
}

function replacementMap(documentFields, proposalCore) {
  const pairs = [];
  for (const [key, placeholder] of Object.entries(DV_PLACEHOLDERS)) {
    pairs.push([placeholder, documentFields?.[key] ?? '']);
  }
  for (const [key, placeholder] of Object.entries(AI_PLACEHOLDERS)) {
    pairs.push([placeholder, proposalCore[key]]);
  }
  return pairs;
}

function assertReplacements(counts) {
  for (const placeholder of Object.values(AI_PLACEHOLDERS)) {
    const count = counts.get(placeholder) || 0;
    const accepted = PARAGRAPH_CAPABLE.has(placeholder)
      ? count >= 1 && count <= 2
      : count === 1;
    if (!accepted) {
      throw new Error(`Expected one template occurrence of ${placeholder}; found ${counts.get(placeholder) || 0}.`);
    }
  }
  for (const placeholder of Object.values(DV_PLACEHOLDERS)) {
    const count = counts.get(placeholder) || 0;
    if (count < 1) {
      throw new Error(`Unexpected template occurrence count for ${placeholder}: ${count}.`);
    }
  }
}

export function defaultPreSiteVisitTemplatePath() {
  return path.join(process.cwd(), PRE_SITE_VISIT_TEMPLATE.relativePath);
}

function logicalWordText(xmlParts) {
  return xmlParts
    .flatMap((xml) => Array.from(String(xml || '').matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)))
    .map((match) => decodeXmlText(match[1]))
    .join('');
}

/**
 * Fill a retained OOXML template. Manual/future placeholders intentionally
 * remain visible so the PD can complete those sections in Word.
 */
export async function renderPreSiteVisitDocx({
  documentFields,
  proposalCore,
  templateBuffer = null,
}) {
  validateProposalCore(proposalCore);
  const source = templateBuffer || await fs.readFile(defaultPreSiteVisitTemplatePath());
  const zip = await JSZip.loadAsync(source);
  const replacements = replacementMap(documentFields, proposalCore);
  const counts = new Map();
  const partNames = Object.keys(zip.files).filter((name) => (
    name === 'word/document.xml'
    || /^word\/(?:header|footer)\d+\.xml$/.test(name)
  ));

  for (const partName of partNames) {
    const part = zip.file(partName);
    if (!part) continue;
    const xml = await part.async('string');
    const updated = replacePart(xml, replacements, counts, {
      expandParagraphs: partName === 'word/document.xml',
    });
    zip.file(partName, updated, {
      createFolders: false,
      date: part.date,
      comment: part.comment,
      unixPermissions: part.unixPermissions,
      dosPermissions: part.dosPermissions,
    });
  }
  assertReplacements(counts);

  const output = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });

  const check = await JSZip.loadAsync(output);
  const renderedXml = await Promise.all(
    Object.keys(check.files)
      .filter((name) => name.startsWith('word/') && name.endsWith('.xml'))
      .map((name) => check.file(name)?.async('string')),
  );
  const joined = logicalWordText(renderedXml.filter(Boolean));
  for (const placeholder of [...Object.values(AI_PLACEHOLDERS), ...Object.values(DV_PLACEHOLDERS)]) {
    if (joined.includes(placeholder)) throw new Error(`Unfilled required template placeholder: ${placeholder}`);
  }
  for (const placeholder of MANUAL_PLACEHOLDERS) {
    if (!joined.includes(placeholder)) throw new Error(`Manual template placeholder was lost: ${placeholder}`);
  }
  return output;
}
