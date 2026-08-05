---
agent_wiki: topic
status: active
last_verified: 2026-08-03
stale_after_days: 90
owner: reviewers
source_files:
  - shared/components/reviewers/email-template-store.js
  - shared/components/reviewers/EmailTemplatesModal.js
  - shared/components/admin/EmailDefaultsSection.js
  - shared/config/editableTextDefaults.js
  - pages/api/email-defaults/reviewer-templates.js
  - lib/seed/email-defaults/reviewer-templates.js
  - shared/components/reviewers/ReviewersTab.js
  - shared/components/reviewers/InviteEmailModal.js
  - shared/components/reviewers/ReviewerFindPanel.js
  - shared/components/reviewers/ReviewerSearchSection.js
  - shared/components/reviewers/ReviewerManagePanel.js
  - lib/services/review-manager/send-emails-service.js
  - lib/services/reviewer-acceptance-drain.js
  - lib/bill/honorarium-onboard-orchestrator.js
  - lib/dataverse/adapters/contact.js
  - pages/external/review/[token].js
  - shared/components/reviewers/reviewer-search-logic.js
  - pages/api/reviewer-finder/my-candidates.js
  - lib/services/reviewer-finder/remove-candidate-service.js
  - shared/components/reviewers/RemoveEntirelyModal.js
  - pages/api/reviewer-finder/enrich-contacts.js
  - pages/api/reviewer-finder/save-candidates.js
  - lib/services/reviewer-finder/save-candidates-service.js
  - lib/services/reviewer-candidate-attestation.js
  - lib/services/reviewer-address-trust-service.js
  - lib/utils/reviewer-vetted-email.js
  - pages/api/review-manager/campaign-timeline-defaults.js
  - pages/api/review-manager/terminal-transition.js
  - pages/api/workbench/enrich-recommended.js
  - pages/api/workbench/applicant-reviewers.js
  - pages/api/workbench/promote-applicant-reviewer.js
  - pages/api/workbench/reviewer-roster.js
  - pages/api/workbench/export-candidates.js
  - lib/services/workbench/reviewer-roster-projection-service.js
  - lib/services/reviewer-candidate-export.js
  - lib/services/reviewer-campaign-timeline.js
  - lib/services/review-manager/terminal-transition-service.js
  - lib/external/token-lifecycle.js
  - lib/external/reviewer-token-ttl.js
  - lib/external/verify-suggestion-token.js
  - lib/services/review-receipt-guard.js
  - lib/services/reviewer-roster-store.js
  - lib/services/contact-enrichment-service.js
canonical_docs:
  - docs/REVIEWER_FIND_WARM_RECONCILIATION_INCIDENT_2026-08-03.md
  - docs/REVIEWER_FIND_PERFORMANCE_PLAN.md
  - docs/REVIEWER_WARM_STAGE_PRODUCER_SPEC.md
  - docs/APPLICATION_STATE_ATLAS.md
  - docs/atlas/postgres-reviewer-find-roster.md
  - docs/atlas/dataverse-wmkf-potentialreviewers.md
  - docs/atlas/dataverse-wmkf-appreviewersuggestion.md
  - docs/REVIEWER_ADDRESS_TRUST_AND_CONFLICT_RESOLUTION_PLAN.md
  - docs/REVIEWER_REMOVE_ENTIRELY_BUILD_PLAN.md
  - docs/REVIEWER_WORKFLOW_STABILIZATION_DIRECTIVE.md
  - docs/REVIEWER_HOLISTIC_REVIEW_FABLE_PROMPT.md
