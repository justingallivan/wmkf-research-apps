---
agent_wiki: topic
status: active
last_verified: 2026-10-22
verification_scope: "Inherited hub date; extraction integrity only, no claim or live-state recertification"
stale_after_days: 90
owner: reviewers
title: "Reviewer Activity History"
source_files:
  - shared/components/reviewers/ReviewerActivityDrawer.js
  - shared/components/reviewers/reviewer-activity-history.js
  - shared/components/reviewers/ReviewerManagePanel.js
  - lib/dataverse/adapters/reviewer-suggestion.js
canonical_docs:
  - docs/APPLICATION_STATE_ATLAS.md
  - docs/atlas/dataverse-wmkf-appreviewersuggestion.md
watch_paths:
  - shared/components/reviewers/ReviewerActivityDrawer.js
  - shared/components/reviewers/reviewer-activity-history.js
  - lib/dataverse/adapters/reviewer-suggestion.js
update_triggers:
  - "Activity history fields, event classification, or current-engagement scope changes"
  - "New activity consumers or provenance claims are proposed"
extracted_from: docs/agent-wiki/topics/reviewer-workbench-lifecycle.md
extraction_source_sha256: fdccedfe393f7ae7db7afa04b5b48297080b5c269290637bbf70e192f68888e7
extraction_segments:
  - "633-754"
  - "2099-2119"
---

# Reviewer Activity History

> The source page mixed current guidance with dated history and owner decisions; those distinctions are preserved in the extracts. The inherited `last_verified` date does not certify these claims anew. This pass verifies only extraction bounds and byte provenance, not runtime behavior, repository-wide drift, or live state.

<!-- source-lines: 633-754 -->
## Reviewer activity history — Phase 1 (PRODUCTION-LIVE, S419, PR #120)

Shipped and smoke-tested in Production on Request `1002959` — drawer, evidence caveat,
and neutral invitation wording all checked [VERIFIED via `DEVELOPMENT_LOG.md:32-46`].
The Phase 1 receipt-wording change was `19bd000a` (2026-08-12);
the later dated-release behavior is described below.

**Scope decision — this is operational convenience, not evidence (owner decision
2026-08-12).** The drawer exists so staff can see what happened recently on a reviewer
row. It is explicitly **not** an evidence surface and must not be cited to support
reviewer-reliability scoring, payment, or any decision that needs a provable claim.
Labels are therefore allowed to be imperfect where the underlying stamps are ambiguous,
which is what makes the neutral receipt wording below acceptable rather than a gap. If
anyone proposes feeding this data into a decision, the scope question re-opens first.

**Behavior change staff will notice:** Track Reviewers' **Last Action** column no
longer uses the fixed-precedence expression `thankyouSentAt || reviewReceivedAt ||
reminderSentAt || materialsSentAt`. It now shows the **chronologically newest** event
plus its label, with a **History** button opening a read-only drawer (owner decision
2026-08-12). Old behavior surfaced whichever stamp ranked highest, so a months-old
thank-you masked a reminder sent yesterday.

Derivation is pure and lives in
`shared/components/reviewers/reviewer-activity-history.js` (`buildActivityHistory` /
`latestActivity`); the drawer is `ReviewerActivityDrawer.js`. No schema, no route, no
backfill — every event is computed at read time from stamps already in the reviewer
DTO, and `reviewers-service.js` was widened to project five stamps that the entity
registry's `FIELD_SELECT` already fetched [VERIFIED via
`lib/dataverse/core/entity-registry.js:115-183`] (`wmkf_emailsentat`,
`wmkf_respondremindersentat`, `wmkf_responsereceivedat`, `wmkf_withdrawnsufficientat`,
`wmkf_completedat`).

