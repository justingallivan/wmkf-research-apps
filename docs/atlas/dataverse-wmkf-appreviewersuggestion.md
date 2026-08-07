# Atlas: `wmkf_appreviewersuggestion` (Dataverse)

<!-- drain-table:file-purpose=atlas-state-page -->

**Last verified:** Runtime decline-referral reader/writer contract reconciled 2026-08-01; Wave 13 metadata/population and M1.3 lifecycle/source aggregates refreshed 2026-07-14 via `node scripts/preflight-reviewer-identity-binding-fields.mjs --target=prod --include-population` and the explicit-target read-only `scripts/probe-reviewer-channel-baseline.js`; row count re-probed 2026-07-26 via `scripts/reconcile-memory-claims.js`. Prior live metadata probe: 2026-05-31 (S208 — `wmkf_applicantdisposition` deployed; 77 `wmkf_`-prefixed attrs, 108 total).
**Live row count:** 724
**Entity set:** `wmkf_appreviewersuggestions`
**Adapter:** `lib/dataverse/adapters/reviewer-suggestion.js`
**Extension manifests:** base entity in `lib/dataverse/schema/wave2/wmkf_app_reviewer_suggestion.json`; extensions in `lib/dataverse/schema/wave2-existing/wmkf_appreviewersuggestion-extensions.json` (S128–S130 additions) + `lib/dataverse/schema/wave3/04_wmkf_appreviewersuggestion_stage2a.json` (S143 Stage 2a slice 1 additions) + `lib/dataverse/schema/wave5/01_wmkf_appreviewersuggestion_workbench.json` (S196 Workbench prep) + `lib/dataverse/schema/wave6/01_wmkf_appreviewersuggestion_applicant_disposition.json` (S208 applicant disposition) + `lib/dataverse/schema/wave13-reviewer-identity-binding/02_wmkf_appreviewersuggestion_identity_coi.json`. Existing-picklist extension artifact: `scripts/extend-reviewstatus-picklist-terminal.mjs` (**production run and verified 2026-07-23**). Relevance-score range widen artifact: `scripts/widen-relevancescore-max.mjs`.
**Native entity audit:** ENABLED (S143). Field-level before/after on the engagement-scope correction fields below is captured by Dataverse's native audit log; no parallel audit entity built. See `scripts/enable-suggestion-audit.mjs`.

## Source of truth

**Active.** Per-(reviewer, request) suggestion + outreach lifecycle. Reviewer Finder writes here on save-candidates; Review Manager updates lifecycle here on send/receive/thank-you. Postgres `reviewer_suggestions` was the 337-row legacy mirror before its 2026-06-04 drop; the ~97.6% parity figure is an S136 historical probe.

## Schema (52 documented custom attrs as of 2026-05-09; +`wmkf_completedat` (S196) +`wmkf_applicantdisposition` (S208) added since — live probe 2026-05-31 shows 77 `wmkf_`-prefixed attrs incl. virtual `*name` denorms)

Identity / linkage:
- `wmkf_appreviewersuggestionid` (PK)
- `wmkf_potentialreviewer` (Lookup → `wmkf_potentialreviewers`) + `wmkf_potentialreviewername` (virtual denorm)
- `wmkf_request` (Lookup → `akoya_requests`) + `wmkf_requestname` (virtual)
- alt-key `(wmkf_potentialreviewer, wmkf_request)` (per adapter `findByPotentialReviewerAndRequest`)

Suggestion content:
- `wmkf_suggestionlabel` (String, primary name attr)
- `wmkf_grantcyclecode` (String, e.g. `J26`)
- `wmkf_programarea` (String)
- `wmkf_relevancescore` (Double, MinValue 0, MaxValue 100, Precision 4) — stores the 0-100 composite `relevanceScore` used for ranking. The save adapter clamps writes to `[0,100]`; the one-time metadata widen artifact is `scripts/widen-relevancescore-max.mjs`.
- `wmkf_matchreason` (Memo)
- `wmkf_sources` (String, comma-joined provenance only; referral closure reuses the existing `referred` token on the candidate row rather than adding operational state here)
- `wmkf_notes` (Memo)

