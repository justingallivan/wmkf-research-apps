---
name: Intake portal pilot — decisions locked 2026-05-06
description: Six-decision walkthrough of CONNOR_INTAKE_PORTAL_SYNC.md with Connor present; all six resolved plus several architectural meta-decisions. Items 2 (reviewer-consumable artifact) and 6 (structured-tables scope) SUPERSEDED by project-intake-portal-pilot-decisions-2026-05-13.md.
type: project
originSessionId: 3c35888d-8da4-46e3-83ac-31a25bbdc4e4
status: superseded
scope: intake
last_verified: 2026-05-22 (S178) via memory-content (not re-probed 2026-06-04)
---

## Recall Rule

Read this when: implementing intake-portal pilot features and checking which 2026-05-06 decisions still hold.

Do:
- Use the 2026-05-06 resolutions for items NOT re-decided later (membership shape, account-creation policy, reviewer-suggestion lifecycle, T&C magic-link pattern).
- Defer to the 2026-05-13 memory for items 1C/2 (reviewer-consumable artifact → PA-built packet) and 1D/6 (structured tables → budget + roster only).

Do not:
- Treat items 2 and 6 here as authoritative — they were reversed/narrowed.
- Use the 2026-05-06 sketch entity names (`wmkf_budgetline`/`wmkf_personnel`/`wmkf_priorsupport`/`wmkf_milestone`) — see the as-deployed S178 shape.

Ground truth: `docs/archive/CONNOR_INTAKE_PORTAL_SYNC.md`, `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md`, `project-slice0-scope`, `project-dataverse-creator-privileges`.

Superseded by: project-intake-portal-pilot-decisions-2026-05-13.md

> **2026-05-13 update**: Items 2 and 6 below were changed at the 2026-05-13 Track 1 sync — see `project-intake-portal-pilot-decisions-2026-05-13.md`. Item 2 reversed to Option 2 (PA-built packet). Item 6 narrowed from four entities to two (budget + roster only; milestone + priorsupport deferred). All other 2026-05-06 items remain authoritative.

Walked through `docs/archive/CONNOR_INTAKE_PORTAL_SYNC.md` with Connor in the room on 2026-05-06. All six decisions resolved.

**Why this matters**: Several decisions diverged from the doc's defaults. Future sessions should treat the resolutions below as ground truth, not the doc's original recommendations.

**How to apply**: When implementing pilot features, follow the resolved decisions; when something's ambiguous, the architectural meta-decisions section is the tiebreaker (especially the reviewer-migration sequencing and the schema-creation delegation).

## Six decisions, resolved

| # | Resolution |
|---|---|
| 1. Membership schema (deployed as `wmkf_portalmembership`, no underscore — `wmkf_portal_membership` form was dropped pre-deploy) | Approved as drafted in CONNOR_INTAKE_PORTAL_SYNC.md. AO + Liaison live on `account` instead of membership — `wmkf_role` choice stays `submitter \| contributor`. `account` adds `wmkf_authorized_official_contactid` + `wmkf_liaison_contactid` lookups. |
| 2. Reviewer-consumable artifact | **SUPERSEDED 2026-05-13** → PA-built review packet on `'Phase II Pending'` flip; Connor owns the build. Original Option 1 (staff-rendered Word/PDF on demand from `/apply/admin/*`, dropped into `Reviewer_Downloads/`) is no longer the plan. See `project-intake-portal-pilot-decisions-2026-05-13.md` item 1C. |
| 3a. Bucket 1 (structured promotions) | All approved: budget rows, biosketches per-roster-row (with optional CV file per row), Co-Is as roster table, prior support as per-person rows. |
| 3b. Bucket 2 (friction cuts) | All approved with revisions. T&C moved to post-acceptance with new lifecycle stage; Calendly scheduling step added; AO+Liaison institutional contacts on `account` (Liaison is institutional admin POC, role-based, person can change but role stays); govt-unit/group-exempt/Governing Board/Declaration of Status all institution-level on `account`; Bill.com post-acceptance only; EIN-match autofill confirmed. |
| 3c. Bucket 3 (additions) | Approved; milestones de-prioritized (still defined but optional); staff input expected to add similar-shape fields later. |
| 3-Q4. Reviewer suggestions | Keep at submission. New `wmkf_reviewerstate` choice on `wmkf_potentialreviewer`: `applicant_suggested \| staff_suggested \| advanced \| invited \| confirmed \| declined \| reviewing \| completed`. **Enrichment (Google Scholar / ORCID / publications) gated by `advanced` state — not on every applicant suggestion.** Dedup at portal write time against existing `wmkf_potentialreviewer` and `contact` rows by email. |
| 3-Q5. Required vs optional files | All required *except* Federal Agency Reviews (optional) and Capital Equipment Quotes (conditional on capital line items in budget). Required set: Project Narrative, Budget, Biosketches per-row, Bibliography, Graphical Abstract, Other Funding/Other Support, Recognition Statement, Collaborative Arrangements, Financial Narrative. |
| 4. PA flow boundary | Submission confirmation email is portal-owned (synchronous Dynamics email, appears in CRM history). Status flips to `'Phase II Pending'` — same status value as today, single-phase model keeps Phase II infrastructure. Nothing in existing PA flow set breaks. |
| 5. Account creation policy | Approved: portal writes `account` directly on staff approval (one-click magic link). Default account fields are inferable from EIN+name; no denylist for pilot. |
| 6. Structured-tables persistence | **Option 1 — real child entities (decision stands)**; suggested entity set is **SUPERSEDED by S178 deployed shape (2026-05-22)**: NEW `wmkf_proposalbudgetline` + EXTENSIONS on existing `wmkf_apprequestperson` (roster) + NEW `wmkf_portalmembership` + `akoya_request.wmkf_totalothersources`. The 2026-05-06 sketch (`wmkf_budgetline`/`wmkf_personnel`/`wmkf_priorsupport`/`wmkf_milestone`) was refined: roster folded onto `wmkf_apprequestperson` (no new entity), prior-support + milestones DEFERRED out of slice-0 (pilot uses narrative + PDF). Authoritative: `project-slice0-scope` + `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md`. Creator-privilege framing retained — see `project-dataverse-creator-privileges`. |

