---
agent_wiki: topic
status: active
last_verified: 2026-07-23
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
  - shared/components/reviewers/reviewer-search-logic.js
  - pages/api/reviewer-finder/my-candidates.js
  - lib/services/reviewer-finder/remove-candidate-service.js
  - shared/components/reviewers/RemoveEntirelyModal.js
  - pages/api/reviewer-finder/enrich-contacts.js
  - pages/api/reviewer-finder/save-candidates.js
  - pages/api/review-manager/campaign-timeline-defaults.js
  - pages/api/review-manager/repair-materials-send.js
  - pages/api/review-manager/terminal-transition.js
  - pages/api/workbench/enrich-recommended.js
  - pages/api/workbench/applicant-reviewers.js
  - pages/api/workbench/promote-applicant-reviewer.js
  - pages/api/workbench/export-candidates.js
  - lib/services/reviewer-candidate-export.js
  - lib/services/reviewer-campaign-timeline.js
  - lib/services/review-manager/repair-materials-send-service.js
  - lib/services/review-manager/materials-send-repair-receipt.js
  - lib/services/review-manager/terminal-transition-service.js
  - lib/services/review-receipt-guard.js
  - lib/services/reviewer-roster-store.js
  - lib/services/contact-enrichment-service.js
canonical_docs:
  - docs/APPLICATION_STATE_ATLAS.md
  - docs/atlas/postgres-reviewer-find-roster.md
  - docs/atlas/dataverse-wmkf-potentialreviewers.md
  - docs/atlas/dataverse-wmkf-appreviewersuggestion.md
  - docs/REVIEWER_REMOVE_ENTIRELY_BUILD_PLAN.md
