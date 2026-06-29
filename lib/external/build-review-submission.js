/**
 * Phase 3 submit producer for the in-browser reviewer review form.
 *
 * Two exports, one pipeline (docs/REVIEWER_REVIEW_FORM_AUTHORING_BUILD_PLAN.md §5/§9):
 *
 *   validateReviewSubmission(input)
 *     Full-form validation for FINAL submit — unlike `validateReviewForm`
 *     (review-form-schema.js), which validates only the parent-mapped fields for
 *     the legacy upload path, this validates EVERY field against the CURRENT
 *     schema: affiliation + the 3 ratings + Q2/Q4–Q9 required, Q11 optional.
 *     Rating values must be in the LIVE picklist domain (so the removed
 *     "Unable to answer"/99 and any out-of-range value are rejected — Codex
 *     P1-R3). "Empty richtext" = no visible text after tag-strip (§9 #E), not
 *     merely a non-empty string. Returns a normalized object keyed by field.key.
 *
 *   buildReviewSubmission(normalized, { receivedAt })
 *     THE SINGLE producer of `{ parentPatch, answerRows }` from one normalized,
 *     validated object (Codex P1-N4) — so the parent rating columns and the
 *     child snapshot rows can never drift. Emits one answer row per question
 *     (all 11, ratings included), denormalizing the question text/order/type
 *     into each row for historical fidelity. Hard-asserts the snapshot-fidelity
 *     backstop (questionorder/text/type present — Codex S301 P1), exactly three
 *     non-null rating rows, rating-domain validity, and parent/child rating
 *     equality (P1-N4/P1-R3) — these are producer backstops; the validator is
 *     the first line.
 *
 * Richtext answers must already be SERVER-SANITIZED by the route (the autosave/
 * submit write is the security boundary, not render). This module derives the
 * plain-text rendition for `wmkf_answertext` but does not sanitize — pass
 * sanitized HTML in.
 */

import { reviewFormSchema, labelForReviewRating } from './review-form-schema';
import { isEffectivelyEmptyHtml, htmlToPlainText } from './sanitize-review-html';

// The three structured ratings (picklist fields with a parent dataverseField).
const RATING_KEYS = reviewFormSchema.fields
  .filter((f) => f.type === 'picklist')
  .map((f) => f.key);

/**
 * Validate a full submit against the current schema.
 *
 * @param {object} input - answers keyed by field.key. Richtext values should
 *   already be server-sanitized HTML; ratings may be ints or numeric strings;
 *   affiliation a string.
 * @returns {{ ok: true, normalized: object } | { ok: false, errors: string[] }}
 *   `normalized` is keyed by field.key: affiliation → trimmed string, ratings →
 *   ints, richtext → the (sanitized) HTML string ('' for an omitted optional).
 */
export function validateReviewSubmission(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['Form data missing or invalid.'] };
  }

  const errors = [];
  const normalized = {};

  for (const field of reviewFormSchema.fields) {
    const raw = input[field.key];
    const isMissing = raw === undefined || raw === null || raw === '';

    if (field.type === 'string') {
      const trimmed = typeof raw === 'string' ? raw.trim() : '';
      if (trimmed.length === 0) {
        if (field.required) errors.push(`${field.label}: required.`);
        normalized[field.key] = '';
        continue;
      }
      if (field.maxLength && trimmed.length > field.maxLength) {
        errors.push(`${field.label}: max ${field.maxLength} characters.`);
        continue;
      }
      normalized[field.key] = trimmed;
    } else if (field.type === 'picklist') {
      if (isMissing) {
        if (field.required) errors.push(`${field.label}: required.`);
        normalized[field.key] = null;
        continue;
      }
      // Strict integer parse: a numeric string must be ALL digits (optionally
      // signed), so "3abc"/"3.5"/"" are rejected rather than silently truncated
      // to an in-domain 3 by parseInt (Codex P2).
      let numeric;
      if (typeof raw === 'number') numeric = raw;
      else if (typeof raw === 'string' && /^-?\d+$/.test(raw.trim())) numeric = Number(raw.trim());
      else numeric = NaN;
      if (!Number.isInteger(numeric)) {
        errors.push(`${field.label}: must be a whole number.`);
        continue;
      }
      // Live-domain check: the value must be one the CURRENT schema offers. A
      // value removed from the schema (e.g. the retired "Unable to answer"/99)
      // or out of range is rejected, not silently stored (Codex P1-R3).
      if (!field.options.some((o) => o.value === numeric)) {
        errors.push(`${field.label}: invalid choice.`);
        continue;
      }
      normalized[field.key] = numeric;
    } else if (field.type === 'richtext') {
      const html = typeof raw === 'string' ? raw : '';
      // Emptiness is tested on content after tag-strip, not on the raw string —
      // the editor emits "<p></p>"/"<p><br></p>" for an empty answer (§9 #E).
      if (isEffectivelyEmptyHtml(html)) {
        if (field.required) errors.push(`${field.label}: required.`);
        normalized[field.key] = '';
        continue;
      }
      if (field.maxLength && html.length > field.maxLength) {
        errors.push(`${field.label}: max ${field.maxLength} characters.`);
        continue;
      }
      normalized[field.key] = html;
    } else {
      errors.push(`${field.label}: unsupported field type "${field.type}".`);
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, normalized };
}

