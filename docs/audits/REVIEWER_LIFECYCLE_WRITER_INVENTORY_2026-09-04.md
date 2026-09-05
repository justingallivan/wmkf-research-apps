---
title: Reviewer Lifecycle Stage 0 — Alias-aware Writer Inventory
kind: audit
domain: reviewer-workbench
status: active
canonical: false
owner: product-engineering
last_verified: 2026-09-04
---

# Stage 0 reviewer lifecycle writer census (2026-09-04 PDT)

[VERIFIED via source + commands below] Repo `/Users/gallivan/Code/WMKF_Apps`, baseline `ffc932b7`, branch `codex/reviewer-lifecycle-stage0`. Inventory-only: no live services, scripts, SQL, network, schema operations, or deployments invoked. This is a source census, not a claim about deployed writers or external Power Automate flows.

Scope: reviewer suggestion lifecycle, its token/receipt/pointer/claim writes, candidate selection/reset/merge, and linked honorarium/removal effects. Entry points are existing services/routes/scripts; durable surface is Dataverse `wmkf_appreviewersuggestions` plus existing answer children and honorarium Request links. Consumers are reviewer DTOs, token verification, readiness/rollups, reminders, history, and administrative tools. F6 is the finding owned by this slice; the other Stage 0 agents own composed semantics.

## F6 test isolation result

[VERIFIED via tests] Before edits, `./node_modules/.bin/jest --runInBand --no-cache --watch=false --runTestsByPath tests/unit/reviewers-service.test.js` passed 22 tests while printing seven real `getReviewSynthesisJobState` → `@vercel/postgres` missing-connection-string errors. The service catches at `lib/services/review-manager/reviewers-service.js:407-426`; real SQL entry is `lib/services/review-synthesis-job-service.js:171-195`. This corroborates F6; a green unit suite did not imply isolated dependencies.

Changed only `tests/unit/reviewers-service.test.js`: explicit synthesis-job mock with not-started state; a separately rejected dependency test asserts the exact unavailable DTO and exact error log while preserving an existing synthesis/reviewer response; afterEach assertions reject any SQL or fetch call, including swallowed calls. The edited suite passes 23/23 with no console output. No production semantics changed. The test still intentionally mocks the adapter; composed real-adapter guarantees belong to the Stage 0 integration suites.

Invariants: ordinary DTO tests must never initialize SQL; dependency failure must preserve reviewers and stored synthesis while setting current=false/status=unavailable; logging must carry the original error; sequential batch behavior remains unchanged. Complement checked: normal dependency state remains not_started (not a permanent unavailable stub); failure is explicit and separately asserted.

## Reproduction and denominators

CodeGraph first: `codegraph explore "lib/services/review-manager/reviewers-service.js and tests/unit/reviewers-service.test.js; updateLifecycle patchFields patchReviewReceipt runChangeset lifecycle writer callers"`, then focused symbol exploration. CodeGraph omitted an important DI alias (`suggestions.setHonorariumRequest`) and is not the final denominator.

The TypeScript-AST census script (Appendix C) scans all 1,281 **tracked** `.js/.jsx/.ts/.tsx/.cjs/.mjs` files in `lib`, `pages`, `shared`, `scripts`. It follows named/renamed and namespace imports, `require`, literal dynamic imports, local aliases, destructured defaults, and `deps.member || importedDefault` bindings for suggestion adapter and changeset modules. It resolves 173 call sites: 154 suggestion calls, 14 runChangeset calls, and 5 atomicParentWithChildren builders. Of the 154 suggestion calls, 55 call writer exports and 99 call readers/pure predicates. The 55 external writer-export call sites are across 27 runtime files and 8 scripts; they are **not** all suggestion mutations: raw script writes, direct changeset producers, and adapter-internal calls are additional rows below. `updateLifecycle` has 16 imported call sites (15 runtime + one script), plus the adapter-internal `bulkUpdateByRequest` call at line 2249. `patchFields` has two call sites; `patchReviewReceipt` four. The export alias `patchFields === patchReviewReceipt` is exact at `reviewer-suggestion.js:1367`.

Unresolved computed call aliases within the census's recognized module bindings: **0**. This is bounded static evidence, not a claim to solve arbitrary JavaScript reflection. Manual raw-field/entity searches cover direct REST/script calls and passed dependency defaults. No additional runtime raw suggestion writer was found outside the adapter or descriptor paths below. Runtime `individual-file-service.js:614` constructs a PATCH URL only for interlock validation; its persistence is still `patchReviewReceipt` at 662. BILL `runAtomic` operates on contact/person, not the suggestion row.

Additional searches (all read-only):

```sh
rg -n '\b(updateLifecycle|patchFields|patchReviewReceipt|runChangeset)\b' lib pages shared scripts --glob '*.{js,jsx,ts,tsx,cjs,mjs}'
rg -n 'reviewer-suggestion|core/changeset|token-lifecycle' lib pages shared scripts --glob '*.{js,jsx,ts,tsx,cjs,mjs}'
rg -n 'wmkf_appreviewersuggestions' lib pages shared scripts --glob '*.{js,jsx,ts,tsx,cjs,mjs}'
rg -n '^export |DynamicsService\.(updateRecord|createRecord|deleteRecord)|runChangeset\(' lib/dataverse/adapters/reviewer-suggestion.js
rg -n 'ENGAGEMENT_STAMP_RESET|setHonorariumRequest|mintAndStore|ensureToken|extendForPostSubmissionWindow' lib pages shared scripts --glob '*.{js,jsx,ts,tsx,cjs,mjs}'
```

