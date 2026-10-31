---
agent_wiki: topic
status: active
last_verified: 2026-10-22
verification_scope: "Inherited hub date; extraction integrity only, no claim or live-state recertification"
stale_after_days: 90
owner: reviewers
title: "Reviewer Engagement, Commands, and Closeout"
source_files:
  - lib/dataverse/adapters/reviewer-suggestion.js
  - pages/api/review-manager/reviewers.js
  - lib/services/review-manager/reviewers-service.js
  - pages/api/review-manager/terminal-transition.js
  - lib/services/review-manager/terminal-transition-service.js
  - lib/services/reviewer-engagement/terminal-transition.js
  - lib/services/reviewer-due-extension.js
  - pages/api/review-manager/review-due-extension.js
  - lib/services/reviewer-acceptance-drain.js
  - lib/services/reviewer-reminder-sweep.js
canonical_docs:
  - docs/REVIEWER_ENGAGEMENT_SPEC.md
  - docs/REVIEWER_COMPLETION_AND_HONORARIUM_DECISION_BRIEF.md
  - docs/REVIEWER_LIFECYCLE_STAGE7_BUILD_PLAN.md
  - docs/APPLICATION_STATE_ATLAS.md
watch_paths:
  - lib/dataverse/adapters/reviewer-suggestion.js
  - pages/api/review-manager/terminal-transition.js
  - lib/services/reviewer-engagement/terminal-transition.js
  - lib/services/reviewer-due-extension.js
  - pages/api/review-manager/review-due-extension.js
  - shared/components/reviewers/ReviewerManagePanel.js
update_triggers:
  - "Named lifecycle commands, transitions, or closeout rules change"
  - "Reviewer acceptance, engagement, or reminder eligibility changes"
extracted_from: docs/agent-wiki/topics/reviewer-workbench-lifecycle.md
extraction_source_sha256: fdccedfe393f7ae7db7afa04b5b48297080b5c269290637bbf70e192f68888e7
extraction_segments:
  - "180-342"
  - "392-426"
  - "1147-1203"
  - "2120-2134"
  - "2154-2200"
---

# Reviewer Engagement, Commands, and Closeout

> The source page mixed current guidance with dated history and owner decisions; those distinctions are preserved in the extracts. The inherited `last_verified` date does not certify these claims anew. This pass verifies only extraction bounds and byte provenance, not runtime behavior, repository-wide drift, or live state.

<!-- source-lines: 180-342 -->
**Reviewer-engagement build (Model B):** spec is `docs/REVIEWER_ENGAGEMENT_SPEC.md`. The 9 backing Dataverse fields are **provisioned in prod (2026-06-21, wave `7-reviewer-engagement`)**. Per-request campaign config lives on `akoya_request`; the per-reviewer respond-reminder marker lives on `wmkf_appreviewersuggestion`. **Phases 1, 2, and 4 remain live. Phase 3 mechanism IMPLEMENTED (S275), schedule PAUSED (2026-09-01):** `/api/cron/reviewer-reminders` can send respond-by and review-due reminders, but it is absent from the Vercel cron registry under the reviewer-token incident hold. Respond reminders claim with If-Match, mint, and deliver a replacement pre-acceptance link. Review-due reminders claim with If-Match only after a fail-closed token-liveness/runway check; they are link-free and preserve the existing token. Runtime source at commit `4dd57369` contains the remediation. Incident-session operations observed Ready deployment `dpl_89s9MzdUnDST6Jm9Vs3cnMLPmUDu` and authenticated Workbench smoke, but deployment metadata exposed no source SHA and no tracked smoke artifact was retained. The post-deploy D26 read-only audit found all 51 never-reminded sweep candidates active and eligible with zero blocked; already-reminded rows were outside the audit. The owner lifted the procedural manual reminder freeze after that evidence; the automatic schedule remains held. The Campaign settings modal still omits reminder toggles/leads, the Dataverse schema defaults both flags true, and a 2026-09-01 read-only probe found 92 current-cycle active requests with both flags true. `scripts/check-reviewer-reminder-hold.js` blocks accidental re-registration in CI and Vercel prebuild. The manual "Re-invite already-invited" button was removed in S277; `allowResend` remains only as a programmatic re-mint contract. Campaign timing, accepted-only Materials delivery, token TTL, quota notification, and selective decline remain implemented as described in the canonical spec. See the two Atlas pages for the exact column list and the canonical spec for the remaining cron-reactivation prerequisites.

