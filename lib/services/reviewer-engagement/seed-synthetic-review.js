/**
 * Test Request Factory synthetic-reviewer seeder (slice 6c-ii Stage B).
 *
 * Design doc: docs/plans/TEST_REQUEST_FACTORY_DESIGN_2026-09-19.md, plan
 * paragraph "Build-order item 6, synthetic reviewers and reviews recipe",
 * "Seeder (slice 6c-ii)". Lives here (not `lib/services/test-requests/`)
 * because `scripts/check-reviewer-engagement-boundary.js` forces every
 * generic suggestion writer into this directory.
 *
 * Pure functions only: no I/O, no Dataverse/DAL imports. `bundleReviewer` is
 * one entry of bundle v3's `reviewers[]` array, exactly the shape
 * `source-bundle.js#projectReviewer` emits (`suggestionId`, `personId`,
 * `person`, `personIsSynthetic`, `suggestion`, `answers`, `reviewForm`,
 * `files`). The runner (run-runner.js) and the CLI's reservation-time
 * resolution (rehearse-test-request-sandbox.mjs) both call
 * `syntheticPersonProjection` so the create body, the reuse-path comparison,
 * and the verifier (Stage C) apply the exact same rule.
 *
 * Note on `wmkf_organizationname` (Deviation 2, orchestrator decision after
 * Opus round 1): the bundle v3 contract (`source-bundle.js#REVIEWER_PERSON_
 * FIELDS`) does not export `wmkf_organizationname` -- Stage A never carries
 * it. The projection nonetheless INCLUDES the shadow, DERIVED from the same
 * `wmkf_primaryaffiliation` value the bundle does export, clamped to 100
 * characters exactly as `potential-reviewer.js`'s `clamp()`/`FIELD_MAX`
 * truncates it (`v.slice(0, 99).trimEnd() + '…'` past 100 chars): both
 * `upsertByEmail`/`create` always write both fields together, and
 * `reviewer-identity-lookup.js:65` (`rowAffiliation`) treats the shadow as an
 * independent fallback source (`wmkf_primaryaffiliation || wmkf_organizationname`),
 * so a synthetic person with a null shadow would read differently from an
 * ordinary one whenever a caller happens to read the shadow instead of the
 * canonical field. The bundle contract itself is unchanged (the shadow is
 * derived here, never exported by the bundle).
 */

import { atomicParentWithChildren } from '../../dataverse/core/changeset.js';
import { answerUpsertDescriptor } from '../../dataverse/adapters/review-answer.js';
import { entitySet } from '../../dataverse/core/entity-registry.js';

const SUGGESTION_ENTITY_SET = entitySet('wmkf_appreviewersuggestions');

/**
 * Fields of `bundleReviewer.person` this projection copies verbatim (null
 * preserved), i.e. everything except the address (which is the caller-
 * supplied/assigned address, never the source's).
 */
const PERSON_COPY_FIELDS = [
  'wmkf_areaofexpertise',
  'wmkf_primaryaffiliation',
  'wmkf_academicrank',
  'wmkf_primarydepartment',
  'wmkf_maininstitution',
];

// Byte-mirror of potential-reviewer.js's clamp()/FIELD_MAX['wmkf_organizationname']
// (100): truncate and append an ellipsis past the cap, never silently drop.
const ORGANIZATION_NAME_MAX = 100;
function clampOrganizationName(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return value;
  return value.length > ORGANIZATION_NAME_MAX
    ? `${value.slice(0, ORGANIZATION_NAME_MAX - 1).trimEnd()}…`
    : value;
}

/**
 * The synthetic destination person's exact projected field set (plan
 * "Seeder", Codex plan round 5; Deviation 2, orchestrator decision). Used by:
 *   - the seeder's person create body (`seed_reviewers`);
 *   - reservation-time reuse comparison (CLI `runReserve`, B1);
 *   - the sandbox deps' and runner's own `$select` field lists
 *     (`SYNTHETIC_PERSON_PROJECTION_FIELDS` below), so a future projection
 *     field cannot cause false drift between what is written and what is read;
 *   - Stage C's verifier.
 *
 * Pure. `bundleReviewer` is one `reviewers[]` entry; `address` is the
 * assigned/normalized destination address (never the source's).
 */
