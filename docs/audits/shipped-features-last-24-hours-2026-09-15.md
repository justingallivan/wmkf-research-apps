---
title: Features Shipped in the Last 24 Hours — 2026-09-15
domain: release-operations
kind: audit
status: complete
summary: "Production-facing features merged from 2026-09-14 10:12 PDT through 2026-09-15 10:12 PDT, separated from documentation-only and deliberately dormant work."
canonical: false
cataloged: 2026-09-15
last_verified: 2026-09-15
owner: product-engineering
related:
  - docs/plans/CONSULTANT_FEEDBACK_PLAN_2026-09-14.md
  - docs/plans/REVIEWS_TAB_WRITEUP_PARAGRAPHS_PLAN_2026-09-14.md
  - docs/plans/ROSTER_CONTACT_LINK_PLAN_2026-09-14.md
  - docs/PC_MEETING_TRACKER_PLAN.md
  - docs/audits/reviewer-institution-migration-051-production-reconciliation-2026-09-15.md
---

# Features Shipped in the Last 24 Hours

## Window and release proof

This brief covers the rolling window **2026-09-14 10:12 PDT through
2026-09-15 10:12 PDT** (`2026-09-14T17:12:55Z` through
`2026-09-15T17:12:55Z`). It was derived from the first-parent history of the
freshly fetched `origin/main`, the 13 PRs merged in that interval, current
source, current plan/Atlas records, and read-only Production probes.

**[VERIFIED]** The latest Production deployment containing the complete window
is `dpl_6BQ4vTfGe2Cf98N8uJKqYyy4PWkj`, created from the PR #305 merge and Ready
at `2026-09-15 10:08 PDT`. All PR #305 checks passed, including the full Jest
suite, build, Semgrep, Gitleaks, Trivy, Vercel, and Claude review.

## Production-facing features

### 1. Consultant Feedback is live end to end

Staff can now record informal consultant input directly on a proposal's
Workbench Reviews tab, using either a retained roster consultant or a one-off
name. Entries accept sanitized pasted text, a PDF/DOCX attachment, or both;
default to shared; can be edited, hidden from the briefing page, or deleted;
and appear as their own Consultant feedback section on the external
deliberation briefing page.

The attachment path uses actor/request-bound private staging, virus scanning
when enabled, SharePoint plus `wmkf_requestdocument` as file authority, an
authenticated staff download proxy, replay-safe finalization, and safe Graph
`rename` behavior when append-only filenames collide. A signed-in Production
smoke on Request `1003222` proved create, upload/finalize, staff open, and
delete. Migrations 048 and 049 are applied.

**PRs:** #293, #295, #299, #300; #302 recorded production closeout.

### 2. Phase II review writeup material now comes from the Reviews tab

The Workbench Reviews tab now composes the first three writeup paragraphs from
stored reviewer data: review count/score tally, an underlined reviewer roster
with rank and institution, and reviewer expertise. The current
`review-synthesis.generate` v4 prompt adds a neutral themes paragraph and
representative quotations. Proposed quotations are reverified against the
stored narrative answer at the read boundary before they can render.

The same content is available through rich-text Copy, a new Reviews (writeup)
section in the Word panel-prep export, and the conditional
`[[STAFF:RefereeSection]]` fill in newly generated Pre-Site Visit drafts.
Production Request `1002852` proved the rendered sentences, v4 themes, three
verified quotations, underlined names, and complete rank/institution/expertise
data without browser warnings.

**PR:** #296, followed by prompt-publication and production-smoke closeout
commits on `main`.

### 3. Expertise roster members can resolve email from Dataverse Contacts

Active Board and Consultant roster rows can now hold one governed
`dataverse_contact_id`. Linked rows resolve the active Contact's current primary
email live from Dataverse; unlinked rows retain the existing manually maintained
email behavior. The roster row remains attendee identity, Dataverse is
read-only, broken links fail visibly without falling back to stale copied email,
and the Expertise Finder provides contact search/link health and guarded edits.

Migration 050 is applied. The owner-reviewed backfill linked ten active rows:
four Board members and six Consultants. Five Board rows remain deliberately
unlinked for a future cycle because they are not needed now; this is not a
current release blocker.

**PRs:** #301; #303 recorded production closeout.

### 4. Meeting Tracker attendee failures are actionable

The live Meeting Tracker and Site Visit attendee editors now disable Board rows
that cannot resolve a usable email, label them `no email`, and explain the
remedy instead of allowing a doomed selection. The server returns the named
person and `meeting_tracker_attendee_email_missing` rather than a generic 409.
The Contact-link work above supplies the durable remedy for roster members who
already exist as Dataverse Contacts.

