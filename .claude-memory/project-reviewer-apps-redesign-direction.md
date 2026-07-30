---
name: project-reviewer-apps-redesign-direction
description: The unified Request Workbench has seven implemented tabs and three placeholders; the Request 1002788 Initial Assessment pilot proved generation, shared discovery, and exact retry while recovery and lineage defects remain, and the full Editor Dashboard remains planned.
metadata:
  type: project
  status: active
  scope: reviewer
  last_verified: 2026-07-30 via source/live probes, production schema/prompt apply and readback, Workbench truth audit, and owner production-pilot decisions
---

## Recall Rule

Read this when: building or planning the Request Workbench, the cycle dashboard, the reviewer-lifecycle slice, or anything that touches the Finder/Manager → Workbench consolidation.

Do:
- Build toward the per-request-holistic destination; the near-term build is the reviewer-lifecycle slice as Workbench v1 (URL `/workbench/[requestId]/...`).
- Reviewer-tab structure: DECIDED S206 as 4-tab; built as 5 sub-tabs (Candidates added S211); now **COLLAPSED to 3 sub-tabs — Find · Invite Reviewers · Track Reviewers (S280, commit `4d45b4c8`)** — with state-aware default landing. The `candidates` tab key now backs the "Invite Reviewers" label; legacy `invite`/`completed` deep-links normalize to `track`.
- Treat `akoya_requeststatus` (Status tab) as a read-only living taxonomy — enumerate live, never hardcode; the board decides approve/decline, staff only recommend.
- Verify-before-relying on the D26 allowlist: grep reviewer/invite/honorarium paths to confirm only dashboard visibility is gated on grant status.

Do not:
- Propose incremental cleanup to Finder/Manager, or design Workbench as a narrow reviewer-only surface.
- Re-flag `akoya_requeststatus` values as "unverified," or advance status early for D26 (use the manual request-number allowlist instead — advancing status fires PA triggers prematurely).
- Treat "Completed" as paying anyone or firing a trigger (option a: record-keeping only, no drop-off).

Ground truth: `pages/workbench/[requestId].js`,
`docs/audits/AUDIT_REQUEST_WORKBENCH_TRUTH_2026-07-26.md`,
`docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md`, and the per-surface source/Atlas
contracts. `docs/REQUEST_WORKBENCH_BUILD_PLAN.md` and
`docs/REQUEST_WORKBENCH_SCOPING.md` are historical chronology/rationale.

**2026-07-29 editor-direction implementation checkpoint:** Allison is a confirmed primary
user for the Editor lens. The target contract preserves the former
single-folder workflow as a staff-wide cycle Editor Dashboard with direct entry
to the canonical SharePoint Word files and explicit per-editor Reviewed
tracking. A narrower pilot locator with a cycle list and direct Word entry is
implemented in source under the existing `reviewers` app grant. All PDs are expected eventually to
evaluate the materials, and designated staff proofreaders also need access.
Request-versus-artifact-stage marker granularity, coordinator matrix, and
SharePoint file-permission verification remain open. The
first fixed gate is a human-in-the-loop, end-to-end Initial Assessment pilot by
2026-08-10, ahead of proposal intake around 2026-08-18. Authorized staff use a
dedicated representative dummy production request to generate, inspect, and edit the canonical
SharePoint Word artifact and then find/open that same registered file from the
Workbench and cycle-wide pilot locator. The pilot also exercises one safe
failure/retry path and proves no false cross-store success. It is
draft-functional proof, not production readiness, and does not require the
later lifecycle tabs. The owner chose a controlled production rehearsal using
colleague-created representative dummy requests rather than building the
existing Dataverse sandbox organization into an integrated application/file
test environment. Request `1002788` became the authorized target. Generation,
registry/pointer lineage, both consumer surfaces, native SharePoint version
creation, and exact-input retry passed on 2026-07-30. Recovery hashing, the
AI-run request lookup, substantive human editing, and target-library controls
remain open.
Use the near-term execution plan for current authority; the chronology below
remains the rationale record.

