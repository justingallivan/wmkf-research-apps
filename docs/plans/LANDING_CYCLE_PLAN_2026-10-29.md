---
title: Landing cycle — one setting the Grants Manager controls — plan
domain: platform
kind: plan
status: proposed
summary: "Contract-reconcile reviewed 2026-10-29 (ready with named changes, folded in). Owner decisions 2026-10-29: the cycle every app opens on (the landing cycle, alignment log D29) is one app setting edited on the cycle calendar page by the calendar's editors, and every app in the cycle-settings audit that picks a default cycle follows it. An explicit cycle in the URL still wins; with the setting unset, today's rules apply unchanged. Design, per-app behavior, open questions; nothing built."
canonical: false
owner: product-engineering
related:
  - docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md
  - docs/plans/CYCLE_CALENDAR_DATAVERSE_PLAN_2026-10-28.md
  - docs/plans/CYCLE_ROLLOVER_MINIMAL_CONFIGURATION_PLAN_2026-10-06.md
  - docs/audits/cycle-settings-audit-2026-10-27.md
---

# Landing cycle — one setting the Grants Manager controls

## 1. Decisions

- **D29 (2026-10-28):** each app's landing cycle is cued from a value Sarah sets
  in the calendar, not from env pins, `'D26'` literals or month flips.
- **Storage (owner, 2026-10-29):** an app setting, not a column on Connor's
  Grant Cycle table and not derived from dates.
- **Scope (owner, 2026-10-29):** every app in the cycle-settings audit that
  picks a default cycle follows it in the first build. Each app keeps its own
  cycle picker.
- This supersedes the rollover plan's "never edit an unnamed global current
  cycle" and task-based first-entry proposals
  (`CYCLE_ROLLOVER_MINIMAL_CONFIGURATION_PLAN_2026-10-06.md` §3.3); its
  "explicit URL wins, never switch an open page" rules stay.

## 2. Today's behavior

Enumeration: grep of `resolveWorkingCycle|resolveLastDecidedCycle|defaultCycleCode`
across `lib pages shared` (2026-10-29), cross-checked with
`docs/audits/cycle-settings-audit-2026-10-27.md` §2–3, plus the Board pages'
`'D26'` literal. The grep also hits the cycle calendar (excluded, §4), the
Initial Assessment reader (a panel inside the Workbench shell, which owns the
cycle) and the grantee-titles cron (excluded, §4). Disconfirming pass
(2026-10-29): grep for `cycles[0]`, `?? 'D2…'`, `|| 'D2…'`,
`conventionalCycles()`, `initialCycle` and `cycleCode ||` across
`pages shared lib/services`, plus audit §3.7–3.12 rows that pick a default,
added only Final write-ups (below). Session and site-visit editors take the
cycle from the URL the Meeting Tracker passes; Workbench views (Staff
Deliberations, Initial Assessments, Awardees tab) take the shell's cycle.

| App | Default today | Cycle list comes from |
|---|---|---|
| Workbench shell + dashboard | Nearest upcoming meeting date via `resolveWorkingCycle` [VERIFIED via `lib/services/workbench/dashboard-service.js:214`; client takes URL cycle, else `defaultCycleCode`, `shared/components/workbench/WorkbenchShell.js:137`] | Cycles of visible ordinary requests (Phase II Pending or triage Advancing) [VERIFIED via audit W1, W3] |
| Meeting Tracker list, Discussion Sentiment | Same dashboard service [VERIFIED via audit M1, M3] | Same |
| Program Briefing | Same rule, own list [VERIFIED via `lib/services/meeting-tracker/program-briefing-service.js:95`] | Visible, non-set-aside requests |
| Awardees | Same rule, plus `lastDecidedCycleCode` [VERIFIED via `lib/services/workbench/grantee-deliverables/awardees-service.js:107-112`] | Cycles with active awardees |
| Proposal Ranking | Browser clock over conventional codes, month flip [VERIFIED via `shared/components/proposal-ranking/ProposalRankingApp.js:322`] | Six conventional codes |
| Expertise Finder batch | Browser clock, month flip [VERIFIED via `pages/expertise-finder.js:671`] | Next year back to 2020 (`:681-688`) |
| Final write-ups index | Newest of the three newest cycles with a viewer-visible row, else newest empty; not date-based [VERIFIED via `lib/services/final-writeup/dashboard-service.js:600-626`; audit FW1] | Cycles with final write-up rows |
| Board writeups / Board cycle setup | Literal `'D26'` unless `?cycle=` [VERIFIED via `pages/board-writeups.js:8`, `pages/board-cycle-setup.js:7`] | Cycles with a `board_writeups.cycle.<code>` setting [VERIFIED via audit B2, B5] |

## 3. Design

### 3.1 The setting

- Key `cycle.landing_cycle` in the apps system-settings table, value a modern
  cycle code (`^[JD]\d{2}$`). Read with `getSettingStrict`, written with
  `setSettingIfUnchanged` and the editor as actor
  [VERIFIED via `lib/services/dataverse-settings-service.js:11-17,202-211`].
- **Unset means today's rules, unchanged.** Shipping the build changes nothing
  until Sarah sets a value.
- A save is refused unless the code matches the pattern and a Grant Cycle row
  with that code exists (read through `listModernCycles`,
  `lib/dataverse/adapters/operations-grant-cycle.js:45`).
