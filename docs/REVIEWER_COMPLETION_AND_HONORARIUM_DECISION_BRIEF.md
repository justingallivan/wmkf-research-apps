---
title: Reviewer Completion and Honorarium Implementation Brief
domain: reviewer-workbench
kind: plan
status: active
summary: "Approved contract separating review receipt, thank-you, PD closeout and honorarium eligibility, and final authorization to remit."
canonical: false
cataloged: 2026-09-03
last_verified: 2026-09-04
owner: product-engineering
related:
  - docs/REVIEWER_DATA_MODEL.md
  - docs/atlas/dataverse-wmkf-appreviewersuggestion.md
  - docs/agent-wiki/topics/reviewer-workbench-lifecycle.md
  - docs/agent-wiki/topics/finance-honoraria.md
  - .claude-memory/project-reviewer-closeout-payability.md
---

# Reviewer Completion and Honorarium Implementation Brief

## Status and owner decisions

This is the approved build contract for reviewer closeout. It supersedes the
runtime portion of the ignored working prompt
`outputs/codex-prompt-2026-09-03-reviewer-complete-status.md`, which incorrectly
defined Complete as “review received and reviewer thanked.”

- [OWNER DECISION, 2026-09-04] **Complete** means that the Program Director has
  evaluated and closed a received review. It is not an email-delivery state.
- [OWNER DECISION, 2026-09-04] The closeout records one of `eligible`,
  `not_eligible`, or `not_applicable` on the reviewer engagement.
- [OWNER DECISION, 2026-09-04] The application does **not** write
  `akoya_request.wmkf_authorizationtoremitpaymentflag`. Operations/Finance
  retains final payment authority.
- [OWNER DECISION, 2026-09-04] The thank-you remains prompt and independent: it
  acknowledges receipt, does not mark Complete, and does not imply approval or
  payment eligibility.
- [OWNER DECISION, 2026-09-04] Existing thank-you markers are not evidence of PD
  approval and must not be used for a backfill.

The deeper-green Complete badge remains approved as a presentation-only change.

## Verified baseline

- [VERIFIED via `shared/components/reviewers/ReviewerManagePanel.js:244-252,
  319-345,1781-1791`] The generic **Correct recorded status** control currently
  offers Complete, posts it to the general reviewers PATCH, and refreshes without
  first checking `response.ok`.
- [VERIFIED via `pages/api/review-manager/reviewers.js` and
  `lib/services/reviewer-request-authorization.js:42-133`] The current write path
  is authenticated and permits only the request's lead PD or a superuser.
- [VERIFIED via `lib/services/review-manager/reviewers-service.js:451-486`] The
  general PATCH supports single and sequential batch Complete writes. A failed
  batch can leave earlier rows changed and returns no partial-success IDs.
- [VERIFIED via `lib/dataverse/adapters/reviewer-suggestion.js:1764-1886`] The
  adapter ETag-guards status changes and stamps `wmkf_completedat`, but it also
  fabricates `wmkf_reviewreceivedat` when Complete is written without a receipt.
- [VERIFIED via `lib/services/reviewer-thankyou-sweep.js:58-110,131-142`] The
  automated thank-you flow claims only `wmkf_thankyousentat`; it does not write
  Complete.
- [VERIFIED via `lib/services/review-manager/send-emails-service.js:909-958`]
  The retained manual compatibility path currently marks a nonterminal reviewer
  Complete after a successful thank-you send.
- [VERIFIED via read-only Production metadata, 2026-09-04T17:47:19Z] The
  `wmkf_appreviewersuggestion` table has 109 attributes and no field whose name,
  label, or description denotes honorarium eligibility/payability. The new field
  below is not provisioned.
- [VERIFIED via read-only Production rows, 2026-09-04] All 159 rows matching the
  exact honorarium-request discriminator had
  `wmkf_authorizationtoremitpaymentflag=false`; none were true or null. A broader
  Research-request probe found 87 true values, so the field is live elsewhere
  rather than globally unused.
- [VERIFIED via repository-wide symbol search, 2026-09-04] Application source has
  no writer for `wmkf_authorizationtoremitpaymentflag`.

## Contract map

| Event | Authority | Durable state | Meaning |
| --- | --- | --- | --- |
| Review received | Reviewer portal or authorized staff receipt path | `wmkf_reviewreceivedat`; status `review_received` | Review material exists and awaits PD judgment. |
| Thank-you processed | Automated sweep or retained compatibility sender | `wmkf_thankyousentat` | Courtesy workflow was claimed; it is not approval or guaranteed delivery. |
| Review closed | Lead PD or superuser | status `complete`; `wmkf_completedat`; `wmkf_honorariumeligibility` | The human closeout decision was recorded. |
| Authorization to remit | Operations/Finance | honorarium request's `wmkf_authorizationtoremitpaymentflag` | Separate financial control outside this application. |