watch_paths:
  - shared/components/reviewers/**
  - pages/api/reviewer-finder/**
  - pages/api/review-manager/**
  - pages/external/review/**
  - pages/api/workbench/enrich-recommended.js
  - pages/api/workbench/applicant-reviewers.js
  - pages/api/workbench/promote-applicant-reviewer.js
  - pages/api/workbench/export-candidates.js
  - lib/services/reviewer-candidate-export.js
  - lib/services/review-manager/**
  - lib/services/reviewer-roster-store.js
update_triggers:
  - reviewer workbench UX or lifecycle changes
  - roster persistence / reload behavior changes
  - referral or address collection behavior changes
  - applicant-suggested enrichment trigger or display behavior changes
---

# Reviewer Workbench & Lifecycle

Use this page for reviewer UI/workbench flows, durable roster behavior,
cross-run deduplication, referral capture, address collection, lifecycle state,
and staff-facing reviewer management.

## Reviewer Find warm-reconciliation incident — RESOLVED BY REVERT (2026-08-03, S396)

The warm-revisit/stage-reconciliation build (deployed through `7072d52a`) hit a
production incident on Request `1002903`: a narrow recovery (Katherine Ferrara
regained selection authority) alongside a remaining loop (Kanaka Rajan
retryable/queued, showing a per-card **Refresh contact evidence** action even
though the persistent identity/institution condition required a staff
decision). The incident is now CLOSED — `main` was fast-forwarded to
`2fc29b82` (tip of `reviewer-find-revert-baseline`), restoring the runtime
tree byte-for-byte to the pre-rollout `94c5b9d9` baseline (keeping only the
unrelated `edbe6931` `institution-coi-context.js` permissive-`isGuid` fix). The
experimental warm-reconciliation work in range `5b6757df..7072d52a` is **not
live**. Owner-verified production behavior (S396): the Find warm roster shows
checkboxes on selectable rows (`ReviewerSearchSection.js` `CandidateCard`
`checked`/`onToggle`); identity-gated rows render read-only with a
"confirm identity" affordance (`onConfirmIdentity`) rather than an automatic
evidence refresh; there is **no** "Reconcile previously found reviewers"
button and **no** per-card evidence-refresh control. Forward-fix branch
`reviewer-find-outcome-contract` is abandoned (kept for history). Full
chronology, root cause, and resolution evidence:
`docs/REVIEWER_FIND_WARM_RECONCILIATION_INCIDENT_2026-08-03.md` (see
"Resolution" section first — the rest of that doc is the historical
pre-revert assessment). Root-cause/process lessons:
`.claude-memory/feedback-latency-plan-scope-accretion-postmortem.md`.

**Warm-revisit proposal blob cache (S397, 2026-08-04, production-live).**
On top of that baseline, `lib/services/reviewer-finder/load-proposal-service.js`
now `head()`-checks a deterministic Blob path (hash of request + file
identity + `lastModified`/`size`) before SharePoint, so an unchanged warm
revisit skips the PDF re-download/re-upload (`blob cache HIT`/`MISS` log
lines; owner-smoked `1003010` MISS→HIT and `1002903` ~3.1s vs 5.9s baseline).
Hazards already adjudicated (do not re-litigate without new evidence): size
validation on hit and on the list→download race; a natural TTL from the maintenance blob sweep (default 90d —
`lib/services/maintenance-service.js:376,814`; runtime `config.blob_days`
can override); Preview/Production share the blob store so Preview
smokes pre-warm production paths. Enrichment-cache staleness on in-place
proposal updates is PRE-EXISTING and deferred as its own backlog item.
Record of truth for the increment (gitignored working doc):
`outputs/reviewer-find-warm-revisit-step0-findings.md`; durable summary in
`SESSION_PROMPT.md` "incremental plan ACTIVE" section.

**Reviewer-engagement build (Model B):** spec is `docs/REVIEWER_ENGAGEMENT_SPEC.md`. The 9 backing Dataverse fields are **provisioned in prod (2026-06-21, wave `7-reviewer-engagement`)**. Per-request campaign config (offset/due-date/reminder toggles+leads/desired-count/quota-notified-at) lives on `akoya_request`; the per-reviewer fire-once respond-reminder marker `wmkf_respondremindersentat` lives on `wmkf_appreviewersuggestion`. **Phase 1 LIVE (S275):** the invite panel's respond-by is now a "days to respond" offset; `wmkf_respondoffsetdays` + `wmkf_reviewduedate` are written on first invite (`send-emails.js`) and edited via `/api/review-manager/campaign-config` (Reviewers-tab "Campaign settings"). Current-cycle invitation defaults are now edited in `/admin` as "Reviewer Campaign Timeline", stored in `wmkf_appsystemsettings` key `reviewer.campaign_timeline_defaults`, and read by `InviteEmailModal` through `/api/review-manager/campaign-timeline-defaults`; request config overlays those defaults when present. **Phase 2 LIVE (S275):** per-recipient token TTL (`lib/external/reviewer-token-ttl.js` via `render-emails` — invitee/non-responder link caps at review-due+2d, accepted gets review-due+90d, fallback now+90); accepted-only "Release to reviewers" materials send (server-gated in `send-emails`, plus a one-click button on the **Track Reviewers** sub-tab, `ReviewerManagePanel.js`); and a `materials_not_sent` upload guard (`review-upload.js` self-token path → 403). **Phase 3 LIVE (S275):** `/api/cron/reviewer-reminders` (daily) sends two per-request opt-in reminders — respond-by (invited non-responders, deadline = emailSentAt + respondOffsetDays - lead, token-live, fire-once `wmkf_respondremindersentat`) and review-due (accepted/materials-sent/not-submitted, deadline = reviewDueDate - lead, fire-once via the existing `wmkf_remindersentat`). Both claim-before-send (If-Match) → at-most-once; the server `allowResend` re-mint clears the respond marker (the **manual "Re-invite already-invited" Invite-Reviewers-panel button (`ReviewerInvitePanel`) was removed S277** — the respond-by reminder is the nudge for invited non-responders; `allowResend` is retained only as the programmatic re-mint contract). Server-side render in `lib/external/reviewer-reminder-email.js`; service in `lib/services/reviewer-reminder-sweep.js`. **Phase 4 LIVE (S275; actual PD email + quota seeding S352):** quota → PD notify + selective decline. `lib/services/reviewer-quota.js` (called from the acceptance drain `lib/services/reviewer-acceptance-drain.js` after it re-verifies the accept committed — moved off `respond.js` by the S350 accept-fast-response build) notifies the lead PD once when the accepted count first reaches `wmkf_desiredcount` — concurrency-gated by a conditional null→set of `wmkf_quotanotifiedat` (If-Match). **S352:** the notify now actually EMAILS the lead PD (`emailAdmins: true`, `explicitRecipients` = resolved PD only, no `category` fan-out; degrades to dashboard-alert-only when the PD email is unresolvable), and `wmkf_desiredcount` is settable end-to-end — admin "Reviewer quota" default (4) in the Reviewer Campaign Timeline settings, seeded non-clobbering on first invite send (`send-emails-service.js`, server-side default read only), and editable in the Campaign settings modal, which prefills due-date/quota from the admin defaults (`docs/REVIEWER_QUOTA_PD_EMAIL_PLAN.md`, Status: SHIPPED). `POST /api/review-manager/withdraw-sufficient` (the **Invite Reviewers** tab's "Release as no longer needed") writes `withdrawn_sufficient` + `wmkf_withdrawnsufficientat` + clears `wmkf_respondremindersentat` on still-pending rows only (the §2.9 missing writer). **All four phases shipped.** See the two Atlas pages for the exact column list.

## Find → Invite promotion contract (production-live)

Find retention is no longer equivalent to Invite readiness. The shared
`projectReviewerContact` projection derives one server-reproducible decision
from nested identity evidence, the exact normalized email/source, persistence
flags, affiliation rescue, and anti-scrape policy. Only `ready` candidates are
selectable for **Promote to Invite**. `needs_identity_confirmation` and
`missing_email` remain visible with their exact staff action and produce no
person/suggestion write.

New automated receipts mint v4. V3/v4 bind that exact contact projection to
the request and immutable roster key; v4 also binds
`eligibilityCheckStatus`, while a valid v3 receipt cannot replace the stored
check status. V1/v2 remain identity-only during their TTL. A staff
override remains an exact actor-bound server record. `save-candidates-service`
recomputes authority before adapters, resolves a unique active exact-email
owner before creation, converges create races, checks applicant exclusion, and
returns exact per-key `saved`/`withheld`/`failed` results. Only the server
finalizes an exact roster key as `saved`; the roster endpoint rejects browser
`action:'saved'`. An applicant-excluded collision becomes durable read-only
`blocked`.

On a partial non-2xx response, Find still reconciles server-confirmed saved
keys. After an unknown transport outcome it refetches roster/Invite state
before retry, and never graduates by normalized name. Invite continues to read
only the linked canonical person email; a legacy selected email-empty row shows
a diagnostic rather than falling back to the roster address.

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

The "X" on an Invite Reviewers panel (`ReviewerInvitePanel`) card is a **soft-delete**, not a UI-only dismiss: `DELETE /api/reviewer-finder/my-candidates` → `suggestionAdapter.softDelete(id, {alsoRevokeToken:true})` flips `wmkf_selected=false`, clears accepted/declined/responsetype/reviewstatus/heldat, and (if invited) sets `wmkf_externaltokenrevoked=true` — all in one atomic PATCH. The row is NOT hard-deleted; the person/contact is untouched. Removed candidates do **not** reappear in the Find tab (Find is ephemeral discovery + roster dedup; it never reads back persisted suggestion rows).

**Decline archival:** every reviewer decline path writes `wmkf_selected=false` together with the declined response state, so the reviewer immediately leaves the active proposal pool and appears in the "Removed (N)" section. This includes an initial decline, reviewer self-withdrawal, staff-recorded withdrawal, and the linked-honorarium race-compensation path. Accepting again before materials are released writes `wmkf_selected=true`. Invite/Track readers and the dashboard's work-stage counts still derive active lifecycle state from selected rows. The shared dashboard/Overview rollup additionally reads archived declined rows and emits mutually exclusive `progress` buckets (accepted, pending, declined, not invited); this makes declines visible without restoring them or writing a separate counter. Decline referrals remain available because `decline-referrals-service` deliberately reads both selected and archived rows before filtering to declined rows with referral text.

**Restore (S285; decline support added 2026-07-25):** inactive candidates surface in a collapsible "Removed (N)" list at the bottom of the Candidates panel. Staff-removed rows have Restore; declined rows have **Reset & restore**. Both call `PATCH my-candidates {suggestionId, restore:true}` → `suggestionAdapter.restore`. The explicit restore workflow re-selects the row and clears all prior engagement state via the shared `ENGAGEMENT_STAMP_RESET`: accepted/declined/response/review status reset; `wmkf_invited=false`; the old external token remains revoked; and email, reminder, materials, receipt, thank-you, completion, withdrawal, and first-access timestamps reset to `null`. A subsequent invitation mints a **new** live token and clears the revoke. The reset applies ONLY to `wmkf_selected===false`; re-adding an already-active candidate must not wipe a live invitation or submitted-review state. Restore and manual re-add use ETag guards. The Removed query admits `selected=false` rows with either `applicantdisposition=null` (staff/Claude/manual rows removed from the proposal) or `declined=true` (including a formerly promoted applicant recommendation), while preserving the exclusion guard. An applicant recommendation that was never promoted remains `selected=false, declined=false` and stays solely in Find; it cannot bypass the promotion workflow through restore. Removed candidates ride the single-request GET path only (`removedCandidates` on `proposals[0]`), which is the scope the Candidates panel uses.

**"Remove entirely" — permanent removal (S343; discoverability revised S347; file safety hardened 2026-07-26):** a distinct, destructive action alongside the recoverable "X" (`RemoveEntirelyModal.js`). **S347:** the owner (S344) couldn't find it because it was reachable ONLY after soft-removing a candidate and expanding the "Removed" list. It is now surfaced directly on **active** candidate rows via a single **"Remove ▾"** menu (`RowRemoveMenu` in `ReviewerInvitePanel.js`) offering two routes — "Remove from this proposal" (the recoverable `removeCandidate` soft-delete "X") and "Delete permanently…" (opens `RemoveEntirelyModal` via `setRemoveEntirelyTarget`). The menu is pure routing; each destination keeps its own confirm/preflight. The collapsible "Removed (N)" list still hosts Restore + its own "Remove entirely" and now **defaults to expanded** (`showRemoved` initial `true`). `DELETE /api/reviewer-finder/my-candidates {suggestionId, mode:'hard', deleteContact?}` → `removeCandidateEntirely` (`lib/services/reviewer-finder/remove-candidate-service.js`) PERMANENTLY deletes review-answer rows → suggestion → linked honorarium `akoya_request` in ONE atomic Dataverse `$batch` changeset. The optional contact delete is deliberately a **separate later changeset**, so a contact Restrict relationship cannot roll back the valid engagement/honorarium removal. SharePoint and Postgres cleanup are also cross-store and later: current isolated `attempt_<32-hex>` review folders delete all files from that attempt, legacy folder shapes delete only the stored primary filename and preserve other files, and every file outcome is audited; `ReviewDraftService.deleteBySuggestion` removes the draft. A Graph resolution outage does not block the normal route: the preflight discloses that file cleanup is unavailable, the engagement removal remains enabled, and the commit skips all file cleanup with a partial audit warning. Same app-access gate as the soft-delete "X"; no per-PD ownership scoping and **no blocks** (high-trust owner decision, S343 — a PD decides when/why; safety is a durable pre-delete `system_alerts` audit breadcrumb via `NotificationService.notify`, written BEFORE any delete and aborting the whole operation if it fails to write, plus the accurate `describeRemoval` preflight disclosure (`GET my-candidates?mode=removal-preflight&suggestionId=`) surfaced in the confirm modal — not a precondition/test-mode gate). Design: `docs/REVIEWER_REMOVE_ENTIRELY_BUILD_PLAN.md`.

## Decline-referral surface + one-click add (S349)

When a reviewer declines via the external portal, the current form collects up
to four structured Name / Institution / Email rows and stores a versioned
envelope in `wmkf_declinereferral` on the suggestion row. The reader keeps
legacy free-text values visible, so no existing referral is lost. Until S349
**nothing read this field** — suggested names sat unseen.

- **Reader:** `GET /api/workbench/decline-referrals?requestId=` →
  `lib/services/workbench/decline-referrals-service.js` (`getDeclineReferrals`).
  Reads selected and archived suggestions, then returns declined rows with a
  non-empty referral, each with the decliner's `wmkf_name` resolved. Structured
  envelopes expand to one DTO per referred person; legacy text remains one
  display-only DTO. A structured item is omitted only when an existing
  request-scoped candidate carries `referred` provenance, exactly matches the
  normalized name (and email too when supplied), and is selected or engaged.
  Resolved legacy notes are also omitted, so the Track badge represents
  unresolved referral work rather than the lifetime count of decline responses.
  **Deliberately independent of
  `review-manager/reviewers-service.js`**, which filters to accepted reviewers
  and early-returns when none are accepted — so referrals surface even when
  every invitee declined before anyone accepted.
- **Surface:** `ReviewersTab` fetches it and passes `declineReferrals`,
  `onAddReferral`, and `onResolveLegacyReferral` to `ReviewerManagePanel`, which
  renders an amber callout at the top of the **Track Reviewers** sub-tab only.
- **One-click "Add as candidate" (in-place, S354):** does NOT bypass identity
  resolution. The button POSTs the suggested name, optional email/institution,
  and decliner straight to
  `/api/workbench/manual-reviewer` (no `resolution`) and stays on Track
  Reviewers; the server resolves identity itself (`addManualReviewer` →
  `lookupReviewerIdentity`). Three per-row outcomes, keyed by `referralId` in
  `ReviewersTab`'s `referralActions` state and rendered inline by
  `ReviewerManagePanel` (`ReferralAction`/`ReferralConfirm`): **200** → the row
  shows "✓ Added" and the tab lands on **Invite Reviewers** where the new
  candidate appears (a bare name usually has no email, so it's added but not yet
  *sendable* until staff add one there); **409 + `lookup`** (ambiguous /
  conflict) → the row switches to an **inline identity-confirm picker** (staff
  pick the right existing person or "Add as new person" → re-POST with the
  chosen `resolution`), so a referral never auto-resolves to a
  namesake (memory `project-reviewer-verify-fail-dangerous`); **other error**
  (incl. `applicant_excluded`) → inline message + "Try again". Lands `referred`
  provenance exactly as the S249 manual-referral path. On reload the referral
  reader derives closure from that durable candidate row; it does not add an
  operational source token. Failed/ambiguous adds remain visible, as do remedy
  outcomes that still require promotion or restore. Legacy prose is never
  submitted wholesale as a reviewer name; staff add its people separately and
  then use **Dismiss resolved note**. That PATCH is legacy-only, request-scoped,
  ETag-guarded, retry-safe, and preserves the original note after a compact
  resolved prefix in `wmkf_declinereferral`. Before S354 the button
  pre-filled the Find-tab Add-or-Refer form and routed there via
  `router.push({sub:'find'})` (the `ReviewerFindPanel` `prefill` prop, now
  unused) — a colleague reported it "did nothing" (the tab hop was unreliable /
  the pre-filled card sat below the fold), so it was replaced with this in-place
  flow. Tests: `tests/unit/reviewers-tab-referral-add.test.js`.
- Origin of the direction: the former Fable holistic-review P3.1; the
  reconciled implementation plan now records the shipped surface as F1.1 and
  treats conversion measurement as remaining work
  (`docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md`).

## Durable Memory

- Workbench and invite workflow: `project-reviewer-apps-redesign-direction`, `project-reviewer-workbench-invite-workflow`.
- Lifecycle and automation: `project-reviewer-lifecycle`, `project-reviewer-lifecycle-automation`.
- Address collection: `project-reviewer-address-collection-provisional`.
- Referral capture: `project-reviewer-referral-capture`.
- Find roster and dedup: `project-reviewer-find-roster`.
- Data model/migration: `project-reviewer-finder-dataverse-entry-path`, `project-appresearcher-collapse-post-pilot`. Historical S136 migration rationale is in closed memory `project-reviewer-postgres-to-dataverse-migration`.
- Count/history/excluded invariants: `project-reviewer-count-invariant`, `project-reviewer-history-data-quality`, `project-excluded-reviewers-often-in-pool`.

## Applicant-Suggested Reviewer Flow (S263/S264)

Applicant-suggested reviewers (`disposition=recommended` junction rows from `wmkf_potentialreviewer1..5`) are integrated into the main candidate list on the Find tab rather than shown in a separate bottom card. As of S264, ingestion creates these rows with `wmkf_selected=false`; the candidate pool is the PD-selected set, and applicant-suggested rows enter it only when a Program Director explicitly promotes the existing junction row.

**Ingestion performance contract (increment D, S399, production-verified):** the on-demand `GET /api/workbench/applicant-reviewers` slot materialization runs all populated slots **concurrently** (`Promise.allSettled`; the S210 person-dedup set is fully built before any await, response slot ordering and per-slot failure isolation unchanged), and `ensureApplicantRecommended` **skips its PATCH when it would be a no-op** (row already `disposition=recommended` + `applicant` in sources + no empty descriptive field to fill). The skip is scoped to `!requireEtag` — the sole `requireEtag:true` caller (the merge service's provenance-union in `lib/services/reviewer-merge.js`, grep-verified S399) deliberately keeps its always-write ETag-conditional PATCH so a raced disposition flip still 412s before a loser-row delete. D0 evidence basis (2026-08-04, single true-cold N=5 production sample): the old sequential loop was ~2.0s of a ~3.4s handler total; measurements in `outputs/reviewer-find-warm-revisit-step0-findings.md` §D0.

**Institution-verdict contract (S400, branch `fix/enrichment-identity-verdict` — UNMERGED as of 2026-08-04; production still runs the pre-fix behavior):** the S399 "all five Institution mismatch" verdicts on request 1002903 were attributed via a one-run production operand capture to genuine checker `false` returns comparing raw PubMed byline evidence against clean listed institutions (evidence: `outputs/s400-institution-checker-probe-findings.md`, gitignored). On the branch: verdict copy carries contradiction provenance (`compared`/`comparison_error`/`prior_flag` — an error never reads as an affirmative mismatch; a decided contradiction names both compared strings); a permanent compact `[institution-verdict]` log line per candidate makes future verdicts attributable from runtime logs; the success-path DTO writes the reconciled verdict instead of the stale pre-comparison flag; the banner attributes applicant-listed institutions to the applicant (not "Claude") and uses source-neutral "linked evidence shows"; `APPLICANT_ENRICHMENT_CACHE_VERSION` is 4 so pre-fix cached rows re-enrich once. **Hazard for future work:** a byline core-extraction comparison fallback was built and REVERTED — `normalizeAffiliationForComparison` is an aggregation key whose comma-truncation/50-char paths collapse comma-qualified sibling institutions (UC San Diego/San Francisco) into false CONSISTENTs that would clear `identityNeedsReview` (a Dataverse write gate). Never widen same-institution equivalence at that seam with a lossy extractor; the acceptance spec for the accepted fix (candidate 1: word-boundary containment of the listed name inside the byline — probe-verified to cover all four captured false rows, with the West Texas A&M boundary attack as its known hazard; fallback: conservative segment-whole extractor; either ships with the structured verdict `{status, source}` through DTO→roster→card) is pinned in `tests/unit/enrich-recommended-institution-evidence.test.js`. Directive addendum (`docs/REVIEWER_WORKFLOW_STABILIZATION_DIRECTIVE.md` §S399) carries per-finding status.

**Historical warm-reconciliation build, reverted (deployed through `7072d52a`,
reverted 2026-08-03 S396 — see the incident section above):** the abandoned
build gave `ReviewerFindPanel` a cached-then-reconciled roster read with
staged server-owned repair/reconciliation and a per-candidate stage plan; it
was not product-complete (see the incident section above) and is **not
live**. Current production `ReviewerFindPanel`/`ReviewerSearchSection`
behavior is the pre-rollout baseline: a warm roster read renders
checkboxes on selectable rows, identity-gated rows are read-only with a
confirm-identity affordance, and there is no reconcile button or per-card
evidence-refresh control. The former automatic `useEffect` enrichment flow
remains historical and must not be restored as a warm repair mechanism.

**Historical Production defect — owner-accepted 2026-08-01; engagement
projection subsequently deployed.**
The roster-only terminal contract above is insufficient. Re-probed 2026-08-01
and still live on Request `1002912`: Ralph Isberg holds a noncanonical saved row
plus a canonical active applicant row while Dataverse reads
`selected=true, invited=true`; Rotem Sorek has the same twin shape at
`selected=false, invited=true` plus an active row whose pre-merge suggestion
404s, so he renders twice. Find shows both as unresolved prospects.

**Two distinct causes — this matters for the fix.** Sorek-shaped resurfacing is
a **regression**: `fe825933` read applicant rows via
`findByRequest(..., { selectedOnly: true })`, which excluded declined reviewers
because decline archival sets `selected=false`, and `ad8e0299` (2026-06-16)
replaced it with a disposition-only read while making applicant rows
`selected=false` by default. Isberg-shaped resurfacing is the **latent
roster-twin gap** — he was `selected=true`, so the old filter passed him
through too. Projecting engagement fixes both; restoring `selectedOnly` would
fix only Sorek and would break the S264 explicit-promotion design.

**Owner decision:** engagement is an independent terminal input for **every
roster row carrying a suggestion anchor**, not applicant rows only. Work order:
`SESSION_PROMPT.md`. Evidence and corrections:
`outputs/reviewer-workflow-stabilization-fable-assessment.md` §0/§3 plus the
verbatim independent review in
`outputs/reviewer-workflow-codex-adversarial-review-2026-08-01.md`. The
deployed implementation projects
the engagement tuple, enrichment partitions handled rows before model work,
and the roster GET makes one complete request-scoped Dataverse read for every
suggestion-anchored visible roster row. Handled rows render only in a compact
**Already handled** summary with Invite/Removed/Track navigation. An excluded
row is also revalidated against Dataverse before it can return to active Find.
Focused source tests and later signed-in no-send checks covered this engagement
projection. Do not confuse that historical repair with the separate,
now-reverted warm-reconciliation build described above.

**Unified candidate list:** Enriched applicant candidates (`recCandidates`) are prepended into `displayCandidates` so fresh enrichment wins over stale roster copies. Candidates with a resolved identity surface in the `applicant_suggested` provenance section — which appears after `cited_or_proposal_named` and `literature_retrieved` in that order — via `provenanceGroupOf` detecting `isApplicantRecommended: true` → `APPLICANT_SUGGESTED` kind. **Exception:** candidates where enrichment could not confirm identity (`needsIdentification: true`, typically when the applicant provided no affiliation) route to `needs_identity_review` instead — `provenanceGroupOf` checks `needsIdentification` before `APPLICANT_SUGGESTED` (reviewer-provenance.js:228 vs :231). The `applicant_suggested` section is selectable unless normal safety gates make a row read-only; selecting it calls `POST /api/workbench/promote-applicant-reviewer` with the existing `suggestionId` instead of `save-candidates`.

**Roster persistence:** `/api/workbench/enrich-recommended` snapshots each
canonical suggestion row and its roster `updated_at`, stamps each final
applicant-enriched row with `enrichedProposalKey` and the current cache version,
prunes it through `pruneCandidateForRoster`, and records it through the
concurrency-guarded roster store as `active` or direct-deceased `ineligible`.
The current-run verification institution outranks stale stored affiliation in
the final coherence check. The prune retains bounded actor-owned staff
confirmation. Browser POST/exclude strips client-supplied authority and
restores only a genuine server confirmation; the browser cannot write `saved`
or `blocked`. Concurrently confirmed/excluded/saved/blocked rows resist stale
enrichment. `suggestionId` remains the exact applicant-promotion anchor.
Exclusion removes an applicant row from the active roster; only a successful
server promotion finalizes it `saved`, while an authoritative
applicant-excluded collision finalizes it `blocked`.

**Explicit applicant promotion (production-live):**
`/api/workbench/promote-applicant-reviewer` validates request and
suggestion ownership/disposition, requires the canonical
request/`suggestion:<id>` roster row, and rechecks identity, eligibility, COI,
and canonical contact authority before selection. Hand corrections are limited
to fields explicitly marked manual and remain bound to the suggestion's
server-read person. When no manual email exists, the route can backfill only the
email authorized by the same canonical contact projection as ordinary Find
promotion; it then freshly reads the person and refuses selection unless the
canonical email is present. Duplicate-email collision, stale write, missing
roster authority, and roster-finalization failure are blocking outcomes—not
partial successful promotions. After `wmkf_selected=true` succeeds, the server
finalizes the exact roster key as `saved`. There is no name fallback and no
successful no-roster legacy path.

Slice A adds a fresh engagement check before any person/contact mutation and a
second compare-and-set immediately before selection, bound to the suggestion
ETag. A concurrent decline therefore wins and returns a reload-required 409.
The ordinary `save-candidates` upsert path applies the same engagement check
and ETag-bound selection rule, including its alternate-key conflict winner, so
it cannot become a second re-selection door for search-origin rows.
The explicit Restore path retains its separate ETag-bound reset authority.
Manual/referral re-add of an applicant-recommended person unions provenance
only: it never selects or clears lifecycle fields, and returns
`promotion_required`, `restore_required`, or `already_handled` with an
executable Find/Invite/Removed/Track remedy. **[VERIFIED via focused source tests
and deployed source, reconciled 2026-08-03]**

Find-discovered rows still receive their exact suggestion/person anchors after
ordinary save. The read-only reconciler remains a legacy backstop: it requires
an existing server-stored suggestion anchor, uses `pickVettedEmail` as a thin
caller of the canonical projection, and never creates/selects a suggestion.
Contact enrichment partial-timeout behavior is unchanged.

**Status card:** The bottom card below the search is a status/progress/error surface only — no candidate list or per-person verification control. It shows ingestion state, enrichment progress while running, a done summary ("N verified — see Applicant-suggested section above") with an **Update applicant suggestions** batch action, or an error with a "Try again" button.

**Publication count for applicant rows (S264):** Applicant-recommended reviewers skip PubMed/preprint discovery, so they carry no publications list and used to show a FALSE "0 publications" beside a real h-index. `enrich-recommended.js` now backfills `publicationCount5yr` from the OpenAlex author it already resolves for the metrics — `OpenAlexService.getWorksByAuthor(openAlexId, { yearFrom: year - DiscoveryService.YEARS_LOOKBACK, limit: 1 }).totalCount` (count-only query; same window as `DiscoveryService.countRecentPublications`). Gated on `blockScholar` like the other metrics (no count for an unconfirmed/wrong-person match); best-effort (a failure leaves it null). One extra OpenAlex call per applicant reviewer.

**"Scholar profile" vs "Scholar search" label (S266):** Enrichment populates `googleScholarUrl` with a Google Scholar *search* URL by default (`ContactEnrichmentService.buildGoogleScholarUrl` — OpenAlex exposes no Scholar `user=` id), so the card's label MUST NOT be a truthiness check on `googleScholarUrl` (that mislabels every enriched reviewer as having a "profile"). The label is gated on `isRealScholarProfileUrl(url)` (`lib/utils/scholar-url.js`) — true only for `scholar.google.com/citations?user=<id>`, false for `?view_op=search_authors&mauthors=…`. Applied at all three render/export sites (`ReviewerInvitePanel.js`, `ReviewerSearchSection.js` card + export). Today no flow produces a real `user=` profile URL for these reviewers, so they correctly read "Scholar search". **S388 adds a FOURTH site with a stricter rule:** the identity-evidence disclosure on `identityUnverified` cards always builds its link with `buildScholarSearchUrl(name, affiliation)` and never reads `googleScholarUrl`, so a stored `user=` profile can never surface there even if one appears later. That is deliberate and must not be "fixed" into label-gating like the other three — on an unresolved row a real profile URL is the namesake trap itself, not a better link.

**Board-writeup identity edit (S308):** clicking a reviewer in the workbench opens `CandidateEditModal`, which now also edits three person-level confirmed fields — academic rank, primary department, main institution (saved-candidate edit mode only; hidden in the pre-save Find-card `onApply` + `confirmMode` paths). They PATCH `my-candidates` → `potentialReviewerAdapter.update` (server-derived `personId`, never client-supplied) → dedicated person columns (`wmkf_academicrank`/`wmkf_primarydepartment`/`wmkf_maininstitution`), emitted on the candidate DTO. These are first captured (required) at Stage 2a accept (see external-reviewer-portal topic). **Main-institution fallback (S310):** when `wmkf_maininstitution` is empty the modal prefills Main institution from the enrichment Affiliation (`mainInstitutionFallback` = `candidate.mainInstitution ‖ candidate.affiliation`), mirroring the reviewer accept-form prefill (`context.js buildStage2aPrefill`) so staff see the same value the reviewer will. The same fallback is the change-comparison baseline, so opening + saving never silently writes the affiliation into the dedicated column — only a genuine staff edit persists. (h-index was dropped from the modal S310 — auto-fetched, not staff-editable.) See reviewer-identity for the field rationale.

**Review history on the Invite card (S308):** the Invite-tab candidate DTO (`my-candidates` GET) carries `priorReviewCount` + `lastReviewAt`, derived (not stored) from `suggestionAdapter.aggregateReviewHistory(personIds)` — one batched query over `wmkf_appreviewersuggestion` filtered to received-only rows (`wmkf_reviewreceivedat ne null`) for the request's candidate person-ids. "Completed a review" = the reviewer's review was **received** (`wmkf_reviewreceivedat`), NOT the PD's closeout stamp (`wmkf_completedat`). `ReviewerInvitePanel` renders "reviewed N× · last <date>" only when `priorReviewCount > 0`. The aggregation is supplementary — its query failure is caught non-fatally in `my-candidates` (degrades to no history; never 500s the candidate list). Not yet surfaced on Track Reviewers (fast-follow).

**Terminal statuses and full staff-withdrawal cleanup are production-live.**
`withdrew` and `released` are live in the Track pipeline, excluded from
`MODE_WORK_REMAINING` and the Reviews-tab Outstanding list, and routed through
`/api/review-manager/terminal-transition`. The service freshly reads each row,
accepts only accepted/materials-sent/under-review rows with no
declined/received/completed stamp, and uses that ETag so a concurrent submission
wins. `released` writes only the terminal status plus token revocation.
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

**Export to Excel (S264; Invite-tab export + Expertise-tags column S308):** Two surfaces post to `POST /api/workbench/export-candidates`. (1) **Find tab** — a bottom-row "Export to Excel (N)" button (next to Save) exports the **selected** search candidates; (2) **Invite Reviewers tab** (`ReviewerInvitePanel`) — a header "⬇ Export to Excel" button exports the **active saved candidate list** (all non-removed rows on the tab; declined reviewers are archived below and therefore excluded), mapping the persisted DTO into the same slim per-row shape. Both send a slim per-row DTO; the route fetches request metadata (number/institution/PI) authoritatively by `requestId` and streams back a two-sheet `.xlsx` (Request Info + Candidates). Column formatting (Source/Why/**Expertise tags**/Conflicts/ORCID/Scholar) lives in `lib/services/reviewer-candidate-export.js` so the sheet and the cards agree; the Expertise-tags column reads `keywords` (Find tab joins `expertiseAreas`; Invite tab uses the persisted `keywords`). Invite-tab exports carry only invite-stage fields — search-time COI / 5-yr-pub-count / seniority aren't persisted, so those columns read "None noted"/blank (board-writeup identity is captured at acceptance, not here). On the Find tab, `needs_identity_review` rows aren't selectable (so naturally excluded) UNLESS a PD used the S285 identity override ("✓ This is the right person") to confirm + add one, which makes it selectable and thus exportable. The "reviewer diversity"/temperature slider was removed the S264 cycle (search runs at the server default 0.3).

