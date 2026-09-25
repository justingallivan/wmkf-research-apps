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
 * Note on `wmkf_organizationname`: the design doc's prose says the projection
 * carries "both wmkf_primaryaffiliation and its wmkf_organizationname
 * shadow", but the bundle v3 contract actually built in Stage A
 * (`source-bundle.js#REVIEWER_PERSON_FIELDS`) does not carry
 * `wmkf_organizationname` at all -- Stage A's built contract is the source of
 * truth here (there is nothing in `bundleReviewer.person` to project), so
 * this module projects exactly the fields the bundle carries. Recorded as a
 * deviation from the plan's literal text, not from the built bundle.
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

/**
 * The synthetic destination person's exact projected field set (plan
 * "Seeder", Codex plan round 5). Used by:
 *   - the seeder's person create body (`seed_reviewers`);
 *   - reservation-time reuse comparison (CLI `runReserve`, B1);
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
  return projected;
}

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

const SUGGESTION_COPY_FIELDS = SUGGESTION_CREATE_ALLOWLIST.filter(
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
 * transport (a one-operation atomic batch), never a bespoke direct PATCH
 * path.
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