The raw-field fan-out search also covers the entire updateLifecycle map/reset set plus token, response, receipt/pointer, honorarium and selection columns: `wmkf_invited`, `wmkf_selected`, `wmkf_accepted`, `wmkf_declined`, `wmkf_responsetype`, `wmkf_reviewstatus`, `wmkf_applicantdisposition`, `wmkf_emailsentat`, `wmkf_responsereceivedat`, `wmkf_materialssentat`, `wmkf_remindersentat`, `wmkf_remindercount`, `wmkf_respondremindersentat`, `wmkf_reviewduedateoverride`, `wmkf_withdrawnsufficientat`, `wmkf_heldat`, `wmkf_reviewreceivedat`, `wmkf_thankyousentat`, `wmkf_completedat`, `wmkf_honorariumeligibility`, `wmkf_honorariumoptout`, `_wmkf_honorariumrequest_value`, `wmkf_HonorariumRequest@odata.bind`, `wmkf_externaltokenhash`, `wmkf_externaltokenissued`, `wmkf_externaltokenexpires`, `wmkf_externaltokenrevoked`, `wmkf_proposalfirstaccessed`, `wmkf_reviewsharepointfolder`, `wmkf_reviewfilename`, `wmkf_reviewuploadedbystaff`, `wmkf_notes`, `wmkf_programarea`, `wmkf_grantcyclecode`, `wmkf_declinereason`, `wmkf_declinereasonpicklist`, `wmkf_declinereferral`, `wmkf_coiackedat`, `wmkf_aiuseackedat`, and their policy lookup bindings. Source projections and descriptor payloads were read separately; a raw field occurrence is never counted as a writer merely because it matches.

## A. Runtime writer/operation matrix

Paths below are repository-relative. Multiple locations in one row are distinct call sites, not separate operation contracts.