**Re-verify removed intentionally:** The "Re-verify" button was dropped because enrichment output is static within a cycle (COI computed against a fixed proposal author list; PubMed/Scholar data stable over weeks). The valid re-run use case is error recovery ("Try again"). Keep the general re-verify path retired; if a re-resolve-after-edit pattern is ever needed, see the Future Work section in `reviewer-identity.md`.

**Exact applicant-linked person hydration (production-live; authenticated
Request `1002912` visual check passed 2026-07-31):** populated
`akoya_request.wmkf_potentialreviewer1..5` slots are exact
`wmkf_potentialreviewers` GUIDs. Applicant ingestion and enrichment now re-read
only that person, preserve a bounded `applicantKnownReviewer` email/source pair
plus affiliation/ORCID, and render “Existing linked reviewer record” separately
from general-search `dataverseContactEvidence`. Active exact-email ownership
must resolve to the same person. Person-read failures remain per-row and
retryable; all-read failure cannot become a false empty success. Promotion
freshly revalidates the suggestion, person, and owner and may reuse canonical
contact without an email write, but identity/COI and the invitation address
classifier still govern selection and sending. Contract 9 in
`docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md` owns the enforcement details.

**Contact evidence and action policy (S267–S391):**
`shared/components/reviewers/ContactLeads.js` renders quarantined contact leads
only after identity is resolved. An `identityUnverified` card suppresses the
verified treatment—no mailto chip, readiness verdict, green Dataverse claim, or
contact leads—but offers the underlying affiliation, bounded Dataverse
evidence, plain-text address/source, recent papers, and a Scholar name search
under **Review evidence before confirming**.

