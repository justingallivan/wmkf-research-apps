---
name: project-reviewer-apps-redesign-direction
description: Reviewer Finder + Reviewer Manager are slated to be replaced by a unified Request Workbench (per-request, holistic) + standalone Reviewer Pool. Holistic frame locked S195; build sequence = reviewer-lifecycle slice first (= Workbench v1). Tab structure still open.
metadata:
  type: project
---

S194 set direction (replace Finder + Manager with Reviewer Workbench + Reviewer Pool). **S195 reframed it twice**, ending at a holistic Request Workbench backed by a backend automation tier. Build deferred — goal before code is a scoping doc Connor / Sarah can react to.

**Why:** Demo failures (S194 model resolver + parser drift) exposed the deeper problem — the apps were built across different constraint regimes (no Dataverse → Dataverse; ad-hoc cycle tracking → cycle entity; .eml downloads → in-app sends) and the seams show. Then S195 surfaced an even deeper one: most apps in the suite are already per-request workflow tools (`phase-ii-writeup`, `peer-review-summarizer`, `multi-perspective-evaluator`, integrity screener, funding-gap, …) but their entry point is "upload the proposal" — built before we had programmatic access to the proposal.

**How to apply:** Don't propose incremental cleanup to Finder/Manager. Don't design Workbench as a narrow reviewer-lifecycle surface. The destination is per-request-holistic; the *near-term build* is the reviewer-lifecycle slice as Workbench v1.

---

## Architecture (locked S195)

**Three tiers, per-request as the spine:**

- **Global / cross-cycle:** app launcher survives for Reviewer Pool, Dynamics Explorer, Dataverse Power Tools, Expense Reporter, Literature Analyzer standalone, Grant Reporting (post-award), Admin. Standalone forms of `phase-ii-writeup` / `peer-review-summarizer` / etc. stay around for ad-hoc / off-cycle / training use.
- **Cycle-scoped:** PD landing dashboard (request queue, by cycle + scope + `isActionableForPD`). Future home of the long-list → short-list triage surface ([[project-staged-review-pipeline]]).
- **Per-request: the Request Workbench.** URL `/workbench/[requestId]/...`. Every existing per-request operation becomes a tab/affordance: proposal viewer, reviewer-lifecycle, returned reviews + summarizer, writeup, analyses, integrity, site visit notes, funding gap.

**The Workbench is a display + refinement surface, not a console.** Backend automation tier (event-driven: `proposal-submitted`, `phase-advanced`, `review-submitted`, etc.) materializes artifacts; the Workbench reads state and lets the PD intervene where judgment matters. PD-triggered regenerate is exception, not default.

**This unifies several initiatives that were sitting separate in memory:** [[project-backend-automation]], [[project-staged-review-pipeline]], [[project-proposal-context-extraction]], [[project-prompt-storage-strategy]], [[project-new-ai-capabilities]]. They are the **automation tier** feeding the Workbench, not separate projects.

**Phase I is sunsetting** ([[project-grant-phasing-evolution]]). J26 is the last Phase I cohort. Going forward: single submission with full materials at the start; "long list → short list" winnowing still happens but on one submission. **This simplifies the trigger model** — don't over-design dual-phase branching; build the pipeline for single-submission with internal staging labels.

---

## Artifact categorization

**Fully auto (no PD in loop):** proposal summary, peer-review summary (once reviews in), funding-gap analysis, integrity screen, fit screen + intelligence brief, reviewer candidate longlist, cover-page assembly (already automated), honorarium kickoff.

**Auto-draft, PD refines:** writeup skeleton + summary sections, reviewer shortlist (auto longlist + scoring; PD picks 5), Virtual Review Panel outputs.

**Human-only:** site visit notes, internal deliberation outputs, final scored conclusions.

---

## Landing dashboard (locked S194, unchanged S195)

- PD identity from session (`dynamics_systemuser_id`), no PD picker.
- Cycle dropdown, defaults to current open cycle.
- Scope dropdown, three options, defaults to "My (lead PD)": My-lead / My-lead-or-backup / All.
- Status filter implemented as `isActionableForPD(request)` policy function (rules deferred).
- Strict cycle filter; deferred-from-prior-cycle handled at data layer not UI.
- Row content: still open. S195 user direction was to compact the LEFT side (number + cycle on one line: `#1002279  J26`; institution above PI line: `PI: Mike Pluth`) so the right side can carry actionability cues. Same compact identity unit reused as the persistent header on every Workbench tab.

