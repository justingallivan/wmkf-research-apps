---
agent_wiki: topic
status: active
last_verified: 2026-07-01
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
  - shared/components/reviewers/ReviewerFindPanel.js
  - shared/components/reviewers/ReviewerSearchSection.js
  - shared/components/reviewers/ReviewerManagePanel.js
  - shared/components/reviewers/reviewer-search-logic.js
  - pages/api/reviewer-finder/my-candidates.js
  - pages/api/reviewer-finder/save-candidates.js
  - pages/api/workbench/enrich-recommended.js
  - pages/api/workbench/applicant-reviewers.js
  - pages/api/workbench/promote-applicant-reviewer.js
  - pages/api/workbench/export-candidates.js
  - lib/services/reviewer-candidate-export.js
  - lib/services/reviewer-roster-store.js
canonical_docs:
  - docs/APPLICATION_STATE_ATLAS.md
  - docs/atlas/postgres-reviewer-find-roster.md
  - docs/atlas/dataverse-wmkf-potentialreviewers.md
  - docs/atlas/dataverse-wmkf-appreviewersuggestion.md
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

**Reviewer-engagement build (Model B):** spec is `docs/REVIEWER_ENGAGEMENT_SPEC.md`. The 9 backing Dataverse fields are **provisioned in prod (2026-06-21, wave `7-reviewer-engagement`)**. Per-request campaign config (offset/due-date/reminder toggles+leads/desired-count/quota-notified-at) lives on `akoya_request`; the per-reviewer fire-once respond-reminder marker `wmkf_respondremindersentat` lives on `wmkf_appreviewersuggestion`. **Phase 1 LIVE (S275):** the invite panel's respond-by is now a "days to respond" offset; `wmkf_respondoffsetdays` + `wmkf_reviewduedate` are written on first invite (`send-emails.js`) and edited via `/api/review-manager/campaign-config` (Reviewers-tab "Campaign settings"). **Phase 2 LIVE (S275):** per-recipient token TTL (`lib/external/reviewer-token-ttl.js` via `render-emails` — invitee/non-responder link caps at review-due+2d, accepted gets review-due+90d, fallback now+90); accepted-only "Release to reviewers" materials send (server-gated in `send-emails`, plus a one-click button on the **Track Reviewers** sub-tab, `ReviewerManagePanel.js`); and a `materials_not_sent` upload guard (`review-upload.js` self-token path → 403). **Phase 3 LIVE (S275):** `/api/cron/reviewer-reminders` (daily) sends two per-request opt-in reminders — respond-by (invited non-responders, deadline = emailSentAt + respondOffsetDays - lead, token-live, fire-once `wmkf_respondremindersentat`) and review-due (accepted/materials-sent/not-submitted, deadline = reviewDueDate - lead, fire-once via the existing `wmkf_remindersentat`). Both claim-before-send (If-Match) → at-most-once; the server `allowResend` re-mint clears the respond marker (the **manual "Re-invite already-invited" Invite-Reviewers-panel button (`ReviewerInvitePanel`) was removed S277** — the respond-by reminder is the nudge for invited non-responders; `allowResend` is retained only as the programmatic re-mint contract). Server-side render in `lib/external/reviewer-reminder-email.js`; service in `lib/services/reviewer-reminder-sweep.js`. **Phase 4 LIVE (S275):** quota → PD notify + selective decline. `lib/services/reviewer-quota.js` (called from `respond.js` AFTER the accept commits) notifies the lead PD once when the accepted count first reaches `wmkf_desiredcount` — concurrency-gated by a conditional null→set of `wmkf_quotanotifiedat` (If-Match). `POST /api/review-manager/withdraw-sufficient` (the **Invite Reviewers** tab's "Release as no longer needed") writes `withdrawn_sufficient` + `wmkf_withdrawnsufficientat` + clears `wmkf_respondremindersentat` on still-pending rows only (the §2.9 missing writer). **All four phases shipped.** See the two Atlas pages for the exact column list.

## Candidate removal + restore (Invite Reviewers tab "X")

