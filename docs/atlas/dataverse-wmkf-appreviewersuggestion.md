# Atlas: `wmkf_appreviewersuggestion` (Dataverse)

<!-- drain-table:file-purpose=atlas-state-page -->

**Last verified:** 2026-05-09 (Stage 2a additions, see below) — prior verification 2026-05-07 via `scripts/audit-dataverse-state.js` + EntityDefinitions metadata probe
**Live row count:** 336
**Entity set:** `wmkf_appreviewersuggestions`
**Adapter:** `lib/dataverse/adapters/reviewer-suggestion.js`
**Extension manifests:** `lib/dataverse/schema/wave2-existing/wmkf_appreviewersuggestion-extensions.json` (S128–S130 additions) + `lib/dataverse/schema/wave3/04_wmkf_appreviewersuggestion_stage2a.json` (S143 Stage 2a slice 1 additions) + `lib/dataverse/schema/wave5/01_wmkf_appreviewersuggestion_workbench.json` (S196 Workbench prep)
**Native entity audit:** ENABLED (S143). Field-level before/after on the engagement-scope correction fields below is captured by Dataverse's native audit log; no parallel audit entity built. See `scripts/enable-suggestion-audit.mjs`.

## Source of truth

**Active.** Per-(reviewer, request) suggestion + outreach lifecycle. Reviewer Finder writes here on save-candidates; Review Manager updates lifecycle here on send/receive/thank-you. Postgres `reviewer_suggestions` (337 rows) is the legacy mirror — ~97.6% parity per S136 probe.

## Schema (live, 52 custom attrs)

Identity / linkage:
- `wmkf_appreviewersuggestionid` (PK)
- `wmkf_potentialreviewer` (Lookup → `wmkf_potentialreviewers`) + `wmkf_potentialreviewername` (virtual denorm)
- `wmkf_request` (Lookup → `akoya_requests`) + `wmkf_requestname` (virtual)
- alt-key `(wmkf_potentialreviewer, wmkf_request)` (per adapter `findByPotentialReviewerAndRequest`)

Suggestion content:
- `wmkf_suggestionlabel` (String, primary name attr)
- `wmkf_grantcyclecode` (String, e.g. `J26`)
- `wmkf_programarea` (String)
- `wmkf_relevancescore` (Double)
- `wmkf_matchreason` (Memo)
- `wmkf_sources` (String, comma-joined provenance)
- `wmkf_notes` (Memo)

Lifecycle bools (each has a `*name` virtual):
- `wmkf_selected`, `wmkf_invited`, `wmkf_accepted`, `wmkf_declined`

Outreach timestamps:
- `wmkf_emailsentat`, `wmkf_emailopenedat`
- `wmkf_responsereceivedat`, `wmkf_responsetype` (Picklist: `accepted=100000000 | declined=100000001 | no_response=100000002`)
- `wmkf_materialssentat`, `wmkf_remindersentat`, `wmkf_remindercount`
- `wmkf_reviewreceivedat`, `wmkf_thankyousentat`, `wmkf_completedat` (S196 — Workbench closeout stamp)

Review status: `wmkf_reviewstatus` (Picklist: `accepted=100000000 | materials_sent | under_review | review_received | complete=100000004`).
- `complete` (S196 claim): set by Request Workbench when PD closes out — drops the row off the PD dashboard. Paired with `wmkf_completedat` (DateTime, added 2026-05-28).

Honorarium linkage (BILL chunk 1, added by Connor 2026-05-28):
- `wmkf_honorariumrequest` (Lookup → `akoya_request`) + `wmkf_honorariumrequestname` (virtual denorm) — points at the honorarium `akoya_request` row created when the reviewer accepted. Optional; populated by the portal at honorarium-request create time. No backfill on historical engagements.

External-reviewer intake (S128–S130):
- `wmkf_externaltokenhash`, `wmkf_externaltokenissued`, `wmkf_externaltokenexpires`, `wmkf_externaltokenrevoked`
- `wmkf_proposalfirstaccessed`
- `wmkf_proposalurl`, `wmkf_proposalpassword`
- `wmkf_reviewbloburl`, `wmkf_reviewfilename`
- `wmkf_reviewsharepointfolder`
- `wmkf_reviewuploadedbystaff`