### Additive identity-COI currency — deployed, not authoritative

`lib/dataverse/schema/wave13-reviewer-identity-binding/02_wmkf_appreviewersuggestion_identity_coi.json`
defines four live nullable fields: `wmkf_identitycoistatus`,
`wmkf_identitycoibindingversion`, `wmkf_identitycoicontexthash`, and
`wmkf_identitycoicheckedat`. Together they can later prove that a structured
proposal-specific COI result was computed for both the current person-binding
generation and the current canonical proposal/rule context. The owner-approved
production-only apply completed 2026-07-12. **[VERIFIED 2026-07-13 via the
command in Last verified]** typed metadata reported all four EXACT. No live
application reader or writer uses these names, so the columns are
non-authoritative; the 2026-07-14 population refresh still returned zero rows
with any Wave 13 suggestion value. The earlier dated output is captured in
`docs/audits/reviewer-identity-binding-prod-preflight-2026-07-13.md` and must be
refreshed before schema-adjacent work. Missing/unknown
status, generation mismatch, or missing/context-hash mismatch is designed to
mean stale; `stale` and action eligibility are computed, not stored.

Lifecycle bools (each has a `*name` virtual):
- `wmkf_selected`, `wmkf_invited`, `wmkf_accepted`, `wmkf_declined`
- A reviewer decline atomically sets `wmkf_selected=false`; this archives the
  engagement from active proposal lists/counts while retaining the row in the
  Invite Reviewers panel's Removed section. A pre-materials change back to
  accept restores `wmkf_selected=true`.

Outreach timestamps:
- `wmkf_emailsentat`, `wmkf_emailopenedat`
- `wmkf_responsereceivedat`, `wmkf_responsetype` (Picklist: `accepted=100000000 | declined=100000001 | no_response=100000002`)
- `wmkf_materialssentat`, `wmkf_remindersentat`, `wmkf_remindercount`
- `wmkf_reviewreceivedat`, `wmkf_thankyousentat`, `wmkf_completedat` (S196 — Workbench closeout stamp)

Review status: `wmkf_reviewstatus` (Picklist live in production: `accepted=100000000 | materials_sent=100000001 | under_review=100000002 | review_received=100000003 | complete=100000004 | withdrew=100000005 | released=100000006`; terminal values provisioned and post-publish verified 2026-07-23).
- `complete` (S196 claim): set by Request Workbench when PD closes out — drops the row off the PD dashboard. Paired with `wmkf_completedat` (DateTime, added 2026-05-28).
- `withdrew` / `released` are post-accept terminal outcomes that stamp neither `wmkf_reviewreceivedat` nor `wmkf_completedat`. They are excluded from work-remaining, cannot be written through the generic reviewers PATCH, and use a fresh-read + ETag dedicated transition service. `withdrew` also sets `wmkf_selected=false`; `released` leaves selection unchanged. The shared values in `shared/config/reviewerStatus.js` are accepted only if the owner-gated provisioning script proves they are the next free live values and Dataverse returns the exact requested `NewOptionValue`.