watch_paths:
  - shared/components/reviewers/**
  - pages/api/reviewer-finder/**
  - pages/api/review-manager/**
  - pages/api/workbench/enrich-recommended.js
  - pages/api/workbench/applicant-reviewers.js
  - pages/api/workbench/promote-applicant-reviewer.js
  - pages/api/workbench/export-candidates.js
  - lib/services/reviewer-candidate-export.js
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

**Reviewer-engagement build (Model B):** spec is `docs/REVIEWER_ENGAGEMENT_SPEC.md`. The 9 backing Dataverse fields are **provisioned in prod (2026-06-21, wave `7-reviewer-engagement`)**. Per-request campaign config (offset/due-date/reminder toggles+leads/desired-count/quota-notified-at) lives on `akoya_request`; the per-reviewer fire-once respond-reminder marker `wmkf_respondremindersentat` lives on `wmkf_appreviewersuggestion`. **Phase 1 LIVE (S275):** the invite panel's respond-by is now a "days to respond" offset; `wmkf_respondoffsetdays` + `wmkf_reviewduedate` are written on first invite (`send-emails.js`) and edited via `/api/review-manager/campaign-config` (Reviewers-tab "Campaign settings"). Current-cycle invitation defaults are now edited in `/admin` as "Reviewer Campaign Timeline", stored in `wmkf_appsystemsettings` key `reviewer.campaign_timeline_defaults`, and read by `InviteEmailModal` through `/api/review-manager/campaign-timeline-defaults`; request config overlays those defaults when present. **Phase 2 LIVE (S275):** per-recipient token TTL (`lib/external/reviewer-token-ttl.js` via `render-emails` — invitee/non-responder link caps at review-due+2d, accepted gets review-due+90d, fallback now+90); accepted-only "Release to reviewers" materials send (server-gated in `send-emails`, plus a one-click button on the **Track Reviewers** sub-tab, `ReviewerManagePanel.js`); and a `materials_not_sent` upload guard (`review-upload.js` self-token path → 403). **Phase 3 LIVE (S275):** `/api/cron/reviewer-reminders` (daily) sends two per-request opt-in reminders — respond-by (invited non-responders, deadline = emailSentAt + respondOffsetDays - lead, token-live, fire-once `wmkf_respondremindersentat`) and review-due (accepted/materials-sent/not-submitted, deadline = reviewDueDate - lead, fire-once via the existing `wmkf_remindersentat`). Both claim-before-send (If-Match) → at-most-once; the server `allowResend` re-mint clears the respond marker (the **manual "Re-invite already-invited" Invite-Reviewers-panel button (`ReviewerInvitePanel`) was removed S277** — the respond-by reminder is the nudge for invited non-responders; `allowResend` is retained only as the programmatic re-mint contract). Server-side render in `lib/external/reviewer-reminder-email.js`; service in `lib/services/reviewer-reminder-sweep.js`. **Phase 4 LIVE (S275; actual PD email + quota seeding S352):** quota → PD notify + selective decline. `lib/services/reviewer-quota.js` (called from the acceptance drain `lib/services/reviewer-acceptance-drain.js` after it re-verifies the accept committed — moved off `respond.js` by the S350 accept-fast-response build) notifies the lead PD once when the accepted count first reaches `wmkf_desiredcount` — concurrency-gated by a conditional null→set of `wmkf_quotanotifiedat` (If-Match). **S352:** the notify now actually EMAILS the lead PD (`emailAdmins: true`, `explicitRecipients` = resolved PD only, no `category` fan-out; degrades to dashboard-alert-only when the PD email is unresolvable), and `wmkf_desiredcount` is settable end-to-end — admin "Reviewer quota" default (4) in the Reviewer Campaign Timeline settings, seeded non-clobbering on first invite send (`send-emails-service.js`, server-side default read only), and editable in the Campaign settings modal, which prefills due-date/quota from the admin defaults (`docs/REVIEWER_QUOTA_PD_EMAIL_PLAN.md`, Status: SHIPPED). `POST /api/review-manager/withdraw-sufficient` (the **Invite Reviewers** tab's "Release as no longer needed") writes `withdrawn_sufficient` + `wmkf_withdrawnsufficientat` + clears `wmkf_respondremindersentat` on still-pending rows only (the §2.9 missing writer). **All four phases shipped.** See the two Atlas pages for the exact column list.

## Candidate removal + restore (Invite Reviewers tab "X")

The "X" on an Invite Reviewers panel (`ReviewerInvitePanel`) card is a **soft-delete**, not a UI-only dismiss: `DELETE /api/reviewer-finder/my-candidates` → `suggestionAdapter.softDelete(id, {alsoRevokeToken:true})` flips `wmkf_selected=false`, clears accepted/declined/responsetype/reviewstatus/heldat, and (if invited) sets `wmkf_externaltokenrevoked=true` — all in one atomic PATCH. The row is NOT hard-deleted; the person/contact is untouched. Removed candidates do **not** reappear in the Find tab (Find is ephemeral discovery + roster dedup; it never reads back persisted suggestion rows).

**Restore (S285):** removed candidates surface in a collapsible "Removed (N)" list at the bottom of the Candidates panel, each with a Restore button → `PATCH my-candidates {suggestionId, restore:true}` → `suggestionAdapter.restore` → `updateLifecycle({selected:true, …})`. Restore re-selects and does **not** touch disposition. **Re-add is a fresh start (S343):** both restore AND manual re-add (`ensureStaffManualCandidate`) now clear the full stale engagement stamp set on a re-selected *removed* row via the shared `ENGAGEMENT_STAMP_RESET`: `wmkf_invited=false`, and `wmkf_emailsentat`, `wmkf_respondremindersentat`, `wmkf_remindersentat`, `wmkf_remindercount`, `wmkf_materialssentat`, `wmkf_reviewreceivedat`, `wmkf_responsereceivedat`, `wmkf_thankyousentat`, `wmkf_completedat`, `wmkf_withdrawnsufficientat`, and `wmkf_proposalfirstaccessed` reset to `null`. It still does not directly un-revoke the old magic link; a subsequent invitation mints a **new** live token (`ensureToken` re-mints on the revoked row, `setExternalToken` clears the revoke). Before S343 the invitation stamps were left in place, so a re-added row resurfaced as "Invited — awaiting response" over the OLD `emailSentAt` and a dead link, and the duplicate-invitation guard (`wmkf_invited===true`) blocked any re-invite; stale review/reminder stamps also made a genuine re-engagement skip review-due reminders or read as already reviewed. The reset is applied ONLY to rows that were removed (`wmkf_selected===false`); re-adding an already-active candidate must not wipe a live invitation or submitted-review state. Restore keeps its existing ETag guard. The manual re-add re-select PATCHes are now also ETag-guarded from the fetched row: on 412 they re-fetch, redo only the source-union write with **no** reset if the row is now `wmkf_selected=true`, or retry the reset write if the row is still removed. The Removed list is scoped to `wmkf_selected=false AND wmkf_applicantdisposition eq null` (`findRemovedByRequest`): discovered/manual candidates are always created `selected=true`, so `selected=false + disposition=null` is unambiguously "was curated, then X'd". Applicant-recommended rows (`disposition=recommended`) are deliberately excluded — they're recoverable from the Find tab's applicant-suggested section, and listing them here would conflate "never promoted" with "removed". Removed candidates ride the single-request GET path only (`removedCandidates` on `proposals[0]`), which is the scope the Candidates panel uses.

**"Remove entirely" — permanent removal (S343; discoverability revised S347):** a distinct, destructive action alongside the recoverable "X" (`RemoveEntirelyModal.js`). **S347:** the owner (S344) couldn't find it because it was reachable ONLY after soft-removing a candidate and expanding the "Removed" list. It is now surfaced directly on **active** candidate rows via a single **"Remove ▾"** menu (`RowRemoveMenu` in `ReviewerInvitePanel.js`) offering two routes — "Remove from this proposal" (the recoverable `removeCandidate` soft-delete "X") and "Delete permanently…" (opens `RemoveEntirelyModal` via `setRemoveEntirelyTarget`). The menu is pure routing; each destination keeps its own confirm/preflight. The collapsible "Removed (N)" list still hosts Restore + its own "Remove entirely" and now **defaults to expanded** (`showRemoved` initial `true`). The underlying `DELETE`/service contract is unchanged. `DELETE /api/reviewer-finder/my-candidates {suggestionId, mode:'hard', deleteContact?}` → `removeCandidateEntirely` (`lib/services/reviewer-finder/remove-candidate-service.js`) PERMANENTLY deletes, in ONE atomic Dataverse `$batch` changeset (`runChangeset`, leaf-to-root order: review-answer snapshot rows → the suggestion row → the honorarium `akoya_request` if linked [→ the contact last, only if `deleteContact:true`]), plus a Postgres `ReviewDraftService.deleteBySuggestion` cleanup (NOT in the changeset — cross-store, ordered AFTER the changeset commits). Same app-access gate as the soft-delete "X"; no per-PD ownership scoping and **no blocks** (high-trust owner decision, S343 — a PD decides when/why; safety is a durable pre-delete `system_alerts` audit breadcrumb via `NotificationService.notify`, written BEFORE any delete and aborting the whole operation if it fails to write, plus the accurate `describeRemoval` preflight disclosure (`GET my-candidates?mode=removal-preflight&suggestionId=`) surfaced in the confirm modal — not a precondition/test-mode gate). Design: `docs/REVIEWER_REMOVE_ENTIRELY_BUILD_PLAN.md`.

## Decline-referral surface + one-click add (S349)

When a reviewer declines via the external portal, the decline form's free-text
"Anyone you'd suggest instead?" is captured to `wmkf_declinereferral` on the
suggestion row (`reviewer-suggestion.js` decline writer — **capture has always
been live**). Until S349 **nothing read it** — the suggested names sat unseen.

- **Reader:** `GET /api/workbench/decline-referrals?requestId=` →
  `lib/services/workbench/decline-referrals-service.js` (`getDeclineReferrals`).
  Returns declined rows with a non-empty referral, each with the decliner's
  `wmkf_name` resolved. **Deliberately independent of
  `review-manager/reviewers-service.js`**, which filters to accepted reviewers
  and early-returns when none are accepted — so referrals surface even when
  every invitee declined before anyone accepted.
- **Surface:** `ReviewersTab` fetches it and passes `declineReferrals` +
  `onAddReferral` to `ReviewerManagePanel`, which renders an amber callout at
  the top of the **Track Reviewers** sub-tab only.
- **One-click "Add as candidate" (in-place, S354):** does NOT bypass identity
  resolution. The button POSTs the suggested name + decliner straight to
  `/api/workbench/manual-reviewer` (no `resolution`) and stays on Track
  Reviewers; the server resolves identity itself (`addManualReviewer` →
  `lookupReviewerIdentity`). Three per-row outcomes, keyed by `suggestionId` in
  `ReviewersTab`'s `referralActions` state and rendered inline by
  `ReviewerManagePanel` (`ReferralAction`/`ReferralConfirm`): **200** → the row
  shows "✓ Added" and the tab lands on **Invite Reviewers** where the new
  candidate appears (a bare name usually has no email, so it's added but not yet
  *sendable* until staff add one there); **409 + `lookup`** (ambiguous /
  conflict) → the row switches to an **inline identity-confirm picker** (staff
  pick the right existing person or "Add as new person" → re-POST with the
  chosen `resolution`), so a free-text suggestion never auto-resolves to a
  namesake (memory `project-reviewer-verify-fail-dangerous`); **other error**
  (incl. `applicant_excluded`) → inline message + "Try again". Lands `referred`
  provenance exactly as the S249 manual-referral path. Before S354 the button
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

**Auto-enrichment + restore:** `ReviewerSearchSection` fires `POST /api/workbench/enrich-recommended` automatically via `useEffect` as soon as the proposal is loaded, the stable proposal key is known, applicant `recommended` slots are ready, and the durable roster GET has completed. The effect gates on `recPhase === 'idle'`, `recRunningRef.current === false`, `rosterLoaded === true`, and no valid same-proposal applicant cache. The cache key is `doc.data.picked` (`library::folder::name`) passed as `proposalKey`; Blob URL is intentionally not used because `load-proposal` returns a random-suffixed URL on each load. On a same-file reload, the cache is valid only when every currently expected recommendation either has its exact canonical `suggestion:<suggestionId>` active/ineligible row for the same `enrichedProposalKey`, the current `applicantEnrichmentCacheVersion`, and a terminal gate result, or its canonical key is already terminal by staff action (`excluded`/`saved`). The roster GET returns canonical saved applicant keys separately as `savedKeys`; excluded candidates supply their canonical keys. Those terminal rows are subtracted from the expected set and filtered from fresh SSE results, so promotion/exclusion does not trigger perpetual reruns or make the candidate reappear. Legacy, unversioned, older-version, or unrelated terminal rows cannot hide a missing expected row, and a partial non-terminal canonical batch still invalidates the cache. Active rows restore into the candidate list while ineligible rows restore into the separate Not eligible section. Every completed non-empty batch offers **Update applicant suggestions**, which explicitly reruns enrichment even when the cache is valid; the rerun preserves actor-bound staff confirmations instead of replacing them with automated output. Re-picking a different proposal changes `proposalKey`, so the old rows do not satisfy the cache gate and enrichment re-runs. The enrichment route reads by `wmkf_applicantdisposition=Recommended`, not by `wmkf_selected`, so unpromoted applicant rows are still verified and surfaced for review.

**Unified candidate list:** Enriched applicant candidates (`recCandidates`) are prepended into `displayCandidates` so fresh enrichment wins over stale roster copies. Candidates with a resolved identity surface in the `applicant_suggested` provenance section — which appears after `cited_or_proposal_named` and `literature_retrieved` in that order — via `provenanceGroupOf` detecting `isApplicantRecommended: true` → `APPLICANT_SUGGESTED` kind. **Exception:** candidates where enrichment could not confirm identity (`needsIdentification: true`, typically when the applicant provided no affiliation) route to `needs_identity_review` instead — `provenanceGroupOf` checks `needsIdentification` before `APPLICANT_SUGGESTED` (reviewer-provenance.js:228 vs :231). The `applicant_suggested` section is selectable unless normal safety gates make a row read-only; selecting it calls `POST /api/workbench/promote-applicant-reviewer` with the existing `suggestionId` instead of `save-candidates`.

**Roster persistence:** `/api/workbench/enrich-recommended` snapshots each canonical suggestion row and its roster `updated_at`, stamps each final applicant-enriched row with `enrichedProposalKey` and the current `applicantEnrichmentCacheVersion`, prunes it through `pruneCandidateForRoster`, and records it in `reviewer_find_roster` via concurrency-guarded `recordSurfaced`: ordinary rows are `active`; direct official deceased evidence is `ineligible`. Incrementing `APPLICANT_ENRICHMENT_CACHE_VERSION` makes older roster JSON refresh once under the new enrichment semantics; the successful refresh persists the new version and restores normal cache reuse. The applicant final-coherence gate uses the current-run PubMed/ORCID verification institution when available and falls back to the applicant/stored institution only when it is absent; this permits legitimate moves without allowing a stored stale affiliation to self-confirm a later namesake substitution. The prune carries bounded `staffIdentityConfirmation` and `manualContactFields` so a rerun does not erase an actor-bound confirmation. Browser-authored roster POST/exclude/saved paths strip client-supplied authority, then one bounded request/candidate-key read carries forward only a genuine stored confirmation and its canonical manual contact; applicant mutations re-read the full server row. If a row is confirmed, excluded, saved, or otherwise updated after the snapshot, the stale enrichment write affects zero rows and leaves the newer/terminal state intact; a suggestion with no row at snapshot can still insert. Deceased rows skip Dataverse contact/identity/metric writeback, render only in the Not eligible section, and remain in cross-run dedup. `suggestionId` is part of the pruned DTO because the promotion path needs the existing Dataverse junction row. Excluding an applicant row removes it from `recCandidates` and the active roster; promoting one marks its canonical roster key `saved` so it does not restore after reload.

**Explicit promotion:** `/api/workbench/promote-applicant-reviewer` validates `requestId` and `suggestionId` as GUIDs, reads the existing suggestion, checks ownership (`_wmkf_request_value`) and `wmkf_applicantdisposition=Recommended`, then requires the canonical request/`suggestion:<id>` roster row before flipping `wmkf_selected=true`; a missing row returns `identity_verification_required`, an unresolved row requires its matching server confirmation, and a known-deceased row returns `candidate_ineligible`, all before any lifecycle/contact write. Browser roster POST cannot mint applicant/suggestion rows; applicant exclude/saved/confirm actions re-read the canonical server blob so a client payload cannot replace identity or eligibility evidence. This avoids duplicate person upserts and bypasses the normal `save-candidates` COI path that intentionally excludes applicant-origin rows. **Persist hand-corrections (S306):** applicant-suggested is the lowest-trust input (no email / wrong-namesake is common), so the route now also carries the PD's `contact` corrections — but ONLY the fields the Find card marked manual (`candidate.manualContactFields`, set by `setManualContact`; `affiliationPersistAllowed`/`hIndex` are NOT manual signals — enrichment sets them too). For eligible/unknown rows it flips `selected` FIRST, THEN writes those fields to the suggestion's OWN `_wmkf_potentialreviewer_value` (never a client-supplied id), conflict-safe fields first + email isolated last, FORCING `emailSource:'manual'` server-side (don't trust a client source label — mirrors `save-candidates`' trust-boundary defense). A duplicate-email collision is NON-fatal: the row stays promoted and the route returns `partialSuccess` + a `contactError` so the now-promoted row resolves via the Invite-tab merge flow. Before S306 this route flipped `selected` only and silently dropped the correction — including PD identity-confirmed (`pdIdentityConfirmed`) rows, which route here by provenance kind (`provenanceKindOf`→`APPLICANT_SUGGESTED`), NOT to `save-candidates`. The contact write logic is duplicated from `my-candidates.js handlePatch` (shared-helper extraction deferred — refactoring the just-shipped my-candidates code carries more blast radius). **Backfill the vetted enrichment email (B1, S317):** even without a manual correction, an applicant reviewer could reach the Invite tab with an EMPTY `wmkf_emailaddress` — `enrich-recommended` discovers the email and writes it to the roster + `researcherAdapter.upsertByPotentialReviewer`, but that writeback has NO email param (`researcher.js:94` ignores identity email), so the address was never persisted to the person. Promote now, when no manual email was given, reads the roster candidate blob SERVER-SIDE by the canonical request/`suggestion:<id>` key (`reviewer-roster-store.findCandidateBySuggestion` — an exact id anchor, NEVER a normalized name, and never a client-supplied identity verdict) and persists the email through the SAME envelope `save-candidates` uses: only when enrichment marked it persistable (`emailPersistAllowed===true` — false on any identity/domain abstain) AND identity is resolved, ONLY when the person has no email yet (idempotent — a manual correction always wins), source FORCED to the roster's vetted provenance server-side (not `'manual'`). Duplicate-email collision stays non-fatal (same `contactError` path). Missing or legacy non-canonical rows fail promotion closed; there is never a name fallback. This is the cause-#1 "roster has email, Dataverse empty" fix for the applicant path. **Find save anchor (S317 follow-up):** Find-discovered rows enter `reviewer_find_roster` at search time before a Dataverse suggestion exists, so their pruned blob can have `suggestionId:null`. After `save-candidates` upserts the person and suggestion, it now best-effort stamps `suggestionId` + `potentialReviewerId` onto the matching `(request_id, candidate_key)` roster row; failure logs but does not fail the save. Existing legacy Find rows are handled by `scripts/backfill-reviewer-roster-suggestion-anchors.mjs`, which is dry-run by default and stamps only when exactly one selected suggestion on that request has the same normalized linked-person name. **Backstop (Fix A, S317):** the cron `/api/cron/reviewer-email-reconcile` → `lib/services/reviewer-email-reconciler.js` sweeps roster rows that already carry `candidate.suggestionId` (`reviewer-roster-store.findReconcilableCandidates`, gated by the shared `pickVettedEmail` + LIVE Dataverse reads): WRITEs an ownerless vetted email, REPOINTs to a single active keeper (guarded against `(person,request)` collision), or ALERTs (`reviewer_email_reconcile_needs_merge`) for ambiguous/inactive/colliding. It never falls back to reconcile-time name matching and does not loosen the `suggestionId IS NOT NULL` scan filter. `?dryRun=1`/`?maxBatch=N`. **B2 Find timeout partial-return (S317 follow-up):** `/api/reviewer-finder/enrich-contacts` now opts into `ContactEnrichmentService.enrichCandidates({ returnPartialOnAbort:true })`; when a deadline fires after at least one candidate completed, the route reruns its normal PI-institution COI recompute on the completed prefix and streams a normal `complete` frame with `partial:true` / `timeout:true` metadata. The existing client merge leaves missing candidates un-enriched, so completed contact/metrics can still flow into `save-candidates`. `/api/workbench/enrich-recommended` is intentionally not opted in and keeps fail-stop timeout behavior for its id-keyed writeback flow. Cause #2 (enrichment completed but no email surfaced) is resolved separately; see `docs/REVIEWER_EMAIL_PERSIST_FIX_PLAN.md`.

**Promotion eligibility safety (2026-07-19):** The request/suggestion-keyed roster read is a pre-mutation boundary. A known-deceased row returns `candidate_ineligible`; a roster read failure returns retryable `eligibility_unavailable` (503) before any lifecycle/contact write. Successful no-row reads retain legacy promotion behavior.

**Status card:** The bottom card below the search is a status/progress/error surface only — no candidate list or per-person verification control. It shows ingestion state, enrichment progress while running, a done summary ("N verified — see Applicant-suggested section above") with an **Update applicant suggestions** batch action, or an error with a "Try again" button.

**Publication count for applicant rows (S264):** Applicant-recommended reviewers skip PubMed/preprint discovery, so they carry no publications list and used to show a FALSE "0 publications" beside a real h-index. `enrich-recommended.js` now backfills `publicationCount5yr` from the OpenAlex author it already resolves for the metrics — `OpenAlexService.getWorksByAuthor(openAlexId, { yearFrom: year - DiscoveryService.YEARS_LOOKBACK, limit: 1 }).totalCount` (count-only query; same window as `DiscoveryService.countRecentPublications`). Gated on `blockScholar` like the other metrics (no count for an unconfirmed/wrong-person match); best-effort (a failure leaves it null). One extra OpenAlex call per applicant reviewer.

**"Scholar profile" vs "Scholar search" label (S266):** Enrichment populates `googleScholarUrl` with a Google Scholar *search* URL by default (`ContactEnrichmentService.buildGoogleScholarUrl` — OpenAlex exposes no Scholar `user=` id), so the card's label MUST NOT be a truthiness check on `googleScholarUrl` (that mislabels every enriched reviewer as having a "profile"). The label is gated on `isRealScholarProfileUrl(url)` (`lib/utils/scholar-url.js`) — true only for `scholar.google.com/citations?user=<id>`, false for `?view_op=search_authors&mauthors=…`. Applied at all three render/export sites (`ReviewerInvitePanel.js`, `ReviewerSearchSection.js` card + export). Today no flow produces a real `user=` profile URL for these reviewers, so they correctly read "Scholar search".

**Board-writeup identity edit (S308):** clicking a reviewer in the workbench opens `CandidateEditModal`, which now also edits three person-level confirmed fields — academic rank, primary department, main institution (saved-candidate edit mode only; hidden in the pre-save Find-card `onApply` + `confirmMode` paths). They PATCH `my-candidates` → `potentialReviewerAdapter.update` (server-derived `personId`, never client-supplied) → dedicated person columns (`wmkf_academicrank`/`wmkf_primarydepartment`/`wmkf_maininstitution`), emitted on the candidate DTO. These are first captured (required) at Stage 2a accept (see external-reviewer-portal topic). **Main-institution fallback (S310):** when `wmkf_maininstitution` is empty the modal prefills Main institution from the enrichment Affiliation (`mainInstitutionFallback` = `candidate.mainInstitution ‖ candidate.affiliation`), mirroring the reviewer accept-form prefill (`context.js buildStage2aPrefill`) so staff see the same value the reviewer will. The same fallback is the change-comparison baseline, so opening + saving never silently writes the affiliation into the dedicated column — only a genuine staff edit persists. (h-index was dropped from the modal S310 — auto-fetched, not staff-editable.) See reviewer-identity for the field rationale.

**Review history on the Invite card (S308):** the Invite-tab candidate DTO (`my-candidates` GET) carries `priorReviewCount` + `lastReviewAt`, derived (not stored) from `suggestionAdapter.aggregateReviewHistory(personIds)` — one batched query over `wmkf_appreviewersuggestion` filtered to received-only rows (`wmkf_reviewreceivedat ne null`) for the request's candidate person-ids. "Completed a review" = the reviewer's review was **received** (`wmkf_reviewreceivedat`), NOT the PD's closeout stamp (`wmkf_completedat`). `ReviewerInvitePanel` renders "reviewed N× · last <date>" only when `priorReviewCount > 0`. The aggregation is supplementary — its query failure is caught non-fatally in `my-candidates` (degrades to no history; never 500s the candidate list). Not yet surfaced on Track Reviewers (fast-follow).

**Terminal-status implementation authored; NOT LIVE until owner-gated provisioning and deliberate promotion.** The feature branch adds `withdrew` and `released` to the Track pipeline, excludes both from `MODE_WORK_REMAINING` and the Reviews-tab Outstanding list, and routes the visually distinct confirmed actions through `/api/review-manager/terminal-transition`. The service freshly reads each row, accepts only accepted/materials-sent/under-review rows with no received/completed stamp, and writes with that ETag; a concurrent submission therefore wins. Neither terminal value enters `updateLifecycle`'s strict `reviewStatus=complete` timestamp branch. Terminality is server-enforced in BOTH directions (owner resolution S369): the generic reviewers PATCH refuses a terminal *target*, and `updateLifecycle` refuses any status change on a row whose *source* is already terminal. Raw receipt writes bypass that adapter, so `lib/services/review-receipt-guard.js` now independently protects manual entry, mark-without-file, staff/self-token upload, and external submit: each rejects terminal/final/non-accepted rows and carries the authorizing read's ETag into its PATCH/changeset. Upload attempts use unique SharePoint subfolders; a losing race cleans up only its attempt and excludes item ids visible in the winner's persisted folder. Materials sends stamp TWO DateOnly columns: set-once `wmkf_reviewduedateatsend` (deadline first committed to) and every-send `wmkf_reviewduedatelastsent` (deadline last communicated), so a WMKF-initiated extension plus re-send cannot make a compliant reviewer look late. A failed post-dispatch stamp emits a 15-minute signed repair receipt binding the rendered date, dispatch timestamp, nonce, row/request, and pre-dispatch ETag. Repair idempotency is the exact HMAC-verified `(suggestionId, materialsSentAt, effectiveReviewDueDate)` tuple: an exact durable match returns `already_recorded`, an older receipt fails closed, and a newer signed dispatch advances `lastSent` under the row's fresh ETag while `atSend` remains set-once. The live production hazard remains until both Wave 14 DateOnly columns and the owner-gated picklist extension are provisioned and this branch is promoted. Owner goal and decisions: `.claude-memory/project-reviewer-reliability-data.md`.

**Export to Excel (S264; Invite-tab export + Expertise-tags column S308):** Two surfaces post to `POST /api/workbench/export-candidates`. (1) **Find tab** — a bottom-row "Export to Excel (N)" button (next to Save) exports the **selected** search candidates; (2) **Invite Reviewers tab** (`ReviewerInvitePanel`) — a header "⬇ Export to Excel" button exports the **full saved candidate list** (all non-removed rows on the tab; accepted/invited/declined included), mapping the persisted DTO into the same slim per-row shape. Both send a slim per-row DTO; the route fetches request metadata (number/institution/PI) authoritatively by `requestId` and streams back a two-sheet `.xlsx` (Request Info + Candidates). Column formatting (Source/Why/**Expertise tags**/Conflicts/ORCID/Scholar) lives in `lib/services/reviewer-candidate-export.js` so the sheet and the cards agree; the Expertise-tags column reads `keywords` (Find tab joins `expertiseAreas`; Invite tab uses the persisted `keywords`). Invite-tab exports carry only invite-stage fields — search-time COI / 5-yr-pub-count / seniority aren't persisted, so those columns read "None noted"/blank (board-writeup identity is captured at acceptance, not here). On the Find tab, `needs_identity_review` rows aren't selectable (so naturally excluded) UNLESS a PD used the S285 identity override ("✓ This is the right person") to confirm + add one, which makes it selectable and thus exportable. The "reviewer diversity"/temperature slider was removed the S264 cycle (search runs at the server default 0.3).

