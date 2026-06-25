/**
 * Parse the applicant-supplied `akoya_request.wmkf_excludedreviewers` free-text
 * field into clean reviewer names for the Reviewer Finder search soft-block
 * (Request Workbench Phase 3, option B — soft-block only, no structured
 * `disposition=excluded` junction rows this round).
 *
 * The field is heterogeneous (S209 probe, `[[project-d26-reviewer-inputs-probe]]`):
 *   - structured "Name: <x>\nReason for Exclusion: <y>" blocks,
 *   - free prose with embedded affiliations + honorifics
 *     ("exclude Drs. Thomas K. Wood (Penn State) and Jens Hör (Helmholtz)"),
 *   - and mostly null-equivalent noise ("N/A", "none", "N/a.").
 *
 * Two-step:
 *   1. `isSubstantiveExclusionText` — a pure, deterministic noise filter so the
 *      ~30/35 requests with no real excludes never make an LLM call.
 *   2. `extractExcludedReviewers` — a single hardened (A7-wrapped) Claude call
 *      that pulls names + optional affiliations out of the heterogeneous prose.
 *      The free-text is applicant-controlled → wrapped as UNTRUSTED data.
 */

import { LLMClient } from './llm-client.js';
import { getModelForApp, getFallbackModelForApp } from '../../shared/config/baseConfig';
import {
  DATA_CLASSES,
  wrapUntrustedContent,
  buildUntrustedContentPreamble,
} from '../utils/ai-payload-boundary.js';

// Generous cap — this field is short by nature, but bound it like every other
// untrusted-text surface (A7).
export const EXCLUDED_REVIEWERS_MAX_CHARS = 8_000;

// Null-equivalent values applicants type when they have no one to exclude.
// Compared after lowercasing + stripping surrounding punctuation/whitespace.
const NOISE_VALUES = new Set(['', 'n/a', 'na', 'none', 'no', 'nil', 'n.a', 'not applicable', 'none.']);

/**
 * True if the raw free-text contains a real exclusion (worth an LLM extraction).
 * Pure + deterministic — safe to unit-test and to gate the LLM call on.
 */
export function isSubstantiveExclusionText(raw) {
  if (raw == null) return false;
  const trimmed = String(raw).trim();
  if (!trimmed) return false;
  // Normalize for the noise check: lowercase, collapse whitespace, drop a
  // trailing period and surrounding quotes/parens. Keep internal slashes so
  // "n/a" is matched as a unit.
  const normalized = trimmed
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^["'(]+|["').]+$/g, '')
    .trim();
  if (NOISE_VALUES.has(normalized)) return false;
  // Require at least one alphabetic run of 2+ chars so stray punctuation
  // ("-", "—", ".") doesn't count as substantive.
  if (!/[a-z]{2,}/i.test(normalized)) return false;
  return true;
}

function buildExtractionPrompt(wrappedText, nonce) {
  return [
    buildUntrustedContentPreamble([nonce]),
    '',
    'TASK: An applicant listed people who should NOT review their grant proposal',
    '(competitors, collaborators, or conflicts). Extract each excluded person as',
    'a structured entry. The text may be a tidy list, labeled "Name:/Reason:"',
    'blocks, or free prose with honorifics ("Drs.") and parenthetical',
    'affiliations. Pull the PERSON NAMES out regardless of format.',
    '',
    'RULES:',
    '- Output ONLY a JSON array, no prose, no markdown fences.',
    '- Each element: {"name": "<full person name, no honorific>", "affiliation": "<institution or null>"}.',
    '- Strip honorifics (Dr., Prof., Professor) from the name.',
    '- If the text names no actual people (e.g. it just says "N/A" or gives a',
    '  reason with no name), output an empty array [].',
    '- Do not invent names. Only extract people explicitly mentioned.',
    '',
    'EXCLUDED-REVIEWERS TEXT (untrusted data):',
    wrappedText,
    '',
    'JSON array:',
  ].join('\n');
}

/**
 * Parse the model's response into a deduped `[{name, affiliation}]` array.
 * Tolerant of markdown fences and leading/trailing chatter. Exported for tests.
 */
export function parseJsonArray(text) {
  if (!text) return [];
  let s = String(text).trim();
  // Strip markdown code fences if the model added them.
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  // Grab the first bracketed array if there's leading/trailing chatter.
  const start = s.indexOf('[');
  const end = s.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return [];
  const slice = s.slice(start, end + 1);
  let arr;
  try {
    arr = JSON.parse(slice);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const out = [];
  const seen = new Set();
  for (const el of arr) {
    const name = el && typeof el.name === 'string' ? el.name.trim() : '';
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const affiliation = el && typeof el.affiliation === 'string' && el.affiliation.trim()
      ? el.affiliation.trim()
      : null;
    out.push({ name, affiliation });
  }
  return out;
}

/**
 * Extract excluded reviewer names from the applicant free-text.
 *
 * @param {string} rawText - `wmkf_excludedreviewers` value.
 * @param {object} [opts]
 * @param {string} [opts.apiKey] - CLAUDE_API_KEY override.
 * @param {number|null} [opts.userProfileId] - for usage attribution.
 * @returns {Promise<{ names: Array<{name: string, affiliation: string|null}>, substantive: boolean, parseFailed: boolean }>}
 *   `substantive=false` short-circuits with no LLM call. `parseFailed=true` means
 *   the LLM ran but its output couldn't be parsed (treated as no names; logged).
 */
export async function extractExcludedReviewers(rawText, { apiKey, userProfileId = null } = {}) {
  if (!isSubstantiveExclusionText(rawText)) {
    return { names: [], substantive: false, parseFailed: false };
  }

  const wrapped = wrapUntrustedContent({
    text: rawText,
    source: 'workbench.applicant-reviewers.excludedReviewers',
    dataClass: DATA_CLASSES.CRM_RECORD_TEXT,
    maxChars: EXCLUDED_REVIEWERS_MAX_CHARS,
    label: 'applicant excluded-reviewers list',
  });

  const prompt = buildExtractionPrompt(wrapped.text, wrapped.nonce);

  // Own model namespace ('reviewer-exclusion' → Haiku), NOT 'reviewer-finder':
  // this is a cheap deterministic name-parse and must not ride the Opus
  // origination model (which also ignores the temperature:0 below). See S286.
  const primary = getModelForApp('reviewer-exclusion');
  const fallback = getFallbackModelForApp('reviewer-exclusion');
  const client = new LLMClient({
    apiKey: apiKey || process.env.CLAUDE_API_KEY,
    model: primary,
    fallbackModel: fallback && fallback !== primary ? fallback : null,
    appName: 'reviewer-exclusion',
    userProfileId,
  });

  const { text } = await client.complete({
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 1024,
    temperature: 0,
  });

  const names = parseJsonArray(text);
  // The model returning [] for a substantive-looking input is legitimate (a
  // reason with no name). parseFailed flags only an unparseable response.
  const parseFailed = names.length === 0 && !!text && !/\[\s*\]/.test(String(text));
  return { names, substantive: true, parseFailed };
}