Applicant disposition (S208, wave6 — deployed 2026-05-31):
- `wmkf_applicantdisposition` (Picklist, local optionset: `Recommended=100000000 | Excluded=100000001`; **null = staff/Claude-discovered, the normal case**). Tags an applicant-sourced engagement row. **Per-request only** — lives solely on this junction, never on the global `wmkf_potentialreviewer` person, so a reviewer excluded by one applicant stays eligible for every other request. `excluded` rows are also written `wmkf_selected=false`.
- **Candidate-read convention:** every list/count reader of candidates must drop `excluded` rows. The adapter exposes `notExcludedFilter()` → `(wmkf_applicantdisposition eq null or wmkf_applicantdisposition ne 100000001)`. The `eq null or` is **load-bearing**: Dataverse omits rows whose `$filter` evaluates to null, and `field ne X` is null when the field is null, so a bare `ne` would silently hide every normal (null) candidate. Applied in `findByRequest`/`findByPD`/`findAcceptedByPD` (adapter), `fetchReviewerCounts` (`my-proposals.js`), `fetchCounts` aggregate (`grant-cycles-dataverse.js`, inlined), and `reviewer-suggestion-sweep.js`.
- **Action chokepoints (fail closed):** four layers, tightened after the S208 Codex review.
  - `updateLifecycle` (adapter) reads + THROWS on an excluded row for **every** lifecycle write (not just complete transitions) — covers single/batch PATCH, send-emails, my-candidates, future callers.
  - `findById` (adapter) THROWS on an excluded row — covers email render/send paths that resolve rows through it.
  - `ensureToken` / `regenerate-token` refuse to mint a magic link for an excluded row.
  - `verifySuggestionToken` rejects an excluded row even with a previously-minted live token — the single chokepoint for all external context/respond/upload (reported as `revoked`).
  - **Phase-3 residual** (unreachable while ingestion hasn't written excluded rows; see `docs/REQUEST_WORKBENCH_BUILD_PLAN.md` § "Excluded-row fail-closed boundary"): `mintAndStore` sink self-guard, staff post-acceptance direct writes (`mark-received-no-file`, `review-upload` staff path, `download-review`), the legacy `generate-emails` `.eml` loop, and token-revocation when ingestion flips an existing row to excluded.

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
- `wmkf_revieweraffiliation` (String) — parent identity column; still the read source for the review-context affiliation prefill.
- ~~`wmkf_reviewerimpact` / `wmkf_reviewerrisk` / `wmkf_revieweroverallrating` (Picklist)~~ — **DROPPED from Dataverse (Phase E2, S305).** Ratings now live solely in the `wmkf_appreviewanswer` snapshot (migrated to read in Phase D, write stopped in E1, columns deleted in E2 via `scripts/drop-reviewer-rating-columns.mjs`). Retired from schema-as-code so a re-apply can't recreate them. Forward constraint: never redeploy pre-E1 code (it would PATCH these missing columns).

Stage 2a slice 1 additions (S143, deployed 2026-05-09):

Engagement-scope contact corrections (written by reviewer at Stage 2a; downstream
propagation is field-specific, not all-or-nothing):
- `wmkf_reviewerfirstname` (String, max 100)
- `wmkf_reviewerlastname` (String, max 100)
- `wmkf_reviewernickname` (String, max 100)
- `wmkf_reviewertitle` (String, max 200)
- `wmkf_revieweremail` (String, max 200) — engagement-scope correspondence email; replaces prior plan's "write to `contact.emailaddress2/3`" routing
- `wmkf_reviewerorcid` (String, max 50)

The acceptance follow-up flow synchronizes reviewer-confirmed name, nickname,
and title to the linked contact through
`sync-reviewer-name-title-to-contact.js`; ORCID and board identity use their own
capture paths. Email and affiliation differences remain engagement-scoped and
drive mismatch/operations handling rather than silently overwriting the contact.

Decline structured capture:
- `wmkf_declinereasonpicklist` (Picklist: `too-busy=100000000 | conflict-of-interest=100000001 | outside-expertise=100000002 | bad-timing=100000003 | other=100000004`)
- `wmkf_declinereason` (String/Memo, max 2000) — legacy free-text follow-up; no longer solicited by the current portal
- `wmkf_declinereferral` (String/Memo, max 2000) — current portal writes a `wmkf-referrals:v1:` JSON envelope containing up to four `{name,institution,email}` rows. The staff reader expands those rows and treats non-envelope values as legacy display-only text. Staff acknowledgement never mutates this memo: the exact parsed index is marked in `wmkf_sources`, preserving what the reviewer submitted. This is a runtime encoding contract, not a schema change.

Stage 2a state stamps:
- `wmkf_honorariumoptout` (Boolean, default false) — captured at accept
- `wmkf_withdrawnsufficientat` (DateTime) — set when staff release pending invitees because enough reviewers have accepted. **WRITER (reviewer-engagement Phase 4, S275):** `POST /api/review-manager/withdraw-sufficient` (the "Release as no longer needed" action on the **Invite Reviewers** tab, `ReviewerInvitePanel.js`) — sets this + `wmkf_responsetype=withdrawn_sufficient` + clears `wmkf_respondremindersentat`, ONLY on still-pending rows (invited && !accepted && !declined). Closes the §2.9 "view + guard exist but nothing writes it" gap.
- `wmkf_coiackedat` / `wmkf_aiuseackedat` (DateTime) — policy-acknowledgment timestamps

Policy-acknowledgment lookups (pin to the exact `wmkf_policyversion` row the reviewer saw — see `dataverse-wmkf-policy-and-policy-version.md`):
- `wmkf_coipolicyversion` (Lookup → `wmkf_policyversion`)
- `wmkf_aiusepolicyversion` (Lookup → `wmkf_policyversion`)

Picklist extension on existing `wmkf_responsetype`: added `withdrawn_sufficient=100000003`.

## Adapter contract (`lib/dataverse/adapters/reviewer-suggestion.js`)

Methods:
- `findByPotentialReviewerAndRequest` — upsert lookup; disposition-aware (returns excluded rows so `upsert` can honor "excluded wins", but does not throw)
- `findById` — **THROWS on an applicant-excluded row** (action chokepoint; see Applicant disposition above)
- `findByRequest(requestId, { selectedOnly })` — used by Review Manager request views; carries `notExcludedFilter()`
- `findApplicantRecommendedByRequest(requestId)` — Workbench Find enrichment reader for applicant-suggested rows; filters by `_wmkf_request_value`, `wmkf_applicantdisposition=Recommended`, and `notExcludedFilter()` with **no** `wmkf_selected` constraint so unpromoted rows are enriched for PD review
- `findByPD(systemuserid, { cycleCode, selectedOnly })` — two-step: query `akoya_requests` by lead PD then suggestions by request OR-chain (chunks of 25); carries `notExcludedFilter()`
- `findAcceptedByPD` — same shape, `wmkf_accepted eq true` filter; carries `notExcludedFilter()`
- `upsert` — save-candidates path; accepts `applicantDisposition`; refuses to
  convert an existing excluded row into a selected candidate (returns
  `{ skippedExcluded: true }`) and converges after a lost alternate-key create
  race by re-reading the exact person/request junction. The save orchestrator
  treats `skippedExcluded` as named failure `applicant_excluded`, never success.
- `ensureApplicantRecommended({ potentialReviewerId, requestId, …, ifMatch })`
  — **Workbench ingestion** of the legacy `wmkf_potentialreviewer1..5` slots.
  Idempotently materializes a `disposition=recommended` row with
  `selected=false` on first create; an existing row's `wmkf_selected` is left
  untouched so lazy ingestion never promotes or resurrects a row. It **unions**
  `applicant` into existing `wmkf_sources` (no clobber), fills descriptive
  fields only when empty, honors "excluded wins", and is race-safe. Merge
  provenance union may require the current suggestion ETag; a missing/stale
  value forces a re-plan. Returns `{ id, created, selected }`.
- `ensureStaffManualCandidate({ potentialReviewerId, requestId, … })` — **Workbench manual reviewer add**. Idempotently materializes/reselects a non-excluded staff-added row, **unions** `staff_manual` into existing `wmkf_sources` (no clobber), preserves applicant recommendation state when an existing row already has it, honors "excluded wins" (`{ skippedExcluded: true }`), and catches a lost alternate-key create race. Unlike lazy applicant ingestion, this is an explicit staff action, so an existing soft-deleted non-excluded row is re-selected. **Re-add fresh start (S343):** when the re-selected row was *removed* (`wmkf_selected===false`), `ENGAGEMENT_STAMP_RESET` clears the stale engagement stamps (`wmkf_invited=false`; `wmkf_emailsentat`, `wmkf_respondremindersentat`, `wmkf_remindersentat`, `wmkf_remindercount`, `wmkf_materialssentat`, `wmkf_reviewreceivedat`, `wmkf_responsereceivedat`, `wmkf_thankyousentat`, `wmkf_completedat`, `wmkf_withdrawnsufficientat`, `wmkf_proposalfirstaccessed` = `null`) so the row returns to a clean engagement lifecycle; an already-active row's stamps are left untouched. The re-select PATCHes are ETag-guarded from the fetched row; on 412 they re-fetch, source-union without reset if the row is now active, or retry the reset if it is still removed.
- `dismissLegacyDeclineReferral({ suggestionId, requestId })` — validates the exact declined source row and rejects structured envelopes, then ETag-conditionally stores a compact resolved prefix before the original legacy text. Request-scoped, idempotent, and retries one 412. Structured closure is derived read-side from exact existing `referred` candidate evidence.
- `updateLifecycle(id, updates, { actingUserSystemId, ifMatch })` — partial update with picklist mapping for `responseType`/`reviewStatus`/`applicantDisposition`; supports `completedAt`. Reads the row once per write to (a) THROW on an applicant-excluded row, (b) refuse status changes out of `withdrew`/`released`, and (c) stamp `wmkf_completedat`+`wmkf_reviewreceivedat` idempotently only on a `reviewStatus=complete` transition. Status-changing writes bind to the guard read's ETag when the caller does not supply a stricter one.
- `applyStaffReviewerWithdrawal(id, { ifMatch, actingUserSystemId, deleteHonorariumRequestId })` — PD-recorded post-accept withdrawal. Requires the fresh row ETag; atomically writes `accepted=false`, `declined=true`, declined response metadata, `reviewStatus=withdrew`, and token revocation while deleting the exact server-read linked honorarium `akoya_request` in one changeset. Without an honorarium link, performs the same ETag-guarded row correction as one PATCH.
- `softDelete(id)` — sets `wmkf_selected = false`
- `hardDeleteById(id)` — merge-support hard delete for an un-engaged colliding loser row (pre-existing, S289 merge)
- `bulkUpdateByRequest` — UI's "assign cycle/program area to whole proposal" action

**Permanent removal ("Remove entirely", S343; file safety hardened 2026-07-26):** `lib/services/reviewer-finder/remove-candidate-service.js` (`removeCandidateEntirely`) hard-deletes the suggestion row itself via a `DELETE` op inside an atomic Dataverse `$batch` changeset (`runChangeset`) alongside the linked `wmkf_appreviewanswer` snapshot rows and the honorarium `akoya_request` (via `wmkf_honorariumrequest`) — NOT via `hardDeleteById`, which is the pre-existing merge-only single-record delete. Cascades a Postgres `review_drafts` cleanup (`ReviewDraftService.deleteBySuggestion`, cross-store, ordered after the changeset commits) and a separately best-effort SharePoint cleanup. The SharePoint target set is resolved before any durable mutation: isolated current-generation `attempt_<32-hex>` folders delete all files from that upload attempt, while legacy folder shapes delete only the exact stored `wmkf_reviewfilename` and preserve other files. Internal operators may pass an exact drive-item `{id,name}` allowlist; drift aborts before the audit/changeset, and per-file delete results are retained in the audit. If Graph target resolution fails for the normal UI route, the engagement removal proceeds while all file cleanup is skipped and audited as partial; an explicit internal allowlist instead fails closed. Pre-delete `system_alerts` audit breadcrumb; no test/sandbox precondition (owner decision — high-trust, no blocks). Design: `docs/REVIEWER_REMOVE_ENTIRELY_BUILD_PLAN.md`.

**Accepted reviewer withdrawal (2026-07-24):** before review receipt, the
token-authenticated reviewer may use the ordinary decline reason/referral form,
or a PD may record the same withdrawal from Track Reviewers when the reviewer
communicates outside the portal. Both paths atomically PATCH this row to
`accepted=false`, `declined=true`, `responsetype=declined` and DELETE the exact
server-read `_wmkf_honorariumrequest_value` `akoya_request` in one
`runChangeset`. No contact, potential-reviewer, suggestion, or response-history
row is deleted. Rollups read the changed fields directly. Self-service asks for
alternate suggestions and notifies the assigned PD; the staff action skips that
form and cancels pending acceptance follow-up. Idempotent self-service repeats
do not re-stamp or re-notify, but do clean up a late linked honorarium left by
an acceptance-worker race.

Exported helpers (S208): `APPLICANT_DISPOSITION_MAP`, `APPLICANT_DISPOSITION_EXCLUDED`, `notExcludedFilter(field?)`, `isExcluded(row)`.

Picklist maps live in the adapter (`RESPONSE_TYPE_MAP`, `REVIEW_STATUS_MAP`, `APPLICANT_DISPOSITION_MAP`). Callers pass legacy Postgres string values; adapter translates.

## Read / write paths

Read:
- `pages/api/review-manager/{render-emails,send-emails,reviewers,download-review,regenerate-token}.js` — `download-review.js` resolves the SharePoint folder; `regenerate-token.js` reads the suggestion before minting a replacement token
- `pages/api/reviewer-finder/{save-candidates,my-candidates}.js`
- `lib/external/verify-suggestion-token.js` — load-bearing for every `/external/review/*` endpoint; reads with `$expand=wmkf_Request($select=...),wmkf_PotentialReviewer($select=...)` to hydrate the reviewer landing page in one round trip
- `pages/api/external/review/[token]/context.js` — reader (via `verify-suggestion-token`) AND best-effort writer (`wmkf_proposalfirstaccessed` stamp on first access; non-fatal on failure)

Write (verified 2026-05-07; +Phase 3 ingestion S210):
- `pages/api/workbench/applicant-reviewers.js` — adapter
  `ensureApplicantRecommended` per populated legacy slot (lazy on Find-tab
  open). Writes only `disposition=recommended`, `wmkf_selected=false` rows;
  **writes NO `disposition=excluded` rows** (S210 option B — excluded names are
  parsed via `lib/services/reviewer-exclusion-parser.js` and returned for the
  search soft-block only, nothing global touched). After materialization, the
  service independently hydrates the exact linked person into the bounded
  `applicantKnownReviewer` response projection; a person-read failure does not
  roll back or relabel the suggestion result.
- `pages/api/workbench/enrich-recommended.js` — adapter
  `findApplicantRecommendedByRequest` reads applicant-recommended rows
  regardless of `wmkf_selected`; exact person data is re-read before external
  enrichment, stored affiliation/ORCID seed identity resolution, and the
  bounded email/source pair is persisted only in the existing Postgres roster.
  Writes deterministic COI tags to `wmkf_matchreason` through `setMatchReason`
  and per-person enrichment through the researcher adapter. Stored/enriched
  address disagreement is surfaced as `applicantContactMismatch` and cannot
  relabel the stored address with the enriched source; all-person read failure
  returns explicit unresolved rows rather than a false clean empty result.
- `pages/api/workbench/promote-applicant-reviewer.js` — requires the canonical
  roster row/key, freshly re-reads the suggestion and exact applicant-linked
  person, and rechecks active email ownership. It may reuse the canonical
  email/source pair without an email write; inactive, missing, conflicting, or
  stored/enriched-mismatch contact fails with a stable code. It then uses
  adapter `findById` and `updateLifecycle(suggestionId, { selected: true })`.
  Only after selection succeeds does the server finalize the exact roster key
  as `saved`; missing contact, identity conflict, absent roster authority, or
  roster-finalization failure never reports a clean promotion.
- `pages/api/workbench/manual-reviewer.js` — adapter `ensureStaffManualCandidate` for sparse staff-entered reviewers. Creates/reuses the person through the identity-safe manual-add path, then writes/reselects the per-request suggestion with `staff_manual` and, for reviewer referrals, `referred` in `wmkf_sources`. It does not carry or mutate decline-referral indexes.
- `pages/api/workbench/decline-referrals.js` — GET expands unresolved referral items. Structured rows are omitted when exact request-scoped `referred` candidate evidence proves selection/engagement; legacy rows carrying the resolved memo prefix are omitted. PATCH calls `dismissLegacyDeclineReferral` and rejects structured rows.
- `pages/api/reviewer-finder/save-candidates.js` — canonical contact projection
  and contact-bound v3/v4 or staff-confirmation authority are checked before person/suggestion
  writes. Adapter `upsert` creates/converges the per-(reviewer,request)
  suggestion; the service returns exact per-key `saved`/`withheld`/`failed`
  results and performs the server-owned roster finalization. An
  applicant-excluded collision is stored as roster `blocked`, not counted as
  saved.
- `pages/api/reviewer-finder/my-candidates.js` — adapter `updateLifecycle` (single suggestion lifecycle PATCH), `bulkUpdateByRequest` (per-proposal cycle/program-area assignment), `softDelete` (`wmkf_selected = false`); when `accepted` flips to `true` calls `ensureToken` from `lib/external/token-lifecycle.js` which is idempotent but may write `wmkf_externaltoken*` fields if no usable token exists. `DELETE {mode:'hard'}` dispatches instead to `removeCandidateEntirely` (see the Permanent removal bullet above) — a hard delete, not a `softDelete` variant.
- `pages/api/review-manager/render-emails.js` — read-only preview. It substitutes `SEND_TIME_TOKEN_PLACEHOLDER_JWT` through `buildSendTimeExternalUrlPlaceholder` and never calls `mintAndStore`; repeated/overlapping previews do not change `wmkf_externaltoken*` authority.
- `pages/api/review-manager/send-emails.js` — adapter `updateLifecycle`; materials sends retain the existing best-effort `wmkf_materialssentat` / `materials_sent` lifecycle update after dispatch. Thank-you sends do not move a terminal row to `complete`. **Send-time writer/authority (S404 v4):** `send-emails-service.js` extracts the final edited subject/body link, defense-in-depth verifies any real legacy/edited JWT, computes the unchanged per-recipient expiry, calls `mintAndStore`, and substitutes only the JWT path segment immediately before invoking Dynamics dispatch. Mint failures remain per-row `email_failed {code,error}` and do not stop healthy siblings.
- `pages/api/review-manager/terminal-transition.js` — dedicated fresh-read/ETag service writes only `withdrew` or `released` from accepted/materials-sent/under-review rows with no received/completed stamp. For `withdrew`, it also corrects accepted/declined response state, deletes the exact linked honorarium in the same changeset, and cancels acceptance follow-up; `released` remains status-only. Generic `/reviewers` PATCH explicitly refuses both terminal values.
- `pages/api/review-manager/regenerate-token.js` — `mintAndStore` from `lib/external/token-lifecycle.js`; sets `wmkf_externaltoken*` fields
- `pages/api/review-manager/revoke-token.js` — `revoke` from same; flips `wmkf_externaltokenrevoked`
- `pages/api/review-manager/manual-review-entry.js` — structured staff receipt sink; shared guard freshly rejects terminal/already-received/non-accepted rows and binds the complete parent/answer snapshot changeset to that authorizing ETag
- `pages/api/review-manager/mark-received-no-file.js` — partial/no-file staff receipt sink; the same shared guard and ETag protect both the bare parent PATCH and parent-plus-rating changeset
- `lib/services/review-upload.js` `writeReviewFiles` — shared staff/self-token file receipt sink; the same guard authorizes the pre-upload row, its ETag protects the later parent PATCH/changeset, and every attempt uploads into a unique `attempt_<uuid>` SharePoint subfolder whose exact path is persisted by the winner. A lost race cleans up only the losing attempt and excludes any item id visible in the winning persisted folder before deletion. Also calls `extendForPostSubmissionWindow` after commit.
- `pages/api/external/review/[token]/submit.js` — canonical structured external receipt sink; the verifier row (or the supported fresh missing-ETag fallback) passes the same shared guard and its ETag protects the atomic parent/answer changeset. The fallback selects `wmkf_reviewstatus`, so it cannot acquire a terminal row's fresh ETag blindly.
- `pages/api/external/review/[token]/context.js` — best-effort `wmkf_proposalfirstaccessed` stamp on first reviewer access (non-fatal on failure)
- `scripts/backfill-postgres-to-dataverse.js` — `suggestionAdapter.upsert` and `updateLifecycle` for Wave 2 backfill, preserving outreach/reminder timestamps

## Cross-system

Postgres `reviewer_suggestions` had 337 rows at the historical S136 parity
probe. Migration `018_drop_reviewer_finder_postgres_tables.sql` dropped that
table on 2026-06-04; this Dataverse entity is the sole live suggestion ledger.

## Schema additions — DEPLOYED 2026-05-09 (S143 Stage 2a slice 1)

`wmkf_declinereason` (Memo, max 2000) — captures why a reviewer declined, replacing free-form `wmkf_notes` for that purpose. Deployed alongside the rest of the Stage 2a slice 1 additions (see the "Stage 2a slice 1 additions" section above for the full field list). The locked-S136 plan originally named two fields; `wmkf_responsereceivedat` turned out to already exist (R5 stress-test 2026-05-07), so only `wmkf_declinereason` was new.

## Schema additions — DEPLOYED 2026-06-21 (S275 reviewer-engagement)

`wmkf_respondremindersentat` (DateTime, DateAndTime/UserLocal) — Phase-3 fire-once marker for the per-reviewer respond-by reminder; SEPARATE from the review-due/follow-up marker (`wmkf_remindersentat`). **LIVE (Phase 3, S275):** SET by the `/api/cron/reviewer-reminders` respond sweep (claim-before-send via If-Match) and CLEARED on Re-invite in `send-emails` (`updateLifecycle({ respondReminderSentAt: null })`, same write as the `emailSentAt` re-stamp — §3.B required side-effect — so a new offer window can remind again). Provisioned in prod via `apply-dataverse-schema --target=prod --wave=7-reviewer-engagement --execute`; no Power Automate trigger. Schema spec: `lib/dataverse/schema/wave7-reviewer-engagement/wmkf_appreviewersuggestion-reviewer-engagement.json`. The per-request campaign-config half of this wave lives on `akoya_request` (see that Atlas page). The review-due reminder reuses the existing `wmkf_remindersentat` so the cron and the manual followup generally don't double-nudge. **Known residual (Codex P3, deferred):** the cron claims `wmkf_remindersentat` BEFORE send (If-Match) but the manual followup stamps it AFTER send, so a manual followup in the same daily window — or one whose post-send stamp fails — can leave a row cron-eligible and yield one extra nudge. Accepted as low-risk (manual followups are rare/staff-initiated; cron is daily).

## Token lifecycle (live, per `project_external_reviewer_file_access.md`)

- **Mint expiry is per-recipient (reviewer-engagement Phase 2, S275):** `send-emails-service` sets it via `computeReviewerTokenExpiry` (`lib/external/reviewer-token-ttl.js`), keyed on ACCEPTED status — an accepted reviewer gets review-due + 90d (long review window); an invitee/non-responder gets the early cap at review-due + 2d; with no sane future `wmkf_reviewduedate` it falls back to now + 90d (prior flat behavior). `regenerate-token` / `ensureToken` still use a flat 90-day default. 7-day post-submission modify window via `extendForPostSubmissionWindow`.
- Token expiry is **event-driven**, not absolute — capped vs long at mint by accepted status, extension on submission, revocation on regenerate.
- `wmkf_reviewbloburl` retains historical Vercel Blob URLs for legacy rows but the active write target is `wmkf_reviewsharepointfolder` (Vercel Blob retired 2026-05-03 via commit `2277d23`).

## Migration disposition (post-W3-W6 cutover 2026-05-12)

**Cutover complete.** This entity is the live source of truth for reviewer
suggestions; Postgres `reviewer_suggestions` was dropped on 2026-06-04, so old
drain/orphan cleanup instructions are historical only. ~~Review Manager
`grant_cycles` Postgres dependency~~ **RESOLVED (verified 2026-05-18, S164):**
Review Manager reads grant cycles from Dataverse via
`lib/services/grant-cycles-dataverse`; no Postgres `grant_cycles` dependency
remains in `pages/api/review-manager/*`. See
`docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md` for the migration log.
