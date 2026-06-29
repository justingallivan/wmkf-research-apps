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

import { reviewParentColumnByKey, labelForOption } from './review-form-schema';

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
  const literal = String(questionKey).replace(/'/g, "''");
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
 * Build snapshot rows for the canonical parent-bound RATINGS only, from a
 * validated, column-keyed value object (the `dataverseValues` output of
 * `validateReviewForm`). Used by the legacy staff writers + the backfill, which
 * carry only affiliation + the three ratings — never the narrative answers (those
 * live in the uploaded PDF, not the form).
 *
 * Emits a row ONLY for a rating whose value is present: the
 * mark-received-no-file "informal feedback" scenario deliberately omits ratings
 * so they stay null and aggregates skip the row, and a partial staff entry may
 * carry only some. A snapshot-only (future, no parent column) rating is never
 * written by these legacy paths.
 *
 * Mirrors the picklist branch of `buildReviewSubmission` exactly (questionKey/
 * order/text/type/answerText decode) so a staff-written row is identical to a
 * reviewer-written one.
 *
 * @param {Object} dataverseValues - column-keyed values, e.g. { wmkf_reviewerimpact: 3 }
 * @param {Array} questionSet - the active question set (field.key/order/label/options)
 * @returns {Array<{questionKey,questionOrder,questionText,questionType,answerHtml,answerText,answerValue}>}
 */
export function buildRatingSnapshotRows(dataverseValues, questionSet) {
  const rows = [];
  if (!dataverseValues || typeof dataverseValues !== 'object') return rows;
  for (const field of questionSet) {
    if (field.type !== 'picklist') continue;
    const column = reviewParentColumnByKey[field.key];
    if (!column) continue; // snapshot-only future rating — legacy paths don't write it
    const value = dataverseValues[column];
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
