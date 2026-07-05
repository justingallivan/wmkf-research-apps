/**
 * Adapter: wmkf_appreviewanswers (reviewer answer-snapshot child table).
 *
 * One row per answered question for a `wmkf_appreviewersuggestion` engagement,
 * addressed by the alternate key (_wmkf_appreviewersuggestion_value, wmkf_questionkey).
 * Post-Phase-D this snapshot is the system of record for the reviewer ratings and
 * narrative answers.
 *
 * This adapter MIRRORS the read/write contracts that currently live in two
 * pre-existing modules; it does NOT modify them (Wave 3, one-caller-per-commit
 * conversion happens later):
 *   - reader semantics from `lib/services/review-answers.js`
 *     (`fetchAnswersBySuggestion`): keyed-child query, 20-id OR-chunking,
 *     fail-loud on the 5000-row cap, re-sanitized answerHtml, questionOrder sort.
 *   - alternate-key upsert URL/body + rating-read contracts from
 *     `lib/external/review-answer-snapshot.js` (`answerRowUrl`, `answerRowBody`,
 *     `readRatingsBySuggestion`, `ratingsFromAnswers`, `REVIEW_RATING_KEYS`).
 *
 * The alternate-key upsert URL addresses the lookup by its VALUE attribute
 * (`_wmkf_appreviewersuggestion_value`), NOT the bare logical name or the
 * navigation property — both are rejected with 0x80060888.
 * [VERIFIED in prod via scripts/probe-altkey-upsert-changeset.mjs, S302.]
 *
 * NOTE on restriction context: the live `readRatingsBySuggestion` wraps its read
 * in `withDalContext(...)`. That wrapper is deliberately NOT mirrored
 * here — restriction-context enforcement folds into the DAL at Stage 7. This
 * adapter calls the transport directly, exactly like the other Wave-2 adapters.
 */

import { DynamicsService } from '../../services/dynamics-service.js';
import { isGuid } from '../../utils/guid.js';
import { sanitizeReviewHtml } from '../../external/sanitize-review-html.js';
import * as odata from '../core/odata.js';
import { entitySet } from '../core/entity-registry.js';
import { adapterError } from '../core/errors.js';
import { chunk as chunked } from '../../utils/chunk.js';

const ENTITY_SET = entitySet('wmkf_appreviewanswers');

// Local projection (no primary SELECT is registered for this entity in the
// registry — kept local per Wave 3 merge-conflict-avoidance). Byte-identical to
// review-answers.js#ANSWER_FIELDS.
const ANSWER_FIELDS = [
  'wmkf_questionkey',
  'wmkf_questionorder',
  'wmkf_questiontext',
  'wmkf_questiontype',
  'wmkf_answerhtml',
  'wmkf_answertext',
  'wmkf_answervalue',
  '_wmkf_appreviewersuggestion_value',
];

// Alternate-key lookup component in the upsert URL (see header). Mirrors
// review-answer-snapshot.js#ANSWER_KEY_LOOKUP_ATTR.
export const ANSWER_KEY_LOOKUP_ATTR = '_wmkf_appreviewersuggestion_value';

// The canonical parent-bound rating keys, in display order. Mirrors
// review-answer-snapshot.js#REVIEW_RATING_KEYS.
export const REVIEW_RATING_KEYS = ['impact', 'risk', 'overallRating'];

export { ANSWER_FIELDS };
export const ENTITY_SET_NAME = ENTITY_SET;

/**
 * Read the report-ready answer snapshot for a set of submitted suggestions,
 * keyed by suggestion GUID, each list ordered by questionOrder. Mirrors the
 * reader in `lib/services/review-answers.js#fetchAnswersBySuggestion` exactly:
 * 20-id OR-chunking (bounds the OR-chain URL length; pagination handles row
 * volume), fail-loud on the 5000-row cap, and answerHtml RE-SANITIZED on read
 * (defense in depth — the read is the last server step before render).
 *
 * @param {string[]} suggestionIds
 * @returns {Promise<Record<string, Array<{questionKey,questionOrder,questionText,questionType,answerHtml,answerText,answerValue}>>>}
 */
export async function fetchAnswersBySuggestion(suggestionIds) {
  if (!suggestionIds?.length) return {};
  const out = {};
  const CHUNK = 20;
  for (const chunk of chunked(suggestionIds, CHUNK)) {
    const orChain = odata.or(
      chunk.map((id) => odata.eqRaw(ANSWER_KEY_LOOKUP_ATTR, id)),
    );
    const { records, capped } = await DynamicsService.queryAllRecords(ENTITY_SET, {
      select: odata.select(ANSWER_FIELDS),
      filter: orChain,
      orderby: 'wmkf_questionorder',
    });
    if (capped) {
      throw new Error(
        `fetchAnswersBySuggestion: queryAllRecords truncated at the 5000-row cap for ${chunk.length} suggestion(s) — answer snapshot would be incomplete.`,
      );
    }
    for (const a of records) {
      const sid = a._wmkf_appreviewersuggestion_value;
      if (!sid) continue;
      (out[sid] ||= []).push({
        questionKey: a.wmkf_questionkey || null,
        questionOrder: a.wmkf_questionorder ?? null,
        questionText: a.wmkf_questiontext || '',
        questionType: a.wmkf_questiontype || '',
        answerHtml: a.wmkf_answerhtml ? sanitizeReviewHtml(a.wmkf_answerhtml) : '',
        answerText: a.wmkf_answertext || '',
        answerValue: a.wmkf_answervalue ?? null,
      });
    }
  }
  for (const sid of Object.keys(out)) {
    out[sid].sort((x, y) => (x.questionOrder ?? 0) - (y.questionOrder ?? 0));
  }
  return out;
}

