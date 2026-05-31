# Request Workbench & Cycle Dashboards — Scoping

**Per-PD navigation model for the grant lifecycle: the D26 patch and the J27 build.**

> **Status:** Draft for discussion (Connor / Sarah). Drafted 2026-05-31 (Session 206) from the clickable mockup at `docs/mockups/lifecycle-ui-mockup.html` and a working session with Justin. Captures decisions that are **locked**, plans that are **proposed**, and dependencies that are **open**. No `/workbench` UI, routes, or write-paths exist yet — but one piece of **schema groundwork is already deployed**: `wmkf_appreviewersuggestion.wmkf_completedat` (the PD-closeout timestamp; wave5, prod 2026-05-28). See §3.4 / §6.
>
> **How to read this:** §1–§5 are for everyone. §6 (dependencies) is where Connor's items live. §7–§8 are scope fences and technical detail you can skim. Where a claim depends on live Dynamics/Dataverse state it is marked `[verified]` or `[open]`.

---

## 1. Why we're doing this

The research apps were each built at a different time, under different constraints (before Dynamics access → after; ad-hoc cycle tracking → the cycle entity; `.eml` downloads → in-app email). Individually they work; together the seams show. Three pressures make a unifying redesign worth doing now:

1. **Reviewer Finder + Review Manager are the most broken pieces**, and they're exactly what the current cycle (**D26**) needs for Phase II peer review (real deadline, Phase I→II flip ~mid-June 2026, with BILL honoraria attached).
2. **Phase I triage runs in a spreadsheet today.** It works, but it's off to the side and disconnected from everything else.
3. **The next cycle (J27) changes shape and volume.** Single-package submission means the full proposal set — **up to ~300** — arrives at once (~Dec 2026), and **most are never sent for outside review**. The current reviewer-first tools don't fit that funnel.

The goal is a coherent, per-PD home for the whole lifecycle, built incrementally — starting with the piece D26 needs.

---

## 2. The model, in one picture

Three tiers, with the **request** as the spine:

```
TIER 1  Global launcher → demoted to a "Tools" menu
        (Reviewer Pool, Dynamics Explorer, Dataverse Bulk Export, Grant
         Reporting, Expense Reporter, Admin, + standalone forms of the
         per-request apps for off-cycle / ad-hoc use)
                              │
TIER 2  Cycle-scoped, per-PD dashboards  ── TWO of them (see below)
                              │
TIER 3  Per-request Workbench  (/workbench/[requestId]/…)
        every per-request operation becomes a tab, pre-loaded with the proposal
```

**The key refinement (this session): there are TWO tier-2 dashboards, not one.**

| | Triage / cycle dashboard | Reviewer dashboard |
|---|---|---|
| **Job** | Run the Phase I winnowing funnel; decide what advances | Find, invite, track, and pay reviewers for what advanced |
| **Volume** | The whole inflow (J27: up to ~300) | Only the advanced set (D26: ~28) |
| **Replaces** | The triage **spreadsheet** | Reviewer Finder + Review Manager |
| **When** | J27 build | Build now (D26) |
| **Mocked?** | Not yet | Yes — `docs/mockups/lifecycle-ui-mockup.html` |

**Flow:** `triage dashboard → (winnow → advance the group) → reviewer dashboard → per-request Workbench`.

Standalone apps don't disappear — they live in the Tools menu for off-cycle/ad-hoc use, and the per-request ones *also* appear as a Workbench tab pre-loaded with that proposal (same engine, two doors).

---

## 3. The reviewer dashboard (build now, for D26)

This is the surface that's mocked and the near-term build target.