Structured review fields (S130 schema additions):
- `wmkf_revieweraffiliation` (String)
- `wmkf_reviewerimpact` (Picklist)
- `wmkf_reviewerrisk` (Picklist)
- `wmkf_revieweroverallrating` (Picklist)

Stage 2a slice 1 additions (S143, deployed 2026-05-09):

Engagement-scope contact corrections (written by reviewer at Stage 2a; never propagated to `wmkf_potentialreviewers` or `contact` — promotion is staff-controlled, deferred):
- `wmkf_reviewerfirstname` (String, max 100)
- `wmkf_reviewerlastname` (String, max 100)
- `wmkf_reviewernickname` (String, max 100)
- `wmkf_reviewertitle` (String, max 200)
- `wmkf_revieweremail` (String, max 200) — engagement-scope correspondence email; replaces prior plan's "write to `contact.emailaddress2/3`" routing
- `wmkf_reviewerorcid` (String, max 50)

Decline structured capture:
- `wmkf_declinereasonpicklist` (Picklist: `too-busy=100000000 | conflict-of-interest=100000001 | outside-expertise=100000002 | bad-timing=100000003 | other=100000004`)
- `wmkf_declinereason` (String/Memo, max 2000) — free-text follow-up; was the locked-S136 field, deployed via this wave
- `wmkf_declinereferral` (String/Memo, max 2000)

Stage 2a state stamps:
- `wmkf_honorariumoptout` (Boolean, default false) — captured at accept
- `wmkf_withdrawnsufficientat` (DateTime) — set when staff cancels pending invitations because enough confirmed reviewers exist
- `wmkf_coiackedat` / `wmkf_aiuseackedat` (DateTime) — policy-acknowledgment timestamps

Policy-acknowledgment lookups (pin to the exact `wmkf_policyversion` row the reviewer saw — see `dataverse-wmkf-policy-and-policy-version.md`):
- `wmkf_coipolicyversion` (Lookup → `wmkf_policyversion`)
- `wmkf_aiusepolicyversion` (Lookup → `wmkf_policyversion`)

Picklist extension on existing `wmkf_responsetype`: added `withdrawn_sufficient=100000003`.

## Adapter contract (`lib/dataverse/adapters/reviewer-suggestion.js`)

Methods:
- `findByPotentialReviewerAndRequest`, `findById`
- `findByRequest(requestId, { selectedOnly })` — used by Review Manager request views
- `findByPD(systemuserid, { cycleCode, selectedOnly })` — two-step: query `akoya_requests` by lead PD then suggestions by request OR-chain (chunks of 25)
- `findAcceptedByPD` — same shape, `wmkf_accepted eq true` filter
- `upsert` — save-candidates path
- `updateLifecycle(id, updates, { actingUserSystemId })` — partial update with picklist mapping for `responseType`/`reviewStatus`
- `softDelete(id)` — sets `wmkf_selected = false`
- `bulkUpdateByRequest` — UI's "assign cycle/program area to whole proposal" action

Picklist maps live in the adapter (`RESPONSE_TYPE_MAP`, `REVIEW_STATUS_MAP`). Callers pass legacy Postgres string values; adapter translates.

## Read / write paths

Read:
- `pages/api/review-manager/{render-emails,send-emails,reviewers,download-review,regenerate-token}.js` — `download-review.js` resolves the SharePoint folder; `regenerate-token.js` reads the suggestion (≈line 62) before minting a replacement token
- `pages/api/reviewer-finder/{save-candidates,my-candidates}.js`
- `lib/external/verify-suggestion-token.js` — load-bearing for every `/external/review/*` endpoint; reads with `$expand=wmkf_Request($select=...),wmkf_PotentialReviewer($select=...)` to hydrate the reviewer landing page in one round trip
- `pages/api/external/review/[token]/context.js` — reader (via `verify-suggestion-token`) AND best-effort writer (`wmkf_proposalfirstaccessed` stamp on first access; non-fatal on failure)

