/**
 * Pure validate + diff + changeset builder for the staff review-question editor
 * (pages/api/admin/review-questions.js). NO Dataverse / Postgres / network here
 * so the whole save contract is unit-testable in isolation (mirrors the
 * build-review-submission producer pattern).
 *
 * The editor POSTs the FULL ordered set it produced. This module:
 *   1. validates every submitted row against the wmkf_reviewquestion column
 *      caps + the fetcher's normalization rules (so a saved set always reads
 *      back cleanly through getActiveQuestionSet),
 *   2. diffs it against the current active set BY DATAVERSE ROW IDENTITY
 *      (`id` = wmkf_reviewquestionid) — never by key — so an edit can't rewrite
 *      a row's immutable `wmkf_questionkey` (the wmkf_appreviewanswer join), and
 *   3. emits ONE atomic operation list of DAL changeset DESCRIPTORS
 *      ({method, entitySet, key?, body, ifMatch?} — run via
 *      lib/dataverse/core/changeset.js runChangeset): create (POST) for new
 *      rows, update (PATCH by id) for changed rows, soft-delete (PATCH
 *      statecode) for removed rows. Order is assigned from list position so a drag-reorder is
 *      just a set of order PATCHes; duplicate orders are impossible by
 *      construction.
 *
 * Returns `{ ok:false, errors }` for any validation/immutability problem (the
 * route 400s and writes nothing). The version/optimistic-lock check lives in
 * the route (it owns the live re-read).
 */

import { CORE_RATING_KEYS } from '../external/review-form-schema';

export const ENTITY_SET = 'wmkf_reviewquestions';

// The fetcher reads at most 100 active rows and fails closed past that, so the
// editor can't be allowed to save a 101st (it would break the live form for all
// reviewers). Cap here, the write boundary.
export const MAX_QUESTIONS = 100;

// The core, non-deletable review questions: affiliation (reviewer identity) + the
// 3 ratings. The editor must always keep all four — they are the backbone of the
// review (the submit producer asserts the ratings present; affiliation is the
// identity field). Held as an EXPLICIT list, deliberately NOT derived from
// `reviewParentColumnByKey` (Phase E shrank that map to affiliation-only when the
// rating parent columns retired; deriving from it would have silently let staff
// delete the rating questions — Codex Phase E P1-4). The original Phase C guard
// (Codex P1-3) is preserved.
export const PARENT_BOUND_KEYS = Object.freeze(['affiliation', ...CORE_RATING_KEYS]);

/**
 * Which required parent-bound keys are absent from a submitted set. Empty array
 * = all present. The route rejects a non-empty result (400) so staff can't drop
 * affiliation/impact/risk/overallRating before the dual-write contract retires.
 */
export function missingParentBoundKeys(rows) {
  const present = new Set((rows || []).map((r) => r.key));
  return PARENT_BOUND_KEYS.filter((k) => !present.has(k));
}

// wmkf_reviewquestion column caps (lib/dataverse/schema/wave9-review-questions/
// 01_wmkf_reviewquestion.json) + the fetcher's normalization contract.
export const LIMITS = Object.freeze({
  NAME: 200,        // wmkf_Name (primary), set from the label
  KEY: 100,         // wmkf_questionkey (alt key)
  LABEL: 4000,      // wmkf_questiontext (Memo)
  HINT: 500,        // wmkf_hint
  OPTIONS_JSON: 20000, // wmkf_options (Memo, stringified)
  OPTION_LABEL: 300,
  MAXLENGTH_MAX: 1000000, // wmkf_maxlength upper bound
  ORDER_MAX: 1000,  // wmkf_questionorder upper bound (we assign by index)
});

const SUPPORTED_TYPES = new Set(['picklist', 'multiselect', 'richtext', 'string']);
const OPTION_TYPES = new Set(['picklist', 'multiselect']);
// Same key rule the fetcher enforces — leading lowercase letter then
// alphanumerics/underscore (the live `overallRating` key is camelCase).
const KEY_RE = /^[a-z][a-zA-Z0-9_]*$/;

// Dataverse "Inactive" state pair for this custom entity (soft-delete) — same
// values potential-reviewer.deactivate / policies RETIRED use.
export const INACTIVE_STATE = Object.freeze({ statecode: 1, statuscode: 2 });

