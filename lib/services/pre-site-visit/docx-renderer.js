/**
 * Template-preserving Phase II Pre-Site Visit Word renderer.
 *
 * Template v4 retains v3's non-wrapping Recommendation cells and pins the
 * first-page metadata rhythm: one blank line after Project Title, compact
 * single-spaced detail rows, and one blank line ending at the divider.
 */

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
  version: 4,
  relativePath: 'shared/templates/pre-site-visit/phase-ii-pre-site-visit-v4.docx',
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

const FIRST_PAGE_LIST_PLACEHOLDERS = new Set([
  AI_PLACEHOLDERS.impactOverview,
  AI_PLACEHOLDERS.methodologyOverview,
  AI_PLACEHOLDERS.personnelOverview,
  AI_PLACEHOLDERS.keckFundingRationale,
]);

const SIX_POINTS_IN_TWIPS = 120;

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

function underlinedRunProperties(runProperties) {
  if (/<w:u(?:\s[^>]*)?\/>/.test(runProperties)) {
    return runProperties.replace(/<w:u(?:\s[^>]*)?\/>/, '<w:u w:val="single"/>');
  }
  if (/<w:rPr(?:\s[^>]*)?\/>/.test(runProperties)) {
    return runProperties.replace(/<w:rPr(?:\s[^>]*)?\/>/, '<w:rPr><w:u w:val="single"/></w:rPr>');
  }
  if (runProperties) {
    return runProperties.replace(/<\/w:rPr>/, '<w:u w:val="single"/></w:rPr>');
  }
  return '<w:rPr><w:u w:val="single"/></w:rPr>';
}

function textRunXml(openingTag, runProperties, text, underlined) {
  const space = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : '';
  const properties = underlined ? underlinedRunProperties(runProperties) : runProperties;
  return `${openingTag}${properties}<w:t${space}>${encodeXmlText(text)}</w:t></w:r>`;
}

function splitByTerms(value, terms) {
  const segments = [];
  let offset = 0;
  while (offset < value.length) {
    let next = null;
    for (const term of terms) {
      const index = value.indexOf(term, offset);
      if (index < 0) continue;
      if (!next || index < next.index || (index === next.index && term.length > next.term.length)) {
        next = { index, term };
      }
    }
    if (!next) {
      segments.push({ text: value.slice(offset), underlined: false });
      break;
    }
    if (next.index > offset) {
      segments.push({ text: value.slice(offset, next.index), underlined: false });
    }
    segments.push({ text: next.term, underlined: true });
    offset = next.index + next.term.length;
  }
  return segments;
}

function underlineTermsInParagraph(paragraphXml, terms) {
  const counts = new Map(terms.map((term) => [term, 0]));
  const xml = paragraphXml.replace(/(<w:r(?:\s[^>]*)?>)([\s\S]*?)<\/w:r>/g, (runXml, openingTag, body) => {
    const runProperties = body.match(/<w:rPr(?:\s[^>]*)?>[\s\S]*?<\/w:rPr>/)?.[0] || '';
    const withoutProperties = body.replace(runProperties, '');
    const textMatches = Array.from(withoutProperties.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g));
    if (textMatches.length !== 1) return runXml;
    if (withoutProperties.replace(textMatches[0][0], '').trim()) return runXml;
    const text = decodeXmlText(textMatches[0][1]);
    const segments = splitByTerms(text, terms);
    if (!segments.some((segment) => segment.underlined)) return runXml;
    for (const segment of segments) {
      if (segment.underlined) counts.set(segment.text, counts.get(segment.text) + 1);
    }
    return segments
      .filter((segment) => segment.text)
      .map((segment) => textRunXml(openingTag, runProperties, segment.text, segment.underlined))
      .join('');
  });
  return { xml, counts };
}

function normalizePersonnelNames(personnelNames) {
  const names = [...new Set((personnelNames || []).map((name) => String(name || '').trim()).filter(Boolean))];
  if (!names.length) throw new Error('At least one authoritative personnel name is required.');
  return names.sort((left, right) => right.length - left.length);
}