/**
 * Build the parent PATCH + answer-snapshot rows from a normalized, validated
 * submit. The single mapping point so parent ratings and child rows agree.
 *
 * @param {object} normalized - output of validateReviewSubmission().normalized
 * @param {object} options
 * @param {string} options.receivedAt - ISO timestamp to stamp on
 *   wmkf_reviewreceivedat (the route supplies it so this stays deterministic).
 * @returns {{ parentPatch: object, answerRows: Array<object> }}
 *   parentPatch — Dataverse column names → values (affiliation, 3 ratings,
 *     receivedat). answerRows — one per question (order 1–11):
 *     { questionKey, questionOrder, questionText, questionType,
 *       answerHtml: string|null, answerText: string, answerValue: number|null }.
 * @throws {Error} on any producer-invariant violation (snapshot fidelity,
 *   rating count/domain, parent/child equality) — a thrown error here means a
 *   bug upstream of the changeset; nothing should be written.
 */
export function buildReviewSubmission(normalized, { receivedAt } = {}) {
  if (!normalized || typeof normalized !== 'object') {
    throw new Error('buildReviewSubmission: normalized object required');
  }
  if (typeof receivedAt !== 'string' || receivedAt.length === 0) {
    throw new Error('buildReviewSubmission: receivedAt (ISO string) required');
  }

  const parentPatch = { wmkf_reviewreceivedat: receivedAt };
  const answerRows = [];

  // Walk the questions in display/snapshot order so answerRows are ordered 1..11.
  const questions = reviewFormSchema.fields
    .filter((f) => typeof f.order === 'number')
    .sort((a, b) => a.order - b.order);

  for (const field of reviewFormSchema.fields) {
    if (field.type === 'string' && field.dataverseField) {
      // Affiliation — parent column only, never a snapshot row (no `order`).
      parentPatch[field.dataverseField] = normalized[field.key] ?? '';
    }
  }

  for (const field of questions) {
    const row = {
      questionKey: field.key,
      questionOrder: field.order,
      questionText: field.label,
      questionType: field.type,
      answerHtml: null,
      answerText: '',
      answerValue: null,
    };

    if (field.type === 'picklist') {
      const value = normalized[field.key];
      row.answerValue = value;
      row.answerText = labelForReviewRating(field.key, value) ?? '';
      // Denormalize the rating to its parent column too (native aggregation).
      if (field.dataverseField) parentPatch[field.dataverseField] = value;
    } else if (field.type === 'richtext') {
      const html = normalized[field.key] ?? '';
      row.answerHtml = html;
      row.answerText = htmlToPlainText(html);
    }

    // Snapshot-fidelity backstop (Codex S301 P1): the three denormalized question
    // descriptors were created without a requiredLevel, so guard them in code.
    if (typeof row.questionOrder !== 'number'
      || !row.questionText || String(row.questionText).trim().length === 0
      || !row.questionType || String(row.questionType).trim().length === 0) {
      throw new Error(
        `buildReviewSubmission: snapshot fidelity violation for "${field.key}" — `
        + `questionOrder/questionText/questionType must all be present.`,
      );
    }

    answerRows.push(row);
  }

  assertRatingInvariants(parentPatch, answerRows);

  return { parentPatch, answerRows };
}

/**
 * Enforce the parent/child rating contract (Codex P1-N4 / P1-R3):
 *   - exactly three non-null rating rows,
 *   - each rating value is in the live picklist domain,
 *   - each rating row's answerValue equals its parent column.
 */
function assertRatingInvariants(parentPatch, answerRows) {
  const ratingRows = answerRows.filter((r) => RATING_KEYS.includes(r.questionKey));
  const present = ratingRows.filter((r) => r.answerValue !== null && r.answerValue !== undefined);
  if (present.length !== RATING_KEYS.length) {
    throw new Error(
      `buildReviewSubmission: a complete submit needs exactly ${RATING_KEYS.length} rating rows, got ${present.length}.`,
    );
  }

  const fieldByKey = new Map(reviewFormSchema.fields.map((f) => [f.key, f]));
  for (const row of ratingRows) {
    const field = fieldByKey.get(row.questionKey);
    if (!field.options.some((o) => o.value === row.answerValue)) {
      throw new Error(
        `buildReviewSubmission: rating "${row.questionKey}" value ${row.answerValue} is not in the live picklist domain.`,
      );
    }
    if (parentPatch[field.dataverseField] !== row.answerValue) {
      throw new Error(
        `buildReviewSubmission: parent/child rating drift for "${row.questionKey}" `
        + `(parent ${parentPatch[field.dataverseField]} vs child ${row.answerValue}).`,
      );
    }
  }
}
