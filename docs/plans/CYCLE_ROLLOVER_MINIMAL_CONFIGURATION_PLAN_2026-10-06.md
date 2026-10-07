---
title: Cycle Rollover with Minimal Configuration — Investigation Plan
domain: platform
kind: plan
status: proposed
summary: "Investigate every parameter that must change when a grant cycle turns over (J/D), and design a rollover that derives cycle scope from data and dates, leaving at most a twice-yearly confirmation and a loud check when anything is still pinned to an old cycle."
canonical: false
owner: product-engineering
related:
  - docs/plans/STAFF_DELIBERATIONS_STATUS_CLARITY_PLAN_2026-10-04.md
  - docs/WORKBENCH_TRIAGE_FIELD_BUILD_PLAN.md
  - docs/CREDENTIALS_RUNBOOK.md
  - docs/CURRENT_WORK_QUEUE.md
---

# Cycle Rollover with Minimal Configuration — Investigation Plan

## 1. Why

[OWNER DECISION, 2026-10-06] Very few parameters may need human "care and feeding" each cycle,
because cycle-scoped settings go unnoticed and get forgotten. Prefer settings that roll over on
their own; where a human decision is unavoidable, prompt for it on a fixed rhythm (the owner's
analogy: adjusting clocks for daylight saving twice a year — done automatically, or triggered by
an email to staff).

Trigger: Staff Deliberations automatic preparation went live on 2026-10-06 with
`STAFF_DELIBERATIONS_AUTO_PREPARE_CYCLE_CODES=["D26"]`. When J27 research presentations start,
nothing fails: J27 requests silently fall back to the manual "Prepare for post-visit editing"
path unless someone remembers to add `J27`. That silent degradation is the failure shape this
plan targets.

## 2. Constraints from the owner

- Cycles are June (`J`) and December (`D`) board meetings, coded from `wmkf_meetingdate`.
- Cycles overlap: J27 proposals are due before the D26 board meeting. There is no single
  "current cycle"; several cycles are live at once, each in a different phase.
- Other filters already decide when proposals can be entered (the submission portal opens to a
  cycle). Build around those signals rather than adding new switches.

## 3. Seed inventory (orientation only, 2026-10-06 — the investigation must complete it)

**Cycle-scoped environment settings** [VERIFIED via grep of `env.*` readers in `lib/`, `shared/`, `pages/`; not exhaustive — Dataverse/Postgres-held settings were not searched]:
- `STAFF_DELIBERATIONS_AUTO_PREPARE_CYCLE_CODES`, `_PROGRAM_IDS`, `_REQUEST_STATUSES`, `_EXCLUDED_REQUEST_NUMBERS` (`lib/services/pre-site-visit/preparation-config.js`).
- `CYCLE_DOSSIER_REQUEST_ALLOWLIST`, `CYCLE_DOSSIER_ROLLOUT_MODE`, `CYCLE_DOSSIER_ENABLED` (`lib/services/cycle-dossier-rollout.js:34-40`).
- `REVIEW_PANEL_REQUEST_ALLOWLIST`.
- `WAVE2_BACKEND_GRANT_CYCLES`.

**Cycle literals in source** [VERIFIED via grep for quoted `J2x`/`D2x` codes and the cited lines]:
- `lib/services/cycle-dossier-rollout.js:16` — `DOSSIER_CYCLE = 'D26'` drives the dossier roster.
- `shared/components/workbench/InitialAssessmentsPanel.js:19` — `INITIAL_ASSESSMENTS_EXCLUDED_CYCLE = 'D26'`.
- `shared/components/workbench/WorkbenchViewsNav.js:61-68` — hides Initial Assessments for `'D26'`
  (owner decision 2026-09-05: not part of the D26 dual-phase workflow).
- `shared/config/d26Allowlist.js` — retired; kept as the precedent below.

**Staff-maintained per-cycle settings** [VERIFIED via `pages/admin.js:3024-3039`]: an admin
timeline form stores a grant cycle label and reviewer-invitation dates (stored as timeline JSON;
storage location not yet traced).

**Calendar-shaped schedules** [VERIFIED via `vercel.json`]: at least one cron is month-scoped
(`0 6 * 4-6,10-12 *`), i.e. it encodes the cycle calendar in a schedule string.