**Standing hazard — the engagement-scope invariant.** The drawer tells staff its
history covers the CURRENT engagement only. That is true *only* because every field it
reads is a member of `ENGAGEMENT_STAMP_RESET_ENTRIES`
(`lib/dataverse/adapters/reviewer-suggestion.js:887-908`), which clears reset-member
stamps on remove/re-add. The request's `meetingDate` is a deliberate request-scoped
exception used only for no-response attribution; it is not a reset member. The
`wmkf_externaltokenrevoked` → `tokenRevoked` marker is a reset member and is preserved
in the DTO as tri-state evidence. Three tempting fields are deliberately EXCLUDED and
must not be added back without resolving the reason: `wmkf_coiackedat` and
`wmkf_aiuseackedat` have real writers but are **not** reset members, so a value may
belong to a prior engagement; `wmkf_heldat` has **no writer anywhere** in the repository (only ever nulled at
`reviewer-suggestion.js:1957`). Deadline extensions now use the paired
`wmkf_reviewduedateextensiongrantedat` current-engagement timestamp alongside the
DateOnly `wmkf_reviewduedateoverride`, so the history can place the extension on the
timeline without inferring a date from the deadline value. The invariant is
machine-enforced by `tests/unit/reviewer-activity-history.test.js`, which re-derives
the reset set from the adapter source rather than trusting a copied list.

**Second standing hazard — lifecycle stamp names are not proof of same-named events.**
`wmkf_responsereceivedat` has three live writers with different meanings:
external reviewer accept/decline, staff-recorded withdrawal, and the stale-invite cron
that writes `responseType=no_response` at cycle close. The activity history therefore
classifies the response event from `responseType` plus `reviewStatus`: accepted and
ordinary declined rows read as reviewer responses, and `declined` + `withdrew` reads as
staff-recorded withdrawal. No-response attribution uses direct evidence: token
revocation, a missing meeting date, or a pre-meeting stamp is staff-recorded; only a
dated post-meeting stamp on a non-revoked row is an automated cycle close; otherwise
the drawer stays neutral. The bare timestamp must not be treated as proof that a
reviewer responded. On Track, no-response rows appear in a dedicated history-only
group outside ordinary status buckets, counts, selection, and actions.

`wmkf_reviewreceivedat` alone still does not prove a portal submission. The
current source-built closeout contract requires an existing received-review
timestamp; `updateLifecycle` never fabricates one when setting Complete
**[VERIFIED via `lib/dataverse/adapters/reviewer-suggestion.js:1906-1926` at
`c51fa34d`; shipped in Production at `c19a16d8` per the
[release receipt](../../audits/REVIEWER_LIFECYCLE_RELEASE_2026-09-05.md)]**. Historical rows can retain equal receipt and
completion timestamps from the older closeout behavior. The drawer retains
`isSyntheticReceipt` as a legacy-data display heuristic: it returns true when
both timestamps parse and are equal, and `reviewReceiptEvidence` labels that
case “Review recorded at close-out” with an unproven note **[VERIFIED via
`shared/components/reviewers/reviewer-activity-history.js:205-253`]**. Equal
stamps alone do not establish the historical writer or submission provenance.

**`reviewFilename`, `answers`, and `reviewUploadedByStaff` must never be used to
strengthen an event's provenance** [VERIFIED via
`shared/components/reviewers/reviewer-activity-history.js:207-213`, 2026-08-12]. An
earlier version treated a filename or answer rows as independent proof of a genuine
submission, and had a separate staff-attestation path keyed on
`reviewUploadedByStaff=true`. Both were removed in `19bd000a`: none of those three
fields is a member of `ENGAGEMENT_STAMP_RESET_ENTRIES` — the list is 20 entries and
carries no `wmkf_reviewfilename`, `wmkf_reviewuploadedbystaff`, or
`wmkf_reviewsharepointfolder`, and clears no answer child rows [VERIFIED by enumerating
the full list, `lib/dataverse/adapters/reviewer-suggestion.js:887-908`, 2026-08-12]. So
a remove/re-add carries them forward and a stale file from a prior engagement would
defeat the guard. The consequence
is deliberate and accepted under the convenience scope above — there is now **no
engagement-scoped way in this drawer to affirmatively prove a genuine portal submission**;
the equal-stamp heuristic flags possible legacy closeout ambiguity, so the
proven-receipt label was softened to the neutral "Review receipt recorded".