**Reviewer closeout and honorarium eligibility (owner-approved and source-built
2026-09-04; subsequently released):** The September 4 deployment-pending
state is historical. `DEVELOPMENT_LOG.md` Session 479 records runtime/UI
`5e101861` in Ready Production deployment
`dpl_2uJJQxY9TN4KcfHJGLRS2dW1QVge`; this is retained release evidence, not a
fresh hosted-state check. Complete means a lead-PD human closeout of a
received review, not “thank-you sent.” The same one-row ETag update sets
Complete, `wmkf_completedat`, and the nullable engagement Picklist
`wmkf_honorariumeligibility` with `eligible`, `not_eligible`, or
`not_applicable`. The September 4 Production probe found the manually created,
published/readable local Picklist with exact values `100000000..100000002` and
a deficient description in the tracked preflight. That metadata observation
is dated; its current description was not re-probed in this cleanup. The app will
never write the linked honorarium request's
`wmkf_authorizationtoremitpaymentflag`; Operations/Finance retains final remit
authority. Generic status PATCH now rejects Complete in source; the dedicated
route uses a fresh one-row ETag closeout, and manual/automatic thank-you paths
write only the courtesy marker with legacy payment language stripped. Operations'
system view exists but remains to be surfaced in AkoyaGO as a separate follow-up. Contract:
`docs/REVIEWER_COMPLETION_AND_HONORARIUM_DECISION_BRIEF.md`.

**Generic invitation/response corrections (Stage 1D):** **[VERIFIED in source
at `c51fa34d`, 2026-09-05; shipped in Production at `c19a16d8` per the
[release receipt](../../audits/REVIEWER_LIFECYCLE_RELEASE_2026-09-05.md)]**
`PATCH /api/reviewer-finder/my-candidates` protects `invited`, `accepted`,
`declined`, `emailSentAt`, `responseType`, and `responseReceivedAt` even when
no review status is supplied. After lead-PD/superuser authorization, the route
passes its server-resolved Request separately from the body. The service
freshly requires the same Request binding, a non-excluded row, no completed-at
marker, explicit null or accepted/materials-sent/under-review/review-received
status, and a concrete ETag. Complete/withdrew/released, missing or unknown
status, and missing or malformed versions fail closed. `updateLifecycle`
independently enforces that source-state/version boundary for these six fields
and preserves the caller's exact ETag; a stale version is never replaced with
the adapter's newer guard-read version. Numeric 412 returns
`correction_conflict`, with no automatic retry. Rejection occurs before token
follow-up or person edits; success retains lifecycle write → nonfatal
`accepted:true` token follow-up → person edits ordering.

The dedicated closeout service still permits changed eligibility/notes on a
complete row under its own fresh Request/receipt/disposition/ETag contract,
without restamping completion. Named manual-invitation recording, restore,
person-only edits, and bulk cycle/program-area assignment remain distinct
operations. This protection does not turn the generic correction into a
withdrawal command or extend its field set.

**Generic recorded-status updates (Stages 1E/6A):** **[VERIFIED in local
source at `5b9964c8` on 2026-09-05; shipped in Production at `c19a16d8` per the
[release receipt](../../audits/REVIEWER_LIFECYCLE_RELEASE_2026-09-05.md)]**
`PATCH /api/review-manager/reviewers` authorizes every target for the lead PD
or superuser before calling `reviewers-service.patchReviewers` →
`reviewer-suggestion.updateLifecycle`. Nonempty batches trim/lowercase and
deduplicate GUIDs in first-occurrence order, await adapter operations
sequentially, and stop at the first failure. The single path preserves the
submitted ID and lifecycle object, including the ID returned in outcomes.
`savedIds`, `failedIds`, and `notAttemptedIds` partition those targets:
HTTP 200/`success:true` confirms all; a failed adapter operation returns
HTTP 500/`success:false` with the confirmed prefix, one unconfirmed adapter
operation, and the unattempted suffix. This includes `mapPicklist` validation
failure before the adapter's lifecycle guard read or write. `failedIds` does
not prove that a Dataverse HTTP write began or committed; a transport failure
may follow a commit. Earlier saves remain applied. Route validation and
authorization, plus the service's dedicated-target prechecks, retain error-only
responses. Complete, withdrew, and released still require dedicated workflows.
Existing null/empty-string status clearing on open rows remains supported,
with closed-source protection intact; Stage 6A adds no status-validation policy.
No rollback or automatic retry is introduced.