/**
 * Validate the submitted full set. Returns the normalized rows (order assigned
 * from position) on success, or a list of human-readable errors.
 *
 * @param {Array} submitted - rows: { id?, key, label, type, required, maxLength?, hint?, options? }
 * @returns {{ ok:true, rows:Array } | { ok:false, errors:string[] }}
 */
export function validateSubmittedSet(submitted) {
  const errors = [];
  if (!Array.isArray(submitted) || submitted.length === 0) {
    return { ok: false, errors: ['At least one question is required.'] };
  }
  if (submitted.length > MAX_QUESTIONS) {
    return { ok: false, errors: [`Too many questions (max ${MAX_QUESTIONS}).`] };
  }

  const seenKeys = new Set();
  const rows = [];

  submitted.forEach((raw, index) => {
    const where = `Question ${index + 1}`;
    if (!raw || typeof raw !== 'object') {
      errors.push(`${where}: malformed row.`);
      return;
    }
    const key = raw.key;
    if (typeof key !== 'string' || !KEY_RE.test(key)) {
      errors.push(`${where}: key must start with a lowercase letter and contain only letters, numbers, or underscores.`);
      return;
    }
    if (key.length > LIMITS.KEY) {
      errors.push(`${where}: key exceeds ${LIMITS.KEY} characters.`);
      return;
    }
    if (seenKeys.has(key)) {
      errors.push(`${where}: duplicate key "${key}".`);
      return;
    }
    seenKeys.add(key);

    const label = raw.label;
    if (typeof label !== 'string' || label.trim().length === 0) {
      errors.push(`${where}: question text is required.`);
      return;
    }
    if (label.length > LIMITS.LABEL) {
      errors.push(`${where}: question text exceeds ${LIMITS.LABEL} characters.`);
      return;
    }

    const type = raw.type;
    if (!SUPPORTED_TYPES.has(type)) {
      errors.push(`${where}: type must be one of picklist, multiselect, richtext, string.`);
      return;
    }

    if (typeof raw.required !== 'boolean') {
      errors.push(`${where}: "required" must be true or false.`);
      return;
    }

    const row = {
      id: typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : null,
      key,
      label,
      type,
      required: raw.required,
      order: index, // assigned from list position; never trusted from the client
    };

    if (raw.hint !== undefined && raw.hint !== null && raw.hint !== '') {
      if (typeof raw.hint !== 'string' || raw.hint.length > LIMITS.HINT) {
        errors.push(`${where}: hint must be text under ${LIMITS.HINT} characters.`);
        return;
      }
      row.hint = raw.hint;
    }

    if (raw.maxLength !== undefined && raw.maxLength !== null && raw.maxLength !== '') {
      const n = Number(raw.maxLength);
      if (!Number.isInteger(n) || n < 1 || n > LIMITS.MAXLENGTH_MAX) {
        errors.push(`${where}: max length must be a whole number between 1 and ${LIMITS.MAXLENGTH_MAX}.`);
        return;
      }
      row.maxLength = n;
    }

    if (OPTION_TYPES.has(type)) {
      const opts = raw.options;
      if (!Array.isArray(opts) || opts.length === 0) {
        errors.push(`${where}: an option-bearing question needs at least one option.`);
        return;
      }
      const normOpts = [];
      const seenVals = new Set();
      let optBad = false;
      opts.forEach((o, oi) => {
        const v = Number(o?.value);
        if (!Number.isInteger(v)) {
          errors.push(`${where}, option ${oi + 1}: value must be a whole number.`);
          optBad = true;
          return;
        }
        if (seenVals.has(v)) {
          errors.push(`${where}, option ${oi + 1}: duplicate value ${v}.`);
          optBad = true;
          return;
        }
        seenVals.add(v);
        if (typeof o?.label !== 'string' || o.label.trim().length === 0 || o.label.length > LIMITS.OPTION_LABEL) {
          errors.push(`${where}, option ${oi + 1}: label is required (max ${LIMITS.OPTION_LABEL} chars).`);
          optBad = true;
          return;
        }
        normOpts.push({ value: v, label: o.label });
      });
      if (optBad) return;
      if (JSON.stringify(normOpts).length > LIMITS.OPTIONS_JSON) {
        errors.push(`${where}: too many options.`);
        return;
      }
      row.options = normOpts;
    }

    rows.push(row);
  });

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, rows };
}