A fresh Production probe confirmed `MEETING_TRACKER_SCHEMA_READY=on`; the
read-only Wave 28 preflight reported **22 exact / 0 absent / 0 divergent**.
Migration 041 is tracked for the deployed agenda ledger, although agenda-email
transport itself was not independently production-smoked in this window.

**PR:** #294.

### 5. Review Panel works better on phones and keyboards

The active Workbench Review Panel now centers the selected tab on narrow
screens, provides 44-pixel mobile action targets, adds visible keyboard focus
treatment, and improves secondary-text contrast. Production remains enabled in
`access` rollout mode.

**PR:** #298.

## Landed in Production but deliberately not active

### Reviewer-institution Phase 2 contracts

PR #304 deployed the independent-identity evaluator, typed affiliation
assertions, server-bound evidence receipts, save-boundary additional-affiliation
COI checks, and prospective measurement writer. This is dormant code, not a
shipped behavior change: `REVIEWER_INSTITUTION_PHASE2` and
`REVIEWER_INSTITUTION_MEASUREMENT` both remain disabled.

PR #305 applied migration 051 as empty dormant storage, verified its exact
schema, removed the obsolete byte-identical `038_cycle_dossiers.sql` tracker
alias while retaining canonical migration 045, and cleared the migration-drift
alert. Final tracker state is 50/50 with no missing or extra migrations and zero
measurement rows. Applying the migration did not turn collection on.

## Evidence matrix

| Capability | Producer / entry point | Persistence / authority | Consumer | Status |
|---|---|---|---|---|
| Consultant Feedback | Reviews-tab section and authenticated Workbench routes/services | Postgres `consultant_feedback`; SharePoint + `wmkf_requestdocument` for attachments | Workbench Reviews tab and external briefing page | **VERIFIED production-live** |
| Review writeup paragraphs | Stored review read model plus `review-synthesis.generate` v4 | Dataverse reviewer/review fields and request synthesis JSON | Reviews tab Copy, Word export, new Pre-Site drafts | **VERIFIED production-live and smoked** |
| Roster Contact link | Expertise Finder editor and guarded owner backfill | Postgres `expertise_roster.dataverse_contact_id`; Dataverse Contact remains email authority | Meeting Tracker and Site Visit recipient directory | **VERIFIED production-live; 10 linked** |
| Missing-email attendee guard | Meeting/Site Visit editors and server attendee resolver | Existing roster/Contact directory | Session and visit saves | **VERIFIED deployed; live readiness/schema** |
| Review Panel mobile polish | `ReviewPanelTab` and Workbench navigation | N/A | Staff using the Review Panel, especially narrow screens/keyboards | **VERIFIED deployed; panel enabled** |
| Reviewer-institution Phase 2 | Exact-on server-only adapters and writers | Roster receipts plus empty migration-051 table | No authoritative consumer while flags are off | **VERIFIED deployed but dormant** |

## PR classification

| PR | Classification |
|---|---|
| #293, #295, #299, #300 | Consultant Feedback runtime feature/fix |
| #294 | Meeting Tracker runtime guardrail |
| #296 | Reviews/writeup runtime feature |
| #298 | Review Panel usability feature |
| #301 | Roster Contact-link runtime/data feature |
| #304 | Dormant runtime contracts; no active behavior |
| #305 | Migration/operational reconciliation; feature remains off |
| #297, #302, #303 | Plan/review/closeout documentation; no independent runtime feature |

## Known boundaries

- Five Board roster members still lack a usable Contact link/manual email and
  cannot be selected as attendees until reconciled; the owner deferred them
  because they are not needed this cycle.
- Existing Pre-Site drafts are not retroactively rewritten with the new referee
  section; the fill appears on regeneration/new generation.
- Consultant profile deep links remain deferred because there is no stable
  shared profile-route contract.
- Meeting Tracker agenda-email transport is deployed but not independently
  production-smoked here.
- Reviewer-institution measurement and Phase 2 authority remain off; neither
  should be enabled without the prerequisites and a separate owner decision.

## Sweep result

- **Mode:** B — domain truth audit for the rolling release window.
- **Claims:** 6 total — 5 VERIFIED production-facing, 1 VERIFIED deployed but
  dormant; 0 UNKNOWN.
- **Disconfirming checks:** exact Production flag probe separated live from
  dormant code; Wave 28 Production preflight falsified stale "unapplied"
  documentation; PR bodies and source separated closeout-only merges from
  runtime changes.
- **Structural fix:** current Meeting Tracker plan, queue, runbook, Atlas, and
  Postgres ledger status were reconciled to the live exact-on/22-exact state;
  Review Panel Atlas/catalog references were reconciled from their stale smoke
  and unprovisioned-store wording to the verified `access` rollout and
  provisioned private store.
- **Historical exclusions:** dated implementation briefs remain historical and
  were not rewritten.
- **Verdict:** **RECONCILED for this 24-hour release window.**
