---
name: akoya-temporal-axis-encodings
description: akoya_request board-cycle date and derived cycle conventions, with current Workbench cycle propagation
metadata: 
  node_type: memory
  type: reference
  originSessionId: 8050fbb7-13c6-444b-b802-c9bc7a61a3ce
  status: active
  scope: dataverse
  last_verified: 2026-10-30
---

**Verification scope:** source and checked-in dated evidence were checked on 2026-10-22; the cycle-source rules below were rechecked against source on 2026-10-30 (meeting-date retirement build step 2). Population figures below remain 2026-05-18 probe snapshots; no live Dataverse query was run.

## Recall Rule

Read this when: building any cohorting/cycle-filter or temporal-axis UI over `akoya_request` (e.g. Dataverse Bulk Export, Reviewer Finder cycle filters).

Do:
- A request's cycle is the Grant Cycle row it links to (`akoya_request.wmkf_grantcycle`), never its meeting date (owner, 2026-10-29; `docs/plans/MEETING_DATE_RETIREMENT_PLAN_2026-10-29.md`). In app code use `lib/dataverse/adapters/operations-grant-cycle.js`: `linkedCycleFilter(code)` for "in cycle X", `noLinkedCycleFilter()` for "No cycle", `linkedCycleExpand()` on the read, `linkedCycleCode(row)` for membership. Every read whose rows reach `linkedCycleCode` must carry the expand, or the row silently has no cycle. No meeting-date fallback; a gap is fixed in Dynamics data.
- No link, or a link to a historical (non-J/D) row, means no cycle; never coerce it into a cycle. Surface it explicitly where the consumer supports that path. `meetingDateToCycleCode` / `cycleCodeToOdataFilter` remain in `lib/utils/cycle-code.js` for scripts and the Test Request Factory only (Factory moves in build step 5).
- In Workbench, use the shell-supplied cycle for Final Writeups and Initial Assessments. Final Writeups has an explicit selector and a manual newest-cycle fallback when no usable rows are available; that fallback does not automatically select a cycle. Awardees shares the shell cycle and offers last-decided as an alternative (`shared/components/workbench/WorkbenchShell.js:77-147,297-329`; `shared/components/workbench/InitialAssessmentsPanel.js:21-56`; `shared/components/final-writeups/FinalWriteupsViews.js:552-578,633-694,805-814`).
- Use `wmkf_meetingdate` only as a date (display, ordering) until the later retirement steps move those too; Board dates come from the cycle calendar (`listBoardDates`).

