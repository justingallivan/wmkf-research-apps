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

import { createHash } from 'crypto';
import { withDalContext } from '../dataverse/core/context.js';
import { queryActiveQuestions } from '../dataverse/adapters/review-question.js';

const CACHE_TTL_MS = 5 * 60 * 1000;
const SUPPORTED_TYPES = new Set(['picklist', 'multiselect', 'richtext', 'string']);
// Keys are stable ids; allow a leading lowercase letter then alphanumerics/_
// (live keys such as `overallAssessment` are intentionally camelCase).
const KEY_RE = /^[a-z][a-zA-Z0-9_]*$/;

let cache = null;        // { fetchedAt, questions }
let inFlight = null;     // Promise<questions> — single-flight guard
let generation = 0;      // bumped by invalidate(); guards stale in-flight writes

/**
 * Normalize one Dataverse row into the schema field shape. Throws if the row is
 * structurally unusable (the set-level sanity check turns that into a
 * fail-closed error for the whole fetch).
 *
 * Exported so the admin save route (pages/api/admin/review-questions.js) can
 * normalize the current set IDENTICALLY before hashing it with
 * questionSetVersion() — the optimistic-concurrency token the admin GET hands
 * the editor must match the one the reviewer flow computes, or a stale-save
 * 409 would never fire / always fire.
 */