### 3.1 Request queue (tier 2)
- PD identity from the signed-in session — **no PD picker**.
- **Cycle** selector (defaults to the current open cycle).
- **Scope** filter: My (lead PD) / My (lead-or-backup) / All — defaults to "My."
- Each row: a compact identity unit (request # + cycle + program, institution, PI) on the left, and an **actionability cue** on the right ("what needs me now"). *(Exact row content is still open — see §6.)*

### 3.2 Per-request Workbench (tier 3)
URL `/workbench/[requestId]/…`. Tab strip (current mockup state):

`Overview · Proposal · Initial Writeup · Reviewers · Reviews · Pre Site Visit Writeup · Site Visit · Final Writeup · Status`

Each tab is an existing capability re-homed and pre-loaded with the proposal. Three writeup stages mirror the real lifecycle (Initial = Phase I form, early; Pre Site Visit = folds in returned reviews; Final = folds in site-visit findings). Initial + Pre-visit reuse the existing Phase I / Phase II writeup engines. **The Reviewers tab is the v1 build; the rest are placeholders that land as the automation tier matures.**

### 3.3 The Reviewers tab — locked structure
**Four sub-tabs, with status badges on the bar** (decided S206, after comparing a 3-tab "Roster" variant):

| Sub-tab | What it does | Badge (work remaining) |
|---|---|---|
| **Find** | AI + database candidate discovery, request-aware (replaces Reviewer Finder) | # candidates |
| **Invite** | Build shortlist, compose + dispatch invitations | # awaiting dispatch |
| **Track** | Confirmed / pending / declined, materials, overdue chasing | # pending · ⚠ overdue |
| **Completed** | Read the returned review and mark it complete. Record-keeping only — no trigger, no drop-off (see §3.4). | # completed |

- The badges make the tab bar an **at-a-glance overview** ("where is everyone"), so the four-tab split costs nothing in scannability.
- **Landing is state-aware:** open on the earliest step with outstanding work (Invite if shortlisted-but-unsent, Track if invites are out, Completed if reviews are back awaiting sign-off, Find if nothing's started).

### 3.4 "Closeout" disambiguated
The word was overloaded. It now splits into two **different** things at two scopes:
- **Completed** — *per reviewer.* The PD reads the returned review and marks it complete. This maps to **existing, deployed** fields on `wmkf_appreviewersuggestion`: set `wmkf_reviewstatus = complete (100000004)` and stamp **`wmkf_completedat`** (added S196, prod 2026-05-28).
  - **Settled (S206, option a — no payment trigger):** completion is **record-keeping only — nothing reacts to it.** Payment-eligibility stays on its existing path: `wmkf_reviewreceivedat` (set when the **reviewer submits**) signals eligibility, the `wmkf_HonorariumRequest` lookup (shipped 2026-05-28) links the honorarium, and staff hold the final remit gate (`wmkf_authorizationtoremitpaymentflag`). The tab is named **"Completed"** (not "Approve & Pay") precisely so it doesn't imply it pays anyone. Its badge is a **done-count** ("how many are completed").
  - **No drop-off:** completed rows are **not** filtered off the dashboard (this overrides the original S196 "row drops off at `wmkf_completedat`" intent). Cleanup is handled by **cycle-scoping** — the next cycle starts with a clean dashboard, and a finished cycle is reopened from the cycle switcher if needed.
- **Status** — *per request.* A **read-only** reflection of the proposal's own Dynamics lifecycle status (`akoya_requeststatus`). Staff *recommend*; the **board decides** approve/decline and it's recorded in Dynamics elsewhere. The Workbench only displays it.

These are unrelated fields at different scopes and must not be conflated.

### 3.5 What ships alongside
- **Reviewer Pool** — a request-agnostic roster (browse reviewers, past invitation history, honorarium state, affiliations). Richer than the retired Database tab.

---

## 4. The triage / cycle dashboard (J27)

Not mocked yet; defined here so the two dashboards relate cleanly.

**Core job: replace the Phase I triage spreadsheet.** The winnowing is a real, structured funnel — this cycle roughly **~200 → ~32 → ~28** (long list → short list → final set to invite to Phase II). The dashboard runs that funnel in-app, per PD, with tasks across the whole grant cycle and access to re-homed versions of the existing apps, and ends in an **advance-the-group** action.

That advance action is where the **phase trigger** fires: it flips the advanced set into the working Phase II state and hands them to the reviewer dashboard.

This is the home of the previously-separate "staged review pipeline" idea (fit screen → intelligence brief → panel), now anchored as the upstream half of the model.

---

## 5. Two cycles, two paths

The current and next cycles have different shapes, so the rollout differs.

### D26 — current cycle, dual-phase (build now)
- Applicants still submit a separate Phase I then Phase II document. Reviewer-finding happens at Phase II.
- Because the Phase I committee has **already winnowed** to the ~28, **Phase II is the pursue-set** — so the reviewer dashboard fits D26 **as-is, with no triage dashboard needed.**
- **Pre-populating early (at-risk):** PDs want to start finding reviewers *before* the formal mid-June flip — recommendations are known early and board overturns are rare. Mechanism (decided): a **manual allowlist of the ~28 going-forward request numbers.** The dashboard shows those requests regardless of their `akoya_requeststatus`.
  - **Why not just advance the status early?** Because `akoya_requeststatus = 'Phase II Pending'` is a **live PowerAutomate trigger** (intake recompute). Flipping it early would fire downstream automation prematurely. The allowlist sidesteps that entirely and touches nothing in Dynamics.
  - **Storage:** a committed config list. The ~28 are advanced as a group once winnowing finishes (no trickle), so it's a one-shot entry — no admin UI needed.
  - **Clean by construction:** removing a number just removes dashboard visibility; there's no status flip to reverse. (If a removed request had reviewer work started at-risk, those records persist in Dynamics — a non-issue given rare overturns.)
  - **No Connor dependency for D26.**
  - **Verified [verified, 2026-05-31]:** only the proposal-picker query (`pages/api/reviewer-finder/my-proposals.js`) gates visibility on `'Phase II Pending'`. The reviewer-invite, external-review, honorarium-on-accept, and upload paths have **no** dependency on grant status, so an allowlist that augments that one query is sufficient — nothing downstream secretly requires the real status.

### J27 — next cycle, single submission (later build)
- One submission, entered as "Phase I"; "Phase II" becomes an **internal status flip**, not a new document.
- Full proposals (~300) arrive ~Dec 2026; most are never reviewed → the **triage dashboard** is required as the entry point.
- The **real phase trigger** (Connor's design) replaces the D26 allowlist. When it lands, the allowlist path is deleted.

---

## 6. Dependencies & open questions

**Connor**
- **J27 phase trigger** — how the "advance the group" action flips the internal Phase II label and notifies the reviewer pipeline, in the single-submission model. *(D26 does not need this.)*

**Reviewer closeout fields — RESOLVED (not owed; corrected 2026-05-31).** The earlier "approve→payable field owed to Connor" was stale. The closeout fields already exist and are deployed: `wmkf_reviewstatus = complete` + `wmkf_completedat` (S196, prod 2026-05-28), and the `wmkf_HonorariumRequest` lookup shipped 2026-05-28. What's genuinely open is the **policy/semantic** question, not a field:

- **Does PD closeout gate payment? — RESOLVED (S206, option a).** No. The tab is named **"Completed"**, marking it sets `wmkf_reviewstatus=complete` + `wmkf_completedat` as record-keeping only, and **nothing is triggered**. Payment-eligibility stays on its existing path (reviewer-submission `wmkf_reviewreceivedat` + staff remit gate). Completed rows stay on the dashboard (no drop-off); cycle-scoping handles cleanup.

**Open design**
- **Dashboard row content / actionability rules** (`isActionableForPD`) for the reviewer dashboard — what the right-hand "what needs me" column shows, and the rule set behind it. Reviewer-centric for v1; the 300-proposal *triage* actionability is a separate, later design (do not merge the two).
- **Status tab** — `akoya_requeststatus` is a **living taxonomy** (enumerate live, never hardcode; unknown value → "unclassified," not a guess). Its value→class map is documented in `docs/DATAVERSE_POWER_TOOLS_DESIGN.md` (probe-derived; in-flight = Pending-family, decided-terminal = Approved/Denied/Declined/Ineligible/Closed/Done/Withdrawn/etc.). The tab is tentative — what else belongs at the request endpoint is undecided.

**Locked (no longer open)**
- Reviewer tab structure (4-tab + badges); PD identity from session, no picker; the Closeout → **Completed** (reviewer, no trigger, no drop-off) / **Status** (request, read-only) split; the two-dashboard model; the D26 allowlist mechanism.

---

## 7. Scope fences

**In scope, now (D26):** the reviewer dashboard (request queue + Workbench Reviewers tab, 4-tab) + Reviewer Pool + the allowlist pre-population. This is what Phase II peer review and honoraria need by mid-June.

**Explicitly out of scope for the D26 build:**
- The triage / cycle dashboard (J27).
- The automation tier (event-driven artifact materialization).
- The non-reviewer Workbench tabs (writeups, analyses, site visit) — placeholders only.
- A real, editable Status tab (read-only display at most, if at all).

**Throwaway by design:** the D26 allowlist. It is fenced as D26-only and removed when the J27 phase trigger lands. The risk to manage is the usual "temporary becomes permanent" — hence the explicit removal note.

---

## 8. Reference

- **Clickable mockup:** `docs/mockups/lifecycle-ui-mockup.html` (open in a browser; toggle "Design notes" for rationale; the reviewer tab carries a 3-tab vs 4-tab compare toggle showing the rejected alternative).
- **Memory / background:** `[[project-reviewer-apps-redesign-direction]]` (the locked architecture + this session's decisions), `[[project-grant-phasing-evolution]]` (D26 vs J27 phasing), `[[project-staged-review-pipeline]]` (the triage-dashboard precursor), `[[project-bill-honorarium-integration]]` (honorarium flow — separate from the Completed tab; keyed on reviewer-submission + staff remit gate).

### Appendix — artifact categorization (how tabs get populated)
- **Fully auto (no PD in loop):** proposal summary, peer-review summary, funding-gap, integrity screen, fit screen + intelligence brief, reviewer candidate longlist, cover-page assembly, honorarium kickoff.
- **Auto-draft, PD refines:** writeup skeleton + summary sections, reviewer shortlist (auto longlist + scoring, PD picks the final set), Virtual Review Panel output.
- **Human-only:** site visit notes, internal deliberation, final scored conclusions.

The Workbench is a **display + refinement** surface, not a console: the automation tier materializes artifacts, the PD intervenes where judgment matters. PD-triggered regenerate is the exception, not the default.