export function syntheticPersonProjection(bundleReviewer, address) {
  const person = bundleReviewer?.person || {};
  const projected = {
    wmkf_name: `TEST · ${person.wmkf_name ?? ''}`,
    wmkf_firstname: person.wmkf_firstname ?? null,
    wmkf_lastname: person.wmkf_lastname ?? null,
    wmkf_emailaddress: address,
    wmkf_issyntheticreviewer: true,
  };
  for (const field of PERSON_COPY_FIELDS) {
    projected[field] = person[field] ?? null;
  }
  projected.wmkf_organizationname = clampOrganizationName(person.wmkf_primaryaffiliation ?? null);
  return projected;
}

/**
 * The exact key set `syntheticPersonProjection` writes, derived from the
 * function itself (never hand-copied) so the sandbox deps' and the runner's
 * `$select` lists cannot drift from what is actually written. The values
 * passed here are placeholders -- only the KEY set is deterministic and
 * value-independent (every key is always present; see `syntheticPersonProjection`).
 */
export const SYNTHETIC_PERSON_PROJECTION_FIELDS = Object.freeze(
  Object.keys(syntheticPersonProjection({ person: {} }, 'placeholder@example.invalid')),
);

/**
 * Explicit create allowlist (plan "Seeder"): every field the suggestion
 * create body may carry, plus the two navigation binds and the derived
 * grant-cycle code. NEVER the completion fields (`wmkf_reviewreceivedat`,
 * `wmkf_reviewstatus`, `wmkf_completedat`, `wmkf_thankyousentat`,
 * `wmkf_reviewuploadedbystaff`), either file pointer, or any token/
 * honorarium/proposal-access field -- those are written only by the answers
 * changeset (`buildCompletionWrite`).
 */
export const SUGGESTION_CREATE_ALLOWLIST = Object.freeze([
  'wmkf_suggestionlabel', 'wmkf_programarea', 'wmkf_relevancescore', 'wmkf_matchreason', 'wmkf_sources',
  'wmkf_selected', 'wmkf_invited', 'wmkf_accepted', 'wmkf_declined', 'wmkf_responsetype',
  'wmkf_emailsentat', 'wmkf_responsereceivedat', 'wmkf_materialssentat',
  'wmkf_revieweraffiliation',
  'wmkf_reviewerfirstname', 'wmkf_reviewerlastname', 'wmkf_reviewernickname', 'wmkf_reviewertitle',
  'wmkf_applicantdisposition',
  'wmkf_grantcyclecode',
  'wmkf_PotentialReviewer@odata.bind', 'wmkf_Request@odata.bind',
]);

export const SUGGESTION_COPY_FIELDS = SUGGESTION_CREATE_ALLOWLIST.filter(
  (field) => !field.endsWith('@odata.bind') && field !== 'wmkf_grantcyclecode',
);

/**
 * Build the suggestion create body from an explicit allowlist (plan
 * "Seeder", Codex plan round 6). `destinationPersonId`/`destinationRequestId`
 * become the two `@odata.bind`s; `grantCycleCode` is the destination's
 * derived code (`meetingDateToCycleCode` over the destination meeting date),
 * never copied from the source. Every key in the returned body is a member
 * of `SUGGESTION_CREATE_ALLOWLIST`.
 */
export function buildSuggestionCreateBody(bundleReviewer, { destinationRequestId, destinationPersonId, grantCycleCode }) {
  const source = bundleReviewer?.suggestion || {};
  const body = {};
  for (const field of SUGGESTION_COPY_FIELDS) {
    body[field] = source[field] ?? null;
  }
  body.wmkf_grantcyclecode = grantCycleCode ?? null;
  body['wmkf_PotentialReviewer@odata.bind'] = `/wmkf_potentialreviewerses(${destinationPersonId})`;
  body['wmkf_Request@odata.bind'] = `/akoya_requests(${destinationRequestId})`;
  return body;
}

/** Parse a bundle-carried JSON-string field (`wmkf_answervalues`/`wmkf_questionoptions`) back into its JS value; null-preserving. Throws on malformed JSON rather than silently dropping it. */
function parseBundleJsonField(value, label) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`seed-synthetic-review: bundle ${label} is not valid JSON.`);
  }
}

