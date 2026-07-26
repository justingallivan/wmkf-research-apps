/**
 * Shared write primitives for the `wmkf_appreviewanswer` snapshot child table.
 *
 * The portal, manual-entry, upload, and no-file services share these primitives
 * so staff-written rating and multiselect rows are indistinguishable from
 * reviewer-written rows.
 *
 * Row shape (one per answered question) — see build-review-submission.js:
 *   { questionKey, questionOrder, questionText, questionType,
 *     answerHtml: string|null, answerText: string, answerValue: number|null,
 *     answerValues: Array<{value:number,label:string}>|null }
 */

import { labelForOption } from './review-form-schema.js';
import { readRatingsBySuggestion as adapterReadRatingsBySuggestion } from '../dataverse/adapters/review-answer.js';
import * as odata from '../dataverse/core/odata.js';

// The canonical snapshot rating keys, in display order.
export const REVIEW_RATING_KEYS = ['riskLevel', 'overallAssessment'];

/**
 * Derive the two canonical ratings from a suggestion's answer snapshot rows.
 * Pure: pass an array of `{ questionKey, answerValue }` (the normalized shape the
 * reviewers DTO and a keyed child read both produce). A rating with no snapshot
 * row — an informal-feedback or never-rated review — comes back null, exactly as
 * the parent-column read did, so consumers render "not provided" unchanged.
 *
 * @param {Array<{questionKey:string, answerValue:(number|null)}>} answers
 * @returns {{ riskLevel: number|null, overallAssessment: number|null }}
 */
export function ratingsFromAnswers(answers) {
  const out = { riskLevel: null, overallAssessment: null };
  if (!Array.isArray(answers)) return out;
  for (const a of answers) {
    if (a && Object.prototype.hasOwnProperty.call(out, a.questionKey)) {
      out[a.questionKey] = a.answerValue ?? null;
    }
  }
  return out;
}

/**
 * Read the two canonical ratings for ONE suggestion from the answer snapshot.
 * The single-suggestion analogue of the reviewers DTO's keyed child read, for
 * paths that have a suggestion but not its answers loaded (the external review
 * context prefill). Returns the same `{riskLevel,overallAssessment}` (null when
 * no snapshot row) as `ratingsFromAnswers`.
 *
 * @param {string} suggestionId - a GUID (server-sourced; guarded before it
 *   reaches the OData filter).
 */
export async function readRatingsBySuggestion(suggestionId) {
  // Wave 3 (docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md): the query itself now
  // lives in lib/dataverse/adapters/review-answer.js (byte-mirrored: GUID
  // guard, select/filter shape, ratingsFromAnswers derivation). The adapter
  // does NOT wrap its own read in bypassDynamicsRestrictions by design
  // (restriction-context enforcement folds into the DAL at Stage 7).
  // S333 Stage 4b: trust-model tightening — the sole caller
  // (lib/services/external-review/context-service.js) now establishes the
  // trusted context itself (label 'read-ratings-by-suggestion' relocated,
  // byte-identical).
  return adapterReadRatingsBySuggestion(suggestionId);
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
    wmkf_answervalues: row.answerValues === null || row.answerValues === undefined
      ? null
      : JSON.stringify(row.answerValues),
  };
}

/**
 * Build snapshot rows for the RATINGS, from a validated rating object keyed by
 * `field.key` (the `ratings` bucket of `validateReviewForm`). Staff writers use
 * this alongside `buildMultiselectSnapshotRows`.
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
 * @param {Object} ratings - values keyed by field.key, e.g. { riskLevel: 3 }
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
      answerValues: null,
    });
  }
  return rows;
}

/**
 * Build multiselect snapshot rows from the canonical results returned by
 * validateReviewForm. This function never accepts request labels and never
 * reconstructs pairs; the shared canonicalizer is the sole producer.
 */
export function buildMultiselectSnapshotRows(multiselects, questionSet) {
  const rows = [];
  if (!multiselects || typeof multiselects !== 'object') return rows;
  for (const field of questionSet) {
    if (field.type !== 'multiselect') continue;
    const canonical = multiselects[field.key];
    if (canonical === null || canonical === undefined) continue;
    if (!Array.isArray(canonical.pairs)
      || !Array.isArray(canonical.values)
      || typeof canonical.answerText !== 'string') {
      throw new Error(`buildMultiselectSnapshotRows: "${field.key}" is not canonicalized`);
    }
    rows.push({
      questionKey: field.key,
      questionOrder: field.order,
      questionText: field.label,
      questionType: 'multiselect',
      answerHtml: null,
      answerText: canonical.answerText,
      answerValue: null,
      answerValues: canonical.pairs,
    });
  }
  return rows;
}