| Role | Calling source | Persistence target / alias and contract to preserve |
|---|---|---|
| Command: closeout/correction | `lib/services/review-manager/close-review-service.js:172,198` | `suggestionAdapter.updateLifecycle`; ETag-bound notes/eligibility correction, or Complete+first-completion time+eligibility. Dedicated eligibility validation. |
| Command: generic status correction | `lib/services/review-manager/reviewers-service.js:493,498` | Namespace `updateLifecycle`; sequential batch or shell-built lifecycle, actor passed, no caller ETag; adapter defaults ETag only when status field is present. |
| Command: manual invite/history correction | `lib/services/reviewer-finder/my-candidates-service.js:616,660` | Namespace `updateLifecycle`; secure-link manual record passes ETag and resets respond-reminder marker. Generic path independently accepts lifecycle values. On accepted=true, `ensureToken` at 669 follows nonfatally before person edits. |
| Command: pending invitation withdrawal | `lib/services/review-manager/withdraw-sufficient-service.js:265` | Namespace `updateLifecycle`; response=withdrawn_sufficient/time/reset respond marker, same caller ETag, transition before courtesy send. |
| Command: terminal release | `lib/services/review-manager/terminal-transition-service.js:106` | Namespace `updateLifecycle`; release status and token revocation in one ETag write. Postcommit job cancellation remains separate. |
| Command: staff withdrawal | `lib/services/review-manager/terminal-transition-service.js:97` | Namespace `applyStaffReviewerWithdrawal`; accepted=false/declined=true/selected=false/response/status/revoke; optional exact honorarium DELETE in one changeset. |
| Command: external legacy decline repair | `lib/services/external-review/respond-service.js:263` | Named `updateLifecycle`; selected=false repair for already-declined row, ETag only when present. |
| Command: external accept/decline | `lib/services/external-review/respond-service.js:288,407` | Named `applyStage2aResponse`; response tuple, contact corrections, honorarium opt-out, policy acknowledgement fields; acceptance sets selected=true, decline false. Optional honorarium deletion atomic with parent; staged PG acceptance job precedes Dataverse accept. |
| Command: change deadline | `lib/services/reviewer-due-extension.js:312` | Named `updateLifecycle`; reviewDueDateOverride under suggestion ETag, followed by notification. |
| Command: expire invitation | `lib/services/reviewer-suggestion-sweep.js:93` | Named `patchFields`; unconditional no_response+response timestamp from scan; F2 baseline remains a characterization. |
| Email delivery bookkeeping: invitation | `lib/services/review-manager/send-emails-service.js:827` | Namespace `updateLifecycle`; invited/email time/reset respond reminder after transport, separate sent-but-not-stamped behavior. |
| Email delivery bookkeeping: materials/reminder/thanks | `lib/services/review-manager/send-emails-service.js:921,931,937` | Namespace `updateLifecycle`; materials time/optional materials_sent; reminder time/count/optional under_review; thank-you time alone. Snapshot-based F4 is unchanged in Stage 0. |
| Email legacy generation stamp | `lib/services/reviewer-finder/generate-emails-service.js:501` | Namespace `patchFields`; raw emailsentat/invited, no ETag. Generation-only legacy marking is distinct from delivery evidence. |
| Email claim: respond reminder | `lib/services/reviewer-reminder-sweep.js:406` → `lib/external/token-lifecycle.js:68` | `mintAndStore` → named `setExternalToken`; `writeFields` combines respond-reminder marker with token hash/issue/expiry/revoke=false under claim ETag, before send. |
| Email claim: review-due reminder | `lib/services/reviewer-reminder-sweep.js:415` | Named `updateLifecycle`; marker/count under claim ETag before send; does not rotate review token. |
| Email claim: automated thank-you | `lib/services/reviewer-thankyou-sweep.js:85` | Named `patchReviewReceipt`; **postreceipt** thank-you timestamp claim under row ETag before send. Not another receipt; not Complete. |
| Receipt: external full submission | `lib/services/external-review/submit-service.js:191` | Named `runChangeset(atomicParentWithChildren(...))`; `ENTITY_SET_NAME as SUGGESTION_ENTITY_SET`; real builder parent Review Received+received timestamp and answer children. Legacy omitted setVersion accepted. |
| Receipt: staff full manual entry | `lib/services/review-manager/manual-review-entry-service.js:180` | Same aliased parent entity and real builder; required setVersion, staff attribution, parent+answers atomic. |
| Receipt: staff/external file upload | `lib/services/review-upload.js:293,304` | Named `patchReviewReceipt` for zero children; otherwise aliased `SUGGESTION_ENTITY_SET` descriptor + `runChangeset`; pointers+received+Review Received+staff flag, same receipt authorization ETag. |
| Receipt: partial/no file | `lib/services/review-manager/mark-received-no-file-service.js:122,138` | Named `patchReviewReceipt` or `runChangeset`; entity import aliased as `ENTITY_SET`; present snapshots only, received+Review Received+staff flag, authorization ETag. |
| Document pointer after receipt | `lib/services/review-documents/individual-file-service.js:662` | Named `patchReviewReceipt`; **only** folder/filename, conditional attempt/readback/retry. Completed review remains eligible. |
| Token mint/rotate | `lib/external/token-lifecycle.js:68` | Named `setExternalToken`; raw writeFields spread then token hash/issued/expires/revoked=false. Higher-level callers listed below. |
| Token revoke | `lib/external/token-lifecycle.js:84` | Named `revokeExternalToken`; revoked=true; separate from generic terminal operation. |
| Token postsubmission expiry | `lib/external/token-lifecycle.js:198` | Named `extendExternalTokenExpiry`; expiry only, nonfatal upload tail. |
| Projection-adjacent first-access stamp | `lib/services/external-review/context-service.js:93` | Named `stampProposalFirstAccessed`; writes first-access timestamp, then refreshes ETag at 102. A read-looking context GET is a writer. |
| Candidate selection/create | `lib/services/reviewer-finder/save-candidates-service.js:1541` | Namespace alias `reviewerSuggestionAdapter.upsert`; selected/scoring/source metadata; existing selection uses engagement check + required ETag. |
| Applicant recommendation/provenance | `lib/services/workbench/applicant-reviewers-service.js:119` | Namespace alias `reviewerSuggestionAdapter.ensureApplicantRecommended`; create unselected recommended or union provenance while preserving selected state. |
| Staff manual candidate/reset | `lib/services/workbench/manual-reviewer-service.js:237` | Namespace alias `ensureStaffManualCandidate`; specialized create/reselect/provenance-only behavior; inactive unhandled rows get canonical reset set. |
| Applicant promotion | `lib/services/workbench/promote-applicant-reviewer-service.js:672` | Namespace alias `selectIfUnengaged`; compare-and-set selected=true with required fresh ETag. |
| Candidate explicit restore | `lib/services/reviewer-finder/my-candidates-service.js:556` | Namespace `restore`; selected=true+canonical reset, inactive and disposition checks, passes ETag; intentionally can reopen a staff withdrawal via explicit reset. |
| Candidate soft removal | `lib/services/reviewer-finder/my-candidates-service.js:865` | Namespace `softDelete`; selected/accepted/declined=false, response/status/held=null, optional revoke; guards closed statuses and forwards available ETag. |
| Candidate full removal | `lib/services/reviewer-finder/remove-candidate-service.js:414` | `suggestionAdapter.ENTITY_SET_NAME` DELETE descriptor with answer children first and optional honorarium afterward in required atomic changeset; separate optional contact deletion at 427, then PG/SharePoint cleanup. |
| Candidate bulk metadata | `lib/services/reviewer-finder/my-candidates-service.js:534` | Namespace `bulkUpdateByRequest` → adapter-internal `updateLifecycle` at 2249; caller allows cycle/program area only, sequential failures preserved. |
| Merge | `lib/services/reviewer-merge.js:410,429,448` | DI `sug` resolves `suggestionAdapter`; conditional repoint, `ensureApplicantRecommended(requireEtag:true)` provenance before conditional collision deletion. Required ETags at caller. |
| Reconcile reviewer identity | `lib/services/reviewer-email-reconciler.js:217` | Namespace `repointToPotentialReviewer`, actor but **no ETag**; differs from merge preconditions. It is a live identity-link writer, not lifecycle status correction. |
| Decline referral disposition | `lib/services/workbench/decline-referrals-service.js:162` | Namespace `dismissDeclineReferral`; request binding+declined+content version+ETag, exact referral memo only, one reauthorization retry. |
| Candidate enrichment metadata | `lib/services/workbench/enrich-recommended-service.js:1118` | Namespace alias `setMatchReason`; excludes applicant-excluded rows, ETag retry, match reason only. |
| Honorarium link | `lib/bill/honorarium-onboard-orchestrator.js:210` | Destructured default `suggestions = suggestionAdapter`; `setHonorariumRequest` writes suggestion lookup after deterministic honorarium create. No If-Match and no read/no-op guard at adapter 2143-2148: same-value PATCH still occurs. |
| Honorarium withdrawal compensation | `lib/services/reviewer-withdrawal.js:24` | DI `suggestions = deps.suggestions || suggestionAdapter`; `deleteLinkedHonorariumForDeclinedSuggestion`, no-op decline tuple plus exact honorarium DELETE under available ETag; acceptance worker invokes this named helper. |