**2026-07-28 Site Visit/writeup reconciliation:** Initial Assessment,
Pre-Site, and Final are three separate governed Word documents. Final is
created from the latest Pre-Site version at action time, with a rare deliberate
regeneration option that preserves prior Final content; Site Visit is a
dossier, not a fourth writeup. Its logistics are date, time/time zone, format,
location/link, lead PD, WMKF staff, applicant participants, and
Board/consultant participants; no separate visit-status field is needed. Its
categories are applicant slides, other applicant materials, recording,
transcript, transcript summary, and one paste-friendly staff-observations area
without per-entry timestamps. No general material-revision workflow is planned
absent observed need, but the applicant surface explicitly supports recoverable
delete/replace rather than inferred replacement. It accepts PDF/PPTX, permits
additional uploads while access remains active, and is capped at 1 GB per file
and 20 current applicant files per request. Files land in the request's
governed SharePoint folder under `Site Visit/Applicant Materials/Slides` or
`Other`. Successful uploads, replacements, and deletions are batched into a
short automated digest to the lead PD plus the still-to-be-defined relevant
staff audience. A program coordinator may be included, but the design must not
hard-code that role as the only additional recipient. An authorized staff user
manually triggers the request; entering or changing the Site Visit date never
sends it automatically. Recipient choices are the Dataverse-linked liaison and
PI—normally liaison in To, or PI in To with liaison optionally copied. To and
CC share one request-scoped link and may manage the same file list. Missing,
invalid, or duplicate selected addresses block sending until staff corrects
Dataverse; there is no free-form bypass. Without sign-in or personalized links,
the audit does not promise PI-versus-liaison attribution. Applicants see
current files and operation confirmations only. Staff sees
action/file/category/size/time/request/link metadata and uses native SharePoint
recovery; no custom applicant or Workbench restore control is required
initially. Visits are scheduled
promptly after advancement around reviewer invitations; once the date is
recorded, staff may send without waiting for reviews, synthesis, or a Pre-Site
Writeup. Expiration is automatically 60 days after successful send, requires no
staff-entered date, and is unaffected by visit rescheduling. Resend preserves
the active link and original expiry;
Reissue/restart stages a replacement and revokes the old link only after the
new invitation is accepted for sending, so failure does not destroy a
still-active link. Any staff member with Workbench Site Visit access may send,
resend, or reissue. Exact visible
sender/reply-to and lead-PD copy behavior remain open pending the owner's staff
discussion. Historically, non-PD staff sent these requests without PD
involvement; that is context, not the future contract. No standalone Revoke
action is needed in the minimum product. The large-file scanner contract and
the additional notification audience/digest window remain open. SharePoint is
the byte store; a new resumable Graph upload-session path is required because
the current buffered helper stops at 60 MB. Dataverse holds the artifact
registry and Postgres only expiring-link/resumable-session workflow state.
Pre-Site distributions and Final remain linked writeups, not dossier material
categories. The narrow expiring request-scoped applicant-material upload link
does not reopen the parked general applicant-intake product. Prefer an
acceptable transcription-platform summary before a deliberate suite LLM
fallback. The transcript workflow will be coordinated with a program
coordinator; details remain pending. Implementation, schema/read model,
token/validation/recovery behavior, and summary-quality contracts remain
planned. Current authority is
`docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md` and
`docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md`.

## Current source-backed state (2026-07-29)

- Ten top-level tabs; seven implemented in source (Overview, Proposal, Initial
  Assessment, Reviewers, Reviews, Status, Awardee) and three placeholders (Pre
  Site Visit Writeup, Site Visit, Final Writeup). Initial Assessment production
  registry/pointer schema, governed prompt v1, and application are live and
  verified; the Request `1002788` human artifact pilot is a partial pass.
- Reviews is built and production-proved: governed-v3 structured output
  persisted successfully, the automatic all-in drain is enabled, and its
  producer/persistence/consumer lifecycle completed a controlled production
  smoke on request `1002788`.
- Awardee includes the distinct live `/external/grantee/[token]` portal and
  `wmkf_granteedeliverable` persistence. GAL-trigger automation remains separate/unknown.
- The proposed writeup URL fields and `writeup.*` prompt rows remain absent.
  Their June design is historical input; the implemented pilot instead uses
  the production-provisioned `wmkf_requestdocument` registry and governed
  `initial-assessment.generate` v1. The controlled production rehearsal created
  one Ready/Draft registry row, populated the request pointer, and proved both
  consumers plus exact-input retry. It also exposed the pre-upload hash
  mismatch against SharePoint-canonicalized DOCX bytes and a null AI-run
  request lookup.
- Reviewer Pool remains planned and optional, not a shipped Workbench-v1 deliverable.

## Historical decision chronology

S194 set direction (replace Finder + Manager with Reviewer Workbench + Reviewer Pool). **S195 reframed it twice**, ending at a holistic Request Workbench backed by a backend automation tier. Build deferred until S208 — goal before code was a scoping doc Connor / Sarah can react to.

