---
title: "Scheduled email: VIP review and digest design"
domain: email
kind: plan
status: active
summary: "Owner-settled scheduled-email redesign: automatic labeled sends, per-PD VIP recipient flags, digest as single interface, explicit rollout onboarding."
canonical: false
cataloged: 2026-08-26
owner: product-engineering
related:
  - docs/SCHEDULED_PERSONALIZED_EMAIL_P0.md
  - docs/GRANTEE_PORTAL_SPEC.md
  - docs/atlas/postgres-infra-tables.md
---

# Scheduled email: VIP review and digest design

## Status

**OWNER-SETTLED DESIGN 2026-08-26; SOURCE-BUILT SAME DAY on branch
`codex/scheduled-email-review-p0` (commit `417774f`); adversarially reviewed
and all three findings fixed same day (digest run ledger + PD handoff
rebuild — see "Adversarial review outcome" below); migration 036 APPLIED
to the shared Neon database 2026-08-26 [VERIFIED via read-only probe:
tracker row 036_scheduled_email_messages.sql + all three tables exist];
MERGED TO MAIN 2026-08-26 22:00 UTC (merge `4a743d63`, auto-deploy in
flight at write time) — first new-code cron tick 08:00 UTC 2026-08-27; PD
onboarding must complete inside that window per the rollout checklist.** One scope note against Decision 5: the Reviewers/Invite
Reviewers panel toggle is deferred to the reviewer-workflow slice — reviewer
rows key on `wmkf_potentialreviewers`, the flag store keys on contact, and no
ledger workflow reads reviewer flags yet, so a toggle there would write state
nothing consumes. The built toggles are the Awardee tab and the
`/scheduled-emails` inbox; the principle stands and the reviewer placement
activates with its workflow. This document supersedes the
decision layer of `docs/SCHEDULED_PERSONALIZED_EMAIL_P0.md` (per-PD
automatic/review modes, per-message notifications, Profile Settings card,
global nav item). The P0 document remains the implementation record for the
durable ledger, review actions, send recovery, and disclosure rendering,
which carry over under this design.

## Owner decisions (settled 2026-08-25/26)

1. **Automatic sending is the default behavior.** Routine automated mail
   sends without review. Owner experience: nearly all previewed emails
   required no change, so blanket review was almost entirely wasted effort.
2. **Sends remain personalized.** Mail goes out from the assigned PD's own
   address, so external replies reach that human directly; every automated
   message carries the disclosure that it was sent automatically on the PD's
   behalf and where replies go. (Both built in P0 — [RECHECKED after
   lib/services/scheduled-email-service.js change:
   `from: message.pd_email` at lib/services/scheduled-email-service.js:268;
   lib/external/automated-email-notice.js `buildAutomatedEmailNotice`].)
3. **Review is triggered by the recipient, not the sender.** A VIP flag
   marks recipients whose mail waits for explicit PD approval before
   sending. Review by exception, not by policy.
4. **The VIP flag is per (PD, contact) pair.** One PD's first-name
   relationship with a contact says nothing about another PD's. On request
   handoff, VIP review deliberately does NOT transfer; the new PD flags the
   contact themselves if they want review.
5. **Flag them where you see them.** The flag toggle renders in-context on
   every working surface where a mail-receiving person appears: reviewer
   rows on the Workbench Reviewers/Invite Reviewers panels, PI/liaison
   recipients on the Awardee tab, and reactively from a draft in the
   scheduled-emails inbox and the digest. Each surface shows only its own
   population. There is no standalone VIP management screen; flagging is
   in-context by principle (no preemptive contact-browsing UI).
6. **A per-PD "review everything" override remains available** for a PD who
   wants to see all their automated mail regardless of VIP flags. Coarse,
   cheap to honor at ≤6 PDs.
7. **The digest is the single interface.** Per-message notification email is
   removed. One digest email per PD, sections ordered by urgency: "waiting
   on your approval" (VIP-bound drafts), "sending soon unless you act",
   and "sent on your behalf" (passive FYI). Action links deep-link into the
   authenticated `/scheduled-emails` page; no signed one-click action tokens
   in email — the server keeps owning all send decisions.
8. **Digest cadence is daily, only-when-nonempty.** At current volume this
   is self-limiting (most days produce no digest). Revisit only if volume
   makes daily digests noisy.
9. **Onboarding is a rollout precondition, not a runtime state.** The code
   has no "unconfigured PD" concept and no hold/compatibility path. Before
   the cron is enabled, the admin walks each PD (at most 6, ever) through
   the feature and seeds their override/VIP state. A later-hired PD is
   onboarded as part of PD setup. This guarantee is procedural and lives in
   the rollout checklist below.