The complete paper list is load-bearing and must not be truncated or collapsed.
Affiliation, address, and the Dataverse match may all descend from the same
retrieval; staff break that circularity by opening the papers and checking them
against the proposal. The Dataverse line therefore states what the match does
not prove, and the unresolved-card Scholar link never uses a stored profile URL.
A paper establishes the person only; its corresponding-author address becomes
address evidence only when staff explicitly attest that exact value.

**Historical S387 address behavior, retired by S391:** Invite previously used
`PATCH my-candidates { verifyEmailAddress:true }` to stamp `staff_verified`
without recording the separate evidence-backed act, while changed values
followed the `manual` path. That endpoint now returns
`address_verification_moved`; the S391 policy below is the only current address
verification path. Search-derived addresses remain `research_only`, while
identity-anchored scholarly evidence remains `scholarly_multi`/`scholarly_single`
under the existing readiness rules. Candidate cards and the roster retain the
bounded evidence needed for action. Saved-candidate duplicate-email repair still
uses the reviewed merge flow in `docs/REVIEWER_MERGE_DESIGN.md`.

**S391 current address policy (production-live; bounded no-send pilot passed):**
the S387 `my-candidates verifyEmailAddress` flow described above is
retired and returns `address_verification_moved`; it no longer changes provenance
without evidence. Find and Invite use `POST
/api/workbench/reviewer-address-trust`, requiring an affirmative exact
person/address attestation plus a validated evidence link/type. Before promotion,
the server stores a request/candidate-bound roster receipt; promotion ETag-writes
address + `staff_verified` + the versioned exact-address bundle on the stable
person. Bundle-backed `staff_verified` is ready; legacy source-only values remain
quick-check. High-confidence stored-versus-found contradictions on exact
applicant-linked people persist `conflict_pending`, which blocks promotion and all
outbound reviewer templates until staff verifies the stored or found address.
Every blocked card offers verification/editing, set-aside, or a durable repair
request. Ordinary conflict retries require a still-matching server-bound identity
receipt plus anchor-grounded ORCID identity; an existing address receipt is
replayed as the prior adjudication, while a failed pre-bundle conflict write can
clear without inventing person state. Receipt-first partial success and stale
ETags remain explicit and retryable. Promoted conflicts expose both current
addresses and evidence directly in the Invite modal; ordinary manual email edits
cannot bypass the pending block. The complete paper list and Scholar name-search
rule remain load-bearing. The fifth Opus review of `e4349a76` returned NO-SHIP;
its findings were remediated, but the sixth review rejected the follow-up's
inferred no-bundle A/B resolution. Fable's fresh-eyes review supplied the current
fail-closed state machine: a failed conflict write blocks direct verification
plus both promotion paths; retry persists only a real `conflict_pending`
contradiction, and may clear the roster flag without a person write only after a
fresh read shows the contradiction disappeared. Receipts resolve only existing
exact pending tuples. Every block exposes Retry, repair, or set-aside. The final
bounded review found and closed a stale-roster overwrite: resurfacing now
preserves the three stored address blocks but does not carry permissive
`emailPersistAllowed` authority to a resurfaced address (`86bf5d1`, corrected by
`974bb64`). Wave 17 then read back EXACT in Production and runtime commit
`6bc6d2f5` reached Ready as deployment
`dpl_F3TDD39h8gyDN2uxbCWXLwWSSHpA`. The signed-in Request `1002912` pilot
verified Petr Cejka's exact person/address receipt against an official
institution page, authenticated actor readback, reload, and no
selection/promotion/send/Contact change. It caught a stale enrichment-time badge
overriding receipt-backed readiness; `6bc6d2f5` corrected the precedence and the
deployed reload showed **High-confidence email**. No suitable live conflict was
present, so conflict adjudication, promotion parity, duplicate-owner handling,
retryable outage, and capture-send scenarios remain unexercised rather than
being manufactured in Production.

