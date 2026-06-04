---
name: project-awardee-onboarding
description: Post-award awardee onboarding feature (surfaced S206 2026-05-31) — after a fund decision + GAL, automate abstract approval + artwork upload + release form; reuses the external reviewer-flow primitive. Not built yet.
metadata:
  type: project
  status: active
  scope: reviewer
  last_verified: S206 via memory-content (not re-probed 2026-06-04)
---

## Recall Rule

Read this when: planning the Request Workbench post-award lifecycle, an `Awardee` tab, or a GAL-sent status trigger.

Do:
- Build on the external-interaction primitive in `lib/external/` (HMAC token, magic-link, upload, form schema) — this is instance #2 after the reviewer flow.
- Treat the request lifecycle as extending PAST the board decision; the GAL-sent status change is the pivot into this stage.

Do not:
- Assume the GAL-sent status field/value is known — it's UNKNOWN and must be found in Dataverse first.
- Fork the external primitive; keep reviewer-specific bits separable.
- Assume the abstract-writing automation is in scope — that's still to-confirm.

Ground truth: not-yet-built (design only, surfaced S206). Reuses [[project-external-reviewer-file-access]] + [[project-reviewer-lifecycle]]; extends [[project-reviewer-apps-redesign-direction]]; status-trigger family [[project-backend-automation]].

**Surfaced by Justin 2026-05-31 (S206).** A new per-request, POST-AWARD workflow. Not built yet; captured because it shapes the Request Workbench lifecycle and reuses existing infrastructure.

## The workflow
1. Board makes a fund/decline decision.
2. **Ops team creates Grant Award Letters (GALs)** — these notify applicants of the decision. **Sending a GAL causes a Dataverse status change** (exact field/value UNKNOWN — to be found; plausibly an `akoya_requeststatus` terminal value or a separate GAL/award field). This status change is the trigger for the rest of the flow.
3. **~1 week after the GAL**, the PD sends the awardee a congratulations email requesting three things:
   - **Abstract approval.** The foundation writes an abstract — usually based on the applicant's submitted abstract, re-rendered in a consistent house style. Justin's proposal (tentative): an **automation writes this and saves it in Dataverse**. The awardee **approves, or edits-and-returns**.
   - **Graphical abstract / artwork** for the WMKF website.
   - **Release form** the awardee must agree to (accompanies the artwork request).

## Why it matters now (design impact, even though deferred)
- **The request lifecycle extends PAST the board decision.** The Workbench `Status` tab is NOT terminal; this post-award stage comes after it (mockup now carries a placeholder `Awardee` tab after `Status`). The GAL-sent status change is the pivot into it.
- **Reuses the external-interaction primitive — reviewer flow is instance #1, this is instance #2.** Same shape: automated email → magic-link approve/edit → document upload → form-agreement. Build it on `lib/external/` (HMAC token lifecycle, magic-link landing, SharePoint/Blob upload, form schema) the way the reviewer Stage-2a/accept/upload flow does ([[project-external-reviewer-file-access]], [[project-reviewer-lifecycle]]). Keep reviewer-specific bits separable so this doesn't fork the primitive. Justin: "doesn't require much to build — just needs field names in Dataverse to route the documents to."
- **Another status-driven trigger** (GAL-sent), same family as the J27 phase trigger — reinforces the status-as-event model ([[project-backend-automation]]).
- **The auto-written abstract is an automation-tier artifact** (auto-draft → **awardee** approves; note the approver is the awardee, not the PD).

## What's needed to build (later)
- Find the **GAL-sent status field/value** in Dataverse.
- New **Dataverse routing fields** on the request (or a child entity): approved-abstract text, graphical-abstract/artwork blob/SharePoint URL, release-form agreement flag/timestamp. Parallels the reviewer fields (`wmkf_reviewbloburl`, `wmkf_reviewsharepointfolder`, etc.).
- An awardee-facing external surface (`/external/award/[token]` or similar) + a PD-facing Workbench `Awardee` tab to trigger/track.
- The abstract-writing automation (LLM, house style) — confirm in/out of scope.

## Open / to confirm
- Tab name ("Awardee" is a placeholder).
- Whether the abstract automation is in scope or the abstract is hand-written.
- The GAL status value.

Related: [[project-reviewer-apps-redesign-direction]] (the Workbench this extends), [[project-external-reviewer-file-access]] + [[project-reviewer-lifecycle]] (the primitive to reuse), [[project-backend-automation]] (status-driven triggers), [[project-grant-lifecycle-states-confirmed]] (akoya_requeststatus terminal values).