**BUILD STARTED S208 (2026-05-31) — shipped to prod, in phases (see `docs/REQUEST_WORKBENCH_BUILD_PLAN.md`):**
- **Phase 0** (`79a343d`): additive `reviewers` app grant (the 18 reviewer-finder/review-manager routes accept it via variadic `requireAppAccess`; legacy route-gate strings remain as deferred cleanup after S261 registry retirement). New `wmkf_applicantdisposition` picklist on `wmkf_appreviewersuggestion` (Recommended=100000000 / Excluded=100000001; null=staff/Claude-discovered) **deployed to prod Dataverse** (wave6). Excluded rows filtered from all candidate/count readers via null-safe `notExcludedFilter()` (see [[project-dataverse-odata-null-filter]]); fail-closed chokepoints (`findById`, `updateLifecycle` every-write, `ensureToken`/`regenerate-token`, `verifySuggestionToken`). `wmkf_completedat` stamped on EVERY complete transition (centralized in adapter `updateLifecycle`).
- **Phase 1** (`44c10b6`): `/workbench` tier-2 cycle dashboard + `/api/workbench/{dashboard,resolve-request}`. Additive union: status-gated query ∪ (for D26) a committed allowlist of 35 going-forward request NUMBERS (`shared/config/d26Allowlist.js`, throwaway) — they're Phase I Pending so the normal gate excludes them. `my-proposals.js` untouched. Scope my/all. Per-request work-remaining rollup.
- **Per-request shell** (`eeb5da3`): `/workbench/[requestId].js` shell (tab strip + placeholder panels) so dashboard rows resolve. *(At this commit all panels were stubs; the Reviewers panel was made live by Phases 2–3 below, the Proposal tab later (S258), Overview + Status in Group A (S260), Reviews, Awardee/grantee-deliverables, and now Initial Assessment later; only the still-unimplemented lifecycle tabs remain placeholders.)*
- **Phase 2 — SHIPPED S209 (`64f694f`):** real Manage panel `shared/components/reviewers/ReviewerManagePanel.js`, shared by Review Manager + Workbench; `ReviewersTab.js` wires the Reviewers tab (Invite/Track/Completed + state-aware landing).
- **Phase 3 — SHIPPED S210 (`79a2840`) + S211 (`bd95087`):** `ReviewerFindPanel.js` (auto-load proposal, in-panel `analyze→discover→enrich→save` search at full standalone parity), applicant-reviewer ingestion (`/api/workbench/applicant-reviewers.js`, recommended→candidates / excluded→per-request soft-block), and the new **Candidates** saved-roster sub-tab (`CandidatesPanel.js` + real invitations). Manual reviewer add SHIPPED S236 (`/api/workbench/manual-reviewer.js`). At S210–S211 the live Reviewers tab had **5** sub-tabs (Find · Candidates · Invite · Track · Completed), not the 4 of the S206 design; it was later **collapsed to 3 (Find · Invite Reviewers · Track Reviewers, S280, commit `4d45b4c8`)**. Authoritative phase status: `docs/REQUEST_WORKBENCH_BUILD_PLAN.md`.
- **Historical operational note:** the original pilot grant/browser-smoke checkpoint is
  superseded by subsequent production Workbench use. Current smoke status is tracked in
  `docs/CURRENT_WORK_QUEUE.md`; do not revive this old checkpoint.

**S260 (2026-06-15) — Group A tabs + triage-field plan + app-retirement started:**
- **Group A SHIPPED (`f47d1f09`, `66f33b8c`):** the **Overview** (per-request command center) + **Status**
  (read-only `akoya_requeststatus`) lifecycle tabs are live; default landing flipped `reviewers → overview`.
  Overview's reviewer-stage strip uses a NEW lighter endpoint `/api/workbench/reviewer-rollup` (shared
  `lib/services/reviewer-rollup.js` — `deriveWorkRemaining` moved there; the `status-enum-parity` gate now
  reads it from there). **4 placeholder lifecycle tabs remain** (Initial/Pre-Site-Visit/Final Writeup,
  Site Visit). The current contract and order are in
  `docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md`; the old S260 scope is historical.
- **Triage-field BUILT + DEPLOYED (S261, `ecdcaed2`/`42823593`):** `docs/WORKBENCH_TRIAGE_FIELD_BUILD_PLAN.md` (v4, 3 Codex rounds).
  A new `wmkf_triagestatus` picklist (Advancing/Set aside/null) on **core `akoya_request`** is LIVE in prod with the
  D26 backfill applied (35 Advancing + 170 Set aside, 205 rows). It is DESIGNED to retire the manual `d26Allowlist.js`,
  The §3 dashboard switch is DONE (S261): the dashboard now reads the field (Advancing + Phase II Pending shown,
  Set aside hidden, Concepts excluded). §5 allowlist retirement DONE (S261): cycle picker derives from the PD's
  meeting-dated proposals (default = latest); `d26Allowlist.js` retired from live use (kept as historical/backfill
  replacement, needs the cycle-default decision). The per-row triage-flip UI is DONE (S261: canManage-gated
  per-row control POSTs to /api/workbench/triage). (PA-trigger risk assessed low +
  accepted S261: only the new field written, `akoya_requeststatus` untouched → status-filtered intake flow can't
  fire; residual = any unfiltered modify-flow, run-history not spot-checked.) J27 expands
  it (more states + PD-recommendation/authoritative two-layer split) — that's the tier-2 **triage lens** seed.