Token orchestration fan-in (in addition to the three token adapter calls above): `send-emails-service.js:744` mints at send time; `reviewer-reminder-sweep.js:406` mints/claims respond reminder; `regenerate-token-service.js:88` rotates; `my-candidates-service.js:669` calls ensureToken, whose guarded mint is `token-lifecycle.js:161`; `pages/api/review-manager/revoke-token.js:55` revokes; `review-upload.js:351` shortens expiry. Token verification `verify-suggestion-token.js:152` is a reader; do not add it to writer totals.

## B. Adapter-internal transport and raw-field ownership

[VERIFIED via full logical regions] `lib/dataverse/adapters/reviewer-suggestion.js` owns the raw transport calls. Its 22 writer exports (including `patchFields` alias) are all represented above or administrative matrix below. Private helpers are not extra external callers:

- `patchUpsertWinner` 539-581 writes selected/metadata from `upsert`; required ETag when selecting, ordinary metadata write otherwise.
- `ENGAGEMENT_STAMP_RESET_ENTRIES` 880-900 contains **19** source-controlled reset entries. `ENGAGEMENT_STAMP_RESET` 902-904 maps them. `buildStaffManualReselectPayload` 906-927 spreads it only when reset requested; private `patchStaffManualReselect` 929-995 governs handled versus inactive unhandled rows. `restore` 2235-2237 uses the same object. Do not copy a stale list into tests.
- `patchApplicantProvenanceOnly` 998-1052 writes sources only; it preserves applicant curation/promotion requirements.
- Candidate ensure/recommend/create conflict handlers at 736-872 and 1064-1147 perform metadata/selection writes through the same transport.
- `updateLifecycle` 1780-1920 maps 25 keys, excludes applicant-excluded rows, protects **status changes** out of closed states, validates completion/eligibility, then chooses explicit caller ETag or its guard-read ETag only for status writes. Broad response-only updates remain F3.
- `applyStage2aResponse` 1944-2040 is PATCH or atomic parent PATCH+honorarium DELETE. `applyStaffReviewerWithdrawal` 2050-2098 requires If-Match and uses the same atomic alternative. `deleteLinkedHonorariumForDeclinedSuggestion` 2108-2137 atomically reasserts declined tuple and deletes exact honorarium.
- `bulkUpdateByRequest` 2245-2251 contains the one **internal** `updateLifecycle` caller, separate from the 16 imported call sites.

All 14 resolved `runChangeset` invocations accounted for: 3 adapter parent/honorarium operations; 4 receipt producer sites; full-removal required batch and optional contact batch (2); BILL contact/person claim (1); unrelated admin question save, grantee upload, initial-assessment artifact (3); one script restoration batch (1). Thus **8 runtime calls directly mutate the suggestion row** (3 adapter + 4 receipts + required full removal); one script batch restores it. The other five resolved invocations do not mutate suggestions. Three further `runChangeset` **callback references**, rather than direct invocations, at `pre-site-visit/reopen-service.js:77`, `pre-site-visit/artifact-service.js:90`, and `final-writeup/transition-service.js:68` serve their own entities and are excluded. `atomicParentWithChildren` is a builder, not an additional write.

## C. Administrative writer/tool matrix (source only, never executed)

