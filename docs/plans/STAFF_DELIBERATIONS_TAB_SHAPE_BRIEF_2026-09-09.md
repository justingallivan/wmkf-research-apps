---
title: Staff Deliberations tab — shape brief (2026-09-09)
domain: workbench
kind: plan
status: active
summary: "Design brief for restructuring the per-request Staff Deliberations tab so each stage states the PD's next step with one primary action, and Share becomes one step that locks the draft and sends the deliberation email."
cataloged: 2026-09-09
last_verified: 2026-09-10
owner: product-engineering
related:
  - shared/components/workbench/StaffDeliberationsTab.js
  - shared/components/workbench/DeliberationStageRail.js
  - shared/components/workbench/PreSiteDistributionPanel.js
  - shared/utils/deliberation-stage.js
  - docs/PC_MEETING_TRACKER_PLAN.md
---

# Staff Deliberations tab — shape brief

Status: **BUILT 2026-09-10 (S503) on `claude/deliberations-tab-redesign`; owner click-through pending before merge.** Lock-at-preview deviation (owner-accepted): the composer's first button locks the draft and builds the preview from the locked version, then Send sends; the server never prepares a preview for an unlocked draft. Produced by the impeccable `shape` pass on
2026-09-09 after the owner's production click-through of PR #218.

Owner decisions 2026-09-10 (S503), folded into this brief:

- **Download lives in More** at the draft stage (the brief's assumption stands).
- **The deliberation email carries no writeup attachment.** The briefing page
  (`docs/DELIBERATION_BRIEFING_PAGE_PLAN.md`) is the only carrier for the writeup, reviews, and
  narrative; the attachment-mode chooser (Word / PDF / both) and the attach steps go. The
  ledger still pins DOCX and PDF snapshots on every send because the page serves them.
  A send that cannot include a live briefing link refuses rather than sending a bare email.
  Rationale: one access path that Issue new link actually revokes; a simpler composer;
  fewer send-path failure modes. The exact bytes remain on the ledger and in the SharePoint
  Distribution Snapshots folder, so the request record does not depend on the Dynamics
  attachment.

## Job and audience

A Program Director opens this tab on one advancing request, between reviewer follow-up and
the final writeup, to move the proposal through staff deliberation. Operate mode. They know
the process; the tab today does not say where they are in it or what to do next.

## Outcome and proof

At every stage the card states one next step in a sentence and offers one primary action.
Success: a PD who has not read the guide can open the tab and do the right thing without
hunting. Product truth that the design must carry: sharing locks an exact version; the
deliberation session and site visit are scheduled by the PC, not the PD; the AI draft
leaves the recommendation, referee comments, and presentation for staff to complete.

## Selected direction

Refinement inside the incumbent world (DESIGN.md "The Clear Workbench"): white card, gray
structure, one Foundation Ink primary. No new visual language. The structural thesis is
**stage → sentence → action**: the rail stays as the map, a stage sentence beneath it says
what to do, and the action row carries one dark button plus at most one outline button.
Everything else moves down or into an overflow.

### The card by stage

| Stage | Sentence under the rail | Primary | Secondary | Tucked away |
|---|---|---|---|---|
| AI draft ready | Review and edit the AI draft in Word, then share it for the deliberation session. The draft leaves the recommendation, referee comments, and presentation for you to complete. | Edit in Word | Share… | Download, Regenerate (More menu) |
| Shared, email sent | Shared on date. Session line. Visit line. | Open working document | Resend (only if the last send failed) | Download (More) |
| Visit | Visited on date. Add your site-visit edits to the working document in Word, then continue in Final Writeup to start group review. | Add site-visit edits in Word | Continue in Final Writeup | Download (More) |
| Final | This proposal moved to Final Writeup. | Open Final Writeup | none | none |
| Generating / failed / no draft | existing copy, unchanged | Generate Word Draft | none | none |

Session line and visit line are two short lines: "Deliberation session: not yet scheduled."
becomes "Deliberation session: date, time" once the tracker exists; "Visit not scheduled." /
"Visit date." / "Visited date." as today.

### Share becomes one step

"Share…" opens the existing distribution composer as a dialog, pre-filled as it is today
(suggested recipients, the draft, material links, the site-visit calendar entry), with the
session slot rendering "not yet scheduled" until the tracker supplies date, time, Zoom link,
and attendees (tracker plan §5.6). The email carries one thing: the briefing page link, which
carries the writeup, the reviews, the proposal narrative, and the site visit materials (owner
2026-09-10, briefing plan D19; the material-link checkboxes are gone and nothing is attached).
The calendar entry has no UI (S466). Sending both locks the version and sends. The confirm
copy says both. Order of operations is unchanged from today's two clicks: lock first, then
send. If the send fails after the lock, the card shows Shared with a red line naming the
failure and a Resend button; the composer's send history already supports this.

The standalone "Start sharing" button, its helper sentence, and the always-visible composer
under the card go away. The "Shared" chip, "Materials sent" chip, and "Working document:"
line collapse into the stage sentence.

### What the help popover becomes

The "?" button and its three paragraphs are removed. The one sentence a PD needs is in the
draft-stage sentence above; the rest (source PDF contract, registry, regeneration rules)
belongs in the Guide, where it already lives or should.

## Scope and boundaries

- Target: `StaffDeliberationsTab.js` render tree and the composer's opening mode. The rail,
  stage derivation, label service, every write path, every guard, and the superuser reopen
  section are untouched.
- The cycle view (`StaffDeliberationsPanel.js`) gets the matching stage sentence and the
  same session/visit lines, and drops the old "Draft / Ready" registry block and the
  SharePoint-metadata sentence. Lead line keeps label casing ("7 AI draft ready").
- Anti-goals: no new write path; no change to what the email contains beyond the session
  slot; no scoring, no new colors, no new chips.

## States and ranges

Draft ready with and without warnings; generating with progress; failed retryable and
retry-blocked; shared before and after a send; shared with a failed send; visit scheduled,
visited, not scheduled; final; unknown lifecycle (read-only notice, unchanged); no Word link
on a shared row (read-only notice, unchanged). Warnings render as today, below the sentence.

## Interaction and layout

Card header: title left, action row right, both top-aligned; on narrow widths the action
row wraps below the title. Rail on its own line with the sentence beneath in body gray.
Session and visit lines in small muted text. Latest-draft link and File details stay,
below the sentence. The More menu is the existing portal menu pattern used elsewhere in
the Workbench, not a new component.

## Constraints and open decisions

- Tier 1 runtime work: branch, PR, owner merges. E2E coverage exists for the composer;
  the share-as-one-step change needs its send-after-lock failure path pinned in a test.
- Open for the owner: whether Download deserves a visible outline button at the draft
  stage or lives only in More. The brief assumes More.
