---
title: J27 Single-Phase Transition Inventory Plan
domain: architecture
kind: plan
status: active
summary: "Plan for agents to sweep code, docs, and memory into one register of what retires, persists, changes, or must be built for the June 2027 single-phase cycle."
canonical: false
cataloged: 2026-09-06
last_verified: 2026-09-06
owner: product-engineering
related:
  - docs/CURRENT_WORK_QUEUE.md
  - docs/SYSTEM_MODEL.md
  - docs/STRATEGY.md
  - docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md
  - docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md
  - docs/agent-wiki/topics/strategy-roadmap.md
---

# J27 Single-Phase Transition Inventory Plan

**Status:** plan approved for authoring 2026-09-06 by the owner ("collect all of these in one place, as well as have a plan for what needs to be built/changed for June 27"). The sweep ran the same day; its output is `docs/J27_TRANSITION_REGISTER.md`. Nothing in this document is a finding; it defines how findings get collected, labelled, and kept current.

## 1. Why this exists

The December 2026 cycle (D26) is the last dual-phase cycle: a Phase I application round followed by a Phase II full proposal. Concepts are a distinct pre-Phase-I stage, not a name for Phase I (`feedback-concepts-vs-phase-i`), and sweep agents must keep the two apart when categorizing hits. The June 2027 cycle (J27) is the first single-submission cycle: applicants submit one full proposal, and "Phase II" becomes an internal status flip rather than a second submission [OWNER-CONFIRMED, recorded in `.claude-memory/project-grant-phasing-evolution.md`].

Since roughly April 2026 the repo has accumulated J27 notes in at least five places: two dedicated memories (`project-grant-phasing-evolution`, `project-j27-doc-capture-evolution`), the strategy roadmap wiki page, the work queue ("Pre-J27 scale" checkpoints), and inline code comments and UI copy that name D26 or the dual-phase workflow. A repo-wide grep on 2026-09-06 found dozens of documents and memories mentioning single- or dual-phase and dozens of JavaScript files mentioning Phase I, Phase II, or Concept [VERIFIED via `grep -rl`; the hit counts move with the pattern and are not a denominator for any coverage claim]. None of these is a list. Anything that "goes away in J27" and is not written down becomes debt the day D26 closes.

The repo's own operating memory says corrections decay unless mechanized (`feedback-corrections-decay-unless-mechanized`). This plan therefore produces a register **and** a mechanism that keeps the register fed after the sweep.

## 2. Deliverables

Two documents, deliberately separate:

| Deliverable | Path | What it is | Who writes it |
|---|---|---|---|
| **Transition register** | `docs/J27_TRANSITION_REGISTER.md` | One table, stable row IDs, every J27-sensitive site in code, docs, memory, and configuration. Living document. | Synthesis agent from the sweep, then any session that touches a J27-sensitive site. |
| **J27 build and change plan** | `docs/J27_BUILD_AND_CHANGE_PLAN.md` | Sequenced work derived from the register's Build and Change rows, with the D26 close-out (Retire rows) as its final stage. | Written by hand after the register exists and the owner has answered §8. |

The register is the sweep's deliverable. The build plan is a later step and depends on owner answers, so it is out of scope for the sweep agents.

## 3. Register row schema

Every row carries all of these columns. A row missing evidence or label is rejected at synthesis.

| Column | Values / shape |
|---|---|
| `id` | `J27-###`, assigned once, never reused. |
| `category` | `Retire` · `Persist` · `Change` · `Build` · `Scale` (see §4). |
| `site` | `file:line` for code, doc path plus heading anchor for docs, memory file name for memory, or `Dataverse: <entity or prompt key>` for owner-read surfaces. |
| `excerpt` | Verbatim snippet, at most two lines, enough to find the site again after line drift. |
| `cycle dependency` | `D26-only` · `dual-phase-only` · `both cycles` · `J27-only` · `unknown`. |
| `evidence label` | `[OWNER-CONFIRMED]` (owner said so, with date) · `[SOURCE-VERIFIED]` (agent read the producing source or live behavior) · `[ASSUMED]` (plausible, unproven). |
| `owner decision needed` | `no` or a one-line question, cross-referenced to §8 when it already exists there. |
| `disposition` | `open` · `scheduled (item N in work queue)` · `done (commit)` · `rejected (reason)`. |

**Why the evidence label is mandatory.** In Session 265 the doc-capture memory asserted that the D26 filename-match bridge "will break in J27". The owner pushed back: there was no evidence, since it only breaks if PDs change naming habits. The sweep will surface dozens of speculative J27 sentences. `[ASSUMED]` is how speculation enters the register without entering the debt list; only `[OWNER-CONFIRMED]` and `[SOURCE-VERIFIED]` rows may be scheduled.

## 4. Categories

Four categories are not enough because "persist" and "scale" are where mistakes hide.