The "X" on an Invite Reviewers panel (`ReviewerInvitePanel`) card is a **soft-delete**, not a UI-only dismiss: `DELETE /api/reviewer-finder/my-candidates` → `suggestionAdapter.softDelete(id, {alsoRevokeToken:true})` flips `wmkf_selected=false`, clears accepted/declined/responsetype/reviewstatus/heldat, and (if invited) sets `wmkf_externaltokenrevoked=true` — all in one atomic PATCH. The row is NOT hard-deleted; the person/contact is untouched. Removed candidates do **not** reappear in the Find tab (Find is ephemeral discovery + roster dedup; it never reads back persisted suggestion rows).

**Restore (S285):** removed candidates surface in a collapsible "Removed (N)" list at the bottom of the Candidates panel, each with a Restore button → `PATCH my-candidates {suggestionId, restore:true}` → `suggestionAdapter.restore` → `updateLifecycle({selected:true})`. Restore only re-selects; it does **not** un-revoke a revoked magic link (a re-invite mints a fresh token) and does not touch disposition or invite stamps. The Removed list is scoped to `wmkf_selected=false AND wmkf_applicantdisposition eq null` (`findRemovedByRequest`): discovered/manual candidates are always created `selected=true`, so `selected=false + disposition=null` is unambiguously "was curated, then X'd". Applicant-recommended rows (`disposition=recommended`) are deliberately excluded — they're recoverable from the Find tab's applicant-suggested section, and listing them here would conflate "never promoted" with "removed". Removed candidates ride the single-request GET path only (`removedCandidates` on `proposals[0]`), which is the scope the Candidates panel uses.

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

**Auto-enrichment + restore:** `ReviewerSearchSection` fires `POST /api/workbench/enrich-recommended` automatically via `useEffect` as soon as the proposal is loaded, the stable proposal key is known, applicant `recommended` slots are ready, and the durable roster GET has completed. No manual button click. The effect gates on `recPhase === 'idle'`, `recRunningRef.current === false`, `rosterLoaded === true`, and no valid same-proposal applicant cache. The cache key is `doc.data.picked` (`library::folder::name`) passed as `proposalKey`; Blob URL is intentionally not used because `load-proposal` returns a random-suffixed URL on each load. On a same-file reload, active applicant-origin roster rows stamped with the same `enrichedProposalKey` restore immediately and set the status card to done. Re-picking a different proposal changes `proposalKey`, so the old rows do not satisfy the cache gate and enrichment re-runs. The enrichment route reads by `wmkf_applicantdisposition=Recommended`, not by `wmkf_selected`, so unpromoted applicant rows are still verified and surfaced for review.

**Unified candidate list:** Enriched applicant candidates (`recCandidates`) are prepended into `displayCandidates` so fresh enrichment wins over stale roster copies. Candidates with a resolved identity surface in the `applicant_suggested` provenance section — which appears after `cited_or_proposal_named` and `literature_retrieved` in that order — via `provenanceGroupOf` detecting `isApplicantRecommended: true` → `APPLICANT_SUGGESTED` kind. **Exception:** candidates where enrichment could not confirm identity (`needsIdentification: true`, typically when the applicant provided no affiliation) route to `needs_identity_review` instead — `provenanceGroupOf` checks `needsIdentification` before `APPLICANT_SUGGESTED` (reviewer-provenance.js:228 vs :231). The `applicant_suggested` section is selectable unless normal safety gates make a row read-only; selecting it calls `POST /api/workbench/promote-applicant-reviewer` with the existing `suggestionId` instead of `save-candidates`.

**Roster persistence:** `/api/workbench/enrich-recommended` stamps each final applicant-enriched row with `enrichedProposalKey`, prunes it through `pruneCandidateForRoster`, and records it in `reviewer_find_roster` as `status=active` via `recordSurfaced`. `suggestionId` is part of the pruned DTO because the promotion path needs the existing Dataverse junction row. Excluding an applicant row removes it from `recCandidates` and the active roster; promoting one marks the roster name `saved` so it does not restore after reload.