| Script(s) and locations | Role and actual write |
|---|---|
| `backfill-postgres-to-dataverse.js:230,243` | Historical migration: dynamic namespace upsert followed by updateLifecycle; raw lifecycle input from PG. |
| `backfill-reviewer-suggestions-to-dataverse.js:210`; `restore-reviewer-suggestion-cleanup-backup.js:232` | Dynamic namespace upsert restoring selected/metadata; live script surfaces, not permission to run. |
| `backfill-summary-blob-url-to-dataverse.js:125` | Raw suggestion PATCH of summaryBlobUrl (pointer/metadata, not lifecycle status). |
| `backfill-j26-stuck-invites-no-response.js:154-160` | REST helper PATCH of no_response+response timestamp after selection query. |
| `demote-applicant-suggested-reviewers.js:135` | Client PATCH selected=false; entity constant alias. |
| `restore-request-reviewers-selected.mjs:98` | Raw updateRecord selected=true. |
| `reset-request-reviewers.mjs:201-202` | Raw hard-delete or selected=false per CLI mode; also related cleanup. |
| `reset-reviewer-for-testing.js:69-112,199` | Broad RESET_PATCH including response/review/token/timestamps; raw entity alias; separate answer deletes and synthesis clearing. Distinct from canonical runtime reset. |
| `reset-stage2a-state.js:24-36` | Raw response/ack/first-access reset. |
| `find-stage2a-candidates.js:96` | Raw token hash/issue/expiry/revocation write after mint; name looks like a reader but has writes. |
| `fix-roster-email-recovery.mjs:116`; `fix-walsh-repoint-1003020.mjs:77` | REST helper PATCH of suggestion person lookup; separate person edits/deactivation. |
| `probe-merge-altkey-ordering.mjs:113,196,209,210,268` | Dynamic namespace suggestion upsert/repoint/hardDelete plus direct cleanup delete. |
| `pr4-e2e-setup.js:107,118,124`; `pr4-e2e.js:123,132,138,247,266`; `pr4-e2e-cleanup.js:36-50` | Fixture creation/metadata via upsert+raw PATCH, token mint/revoke, dynamic entity cleanup delete/deactivate. |
| `smoke-reviewer-binding.js:563,578,204`; `smoke-test-candidate.mjs:136,194` | Fixture upsert, accepted tuple stamping (binding smoke), cleanup raw suggestion delete. |
| `smoke-review-synthesis-automation.mjs:421-441` | Real receipt smoke plus restoration of original receipt/status fields with answer deletion in runChangeset. |
| `cleanup-review-multiselect-fixtures.mjs:437` | Calls the real removal service for fixture removal after inspecting suggestion/dependencies; no independent raw lifecycle setter. |
| `backfill-rating-snapshot-rows.mjs:136-142`; `probe-dataverse-batch-changeset.mjs:230-275` | Linked **answer-row** changesets/probes; suggestion entity literal is a selector, not a parent lifecycle mutation. |
| `backfill-honorarium-capture-only.mjs:291` | Calls accepted-reviewer honorarium orchestration; linked operational effect may reach setHonorariumRequest. |
| `extend-responsetype-picklist.mjs`; `extend-responsetype-picklist-held.mjs`; `extend-reviewstatus-picklist-terminal.mjs`; `add-reviewer-suggestion-heldat-column.mjs`; `preflight-reviewer-closeout-schema.mjs`; `preflight-reviewer-due-date-override-field.mjs` | Metadata/schema tooling; field literals/options do not make these application row writers. No schema invocation authorized. |

Read/query/report-only suggestion references also appear in roster-anchor reconciliation scripts; those write the roster/other stores, not the suggestion tuple. Specifically `recanonicalize-reviewer-roster-anchors.mjs`, `backfill-reviewer-roster-suggestion-anchors.mjs`, and `classify-reviewer-promotion-repair.mjs` query suggestion state. `probe-etag-parent-bump.js` reads parent/child versions; it does not create children. `probe-review-multiselect-preactivation.mjs:362-379` builds a non-executable question rollback template; those PATCH descriptors are neither suggestion writes nor executed changesets. Gate self-test fixture strings are test scaffolding, never real runtime callers.

## Projection/read fan-out and limitations

Primary raw-row consumers: `shared/utils/reviewer-engagement.js`; `lib/external/review-engagement-state.js`; `verify-suggestion-token.js` (independent token select list); `review-receipt-guard.js`; reviewer-synthesis readiness/content/drain; reviewers-service and my-candidates DTOs; candidate promotion/merge eligibility; reminder eligibility/candidate/manual/sweep; review-DOCX builder/filing; reviewer-rollup/history; and entity-registry select fields. DTO consumers include ReviewersTab/ManagePanel, reviewer modes/activity history, invite/remove confirmation, closeout, and token views. These are read denominators; a read in a writer file is still a read.

The following appendices preserve every resolved suggestion call site grouped into writer exports and reader/pure exports. They are a reproducible baseline for Stage 7, not a permanent exception allowlist. The raw-field grep is intentionally broader than adapter calls and must be repeated after source changes. No statement about external Power Automate writers, deployed records, or current contradictory population can be concluded from this source census.

## Appendix A — Every resolved writer-export call site