Stage 6B1 (branch `codex/reviewer-lifecycle-stage6b`, `9258115a`/`06725d6c`, merged to
`main` 2026-09-05 as `600cc972`, production-live): the regenerate-token, revoke-token, remove-reviewer and terminal-transition
handlers in `ReviewerManagePanel.js` bind their alerts, prompt, clipboard write and
`onRefresh` call to the UI context that started them through a per-action/row
attempt registry invalidated by the existing layout effects. Stale outcomes after
request/mode/permission change, row absence or unmount are suppressed and never
revived; confirm dialogs revalidate before dispatch; a refresh failure after a
confirmed mutation is reported separately. Payloads, success predicates and the
status mutex are unchanged. Tests: `tests/unit/reviewer-action-lifetimes.test.js`.
Receipt: `docs/audits/REVIEWER_LIFECYCLE_STAGE6B1_RECEIPT_2026-09-05.md`.

Stage 6B2 (same branch, `b08c16f6`/`d3ec406a`/`039d5d8e`, merged with 6B1): `ReviewReminderAction` in
`ReviewerManagePanel.js` and `ReviewerCloseoutModal.js` observe committed request/reviewer
identity and parent read-only/management context through a no-deps layout effect and a
monotonic epoch, separate from the per-attempt generation token. A stale attempt keeps its
send/save lock until it settles, releases it by generation match alone, and never shows
feedback or invokes a callback for a departed context; the reminder clears its feedback and
the modal clears its error when the session changes. Callbacks run through the latest
committed reference in their own try; a throw or rejected promise never relabels a confirmed
mutation and is observed without awaiting, so the dialog closes and the lock releases without
waiting for a host reload. The modal reinitializes disposition/notes only on open/close or
reviewer/request identity change; a permission flip preserves typed notes but, since
`039d5d8e` (owner decision after a Codex adversarial review), closes the modal through the
parent's latest `onClose` once per loss transition while any pending save settles silently.
The panel passes
`requestId`, `canManage` and `previewReadOnly` to the modal. Payloads, predicates, eligibility
rules and copy are unchanged. Tests: the lifetime describes in
`tests/unit/reviewer-manage-actions-menu.test.js` and `tests/unit/reviewer-closeout-modal.test.js`.
Receipt: `docs/audits/REVIEWER_LIFECYCLE_STAGE6B2_RECEIPT_2026-09-05.md`.

