---
name: akoya-temporal-axis-encodings
description: akoya_request has ONE canonical temporal field (wmkf_meetingdate); fiscal year + grant cycle derive from it; Jxx/Dxx cycle is a June/Dec CONVENTION not an invariant — off-month meetings silently drop today (fail-loud required)
metadata: 
  node_type: memory
  type: reference
  originSessionId: 8050fbb7-13c6-444b-b802-c9bc7a61a3ce
  status: active
  scope: dataverse
  last_verified: 2026-07-27 via lib/utils/cycle-code.js; population figures remain dated 2026-05-18 probe snapshots
---

## Recall Rule

Read this when: building any cohorting/cycle-filter or temporal-axis UI over `akoya_request` (e.g. Dataverse Bulk Export, Reviewer Finder cycle filters).

Do:
- Treat `wmkf_meetingdate` as the single canonical temporal handle (raw range = fail-safe ground truth); compile cycle filters to a `wmkf_meetingdate` range via `cycleCodeToOdataFilter`.
- Surface an off-month / null-cycle meeting LOUDLY (`UNCLASSIFIED cycle` sentinel) — never coerce to nearest cycle, never silently drop.
- Verify callers (e.g. `my-proposals.js`, `reviewer-suggestion.js findByPD`) before relying on existing cycle filters.

Do not:
- Expose `akoya_fiscalyear` as a separate filter axis (it's just month+year of `wmkf_meetingdate`).
- Treat `Jxx`/`Dxx` as a schema invariant — it's a June/Dec convention; non-June/Dec months return null and vanish from cycle-grouped views.
- Conflate `wmkf_meetingdate` (board-cycle) with `akoya_decisiondate` (approval-stamp/business-history axis).

Ground truth: `lib/utils/cycle-code.js`; `scripts/probe-akoya-meetingdate-by-type.js` + evidence `docs/atlas/evidence/akoya-meetingdate-by-type-2026-05-18.txt`; build-plan §9. Related: [[dataverse-export-floor-scoping]].

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

Related: [[dataverse-export-floor-scoping]]