## Architectural meta-decisions

- **Reviewer Postgres → Dataverse migration is now prerequisite for pilot.** Connor: "let's pull the band-aid off." Aggressive timeline; mid-June pilot date does not slip. Top priority. Per-proposal lifecycle is already Dataverse-native (shipped); the org-wide enrichment pool (`researchers`, `publications`, `proposal_searches`, `grant_cycles`, `reviewer_suggestions` Postgres tables) is what migrates. See companion memory `project-reviewer-postgres-to-dataverse-migration.md`.
- **T&C signing pattern**: magic link (HMAC token primitive, not Entra External ID auth) sent to AO + Liaison on entry to `Awaiting T&C` state. Whichever clicks first sees the T&Cs, types name+title in a web form, clicks "I agree." Audit row + token-storage entry. Reuses `lib/external/token-lifecycle.js` with a new claim type. **Not** DocuSign / Adobe Sign.
- **Calendly** for the post-T&C scheduling call. New lifecycle state `Awaiting Scheduling Call` between T&C signed and Award Issued. PI is authenticated; Calendly link can land in their portal view, email is just a notification.
- **Staff approval emails are one-click magic links across the board** — membership approval, account creation, institutional document updates, AO/Liaison change. Approve = single click; Reject = link to a small form for rejection reason. Token scoped to specific record + specific staff azure_id, single-use, 24-48h TTL.
- **AO/Liaison are stored as `contact` rows on `account`, not authenticated portal users.** Earlier proposed Entra External ID registration for AO was rolled back in favor of magic-link-only T&C signing. AO/Liaison contacts updated at portal registration, confirmed each cycle.
- **Schema-creation authority delegated.** Connor approved Justin/Claude creating new Dataverse entities directly via creator privileges, with summary-after model. See `project-dataverse-creator-privileges.md`.

## Lifecycle stage additions on `akoya_request`

Beyond existing `Concept Pending → Phase I Pending → Phase II Pending`, post-acceptance flow gains:

```
Accepted → Awaiting T&C → T&C Signed → Awaiting Scheduling Call → Call Scheduled → Award Issued
```

(Exact label format should match Connor's existing `akoya_requeststatus` taxonomy; values to be confirmed when implementing.)

## Single-phase status taxonomy clarification

Single-phase cycle (2 cycles out) keeps `'Phase II Pending'` as the submitted status. Concept and Phase I stages disappear from the applicant flow but the downstream status name stays — same Phase II infrastructure, just no upstream gates. This was Connor's explicit call.

## Doc/file follow-ups — closed

- ~~Update `docs/INTAKE_PORTAL_DESIGN.md` to reflect resolved decisions~~ — live.
- ~~Draft `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md`~~ — live (W3-W6 cutover plan, executed 2026-05-12).
- ~~Draft `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md`~~ — live (slice-0 catalog).