- **Retire.** Exists only for D26 dual-phase mechanics. Seed candidates, all `[ASSUMED]` until the sweep verifies them: the D26 hide of the Initial assessments view in `shared/components/workbench/WorkbenchViewsNav.js` and the D26 card in `pages/workbench/artifacts.js` that says initial assessments are "not part of the D26 dual-phase workflow"; `shared/config/d26Allowlist.js` (retired but kept); the archived concept-evaluator app in `shared/config/appRegistry.js`. The SharePoint `Phase I` subfolder filename bridge described in `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md` is a Change candidate, not Retire: the case for the `wmkf_requestdocument` registry is legibility, and there is no evidence the bridge breaks in J27 (`project-j27-doc-capture-evolution`). The intake portal is **not** a Retire candidate: its requestless submit branch already implements the single-phase pivot [VERIFIED via `pages/api/intake/submit.js:19,198` and `lib/services/intake-draft-service.js:22`], so it is a Persist or Change row.
- **Persist.** Looks dual-phase but stays valid. The reviewer-finding gate on `akoya_requeststatus = 'Phase II Pending'` is the canonical example: it is an internal status flip in J27 and must **not** be removed [OWNER-CONFIRMED via `project-grant-phasing-evolution`]. Recording Persist rows is what stops a future cleanup from deleting them.
- **Change.** Exists in both cycles but needs different behavior, copy, or defaults. Examples to test: triage set-aside semantics on the follow-up and request pages when every J27 request is a full proposal; Phase I summary templates that change length and format (`project-phase-i-summary-app-winddown`); cycle defaults such as `FINAL_WRITEUPS_DEFAULT_CYCLE_WALKBACK`.
- **Build.** Does not exist and J27 needs it. Known from memory, all `[OWNER-CONFIRMED]` as direction but not as scope: an upstream per-PD triage dashboard for up to about three hundred full proposals most of which are never sent for external review; document capture through the `wmkf_requestdocument` registry instead of filename matching; the automated materials-on-acceptance email (work queue item 6) if it is not live before J27.
- **Scale.** Fixed bounds sized for D26 volume. Every hard cap and page bound the sweep can find, including the 100-row per-cycle bound in the Final writeups dashboard, the `QUERY_ALL_REQUESTS_CAP` scan ceiling, and the "Pre-J27 scale: Initial Assessment Production write proof" checkpoint already in the work queue. A Scale row states the bound, the D26 observed volume if known, and the J27 expectation.

## 5. Search strategy: partition by source, not by keyword

Agents sweep **disjoint slices** so nothing is double-counted and nothing falls between two agents. Each agent applies the same term list and structural greps to its slice only, and reports rows in the §3 schema with the evidence label it can justify from what it read. Agents are read-only (`Explore` type); none edits the repo.

| Slice | Scope | Notes |
|---|---|---|
| A | `lib/services/**`, `lib/dataverse/**`, `lib/utils/**` | Service logic, adapters, phase gates, caps. |
| B | `pages/**` (routes and pages), `shared/components/**` | UI copy, cycle-conditional rendering, route validation. |
| C | `shared/config/**`, `scripts/**`, `tests/**`, `lib/db/migrations/**` | Config allowlists, seed and backfill scripts, tests that pin dual-phase behavior, schema comments. |
| D | `docs/*.md` (top level) | Plans, specs, runbooks. Report the heading anchor, not just the file. |
| E | `docs/atlas/**`, `docs/agent-wiki/**`, `docs/plans/**`, `docs/audits/**` | Live-state Atlas pages and wiki topics; audits may already contain J27 lists. |
| F | `.claude-memory/**`, `DEVELOPMENT_LOG.md`, `SESSION_PROMPT.md` | Memory and history; report the memory `name:` slug. |
| G (owner-run) | Dataverse-resident governed prompts, email templates, and any Power Automate flow that branches on request status or cycle | Production Dataverse reads are owner-run only. The plan lists what to look for; the owner reads and reports back. |

**Term list (every slice):** `J27`, `D26`, `dual-phase`, `single-phase`, `single-submission`, `Phase I`, `Phase II`, `Phase II Pending`, `Concept`, `concept-evaluator`, `triage`, `Set aside`, `Advancing`, `interim`, `bridge`, `FRAGILE`, `next cycle`, `future cycle`, `going away`, `retire`, `vestigial`, `pre-J27`.

**Structural greps (code slices A to C):** equality tests on a cycle code literal (`=== 'D26'`, `cycleCode ===`), `TRIAGE_STATUS` and `wmkf_triagestatus` readers, `akoya_requeststatus` string literals, `MAX_*`, `*_CAP`, `maximumRows`, `$top`, and any per-cycle configuration object keyed by cycle code.

**Exclusions.** Generic uses of "phase" (project phases, migration stages, "Stage 7") are noise; agents must confirm the hit refers to grant phasing before recording it. Historical documents (`kind: history`, `status: closed` memories) are recorded with `disposition: rejected (historical)` rather than dropped, so a later reader can see they were considered.

## 6. Execution shape