## Reviews tab (workbench consumption of submitted reviews)

The workbench Reviews tab (`shared/components/workbench/ReviewsTab.js`) is fed
by `/api/review-manager/reviewers`; ratings project from the
`wmkf_appreviewanswer` snapshot via `ratingsFromAnswers` (hardcoded 3-key).
Submitted reviewers still render as a read-only per-reviewer card list
(ratings decoded via the static schema, richtext narrative answers, SharePoint
download). Panel-prep roll-up/export now exists client-side (Phase 3, below).

**Phase 1 LIVE (S326; deployed, browser-drive-verified against live acceptance data):** outstanding tracking + manual nudge. The DTO
(`reviewers.js` GET) adds `submitted` (accepted-reviewer submission status),
`daysSinceMaterialsSent` (derived from `wmkf_materialssentat`, null until
materials are sent), and passes through `reminderSentAt`/`reminderCount`
(`wmkf_remindersentat`/`wmkf_remindercount`). `ReviewsTab` renders an
"Outstanding" section ABOVE the submitted cards for accepted-but-not-submitted
reviewers, each with a "Send reminder now" button (disabled + tooltip when
materials haven't been sent). The button posts `{ requestId, suggestionId }` to
`POST /api/review-manager/send-review-reminder`
(`requireAppAccess('review-manager', 'reviewers')`, both ids GUID-validated
before any Dataverse selector), which delegates to
`lib/services/reviewer-manual-reminder.js#sendManualReviewDueReminder`. That
service re-derives eligibility from a fresh read (accepted, materials sent or
under review, review not received, not applicant-excluded via `isExcluded`)
and reuses `reviewer-reminder-sweep.js`'s exported `loadRequestContext` /
`loadReviewer` / `sendOneReminder` verbatim — same claim-before-send (If-Match
on `wmkf_remindersentat`+`wmkf_remindercount`) as the review-due cron, so
manual and cron sends share one fire-once marker and can never double-send.
Unlike the cron, a manual re-send when the marker is already set IS allowed
(staff-initiated); a claim conflict (412) returns an error without sending.

**Structured staff review rescue:** each accepted, not-yet-submitted reviewer in
the Reviews tab also offers "Enter review manually" for cases where the external
portal cannot be used. `ManualReviewEntryForm` loads the current Dataverse
question set from `GET /api/review-manager/manual-review-entry` and renders it
through the external form's shared `ReviewQuestionFields`, including the same
rich-text editor. `POST` re-reads eligibility and the parent ETag, rejects a
stale question-set version, sanitizes narratives, runs the full external review
validator and `buildReviewSubmission()`, then atomically upserts every answer
row and records the parent receipt/status/affiliation with
`wmkf_reviewuploadedbystaff=true`. Draft cleanup happens only after commit and
is best effort. This is deliberately separate from the legacy partial
`mark-received-no-file` and file-upload paths.

**Thank-you sweep (automated):** `/api/cron/send-review-thankyous` (daily,
`30 10 * * *` — offset from the 10:00 reminder cron) →
`lib/services/reviewer-thankyou-sweep.js#sweepReviewThankYous`. Eligibility keys
on `wmkf_reviewreceivedat ne null and wmkf_thankyousentat eq null` (NOT the
`wmkf_reviewstatus` picklist — the submit route stamps status `100000003` at
submission, so the received-at timestamp is the durable "review is in" signal).
Structure + idempotency mirror the reminder sweep: fetch rows WITH `_etag`, fail
closed if missing, claim `wmkf_thankyousentat` via If-Match BEFORE send (412 →
`claimFailed`, skip), and a post-claim send failure is logged (`sendFailed`)
without marker rollback or retry (at-most-once — owner-approved
acceptance-confirmation posture). It reuses the reminder sweep's exported
`loadRequestContext`/`loadReviewer` for the PD sender + signature + reviewer
email, and renders the seeded `thankyou` template via
`reviewer-reminder-email.js#renderThankYou`. It sends the email as the PD
(`createAndSendEmail`, `noFallback:true`) with a **courtesy DOCX copy of the
reviewer's own review** attached as real file bytes (`activitymimeattachments`,
never Blob-staged): `composeSingleReviewCopy` (pure, in
`shared/utils/review-report.js`, reusing the `htmlToBlocks` tokenizer) →
`generateSingleReviewCopyDocx` (server-side `import('docx')`, returns a Buffer,
in `shared/utils/review-report-docx.js`), over the answer snapshot read through
the hoisted `lib/services/review-answers.js#fetchAnswersBySuggestion` (shared with
the Reviews-tab GET). The attachment is NON-FATAL — a compose/render failure
still sends the thank-you without the DOCX and counts `attachmentFailed`. The
`wmkf_thankyousentat` marker is shared with the manual `thankyou` send
(`send-emails.js`), so a manually-thanked reviewer is naturally skipped and the
manual modal's deliberate re-send is unchanged. Knobs: `?maxBatch=N`, `?dryRun=1`.