**Explicit promotion:** `/api/workbench/promote-applicant-reviewer` validates `requestId` and `suggestionId` as GUIDs, reads the existing suggestion, checks ownership (`_wmkf_request_value`) and `wmkf_applicantdisposition=Recommended`, then flips `wmkf_selected=true` via `updateLifecycle`. This avoids duplicate person upserts and bypasses the normal `save-candidates` COI path that intentionally excludes applicant-origin rows. **Persist hand-corrections (S306):** applicant-suggested is the lowest-trust input (no email / wrong-namesake is common), so the route now also carries the PD's `contact` corrections — but ONLY the fields the Find card marked manual (`candidate.manualContactFields`, set by `setManualContact`; `affiliationPersistAllowed`/`hIndex` are NOT manual signals — enrichment sets them too). It flips `selected` FIRST (promotion is always valid), THEN writes those fields to the suggestion's OWN `_wmkf_potentialreviewer_value` (never a client-supplied id), conflict-safe fields first + email isolated last, FORCING `emailSource:'manual'` server-side (don't trust a client source label — mirrors `save-candidates`' trust-boundary defense). A duplicate-email collision is NON-fatal: the row stays promoted and the route returns `partialSuccess` + a `contactError` so the now-promoted row resolves via the Invite-tab merge flow. Before S306 this route flipped `selected` only and silently dropped the correction — including PD identity-confirmed (`pdIdentityConfirmed`) rows, which route here by provenance kind (`provenanceKindOf`→`APPLICANT_SUGGESTED`), NOT to `save-candidates`. The contact write logic is duplicated from `my-candidates.js handlePatch` (shared-helper extraction deferred — refactoring the just-shipped my-candidates code carries more blast radius).

**Status card:** The bottom card below the search is a status/progress/error surface only — no candidate list, no manual verify button. It shows ingestion state, enrichment progress while running, a done summary ("N verified — see Applicant-suggested section above"), or an error with a "Try again" button.

**Publication count for applicant rows (S264):** Applicant-recommended reviewers skip PubMed/preprint discovery, so they carry no publications list and used to show a FALSE "0 publications" beside a real h-index. `enrich-recommended.js` now backfills `publicationCount5yr` from the OpenAlex author it already resolves for the metrics — `OpenAlexService.getWorksByAuthor(openAlexId, { yearFrom: year - DiscoveryService.YEARS_LOOKBACK, limit: 1 }).totalCount` (count-only query; same window as `DiscoveryService.countRecentPublications`). Gated on `blockScholar` like the other metrics (no count for an unconfirmed/wrong-person match); best-effort (a failure leaves it null). One extra OpenAlex call per applicant reviewer.

**"Scholar profile" vs "Scholar search" label (S266):** Enrichment populates `googleScholarUrl` with a Google Scholar *search* URL by default (`ContactEnrichmentService.buildGoogleScholarUrl` — OpenAlex exposes no Scholar `user=` id), so the card's label MUST NOT be a truthiness check on `googleScholarUrl` (that mislabels every enriched reviewer as having a "profile"). The label is gated on `isRealScholarProfileUrl(url)` (`lib/utils/scholar-url.js`) — true only for `scholar.google.com/citations?user=<id>`, false for `?view_op=search_authors&mauthors=…`. Applied at all three render/export sites (`ReviewerInvitePanel.js`, `ReviewerSearchSection.js` card + export). Today no flow produces a real `user=` profile URL for these reviewers, so they correctly read "Scholar search".

**Board-writeup identity edit (S308):** clicking a reviewer in the workbench opens `CandidateEditModal`, which now also edits three person-level confirmed fields — academic rank, primary department, main institution (saved-candidate edit mode only; hidden in the pre-save Find-card `onApply` + `confirmMode` paths). They PATCH `my-candidates` → `potentialReviewerAdapter.update` (server-derived `personId`, never client-supplied) → dedicated person columns (`wmkf_academicrank`/`wmkf_primarydepartment`/`wmkf_maininstitution`), emitted on the candidate DTO. These are first captured (required) at Stage 2a accept (see external-reviewer-portal topic). **Main-institution fallback (S310):** when `wmkf_maininstitution` is empty the modal prefills Main institution from the enrichment Affiliation (`mainInstitutionFallback` = `candidate.mainInstitution ‖ candidate.affiliation`), mirroring the reviewer accept-form prefill (`context.js buildStage2aPrefill`) so staff see the same value the reviewer will. The same fallback is the change-comparison baseline, so opening + saving never silently writes the affiliation into the dedicated column — only a genuine staff edit persists. (h-index was dropped from the modal S310 — auto-fetched, not staff-editable.) See reviewer-identity for the field rationale.