| Export | Local call and source |
|---|---|
| setHonorariumRequest | `suggestions.setHonorariumRequest` at `lib/bill/honorarium-onboard-orchestrator.js:210` |
| setExternalToken | `setExternalToken` at `lib/external/token-lifecycle.js:68` |
| revokeExternalToken | `revokeExternalToken` at `lib/external/token-lifecycle.js:84` |
| extendExternalTokenExpiry | `extendExternalTokenExpiry` at `lib/external/token-lifecycle.js:198` |
| stampProposalFirstAccessed | `stampProposalFirstAccessed` at `lib/services/external-review/context-service.js:93` |
| updateLifecycle | `updateLifecycle` at `lib/services/external-review/respond-service.js:263` |
| applyStage2aResponse | `applyStage2aResponse` at `lib/services/external-review/respond-service.js:288` |
| applyStage2aResponse | `applyStage2aResponse` at `lib/services/external-review/respond-service.js:407` |
| patchReviewReceipt | `patchReviewReceipt` at `lib/services/review-documents/individual-file-service.js:662` |
| updateLifecycle | `suggestionAdapter.updateLifecycle` at `lib/services/review-manager/close-review-service.js:172` |
| updateLifecycle | `suggestionAdapter.updateLifecycle` at `lib/services/review-manager/close-review-service.js:198` |
| patchReviewReceipt | `patchReviewReceipt` at `lib/services/review-manager/mark-received-no-file-service.js:122` |
| updateLifecycle | `suggestionAdapter.updateLifecycle` at `lib/services/review-manager/reviewers-service.js:493` |
| updateLifecycle | `suggestionAdapter.updateLifecycle` at `lib/services/review-manager/reviewers-service.js:498` |
| updateLifecycle | `suggestionAdapter.updateLifecycle` at `lib/services/review-manager/send-emails-service.js:827` |
| updateLifecycle | `suggestionAdapter.updateLifecycle` at `lib/services/review-manager/send-emails-service.js:921` |
| updateLifecycle | `suggestionAdapter.updateLifecycle` at `lib/services/review-manager/send-emails-service.js:931` |
| updateLifecycle | `suggestionAdapter.updateLifecycle` at `lib/services/review-manager/send-emails-service.js:937` |
| applyStaffReviewerWithdrawal | `suggestionAdapter.applyStaffReviewerWithdrawal` at `lib/services/review-manager/terminal-transition-service.js:97` |
| updateLifecycle | `suggestionAdapter.updateLifecycle` at `lib/services/review-manager/terminal-transition-service.js:106` |
| updateLifecycle | `suggestionAdapter.updateLifecycle` at `lib/services/review-manager/withdraw-sufficient-service.js:265` |
| patchReviewReceipt | `patchReviewReceipt` at `lib/services/review-upload.js:293` |
| updateLifecycle | `updateLifecycle` at `lib/services/reviewer-due-extension.js:312` |
| repointToPotentialReviewer | `suggestionAdapter.repointToPotentialReviewer` at `lib/services/reviewer-email-reconciler.js:217` |
| patchFields | `suggestionAdapter.patchFields` at `lib/services/reviewer-finder/generate-emails-service.js:501` |
| bulkUpdateByRequest | `suggestionAdapter.bulkUpdateByRequest` at `lib/services/reviewer-finder/my-candidates-service.js:534` |
| restore | `suggestionAdapter.restore` at `lib/services/reviewer-finder/my-candidates-service.js:556` |
| updateLifecycle | `suggestionAdapter.updateLifecycle` at `lib/services/reviewer-finder/my-candidates-service.js:616` |
| updateLifecycle | `suggestionAdapter.updateLifecycle` at `lib/services/reviewer-finder/my-candidates-service.js:660` |
| softDelete | `suggestionAdapter.softDelete` at `lib/services/reviewer-finder/my-candidates-service.js:865` |
| upsert | `reviewerSuggestionAdapter.upsert` at `lib/services/reviewer-finder/save-candidates-service.js:1541` |
| repointToPotentialReviewer | `sug.repointToPotentialReviewer` at `lib/services/reviewer-merge.js:410` |
| ensureApplicantRecommended | `sug.ensureApplicantRecommended` at `lib/services/reviewer-merge.js:429` |
| hardDeleteById | `sug.hardDeleteById` at `lib/services/reviewer-merge.js:448` |
| updateLifecycle | `updateLifecycle` at `lib/services/reviewer-reminder-sweep.js:415` |
| patchFields | `patchFields` at `lib/services/reviewer-suggestion-sweep.js:93` |
| patchReviewReceipt | `patchReviewReceipt` at `lib/services/reviewer-thankyou-sweep.js:85` |
| deleteLinkedHonorariumForDeclinedSuggestion | `suggestions.deleteLinkedHonorariumForDeclinedSuggestion` at `lib/services/reviewer-withdrawal.js:24` |
| ensureApplicantRecommended | `reviewerSuggestionAdapter.ensureApplicantRecommended` at `lib/services/workbench/applicant-reviewers-service.js:119` |
| dismissDeclineReferral | `suggestionAdapter.dismissDeclineReferral` at `lib/services/workbench/decline-referrals-service.js:162` |
| setMatchReason | `reviewerSuggestionAdapter.setMatchReason` at `lib/services/workbench/enrich-recommended-service.js:1118` |
| ensureStaffManualCandidate | `reviewerSuggestionAdapter.ensureStaffManualCandidate` at `lib/services/workbench/manual-reviewer-service.js:237` |
| selectIfUnengaged | `reviewerSuggestionAdapter.selectIfUnengaged` at `lib/services/workbench/promote-applicant-reviewer-service.js:672` |
| upsert | `suggestionAdapter.upsert` at `scripts/backfill-postgres-to-dataverse.js:230` |
| updateLifecycle | `suggestionAdapter.updateLifecycle` at `scripts/backfill-postgres-to-dataverse.js:243` |
| upsert | `reviewerSuggestionAdapter.upsert` at `scripts/backfill-reviewer-suggestions-to-dataverse.js:210` |
| upsert | `suggestionAdapter.upsert` at `scripts/pr4-e2e-setup.js:107` |
| upsert | `suggestionAdapter.upsert` at `scripts/pr4-e2e.js:123` |
| upsert | `suggestion.upsert` at `scripts/probe-merge-altkey-ordering.mjs:113` |
| repointToPotentialReviewer | `suggestion.repointToPotentialReviewer` at `scripts/probe-merge-altkey-ordering.mjs:196` |
| hardDeleteById | `suggestion.hardDeleteById` at `scripts/probe-merge-altkey-ordering.mjs:209` |
| repointToPotentialReviewer | `suggestion.repointToPotentialReviewer` at `scripts/probe-merge-altkey-ordering.mjs:210` |
| upsert | `reviewerSuggestionAdapter.upsert` at `scripts/restore-reviewer-suggestion-cleanup-backup.js:232` |
| upsert | `suggestionAdapter.upsert` at `scripts/smoke-reviewer-binding.js:563` |
| upsert | `suggestion.upsert` at `scripts/smoke-test-candidate.mjs:136` |