**Phase 2 DEPLOYED (S326; unit-tested; populated Compare view NOT browser-verifiable until the first portal submission — zero exist, portal built ahead of the D26 cycle; correct zero-submission absence drive-verified):** schema-free
comparison matrix. `shared/utils/review-matrix.js#deriveReviewMatrix(reviewers,
liveQuestions)` is a pure, DOM/React/Dataverse-free derivation over each
reviewer's `answers[]` — union of question keys, ordered by the LIVE question
set (`review-question-fetcher.js#getActiveQuestionSet()`) with snapshot-only
keys appended after (flagged `retired: true`); per-question cells are
`'answered'|'empty'|'not-asked'` (no row at all = not-asked, distinct from a
blank answer); picklist questions get average/min/max/answeredCount computed
only across reviewers who answered that key (drift-safe). NO hardcoded
question keys and no read of `review-form-schema.js` or the legacy
`reviewerImpact`/`reviewerRisk`/`reviewerOverallRating` projections — labels
come from each row's own `answerText`. `reviewers.js` GET now also returns
`liveQuestions` (`{key, order, text, type}[]`) via a new `fetchLiveQuestions()`
wrapper; it fails SOFT (`liveQuestions: null`, logged) if the fetcher throws —
`getActiveQuestionSet()` itself fails closed for the reviewer-facing form, but
a workbench read of past submissions must not 500 on that basis. `ReviewsTab`
adds a "Cards"/"Compare" toggle above the submitted-reviews area ("Cards" is
the unchanged Phase-1 rendering, default); "Compare" renders a horizontally-
scrollable ratings grid (rows = picklist questions in live order, columns =
reviewers + Average + Spread, retired questions badged "Prior cycle") plus a
per-question narrative browser (richtext questions, all reviewers' `answerHtml`
stacked with attribution, rendered the same way the Cards view's
`NarrativeAnswers` does — already-sanitized server HTML). Duplicate
`questionKey` with differing snapshot text across reviewers: first-reviewer's
text wins (documented in the module header) when the key isn't live; live text
always wins when it is.

**Phase 3 DEPLOYED (S326; unit-tested; same verification boundary as Phase 2 — export unverifiable against real data until the first portal submission; correct absence drive-verified):** panel-prep
roll-up/export. `shared/utils/review-report.js#composeReviewReport(...)` is a
pure, DOM/React/Dataverse-free composition over a `deriveReviewMatrix` result
(consumed, not re-derived) plus proposal identity — header, summary
(reviews-submitted count + per-rating-question average/spread), a ratings
table (same rows/columns as the Compare grid), and per-richtext-question
narrative sections (all reviewers' answers, matrix order, `retired` flag
carried through). The same module's `htmlToBlocks(html)` is a small pure
tokenizer scoped to the sanitizer's allowlisted grammar ONLY
(`lib/external/sanitize-review-html.js` `ALLOWED_TAGS`: p, br, strong/b,
em/i, ul/ol/li, h2/h3, blockquote, a — no tables/images/spans/divs), producing
typed blocks with inline runs; an unknown/malformed tag degrades to plain text
(tag stripped, text kept) rather than throwing or dropping content.
`shared/utils/review-report-docx.js` (docx, dynamic `import('docx')` per
`word-export.js` convention) and `shared/utils/review-report-pdf.js` (pdf-lib,
built on `PDFReportBuilder` from `pdf-export.js`) render that report object;
PDF FLATTENS inline bold/italic runs to plain text (pdf-lib/`PDFReportBuilder`
has no mixed-run text primitive) — documented degradation, DOCX is the
full-fidelity artifact. `ReviewsTab`'s submitted-reviews toolbar gets an
"Export: Word (.docx) / PDF" affordance (visible only once ≥1 review is
submitted) that composes client-side from already-loaded `submitted`/
`liveQuestions` — no new fetch, no new route, no Dataverse roll-up column
(governing decision 4). Proposal identity on the export (request
number/title/institution/PI) uses whatever `proposals[0]` already carries
(`requestNumber`/`proposalTitle`/`proposalInstitution`/`proposalAuthors`) — the
DTO has no dedicated `piName` field, so `proposalAuthors` (project
leader/applicant) stands in as the best-available PI identity.

**Phase 4 BUILT (2026-07-03); reliability production-proven 2026-07-28:**
Executor-based AI synthesis of a proposal's submitted reviews. New Tier-1
prompt `review-synthesis.generate` (`shared/config/prompts/review-synthesis.js`,
initially bootstrapped as v1 and published through the audited admin path as
backward-compatible current v2
`7423049a-3f89-f111-ab0f-7ced8d3d15a6` on 2026-07-26); all-override, single untrusted variable
`reviews_digest` (reviewer `answerText`, never `answerHtml`, composed
server-side into a plain digest) so the Executor wraps it + injects the A7
preamble. Output is strict JSON (prompt-level
`generationMode:native-json-schema`, single output `synthesis`;
`validationSchema` bounds/strips the parsed shape) written to a new memo column
`akoya_request.wmkf_reviewsynthesisjson` with `guard: 'always-overwrite'` —
schema-as-code APPLIED TO PROD 2026-07-03 (column live-probed) from
`lib/dataverse/schema/wave11-review-synthesis/`. `POST
/api/review-manager/synthesize-reviews` (`requireAppAccess('review-manager',
'reviewers')`, requestId GUID-validated) returns 409 `no_submitted_reviews`
with zero submitted reviews (no LLM call); since the guard is
always-overwrite, regeneration gating is enforced at THIS route instead — 409
`already_exists` unless `overwrite: true` is passed. The deployed lifecycle
extension also requires explicit `confirmEarly:true` while
participants remain unresolved and records each generation in
`review_synthesis_jobs`. `GET /api/review-manager/reviewers` projects
`proposal.reviewSynthesis` (fail-soft JSON parse) and
`proposal.reviewSynthesisState`. `ReviewsTab` retains the Synthesis
card even at zero accepted/submitted reviews, with Current/Stale, readiness,
and queued/running/failed state. Output is plain-text only (no
`dangerouslySetInnerHTML`); `composeReviewReport` accepts an optional
`synthesis` param rendered additively in both export formats. Same
verification boundary as Phases 2-3: Request #1002788 production-proved the
submitted DTO, categorical matrix, and both export renderers on 2026-07-26.
Three real v2 synthesis executions failed before writeback with
`Claude output not valid JSON: Unexpected end of JSON input`, producing failed
append-only audit runs `f5aa3712-4789-f111-ab0f-6045bd018a07` and
`04805a39-4789-f111-ab0f-6045bd018deb` on 2026-07-26, then
`be61f383-f289-f111-ab0f-70a8a59cded0` on 2026-07-27. The latest attempt
returned HTTP 500 with `claude-sonnet-5`, prompt v2, Vercel Interactive source,
and a redacted override. The prior request memo remained byte-for-byte
unchanged. The 11 synthetic answers and four staged suggestion fields were
fully restored, with no draft or unrelated email/material/reminder/thank-you
change; the failed AI run remains append-only. The same smoke also proved the
staff Manual Review Entry path. The local 2026-07-27 change preserves joined
response text/stop metadata, requires `end_turn` before persistence, uses
capability-gated native JSON schema, and retries one typed `max_tokens`
termination once with a bounded larger budget. Each semantic attempt retains
its own AI-run audit attempt. Governed v3
`660d7e3f-9e8a-f111-ab0f-000d3a31c468` became the sole current production row
on 2026-07-28 with the exact tracked native JSON schema. The controlled Request
`1002788` smoke then completed on its first semantic attempt with `end_turn`,
persisted valid synthesis, and wrote completed AI run
`20aec518-9f8a-f111-ab0f-6045bd018deb` against prompt version 3. Exact cleanup
deleted the 11 staged answers and restored four parent fields while preserving
the synthesis and append-only audit. Independent follow-up review returned READY.