function withSpacingAfter(paragraphXml, afterTwips) {
  if (/<w:spacing(?:\s[^>]*)?\/>/.test(paragraphXml)) {
    return paragraphXml.replace(/<w:spacing(\s[^>]*)?\/>/, (_match, rawAttributes = '') => {
      const attributes = rawAttributes.replace(/\s+w:after="[^"]*"/, '');
      return `<w:spacing${attributes} w:after="${afterTwips}"/>`;
    });
  }
  if (/<w:pPr(?:\s[^>]*)?>/.test(paragraphXml)) {
    return paragraphXml.replace(
      /<\/w:pPr>/,
      `<w:spacing w:after="${afterTwips}"/></w:pPr>`,
    );
  }
  return paragraphXml.replace(
    /^(<w:p(?:\s[^>]*)?>)/,
    `$1<w:pPr><w:spacing w:after="${afterTwips}"/></w:pPr>`,
  );
}

function isRemovableBlankParagraph(paragraphXml) {
  const text = textNodes(paragraphXml).map((node) => node.text).join('').trim();
  return !text && !/<w:(?:br|drawing|pict|fldChar|bookmarkStart|bookmarkEnd|sectPr)\b/.test(paragraphXml);
}

function removeBlankParagraphsBeforePageBreak(xml) {
  const paragraphs = Array.from(xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g));
  const removals = new Set();
  for (let index = 0; index < paragraphs.length; index += 1) {
    if (!/<w:br\b[^>]*w:type="page"[^>]*\/>/.test(paragraphs[index][0])) continue;
    for (let prior = index - 1; prior >= 0; prior -= 1) {
      if (!isRemovableBlankParagraph(paragraphs[prior][0])) break;
      removals.add(prior);
    }
  }
  let output = xml;
  for (const index of [...removals].sort((left, right) => right - left)) {
    const paragraph = paragraphs[index];
    output = `${output.slice(0, paragraph.index)}${output.slice(paragraph.index + paragraph[0].length)}`;
  }
  return output;
}

function replacePart(xml, replacements, counts, {
  expandParagraphs = false,
  personnelNames = [],
} = {}) {
  const replaced = xml.replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g, (paragraphXml) => {
    const logicalText = textNodes(paragraphXml).map((node) => node.text).join('');
    const isPersonnelSection = (
      logicalText.includes(AI_PLACEHOLDERS.personnelOverview)
      || logicalText.includes(AI_PLACEHOLDERS.personnelDetails)
    );
    const formattedParagraphXml = [...FIRST_PAGE_LIST_PLACEHOLDERS]
      .some((placeholder) => logicalText.includes(placeholder))
      ? withSpacingAfter(paragraphXml, SIX_POINTS_IN_TWIPS)
      : paragraphXml;
    let paragraphs = [formattedParagraphXml];
    for (const [placeholder, rawValue] of replacements) {
      const valueParagraphs = splitParagraphs(rawValue);
      if (
        expandParagraphs
        && PARAGRAPH_CAPABLE.has(placeholder)
        && valueParagraphs.length > 1
        && textNodes(formattedParagraphXml).map((node) => node.text).join('').trim() === placeholder
      ) {
        paragraphs = valueParagraphs.map((value) => {
          const result = replaceAcrossTextNodes(formattedParagraphXml, placeholder, value);
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
    if (isPersonnelSection) {
      paragraphs = paragraphs.map((paragraph) => {
        const styled = underlineTermsInParagraph(paragraph, personnelNames);
        const missing = personnelNames.filter((name) => !styled.counts.get(name));
        if (missing.length) {
          throw new Error(`Personnel section is missing authoritative roster name(s): ${missing.join(', ')}.`);
        }
        return styled.xml;
      });
    }
    return paragraphs.join('');
  });
  return expandParagraphs ? removeBlankParagraphsBeforePageBreak(replaced) : replaced;
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
  personnelNames,
  templateBuffer = null,
}) {
  validateProposalCore(proposalCore);
  const normalizedPersonnelNames = normalizePersonnelNames(personnelNames);
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
      personnelNames: normalizedPersonnelNames,
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
