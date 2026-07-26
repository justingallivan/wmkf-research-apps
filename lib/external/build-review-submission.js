/**
 * Phase 3 submit producer for the in-browser reviewer review form.
 *
 * Two exports, one pipeline (docs/REVIEWER_REVIEW_FORM_AUTHORING_BUILD_PLAN.md §5/§9):
 *
 *   validateReviewSubmission(input)
 *     Full-form validation for FINAL submit — unlike `validateReviewForm`
 *     (review-form-schema.js), which validates only the parent-mapped fields for
 *     the legacy upload path, this validates EVERY field against the CURRENT
 *     schema, including the multiselect and the two current rating fields.
 *     Rating values must be in the LIVE picklist domain (so the removed
 *     "Unable to answer"/99 and any out-of-range value are rejected — Codex
 *     P1-R3). "Empty richtext" = no visible text after tag-strip (§9 #E), not
 *     merely a non-empty string. Returns a normalized object keyed by field.key.
 *
 *   buildReviewSubmission(normalized, { receivedAt })
 *     THE SINGLE producer of `{ parentPatch, answerRows }` from one normalized,
 *     validated object (Codex P1-N4), keeping parent affiliation/finality fields
 *     and child snapshot rows in one contract. Emits one answer row per question
 *     (all 11), denormalizing question text/order/type into each row for
 *     historical fidelity. Hard-asserts snapshot descriptors, canonical
 *     multiselect content, exact core-rating presence, and live domains.
 *
 * Richtext answers must already be SERVER-SANITIZED by the route (the autosave/
 * submit write is the security boundary, not render). This module derives the
 * plain-text rendition for `wmkf_answertext` but does not sanitize — pass
 * sanitized HTML in.
 */

import { reviewFormSchema, reviewParentColumnByKey, CORE_RATING_KEYS, labelForOption } from './review-form-schema';
import { isEffectivelyEmptyHtml, htmlToPlainText } from './sanitize-review-html';
import { canonicalizeMultiselectSelection } from './review-multiselect';

// The canonical core ratings present in a given question set. Post-Phase-E these
// are no longer parent-bound (the columns retired); they are identified by an
// explicit key list, not the parent-column map, so the producer's count/domain
// backstop survived the retirement. A future staff-added optional rating is not
// in CORE_RATING_KEYS and is not asserted present.
function ratingKeysFor(fields) {
  const present = new Set(fields.filter((f) => f.type === 'picklist').map((f) => f.key));
  return CORE_RATING_KEYS.filter((k) => present.has(k));
}

/**
 * Validate a full submit against the current question set.
 *
 * @param {object} input - answers keyed by field.key. Richtext values should
 *   already be server-sanitized HTML; ratings may be ints or numeric strings;
 *   affiliation a string.
 * @param {Array} [questionSet] - the question set to validate against; defaults
 *   to the static `reviewFormSchema.fields`. Routes pass the Dataverse-loaded
 *   set (`ReviewQuestionFetcher`).
 * @returns {{ ok: true, normalized: object } | { ok: false, errors: string[] }}
 *   `normalized` is keyed by field.key: affiliation → trimmed string, ratings →
 *   ints, multiselects → canonical `{ values, pairs, answerText }`, richtext →
 *   sanitized HTML ('' for an omitted optional).
 */