## Appendix B — Every resolved reader/pure call (separate denominator)

| Export | Source sites |
|---|---|
| getForTokenStatus | `lib/external/token-lifecycle.js:114` |
| getForExternalVerification | `lib/external/verify-suggestion-token.js:152`; `lib/services/review-upload.js:182`; `lib/services/review-upload.js:312`; `lib/services/review-upload.js:523` |
| getForEtagRefresh | `lib/services/external-review/context-service.js:102` |
| getForSubmitFinalityCheck | `lib/services/external-review/submit-service.js:179` |
| queryAllSuggestions | `lib/services/maintenance-service.js:461`; `lib/services/reviewer-finder/my-proposals-service.js:214`; `lib/services/reviewer-reminder-sweep.js:150`; `lib/services/reviewer-reminder-sweep.js:230`; `lib/services/reviewer-request-authorization.js:60`; `lib/services/reviewer-suggestion-sweep.js:48`; `lib/services/reviewer-thankyou-sweep.js:137`; `scripts/probe-approved-reviewer-contact-acceptance.mjs:122`; `scripts/probe-reviewer-contact-account-link-candidates.mjs:213` |
| findReviewDocxBackfillPopulation | `lib/services/review-documents/backfill-service.js:188` |
| getByIdWithSelect | `lib/services/review-documents/individual-file-service.js:291`; `lib/services/review-documents/individual-file-service.js:646`; `lib/services/review-manager/manual-review-entry-service.js:68`; `lib/services/review-manager/mark-received-no-file-service.js:107`; `lib/services/reviewer-due-extension.js:140`; `lib/services/reviewer-manual-reminder.js:66` |
| isExcluded | `lib/services/review-documents/individual-file-service.js:303`; `lib/services/review-documents/individual-file-service.js:364`; `lib/services/review-manager/close-review-service.js:53`; `lib/services/reviewer-due-extension.js:126`; `lib/services/reviewer-email-reconciler.js:154`; `lib/services/reviewer-manual-reminder.js:77`; `lib/services/reviewer-manual-reminder.js:84`; `lib/services/reviewer-merge.js:81`; `scripts/probe-reviewer-email-reconcile-alert.mjs:206` |
| findReviewDocxFilingCandidates | `lib/services/review-documents/individual-file-service.js:1056` |
| findById | `lib/services/review-manager/close-review-service.js:123`; `lib/services/review-manager/render-emails-service.js:129`; `lib/services/review-manager/send-emails-service.js:253`; `lib/services/review-manager/terminal-transition-service.js:70`; `lib/services/review-manager/withdraw-sufficient-service.js:173`; `lib/services/review-manager/withdraw-sufficient-service.js:224`; `lib/services/reviewer-address-trust-service.js:202`; `lib/services/reviewer-address-trust-service.js:289`; `lib/services/reviewer-address-trust-service.js:406`; `lib/services/reviewer-finder/generate-emails-service.js:79`; `lib/services/reviewer-finder/my-candidates-service.js:584`; `lib/services/reviewer-finder/my-candidates-service.js:678`; `lib/services/reviewer-finder/remove-candidate-service.js:125`; `lib/services/workbench/promote-applicant-reviewer-service.js:344`; `lib/services/workbench/reviewer-roster-projection-service.js:66`; `scripts/cleanup-review-multiselect-fixtures.mjs:175`; `scripts/probe-review-multiselect-preactivation.mjs:156` |
| getForDownload | `lib/services/review-manager/download-review-service.js:57` |
| getForTokenRegeneration | `lib/services/review-manager/regenerate-token-service.js:60` |
| findByRequest | `lib/services/review-manager/reviewers-service.js:180`; `lib/services/review-manager/synthesize-reviews-service.js:158`; `lib/services/review-synthesis-drain.js:75`; `lib/services/reviewer-finder/my-candidates-service.js:146`; `lib/services/workbench/decline-referrals-service.js:106`; `lib/services/workbench/reviewer-roster-projection-service.js:20` |
| findAcceptedByCycle | `lib/services/review-manager/reviewers-service.js:192` |
| findAcceptedByPD | `lib/services/review-manager/reviewers-service.js:198`; `scripts/smoke-review-manager.js:32` |
| findReviewSynthesisParticipants | `lib/services/review-synthesis-drain.js:33`; `scripts/smoke-review-synthesis-automation.mjs:254` |
| getForAcceptanceDrain | `lib/services/reviewer-acceptance-drain.js:68`; `lib/services/reviewer-withdrawal.js:16`; `scripts/smoke-reviewer-binding.js:588` |
| findRequestLinksByPotentialReviewer | `lib/services/reviewer-contact-reconciliation.js:231` |
| getForEmailReconcile | `lib/services/reviewer-email-reconciler.js:148`; `scripts/probe-reviewer-email-reconcile-alert.mjs:195` |
| findByPotentialReviewerAndRequest | `lib/services/reviewer-email-reconciler.js:210`; `scripts/backfill-reviewer-suggestions-parity.js:161`; `scripts/backfill-reviewer-suggestions-to-dataverse.js:143`; `scripts/backfill-summary-blob-url-to-dataverse.js:101`; `scripts/probe-review-rehearsal-state.mjs:91`; `scripts/probe-reviewer-email-reconcile-alert.mjs:263`; `scripts/probe-w4-suggestion-lookup.js:45`; `scripts/reset-reviewer-for-testing.js:138`; `scripts/restore-reviewer-suggestion-cleanup-backup.js:220` |
| findRemovedByRequest | `lib/services/reviewer-finder/my-candidates-service.js:148` |
| findByPD | `lib/services/reviewer-finder/my-candidates-service.js:154`; `lib/services/reviewer-finder/my-candidates-service.js:347` |
| aggregateReviewHistory | `lib/services/reviewer-finder/my-candidates-service.js:175` |
| notExcludedFilter | `lib/services/reviewer-finder/my-proposals-service.js:216`; `lib/services/reviewer-reminder-sweep.js:156`; `lib/services/reviewer-suggestion-sweep.js:50`; `lib/services/reviewer-thankyou-sweep.js:139`; `scripts/backfill-honorarium-capture-only.mjs:197` |
| findAllByPotentialReviewer | `lib/services/reviewer-finder/remove-candidate-service.js:172`; `lib/services/reviewer-finder/save-candidates-service.js:531`; `lib/services/reviewer-merge.js:237`; `lib/services/reviewer-merge.js:238`; `lib/services/reviewer-merge.js:530`; `scripts/apply-reviewer-contact-parent-accounts.mjs:168` |
| hasApplicantProvenance | `lib/services/reviewer-merge.js:289` |
| countAcceptedForRequest | `lib/services/reviewer-quota.js:50` |
| selectedAndNotRevokedFilter | `lib/services/reviewer-reminder-sweep.js:156` |
| normalizeSuggestionProgramArea | `lib/services/reviewer-request-context.js:188` |
| findForRollup | `lib/services/reviewer-rollup.js:73` |
| findApplicantRecommendedByRequest | `lib/services/workbench/enrich-recommended-service.js:412` |

