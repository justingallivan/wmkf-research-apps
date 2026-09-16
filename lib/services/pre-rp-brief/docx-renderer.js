/**
 * Template-preserving OOXML renderer for the Pre-Research Presentation Brief.
 *
 * docs/plans/PRE_RESEARCH_PRESENTATION_BRIEF_PLAN_2026-09-16.md §2, §3.4a,
 * §5 slice 2. Deterministic: no model call, no prompt registry entry.
 * Same template-preserving placeholder-fill style as
 * lib/services/pre-site-visit/docx-renderer.js (replacement-map pattern at
 * :362-371), reimplemented here at the small scale this template needs
 * (six single-occurrence placeholders, reviewer-name underlining driven
 * entirely by composeReviewerSentence's runs rather than a personnel-name
 * search/underline pass, no multi-paragraph AI-section expansion) rather
 * than importing/sharing its private helpers, which the plan calls out as
 * a contract-reconcile trigger.
 *
 * Input is the plan's frozen snapshot envelope:
 *   { schemaVersion: 1, artifactType: 'pre-rp-brief', request, reviews }
 * `request` carries the composer's Dataverse-sourced fields; `reviews` is
 * the writeup roster (`getWriteupRoster({ requestId })` shape) used to
 * compose the referee paragraph via the same deterministic composers the
 * Reviews tab and Pre-Site writeup use
 * (shared/utils/review-writeup-paragraphs.js).
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import JSZip from 'jszip';
import {
  compareReviewersByName,
  composeReviewerSentence,
  composeScoreSentence,
} from '../../../shared/utils/review-writeup-paragraphs.js';
import { PRE_RP_BRIEF_CONTRACT } from '../../../shared/config/requestDocument.js';

// Single source of truth for the envelope identity is
// shared/config/requestDocument.js's PRE_RP_BRIEF_CONTRACT; re-exported here
// under renderer-local names so callers of this module don't also need to
// import the config module just to build/validate an envelope.
export const PRE_RP_BRIEF_ARTIFACT_TYPE = PRE_RP_BRIEF_CONTRACT.snapshotArtifactType;
export const PRE_RP_BRIEF_SNAPSHOT_SCHEMA_VERSION = PRE_RP_BRIEF_CONTRACT.snapshotSchemaVersion;

export const PRE_RP_BRIEF_TEMPLATE = Object.freeze({
  id: PRE_RP_BRIEF_CONTRACT.templateId,
  version: PRE_RP_BRIEF_CONTRACT.templateVersion,
  relativePath: 'shared/templates/pre-research-presentation-brief/brief-v1.docx',
});

const DV_PLACEHOLDERS = Object.freeze({
  institutionName: '[[DV:InstitutionName]]',
  projectTitle: '[[DV:ProjectTitle]]',
  principalInvestigator: '[[DV:PrincipalInvestigator]]',
  programDirector: '[[DV:ProgramDirector]]',
});

const ABSTRACT_PLACEHOLDER = '[[DV:Abstract]]';
const REFEREE_PLACEHOLDER = '[[STAFF:RefereeSentences]]';

const ALL_PLACEHOLDERS = Object.freeze([
  ...Object.values(DV_PLACEHOLDERS),
  ABSTRACT_PLACEHOLDER,
  REFEREE_PLACEHOLDER,
]);

// Canonical composer-input field lists for the fingerprint (plan §3.4a):
// request header fields + abstract, and per received review the suggestion
// id, received state, name, academic rank, overall rating, and the three
// institution-source fields the composers read.
export const REQUEST_FINGERPRINT_FIELDS = Object.freeze([
  'institutionName',
  'projectTitle',
  'principalInvestigator',
  'programDirector',
  'abstract',
]);

export const REVIEW_FINGERPRINT_FIELDS = Object.freeze([
  'suggestionId',
  'reviewReceivedAt',
  'name',
  'academicRank',
  'reviewerOverallAssessment',
  'reviewerAffiliation',
  'mainInstitution',
  'affiliation',
]);

function decodeXmlText(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

// XML 1.0 forbids these control characters outright; strip them before
// escaping the five reserved characters below.
function encodeXmlText(value) {
  return String(value ?? '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
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

function underlinedRunProperties(runProperties) {
  if (!runProperties) return '<w:rPr><w:u w:val="single"/></w:rPr>';
  if (/<w:u(?:\s[^>]*)?\/>/.test(runProperties)) {
    return runProperties.replace(/<w:u(?:\s[^>]*)?\/>/, '<w:u w:val="single"/>');
  }
  if (/<w:rPr(?:\s[^>]*)?\/>/.test(runProperties)) {
    return runProperties.replace(/<w:rPr(?:\s[^>]*)?\/>/, '<w:rPr><w:u w:val="single"/></w:rPr>');
  }
  return runProperties.replace(/<\/w:rPr>/, '<w:u w:val="single"/></w:rPr>');
}

/**
 * Replace a token that occupies a single standalone `<w:r>` run with one run
 * per segment, underlining the segments the caller marks. Used only for
 * `[[STAFF:RefereeSentences]]`, whose composed text mixes plain runs and
 * underlined reviewer names (composeReviewerSentence's contract).
 */