Write (verified 2026-05-07):
- `pages/api/reviewer-finder/save-candidates.js` — adapter `upsert` (per-(reviewer,request) suggestion creation)
- `pages/api/reviewer-finder/my-candidates.js` — adapter `updateLifecycle` (single suggestion lifecycle PATCH), `bulkUpdateByRequest` (per-proposal cycle/program-area assignment), `softDelete` (`wmkf_selected = false`); when `accepted` flips to `true` (≈line 354) calls `ensureToken` from `lib/external/token-lifecycle.js` which is idempotent but may write `wmkf_externaltoken*` fields if no usable token exists
- `pages/api/review-manager/render-emails.js` — `mintAndStore` from `lib/external/token-lifecycle.js`; mints + stores HMAC token hash on `wmkf_externaltokenhash` + `wmkf_externaltokenissued` + `wmkf_externaltokenexpires` per recipient before email render
- `pages/api/review-manager/send-emails.js` — adapter `updateLifecycle` (sets `wmkf_emailsentat`, etc.)
- `pages/api/review-manager/regenerate-token.js` — `mintAndStore` from `lib/external/token-lifecycle.js`; sets `wmkf_externaltoken*` fields
- `pages/api/review-manager/revoke-token.js` — `revoke` from same; flips `wmkf_externaltokenrevoked`
- `pages/api/review-manager/mark-received-no-file.js` — direct `DynamicsService.updateRecord('wmkf_appreviewersuggestions', ...)` for review-received marker
- `lib/services/review-upload.js` `writeReviewFiles` — direct `DynamicsService.updateRecord` setting `wmkf_reviewsharepointfolder` + `wmkf_reviewfilename` + `wmkf_reviewreceivedat` + `wmkf_reviewuploadedbystaff` after SharePoint write (with rollback). Also calls `extendForPostSubmissionWindow` (≈line 191) which patches `wmkf_externaltokenexpires` to enable the 7-day post-submission edit window.
- `pages/api/external/review/[token]/context.js` — best-effort `wmkf_proposalfirstaccessed` stamp on first reviewer access (non-fatal on failure)
- `scripts/backfill-postgres-to-dataverse.js` — `suggestionAdapter.upsert` (≈line 216) and `updateLifecycle` (≈line 229) for Wave 2 backfill, preserving outreach/reminder timestamps

## Cross-system

Postgres `reviewer_suggestions` (337 rows) is parity at ~97.6% per S136 probe (`scripts/backfill-reviewer-suggestions-parity.js`). Cutover plan retires the Postgres table and switches all readers/writers to this entity.

## Schema additions — DEPLOYED 2026-05-09 (S143 Stage 2a slice 1)

`wmkf_declinereason` (Memo, max 2000) — captures why a reviewer declined, replacing free-form `wmkf_notes` for that purpose. Deployed alongside the rest of the Stage 2a slice 1 additions (see the "Stage 2a slice 1 additions" section above for the full field list). The locked-S136 plan originally named two fields; `wmkf_responsereceivedat` turned out to already exist (R5 stress-test 2026-05-07), so only `wmkf_declinereason` was new.

## Token lifecycle (live, per `project_external_reviewer_file_access.md`)

- 90-day mint ceiling; 7-day post-submission modify window (`extendForPostSubmissionWindow` in `lib/external/token-lifecycle.js`).
- Token expiry is **event-driven**, not absolute — extension on submission, revocation on regenerate.
- `wmkf_reviewbloburl` retains historical Vercel Blob URLs for legacy rows but the active write target is `wmkf_reviewsharepointfolder` (Vercel Blob retired 2026-05-03 via commit `2277d23`).

## Migration disposition (post-W3-W6 cutover 2026-05-12)

**Cutover complete.** This entity is the live source of truth for reviewer suggestions; Postgres `reviewer_suggestions` is drain-only with no live application readers/writers. The 4 historical orphan rows in Postgres (missing `request_number`) remain in the drain snapshot and will be handled at the post-pilot one-shot drop. ~~Review Manager `grant_cycles` Postgres dependency~~ **RESOLVED (verified 2026-05-18, S164):** Review Manager reads grant cycles from Dataverse via `lib/services/grant-cycles-dataverse`; no Postgres `grant_cycles` dependency remains in `pages/api/review-manager/*`. See `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md` for the migration log.