## Appendix C — Reproduce the raw-field and alias evidence

The full raw-field union above returned 1,425 matching lines across 159 files at this baseline. These include metadata, comments, projections and other entities with identically named columns, so this is **not a writer count**. Local evidence is `/tmp/reviewer-stage0-raw-field-hits.txt` and `/tmp/reviewer-stage0-raw-field-files.txt`; the ownership matrix above classifies actual writers. To repeat, pass the raw field names listed under Reproduction as individual `rg -e` patterns across the same roots and extensions.

Committed-tool path: `scripts/inventory-reviewer-lifecycle-writers.js` (introduced in Stage 0). Run:

```sh
node scripts/inventory-reviewer-lifecycle-writers.js > /tmp/reviewer-stage0-census.json
node -e "const c=require('/tmp/reviewer-stage0-census.json'); console.log({files:c.filesScanned, imports:c.imports.length, calls:c.calls.length, unresolved:c.unresolved, parseErrors:c.parseErrors})"
```

This CLI prints JSON and performs filesystem/git reads only. It does not write a repo file or load application code. Baseline run before this new script is tracked: 1,281 files, 62 static-import declarations, 173 calls, zero unresolved computed calls, zero parse diagnostics. Once the script is tracked the file denominator grows by one; it contributes no lifecycle call.

The scanner is explicitly file-local: no lexical-scope/shadowing resolution, no cross-file re-export analysis, no arbitrary reflection/computed module path or unknown factory return solving. Binding discovery repeats until no additional identifier aliases appear (finite fixed point, replacing the original investigation's three-pass bound). Only `||`/`??` dependency fallbacks are resolved. JS/JSX/TS/TSX parsing uses the appropriate TypeScript parser mode and parse errors are returned separately, not treated as a clean empty inventory. The result's `unresolved` denominator covers computed calls through recognized bindings only. Direct REST/descriptors, callback references and adapter-internal calls remain the manual source matrix's responsibility.

`tests/unit/reviewer-lifecycle-writer-inventory.test.js` has six fixture tests: named/namespace/literal-property aliases, real DI/default shapes, require/literal dynamic imports, unresolved computed calls, unrelated arithmetic complement, and parse-error/JSX behavior. Combined with reviewers-service the final focused run is 29 passing tests across two suites. No gate/package script is introduced.