Found by Codex adversarial review 2026-08-12 against a first version that classified
every receipt as proven; the general lesson is that **the actor who owns an event is not
a safe guide to whether it happened — only the write path is.**

Evidence wording follows the Opus review's claim-vs-send split plus the later
write-path review: staff-side sends (invitation, reminders, materials, thank-you) are
labeled "recorded" with a delivery-not-confirmed caveat because those stamps survive a
failed dispatch; response stamps are classified from the current `responseType` plus
`reviewStatus`; receipt provenance stays deliberately neutral (above). Only genuine
reviewer-originated portal access and responses assert reviewer action.
**Last Action precedence — the undated header wins only when nothing dates the
transition.** The August 11–12 Phase 1 investigation found no timestamp writer
for `reviewStatus=released`; its undated-header rule remains the fallback for
legacy released rows without a parseable release stamp. Since the September 16
accepted-release implementation (`1abc097a8`), `applyStaffReviewerRelease` writes
`wmkf_withdrawnsufficientat`, and `buildActivityHistory` renders it as
“Released — sufficient reviews received” on a released row. Current
`terminalStatusHasDatedEvent` recognizes that parseable stamp, so Last Action
uses the newest dated activity; it does not let an undated legacy release fall
back to a stale reminder. `withdrew` writes `wmkf_responsereceivedat` with the
status, preserving the dated “Withdrawal recorded by staff” event. **[VERIFIED
via the adapter writer and activity-history reader in current source,
2026-10-22; no hosted-state check.]** The August Codex rounds 3/4 caught the
opposite overgeneralizations: always preferring dated activity concealed an
undated release, while always preferring a terminal header concealed a dated
withdrawal. Actor identity is absent by construction — the reviewer DTO carries
no acting-user field. Historical findings and Phase 2/3 gates:
`outputs/reviewer-activity-history-opus-review-2026-08-11.md`.

<!-- end-source-lines: 633-754 -->
<!-- source-lines: 2099-2119 -->
- **Reviewer follow-up polish (Codex worktree branch, merged `f0494607` + `d0a5fc07`, production
  2026-09-06).** Owner requested and approved the changes, including edits to the shared reviewer
  components used by both `/workbench/reviewer-follow-up` and the request page Reviewers tab.
  UI-only; no `pages/api` or `lib` change; API request shapes, the cycles/proposals stale-response
  guards, degraded mode, and preview read-only behavior unchanged. Durable behavior changes: (a) the
  **Review Received** and **Complete** status badges link to the request's Reviews tab
  (`/workbench/<requestId>?tab=reviews`); (b) Materials Sent / Under Review badges, the Active token
  pill when first-access data exists, and the amber reminder-count pill open the existing in-page
  Activity history drawer; (c) the token pill and reminder count are hidden once a review is
  received or complete; (d) the primary action and overflow item **Close review** are renamed
  **Mark complete** and the closeout modal heading **Close reviewer** became **Mark reviewer
  complete** (the "closeout" vocabulary in code, docs, and `honorariumEligibility` is unchanged);
  (e) page-level spacing, toolbar alignment, a two-column metrics grid at narrow widths, a
  result-count line under search, a pulsing loading indicator, and the owner-set server-trouble
  error copy with the raw error as a details line. Brief and handoff:
  `docs/plans/REVIEWER_FOLLOW_UP_POLISH_CODEX_BRIEF_2026-09-06.md`,
  `docs/plans/REVIEWER_FOLLOW_UP_POLISH_HANDOFF_2026-09-06.md`. **Open product to-do:** the
  reviewer record stores only cumulative `reminderCount` plus the latest `reminderSentAt`, so the
  drawer shows the latest reminder and "N reminders recorded in total"; a per-reminder audit trail
  plus an activity DTO projection needs its own `/contract-reconcile` plan before build. Do not read
  `reminderCount` as evidence of individual reminder timestamps.
<!-- end-source-lines: 2099-2119 -->