**Owner-confirmed lifecycle (2026-07-26; participation semantics closed
2026-07-27; production-deployed and enabled 2026-07-28):** automatic
synthesis runs only after
all participating invitations resolve and at least one review is submitted;
staff may explicitly generate it earlier after one submission. Participants are
selected, not-applicant-excluded rows that entered invitation/engagement
(`wmkf_invited=true` or `wmkf_accepted=true`). A receipt resolves with review
content. Declined, no-response, `withdrawn_sufficient`, withdrew, released, and
a currently revoked or expired token resolve without content. Every other
participant without a receipt blocks, including live-token invitees who have
not accepted, unresolved duplicates, and malformed/unknown lifecycle or token
state. Unselected, applicant-excluded, and explicitly merged/removed duplicates
do not participate. `mintAndStore` clears revocation and writes a future expiry,
but regeneration reopens readiness only when token state was the
otherwise-participating, nonterminal row's sole resolution; it does not reselect
a removed row or undo decline/withdraw/release. An existing synthesis remains
visible but is not current until synthesis runs again after genuine reactivation
and resolution. The exact answer digest plus lifecycle classification is hashed;
a matching completed ledger row establishes Current state. The feature-gated
`/api/cron/drain-review-syntheses` uses leased claims and revalidates readiness
and the fingerprint before generation. It remains inert unless
`REVIEW_SYNTHESIS_AUTOMATION_ENABLED=true`. **This extension is production-deployed
and enabled after signed-in verification plus the controlled Request `1002788`
automatic smoke. Job `2`, maintenance run `27723`, and AI run
`1b882cf6-bf8a-f111-ab0f-7ced8d3d15a6` completed in one claim; exact cleanup
returned the census to zero eligible requests and the retained memo to Stale.
PR #98 corrected the automatic Executor run source; PR #99 moved lifecycle
revalidation before content loading so vanished inputs cancel. Final deployment
`dpl_FdUJSjNwhbNWKWVzpyymiB2mpJo1` is Ready, and a post-deploy bounded drain
returned zero eligible/enqueued/claimed/failed.** Plan doc:
`docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md`.

## Email templates (admin org default + per-PD override)

- **Two layers (S297).** The four reviewer templates (`invitation`, `materials`,
  `followup`, `thankyou`) now resolve as **per-PD override → admin org default**,
  with no runtime code fallback (a blank/unavailable admin value renders blank in
  the PD's preview-before-send, by design — all four are interactive
  preview-then-send only, no headless path).
  - **Admin org default:** edited in `/admin` → **Email Defaults**
    (`EmailDefaultsSection`), stored in Dataverse `wmkf_appsystemsetting` under
    `email.reviewer_<type>.{subject,body}`, read by PDs via
    `GET /api/email-defaults/reviewer-templates`. Shipped copy is **seeded** from
    `lib/seed/email-defaults/reviewer-templates.js` (the single source of the
    default text; init data, NOT a runtime fallback) via
    `scripts/seed-email-defaults.mjs --execute` / `rebaseline-email-defaults.mjs`.
    **Deploy step:** the seed must run or every reviewer template renders blank.
  - **Per-PD override:** still `shared/components/reviewers/email-template-store.js`
    (`loadEmailTemplates`/`saveEmailTemplates`, `PREFERENCE_KEYS.EMAIL_TEMPLATES` in
    `wmkf_appuserpreferences`), edited in **Profile Settings** OR the Workbench
    Reviewers tab's "✎ Email templates" (same `EmailTemplatesModal`). `saveEmailTemplates`
    now persists **override-only** (fields differing from the admin default), so later
    admin edits flow through to non-overridden fields; "reset to default" clears the
    override back to the admin org default. The store no longer holds `DEFAULT_TEMPLATES`;
    `EMPTY_TEMPLATES` is the blank skeleton used until a load completes.
  - **Recovery of a fat-fingered blank** is parked for Connor: enable Dataverse
    table-level auditing on `wmkf_appsystemsetting` — see
    `project-dataverse-settings-audit-enablement`.
  - **Invitation paired response actions (2026-07-24).** At SEND time,
    `send-emails-service.js` replaces the editable body's first secure-link position
    with one table-based, inline-CSS `Yes, I Can Review` / `No, Not This Time` action
    pair. Accept deep-links to the existing Stage 2a form with `?action=accept`;
    decline deep-links to the existing decline/referral form with `?action=decline`.
    Those query values only choose the initial view: GET never records a response, and
    the existing portal POST remains the mutation boundary. The structural button
    labels/footer are fixed; subject/body and per-recipient preview edits remain
    editable. The assigned active Program Director must have an email address:
    invitation transport sends as that PD and otherwise fails closed with
    `program_director_sender_unavailable`. The footer renders the PD name and clickable
    email plus the generic secure-link fallback.
  - **Other secure-link button labels remain stage-aware (S311).** Materials and
    follow-up use the admin settings `email.reviewer_<type>.button_label`
    (`materials`→"Start Review", `followup`→"Go to Review") with non-empty
    stage fallbacks. A type with no fallback (`thankyou`) keeps a review URL as a
    plain link. The former invitation button-label setting may remain in existing
    Dataverse baselines but is no longer exposed or consumed as editable invitation
    copy because invitations require the fixed paired labels.
  (The `hold` + `finalize` templates were **REMOVED in S279** along with the rest of
  the hold path — see `project-reviewer-hold-step-decouple`.)
- **Invitation send-safety semantics (S340, `send-emails.js`).** First-external-send hardening,
  invitation templateType only: (1) `wmkf_invited`/`emailSentAt`/`respondReminderSentAt` is stamped
  INLINE per-recipient right after each successful send (not a post-loop pass), so a mid-batch
  timeout can't leave sent invites unstamped and exposed to a duplicate re-send via the
  `shouldSkipDuplicateInvitation` guard. (2) A send that THROWS goes to a new `unconfirmed[]` bucket
  + `email_unconfirmed` SSE event ("possibly sent — verify before retry"), never `failed[]`, because
  a thrown SendEmail may still have dispatched. (3) A successful send whose inline stamp fails is
  recorded `inviteRecorded:false` on the sent record (surfaced, not a scrolling warning). (4) A
  send-time body-integrity gate skips an invitation whose body lacks a `/external/review/` secure
  link (`missing_secure_link`) or carries an unresolved `{{token}}` (`unresolved_placeholder`) rather
  than ship a broken first-contact email. `InviteEmailModal` renders the "verify before retry" set
  and lists who was sent/failed/skipped; a terminal error no longer shows green success. Re-sendable
  templates keep their prior `failed[]` send semantics. Materials/followup/thankyou retain the
  established post-loop best-effort lifecycle stamp; thank-you additionally refuses terminal rows.
  Durable per-dispatch deadline evidence is not part of the terminal-status branch and requires a
  separate design around ordered Dynamics email activities or an append-only dispatch entity.
  Rendering quality (also S340, `lib/utils/email-generator.js`): the greeting drops trailing
  name suffixes (Jr./Sr./III/PhD/MD) for the surname and falls back to "Dear Reviewer" on an empty
  name; `{{proposalAbstract}}` is soft-unwrapped (`softUnwrapProse`) so a fixed-column hard-wrapped
  abstract reflows to the email width instead of rendering a `<br>` at every stored newline. The
  unwrap is calibrated against 40 real abstracts (S340): it joins only lines that look auto-wrapped
  (long + not ending at a sentence/clause boundary), so single-newline paragraph separators and
  short header lines are PRESERVED, not merged; blank-line paragraph breaks always stay.
  `proposalDetails` is NOT unwrapped — its single newlines are intentional. Detector + reflow now
  live in `lib/utils/abstract-format.js` (`hasAbstractWrapArtifacts` / `reflowAbstract`).