**Review history on the Invite card (S308):** the Invite-tab candidate DTO (`my-candidates` GET) carries `priorReviewCount` + `lastReviewAt`, derived (not stored) from `suggestionAdapter.aggregateReviewHistory(personIds)` — one batched query over `wmkf_appreviewersuggestion` filtered to received-only rows (`wmkf_reviewreceivedat ne null`) for the request's candidate person-ids. "Completed a review" = the reviewer's review was **received** (`wmkf_reviewreceivedat`), NOT the PD's closeout stamp (`wmkf_completedat`). `ReviewerInvitePanel` renders "reviewed N× · last <date>" only when `priorReviewCount > 0`. The aggregation is supplementary — its query failure is caught non-fatally in `my-candidates` (degrades to no history; never 500s the candidate list). Not yet surfaced on Track Reviewers (fast-follow).

**Export to Excel (S264; Invite-tab export + Expertise-tags column S308):** Two surfaces post to `POST /api/workbench/export-candidates`. (1) **Find tab** — a bottom-row "Export to Excel (N)" button (next to Save) exports the **selected** search candidates; (2) **Invite Reviewers tab** (`ReviewerInvitePanel`) — a header "⬇ Export to Excel" button exports the **full saved candidate list** (all non-removed rows on the tab; accepted/invited/declined included), mapping the persisted DTO into the same slim per-row shape. Both send a slim per-row DTO; the route fetches request metadata (number/institution/PI) authoritatively by `requestId` and streams back a two-sheet `.xlsx` (Request Info + Candidates). Column formatting (Source/Why/**Expertise tags**/Conflicts/ORCID/Scholar) lives in `lib/services/reviewer-candidate-export.js` so the sheet and the cards agree; the Expertise-tags column reads `keywords` (Find tab joins `expertiseAreas`; Invite tab uses the persisted `keywords`). Invite-tab exports carry only invite-stage fields — search-time COI / 5-yr-pub-count / seniority aren't persisted, so those columns read "None noted"/blank (board-writeup identity is captured at acceptance, not here). On the Find tab, `needs_identity_review` rows aren't selectable (so naturally excluded) UNLESS a PD used the S285 identity override ("✓ This is the right person") to confirm + add one, which makes it selectable and thus exportable. The "reviewer diversity"/temperature slider was removed the S264 cycle (search runs at the server default 0.3).

**Re-verify removed intentionally:** The "Re-verify" button was dropped because enrichment output is static within a cycle (COI computed against a fixed proposal author list; PubMed/Scholar data stable over weeks). The valid re-run use case is error recovery ("Try again"). Keep the general re-verify path retired; if a re-resolve-after-edit pattern is ever needed, see the Future Work section in `reviewer-identity.md`.