`wmkf_honorariumeligibility` is the planned logical name for a local Picklist on
`wmkf_appreviewersuggestion`. Null means no closeout disposition has been
recorded. The values are:

| API value | Dataverse label | Meaning |
| --- | --- | --- |
| `eligible` | Eligible | The completed review qualifies for the honorarium. |
| `not_eligible` | Not eligible | The review was received and closed, but does not qualify for payment. |
| `not_applicable` | Not applicable | No honorarium applies, normally because the reviewer opted out or the engagement has no honorarium request. |

The schema wave must pin exact integer values and verify them by metadata
readback. No default is permitted; null is intentionally distinct from every
human decision.

## Implementation invariants

| Invariant | Files likely touched | Verification |
| --- | --- | --- |
| Complete is reachable only through the dedicated human closeout contract. | `ReviewerManagePanel.js`; reviewers service; new close-review route/service | UI and route tests prove generic single/batch PATCH rejects Complete. |
| A new closeout requires an accepted, selected, non-excluded `review_received` row with a pre-existing receipt timestamp. | close-review service; reviewer-suggestion adapter | Each absent/invalid prerequisite produces no PATCH. |
| Status, completion time, and eligibility disposition commit in one ETag-bound update of one suggestion row. | close-review service; reviewer-suggestion adapter | Payload and If-Match tests; 412 returns conflict with no retry/write fan-out. |
| The closeout path never writes the linked honorarium request or authorization-to-remit flag. | close-review service; tests | Positive fixture includes a linked honorarium; spies prove zero `akoya_request` update. |
| Thank-you processing writes only its thank-you marker and never Complete or eligibility. | thank-you sweep; manual send compatibility path | Both paths use fixtures that would expose an accidental Complete/eligibility write. |
| A restored/reused engagement does not inherit a prior closeout decision. | reviewer-suggestion reset set | Reset contract clears `wmkf_honorariumeligibility`; parity test derives the reset set. |
| Unknown disposition values fail closed. | route; service; adapter maps and reverse maps | Invalid and unmapped values return 400/no write; all three valid values round-trip. |
| Existing Complete rows are not inferred or bulk-backfilled. | UI/read projection; deployment procedure | Null renders “Closeout disposition not recorded”; no migration updates rows. |
| Complete remains visible and uses the approved deeper success green. | reviewer modes and Track table | Status partition and class tests remain total. |

## Closeout rules

### New closeout

The dedicated action accepts one reviewer at a time. The server freshly reads
the engagement and requires:

1. `wmkf_selected=true` and `wmkf_accepted=true`;
2. no applicant exclusion;
3. `wmkf_reviewstatus=review_received`;
4. non-null `wmkf_reviewreceivedat`; and
5. one recognized disposition.

Disposition-specific validation:

| Disposition | Required server state | Invalid complement |
| --- | --- | --- |
| `eligible` | `wmkf_honorariumoptout` is not true **and** `wmkf_HonorariumRequest` is linked | Opt-out or missing link → 409, no write. |
| `not_eligible` | Received-review prerequisites above | No honorarium link is required; this is still a human judgment about the completed engagement. |
| `not_applicable` | Opt-out is true **or** no honorarium request is linked | Non-opt-out with a linked honorarium → 409; choose eligible/not eligible. |

On success, one PATCH writes the mapped disposition, `reviewStatus='complete'`,
and `wmkf_completedat`. It must not write `wmkf_reviewreceivedat`; the receipt
must already exist.

### Duplicate clicks and corrections

- Two concurrent first-close requests can read the same row, but only one may win
  the ETag PATCH. The loser returns 409/reload-required; it does not retry with a
  fresh ETag.
- Repeating the same disposition on an already Complete row returns an explicit
  unchanged success and does not re-stamp `wmkf_completedat`.
- A lead PD or superuser may reopen the same modal as **Edit closeout** and change
  only the disposition on an already Complete row. That correction is also
  ETag-bound and leaves status and completion time unchanged.
- Reopening a Complete engagement to an earlier lifecycle status is out of scope.

This keeps corrections possible without using the generic status picker or
creating a second timestamp that falsely looks like a new closeout.

## Build slices

### 1. Additive Dataverse schema

Add a new `extensions-on-existing` schema wave and exact read-only preflight for
`wmkf_appreviewersuggestion.wmkf_honorariumeligibility`:

- local Picklist;
- labels Eligible / Not eligible / Not applicable;
- nullable, no default;
- description explicitly distinguishes reviewer eligibility from final
  authorization to remit.

Apply and read back the additive Production field before deploying runtime that
selects it. Update the schema manifest and the reviewer-suggestion Atlas page.

### 2. Adapter and read projection

- Add symmetric API↔integer maps for all three dispositions.
- Add the raw field to every reviewer-suggestion select/projection that feeds
  Track Reviewers, closeout authorization, reset/reuse, and Operations-facing
  export/read surfaces.