- **Abstract-edit gate (S340).** `render-emails` surfaces per-draft `abstractFlagged` +
  `currentAbstract` + `reflowedAbstract` + `requestId`. **The flag is `abstractNeedsReflow` — true
  exactly when the reflow would change the stored text** (not merely "has a mid-sentence newline"),
  so the banner's "auto-cleaned for these emails" claim always holds and a header-style intentional
  break is not flagged. When flagged, `InviteEmailModal` shows a non-blocking amber banner with an
  "Edit abstract" editor (seeded with the reflowed text). Save requires a `window.confirm` (durable,
  no undo — mirrors the send path) and **clears per-recipient body/subject overrides** (`setEdits({})`)
  so a manually-edited draft can't keep the pre-fix abstract; it then POSTs
  `/api/review-manager/update-abstract` → overwrites the canonical `wmkf_abstract` on `akoya_request`
  via `updateById` (auth `requireAppAccess('review-manager','reviewers')`, GUID-validated requestId,
  trusted DAL context, PD attribution; optimistic compare-and-set — the modal posts the
  `expectedCurrent` abstract it rendered from and the service 409s if the live `wmkf_abstract`
  changed since, targeted on the abstract field so an unrelated concurrent write to the request
  does not spuriously conflict), then
  re-renders (flag clears). `wmkf_abstract` is GoApply write-once (NOT re-synced), so a PD edit is
  durable and fixes these reviewer invites plus any later read that starts from `wmkf_abstract`. It
  does NOT retroactively rewrite an already-generated derived version (`wmkf_abstractformatted`/
  `wmkf_abstractapproved`, consumed by grantee/board exports via `grantee-document-assembly.js`),
  which live behind their own approval-status gates. The reflow remains the send-time safety net for
  un-edited flagged abstracts.
- All four templates are sendable: `invitation` (first contact, via ReviewerInvitePanel →
  `InviteEmailModal`, hardcoded `templateType:'invitation'`) and
  `materials`/`followup`/`thankyou` (via `ReviewerManagePanel`). The reviewer onboards
  (COI/AI acks + honorarium/address; honorarium request creation is config-gated
  and BILL remains deferred this cycle) at the single Accept on the portal;
  an acceptance-confirmation email with a review-due `.ics` ships from `respond.js` on
  first accept. There is no hold/agree-in-principle view.
- The invitation default now surfaces proposal context for **early COI flagging**:
  `{{proposalDetails}}` (Title / Principal investigator / Co-investigators /
  Institution — empty lines dropped, composed in `lib/utils/email-generator.js`) and
  the full `{{proposalAbstract}}`. Co-PI names come from the `wmkf_apprequestperson`
  junction (`fetchCoPIs`); PI is `_wmkf_projectleader_value_formatted` ONLY (never the
  applicant org). Timeline tokens are client-substituted from the existing campaign
  system; the modal blocks a send when proposal release precedes response deadline
  or the review due date is not after release. It loads timing in this order:
  built-in fallback, per-user sticky `reviewer_invite_timing`, admin cycle defaults,
  then request campaign config. The redesigned seed is init data, not a runtime
  fallback: promotion must deliberately rebaseline the admin default, and existing
  per-PD subject/body overrides remain intact until reset or edited.

## Operating Notes

- **Route→Service layout (Stage 7, 2026-07-05): every workbench and
  review-manager route is a thin shell; the lifecycle/business logic lives in
  `lib/services/workbench/` (incl. `grantee-deliverables/`) and
  `lib/services/review-manager/`.** Routes may not import
  `lib/dataverse/adapters/*` or `lib/services/dynamics-service` — enforced by
  `check:route-service-boundary` (law mode) `[VERIFIED via the gate run at
  census 0, 2026-07-05; docs/ROUTE_SERVICE_CONSOLIDATION_PLAN.md]`. Lifecycle
  behavior changes belong in the domain service; the shell keeps only guard →
  validate → DAL context → service call → HTTP mapping.
- **Save-time Tier-0 affiliation-email rescue — "reviewer has no email on the Invite tab" trap (S317).**
  When contact enrichment RUNS but does not COMPLETE (a partial / timed-out run — the person
  record carries `wmkf_lastchecked` but no `wmkf_metricsupdatedat`/`wmkf_hindex`), a
  PubMed-style affiliation that embeds the reviewer's own corresponding address
  ("… Boston Children's Hospital. christopher.walsh@childrens.harvard.edu.") used to be saved
  with the email ORPHANED inside `wmkf_primaryaffiliation` and an EMPTY `wmkf_emailaddress`
  ("no email — can't invite" on the Invite Reviewers tab), because enrichment's own Tier-0
  extraction (`contact-enrichment/tiers.js` `applyTier0`, using
  `ContactParser.extractPrimaryEmail`) never ran to completion.
  `reviewer-finder/save-candidates-service.js` re-applies that extraction as a
  last step: if no email was captured
  and the affiliation being persisted contains one (`ContactParser.extractPrimaryEmail`), it is
  stored as `emailSource='affiliation'` — a grounded, name-adjacent address that enrichment
  trusts unconditionally (Tier 0 returns before domain validation, so it is immune to the
  paid-search domain-contradiction drop). Same safety envelope as the normal email persist:
  skipped for a contact-blocked (unresolved cited/PI-named) row and for PD-confirmed rows, and
  only when the affiliation itself is allowed to persist; it only fills a GAP, never overrides a
  captured email. Diagnosed live on request 1003020 (Walsh, Akbarian). Tests:
  `tests/unit/reviewer-route-identity-gate.test.js` ("Tier-0 affiliation-email rescue").
- **Name-based dedup collapses reviewers who share a NORMALIZED name — a recurring "missing reviewers" trap (S312).**
  Two shared normalizers both lowercase and strip everything non-alpha via
  `.replace(/[^a-z\s]/g, '')` — **which deletes digits**: `normalizeReviewerName`
  (`lib/utils/reviewer-name-match.js:33`) and `normalizeName`
  (`lib/utils/name-normalization.js:18`). That normalized key is the dedup identity
  in several pre-roster/display passes: display
  `dedupeByName` → `candKey` → `normalizeReviewerName` (`ReviewerSearchSection.js`),
  the `/discover` server dedup, and `DeduplicationService` (`deduplication-service.js:112`,
  its own copy of the same regex). Consequences to watch for when "not all reviewers
  show" in the Find tab: (a) **test data** — names differing only by a trailing digit
  (`tester2/3/4/5 testing` → all normalize to `tester testing`) collapse to one row;
  use alphabetically-distinct test names. (b) **real same-name reviewers** — two
  genuine "John Smith"s collapse to one surfaced/rostered row. The underlying person
  records + `disposition=recommended` junction rows are NOT lost — the collapse is in
  the remaining name-dedup surfaces, not the roster database key. Migration 025 changed
  the roster unique key to `(request_id, candidate_key)`, so distinct rows that reach
  persistence can coexist; `normalized_name` remains only a conservative cross-run
  exclusion value. A complete fix requires replacing the remaining display/discovery
  name dedup with identity-aware correlation. The digit-strip itself still affects
  search exclusion and matching, so do not casually change it.
- **Source-person edits after a successful terminal enrichment are not automatically cache-invalidating (remaining S312 residual).**
  The cache now requires the complete non-terminal expected canonical `suggestion:<id>`
  set (after canonical excluded/saved staff actions are subtracted), so legacy-key
  rows and partial persistence no longer suppress a refresh. Completed
  completed batches expose **Update applicant suggestions**, and reruns preserve
  staff-confirmed rows. A resolved/deceased terminal row still has no source-person
  version token, however, so a later rename or affiliation/email correction in
  `wmkf_potentialreviewerses` does not itself invalidate that otherwise-valid cache.
  Add a source version/modified timestamp to the contract before claiming automatic
  refresh for this residual; do not clear request roster rows as routine UI behavior.
- Roster reload must preserve fields that keep deferred/unresolved/conflicted rows non-selectable.
- Cross-run dedup is durable; do not casually drop carryover.
- Reviewer removal/reset behavior often spans UI state, roster store, and Dataverse suggestion state.
- Applicant-suggested rows are persisted as `disposition=recommended` but are **not** in the candidate pool until `wmkf_selected=true`; keep the promotion route as the only UI save path for these rows.
- The auto-enrichment effect depends on `proposalKey`, not just `blobUrl`: same-key applicant-origin roster rows are a valid restore cache, but a null key is never a cache hit and a different key must re-enrich. Be careful if adding new proposal-load effects that they do not treat the random-suffixed Blob URL as durable identity.

## Standard Probe

```bash
rg -n "pruneCandidateForRoster|saveCandidates|my-candidates|referral|referred|excluded|reset-request-reviewers|enrichRecommended|recPhase|applicant_suggested" pages shared lib scripts tests docs
```