function replaceTokenRunWithSegments(paragraphXml, token, segments) {
  const runPattern = /<w:r(?:\s[^>]*)?>(?:(?!<\/w:r>)[\s\S])*?<\/w:r>/g;
  let found = false;
  const updated = paragraphXml.replace(runPattern, (runXml) => {
    if (found) return runXml;
    const textMatch = runXml.match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/);
    if (!textMatch || decodeXmlText(textMatch[1]) !== token) return runXml;
    found = true;
    const rPrMatch = runXml.match(/<w:rPr(?:\s[^>]*)?>[\s\S]*?<\/w:rPr>/);
    const baseRunProperties = rPrMatch ? rPrMatch[0] : '';
    return segments
      .filter((segment) => segment.text !== '')
      .map((segment) => {
        const runProperties = segment.underline
          ? underlinedRunProperties(baseRunProperties)
          : baseRunProperties;
        const space = /^\s|\s$/.test(segment.text) ? ' xml:space="preserve"' : '';
        return `<w:r>${runProperties}<w:t${space}>${encodeXmlText(segment.text)}</w:t></w:r>`;
      })
      .join('');
  });
  if (!found) throw new Error(`Template token not found as a standalone run: ${token}`);
  return updated;
}

/** Collapse line breaks (single or blank-line-separated) into spaces. */
function flattenMultilineText(value) {
  return String(value ?? '').replace(/\s*\r?\n\s*/g, ' ').trim();
}

function assertRequired(value, message) {
  if (!String(value ?? '').trim()) throw new Error(message);
}

function assertEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object') {
    throw new Error('Pre-RP Brief snapshot envelope is malformed: not an object.');
  }
  if (envelope.schemaVersion !== PRE_RP_BRIEF_SNAPSHOT_SCHEMA_VERSION) {
    throw new Error(`Pre-RP Brief snapshot envelope has an unsupported schemaVersion: ${envelope.schemaVersion}.`);
  }
  if (envelope.artifactType !== PRE_RP_BRIEF_ARTIFACT_TYPE) {
    throw new Error(`Pre-RP Brief snapshot envelope has an unexpected artifactType: ${envelope.artifactType}.`);
  }
  if (!envelope.request || typeof envelope.request !== 'object') {
    throw new Error('Pre-RP Brief snapshot envelope is malformed: request is missing.');
  }
  if (!Array.isArray(envelope.reviews)) {
    throw new Error('Pre-RP Brief snapshot envelope is malformed: reviews is not an array.');
  }
}

/** Only reviews with a received review (roster shape) compose into the brief. */
function submittedReviewsOf(reviews) {
  return reviews.filter((review) => !!review?.reviewReceivedAt);
}

/**
 * "We received N reviews with scores of ...  The reviewers were <u>Name</u>,
 * a professor at Institution; ..." — the same two deterministic composers
 * the Reviews tab and Pre-Site writeup use, concatenated as the plan
 * specifies (no expertise sentence, no themes, no quotations).
 */
function composeRefereeRunSegments(reviews) {
  const submitted = submittedReviewsOf(reviews);
  const scoreResult = composeScoreSentence(submitted);
  const reviewerResult = composeReviewerSentence(submitted);
  const segments = [];
  if (scoreResult.sentence) segments.push({ text: scoreResult.sentence });
  if (reviewerResult) {
    if (segments.length) segments.push({ text: ' ' });
    for (const run of reviewerResult.runs) {
      segments.push({ text: run.text, underline: !!run.underline });
    }
  }
  return segments;
}

function renderDocumentXml(xml, { request, refereeSegments }) {
  const counts = new Map();
  const updated = xml.replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g, (paragraphXml) => {
    let out = paragraphXml;
    for (const [key, placeholder] of Object.entries(DV_PLACEHOLDERS)) {
      const result = replaceAcrossTextNodes(out, placeholder, request[key]);
      if (result.count) counts.set(placeholder, (counts.get(placeholder) || 0) + result.count);
      out = result.xml;
    }
    const abstractResult = replaceAcrossTextNodes(
      out,
      ABSTRACT_PLACEHOLDER,
      flattenMultilineText(request.abstract),
    );
    if (abstractResult.count) {
      counts.set(ABSTRACT_PLACEHOLDER, (counts.get(ABSTRACT_PLACEHOLDER) || 0) + abstractResult.count);
    }
    out = abstractResult.xml;

    if (out.includes(REFEREE_PLACEHOLDER)) {
      out = replaceTokenRunWithSegments(out, REFEREE_PLACEHOLDER, refereeSegments);
      counts.set(REFEREE_PLACEHOLDER, (counts.get(REFEREE_PLACEHOLDER) || 0) + 1);
    }
    return out;
  });
  return { xml: updated, counts };
}

export function defaultPreRpBriefTemplatePath() {
  return path.join(process.cwd(), PRE_RP_BRIEF_TEMPLATE.relativePath);
}