- Add it to `ENGAGEMENT_STAMP_RESET` so a later engagement starts blank.
- Change the adapter's Complete guard: require an existing receipt and a valid
  existing-or-same-write disposition; remove the synthetic receipt fallback.
- Retain the legacy activity-history detector for old equal-timestamp rows, but
  add a test proving new closeouts cannot create such a pair.

### 3. Dedicated service and route

Add `POST /api/review-manager/close-review` with body
`{ suggestionId, disposition }`:

1. `requireAppAccess('review-manager', 'reviewers')` before dispatch;
2. GUID and exact-enum validation;
3. trusted DAL context and session-derived actor identity;
4. `authorizeReviewerRequestMutation` for lead-PD/superuser ownership;
5. one fresh server read of receipt/status/selection/acceptance/opt-out/link/
   disposition plus ETag;
6. fail-closed rule validation; and
7. one ETag-bound reviewer-suggestion update.

Return the exact result shape
`{ success:true, status:'closed'|'unchanged'|'corrected', suggestionId,
disposition, completedAt }`. Map stale state to 409 and validation failures to
400/409 without returning raw Dataverse errors.

There is no batch closeout. Human judgment is per reviewer, and a single-row
contract avoids the current sequential partial-success problem.

### 4. Track Reviewers UI

- Exclude Complete from **Correct recorded status**, hide that generic control
  for an already Complete row, and keep the server rejection as the real guard.
- For a `review_received` row, show **Close review**. The modal identifies the
  reviewer/request, shows opt-out and linked-honorarium state, and requires one
  disposition.
- For a Complete row, show the disposition and **Edit closeout**.
- Show null on legacy Complete rows as **Closeout disposition not recorded**;
  never infer it from receipt, thank-you, opt-out, or linked-request state.
- Check `response.ok`, display the server reason, disable duplicate submission
  while pending, and refresh only after a confirmed result.
- Change Complete's badge classes only to `bg-green-200 text-green-900`; preserve
  labels, ordering, and status buckets.

### 5. Decouple thank-you from completion

- Leave the automated sweep's receipt eligibility, pre-send attachment build,
  ETag claim, claim-before-send ordering, and at-most-once behavior unchanged.
- Change the retained manual `thankyou` branch to write only
  `thankYouSentAt`; remove its `reviewStatus:'complete'` update.
- Remove the honorarium-processing sentence/token from the seeded and live
  thank-you default so the message acknowledges receipt without communicating
  approval or eligibility. Updating the live Dataverse template is a separate,
  explicitly authorized deployment write; source changes alone do not alter an
  existing seeded value.
- Do not backfill Complete or eligibility from `wmkf_thankyousentat`.

### 6. Operations visibility

The application records eligibility but does not authorize payment. Before
production rollout, confirm with Operations where the reviewer-engagement
disposition will be visible from the linked honorarium request in AkoyaGO. That
may be a reverse-related view/form addition owned outside this repository. If no
Operations consumer exists, the schema/UI release is not end-to-end complete;
do not compensate by writing `wmkf_authorizationtoremitpaymentflag`.

## Tests and gates

Minimum discriminating coverage:

- all three valid dispositions and invalid/unknown values;
- missing receipt, wrong source status, unaccepted/unselected/excluded row;
- eligible + opt-out and eligible + missing-link failures;
- not-applicable complement rejection;
- first close, duplicate same choice, correction, and 412 conflict;
- linked honorarium present while proving no honorarium-request write;
- single and batch generic PATCH reject Complete;
- automated and manual thank-you paths write no Complete/eligibility state;
- reset clears the new field;
- new closeout cannot synthesize a receipt;
- DTO/map/select/bucket parity and Complete badge color.

Run focused tests plus the current schema, Atlas, API-route, route/service,
Dataverse-context, status-enum, docs-catalog, doc-currency, doc-symbol, and
fact-consistency gates. Run each gate and its self-test sequentially where a
self-test exists. Use a feature branch: schema plus authenticated runtime changes
are not Tier 0 and must not land directly on `main`.

## Explicitly out of scope

- Writing or defaulting `wmkf_authorizationtoremitpaymentflag`.
- BILL API/vendor automation or person-payment rails.
- Creating another honorarium request at closeout; request creation remains the
  accept-time workflow.
- Bulk-inference/backfill from receipt or thank-you timestamps.
- Reopening completed engagements or repurposing `withdrew`/`released`.
- Changing the automated thank-you's at-most-once delivery posture.

## Contract-reconcile verdict

**READY TO IMPLEMENT WITH ONE EXTERNAL RELEASE PREREQUISITE:** Operations must
confirm where the new engagement-level disposition is consumed in AkoyaGO.
That prerequisite affects end-to-end rollout, not the approved app-side
contract. The safest build is a one-row ETag closeout with no honorarium-request
write, so cross-record partial success is N/A by construction.