Do not:
- Expose `akoya_fiscalyear` as a separate filter axis (it's just month+year of `wmkf_meetingdate`). Expertise Finder's proposals query and request search use the link filter; an unknown cycle label is a 400. `save-candidates` stamps suggestion rows with the linked code (the read was broken from 2026-09-08 until build step 2 fixed it).
- Treat `Jxx`/`Dxx` as a schema invariant: it is a June/December convention and other months return null. Whether a view drops or separately exposes those rows depends on that consumer; check it.
- Conflate `wmkf_meetingdate` (board-cycle) with `akoya_decisiondate` (approval-stamp/business-history axis).

Ground truth: `lib/dataverse/adapters/operations-grant-cycle.js` (link helpers), `lib/utils/cycle-code.js` (code parsing and default-cycle rules); `scripts/probe-akoya-meetingdate-by-type.js` + evidence `docs/atlas/evidence/akoya-meetingdate-by-type-2026-05-18.txt`; build-plan §9. Related: [[dataverse-export-floor-scoping]].

**Default cycle and Workbench propagation (owner decision 2026-09-08, S499; source checked 2026-10-22).** The historical owner rule chose a program's working cycle by default, with a last-decided alternative where appropriate, independently of the caller's assignments. The dashboard cycle-list response supplies `defaultCycleCode` and `lastDecidedCycleCode`; WorkbenchShell loads it, uses an explicit URL cycle when present, otherwise applies `defaultCycleCode` and records the resolved cycle in the URL. It passes the selected shell cycle into Final Writeups, Initial Assessments, and Awardees. Awardees offers last-decided as a user-selectable alternative; do not describe it as automatically receiving the last-decided cycle.

Since build step 2 of the meeting-date retirement (2026-10-30), the Workbench dashboard, Awardees and program-briefing cycle lists hold the linked codes present in that surface's requests, each dated by the calendar Board date (`listBoardDatesOrNone`); when the calendar read fails the list still loads and the default resolves by month.

Initial Assessments consumes the shell cycle. Final Writeups has an explicit cycle selector and a manual newest-cycle fallback for its empty/no-row state; it does not automatically walk cycles to choose one. Do not reuse earlier implementation notes that Final Writeups or Initial Assessments independently select an artifact-row cycle.

The older PR #183/203 rollout notes, program-scoped consistency rule, cycle-list endpoint details, and retired local-time/upcoming helpers are retained as historical design context. Check the current endpoint before changing cycle-source behavior. `conventionalCycles(today)` remains an explicit fallback for callers that have no existence-aware cycle list.

**Dated population snapshot (S162, 2026-05-18):** `wmkf_meetingdate` was populated on 99.5% of all rows and about 100% of named process rows, including Discretionary (1/5,345 missing; migrated Discretionary 0/4,749). The missing tail concentrated in untyped/in-flight Pending rows. These figures are from `docs/atlas/evidence/akoya-meetingdate-by-type-2026-05-18.txt`, not current population claims.
Related: [[dataverse-export-floor-scoping]]

## Historical implementation snapshot — superseded design notes (source state reviewed through S499)

The following body is preserved verbatim from the prior memory. Its rollout assumptions and consumer predictions are historical; use the Recall Rule and current Workbench propagation above for current guidance.

On `akoya_request`, `wmkf_meetingdate` is the single canonical temporal field for board-cycle work. There are not multiple independent time dimensions for cohorting — there is one, with three encodings:

- **Raw meeting date** — `wmkf_meetingdate` (DateOnly, Bucket A, ≥97% both eras, era-robust).
- **Fiscal year** — the stored string `akoya_fiscalyear` (e.g. `"December 2026"`) is *just* the month name + 2-digit year of `wmkf_meetingdate` (user-confirmed, S162). It is not an independent dimension.
- **Grant cycle** — `Jxx`/`Dxx` codes derive from `wmkf_meetingdate` via `lib/utils/cycle-code.js` (`cycleCodeToOdataFilter(code, field)` compiles a code to a `wmkf_meetingdate` range).

🔴 **The cycle code is a living CONVENTION (twice-yearly, June/December), NOT a schema invariant.** The board has met in June + December for many years, but a meeting in any other month (e.g. May) is possible and must be handled fail-loud. Verified current behavior (S162, `cycle-code.js`): `meetingDateToCycleCode()` returns `null` for any non-June/December month (line 32); `parseCycleCode()` only accepts `[JD]` codes (line 41). Net: an off-cycle meeting is **silently uncohortable in both directions** — no code can express it, and it silently vanishes from any cycle-grouped view. The file comment codifies this as intended ("treat … outside those months as not having a cycle") — i.e. a latent silent-drop, the exact plausible-wrong-output failure Track B exists to prevent. Latent risk also lives in any existing cycle-filtered live code (e.g. Reviewer Finder `my-proposals.js` / `reviewer-suggestion.js findByPD`) — verify before relying on cycle filters there; do not blanket-"fix" without checking callers.

Design consequence for Dataverse Bulk Export / any cohorting UI:
- Do **not** expose fiscal year as a separate filter axis competing with meeting date — it collapses into the grant-cycle axis.
- `wmkf_meetingdate` (raw range) is the **canonical, fail-safe handle** — no month assumption, so a May meeting filters fine through it. Cycle is the *friendly form*, meeting-date range is the *ground truth + safety net*. **Verified S162** (`scripts/probe-akoya-meetingdate-by-type.js`, evidence `docs/atlas/evidence/akoya-meetingdate-by-type-2026-05-18.txt`): meeting date is populated on **99.5%** of all rows and ~**100% of every named process incl. Discretionary** (Discretionary 1/5,345 missing, that one `Pending`; migrated Discretionary 0/4,749). The ~0.5% no-meeting-date residue is NOT a giving-type hole — it concentrates in already-`wmkf_type`/`wmkf_request_type`-null rows + in-flight `Pending`. So the `UNCLASSIFIED cycle` sentinel is for that expected untyped/pending tail, not a hidden process exclusion. (Settles the recurring "do discretionary awards get a meeting date?" doubt — yes.)
- A cycle-cohort path MUST surface an off-month/`null`-cycle meeting **loudly** (an `UNCLASSIFIED cycle` sentinel per build-plan §9) — never coerce to a nearest cycle, never silently drop.
- Prefer compiling a cycle filter to a `wmkf_meetingdate` *range* (via `cycleCodeToOdataFilter`) rather than string-matching `akoya_fiscalyear`: the string is sparser and not era-robust, whereas meeting date is Bucket A. Fiscal year as a string (`"May 2027"`) degrades gracefully for off-months; the brittleness is *only* the cycle-code path.

Distinct from `akoya_decisiondate`, which is the *business-history / approval-stamp* slice (era-dependent presence, the `[[dataverse-export-floor-scoping]]` `dateBasis` axis) — meeting date is the *board-cycle* handle. Do not conflate the two temporal axes.

**Default cycle (owner decision 2026-09-08, S499).** Which cycle a surface opens on is a pure
function of the calendar and the cycles that exist — never of the caller's assignments or of what
is visible to them. `lib/utils/cycle-code.js` `resolveWorkingCycle` (earliest meeting on/after today;
September → D26) and `resolveLastDecidedCycle` (newest meeting before today; September → J26) are
the only default-cycle rules; `conventionalCycles(today)` supplies the June/December codes to
the callers with no list (the grantee-titles cron and, since S499, the Expertise Finder Batch tab —
explicit fallbacks, not existence-aware).
Awardees = last decided; every other Workbench view = working. UTC throughout. The precise
invariant is PER GRANT PROGRAM: two callers viewing the same program on the same day open on the
same cycle (the cycle list is program-scoped by the PR #183 owner decision). **Wired (PR #203):**
`/api/workbench/dashboard` cycle-list mode returns `defaultCycleCode` (working) and
`lastDecidedCycleCode` from that program's cycle list with each cycle's latest `meetingDate`,
replacing the "caller's assigned cycle" rule; Reviewer follow-up inherits it. The Awardees page
reads `lastDecidedCycleCode` from ITS OWN endpoint's cycle-list mode
(`/api/workbench/grantee-deliverables/awardees` without `cycleCode`), computed over the exact
research-awardee eligibility population the row query uses — not from the dashboard, whose list is
per-caller-program (deep link wins; a manual selection during resolution wins; explicit empty state
when no decided cycle has awardees). The two disagreeing calendar helpers (Awardees local-time "last past",
grantee-titles cron UTC "upcoming") are retired. **Not yet wired:** Final writeups still walks
back to a visible row (2026-09-06 decision, superseded 2026-09-08 in favor of an in-place message
with a link — to be applied with the single-page shell) and Initial assessments still defaults to
the newest artifact row.

Related: [[dataverse-export-floor-scoping]]