**Re-verify removed intentionally:** The "Re-verify" button was dropped because enrichment output is static within a cycle (COI computed against a fixed proposal author list; PubMed/Scholar data stable over weeks). The valid re-run use case is error recovery ("Try again"). Keep the general re-verify path retired; if a re-resolve-after-edit pattern is ever needed, see the Future Work section in `reviewer-identity.md`.

**Contact evidence and action policy (S267–S321; revised 2026-07-18):** `shared/components/reviewers/ContactLeads.js` renders quarantined `contactEnrichment.contactLeads` in `ReviewerSearchSection`'s `CandidateCard`, gated on `!identityUnverified` and deduped against the email + website chips. A manage-only "Use this email/page" promotes a lead as `manual`; manual addresses are `quick_check` and require the exact recipient's checkbox in `InviteEmailModal`. Search-derived addresses (`serp_search`, `claude_search`, `search_contested`) are `research_only`: visible for investigation, but render and send both refuse them for first-contact invitations, even if a caller supplies `confirmedLowConfidenceIds`. Identity-anchored NCBI PubMed + Europe PMC evidence runs before paid search: the same address on two distinct recent works is `ready` (`scholarly_multi`), one work is `quick_check` (`scholarly_single`), and tied addresses abstain. Candidate cards show the bounded publication evidence; `pruneCandidateForRoster` keeps the action/reason and a bounded evidence subset across reloads. The saved-candidate editor still routes duplicate-email 409s into `POST /api/reviewer-finder/merge-candidates`; conflict-safe fields can persist with `partialSuccess` before the isolated email write, and merge execution repoints or clears applicant reviewer slots before moving the address. See `docs/REVIEWER_MERGE_DESIGN.md` and `scripts/probe-akoya-potentialreviewer-slot-navprops.mjs`; hand-entered replacements are stamped `manual`. Contracts 3/7 in `docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md` own the current send and page-fetch gates.

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

