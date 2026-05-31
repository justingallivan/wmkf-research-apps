---
name: project-reviewer-apps-redesign-direction
description: Reviewer Finder + Reviewer Manager are slated to be replaced by a unified Request Workbench (per-request, holistic) + standalone Reviewer Pool. Holistic frame locked S195; build sequence = reviewer-lifecycle slice first (= Workbench v1). Reviewer-tab structure S206: leaning 4-tab + status badges (Find/Invite/Track/Approve & Pay), pending final confirm.
metadata:
  type: project
---

S194 set direction (replace Finder + Manager with Reviewer Workbench + Reviewer Pool). **S195 reframed it twice**, ending at a holistic Request Workbench backed by a backend automation tier. Build deferred — goal before code is a scoping doc Connor / Sarah can react to.

**S205 reprioritization (2026-05-30):** Justin elevated the **tier-3 whole-lifecycle navigation model** (how launcher → cycle dashboard → per-request Workbench fit together as ONE coherent UI, and how the existing standalone apps fold in) to **top-priority next-session work** — distinct from, and now ahead of, the reviewer-lifecycle-slice build. Not started tonight (deferred deliberately). Approach he wants: **build mockups with a Claude browser session** (visual exploration of the navigation model) before/alongside the scoping doc. The architecture below is still the locked frame; the open work is rendering the tier-stitching as something he can see and react to. Nothing built; no scoping doc yet (see end of entry).

**S206 mockup + decisions (2026-05-31):** Built the first clickable navigation mockup at `docs/mockups/lifecycle-ui-mockup.html` (self-contained HTML, committed 3f659a6; NOT a live app change — no `pages/` route). Decisions Justin made driving it:
- **Reviewer-tab structure → leaning 4-tab + status badges** (Find / Invite / Track / Approve & Pay). NOTE the arc within S206: first landed on 3-tab (Find/Roster/Approve & Pay) as simpler, then Justin reconsidered same session — "Roster" is a noun that breaks the all-actions label pattern and hides the work; Invite (compose+send) vs Track (monitor+chase) are genuinely different modes worth separating; the white-space worry was inherited from the old standalone Manager and is minor at per-request scale. Resolution = 4-tab with count/status badges on the tab bar (e.g. Track "1 pending · ⚠1", Approve & Pay "2"), so the bar doubles as the at-a-glance overview that Roster provided. Default landing = Track. Mockup defaults to this; 3-tab kept behind a compare toggle. **Pending Justin's final confirm after viewing the rendered hybrid.**
- **"Closeout" disambiguated (S206).** The word was overloaded across two scopes. The per-REVIEWER step (approve a returned review → reviewer done → honorarium eligible; happens around/before the site visit) is now **"Approve & Pay"** — it carries the honorarium trigger. The whole-REQUEST endpoint is a separate concern (below).
- **Request endpoint = read-only "Status" tab, NOT a PD decision.** Justin: staff only *recommend*; the BOARD decides approve/decline and it is entered into Dynamics by someone else. So the top-level final tab is a read-only reflection of the proposal's Dynamics status (`akoya_requeststatus` — Pending / Approved / Declined), not an editable PD field. Still tentative — Justin isn't sure yet what else belongs at the request endpoint.
- **Screening is backend-automated, not a Workbench tab.** Integrity Screener, WMKF Expertise, Funding Analysis live in the Tools menu (manual, on-demand) only.
- **Virtual Review Panel → Tools menu, labeled beta** (in dev, not part of this cycle).
- **Workbench tab strip (current mockup state):** Overview · Proposal · Initial Writeup · Reviewers · Reviews · Pre Site Visit Writeup · Site Visit · Final Writeup · Status. Three writeup stages mirror the lifecycle (Initial = Phase I-form/early; Pre Site Visit = Phase II-form, folds in reviews; Final = post-site-visit). Initial + Pre-visit reuse existing phase-i/phase-ii-writeup engines.
- **Tier-stitching positions taken in the mockup:** default home = cycle dashboard (not the launcher; launcher demoted to a "Tools" menu); context preserved via persistent cycle switcher + breadcrumbs; standalone apps coexist via dual-entry (same engine, off-cycle in Tools + per-request as a tab). Tools menu faithfully mirrors all 17 appRegistry apps, tagged standalone/dual/rehomed.

**Why:** Demo failures (S194 model resolver + parser drift) exposed the deeper problem — the apps were built across different constraint regimes (no Dataverse → Dataverse; ad-hoc cycle tracking → cycle entity; .eml downloads → in-app sends) and the seams show. Then S195 surfaced an even deeper one: most apps in the suite are already per-request workflow tools (`phase-ii-writeup`, `peer-review-summarizer`, `multi-perspective-evaluator`, integrity screener, funding-gap, …) but their entry point is "upload the proposal" — built before we had programmatic access to the proposal.

