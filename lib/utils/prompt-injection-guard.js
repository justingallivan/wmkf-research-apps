/**
 * Prompt-injection guard — wraps untrusted document content in standardized
 * delimiters before the text is passed to an LLM.
 *
 * Threat model and the reasoning chain that produced this minimal response
 * live in docs/PROMPT_INJECTION_DEFENSE_PLAN.md. Short version: the response
 * is baseline prompt hygiene, not detection.
 *
 * Pair this with the system-prompt preamble at
 * shared/config/prompts/_injection-guard-preamble.js — wrapping without the
 * preamble does not assert a data/instruction boundary to the model.
 */

import crypto from 'crypto';
import { INJECTION_GUARD_PREAMBLE } from '../../shared/config/prompts/_injection-guard-preamble.js';

const OPEN_TAG = 'untrusted_document';

export function wrapDocumentContent(text, { source, filename, includePreamble = true } = {}) {
  if (typeof text !== 'string') {
    throw new TypeError('wrapDocumentContent: text must be a string');
  }

  const safeSource = encodeAttr(source);
  const safeFilename = encodeAttr(filename);
  const nonce = crypto.randomBytes(2).toString('hex');
  const closeTag = `${OPEN_TAG}-${nonce}`;

  const escaped = escapeBody(text, closeTag);

  const wrapper =
    `<${OPEN_TAG} source="${safeSource}" filename="${safeFilename}">\n` +
    `${escaped}\n` +
    `</${closeTag}>`;

  if (!includePreamble) return wrapper;

  return `${INJECTION_GUARD_PREAMBLE}\n\n${wrapper}`;
}

function encodeAttr(value) {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeBody(text, closeTag) {
  // Defeat both the predictable open-tag-name close-string and (defensively)
  // the nonced close-string in case any document content happens to predict
  // the nonce — vanishingly unlikely but the encoding is cheap.
  return text
    .replace(new RegExp(`</${OPEN_TAG}>`, 'gi'), `&lt;/${OPEN_TAG}&gt;`)
    .replace(new RegExp(`</${closeTag}>`, 'gi'), `&lt;/${closeTag}&gt;`);
}