**Contact leads (S267, Slices 3–5):** `shared/components/reviewers/ContactLeads.js` renders the quarantined `contactEnrichment.contactLeads` (Slice 2a) in `ReviewerSearchSection`'s `CandidateCard`, gated on `!identityUnverified` (NOT `!email` — promoting one field must not hide the other still-unfixed leads; the component self-hides when empty and resolved candidates carry no leads) and deduped against the email + website chips — high/medium prominent, low/rejected behind a "Show N weak / rejected leads" toggle with the not-auto-used reason. **Slice 4 promotion:** a manage-only `onUse` ("Use this email"/"Use this page", gated on `canManage`) calls `ReviewerSearchSection.useLead`, which stamps `emailSource:'manual'`, clears the contact-layer abstain (e.g. `verified_domain_contradiction`) so save persists it, and auto-selects the row; `emailConfidence` (`reviewer-invite.js`) classifies `manual` as LOW so the invite still requires confirm-before-send. **Slice 5 persistence:** `pruneContactLeads` + `pruneCandidateForRoster` persist a compact bounded (≤8) payload-free leads array, so the section survives a roster reload (`mergeEnrichment` already keeps it on live rows via full spread). No Dataverse change. **On-card manual edit (follow-up):** a manage-only "✏️ Edit contact" opens `CandidateEditModal` in local mode (`onApply` prop instead of the saved-row PATCH); `ReviewerSearchSection.setManualContact` applies the edit to client state — email/website stamped `manual` (low-confidence invite), Name locked (the card is name-keyed), auto-selects. The same `setManualContact` backs the lead promotion (`useLead` wraps it). The saved-candidates `ReviewerInvitePanel` editor — the **Invite Reviewers** sub-tab (`ReviewersTab.js:42`; file renamed `CandidatesPanel.js`→`ReviewerInvitePanel.js` S291, header text fixed from legacy "Candidates" to "Invite Reviewers" S290) — keeps full PATCH-mode editing (incl. name), now surfaced via BOTH the clickable name AND an explicit "✏️ Edit contact" button mirroring the Find tab (S290), so staff don't have to discover the name is clickable. The invite checkbox is disabled for never-invited no-email rows (`c.accepted || (!c.email && !c.invited)`) and the Send set requires an email, so a doomed (server-skipped) invite can't be queued; already-invited rows stay selectable so they remain releasable. **Merge mode (S290, chunk 4):** when a saved-candidate email edit PATCH returns a duplicate-key 409 with `conflictingRecordId` (another `wmkf_potentialreviewers` row owns that email), the modal switches into a record-merge flow instead of dead-ending — keeper defaults to the edited record (Swap to flip), an orientation-aware field picker (email defaults to whichever side owns the conflict-target address), a blocked-reasons explainer when the loser isn't pre-engagement, and an orphan-detection recovery prompt if the email-move step tears (confirm 500 + the address now owned by neither side). **Partial-save on email collision (S306):** the saved-candidate PATCH (`my-candidates.js handlePatch`) now writes the conflict-SAFE fields (name/affiliation/website/h-index) FIRST and isolates the email write LAST — so a duplicate-email 409 leaves those edits committed instead of discarding everything the staffer typed (the prior atomic person-PATCH bundled email+affiliation, so a collision lost both, then the website/h-index write never ran). The 409 now returns `partialSuccess` + `savedFields`; `CandidateEditModal` shows a "Saved: …" note and routes any cancel through `refreshAndClose` so the card isn't left stale. `emailSource:'manual'` is stamped ONLY after the isolated email write lands. **Applicant-slot repoint (S307 — the `loser_in_applicant_slot` block was LIFTED):** the merge no longer blocks when the loser sits in an `akoya_request.wmkf_potentialreviewer1..5` applicant slot. `executeMerge` Step 5 repoints each loser slot to the keeper (`wmkf_PotentialReviewer<N>@odata.bind`), or CLEARS it via `DynamicsService.disassociate` ($ref delete) when the keeper would otherwise occupy two slots (already in a slot on that request, or the loser holds >1 slot — repoint the first, clear the rest); ordered after the suggestion reference work and before the email move/deactivate, with 412/409→retryable-replan / 404/400→hard-fail. Applicant provenance is preserved both ways: the authoritative slot is repointed, and a colliding junction row first transplants its applicant-recommended intent onto the keeper's surviving row (gated on `hasApplicantProvenance`, fail-closed `merge_applicant_provenance_conflict` if the keeper row is applicant-excluded) before the loser row is deleted. The S306 "use Swap" hint was removed (the reason code is no longer produced). Nav props verified live via `scripts/probe-akoya-potentialreviewer-slot-navprops.mjs`. Backend: `lib/services/reviewer-merge.js` + `POST /api/reviewer-finder/merge-candidates`. Spec: `docs/REVIEWER_MERGE_DESIGN.md`. Spec/status: `docs/REVIEWER_CONTACT_LEADS_SPEC.md`; produced in `contact-enrichment-service.js` (see reviewer-identity topic).

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
  `applyTiming` (which keys on the literal "Review timeline:" header).

## Operating Notes