**How to apply:** Don't propose incremental cleanup to Finder/Manager. Don't design Workbench as a narrow reviewer-lifecycle surface. The destination is per-request-holistic; the *near-term build* is the reviewer-lifecycle slice as Workbench v1.

---

## Architecture (locked S195)

**Three tiers, per-request as the spine:**

- **Global / cross-cycle:** app launcher survives for Reviewer Pool, Dynamics Explorer, Dataverse Power Tools, Expense Reporter, Literature Analyzer standalone, Grant Reporting (post-award), Admin. Standalone forms of `phase-ii-writeup` / `peer-review-summarizer` / etc. stay around for ad-hoc / off-cycle / training use.
- **Cycle-scoped:** PD landing dashboard (request queue, by cycle + scope + `isActionableForPD`). Future home of the long-list → short-list triage surface ([[project-staged-review-pipeline]]).
- **Per-request: the Request Workbench.** URL `/workbench/[requestId]/...`. Per-request operations become tabs/affordances: proposal viewer, initial writeup, reviewer-lifecycle, returned reviews + summarizer, pre/post-site-visit writeups, site visit notes. **(S206 pared the tab set:** screening — integrity / expertise / funding-gap — is backend-automated and lives in the Tools menu, not as a per-request tab; Virtual Review Panel likewise moved to Tools, labeled beta. See the S206 decisions block above.)

**The Workbench is a display + refinement surface, not a console.** Backend automation tier (event-driven: `proposal-submitted`, `phase-advanced`, `review-submitted`, etc.) materializes artifacts; the Workbench reads state and lets the PD intervene where judgment matters. PD-triggered regenerate is exception, not default.

**This unifies several initiatives that were sitting separate in memory:** [[project-backend-automation]], [[project-staged-review-pipeline]], [[project-proposal-context-extraction]], [[project-prompt-storage-strategy]], [[project-new-ai-capabilities]]. They are the **automation tier** feeding the Workbench, not separate projects.

**The two-stage submission *process* is sunsetting** ([[project-grant-phasing-evolution]]): J26 is the last cohort with a *separate* Phase I → Phase II submission. Going forward there is **one submission, entered as Phase I**, with "Phase II" as an internal status flip (no Phase II uploads) — full materials arrive at the start; "long list → short list" winnowing still happens but on that one submission. **This simplifies the trigger model** — don't over-design dual-phase branching; build the pipeline for single-submission with internal staging labels.

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

**Tabs — leaning 4-tab + status badges (S206, pending final confirm).** Default landing is Track.
- **Find** — candidate discovery (current Reviewer Finder behavior, request-aware). Badge: candidate count.
- **Invite** — build shortlist + compose/dispatch invitations. Badge: open slots to fill.
- **Track** — confirmed/pending/declined, materials state, review-in-progress, overdue chasing — the home base once invites are out. Badge: pending count + overdue (⚠).
- **Approve & Pay** (was "Closeout" — renamed S206) — per-reviewer: read & approve the returned review → reviewer's work is done → triggers honorarium automation downstream. Badge: reviews awaiting approval.

The badges on the tab bar recover the at-a-glance "where is everyone" overview that the rejected 3-tab Roster consolidated into one table — without giving up the descriptive action labels. The 3-tab alternative (Find / Roster / Approve & Pay) is kept behind a compare-only toggle in the mockup.

**Honorarium is NOT a PD-facing tab.** It's a downstream automation consequence of Approve & Pay: PD approves the review → status flips to payable (Dataverse field name TBD; Connor still owes `wmkf_HonorariumRequest` lookup on `wmkf_potentialreviewer` per [[project-bill-honorarium-integration]]) → BILL flow runs.

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

S206 reopened the reviewer tab-structure fork and is leaning 4-tab + status badges (was briefly 3-tab; pending Justin's final confirm), and disambiguated "Closeout" (reviewer-level → "Approve & Pay"; request-level → read-only "Status"). Still owed before the scoping doc: confirm the 4-tab call; name the approve→payable status field for Connor; then write the doc.

Related: [[reviewer-identity-fragmentation]], [[project-reviewer-finder-dataverse-entry-path]], [[project-reviewer-institution-match]], [[project-w6-table-drop-pending]], [[project-app-roadmap-2026-04-25]], [[project-bill-honorarium-integration]], [[project-grant-phasing-evolution]], [[project-backend-automation]], [[project-staged-review-pipeline]], [[project-proposal-context-extraction]], [[project-prompt-storage-strategy]], [[project-dynamics-ai-writeback]].