/** Build the Dataverse write body for a create/update (no id, no key on update). */
function writeBody(row, { includeKey }) {
  const body = {
    // Logical name is lowercase `wmkf_name` — the Web API rejects the schema-name
    // casing `wmkf_Name` (0x80048d19 "property does not exist"). The seed script
    // uses `wmkf_name`; mirror it.
    wmkf_name: row.label.slice(0, LIMITS.NAME),
    wmkf_questionorder: row.order,
    wmkf_questiontext: row.label,
    wmkf_questiontype: row.type,
    wmkf_required: row.required,
    wmkf_maxlength: row.maxLength ?? null,
    wmkf_hint: row.hint ?? null,
    wmkf_options: OPTION_TYPES.has(row.type) ? JSON.stringify(row.options) : null,
  };
  if (includeKey) body.wmkf_questionkey = row.key;
  return body;
}

/** True if an existing row's editable fields differ from the submitted row. */
function rowChanged(current, submitted) {
  if (current.order !== submitted.order) return true;
  if (current.label !== submitted.label) return true;
  if (current.type !== submitted.type) return true;
  if ((current.required === true) !== (submitted.required === true)) return true;
  if ((current.maxLength ?? null) !== (submitted.maxLength ?? null)) return true;
  if ((current.hint ?? null) !== (submitted.hint ?? null)) return true;
  const cOpts = OPTION_TYPES.has(current.type) ? JSON.stringify(current.options || null) : null;
  const sOpts = OPTION_TYPES.has(submitted.type) ? JSON.stringify(submitted.options || null) : null;
  if (cOpts !== sOpts) return true;
  return false;
}

/** True if ONLY the order changed (for the summary's reordered count). */
function onlyOrderChanged(current, submitted) {
  if (current.order === submitted.order) return false;
  const a = { ...current, order: 0 };
  const b = { ...submitted, order: 0 };
  return !rowChanged(a, b);
}

/**
 * Diff the validated submitted set against the current active set (by id) and
 * build the DAL changeset descriptor list (core/changeset.js shape). Returns
 * errors for row-identity / key-immutability violations (the route 400s).
 *
 * @param {Array} currentRows - active set with ids: { id, key, order, label, type, required, maxLength?, hint?, options? }
 * @param {Array} submittedRows - output of validateSubmittedSet().rows
 * @returns {{ ok:true, operations, summary } | { ok:false, errors:string[] }}
 */
export function buildChangeset(currentRows, submittedRows) {
  const errors = [];
  const byId = new Map((currentRows || []).map((r) => [r.id, r]));
  const submittedIds = new Set();
  const operations = [];
  const summary = { created: 0, updated: 0, deleted: 0, reordered: 0 };

  for (const row of submittedRows) {
    if (row.id) {
      const current = byId.get(row.id);
      if (!current) {
        errors.push(`A question you edited (id ${row.id}) no longer exists — reload and try again.`);
        continue;
      }
      if (current.key !== row.key) {
        errors.push(`The key of "${current.key}" can't be changed (it links existing reviewer answers).`);
        continue;
      }
      submittedIds.add(row.id);
      if (rowChanged(current, row)) {
        operations.push({
          method: 'PATCH',
          entitySet: ENTITY_SET,
          key: row.id,
          body: writeBody(row, { includeKey: false }),
          // Row-version precondition: a concurrent save that touched this row
          // since we read it makes this PATCH 412, so the changeset rolls back
          // rather than silently clobbering the other edit (Codex Phase C P1-1).
          ...(current.etag ? { ifMatch: current.etag } : {}),
        });
        if (onlyOrderChanged(current, row)) summary.reordered += 1;
        else summary.updated += 1;
      }
    } else {
      // New row — brand-new key. (A key colliding with an INACTIVE row's alt
      // key would fail the create at the DB level and roll the whole atomic
      // changeset back; keys are never reused per plan §2.)
      operations.push({
        method: 'POST',
        entitySet: ENTITY_SET,
        body: writeBody(row, { includeKey: true }),
      });
      summary.created += 1;
    }
  }

  // Removed rows: current active rows whose id wasn't resubmitted → soft-delete.
  for (const current of currentRows || []) {
    if (!submittedIds.has(current.id)) {
      operations.push({
        method: 'PATCH',
        entitySet: ENTITY_SET,
        key: current.id,
        body: { ...INACTIVE_STATE },
        ...(current.etag ? { ifMatch: current.etag } : {}),
      });
      summary.deleted += 1;
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, operations, summary };
}