/**
 * Derive the three canonical ratings from a suggestion's answer snapshot rows.
 * Pure. A rating with no snapshot row comes back null. Mirrors
 * review-answer-snapshot.js#ratingsFromAnswers.
 *
 * @param {Array<{questionKey:string, answerValue:(number|null)}>} answers
 * @returns {{ impact: number|null, risk: number|null, overallRating: number|null }}
 */
export function ratingsFromAnswers(answers) {
  const out = { impact: null, risk: null, overallRating: null };
  if (!Array.isArray(answers)) return out;
  for (const a of answers) {
    if (a && Object.prototype.hasOwnProperty.call(out, a.questionKey)) {
      out[a.questionKey] = a.answerValue ?? null;
    }
  }
  return out;
}

/**
 * Read the three canonical ratings for ONE suggestion from the answer snapshot.
 * Mirrors review-answer-snapshot.js#readRatingsBySuggestion, minus the
 * bypassDynamicsRestrictions wrapper (restriction context is Stage 7).
 *
 * @param {string} suggestionId - a GUID (server-sourced; guarded before it
 *   reaches the OData filter).
 * @returns {Promise<{impact:number|null, risk:number|null, overallRating:number|null}>}
 */
export async function readRatingsBySuggestion(suggestionId) {
  if (!isGuid(suggestionId)) {
    throw adapterError('readRatingsBySuggestion: suggestionId must be a GUID');
  }
  const { records } = await DynamicsService.queryAllRecords(ENTITY_SET, {
    select: odata.select(['wmkf_questionkey', 'wmkf_answervalue']),
    filter: odata.eqRaw(ANSWER_KEY_LOOKUP_ATTR, suggestionId),
  });
  return ratingsFromAnswers(
    (records || []).map((r) => ({
      questionKey: r.wmkf_questionkey,
      answerValue: r.wmkf_answervalue ?? null,
    })),
  );
}

/**
 * Alternate-key predicate for one answer row: the text INSIDE the parens of the
 * upsert URL. The question key goes into an OData single-quoted key predicate, so
 * an embedded apostrophe is escaped by doubling it (the OData rule — NOT
 * percent-encoding, which Dataverse does not decode inside a quoted literal). The
 * key is asserted against the schema allowlist so an unexpected value can't
 * address the wrong row. Mirrors review-answer-snapshot.js#answerRowUrl's
 * predicate construction.
 *
 * @param {string} suggestionId - GUID (server-sourced; interpolated raw as the
 *   lookup value, exactly like the live writer).
 * @param {string} questionKey
 * @param {Set<string>} snapshotKeys - the active question-set allowlist.
 * @returns {string} e.g. `_wmkf_appreviewersuggestion_value=<guid>,wmkf_questionkey='q2'`
 */
export function answerRowKeyPredicate(suggestionId, questionKey, snapshotKeys) {
  if (!snapshotKeys || !snapshotKeys.has(questionKey)) {
    throw adapterError(`answerRowKeyPredicate: "${questionKey}" is not a known snapshot question key`);
  }
  const literal = odata.escape(questionKey);
  return `${ANSWER_KEY_LOOKUP_ATTR}=${suggestionId},wmkf_questionkey='${literal}'`;
}

/**
 * Full alternate-key upsert URL for one answer row. Mirrors
 * review-answer-snapshot.js#answerRowUrl (which took the resolved entity set as
 * an argument; here the set comes from the registry).
 */
export function answerRowUrl(suggestionId, questionKey, snapshotKeys) {
  return `${ENTITY_SET}(${answerRowKeyPredicate(suggestionId, questionKey, snapshotKeys)})`;
}

/** Map one answerRow to the Dataverse column body for the upsert (key columns come from the URL). Mirrors review-answer-snapshot.js#answerRowBody. */
export function answerRowBody(row) {
  return {
    wmkf_questionorder: row.questionOrder,
    wmkf_questiontext: row.questionText,
    wmkf_questiontype: row.questionType,
    wmkf_answerhtml: row.answerHtml,
    wmkf_answertext: row.answerText,
    wmkf_answervalue: row.answerValue,
  };
}

/**
 * Build a DAL/core changeset operation descriptor for one answer-row upsert. The
 * descriptor names its entity set and the alternate-key predicate; the core
 * changeset helper validates the entity set and assembles the final URL. This is
 * how a caller composes the atomic parent+answers write (see
 * lib/dataverse/core/changeset.js#atomicParentWithChildren).
 *
 * @returns {{method:'PATCH', entitySet:string, keyPredicate:string, body:object}}
 */
export function answerUpsertDescriptor(suggestionId, row, snapshotKeys) {
  return {
    method: 'PATCH',
    entitySet: ENTITY_SET,
    keyPredicate: answerRowKeyPredicate(suggestionId, row.questionKey, snapshotKeys),
    body: answerRowBody(row),
  };
}

/**
 * Business-filter paginated-scan passthrough — mirrors
 * DynamicsService.queryAllRecords arg-for-arg, exactly like grant-request.js's
 * queryAllRequests. Serves synthesize-reviews.js's plain-metadata answer-text
 * read, which uses a different select (no answerHtml) and no sanitization than
 * fetchAnswersBySuggestion (the report-renderer reader above), so it isn't a
 * byte-mirror of that method and doesn't consolidate into it.
 */
export async function queryAllAnswers(options) {
  return DynamicsService.queryAllRecords(ENTITY_SET, options);
}
