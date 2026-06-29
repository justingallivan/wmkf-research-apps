/**
 * ReviewQuestionFetcher — resolves the active external-reviewer review-form
 * question set from Dataverse (`wmkf_reviewquestion`).
 *
 * Replaces the former static `lib/external/review-form-schema.js` array as the
 * system of record for WHICH questions the review form asks. Pattern mirrors
 * PolicyFetcher: a process-local 5-minute cache + single-flight, and it
 * **fails closed** — if Dataverse is unreachable or the stored set is empty or
 * structurally invalid, callers get a thrown error and surface a failure rather
 * than rendering a degraded/partial form against an unknown question set.
 *
 * The cache and `invalidate()` are module-local (same as PolicyFetcher), so a
 * staff edit that calls `invalidate()` takes effect immediately *in that
 * process*; other serverless instances pick up the change within the TTL
 * (≤5 min). This is acceptable for a rarely-edited question set.
 *
 * `getActiveQuestionSet()` returns questions in the SAME normalized field shape
 * the static schema produced (`{ key, order, label, type, required, maxLength?,
 * hint?, options? }`) and ordered by `wmkf_questionorder`, so downstream
 * validators/renderers change as little as possible during the Phase B
 * migration.
 */

import { DynamicsService } from '../services/dynamics-service.js';
import { bypassDynamicsRestrictions } from '../services/dynamics-context.js';

const CACHE_TTL_MS = 5 * 60 * 1000;
const ENTITY_SET = 'wmkf_reviewquestions';
const SUPPORTED_TYPES = new Set(['picklist', 'richtext', 'string']);
// Keys are stable ids; allow a leading lowercase letter then alphanumerics/_
// (the live `overallRating` key is intentionally camelCase).
const KEY_RE = /^[a-z][a-zA-Z0-9_]*$/;

let cache = null;        // { fetchedAt, questions }
let inFlight = null;     // Promise<questions> — single-flight guard

const SELECT = [
  'wmkf_reviewquestionid',
  'wmkf_questionkey',
  'wmkf_questionorder',
  'wmkf_questiontext',
  'wmkf_questiontype',
  'wmkf_required',
  'wmkf_maxlength',
  'wmkf_hint',
  'wmkf_options',
].join(',');

/**
 * Normalize one Dataverse row into the schema field shape. Throws if the row is
 * structurally unusable (the set-level sanity check turns that into a
 * fail-closed error for the whole fetch).
 */
function normalizeRow(row) {
  const key = row.wmkf_questionkey;
  const type = row.wmkf_questiontype;
  const label = row.wmkf_questiontext;

  if (typeof key !== 'string' || !KEY_RE.test(key)) {
    throw new Error(`ReviewQuestionFetcher: invalid question key ${JSON.stringify(key)}`);
  }
  if (!SUPPORTED_TYPES.has(type)) {
    throw new Error(`ReviewQuestionFetcher: question '${key}' has unsupported type ${JSON.stringify(type)}`);
  }
  if (typeof label !== 'string' || label.trim().length === 0) {
    throw new Error(`ReviewQuestionFetcher: question '${key}' has empty question text`);
  }
  const order = row.wmkf_questionorder;
  if (!Number.isFinite(order)) {
    throw new Error(`ReviewQuestionFetcher: question '${key}' has non-numeric order`);
  }

  const field = {
    key,
    order,
    label,
    type,
    required: row.wmkf_required === true,
  };

  if (Number.isFinite(row.wmkf_maxlength)) field.maxLength = row.wmkf_maxlength;
  if (typeof row.wmkf_hint === 'string' && row.wmkf_hint.trim().length > 0) {
    field.hint = row.wmkf_hint;
  }

  if (type === 'picklist') {
    let parsed;
    try {
      parsed = JSON.parse(row.wmkf_options || 'null');
    } catch {
      throw new Error(`ReviewQuestionFetcher: question '${key}' has unparseable options JSON`);
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error(`ReviewQuestionFetcher: picklist question '${key}' has no options`);
    }
    const options = parsed.map((o) => {
      const value = typeof o?.value === 'string' ? parseInt(o.value, 10) : o?.value;
      if (!Number.isFinite(value) || typeof o?.label !== 'string' || o.label.length === 0) {
        throw new Error(`ReviewQuestionFetcher: picklist question '${key}' has a malformed option`);
      }
      return { value, label: o.label };
    });
    field.options = options;
  }

  return field;
}

/**
 * Set-level sanity. Throws (fail-closed) on anything that would make the form
 * render or validate incorrectly. Mirrors PolicyFetcher's active-child sanity.
 */
function validateSet(questions) {
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error('ReviewQuestionFetcher: active question set is empty');
  }
  const seen = new Set();
  for (const q of questions) {
    if (seen.has(q.key)) {
      throw new Error(`ReviewQuestionFetcher: duplicate question key '${q.key}'`);
    }
    seen.add(q.key);
  }
}

async function fetchActiveQuestionSet() {
  return bypassDynamicsRestrictions('review-question-fetcher', async () => {
    const { records } = await DynamicsService.queryRecords(ENTITY_SET, {
      select: SELECT,
      filter: 'statecode eq 0',
      orderby: 'wmkf_questionorder',
      top: 100,
    });
    const questions = (records || []).map(normalizeRow);
    validateSet(questions);
    return questions;
  });
}

/**
 * Resolve the active question set, cached for up to 5 minutes. Single-flight:
 * concurrent calls during a cold/expired cache share one Dataverse round-trip.
 *
 * @returns {Promise<Array<{ key, order, label, type, required, maxLength?, hint?, options? }>>}
 * @throws if Dataverse is unreachable or the stored set is empty/invalid (fail-closed).
 */
export async function getActiveQuestionSet() {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.questions;
  }
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const questions = await fetchActiveQuestionSet();
      cache = { fetchedAt: Date.now(), questions };
      return questions;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * Drop the cache. Called by the admin save route after a question-set edit so
 * the saving process serves the new set immediately. Process-local only.
 */
export function invalidate() {
  cache = null;
}