**Phase 4 BUILT (2026-07-03) — pending prompt seed + first-submission verification:**
Executor-based AI synthesis of a proposal's submitted reviews. New Tier-1
prompt `review-synthesis.generate` (`shared/config/prompts/review-synthesis.js`,
create-only seed `scripts/seed-review-synthesis-prompt.js` — NOT yet run
against any environment); all-override, single untrusted variable
`reviews_digest` (reviewer `answerText`, never `answerHtml`, composed
server-side into a plain digest) so the Executor wraps it + injects the A7
preamble. Output is strict JSON (single output `synthesis`, `validationSchema`
bounds/strips the parsed shape) written to a new memo column
`akoya_request.wmkf_reviewsynthesisjson` with `guard: 'always-overwrite'` —
schema-as-code APPLIED TO PROD 2026-07-03 (column live-probed) from
`lib/dataverse/schema/wave11-review-synthesis/`. `POST
/api/review-manager/synthesize-reviews` (`requireAppAccess('review-manager',
'reviewers')`, requestId GUID-validated) returns 409 `no_submitted_reviews`
with zero submitted reviews (no LLM call); since the guard is
always-overwrite, regeneration gating is enforced at THIS route instead — 409
`already_exists` unless `overwrite: true` is passed. `GET
/api/review-manager/reviewers` now projects `proposal.reviewSynthesis`
(fail-soft JSON parse). `ReviewsTab` renders a Synthesis card (only when ≥1
review is submitted) with a Generate/Regenerate action, plain-text only (no
`dangerouslySetInnerHTML`); `composeReviewReport` accepts an optional
`synthesis` param rendered additively in both export formats. Same
verification boundary as Phases 2-3: unit-tested only until the prompt seed is
applied to an environment and a real review is synthesized.
Plan doc: `docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md`.

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
  - **Secure-link button label is stage-aware (S311).** The blue call-to-action button
    is generated at SEND time by `send-emails.js` (`reviewPortalButtonHtml`, triggered
    when a body contains a `/external/review/` URL) — NOT in the preview (`render-emails`
    leaves the raw link, so the PD preview shows the link, not the button). Its text is
    read per `templateType` from admin setting `email.reviewer_<type>.button_label`
    (`invitation`→"Respond to Invitation", `materials`→"Start Review", `followup`→"Go to
    Review"), seeded + editable in the same Email Defaults panel as subject/body.
    Admin-default only (NO per-PD override — the button is server-generated) and
    HTML-escaped at the interpolation site (S311 review — stored setting, not a literal).
    Blank/unavailable for a stage WITH a fallback → non-empty stage default in
    `send-emails.js` `DEFAULT_REVIEW_BUTTON_LABELS` (a button must never render empty),
    a deliberate contrast with subject/body's blank-renders-blank rule. A stage with NO
    fallback entry (`thankyou`) resolves to '' → the button is SUPPRESSED: if such a body
    ever contains a review link (the editor advertises `{{externalLink}}` for all types),
    it renders as a plain link, never a CTA button and never dropped (`plainTextToHtml`
    gates on `isExternalReviewUrl(url) && reviewButtonLabel`).
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
  templates keep their prior `failed[]` send semantics. Materials now stamps the exact rendered
  effective due date inline with `wmkf_materialssentat`, using the fresh row ETag; a failed write
  returns a per-recipient `sent_but_unrecorded` result and offers a no-resend repair action backed by
  a short-lived signed dispatch receipt. The first due-date field stays set-once while the separate
  last-sent field advances on every successfully recorded send/repair, including a render-time staff
  override. Followup/thankyou retain the post-loop stamp.
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
  applicant org). Timeline tokens are client-substituted and line-dropped by
  `applyTiming` (which keys on the literal "Review timeline:" header). The
  invitation modal loads timing in this order: built-in fallback, per-user sticky
  `reviewer_invite_timing`, admin cycle defaults, then request campaign config.

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
  extraction (`contact-enrichment-service.js:439-450`) never ran to completion.
  `save-candidates.js` now re-applies that extraction as a last step: if no email was captured
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
