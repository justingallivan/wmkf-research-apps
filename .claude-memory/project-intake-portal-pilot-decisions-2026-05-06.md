---
name: Intake portal pilot — decisions locked 2026-05-06
description: Historical six-decision walkthrough of CONNOR_INTAKE_PORTAL_SYNC.md on 2026-05-06. Items 2 and 6 were superseded on 2026-05-13; none of these pilot decisions authorizes current portal work.
type: project
originSessionId: 3c35888d-8da4-46e3-83ac-31a25bbdc4e4
status: superseded
scope: intake
last_verified: 2026-05-22 (S178) via memory-content (not re-probed 2026-06-04)
---

## Historical decision record — 2026-05-06

This file records decisions from the May 6 pilot discussion. It is not current implementation
authority or a route to resume portal work. The owner later parked the custom portal and
kept J27 intake on GOApply until further notice; see [[project-system-model]],
`docs/SYSTEM_MODEL.md` (Applicant Intake), and `docs/J27_TRANSITION_REGISTER.md` Q19.
If the owner reopens a pilot, re-establish scope and current architecture from those
authorities and source before relying on these historical details.

Superseded by: project-intake-portal-pilot-decisions-2026-05-13.md

> **2026-05-13 historical correction:** Items 2 and 6 were changed at the Track 1 sync — see `project-intake-portal-pilot-decisions-2026-05-13.md`. The other resolutions below remain part of the May 6 historical record; they are not current authorization to build or operate a custom portal.

Walked through `docs/archive/CONNOR_INTAKE_PORTAL_SYNC.md` with Connor in the room on 2026-05-06. All six decisions resolved.

**Discussion context:** Several decisions diverged from the sync document's defaults. The table preserves what participants decided at that meeting; current implementation status and authorization come from the current owner decision and authoritative system model.

## Six decisions, resolved

| # | Resolution |
|---|---|
| 1. Membership schema (deployed as `wmkf_portalmembership`, no underscore — `wmkf_portal_membership` form was dropped pre-deploy) | Approved as drafted in CONNOR_INTAKE_PORTAL_SYNC.md. AO + Liaison live on `account` instead of membership — `wmkf_role` choice stays `submitter \| contributor`. `account` adds `wmkf_authorized_official_contactid` + `wmkf_liaison_contactid` lookups. |
| 2. Reviewer-consumable artifact | **SUPERSEDED 2026-05-13** → PA-built review packet on `'Phase II Pending'` flip; Connor owns the build. Original Option 1 (staff-rendered Word/PDF on demand from `/apply/admin/*`, dropped into `Reviewer_Downloads/`) is no longer the plan. See `project-intake-portal-pilot-decisions-2026-05-13.md` item 1C. |
| 3a. Bucket 1 (structured promotions) | All approved: budget rows, biosketches per-roster-row (with optional CV file per row), Co-Is as roster table, prior support as per-person rows. |
| 3b. Bucket 2 (friction cuts) | All approved with revisions. T&C moved to post-acceptance with new lifecycle stage; Calendly scheduling step added; AO+Liaison institutional contacts on `account` (Liaison is institutional admin POC, role-based, person can change but role stays); govt-unit/group-exempt/Governing Board/Declaration of Status all institution-level on `account`; Bill.com post-acceptance only; EIN-match autofill confirmed. |
| 3c. Bucket 3 (additions) | Approved; milestones de-prioritized (still defined but optional); staff input expected to add similar-shape fields later. |
| 3-Q4. Reviewer suggestions | The meeting selected capture at submission and proposed a new `wmkf_reviewerstate` choice on `wmkf_potentialreviewer`: `applicant_suggested \| staff_suggested \| advanced \| invited \| confirmed \| declined \| reviewing \| completed`. **The decision gated enrichment (Google Scholar / ORCID / publications) on `advanced` state — not every applicant suggestion.** It proposed deduplication at portal write time against existing `wmkf_potentialreviewer` and `contact` rows by email. |
| 3-Q5. Required vs optional files | All required *except* Federal Agency Reviews (optional) and Capital Equipment Quotes (conditional on capital line items in budget). Required set: Project Narrative, Budget, Biosketches per-row, Bibliography, Graphical Abstract, Other Funding/Other Support, Recognition Statement, Collaborative Arrangements, Financial Narrative. |
| 4. PA flow boundary | Submission confirmation email is portal-owned (synchronous Dynamics email, appears in CRM history). Status flips to `'Phase II Pending'` — same status value as today, single-phase model keeps Phase II infrastructure. Nothing in existing PA flow set breaks. |
| 5. Account creation policy | Approved: portal writes `account` directly on staff approval (one-click magic link). Default account fields are inferable from EIN+name; no denylist for pilot. |
| 6. Structured-tables persistence | The meeting selected Option 1 (real child entities). The suggested entity set was **superseded by the S178 deployed shape (2026-05-22)**: NEW `wmkf_proposalbudgetline` + EXTENSIONS on existing `wmkf_apprequestperson` (roster) + NEW `wmkf_portalmembership` + `akoya_request.wmkf_totalothersources`. The 2026-05-06 sketch (`wmkf_budgetline`/`wmkf_personnel`/`wmkf_priorsupport`/`wmkf_milestone`) was refined: roster folded onto `wmkf_apprequestperson` (no new entity), prior-support + milestones deferred out of slice-0 (the pilot design used narrative + PDF). The deployed schema is documented in `project-slice0-scope` + `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md`; creator-privilege framing was recorded in `project-dataverse-creator-privileges`. |