/** Map one bundle answer row (`wmkf_`-prefixed) to the shape `answerRowBody`/`answerUpsertDescriptor` expect. */
function answerRowFromBundle(bundleAnswer) {
  return {
    questionKey: bundleAnswer.wmkf_questionkey,
    questionOrder: bundleAnswer.wmkf_questionorder,
    questionText: bundleAnswer.wmkf_questiontext,
    questionType: bundleAnswer.wmkf_questiontype,
    answerHtml: bundleAnswer.wmkf_answerhtml,
    answerText: bundleAnswer.wmkf_answertext,
    answerValue: bundleAnswer.wmkf_answervalue,
    answerValues: parseBundleJsonField(bundleAnswer.wmkf_answervalues, 'wmkf_answervalues'),
    questionOptions: parseBundleJsonField(bundleAnswer.wmkf_questionoptions, 'wmkf_questionoptions'),
  };
}

/**
 * Build the completion write for one reviewer (plan "Seeder"/"Source
 * projection"): for `unreceived`, no write at all (returns null). For
 * `received_no_file` and `uploaded`, an atomic parent-with-children changeset
 * descriptor array (`atomicParentWithChildren` + `buildOperations` via the
 * caller's `runChangeset`) -- with zero answers this degenerates to a single
 * parent-only PATCH op, still dispatched through the same changeset
 * transport (a one-operation atomic batch). This is a DELIBERATE, accepted
 * equivalent of the plan's "zero answers -> a journaled, If-Match parent-only
 * completion PATCH" (P3, Opus round 1): a one-operation `$batch` is still a
 * single atomic PATCH, and dispatching it through the same `runChangeset`
 * transport for every review form (rather than a bespoke direct-PATCH path
 * for the zero-answer case only) is simpler and was chosen over adding a
 * second write primitive. `reviews-sandbox-deps.js` therefore has no
 * `patchSuggestion` -- it was built, found unused once this decision was
 * made, and deleted rather than kept as dead code.
 *
 * `filePointers` (Stage C) is `{ folder, filename }` for an `uploaded`
 * review whose files have already been copied; Stage B always calls this
 * with `filePointers: null` even for `uploaded` reviews (the file-copy step
 * is not built yet -- `copy_review_file` stays a `recipe_step_not_built`
 * stub), so the parent PATCH in this stage never carries the pointer
 * fields. Stage C adds the pointers to this SAME completion write by passing
 * `filePointers` once the copy step exists; it is not a second write.
 */
export function buildCompletionWrite(bundleReviewer, { suggestionId, ifMatch, filePointers = null }) {
  const form = bundleReviewer?.reviewForm;
  if (form === 'unreceived') return null;
  const source = bundleReviewer?.suggestion || {};
  const parentBody = {
    wmkf_reviewreceivedat: source.wmkf_reviewreceivedat ?? null,
    wmkf_reviewstatus: source.wmkf_reviewstatus ?? null,
    wmkf_completedat: source.wmkf_completedat ?? null,
    // D-R6: stamp the thank-you together with the received state (email is
    // denied for the request), using the received time when the source has
    // none.
    wmkf_thankyousentat: source.wmkf_thankyousentat ?? source.wmkf_reviewreceivedat ?? null,
    wmkf_reviewuploadedbystaff: source.wmkf_reviewuploadedbystaff ?? null,
  };
  if (filePointers) {
    parentBody.wmkf_reviewsharepointfolder = filePointers.folder;
    parentBody.wmkf_reviewfilename = filePointers.filename;
  }
  const parent = {
    method: 'PATCH', entitySet: SUGGESTION_ENTITY_SET, key: suggestionId, body: parentBody, ifMatch,
  };
  const answers = bundleReviewer?.answers || [];
  if (answers.length === 0) {
    return { operations: [parent], answerCount: 0 };
  }
  const snapshotKeys = new Set(answers.map((row) => row.wmkf_questionkey));
  const children = answers.map((row) => answerUpsertDescriptor(suggestionId, answerRowFromBundle(row), snapshotKeys));
  return { operations: atomicParentWithChildren({ parent, children }), answerCount: answers.length };
}