- **Name-based dedup collapses reviewers who share a NORMALIZED name — a recurring "missing reviewers" trap (S312).**
  Two shared normalizers both lowercase and strip everything non-alpha via
  `.replace(/[^a-z\s]/g, '')` — **which deletes digits**: `normalizeReviewerName`
  (`lib/utils/reviewer-name-match.js:33`) and `normalizeName`
  (`lib/utils/name-normalization.js:18`). That normalized key is the dedup identity
  everywhere reviewers are collapsed: the durable roster's unique index
  `(request_id, normalized_name)` (`lib/services/reviewer-roster-store.js:5,76,83` —
  computed via `normalizeReviewerName`; colliding rows upsert into ONE), display
  `dedupeByName` → `candKey` → `normalizeReviewerName` (`ReviewerSearchSection.js:94,100`),
  the `/discover` server dedup, and `DeduplicationService` (`deduplication-service.js:112`,
  its own copy of the same regex). Consequences to watch for when "not all reviewers
  show" in the Find tab: (a) **test data** — names differing only by a trailing digit
  (`tester2/3/4/5 testing` → all normalize to `tester testing`) collapse to one row;
  use alphabetically-distinct test names. (b) **real same-name reviewers** — two
  genuine "John Smith"s collapse to one surfaced/rostered row. The underlying person
  records + `disposition=recommended` junction rows are NOT lost — the collapse is only
  in the dedup/roster surface. A real fix (dedup on name + an identity anchor like
  ORCID/email rather than name alone) is a larger design change; the digit-strip itself
  is load-bearing (stable keying for the roster unique index, the person
  `normalizedName` column written at `enrich-recommended.js:404`, and excluded-name
  matching) — do not casually change it.
- **Editing/renaming an applicant reviewer after the FIRST enrichment silently won't reflect — the durable roster cache blocks re-enrichment (S312).**
  Auto-enrichment of applicant-recommended reviewers is cache-gated:
  `hasValidApplicantEnrichmentCache` (`shared/components/reviewers/reviewer-search-logic.js:123`)
  returns true if ANY active roster row for this request carries
  `enrichedProposalKey === proposalKey` and `isApplicantRecommended`, and the effect
  then short-circuits to `recPhase='done'` WITHOUT re-running enrichment
  (`ReviewerSearchSection.js:805-808`). Because the roster is durable Postgres
  (`reviewer_find_roster`, keyed `(request_id, normalized_name)`), once a PD has
  enriched once, later fixes to the underlying `wmkf_potentialreviewerses` person
  records — renames, added affiliation/email — are NEVER re-surfaced: the finder keeps
  serving the stale cached rows. There is no UI to force a re-run (the cache reads
  "done", so the error-only "Try again" button never appears). This is what makes the
  digit-collapse above un-self-healing: renaming the colliding people didn't help until
  the stale rows were cleared. Manual fix (prod Postgres write): delete this request's
  applicant rows so the cache invalidates and the next Find-tab load re-enriches —
  `DELETE FROM reviewer_find_roster WHERE request_id = '<akoya_requestid>' AND
  source_kind = 'applicant_suggested';` (leaves the legit proposal_named /
  literature_retrieved search rows intact). Real fix (backlog): invalidate or re-enrich
  applicant roster rows when the source person record changes, or expose a manual
  "re-enrich recommended" control.
- Roster reload must preserve fields that keep deferred/unresolved/conflicted rows non-selectable.
- Cross-run dedup is durable; do not casually drop carryover.
- Reviewer removal/reset behavior often spans UI state, roster store, and Dataverse suggestion state.
- Applicant-suggested rows are persisted as `disposition=recommended` but are **not** in the candidate pool until `wmkf_selected=true`; keep the promotion route as the only UI save path for these rows.
- The auto-enrichment effect depends on `proposalKey`, not just `blobUrl`: same-key applicant-origin roster rows are a valid restore cache, but a null key is never a cache hit and a different key must re-enrich. Be careful if adding new proposal-load effects that they do not treat the random-suffixed Blob URL as durable identity.

## Standard Probe

```bash
rg -n "pruneCandidateForRoster|saveCandidates|my-candidates|referral|referred|excluded|reset-request-reviewers|enrichRecommended|recPhase|applicant_suggested" pages shared lib scripts tests docs
```