/**
 * Render the Pre-Research Presentation Brief DOCX from the frozen snapshot
 * envelope. Fails closed (throws) on a malformed envelope or a missing
 * required Dataverse field — never renders a blank field.
 *
 * @param {{schemaVersion:number, artifactType:string, request:object, reviews:Array}} envelope
 * @param {{templateBuffer?: Buffer}} [options]
 * @returns {Promise<{docx: Buffer}>}
 */
export async function renderBrief(envelope, { templateBuffer = null } = {}) {
  assertEnvelope(envelope);
  const { request, reviews } = envelope;
  assertRequired(request.institutionName, 'Institution name is required to render the Pre-Research Presentation Brief.');
  assertRequired(request.projectTitle, 'Project title is required to render the Pre-Research Presentation Brief.');
  assertRequired(request.principalInvestigator, 'Principal investigator is required to render the Pre-Research Presentation Brief.');
  assertRequired(request.programDirector, 'Program director is required to render the Pre-Research Presentation Brief.');
  assertRequired(request.abstract, 'Add the abstract on the Reviews tab first.');

  const refereeSegments = composeRefereeRunSegments(reviews);
  const source = templateBuffer || await fs.readFile(defaultPreRpBriefTemplatePath());
  const zip = await JSZip.loadAsync(source);
  const documentPart = zip.file('word/document.xml');
  if (!documentPart) throw new Error('Pre-RP Brief template is missing word/document.xml.');
  const documentXml = await documentPart.async('string');
  const { xml: renderedXml, counts } = renderDocumentXml(documentXml, { request, refereeSegments });
  zip.file('word/document.xml', renderedXml, { createFolders: false });

  for (const [key, placeholder] of Object.entries(DV_PLACEHOLDERS)) {
    const count = counts.get(placeholder) || 0;
    if (count !== 1) throw new Error(`Expected exactly one template occurrence of ${placeholder}; found ${count}.`);
    void key;
  }
  const abstractCount = counts.get(ABSTRACT_PLACEHOLDER) || 0;
  if (abstractCount !== 1) throw new Error(`Expected exactly one template occurrence of ${ABSTRACT_PLACEHOLDER}; found ${abstractCount}.`);
  const refereeCount = counts.get(REFEREE_PLACEHOLDER) || 0;
  if (refereeCount !== 1) throw new Error(`Expected exactly one template occurrence of ${REFEREE_PLACEHOLDER}; found ${refereeCount}.`);

  const output = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });

  // Verify: no header/footer parts (B6), and every placeholder was fully
  // replaced (the referee token can legitimately vanish into zero runs when
  // there are no submitted reviews yet, so it is checked by `counts` above,
  // not by a post-render text scan).
  const check = await JSZip.loadAsync(output);
  const headerFooterParts = Object.keys(check.files).filter((name) => /^word\/(?:header|footer)\d+\.xml$/.test(name));
  if (headerFooterParts.length) {
    throw new Error(`Pre-RP Brief output must not contain header/footer parts; found: ${headerFooterParts.join(', ')}`);
  }
  const renderedDocumentXml = await check.file('word/document.xml').async('string');
  if (/<w:(?:header|footer)Reference\b/.test(renderedDocumentXml)) {
    throw new Error('Pre-RP Brief output must not reference a header/footer part.');
  }
  const joinedText = Array.from(renderedDocumentXml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g))
    .map((match) => decodeXmlText(match[1]))
    .join('');
  for (const placeholder of ALL_PLACEHOLDERS) {
    if (placeholder === REFEREE_PLACEHOLDER && refereeSegments.length === 0) continue;
    if (joinedText.includes(placeholder)) throw new Error(`Unfilled required template placeholder: ${placeholder}`);
  }

  return { docx: output };
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function canonicalRequest(request) {
  const canonical = {};
  for (const field of REQUEST_FINGERPRINT_FIELDS) canonical[field] = request?.[field] ?? null;
  return canonical;
}

function canonicalReview(review) {
  const canonical = {};
  for (const field of REVIEW_FINGERPRINT_FIELDS) canonical[field] = review?.[field] ?? null;
  return canonical;
}

/**
 * Canonical fingerprint of every composer input in the snapshot envelope
 * (plan §3.4a): received reviews only (same `submittedReviewsOf` filter
 * `renderBrief`'s composers apply — a non-received reviewer's suggestion
 * never reaches the rendered document, so it must not move the digest
 * either), stable object keys, reviews ordered by `compareReviewersByName`
 * (the same tie order the roster and writeup composers already use), sha256
 * hex digest. Pure — no I/O.
 *
 * @param {{schemaVersion:number, artifactType:string, request:object, reviews:Array}} envelope
 * @returns {string} lowercase 64-hex-character sha256 digest
 */
export function briefInputFingerprint(envelope) {
  assertEnvelope(envelope);
  const orderedReviews = submittedReviewsOf(envelope.reviews).sort(compareReviewersByName);
  const canonical = {
    schemaVersion: envelope.schemaVersion,
    artifactType: envelope.artifactType,
    request: canonicalRequest(envelope.request),
    reviews: orderedReviews.map(canonicalReview),
  };
  return crypto.createHash('sha256').update(stableStringify(canonical), 'utf8').digest('hex');
}
