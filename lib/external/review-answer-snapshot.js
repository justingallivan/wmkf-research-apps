/**
 * Shared write primitives for the `wmkf_appreviewanswer` snapshot child table.
 *
 * The external submit path (`pages/api/external/review/[token]/submit.js`) was
 * the first and originally ONLY writer of snapshot rows. Phase D adds two more
 * writers — the legacy staff upload paths (`lib/services/review-upload.js`,
 * `pages/api/review-manager/mark-received-no-file.js`) now also dual-write the
 * three rating rows so the snapshot is the complete system of record before the
 * DTO/prefill readers stop reading the parent rating columns (and a backfill
 * fills historical parent-only rows). Extracting the alternate-key upsert URL +
 * column body here keeps all three writers byte-identical so a row written by
 * the staff path is indistinguishable from one written by the reviewer.
 *
 * Row shape (one per answered question) — see build-review-submission.js:
 *   { questionKey, questionOrder, questionText, questionType,
 *     answerHtml: string|null, answerText: string, answerValue: number|null }
 */

import { labelForOption } from './review-form-schema.js';
import { bypassDynamicsRestrictions } from '../services/dynamics-context.js';
import { readRatingsBySuggestion as adapterReadRatingsBySuggestion } from '../dataverse/adapters/review-answer.js';
import * as odata from '../dataverse/core/odata.js';

// The canonical parent-bound rating keys, in display order. The snapshot is the
// system of record for these post-Phase-D; the parent columns are dual-written
// only until Phase E.
export const REVIEW_RATING_KEYS = ['impact', 'risk', 'overallRating'];

/**
 * Derive the three canonical ratings from a suggestion's answer snapshot rows.
 * Pure: pass an array of `{ questionKey, answerValue }` (the normalized shape the
 * reviewers DTO and a keyed child read both produce). A rating with no snapshot
 * row — an informal-feedback or never-rated review — comes back null, exactly as
 * the parent-column read did, so consumers render "not provided" unchanged.
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
 * The single-suggestion analogue of the reviewers DTO's keyed child read, for
 * paths that have a suggestion but not its answers loaded (the external review
 * context prefill). Returns the same `{impact,risk,overallRating}` (null when no
 * snapshot row) as `ratingsFromAnswers`.
 *
 * @param {string} suggestionId - a GUID (server-sourced; guarded before it
 *   reaches the OData filter).
 */
export async function readRatingsBySuggestion(suggestionId) {
  // Wave 3 (docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md): the query itself now
  // lives in lib/dataverse/adapters/review-answer.js (byte-mirrored: GUID
  // guard, select/filter shape, ratingsFromAnswers derivation). The adapter
  // does NOT wrap its own read in bypassDynamicsRestrictions by design
  // (restriction-context enforcement folds into the DAL at Stage 7), so this
  // caller keeps the wrapper here until then.
  return bypassDynamicsRestrictions('read-ratings-by-suggestion', () =>
    adapterReadRatingsBySuggestion(suggestionId),
  );
}

// Alternate-key lookup component in the upsert URL. The lookup must be addressed
// by its VALUE attribute (`_wmkf_appreviewersuggestion_value`), NOT the bare
// logical name or the navigation property — both of those are rejected with
// 0x80060888. [VERIFIED in prod via scripts/probe-altkey-upsert-changeset.mjs,
// S302: this form CREATEs on first upsert and UPDATEs idempotently on retry.]
export const ANSWER_KEY_LOOKUP_ATTR = '_wmkf_appreviewersuggestion_value';

/**
 * Single source for the alternate-key upsert URL of one answer row. The question
 * key goes into an OData single-quoted key predicate, so it is escaped by
 * doubling apostrophes (the OData rule — NOT percent-encoding, which Dataverse
 * does not decode inside a quoted literal). Keys are also asserted against the
 * schema allowlist so an unexpected value can't address the wrong row.
 */
export function answerRowUrl(entitySet, suggestionId, questionKey, snapshotKeys) {
  if (!snapshotKeys.has(questionKey)) {
    throw new Error(`answerRowUrl: "${questionKey}" is not a known snapshot question key`);
  }
  const literal = odata.escape(questionKey);
  return `${entitySet}(${ANSWER_KEY_LOOKUP_ATTR}=${suggestionId},wmkf_questionkey='${literal}')`;
}

/** Map one answerRow to the Dataverse column body for the upsert (key columns come from the URL). */
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
 * Build snapshot rows for the RATINGS, from a validated rating object keyed by
 * `field.key` (the `ratings` bucket of `validateReviewForm`). Used by the legacy
 * staff writers, which carry only affiliation + the picklist ratings — never the
 * narrative answers (those live in the uploaded PDF, not the form).
 *
 * Emits a row ONLY for a rating whose value is present: the
 * mark-received-no-file "informal feedback" scenario deliberately omits ratings
 * so they stay null and aggregates skip the row, and a partial staff entry may
 * carry only some.
 *
 * Mirrors the picklist branch of `buildReviewSubmission` exactly (questionKey/
 * order/text/type/answerText decode) so a staff-written row is identical to a
 * reviewer-written one. Post-Phase-E this no longer touches any parent column.
 *
 * @param {Object} ratings - values keyed by field.key, e.g. { impact: 3, risk: 2 }
 * @param {Array} questionSet - the active question set (field.key/order/label/options)
 * @returns {Array<{questionKey,questionOrder,questionText,questionType,answerHtml,answerText,answerValue}>}
 */
export function buildRatingSnapshotRows(ratings, questionSet) {
  const rows = [];
  if (!ratings || typeof ratings !== 'object') return rows;
  for (const field of questionSet) {
    if (field.type !== 'picklist') continue;
    const value = ratings[field.key];
    if (value === null || value === undefined) continue; // absent → no row (informal/partial)
    rows.push({
      questionKey: field.key,
      questionOrder: field.order,
      questionText: field.label,
      questionType: 'picklist',
      answerHtml: null,
      answerText: labelForOption(field, value) ?? '',
      answerValue: value,
    });
  }
  return rows;
}