## Historical architectural decisions and proposals

The entries below record proposed pilot behavior at that time; they do not describe live
feature contracts or authorize current implementation.

- At the time of the meeting, reviewer Postgres → Dataverse migration was designated a prerequisite for the proposed pilot, with an aggressive mid-June target. The per-proposal lifecycle was already Dataverse-native; the org-wide enrichment pool (`researchers`, `publications`, `proposal_searches`, `grant_cycles`, `reviewer_suggestions` Postgres tables) was the migration scope. The migration was tracked in `project-reviewer-postgres-to-dataverse-migration.md`.
- **T&C signing pattern**: magic link (HMAC token primitive, not Entra External ID auth) sent to AO + Liaison on entry to `Awaiting T&C` state. Whichever clicks first sees the T&Cs, types name+title in a web form, clicks "I agree." Audit row + token-storage entry. Reuses `lib/external/token-lifecycle.js` with a new claim type. **Not** DocuSign / Adobe Sign.
- **Calendly** for the post-T&C scheduling call. New lifecycle state `Awaiting Scheduling Call` between T&C signed and Award Issued. PI is authenticated; Calendly link can land in their portal view, email is just a notification.
- **Staff approval emails are one-click magic links across the board** — membership approval, account creation, institutional document updates, AO/Liaison change. Approve = single click; Reject = link to a small form for rejection reason. Token scoped to specific record + specific staff azure_id, single-use, 24-48h TTL.
- **AO/Liaison are stored as `contact` rows on `account`, not authenticated portal users.** Earlier proposed Entra External ID registration for AO was rolled back in favor of magic-link-only T&C signing. AO/Liaison contacts updated at portal registration, confirmed each cycle.
- The meeting recorded Connor's approval for Justin/Claude to create new Dataverse entities directly via creator privileges, with a summary-after model. See `project-dataverse-creator-privileges.md` for that historical delegation record.

## Lifecycle stages proposed for the pilot

Beyond existing `Concept Pending → Phase I Pending → Phase II Pending`, post-acceptance flow gains:

```
Accepted → Awaiting T&C → T&C Signed → Awaiting Scheduling Call → Call Scheduled → Award Issued
```

(The meeting noted that exact labels would need to align with Connor's existing `akoya_requeststatus` taxonomy; values were left for confirmation during implementation.)

## Single-phase status taxonomy proposal

The meeting recorded Connor's proposal that the single-phase cycle (then described as two
cycles out) would keep `'Phase II Pending'` as the submitted status. Concept and Phase I
stages would disappear from the applicant flow while the downstream status name and Phase II
infrastructure stayed. This is retained as a historical decision, not current portal direction.

## Doc/file follow-ups — closed

- ~~Update `docs/INTAKE_PORTAL_DESIGN.md` to reflect resolved decisions~~ — live.
- ~~Draft `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md`~~ — live (W3-W6 cutover plan, executed 2026-05-12).
- ~~Draft `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md`~~ — live (slice-0 catalog).