- **Standalone app retirement STARTED (verify before acting):** Justin **hid Reviewer Finder + Review Manager
  in the admin panel** (S260). The `/api/reviewer-finder/*` + `/api/review-manager/*` API routes are
  **load-bearing for the Workbench** (it calls ~15) — do NOT delete them. Remaining: verify all legacy-grant
  holders have `reviewers` (live `wmkf_appuserappaccesses`), delete the standalone *pages*, retire the
  `reviewer-finder`/`review-manager` grant keys. Off-cycle PDF upload goes away (Justin: no more PD uploads).
- **D26 document model (Justin):** active doc is Phase I early, then the **Phase II proposal** (arrives →
  `akoya_requeststatus = 'Phase II Pending'`) becomes active (sent to reviewers + Pre-Site-Visit Writeup
  source), Dataverse-stored, consistent naming TBD. **D26 patch to UNPATCH for J27** (single doc throughout).
  Four distinct signals: Triage (visibility) · Invited (`wmkf_phaseistatus`, board, "expect Phase II") ·
  Phase II Pending (doc arrived) · J27 phase trigger (official advance, replaces the allowlist concept).

**S205 reprioritization (2026-05-30):** Justin elevated the **tier-3 whole-lifecycle navigation model** (how launcher → cycle dashboard → per-request Workbench fit together as ONE coherent UI, and how the existing standalone apps fold in) to **top-priority next-session work** — distinct from, and now ahead of, the reviewer-lifecycle-slice build. Not started tonight (deferred deliberately). Approach he wants: **build mockups with a Claude browser session** (visual exploration of the navigation model) before/alongside the scoping doc. The architecture below is still the locked frame; the open work is rendering the tier-stitching as something he can see and react to. Nothing built; no scoping doc yet (see end of entry).