1. **Fan-out.** Six read-only agents, one per slice A to F, launched in one message. Each gets this plan, its slice, and the instruction to return rows in the §3 schema, plus a short list of hits it judged to be noise and why. Owner-run slice G is a checklist in the register with rows added when the owner reports.
2. **Synthesis.** One agent, or the session itself, merges the six reports: dedupes sites that appear in more than one slice (a doc and the code it describes are two rows linked by a `see also`), assigns IDs, downgrades any row whose evidence label the excerpt does not support, and writes `docs/J27_TRANSITION_REGISTER.md` with frontmatter and a §8 owner-question section.
3. **Verification pass.** A fresh Codex adversarial review of the register against the diff, with the specific brief: find rows labelled `[SOURCE-VERIFIED]` whose excerpt does not prove the claim, and find J27-sensitive sites the sweep missed in a random sample of five files per slice. This is the same review path the repo uses for plan and build work.
4. **Owner review.** The owner answers §8 and confirms or rejects Retire rows. Only then does anyone write the build plan.
5. **Mechanize** (§7) in the same change as the register, so the register is never a one-time snapshot.

The `Workflow` orchestration tool is an option for step 1 only if the owner asks for it in so many words; the default is the ordinary `Agent` fan-out.

Time-box: steps 1 to 3 in one session. If synthesis runs past two commits without a register on disk, stop and report per the operating rule on support work.

## 7. Keeping the register current

A sweep is a snapshot. Two lightweight mechanisms keep it fed:

- **Marker convention.** Any new code comment, doc callout, or memory line that records a J27-sensitive fact carries the tag `J27:` followed by the register ID once one exists (`// J27: J27-014 D26-only hide, retire after D26 close`). Untagged mentions found later are sweep misses, not the author's fault, and get added.
- **Check script.** `scripts/check-j27-register.js` lists every `J27:` tagged site in the tracked tree and fails when a tag names a register ID that does not exist, or when a register row's `site` no longer resolves to a file that contains its excerpt. Advisory at first, promoted to a blocking gate only if the owner wants it. Register it in `docs/CI_GATES_REFERENCE.md` and the `/start` gate list when it lands; a gate and its self-test run sequentially like every other gate.

Retire rows are candidates, not authorizations. At execution time each Retire row gets a live-caller grep and a read of the likely load-bearing paths, per the destructive-carryover rule in `CLAUDE.md`. The register records that the check happened in the `disposition` column.

## 8. Owner questions the sweep cannot answer

0. **The J27 calendar.** ANSWERED 2026-09-06: J27 proposals arrive in **early December 2026**, exact date TBD. The 2026-08-18 date carried by the phasing memory was the D26 Phase II proposal due date, not J27 intake, and has been corrected in the memories that misattributed it. Still open: the triage window, reviewer-finding window, and board meeting date, which the register needs before Build rows can be dated.
1. Do `shared/config/d26Allowlist.js` and the archived concept-evaluator app get deleted after D26 closes, or stay as historical record?
2. Does the triage set-aside control survive into J27 as a first-class filter, or does it become a request-list option only, as the 2026-09-06 follow-up toolbar assessment proposed?
3. Should the Initial assessments view remain hidden for D26 in Production until D26 closes, or be shown read-only so PDs can preview the J27 workflow?
4. Is the per-PD triage dashboard a J27 launch requirement or a nice-to-have if intake volume stays below about three hundred?

The reviewer hold step is **not** an open question: it was retired in Session 279 for reasons independent of J27, and the register should record it as `rejected (already retired)` if the sweep surfaces the old contingency.

## 9. Exit criteria for this plan

- `docs/J27_TRANSITION_REGISTER.md` exists with frontmatter, every row carrying all §3 columns, and no row scheduled unless its label is `[OWNER-CONFIRMED]` or `[SOURCE-VERIFIED]`.
- The Codex verification pass ran and its dispositions are recorded in the register.
- Section 8 answers are recorded with dates (question 0 answered 2026-09-06), or the unanswered ones are listed in the work queue as owner decisions.
- The `J27:` marker convention and check script exist and are referenced from `docs/CI_GATES_REFERENCE.md`.
- The two J27 memories and `docs/agent-wiki/topics/strategy-roadmap.md` point at the register instead of carrying their own lists.
- `docs/J27_BUILD_AND_CHANGE_PLAN.md` is a separate, later deliverable and is not required to close this plan.

## 10. Record

- 2026-09-06: plan written at the owner's request in Session 491. Work queue row added. Pointer added to `.claude-memory/project-grant-phasing-evolution.md`.
- 2026-09-06 (later): owner authorized the sweep. Six read-only agents ran slices A to F; the register was synthesized as `docs/J27_TRANSITION_REGISTER.md` (76 rows after review, seven contradictions, 25 owner questions, slice G checklist). The §7 marker convention and check script were deferred to a follow-up to keep the change docs-only; the register §9 records the gap and the plan's §9 exit criteria are therefore **not met**. Codex adversarial review of both documents returned NEEDS REWORK on five findings; four were fixed in the register and the fifth is the unbuilt check script. Dispositions are in the register's §10.