**Existing building blocks** [VERIFIED via `lib/utils/cycle-code.js:24-150`]:
`meetingDateToCycleCode`, `resolveWorkingCycle` (next cycle by meeting date), `resolveLastDecidedCycle`,
and `conventionalCycles` (the J/D convention around a date, for callers with no cycle list).

**Precedent** [VERIFIED via `shared/config/d26Allowlist.js` header]: the D26 going-forward request
allowlist was retired in S261 (2026-06-15) in favour of `wmkf_triagestatus` on the request — the
data of record replaced a hand-maintained list.

**Not yet located** [UNKNOWN]: where the submission portal's open/close window lives (Dataverse
program/cycle records, Akoya configuration, or app settings); where the admin timeline JSON is
stored; other Dataverse- or Postgres-held settings that name a cycle; Power Automate flows,
prompt rows, email templates, and report filters with cycle literals; any other staff-maintained
per-cycle dates (deadlines, board dates).

## 4. Investigation steps

1. **Complete the inventory.** Every parameter, literal, schedule, stored setting, flow, template,
   and prompt that names a cycle, a cycle-specific date, or a per-cycle request/program list.
   Record each with: where it lives, who changes it today, what breaks (or silently degrades) if it
   is not changed, and the last time it was changed.
2. **Classify each item** into one of:
   - **A. Derive from the record** — the answer is already on the request/program/event
     (meeting date → cycle, request status, triage field, presentation event). No configuration.
   - **B. Derive from the calendar** — follows the J/D convention or a phase computed from the
     cycle's milestone dates (portal open → submissions → reviews → presentations → board).
     No configuration; an override exists only for exceptions.
   - **C. Genuine per-cycle decision** — a human must choose (e.g. turning a pilot on for a
     cycle). Moves into a single cycle record (§5) and the twice-yearly confirmation.
   - **D. Pilot or one-off gate** — should be retired or folded into A–C once the feature is
     no longer a pilot.
3. **Locate the portal window** and decide whether it can anchor each cycle's phase (the owner's
   suggestion), including how overlapping cycles are represented.
4. **Design the rollover** (§5) and a **drift check** (§6), then propose a migration order that
   starts with items that fail silently today.

## 5. Design directions to evaluate

- **Per-cycle phases, not a single current cycle.** Compute, for each cycle, which phase it is
  in from its milestone dates; features ask "is this request's cycle in phase X?" instead of
  reading a cycle allowlist. Overlap then falls out naturally.
- **One cycle record per cycle** (Dataverse or Postgres, editable on an admin page) holding only
  the milestone dates that cannot be derived, plus any genuine category-C choices. Prefer existing
  records (program/cycle, portal window, the admin timeline) over a new table.
- **Twice-yearly confirmation.** A scheduled email to an owner role at a fixed point in each cycle
  (for example when the portal opens, or N weeks before the first presentation): "Here is what
  J27 will do automatically; here is what still needs a decision", with a one-click confirm.
  Choose between auto-apply-with-notice and require-confirmation per category-C item.
- **Defaults roll forward.** A category-C choice defaults to the previous cycle's value unless
  changed, so forgetting means "same as last time", not "off".

## 6. Drift check (catches what is forgotten)

A scheduled check (and a `check:*` gate where it can run offline) that flags any cycle-scoped
setting that names only past cycles while a newer cycle has live activity — for example J27
requests with presentation events while preparation's cycle allowlist lists only `D26`. It must
alert loudly (email/operational event), never only log, and print its denominator (how many
settings it checked).

## 7. Out of scope for the investigation

Implementation. Changing any live setting. Retiring Staff Deliberations allowlists before the
replacement exists. The investigation produces the inventory, the classification, a chosen
design, and an ordered migration plan for owner review.

## 8. Interim safeguard until this lands

Before J27 research presentations begin, add `J27` to
`STAFF_DELIBERATIONS_AUTO_PREPARE_CYCLE_CODES` in Production (and confirm the program and status
allowlists still apply). Tracked in `docs/CURRENT_WORK_QUEUE.md`.

## 9. Questions for the owner

1. Who receives the twice-yearly confirmation, and at which point in the cycle?
2. For a forgotten category-C choice: roll the previous cycle's value forward automatically, or
   hold until confirmed?
3. Is the portal's open date the right anchor for "a new cycle has started", given J and D overlap?