10. **Miss asymmetry is an accepted trade.** Mail to a non-VIP recipient
    sends with no human review. A template bug or stale context that blanket
    review might have caught will go out. Accepted mitigations: the pre-send
    eligibility re-check, the automation disclosure on every message, and
    replies routing to the PD, who can correct in one email. **A single miss
    does not reopen blanket review** — reopening per-PD review of all mail
    requires a new owner decision, not an incident reaction.

## Interaction model

A PD's entire steady-state interaction: receive a digest → act on it or
ignore it. VIP-bound drafts wait for approval in the inbox; everything else
sends on schedule and is FYI'd afterward. The VIP list is curated in the
flow of normal work (Workbench tabs, inbox, digest), never in a settings
panel.

Removed from the P0 build: the Profile Settings "Automatic Email Review"
card, the global "Scheduled Emails" nav item (the inbox remains as the
digest's deep-link target), and the per-message review notification.

## Carry-over from the P0 branch

These mechanisms survive the rebuild (their host files were rewritten
2026-08-26 for the decision layer, the mechanisms carried over): the
`scheduled_email_messages` ledger and leases
(`lib/services/scheduled-email-store.js`
[RECHECKED after lib/services/scheduled-email-store.js change: `locked_until` lease fences at lines 88, 128, 146],
migration 036), edit /
approve / stop / send-now actions and routes
(`pages/api/scheduled-emails/`), send recovery and Dynamics correlation,
Dataverse finalization (`lib/services/scheduled-email-service.js`
[RECHECKED after lib/services/scheduled-email-service.js change:
`correlationKey` at lib/services/scheduled-email-service.js:71,
`finalizeScheduledEmail` at lib/services/scheduled-email-service.js:214]),
disclosure rendering and the legacy-marker stripper
(`lib/external/automated-email-notice.js`), and the `/scheduled-emails`
inbox page.

Rebuilt or new ([BUILT 2026-08-26 on the branch]): the preference layer
(per-PD mode became the `{ reviewAll }` override; `scheduled_email_vip_flags`
per (PD, contact) with the indexed `filterVipFlaggedContacts` lookup), the
fail-closed due-send guard (the store claim refuses an unapproved
approval-required row; PD send-now is the only bypass), the digest builder
(replacing the removed `notifyScheduledEmailReview` and its notification
columns), and the in-context flag toggles (Awardee tab + inbox; Reviewers
panel deferred per Status).

## Adversarial review outcome (2026-08-26, Codex; all three findings fixed same day)

An owner-invoked Codex adversarial review of the branch returned three
confirmed findings; the fixes are source-built on the branch:

1. **Digest retries could receipt FYIs the digest never contained** (high).
   Fixed by the `scheduled_email_digest_runs` ledger: `fyi_message_ids`
   freezes the rendered membership at first claim, and every stamp path
   stamps at most that membership — a row sent after today's digest stays
   unreceipted and appears tomorrow. Accepted direction of error: a mid-run
   crash can repeat an FYI once; it can never drop one.
   [RECHECKED after lib/services/scheduled-email-service.js change: sendScheduledEmailDigest stamps parseRecipients(run.fyi_message_ids), never group.sentFyi]
2. **PD handoff left the former PD's mailbox and posture on unsent rows**
   (high; live concern — PD rotations planned). Fixed: the cron rebuilds an
   unsent row in place under the request's current PD (mailbox, name,
   signature, recipients, and the CURRENT PD's own review-all/VIP posture).
   **Deliberate product behavior:** the former PD's edits and any prior
   approval are discarded — a handed-off, previously-approved VIP draft
   re-enters the new PD's posture, which may be automatic. Reassignment
   mid-run (after the drift check, before that run's send) and rows deferred
   by a capped scan self-heal next run.
   **Transport-state residual (re-review 2026-08-26, fixed via Codex
   rescue):** a row whose Dynamics activity already exists (created, send
   failed) is NOT rebuilt — the deliver path prefers the retained activity
   and the correlation backstop is generation-blind, so a rebuild would send
   the former PD's frozen content under the new PD's name. Such a row
   deliberately stays under the former PD until its retry resolves (honest
   attribution; same mail as a handoff one day later), and the cron reports
   `pd handoff deferred` in the summary failures list. The full
   cancel-and-regenerate path (generation-keyed correlation + a Dynamics
   cancel op the adapter does not have) is deliberately not built.
   [RECHECKED after lib/services/scheduled-email-store.js change: reassignScheduledEmail SQL guard — different PD + unsent + no transport state + unleased only]
3. **Digest creation was not concurrency-safe** (medium). Fixed by the same
   run ledger: the (PD, day) primary key plus lease is claimed before any
   Dynamics work; a losing invocation skips without sending or stamping. The
   Dynamics correlation key remains the crash backstop.

**Retention decision:** `scheduled_email_digest_runs` is deliberately
unbounded (≤6 PDs × ≤366 rows/PD/year); revisit only if PD count grows.

## Broader effort: reviewer email slices (owner direction, 2026-08-26)

The abstract reminder is deliberately the small pilot (1 To + 1 Cc, funded
grants only). The owner's stated volume reality: the vast majority of
outbound mail is reviewer solicitation and follow-up, and PDs differ in how
they want each handled. Owner decisions recorded so far for the next slices:

1. **The abstract flow merges and ships first** (done 2026-08-26, merge
   `4a743d63`); reviewer workflows follow as separate, more careful slices —
   the Foundation is mid-reviewer-cycle, so timing and blast radius matter.
2. **Reviewer invitations: VIP checkbox → editable preview.** A VIP-checked
   candidate brings up the editable preview window (like the current
   render-emails flow) before their invitation sends; non-VIP candidates
   batch-send without per-message click-through ("for people we don't know,
   there's generally no reason to click through and send multiple emails one
   at a time"). **SOURCE-BUILT 2026-08-26 on branch
   `feature/reviewer-invite-vip`** with three owner refinements: the preview
   is synchronous (whoever sends reviews VIP drafts in the modal — no hold,
   no digest); any review-manager staff may curate flags (stored per the
   request's lead PD in `scheduled_email_reviewer_vip_flags`, keyed on
   `wmkf_potentialreviewersid` since candidates lack contacts
   pre-acceptance); non-VIP drafts collapse to an expandable summary inside
   the modal (skipped/quick-check/edited/single-candidate drafts always
   render full). Two rounds of Codex adversarial review (2026-08-26) drove
   three fail-safe hardening fixes on the branch: VIP changes update the
   modal's snapshot optimistically and roll back on a failed PUT while every
   star is visibly disabled during the save; failed or timed-out flag loads
   remain fail-closed with an inline Retry path; and the dependency-free
   `lib/utils/invitation-link-validator.js` now owns the invitation-link
   contract across modal collapse, send withholding, and invitation-template
   save validation. A draft is collapsible/sendable only when it carries
   exactly one DISTINCT three-base64url-segment `/external/review/` token
   (repeated identical copies of the same link remain a tolerated input —
   button + plain-text fallback — and substitution replaces every copy),
   `externalLinkExpected` is true, and no unresolved `{{token}}` remains;
   trailing prose punctuation after the token is fine, but a fourth token
   segment or any malformed/unexpected reviewer path stays full and is
   withheld as `invalid_secure_link`, a linkless invitation is withheld as
   `missing_secure_link` regardless of expectation, and invitation-template
   saves require the literal `{{externalLink}}` placeholder
   [RECHECKED after lib/utils/invitation-link-validator.js change: identical-duplicate tolerance and prose-punctuation boundary restored in Claude's review pass, same day]. Accepted residual: a
   mid-session lead-PD reassignment on the same request leaves the loaded
   flag snapshot keyed to the old PD until the panel remounts — writes and
   sends always resolve the current PD server-side, so the worst case is a
   stale collapse decision, not a wrong write. Migration 037 APPLIED to the
   shared Neon database 2026-08-26 (owner-run apply-migrations; live-probed:
   tracker row + three columns + 0 rows). **Owner-run local smoke PASSED
   2026-08-27** (capture mode + same-day prod-write ack + local-only
   `EXTERNAL_LINK_SECRET`, three throwaway candidates): fail-closed Retry
   notice on a blocked flags GET, star toggle round-trip + persistence
   across reload, VIP and quick-check drafts full while the standard draft
   collapsed, and a send that captured all three — including the
   still-collapsed draft — proving collapse is view-state only. Merged to
   main 2026-08-27 (`dc46fa18`), production deployment Ready. The UX polish
   noted during the smoke — the full card didn't show WHY it's full — was
   built S463 on `feature/email-hygiene-small-items`: a "★ VIP" badge on the
   card header for VIP-flagged people only (not vipUnknown, not
   quick-check).
   [RECHECKED after lib/services/scheduled-email-store.js change: reviewer VIP flag helpers added 2026-08-26, contact-flag and ledger functions untouched]
3. **Per-PD, per-email-type preferences** are the working direction (the
   single `{ reviewAll }` override generalizes), with the digest remaining
   the single interface.

Detailed planning for these slices has not started; the full outbound-email
inventory (18 types; triggers, sender identities, controls, notice and
noFallback coverage) was compiled 2026-08-26 and should seed that plan.

### Reviewer cron-reminders slice — owner decisions (2026-08-27, S463)

Scope and shape settled with the owner; build not started:

1. **Both cron reminder types** (respond-by and review-due,
   `reviewer-reminder-sweep.js`) route through the ledger + digest decision
   layer. **Thank-yous stay on the direct send path** — post-submission,
   low-stakes.
2. **Per-message approval unit.** The recorded batch-unit decision (Broader
   effort decision 2 context) applies to solicitation only; each cron
   reminder has its own deadline, so ledger rows are per reminder.
3. `approval_required` = PD review-all override OR
   `filterVipFlaggedReviewers` hit (the helper's first caller). Reviewer VIP
   flags are curated on the invite roster at invitation time, so posture
   naturally exists before reminder rows are created — the abstract slice's
   freeze-at-creation sequencing trap is structurally smaller here, but the
   freeze-at-creation semantics themselves carry over unchanged.
4. Send-time eligibility recheck reuses the shared refusal predicates
   (`respondRefusalReason` / `reviewDueRefusalReason`,
   `reviewer-manual-reminder.js`); token minting stays at delivery time
   (expiry windows + revocation), never at row creation.
5. Requires a migration extending the ledger `workflow_type` CHECK
   (036 locks it to `grantee_abstract_reminder`) and a reviewer-shaped
   source reference (suggestion id as `source_record_id`).
6. Manual "send reminder now" coexists: it stamps the same markers; a queued
   ledger row must observe a manual send (cancel/reschedule, no double
   nudge) — design detail for build time.
7. Timing: ships during the between-cycles quiet period so it governs the
   NEXT cycle's reminders from first invitation; current-cycle reminders
   continue on the direct path.

## Rollout checklist (procedural guarantees)

1. Admin onboards every active PD and seeds their override/VIP state
   BEFORE enabling the cron (Decision 9).
2. Apply the schema migration(s) for the VIP flag store; probe live.
3. First digest cycle observed with a test PD before real recipients.

## Implementation questions (resolved 2026-08-26 at build time)

- VIP flag storage: Postgres `scheduled_email_vip_flags` in migration 036
  alongside the ledger, primary key (pd_systemuser_id, contact_id) — the
  cron's indexed is-flagged lookup is `filterVipFlaggedContacts` in
  `lib/services/scheduled-email-store.js`
  [RECHECKED after lib/services/scheduled-email-store.js change: exported at line 468].
- The digest is generated by the existing daily reminders cron
  (`lib/services/cron/grantee-deliverable-reminders-service.js`), one digest
  per PD per UTC day, claimed through the `scheduled_email_digest_runs`
  ledger (lease + frozen FYI membership; the Dynamics correlation key is the
  crash backstop); sent-FYI rows are receipted via `digest_fyi_at` from the
  run's frozen membership only.
  [RECHECKED after lib/services/cron/grantee-deliverable-reminders-service.js change: digest loop unchanged, drift rebuild added before it 2026-08-26]
- The review-all override (Decision 6) is set from a toggle on the
  `/scheduled-emails` inbox page through the authenticated
  `/api/email-automation-preferences` route, value shape
  `{ reviewAll: boolean }` (redefined freely — no old-shape values were ever
  deployed).

## Preference-matrix slice — draft plan (2026-08-27, S464) [PLANNED — awaiting owner sign-off]

Generalizes Broader-effort decision 3 (per-PD, per-email-type preferences)
into a concrete design. Storage was UNBLOCKED S463: `wmkf_preferencevalue`
is Memo/100,000 [VERIFIED via owner-authorized read-only probe, recorded in
SESSION_PROMPT.md "Probe Results" 2026-08-27, commit `991209f0`],
so the richer JSON fits in the column the `email_automation` preference
already uses. No code exists for this slice; everything below is design.

### Shape: additive per-type overrides, no data migration

The stored preference grows one optional key:

```json
{ "reviewAll": false, "perType": { "reviewer_respond_reminder": true } }
```

- **Effective posture for a type** = `perType[workflowType] ?? reviewAll`.
  `true` means every message of that type waits for approval; `false` means
  VIP-flag review only. The VIP layer beneath is untouched (Decision 3), and
  PD send-now remains the only bypass of an unapproved approval-required row.
- **Absence semantics unchanged**: a missing preference row still returns
  `null` → system default (VIP-only review); onboarding remains a rollout
  precondition, never a runtime compatibility state (Decision 9).
- **Backward compatible by construction**: every deployed `{ reviewAll }`
  value and the current toggle's PUT body remain valid. `normalize` accepts
  `perType` when present (each key a known workflow type, each value
  boolean; unknown keys reject — fail closed, matching the reader's
  malformed-state throw in `lib/services/email-automation-preferences.js`).
  `serialize` canonicalizes (omits an empty `perType`). No stored-value
  migration and no Dataverse schema work.

### Type axis = ledger `workflow_type`, not the 18-type inventory

Only ledgered types consult approval at all, so matrix keys are exactly the
`workflow_type` CHECK values. At launch (post-merge of the parked slice):
`grantee_abstract_reminder`, `reviewer_respond_reminder`,
`reviewer_reviewdue_reminder` (migration 038's CHECK on the parked branch).
Excluded by standing owner decisions: thank-yous stay on the direct path
(cron-reminders decision 1); staff-triggered sent-as-me mail (inventory
#1/#7/#8/#11/#12) is the separate open "async PD approval" Broader-effort
item — when such a type is later ledgered, it joins the matrix by gaining a
`workflow_type`, with no contract change.

A parity test must hold the three lists together: the shared type list in
`shared/config/emailAutomation.js`, the migration CHECK, and `strategyFor`
dispatch in `scheduled-email-service.js` (`check:status-enum-parity` is the
existing gate family for exactly this producer↔consumer drift).

### Consultation sites and the freeze-at-creation carry-over

Both `approval_required` computation sites replace their coarse check with a
shared helper `effectiveReviewAll(preference, workflowType)` exported from
`shared/config/emailAutomation.js`:

- `lib/services/cron/grantee-deliverable-reminders-service.js` (`:281` on
  main) [VERIFIED via source 2026-08-27]
- `lib/services/reviewer-reminder-sweep.js` (`:122` on the parked branch)
  [VERIFIED via branch grep 2026-08-27 — these two are the ONLY callers of
  `getEmailAutomationPreferenceForSystemUser` besides its definition;
  `reviewer-reminder-workflows.js` never reads posture — its send-time
  recompute covers timing/config, not approval]

Freeze-at-creation semantics carry over unchanged: the matrix is consulted
ONCE at ledger-row creation; editing the preference affects future rows
only, and revive/reassign remain the only recompute paths. Posture reads
stay fail-closed (read failure skips the row, never weakens posture).

### Hard ordering invariant (do not ship mid-park)

**The contract change lands only AFTER the parked cron-reminders branch
merges and both consumers adopt `effectiveReviewAll`.** The branch's live
check is `override?.reviewAll === true`: if `perType` shipped first, a PD
with `{ reviewAll: false, perType: { reviewer_respond_reminder: true } }`
would have reviewer reminders auto-send — a silent posture weakening, the
exact class this system fails closed against. The same hazard applies to
any old-normalize code path reading a new-shape value (the current
`normalizeEmailAutomationPreference` strips unknown keys rather than
rejecting them). This is an ordering constraint, not a preference.

### UI

The single "review everything" toggle on `/scheduled-emails` becomes a
short per-type list (one row per launch type, plus the default row that is
today's toggle). Same route, same self-service auth
(`requireAuthWithProfile`), same reserved-key protection on the generic
preference route. No new surfaces; the digest remains the single interface
(Decision 7).

### Rollout

- Ships in the between-cycles quiet period AFTER the parked slice promotes
  (steps (a)–(e) of its promotion sequence), so PD onboarding seeds the
  matrix shape once — the posture-seeding open item and this slice share
  one onboarding pass.
- Rollout checklist items 1–3 apply unchanged; the admin walkthrough now
  covers per-type choices.

### Owner questions (open — do not build past these silently)

1. **Two-state per type** (review-all vs VIP-only, as designed above) or a
   third "always auto, even for VIPs" level? Recommendation: two-state —
   no PD has asked to suppress VIP review, and a third state weakens
   Decision 3's review-by-exception principle.
2. **Launch type list**: the three ledgered types above, or hold the two
   reviewer types out of the UI until their first supervised cycle?
3. **UI labels** for the per-type rows (plain-language names for the three
   workflow types).