export function validateReviewSubmission(input, questionSet = reviewFormSchema.fields) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['Form data missing or invalid.'] };
  }

  const errors = [];
  const normalized = {};

  for (const field of questionSet) {
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
    } else if (field.type === 'multiselect') {
      try {
        normalized[field.key] = canonicalizeMultiselectSelection(field, raw ?? []);
      } catch (error) {
        errors.push(error.message);
      }
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
 * submit. The single mapping point for parent affiliation/finality and answers.
 *
 * @param {object} normalized - output of validateReviewSubmission().normalized
 * @param {object} options
 * @param {string} options.receivedAt - ISO timestamp to stamp on
 *   wmkf_reviewreceivedat (the route supplies it so this stays deterministic).
 * @param {Array} [options.questionSet] - the question set; defaults to the
 *   static `reviewFormSchema.fields`. Routes pass the Dataverse-loaded set.
 * @returns {{ parentPatch: object, answerRows: Array<object> }}
 *   parentPatch — Dataverse column names → values (affiliation, receivedat,
 *     reviewstatus → Review Received). answerRows — one per
 *     question (order 1–11):
 *     { questionKey, questionOrder, questionText, questionType,
 *       answerHtml: string|null, answerText: string, answerValue: number|null,
 *       answerValues: Array<{value:number,label:string}>|null }.
 * @throws {Error} on any producer-invariant violation (snapshot fidelity,
 *   canonical multiselect content and rating count/domain) — a thrown error means a
 *   bug upstream of the changeset; nothing should be written.
 */
// wmkf_reviewstatus 'Review Received' picklist value. This module stays free
// of Dataverse-adapter imports (pure contract producer), so the value is
// pinned here with pointers to the two live restatements above.
const REVIEW_STATUS_REVIEW_RECEIVED = 100000003;

export function buildReviewSubmission(normalized, { receivedAt, questionSet = reviewFormSchema.fields } = {}) {
  if (!normalized || typeof normalized !== 'object') {
    throw new Error('buildReviewSubmission: normalized object required');
  }
  if (typeof receivedAt !== 'string' || receivedAt.length === 0) {
    throw new Error('buildReviewSubmission: receivedAt (ISO string) required');
  }

  const parentPatch = {
    wmkf_reviewreceivedat: receivedAt,
    // Advance the lifecycle picklist in the same atomic changeset so the
    // Track Reviewers badge follows the submit (S328: it stayed at
    // 'Materials Sent' forever). 100000003 = 'Review Received' — must match
    // REVIEW_STATUS_MAP.review_received in lib/dataverse/adapters/
    // reviewer-suggestion.js and REVIEW_STATUS_BY_VALUE in
    // pages/api/review-manager/reviewers.js (schema:
    // lib/dataverse/schema/wave2/wmkf_app_reviewer_suggestion.json).
    wmkf_reviewstatus: REVIEW_STATUS_REVIEW_RECEIVED,
  };
  const answerRows = [];

  // Snapshot rows are the ANSWER questions (picklist + multiselect + richtext), in display
  // order. A string field (affiliation) is the identity field → parent column
  // only, never a snapshot row — keyed on TYPE, not on presence of `order`
  // (the Dataverse-seeded affiliation carries order 0, so the old "has order"
  // heuristic would wrongly include it).
  const questions = questionSet
    .filter((f) => f.type === 'picklist' || f.type === 'multiselect' || f.type === 'richtext')
    .sort((a, b) => a.order - b.order);

  for (const field of questionSet) {
    const column = reviewParentColumnByKey[field.key];
    if (field.type === 'string' && column) {
      // Affiliation — parent column only, never a snapshot row.
      parentPatch[column] = normalized[field.key] ?? '';
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
      answerValues: null,
    };

    if (field.type === 'picklist') {
      const value = normalized[field.key];
      row.answerValue = value;
      row.answerText = labelForOption(field, value) ?? '';
      // Post-Phase-E ratings are snapshot-only — no parent-column denormalization.
    } else if (field.type === 'multiselect') {
      const canonical = normalized[field.key];
      if (!canonical || !Array.isArray(canonical.pairs)) {
        throw new Error(`buildReviewSubmission: canonical multiselect "${field.key}" is required.`);
      }
      row.answerValues = canonical.pairs;
      row.answerText = canonical.answerText;
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

  assertRatingInvariants(answerRows, questionSet);

  return { parentPatch, answerRows };
}

/**
 * Producer backstop for the canonical core ratings of the given question set:
 *   - every core rating row is present (non-null),
 *   - each rating value is in the live picklist domain.
 *
 * Post-Phase-E the ratings are snapshot-only, so the former parent/child equality
 * check is gone (there is no parent column to compare). The count + domain checks
 * are re-anchored on the explicit `CORE_RATING_KEYS` (via `ratingKeysFor`), NOT
 * the parent-column map, so retiring the columns did not turn this into a no-op.
 */
function assertRatingInvariants(answerRows, fields) {
  const ratingKeys = ratingKeysFor(fields);
  const ratingRows = answerRows.filter((r) => ratingKeys.includes(r.questionKey));
  const present = ratingRows.filter((r) => r.answerValue !== null && r.answerValue !== undefined);
  if (present.length !== ratingKeys.length) {
    throw new Error(
      `buildReviewSubmission: a complete submit needs exactly ${ratingKeys.length} core rating rows, got ${present.length}.`,
    );
  }

  const fieldByKey = new Map(fields.map((f) => [f.key, f]));
  for (const row of ratingRows) {
    const field = fieldByKey.get(row.questionKey);
    if (!field.options.some((o) => o.value === row.answerValue)) {
      throw new Error(
        `buildReviewSubmission: rating "${row.questionKey}" value ${row.answerValue} is not in the live picklist domain.`,
      );
    }
  }
}