Stage 6B3 (same branch, `a6a27ce8`/`b163172a`, amended by 6B3a `3a4bcbbe`/`0a4eafd6`, 6B3b
`9a790c64`/`529ee426`, 6B3c `2622dfc7`, 6B3d `be76760f` (host) and 6B3e `5b57991d` (degraded
mode), merged with 6B1): the nested materials-release modal's
session is open state, request id, the sorted selected membership with each reviewer's name,
email and affiliation by value (`membershipKeyFor`), the proposal title, abstract, PI and
institution by value (`proposalKeyFor`, passed as the `proposalKey` string prop), and the
signature and review due date by value (the only two `settings` fields render consumes). The destination address is re-resolved server-side at send,
but the rendered body is sent verbatim, which is why recipient fields are in the key. All
reconciled by one no-deps layout effect with an unmount cleanup; any change bumps the modal
epoch, aborts the active preview render and returns the UI to a fresh compose, while
same-membership object churn does not. Proposal loading is invalidated by open/close, request
change and unmount only. The send handler keeps its own results accumulator, marks the attempt
finished on `complete` so duplicate or trailing events have no effect, and hands the panel a
one-use completion cause; the panel stores it with its selection clear and passes it back, so
only that exact prior-membership-to-empty transition preserves the sent summary. Uploads and
template-save feedback are checkpointed with attempt-owned lock release. Payloads, the SSE
contract, preview single-flight and tail serialization are unchanged. When the committed due-date default
changes, a due-date field still holding the prior default follows it; a customized field is
kept. Accepted limits: a membership, signature or deadline change during an in-flight send
returns to compose while the server-side one-time materials gate bounds a duplicate send; a
deadline change with a customized field still resets drafts even though the render would be
identical; the global localStorage due-date key makes a restored value read as customized
(pre-existing); co-investigators are not carried by any host and edits the panel has not
refetched are invisible to any client key — both closed by Stage 6D (PR #159 → `6606cc30`,
2026-09-06): `render-emails` stamps each draft with a server-side `draftFingerprint`
(`lib/services/review-manager/draft-fingerprint.js`: template type, suggestion, candidate name and
affiliation, proposal title/abstract/authors/institution/co-PIs, due-date override, request dates,
cycle program/deadline/raw custom fields, honorarium amount), `send-emails` recomputes it from
fresh reads before any write and skips the recipient as `draft_stale` (pre-6D drafts:
`draft_fingerprint_missing`); both modals forward the field and render labels from
`shared/utils/reviewer-send-skip-reasons.js` (`SEND_SKIP_REASON`, parity gate entry #5). Accepted
limits: inputs are hydrated once per send batch, and template text edited in Admin between preview
and send is not detected. Plan and review record: `docs/REVIEWER_LIFECYCLE_STAGE6D_BUILD_PLAN.md`.
Host side (6B3d): `ReviewersTab` keeps the same-request proposal when a
reviewers refetch fails (case-insensitive GUID match) so a transient error after a confirmed send
no longer flips the modal's keys and erases the sent summary; while that banner shows, the panel
runs degraded (`degraded` prop): release, row actions, reminder send, closeout trigger and the
open modal's Send are disabled with a title, a Retry control reloads, and nothing unmounts. The
reviewer-follow-up workbench host received the same treatment in PR #152 (`e9909e91`, 2026-09-05):
it keeps the last loaded list under a "could not be refreshed" banner, passes `degraded` and
`loading` to every mounted panel, keeps groups mounted during a retry, and unconditionally
supersedes any in-flight load on a cycle/scope change so no response can commit rows from a
different cycle or scope. The one gap that plan recorded as pre-existing — a cycles-load failure
left `cycleCode` empty, so the banner had no Try again and the proposals effect never ran — was
closed 2026-09-06 (S490): the cycles load is a retryable `loadCycles` callback and the banner's Try
again reloads cycles when no cycle is selected yet. Plan with the full review record:
`docs/plans/REVIEWER_FOLLOW_UP_REFETCH_RESILIENCE_2026-09-05.md`. Tests: `tests/unit/reviewer-materials-modal-lifetimes.test.js`.
Receipt: `docs/audits/REVIEWER_LIFECYCLE_STAGE6B3_RECEIPT_2026-09-05.md`.

The existing `ReviewerManagePanel.updateStatus` UI submits one reviewer only.
It trims/lowercases submitted and returned IDs for outcome comparison, refreshes
only a confirmed save, and identifies the reviewer/id in explicit feedback.
For malformed or unconfirmed outcomes, feedback asks staff to reload and
review current status before a deliberate retry; a confirmed write with a
rejecting refresh callback instead reports saved but unable to refresh. Legacy responses without outcome keys still require HTTP
success, exact `success:true`, and no error field. The mounted panel's
synchronous per-reviewer lock survives request/mode/permission changes and
observed row disappearance until settlement; those changes and unmount
permanently invalidate late feedback. Ordinary object/callback replacement
remains valid. This does not serialize other panels/tabs or certify refresh
success when a host returns void or catches its own read errors. Materials
selection and confirmed-invitation overlays retain their separate contracts.

<!-- end-source-lines: 180-342 -->
<!-- source-lines: 392-426 -->
## Reviewer → CRM contact promotion (production-live 2026-07-31)

Sending an invitation never creates or links a CRM contact. The send service
retains `contactPromoted:false` and `orcidBackprop:null` in its response only for
consumer compatibility. Invitation and non-response history stays on the
suggestion/person rows.

Every accepted reviewer—including honorarium opt-outs—enters
`ensureAcceptedReviewerContact`; declines do not. Non-opt-outs reach it through
`ensureHonorariumOnboarding`, while opt-outs call it directly from the acceptance
drain. Existing links are re-read and must pass active-state, name, and
email/ORCID identity checks before any Contact mutation. Otherwise, exact email
and ORCID candidate sets must be unambiguous, agree with each other, be active,
and match the accepted reviewer's name. Ambiguity, inactive-only matches, split
keys, a namesake, or an unsafe pre-existing link preserves the unlinked state
and raises a deduplicated `accepted_reviewer_contact_identity_review` alert.

For a genuine new person, the contact primary key is deterministically derived
from a valid canonical ORCID across reviewer rows, with the global
potential-reviewer ID as the fallback when no valid ORCID exists. Contact
creation and the reviewer lookup link commit in one Dataverse changeset with an
ETag guard on the reviewer. Concurrent retries therefore converge without an
orphan Contact; a concurrent reviewer-link winner is adopted only after its
Contact passes the same identity validation.

## Candidate removal, decline archival, and restore (Invite Reviewers)

The "X" on an Invite Reviewers panel (`ReviewerInvitePanel`) card is a **soft-delete**, not a UI-only dismiss: `DELETE /api/reviewer-finder/my-candidates` → `suggestionAdapter.softDelete(id, {alsoRevokeToken:true})` flips `wmkf_selected=false`, clears accepted/declined/responsetype/reviewstatus/heldat, and (if invited) sets `wmkf_externaltokenrevoked=true` — all in one atomic PATCH. It refuses (throws → DELETE route 500) any **closed engagement row**: a closed `wmkf_reviewstatus` OR a stamped `wmkf_completedat` (`isClosedEngagementRow`; the completedat half was added 2026-09-06 under owner decision D0 — before that a completion-stamped row with a non-closed status could be removed). The row is NOT hard-deleted; the person/contact is untouched. Because that reset also erases an ACCEPTANCE (and the withdrawal path then becomes unreachable — terminal-transition requires `wmkf_accepted`), both Remove confirms (`ReviewerInvitePanel.removeCandidate`, `ReviewerManagePanel.handleRemoveReviewer`) prepend a warning for accepted reviewers pointing to "Record reviewer withdrawal" (`shared/components/reviewers/remove-reviewer-confirm.js`, added 2026-09-02 after an accepted reviewer with materials sent was removed instead of withdrawn on Request 1002833). It is a warning, not a block. Removed candidates do **not** reappear in Find's discovery list: Find deduplicates new results against the persisted operational `reviewer_find_roster`, but does not load canonical Dataverse saved-suggestion rows back into that list.

**Decline archival:** every reviewer decline path writes `wmkf_selected=false` together with the declined response state, so the reviewer immediately leaves the active proposal pool and appears in the "Removed (N)" section. This includes an initial decline, reviewer self-withdrawal, staff-recorded withdrawal, and the linked-honorarium race-compensation path. Accepting again before materials are released writes `wmkf_selected=true`. Invite/Track readers and the dashboard's work-stage counts still derive active lifecycle state from selected rows. The shared dashboard/Overview rollup additionally reads archived declined rows and emits mutually exclusive `progress` buckets (accepted, pending, declined, not invited); this makes declines visible without restoring them or writing a separate counter. Decline referrals remain available because `decline-referrals-service` deliberately reads both selected and archived rows before filtering to declined rows with referral text.

**Restore (S285; narrowed by the invited-reviewer outcomes build, 2026-10-31):** inactive candidates surface in a collapsible "Removed (N)" list at the bottom of the Candidates panel. Only never-invited, staff-removed candidates have Restore: `restore()` refuses an invited row or one with a recorded outcome (`isInvitedRow` / `hasRecordedOutcome` in `shared/utils/reviewer-engagement-policy.js`) with code `reinvite_unavailable`, and "Reset & restore" for declines is gone (owner decision D, `docs/plans/INVITED_REVIEWER_OUTCOMES_PLAN_2026-10-31.md`). Remove (`softDelete`) likewise refuses invited reviewers (`invited_reviewer_not_removable`). The reset description below applies to the never-invited rows that remain restorable. Both call `PATCH my-candidates {suggestionId, restore:true}` → `suggestionAdapter.restore`. The explicit restore workflow re-selects the row and clears all prior engagement state via the shared `ENGAGEMENT_STAMP_RESET`: accepted/declined/response/review status reset; `wmkf_invited=false`; the old external token remains revoked; and email, reminder, materials, receipt, thank-you, completion, withdrawal, and first-access timestamps reset to `null`. A subsequent invitation mints a **new** live token and clears the revoke. The reset applies ONLY to `wmkf_selected===false`; re-adding an already-active candidate must not wipe a live invitation or submitted-review state. Restore and manual re-add use ETag guards. The Removed query admits `selected=false` rows with either `applicantdisposition=null` (staff/Claude/manual rows removed from the proposal) or `declined=true` (including a formerly promoted applicant recommendation), while preserving the exclusion guard. An applicant recommendation that was never promoted remains `selected=false, declined=false` and stays solely in Find; it cannot bypass the promotion workflow through restore. Removed candidates ride the single-request GET path only (`removedCandidates` on `proposals[0]`), which is the scope the Candidates panel uses.

**"Remove entirely" — permanent removal (S343; discoverability revised S347; file safety hardened 2026-07-26):** a distinct, destructive action alongside the recoverable "X" (`RemoveEntirelyModal.js`). **S347:** the owner (S344) couldn't find it because it was reachable ONLY after soft-removing a candidate and expanding the "Removed" list. It is now surfaced directly on **active** candidate rows via a single **"Remove ▾"** menu (`RowRemoveMenu` in `ReviewerInvitePanel.js`) offering two routes — "Remove from this proposal" (the recoverable `removeCandidate` soft-delete "X") and "Delete permanently…" (opens `RemoveEntirelyModal` via `setRemoveEntirelyTarget`). The menu is pure routing; each destination keeps its own confirm/preflight. The collapsible "Removed (N)" list still hosts Restore + its own "Remove entirely" and now **defaults to expanded** (`showRemoved` initial `true`). `DELETE /api/reviewer-finder/my-candidates {suggestionId, mode:'hard', deleteContact?}` → `removeCandidateEntirely` (`lib/services/reviewer-finder/remove-candidate-service.js`) PERMANENTLY deletes review-answer rows → suggestion → linked honorarium `akoya_request` in ONE atomic Dataverse `$batch` changeset. The optional contact delete is deliberately a **separate later changeset**, so a contact Restrict relationship cannot roll back the valid engagement/honorarium removal. SharePoint and Postgres cleanup are also cross-store and later: current isolated `attempt_<32-hex>` review folders delete all files from that attempt, legacy folder shapes delete only the stored primary filename and preserve other files, and every file outcome is audited; `ReviewDraftService.deleteBySuggestion` removes the draft. A Graph resolution outage does not block the normal route: the preflight discloses that file cleanup is unavailable, the engagement removal remains enabled, and the commit skips all file cleanup with a partial audit warning. Same app-access gate as the soft-delete "X"; no per-PD ownership scoping and **no blocks** (high-trust owner decision, S343 — a PD decides when/why; safety is a durable pre-delete `system_alerts` audit breadcrumb via `NotificationService.notify`, written BEFORE any delete and aborting the whole operation if it fails to write, plus the accurate `describeRemoval` preflight disclosure (`GET my-candidates?mode=removal-preflight&suggestionId=`) surfaced in the confirm modal — not a precondition/test-mode gate). Design: `docs/REVIEWER_REMOVE_ENTIRELY_BUILD_PLAN.md`.

<!-- end-source-lines: 392-426 -->
<!-- source-lines: 1147-1203 -->
**Terminal statuses and staff-withdrawal cleanup: historical Production
release below; accepted-release expansion verified in current source.**
`withdrew` and `released` are live in the Track pipeline, excluded from
`MODE_WORK_REMAINING` and the Reviews-tab Outstanding list, and routed through
`/api/review-manager/terminal-transition`. The service freshly reads each row,
accepts only accepted/materials-sent/under-review rows with no
declined/received/completed stamp, and uses that ETag so a concurrent submission
wins. The sufficient-reviews `released` command writes the terminal status,
token revocation, dated `wmkf_withdrawnsufficientat`, and an optional guarded
internal note; it retains and marks a safely open linked honorarium `Withdrawn`
in the same changeset, then optionally sends reviewed thank-you copy. Its
read-only preview runs the same honorarium-state classifier before showing the
composer; the commit path independently re-reads the honorarium and remains
authoritative. Paid, authorized, non-Pending, unreadable, or non-versioned
honoraria therefore block before composition and again before the transition.
This accepted-reviewer release expansion was source-built on 2026-09-16
(`1abc097a8`, with `87af339b3` follow-up); both commits are ancestors of
current `HEAD` [VERIFIED via Git ancestry, 2026-10-22]. “Not yet promoted”
was the September 16 checkpoint, not a current deployment conclusion. The
older staff-withdrawal release evidence is retained below; present hosted
release behavior was not checked in this cleanup.

**Historical settings preparation and promotion prerequisite:** Production was prepared on 2026-09-16 through an
explicitly authorized, narrowly scoped settings write that created
`email.reviewer_release.subject` and `email.reviewer_release.body`; an immediate
read-back verified both values exactly match the committed seeds. Runtime
promotion was pending at that checkpoint; this record does not establish its
current status or renew authorization to seed settings. Any target environment must verify both
keys before this runtime reaches it. The seed is initialization data, not a
runtime fallback; without it, release remains fail-safe and available without
email, but preview reports `defaults_unavailable` and records the
missing-default operational alert.
PD-recorded `withdrew` additionally performs the same lifecycle/financial
correction as reviewer self-withdrawal: one Dataverse changeset writes
`selected=false`, `accepted=false`, `declined=true`, declined response metadata,
the `withdrew` audit status, and token revocation while deleting the exact linked honorarium;
unlocked acceptance jobs are cancelled, and a leased worker compensates after
re-reading declined state. Derived reviewer counts therefore update without a
separate counter write. This cleanup shipped in merge `70f51f45`, production
deployment `dpl_9r2FYkAXhRqSXiJVCwevrXFZ5SzH`, on 2026-07-24. Neither
terminal value enters `updateLifecycle`'s strict `reviewStatus=complete`
timestamp branch. Terminality is server-enforced in BOTH directions (owner
resolution S369): the generic reviewers PATCH refuses a terminal *target*, and
`updateLifecycle` refuses any status change on a row whose *source* is already
terminal. Raw receipt writes bypass that adapter, so
`lib/services/review-receipt-guard.js` independently protects manual entry,
mark-without-file, staff/self-token upload, and external submit: each rejects
terminal/final/non-accepted rows and carries the authorizing read's ETag into
its PATCH/changeset. Upload attempts use unique SharePoint subfolders. A
non-412 Dataverse failure cleans up only its own attempt; a 412 loser is always
orphaned and never deleted because the service cannot safely infer which files
another winner committed. The active slice adds no due-date column or repair
endpoint. Durable deadline evidence is deferred to a separate owner-reviewed
design around ordered materials dispatches, preferably the existing Dynamics
email activity and returned `emailId`. Owner goal and decisions:
`.claude-memory/project-reviewer-reliability-data.md`.

<!-- end-source-lines: 1147-1203 -->
<!-- source-lines: 2120-2134 -->
- **Closeout Next-action simplification (owner decision 2026-09-08).** On the Reviewers panel,
  a Complete row's Next-action button now depends on whether a disposition is already recorded
  (`shared/components/reviewers/ReviewerManagePanel.js` `closeoutNextAction`, exported via
  `_managePanelInternals`): `review_received` still shows the primary **Mark complete** button
  unchanged; Complete with `honorariumEligibility == null` still shows a primary button, now
  labelled **Record closeout**; Complete with any recorded disposition (`eligible`/`not_eligible`/
  `not_applicable`, or the unrecognised `unknown`) shows no Next-action button at all -- editing
  stays available only through the row's More menu (`TokenActionsMenu.js`), which still offers
  **Edit closeout** and opens the same `ReviewerCloseoutModal`. That menu item had been deliberately
  unwired since `5e101861` (2026-09-04), which gave both `review_received` and `complete` rows a
  primary Next-action button and dropped the menu duplicate for both; because this change removes
  the Complete row's button, the panel now passes `onCloseReview` to `TokenActionsMenu` for Complete
  rows only, preserving the `review_received` row's "primary action only, no menu duplicate" design
  (see the 2026-09-04 note above and the `reviewer-manage-actions-menu.test.js` "surfaces closeout as
  the primary row action" pin). `70babc04` (2026-09-05) only moved the menu into its own file.
<!-- end-source-lines: 2120-2134 -->
<!-- source-lines: 2154-2200 -->
- **Named lifecycle commands live in `lib/services/reviewer-engagement/` (reviewer lifecycle
  Stage 3, from 2026-09-05).** 3A moved the closeout command there (`close-review.js`, PR #154) and
  3B the terminal transition (`terminal-transition.js`, PR #156), 3C the preauthorized status
  correction (`correct-status.js`, PR #158; `reviewers-service.js` keeps only `getReviewers`), 3D the
  response correction (`correct-response.js`, PR #160; `my-candidates-service.js` delegates and
  re-exports `MyCandidatesError` from the neutral `reviewer-engagement/errors.js`), 3E the post-send
  bookkeeping (`record-email-outcome.js`) and the invitation expiry (`expire-invitation.js`, PR #161;
  callers keep their counters/warning events and are pinned by delegation tests), 3G the review-due
  reminder claim (`claim-reminder.js`, PR #162), 3H the due-date override write
  (`change-review-deadline.js`, PR #163), 3I the pending-invitation withdrawal write
  (`withdraw-pending-invitation.js`, PR #164), 3F the three invitation-record writers
  (`record-invitation.js`, PR #165; the post-send stamp stays unconditional — D1 preserved by owner
  decision 2026-09-06 — and the generation mark was retired with the generate-emails route the same day
  under D2; see `docs/REVIEWER_LIFECYCLE_STAGE7_BUILD_PLAN.md`), 3J a
  narrow adapter op for the external decline repair (`deselectLegacyDeclinedSuggestion`, PR #166; D3 taken
  2026-09-06 — concrete ETag now required),
  3K the whitelisted `setRequestMetadata` adapter op behind the proposal-wide cycle/program edit
  (PR #167) — **removed 2026-09-06 under owner decision D4** together with the my-candidates
  proposal-wide PATCH branch, which had no client since the standalone page's retirement
  (2026-06-16); cycle/program area are set at save time only. **Stage 7 (PR #168,
  2026-09-06) closes the boundary:** `check:reviewer-engagement-boundary` (LAW mode, AST-resolved incl.
  alias chains, barrels, class fields, dynamic imports) fails any binding of `updateLifecycle` /
  `patchFields` / `patchReviewReceipt` from the suggestion adapter in `lib/pages/shared/modules`
  outside `reviewer-engagement/`, the adapter, or the two receipt sinks recorded in the script and
  pinned by `tests/unit/reviewer-engagement-boundary-recorded-set.test.js`; `bulkUpdateByRequest` is
  deleted (zero-reference pin); the stale-invite sweep writes through the named
  `expireInvitationResponse` op. D1–D4 are resolved owner decisions in `docs/REVIEWER_LIFECYCLE_STAGE7_BUILD_PLAN.md`: D1 is preserved, D2 retired, D3 taken, and D4 removed. D5 is resolved: three raw-fetch scripts were archived after execution evidence was confirmed, and the remaining script writers are covered by the tracked `check:script-suggestion-writers` recorded set;
  the old `review-manager/close-review-service.js` is a pure re-export and routes keep their import
  paths. Each move is byte-identical and pinned by a both-paths identity test plus a caller census
  (`tests/unit/reviewer-engagement-census.test.js`) that records every importer of the legacy path,
  so a new bypass must be recorded deliberately. Plan: `docs/REVIEWER_LIFECYCLE_STAGE3_BUILD_PLAN.md`.
- **Narrow receipt operations (Stage 5, PR #157, 2026-09-05).** The DOCX pointer commit
  (`individual-file-service.js` `commitPointers`) and the thank-you claim (`reviewer-thankyou-sweep.js`)
  call named adapter ops `attachReviewDocumentPointer` / `claimThankYou` instead of the generic
  `patchReviewReceipt`; both require a concrete ETag (`lib/utils/etag.js` `isConcreteEtag`) and fail
  closed with `missing_version`. Caller wiring tests assert the generic patch is not called. Plan:
  `docs/REVIEWER_LIFECYCLE_STAGE5_BUILD_PLAN.md`.
- **Route→Service layout (Stage 7, 2026-07-05): every workbench and
  review-manager route is a thin shell; the lifecycle/business logic lives in
  `lib/services/workbench/` (incl. `grantee-deliverables/`) and
  `lib/services/review-manager/`.** Routes may not import
  `lib/dataverse/adapters/*` or `lib/services/dynamics-service` — enforced by
  `check:route-service-boundary` (law mode) `[VERIFIED via the gate run at
  census 0, 2026-07-05; docs/ROUTE_SERVICE_CONSOLIDATION_PLAN.md]`. Lifecycle
  behavior changes belong in the domain service; the shell keeps only guard →
  validate → DAL context → service call → HTTP mapping.
<!-- end-source-lines: 2154-2200 -->