---

## Reviewer-lifecycle slice = Workbench v1 (build target)

**Why this slice first:** needed for J26 Phase II peer review (real deadline, mid-June 2026 with BILL honoraria); needed for every future cycle as the post-shortlist surface; survives the Phase I sunset; most code-broken piece today.

**Tabs (S195 working list — Find/Invite/Track grouping still open):**
- **Find** — candidate discovery (current Reviewer Finder behavior, request-aware)
- **Invite** — shortlist + dispatch invitations
- **Track** — confirmed/pending/declined, materials state, review-in-progress, overdue chasing
- **Closeout** — per-reviewer: read returned review, mark closed → triggers honorarium automation downstream

**Open structural question for S196:** Find / Invite / Track / Closeout (4-tab) vs. Find + Roster + Closeout (3-tab, where Roster consolidates Invite + Track with actions varying by row state). User thinking overnight.

**Honorarium is NOT a PD-facing tab.** It's a downstream automation consequence of Closeout: PD marks review closed → status flips to payable (Dataverse field name TBD; Connor still owes `wmkf_HonorariumRequest` lookup on `wmkf_potentialreviewer` per [[project-bill-honorarium-integration]]) → BILL flow runs.

**BILL chunk 5 is NOT absorbed by Workbench** (correction from earlier S195 thinking). Stage 2a address-capture lives on the external reviewer surface (`/external/review/[token]/accept`) — that's the reviewer entering their address during accept, not a PD action. Workbench just sees the consequence (a confirmed reviewer with address on file). Chunk 5 ships on its own timeline against `/external/*`.

**Reviewer Pool** ships alongside Workbench v1 as the request-agnostic surface — browse roster, richer Dataverse context than the W6-retired Database tab had (past invitation history, honorarium state, contact-promotion status, affiliation history, conflicts).

---

## Workflow signals from Connor's parallel SharePoint folder (S195)

The reason this redesign is now urgent: Connor maintains a parallel SharePoint folder per cycle (`<Institution>_<RequestNumber>` pattern) because AkoyaGo's proposal-reading UX is painful. Inside, `00_All Staff Versions/` holds PA-merged PDFs (intake docs + DB cover page; already automated); `0_MR Scored Write Ups/` holds Word templates the PD fills in, filename-keyed by request number for PA routing. `000_Book Materials/` is post-review board-meeting assembly. **The Workbench obviates the per-request folder workflow** — proposal viewer + writeup composed in-app eliminates both the read-pain workaround and the filename-as-join-key brittleness. (MR = Medical Research; SE = Science and Engineering; may blur in coming years.)

---

## Build sequence

- **Now (S196 → mid-June 2026):** Reviewer-lifecycle slice as Workbench v1 + Reviewer Pool. URL pattern is the holistic one (`/workbench/[requestId]/...`) even though only one functional area lands.
- **Next cycle (post-J26):** Automation tier (proposal-submitted fan-out, artifact materialization) + writeup tab + analyses tabs + triage surface. Runway: doesn't need to be live until next cycle accepts submissions.
- **Holistic Workbench is the destination**, built incrementally tab-by-tab as the automation tier matures.

---

## Deliverable next: scoping doc

`docs/REQUEST_WORKBENCH_SCOPING.md` (or similar) — Connor/Sarah-shareable. Captures: holistic architecture; phasing change; reviewer-lifecycle v1 in detail (URL, tabs, what they do, what they replace, integration points with shipped reviewer infra); artifact-storage inventory pass (what's in Dataverse already, what's missing); explicit out-of-scope-for-v1 list (writeup, analyses, triage surface).

S196 likely: lock the tab structure (3-tab vs 4-tab), name the closeout status field for Connor, then write the doc.

Related: [[reviewer-identity-fragmentation]], [[project-reviewer-finder-dataverse-entry-path]], [[project-reviewer-institution-match]], [[project-w6-table-drop-pending]], [[project-app-roadmap-2026-04-25]], [[project-bill-honorarium-integration]], [[project-grant-phasing-evolution]], [[project-backend-automation]], [[project-staged-review-pipeline]], [[project-proposal-context-extraction]], [[project-prompt-storage-strategy]], [[project-dynamics-ai-writeback]].