**S206 mockup + decisions (2026-05-31):** Built the first clickable navigation mockup at `docs/mockups/lifecycle-ui-mockup.html` (self-contained HTML, committed 3f659a6; NOT a live app change — no `pages/` route). Decisions Justin made driving it:
- **Reviewer-tab structure = 4-tab + status badges, DECIDED S206** (Find / Invite / Track / Completed). The arc within S206: first landed on 3-tab (Find/Roster/Completed) as simpler, then Justin reconsidered and locked 4-tab — "Roster" is a noun that breaks the all-actions label pattern and hides the work; Invite (compose+send) vs Track (monitor+chase) are genuinely different modes worth separating; the white-space worry was inherited from the old standalone Manager and is minor at per-request scale. Resolution = 4-tab with count/status badges on the tab bar (e.g. Track "1 pending · ⚠1", Completed "1 to review · 1 completed"), so the bar doubles as the at-a-glance overview that Roster provided. Badge semantics: each tab surfaces **work-remaining (attention)** — Find # candidates, Invite # to send, Track # pending + ⚠overdue, **Completed # to review (amber, = returned-not-yet-marked)** — and Completed *also* shows # completed (green progress). (Justin asked S206 that "needs your attention" stay visible on Completed, not just a done-count.) Every sub-panel's rows are generated from the same per-request counts so row-count and badge never drift. Default landing is **state-aware** — the earliest funnel step with outstanding PD work (Invite if shortlisted-but-unsent, Track if invited/in-flight, Completed if reviews are back awaiting completion, Find if nothing started); a fixed "always Track" would skip the actionable Invite state. 3-tab kept behind a compare toggle in the mockup only.
- **"Closeout" disambiguated (S206).** The word was overloaded across two scopes. The per-REVIEWER step (PD reads the returned review and marks it done) is now **"Completed"** — record-keeping only, **NO trigger and NO drop-off** (option a, settled 2026-05-31; see Honorarium note below). The whole-REQUEST endpoint is a separate concern (below).
- **Request endpoint = read-only "Status" tab, NOT a PD decision.** Justin: staff only *recommend*; the BOARD decides approve/decline and it is entered into Dynamics by someone else. So the top-level final tab is a read-only reflection of the proposal's own lifecycle string `akoya_requeststatus` on `akoya_request`, not an editable PD field. The value set is documented (don't re-flag as "unverified") BUT it is a **living taxonomy — enumerate live at query time, never hardcode a value list** (per `docs/DATAVERSE_POWER_TOOLS_DESIGN.md`; values get added/deactivated/duplicated; a value absent from the live map ⇒ UNCLASSIFIED, not a guess). That doc's value→class map (`scripts/probe-akoya-status-predicate.js`, 2026-05-16) keeps **probe-proven** and **inferred** explicitly separate: Pending-family (Concept / Phase I / Phase II Pending, Pending) ⇒ in-flight (probe-clean, 0% leakage); a decided-terminal class with probe-proven examples (Approved, Denied, *Declined, *Ineligible, Closed, *Done); and a **user-attested ambiguous-middle** (Active = awarded-in-performance, Proposal Not Invited = triage-decline, Withdrawn — S158, inferred intent labels, NOT probe-proven). Treat the lists as examples, not an exhaustive enum. ([[project-grant-lifecycle-states-confirmed]] surveyed only the pending stages on 2026-05-01; the terminal classes were enumerated later in the Power Tools probes — consistent, not contradictory.) This is **distinct from** (a) the reviewer-level closeout fields on `wmkf_appreviewersuggestion` (`wmkf_reviewstatus=complete` + `wmkf_completedat`, deployed S196; honorarium linked via `wmkf_HonorariumRequest`, shipped 2026-05-28) — reviewer-scoped, and they do NOT drive this request-level tab — and (b) `wmkf_phaseiistatus` (a separate Phase-II-specific field, often null). Still tentative — Justin isn't sure yet what else belongs at the request endpoint.
- **Screening is backend-automated, not a Workbench tab.** Integrity Screener, WMKF Expertise, Funding Analysis live in the Tools menu (manual, on-demand) only.
- **Virtual Review Panel → Tools menu, labeled beta** (in dev, not part of this cycle).
- **Workbench tab strip (current mockup state):** Overview · Proposal · Initial Writeup · Reviewers · Reviews · Pre Site Visit Writeup · Site Visit · Final Writeup · Status · Awardee. Three writeup stages mirror the lifecycle (Initial = Phase I-form/early; Pre Site Visit = Phase II-form, folds in reviews; Final = post-site-visit). Initial + Pre-visit reuse existing phase-i/phase-ii-writeup engines.
- **Lifecycle extends PAST the board decision — post-award stage (new feature S206, see [[project-awardee-onboarding]]).** `Status` is NOT terminal; after the fund decision + GAL (a Dataverse status change) comes awardee onboarding: foundation-written abstract approval + artwork upload + release form. Same shape as the reviewer flow → **reuses the external-interaction primitive (`lib/external`); reviewer is instance #1, awardee is instance #2.** The PD-facing Awardee/grantee-deliverables workflow is now built; remaining work is GAL-trigger/status-field discovery and any separate external awardee portal or automation scope.
- **Tier-stitching positions taken in the mockup:** default home = cycle dashboard (not the launcher; launcher demoted to a "Tools" menu); context preserved via persistent cycle switcher + breadcrumbs. Tools menu mirrors current appRegistry apps; Reviewer Finder and Review Manager are now rehomed under the Workbench rather than standalone app entries. **Access (Justin Q, 2026-05-31):** the mockup shows everything, but real visibility filters by per-user app-access grants (Dataverse `wmkf_appuserappaccesses`, admin-managed; `Layout.js`→`hasAccess()`) — and that filter must extend to the per-request Workbench TABS, not just the Tools menu. **A tab can map to MULTIPLE existing grants:** the Reviewers tab consolidates BOTH `reviewer-finder` (Find) and `review-manager` (Invite/Track/Completed). **DECIDED (Justin S206): Option B — mint ONE new `reviewers` grant** replacing `reviewer-finder` + `review-manager`. **Status (S261):** legacy-only user probe passed, standalone pages/appRegistry entries retired, and API route legacy grant strings intentionally remain until a separate cleanup.
- **Tier-2 is a FAMILY of per-person role "lenses" over one cycle request list (Justin 2026-05-31; started as "two dashboards," grew to three).** Same request list, role-specific columns/actions; default landing = your primary lens. The lens-unification is a proposed framing; the surfaces are real:
  - **Reviewer lens** (what the mockup shows) = the *post-shortlist* surface, per-PD reviewer management → Workbench. Build now (D26).
  - **Triage lens** (J27) = upstream winnowing; proposal intake begins around
    2026-08-18, with up to ~300 full proposals and most never reviewed; winnows
    to the pursue-set (≈ [[project-staged-review-pipeline]]). Replaces the
    triage spreadsheet.
  - **Editor lens** (future) = writeup **"Reviewed"** tracker for the writeup-collaborator set (PDs + CSO + President). Per-person ("reviewed N of M"); same shape as the reviewer "Completed" tab but for editors. The President only looks at writeups, so this is effectively her whole cycle view. **Tracking, NOT a gate (Justin 2026-05-31)** — sign-off was never rigorously enforced (often just a "I looked at your writeups" email). Its real job is to **resolve the silent case**: writeups use track-changes, so "has edits" is visible, but *no edits* is ambiguous (reviewed-nothing-to-change vs not-yet-looked). So: an **explicit per-editor "Reviewed" marker** (the signal track-changes can't give) + **track-changes presence as a secondary auto-hint** ("has edits", derived from the SharePoint Word doc, not stored). Row per editor: untouched / has edits / reviewed. "Reviewed" reads truer than "Sign-off" (not an approval gate). NEW data: the marker is per-`(editor, writeup)` (new Dataverse child/records). STILL OPEN: granularity (per request vs writeup-stage); personal view vs a who-reviewed-what matrix (Sarah).
  - Flow: triage → winnow → reviewer (manage reviewers) → … → editor (writeup "Reviewed" tracking) → board.
  - **The winnowing is a concrete staff funnel, currently a SPREADSHEET (Justin 2026-05-31).** D26 example: Phase I long list **~200 → ~32 → ~28** intended to invite to Phase II; the final set is advanced AS A GROUP. So the J27 triage dashboard's core job is precise: **replace that spreadsheet** — long list → short list → final list, ending in an **advance-the-group** action (which in J27 is the real phase trigger that hands the set to the reviewer dashboard). Note volumes differ by cycle: D26 Phase I long list ≈ 200; J27 single-submission inflow up to ~300. Consequence for the #2 actionability work: the reviewer dashboard's rows stay **reviewer-centric** (find→invite→track→approve&pay); the 300-proposal triage actionability is a SEPARATE future design, do not jam it into the reviewer dashboard.
- **D26 (current, dual-phase) temporary patch.** D26 is the current cycle; Phase I→II flip ~mid-June 2026 (single-submission begins J27). In the dual-phase model, Phase II = the already-winnowed set (Phase I committee advanced them), so the reviewer dashboard fits D26 **as-is** — no triage dashboard needed for D26. Plan: ship the reviewer dashboard for D26 as a fenced, throwaway-OK patch, and **populate PD dashboards before mid-June** so PDs start finding reviewers at-risk (board recommendations known early; overturns rare).
  - **Early-populate mechanism — DECIDED (Justin 2026-05-31): a manual request-number allowlist. No Connor needed for D26.** The dashboard reads an explicit list of "going-forward" request numbers as the working set and pulls those `akoya_request` rows from Dataverse **regardless of `akoya_requeststatus`** — i.e., bypass the status gate with the list instead of advancing status. This is deliberately chosen over advancing `akoya_requeststatus`='Phase II Pending' early, because that value is a live PA trigger (intake recompute per `INTAKE_PORTAL_DESIGN`/`DRAIN_PLAN`) and advancing it early would fire downstream automation prematurely. Justin supplies the list.
  - **List storage = committed config array (settled).** Staff advance the final set AS A GROUP once Phase I winnowing finishes (no trickle, per Justin 2026-05-31), so it's a one-shot batch — a single commit with the ~28 request numbers when Justin hands them over. No admin-editable UI needed (the earlier "upgrade if it churns" hedge assumed incremental adds, which don't happen).
  - **Verify-before-relying (don't assume):** confirm dashboard *visibility* is the ONLY thing gated on grant status — grep the reviewer/invite/honorarium-on-accept paths to confirm none hard-requires `akoya_requeststatus`='Phase II Pending'. If one does, the allowlist alone isn't enough for that step.
  - **Fence for removal:** D26-only; delete the allowlist path when J27's real phase-trigger lands (THAT is the Connor design).

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

**The two-stage submission *process* is sunsetting** ([[project-grant-phasing-evolution]]): D26 (the current cycle) is the last cohort with a *separate* Phase I → Phase II submission; single-submission begins J27. Going forward there is **one submission, entered as Phase I**, with "Phase II" as an internal status flip (no Phase II uploads) — full materials arrive at the start; "long list → short list" winnowing still happens but on that one submission. **This simplifies the trigger model** — don't over-design dual-phase branching; build the pipeline for single-submission with internal staging labels.

---

## Artifact categorization

**Fully auto (no PD in loop):** proposal summary, peer-review summary (once reviews in), funding-gap analysis, integrity screen, fit screen + intelligence brief, reviewer candidate longlist, cover-page assembly (already automated), honorarium kickoff.

**Auto-draft, PD refines:** writeup skeleton + summary sections, reviewer shortlist (auto longlist + scoring; PD picks 5), Virtual Review Panel outputs.

**Human-only:** site visit notes, internal deliberation outputs, final scored conclusions.

---

## Landing dashboard (locked S194, unchanged S195)

- PD identity from session (`dynamics_systemuser_id`), no PD picker.
- Cycle dropdown, defaults to current open cycle.
- Scope dropdown: My-lead / My-lead-or-backup / All — **a personal filter, NOT a security boundary** (S206; the SHAPE below is Justin's decision, but two access BOUNDARIES are still OPEN — see end of bullet. Section revised 3×). The Phase II silo is **partial**: reviewer *management* is the lead PD's domain, but Phase II *content* (proposal, returned reviews, docs) is needed by the whole team for in-depth evaluation. So gating is at the **TAB** level, not the dashboard:
  - **Reading is team-open** (decided: managing reviewers ≠ reading reviews) — a team member can browse all requests + open any request's content. My = your action queue; All = browse everything. Default scope = My if named on ≥1 request this cycle, else All.
  - **The Reviewers *management* tab (Find/Invite/Track/Completed) is the gated surface** — the ONE "assigned PD's domain" piece; everything else open.
  - Concepts: `reviewers` grant (use dashboard + read) · PD-ownership (`wmkf_programdirector`=lead per [[project-akoya-request-pd-fields]] — populates My AND gates the management tab). The earlier "All is oversight-gated / regular PDs My-only" and the separate "review-oversight grant" are SUPERSEDED — reading is open; Sarah's tracking need is met by open reading, not a special capability.
  - **Writeups are COLLABORATIVELY edited (S206 add):** near cycle-end, all PDs + CSO + President jointly edit writeups (today in SharePoint). So a THIRD access concept — **writeup-collaborator** — leadership-inclusive, broader than the reviewer team, distinct from `reviewers` and lead-PD. New personas: CSO, President (edit writeups, not reviewer-dashboard users). Build lean: **embed/deep-link the SharePoint-backed writeup doc** (native Office co-authoring + SharePoint perms), not in-app collaborative editing — the request view gives context+entry, editing rides on SharePoint. (Refines "Workbench obviates the parallel folder": removes the folder-hunt + filename-join brittleness, but co-authoring can stay on SharePoint.)
  - **OPEN access boundaries (NOT settled — do not implement as final):** (1) team-open read set *assumed* = all `reviewers` grant-holders, unconfirmed; (2) reviewer-management = lead PD only vs backup/co-PD (+ superuser assumed); (3) writeup-edit enforced by SharePoint doc perms vs a new app capability, and whether CSO/President get a light request-view entry vs just doc access; embed vs in-app editing (lean embed). All await Justin.
  - **Request dossier (Justin wants this):** clicking a request # opens the read-only projection of the request (proposal, reviews, docs) — team-open; Reviewers tab shows only for the lead PD. Likely UX: lightweight modal for a peek + full Workbench page for deep work. "Request # → dossier" is a reusable link primitive.
  - Phase I collaboration ("every PD has input") is a SEPARATE upstream surface (triage); this dashboard is Phase II.
- Status filter implemented as `isActionableForPD(request)` policy function (rules deferred).
- Strict cycle filter; deferred-from-prior-cycle handled at data layer not UI.
- Row content: still open. S195 user direction was to compact the LEFT side (number + cycle on one line: `#1002279  J26`; institution above PI line: `PI: Mike Pluth`) so the right side can carry actionability cues. Same compact identity unit reused as the persistent header on every Workbench tab.

---

## Reviewer-lifecycle slice = Workbench v1 (build target)

**Why this slice first:** needed for D26 Phase II peer review (real deadline, ~mid-June 2026 Phase I→II flip with BILL honoraria); needed for every future cycle as the post-shortlist surface; survives the Phase I sunset; most code-broken piece today.

**Tabs — DECIDED S206: 4-tab + status badges; built as 5 sub-tabs (Candidates added S211); now COLLAPSED to 3 (Find · Invite Reviewers · Track Reviewers, S280).** Default landing is state-aware (earliest funnel step with outstanding work; see the S206 decisions block above), not a fixed tab. The four below are the S206 design; the build added a **Candidates** saved-roster sub-tab between Find and Invite (later renamed "Invite Reviewers"; component `CandidatesPanel.js` → `ReviewerInvitePanel.js`, S291).
- **Find** — candidate discovery (current Reviewer Finder behavior, request-aware). Badge: candidate count.
- **Invite** — build shortlist + compose/dispatch invitations. Badge: # shortlisted candidates awaiting dispatch (matches the count shown in the panel).
- **Track** — confirmed/pending/declined, materials state, review-in-progress, overdue chasing — the home base once invites are out. Badge: pending count + overdue (⚠).
- **Completed** (was "Closeout" / "Approve & Pay" — renamed S206) — per-reviewer: read the returned review and mark it complete. Sets `wmkf_reviewstatus=complete` + `wmkf_completedat`; **no trigger, no drop-off** (see Honorarium note). Badge: "# to review" (amber, returned-not-marked = attention) + "# completed" (green progress).

The badges on the tab bar recover the at-a-glance "where is everyone" overview that the rejected 3-tab Roster consolidated into one table — without giving up the descriptive action labels. The 3-tab alternative (Find / Roster / Completed) is kept behind a compare-only toggle in the mockup.

**Honorarium is NOT a PD-facing tab, and the Completed tab does NOT pay anyone (option a, settled 2026-05-31).** Completed maps to **existing, deployed** fields on `wmkf_appreviewersuggestion`: PD marks done → `wmkf_reviewstatus = complete (100000004)` + `wmkf_completedat` (S196, prod 2026-05-28). `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md` originally intended the field as record-keeping with the dashboard filtering completed rows OFF — but **S206 overrides the drop-off: completed rows stay visible; cycle-scoping handles cleanup (next cycle = clean dashboard; reopen a past cycle to review).** NO automation reacts to completion. Honorarium provenance = the `wmkf_HonorariumRequest` lookup on `wmkf_appreviewersuggestion` (**SHIPPED 2026-05-28** per [[project-bill-honorarium-integration]] — NOT owed, NOT on `wmkf_potentialreviewer`). Payment-eligibility keys on `wmkf_reviewreceivedat` (reviewer submitted) + staff remit gate `wmkf_authorizationtoremitpaymentflag`. The earlier "should PD closeout gate payment?" question is **CLOSED — no**: option a keeps the existing payment path untouched.

**BILL chunk 5 is NOT absorbed by Workbench** (correction from earlier S195 thinking). Stage 2a address-capture lives on the external reviewer surface (`/external/review/[token]/accept`) — that's the reviewer entering their address during accept, not a PD action. Workbench just sees the consequence (a confirmed reviewer with address on file). Chunk 5 ships on its own timeline against `/external/*`.

**Reviewer Pool** ships alongside Workbench v1 as the request-agnostic surface — browse roster, richer Dataverse context than the W6-retired Database tab had (past invitation history, honorarium state, contact-promotion status, affiliation history, conflicts).

---

## Workflow signals from Connor's parallel SharePoint folder (S195)

The reason this redesign is now urgent: Connor maintains a parallel SharePoint folder per cycle (`<Institution>_<RequestNumber>` pattern) because AkoyaGo's proposal-reading UX is painful. Inside, `00_All Staff Versions/` holds PA-merged PDFs (intake docs + DB cover page; already automated); `0_MR Scored Write Ups/` holds Word templates the PD fills in, filename-keyed by request number for PA routing. `000_Book Materials/` is post-review board-meeting assembly. **The Workbench obviates the per-request folder workflow** — proposal viewer + writeup composed in-app eliminates both the read-pain workaround and the filename-as-join-key brittleness. (MR = Medical Research; SE = Science and Engineering; may blur in coming years.)

---

## Build sequence

- **Now (S196 → mid-June 2026):** Reviewer-lifecycle slice as Workbench v1 + Reviewer Pool. URL pattern is the holistic one (`/workbench/[requestId]/...`) even though only one functional area lands.
- **Next cycle (J27, single-submission):** the upstream triage / cycle dashboard
  (winnow up to ~300 proposals beginning around 2026-08-18; ≈
  [[project-staged-review-pipeline]]) + automation tier (proposal-submitted
  fan-out, artifact materialization) + writeup tab + analyses tabs. The first
  draft-functional gate is the human-in-the-loop Initial Assessment pilot on
  2026-08-10; the governed artifact spine and Initial Assessment now precede
  Pre-Site implementation.
- **Holistic Workbench is the destination**, built incrementally tab-by-tab as the automation tier matures.

---

## Deliverable next: scoping doc

`docs/REQUEST_WORKBENCH_SCOPING.md` (or similar) — Connor/Sarah-shareable. Captures: holistic architecture; phasing change; reviewer-lifecycle v1 in detail (URL, tabs, what they do, what they replace, integration points with shipped reviewer infra); artifact-storage inventory pass (what's in Dataverse already, what's missing); explicit out-of-scope-for-v1 list (writeup, analyses, triage surface).

S206 settled the reviewer tab-structure fork — DECIDED 4-tab + status badges (briefly 3-tab, then reconsidered and locked) — and disambiguated "Closeout" (reviewer-level → "Completed", no trigger/no drop-off; request-level → read-only "Status"). **Scoping doc written 2026-05-31: `docs/REQUEST_WORKBENCH_SCOPING.md`.** Two items that were tracked as open are now closed: the "approve→payable field owed to Connor" (stale — closeout fields already deployed) and the PD-closeout-gates-payment question (option a — no trigger). Remaining open: PD dashboard row content; J27 phase trigger (Connor).

Related: [[reviewer-identity-fragmentation]], [[project-reviewer-finder-dataverse-entry-path]], [[project-reviewer-institution-match]], [[project-w6-table-drop-closed]], [[project-app-roadmap-2026-04-25]], [[project-bill-honorarium-integration]], [[project-grant-phasing-evolution]], [[project-backend-automation]], [[project-staged-review-pipeline]], [[project-proposal-context-extraction]], [[project-prompt-storage-strategy]], [[project-dynamics-ai-writeback]].