export function normalizeRow(row) {
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

  // Fail closed on a missing/non-boolean required flag rather than silently
  // treating it as optional (the schema defaults it to required).
  if (typeof row.wmkf_required !== 'boolean') {
    throw new Error(`ReviewQuestionFetcher: question '${key}' has a non-boolean required flag`);
  }

  const field = {
    key,
    order,
    label,
    type,
    required: row.wmkf_required,
  };

  if (Number.isFinite(row.wmkf_maxlength)) field.maxLength = row.wmkf_maxlength;
  if (typeof row.wmkf_hint === 'string' && row.wmkf_hint.trim().length > 0) {
    field.hint = row.wmkf_hint;
  }

  if (type === 'picklist' || type === 'multiselect') {
    let parsed;
    try {
      parsed = JSON.parse(row.wmkf_options || 'null');
    } catch {
      throw new Error(`ReviewQuestionFetcher: question '${key}' has unparseable options JSON`);
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error(`ReviewQuestionFetcher: ${type} question '${key}' has no options`);
    }
    const seenValues = new Set();
    const options = parsed.map((o) => {
      let value = o?.value;
      // Strict integer: a string value must be a pure integer literal (reject
      // "4abc" which parseInt would silently coerce to 4).
      if (typeof value === 'string') {
        if (!/^-?\d+$/.test(value.trim())) {
          throw new Error(`ReviewQuestionFetcher: ${type} question '${key}' has a non-integer option value`);
        }
        value = parseInt(value.trim(), 10);
      }
      if (!Number.isInteger(value) || typeof o?.label !== 'string' || o.label.length === 0) {
        throw new Error(`ReviewQuestionFetcher: ${type} question '${key}' has a malformed option`);
      }
      if (seenValues.has(value)) {
        throw new Error(`ReviewQuestionFetcher: ${type} question '${key}' has duplicate option value ${value}`);
      }
      seenValues.add(value);
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
  const seenKeys = new Set();
  const seenOrders = new Set();
  for (const q of questions) {
    if (seenKeys.has(q.key)) {
      throw new Error(`ReviewQuestionFetcher: duplicate question key '${q.key}'`);
    }
    seenKeys.add(q.key);
    // Duplicate orders make the form sequence + the snapshot order ambiguous;
    // reject rather than rely on an unstable Dataverse sort tiebreak.
    if (seenOrders.has(q.order)) {
      throw new Error(`ReviewQuestionFetcher: duplicate question order ${q.order} (key '${q.key}')`);
    }
    seenOrders.add(q.order);
  }
}

async function fetchActiveQuestionSet() {
  return withDalContext('review-question-fetcher', async () => {
    const { records, totalCount, hasMore } = await queryActiveQuestions();
    // queryRecords caps $top at 100. If the active set ever exceeds that, fail
    // closed rather than silently serving a truncated form.
    if (hasMore || (Number.isFinite(totalCount) && totalCount > (records || []).length)) {
      throw new Error(
        `ReviewQuestionFetcher: active question set exceeds the 100-row fetch cap (count=${totalCount}); refusing to serve a partial set`,
      );
    }
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

  // Capture the generation at fetch start. If invalidate() bumps it while this
  // fetch is in flight (e.g. an admin save lands mid-fetch), we must NOT write
  // the now-stale result into the cache — otherwise the pre-edit set would be
  // served for up to the full TTL. Awaiters of this in-flight promise still get
  // this fetch's value once (acceptable); the next call refetches fresh.
  const startGen = generation;
  inFlight = (async () => {
    try {
      const questions = await fetchActiveQuestionSet();
      if (generation === startGen) {
        cache = { fetchedAt: Date.now(), questions };
      }
      return questions;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * Resolve the active question set WITHOUT consulting the cache, then refresh the
 * cache with the result.
 *
 * Use this at every WRITE boundary — anywhere the resolved set decides what gets
 * persisted or whether a client's `setVersion` is still current. `getActiveQuestionSet`
 * is process-local and may be up to CACHE_TTL_MS stale, and `invalidate()` only
 * clears the process that receives it. On multi-instance serverless that means an
 * admin publication leaves other instances serving the previous set for the rest of
 * their TTL. For a render that is merely a stale form; at a write boundary it is a
 * correctness failure, because the submitting instance compares the client's version
 * against its OWN stale set — both sides agree, the `set_changed` guard passes, and
 * rows commit against a question set that is no longer live.
 *
 * Reads (context, draft validation, the workbench's `liveQuestions`) deliberately
 * keep using the cached resolver: a slightly stale render is self-correcting, because
 * the write boundary re-checks authoritatively and returns `set_changed`.
 *
 * Costs one Dataverse round-trip per submit. Submits are rare relative to renders.
 *
 * @returns {Promise<Array>} the live question set
 * @throws the same fail-closed errors as getActiveQuestionSet
 */
export async function getAuthoritativeQuestionSet() {
  // Same generation guard as the cached path: if invalidate() lands while this
  // fetch is in flight, don't write a possibly-superseded result into the cache.
  const startGen = generation;
  const questions = await fetchActiveQuestionSet();
  if (generation === startGen) {
    cache = { fetchedAt: Date.now(), questions };
  }
  return questions;
}

/**
 * Drop the cache. Called by the admin save route after a question-set edit so
 * the saving process serves the new set immediately. Process-local only —
 * see getAuthoritativeQuestionSet for why write paths must not rely on this
 * having reached them.
 * Bumps the generation so any in-flight pre-edit fetch can't repopulate cache.
 */
export function invalidate() {
  generation += 1;
  cache = null;
}

/**
 * A stable, opaque version string for a question set — a hash over the fields
 * that affect form rendering/validation (key, type, required, order, options,
 * maxLength). `context.js` returns it to the client; the client echoes it back
 * on submit, and submit returns a `set_changed` reload signal if it no longer
 * matches the live set (Codex Phase-A/plan P1). Order-insensitive (sorted by
 * key) so a pure reorder still changes the hash via the `order` field but the
 * comparison is deterministic regardless of row arrival order.
 *
 * @param {Array} fields - the normalized question set (getActiveQuestionSet output)
 * @returns {string} 16-hex-char version tag
 */
export function questionSetVersion(fields) {
  const canonical = (fields || [])
    .map((f) => ({
      key: f.key,
      type: f.type,
      required: f.required === true,
      order: f.order,
      maxLength: f.maxLength ?? null,
      // label + hint are part of the version: the submit snapshot persists
      // `questionText = field.label` (build-review-submission.js), so a staff
      // edit to the wording must invalidate an in-flight session (409
      // set_changed) — otherwise the answer is recorded against text the
      // reviewer never saw (Codex Phase B P1-A).
      label: f.label ?? null,
      hint: f.hint ?? null,
      options: Array.isArray(f.options) ? f.options.map((o) => [o.value, o.label]) : null,
    }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return createHash('sha1').update(JSON.stringify(canonical)).digest('hex').slice(0, 16);
}