- Who/when: show "Set by <name>, <date>" from `listSettingsWithMetaStrict`
  (`updatedByName`, `updatedAt`) [VERIFIED via
  `lib/services/dataverse-settings-service.js:124-143`]; the writer takes the
  editor's profile id, which the calendar route already builds
  [VERIFIED via `pages/api/cycle-calendar.js:17`]. No audit history needed.

### 3.2 Editing

- On `/cycle-calendar` and Admin → Workflows → Cycle calendar, a
  "Landing cycle" control above the dates: current value, Edit (modern cycles
  with a Grant Cycle row, plus "Not set — use each app's date rule"), Save.
- Editors: the calendar's editors (superuser, assigned Grants Manager or
  Program Coordinator), reusing `canEditCalendar` unchanged
  [VERIFIED via `lib/services/cycle-calendar-service.js:56`].
- Conflicting saves: revision check; a conflict refreshes and asks again.
- Built as its own component, service and route, mounted in
  `pages/cycle-calendar.js` and `shared/components/admin/workspaces/WorkflowsWorkspace.js`
  next to the existing calendar panel. Neither file is in the scope given to
  Codex on `codex/cycle-calendar-attribution` (calendar service, adapter,
  config, `shared/components/cycle-calendar/`, `pages/api/cycle-calendar*`);
  this build edits none of those.

### 3.3 Reading

- One resolver in `lib/utils/cycle-code.js`, for example
  `resolveLandingCycle(cycles, landingCode, today)`: the landing cycle if set
  and present in this app's list; otherwise today's `resolveWorkingCycle`
  [VERIFIED current rule via `lib/utils/cycle-code.js:122-128`]. Where an app
  carries a cycle in the URL (Workbench, Meeting Tracker, Board pages), the URL
  still wins; Proposal Ranking and Expertise Finder have no URL cycle (audit
  R1, E1).
- Server-side apps (Workbench, Meeting Tracker, Program Briefing, Awardees,
  Final write-ups) read the setting in their existing services and return it
  as `defaultCycleCode`; their clients already use that field. **A settings
  read failure falls back to today's rule** (`getSettingStrict` throws on an
  outage, `dataverse-settings-service.js:80-85`); it never fails the page.
- Final write-ups: if the landing cycle is among the available cycles, load it
  first and select it when it has a viewer-visible row; otherwise run today's
  walk-back unchanged.
- Client-only apps (Proposal Ranking, Expertise Finder) and the Board pages
  get it from a read endpoint (any signed-in staff). **They choose their cycle
  only after that read settles** (success, failure or a short timeout falls
  back to today's rule), and they ignore a late reply once the user has
  changed the picker, so no page switches after it has loaded data.
- Board pages: candidates are the cycles with a Board setup
  (`board-writeups/config.js:36-42`, codes only). Their dates come from each
  setup's stored Board end date; codes alone would resolve by month and keep
  D26 through Dec 31.
- Applies on first load only; an open page never switches.

### 3.4 Per-app behavior when the landing cycle is set to J27

| App | Result |
|---|---|
| Proposal Ranking, Expertise Finder | Open on J27 (already among their options) |
| Workbench, Meeting Tracker, Program Briefing | Open on J27 **only once a J27 request is visible there**; before that, today's rule (D26). See open question 1 |
| Awardees | Opens on J27 only if J27 has awardees; otherwise today's rule |
| Final write-ups | Opens on J27 only once J27 has a visible write-up; otherwise today's rule (in practice D26 until next year) |
| Board pages | J27 once J27 has a Board setup; until then the nearest upcoming Board date among set-up cycles (D26 through Dec 10). Question 2 |

## 4. Excluded

- The calendar page's own default (owner kept nearest Board date).
- The grantee-titles cron (a processing job, not a landing page; retirement
  pending).
- Non-default cycle literals: Initial Assessments `'D26'` hide, the D26 roster
  count of 23, the ranking trial cutoff, the dossier, the proposal-document
  slot map, the review-filing and Staff Deliberations env pins (separate
  builds).

## 5. Open questions

| # | Question | Recommendation |
|---|---|---|
| 1 | The Workbench lists only cycles with visible requests, and J27 proposals arrive as Phase I Pending, which is not visible [ASSUMED from audit W3 and alignment log R-1]. Should the landing cycle appear in the Workbench picker even when empty? | Fall back until requests are visible; the separate Workbench-list build (Phase I Pending) makes J27 visible. Revisit if that build slips past Dec 7 |
| 2 | Board pages are in the chosen scope. If Sarah moves the landing cycle to J27 before the D26 Board meeting (Dec 10), Board pages would open on J27, which has no Board setup. Follow the landing cycle anyway, or only when it has a Board setup (otherwise nearest upcoming Board setup)? | **Decided (owner, 2026-10-29):** the landing cycle only when it has a Board setup; otherwise the nearest upcoming Board date among cycles with a setup. The `'D26'` literal goes |
| 3 | Should the page warn when the landing cycle's Board date has passed? | Not now; the readiness digest can flag it later |

## 6. Delivery

- Branch `claude/landing-cycle`; runtime change, PR and deliberate promotion
  (`docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`).
- Tests: resolver (unset, set and present, set and absent, URL wins), route
  auth, each consumer's default with and without the setting, read failure
  falls back.
- Gates: `check:api-routes`, `check:route-lifecycle-auth`,
  `check:route-service-boundary`, `check:dataverse-access-layer`,
  `check:atlas`, `check:types`.
- Atlas: record the new setting key where system-settings keys are listed.
- Rollout: deploy dormant; Sarah sets J27 when she is ready. Rollback: clear
  the setting.
