---
title: Landing cycle — one setting the Grants Manager controls — plan
domain: platform
kind: plan
status: active
summary: "Contract-reconcile reviewed 2026-10-29; Codex adversarial review 2026-10-29 (gpt-6.1-terra; needs rework, six findings) and re-review (gpt-6.1-sol; ready with two named changes); all findings verified and folded in. Owner decisions 2026-10-29: the cycle every app opens on (the landing cycle, alignment log D29) is one app setting edited on the cycle calendar page by the calendar's editors, and every app in the cycle-settings audit that picks a default cycle follows it. An explicit cycle in the URL still wins. D45 (2026-10-29) made it automatic — the cycle with the next Board meeting, switching the Pacific day after — with the setting as an optional override. Design, per-app behavior, open questions. Merged to main 2026-10-29 (PR #547, 6c9a1013b); the setting is unset (see §7)."
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

- **D45 (2026-10-29) supersedes the manual default below:** the landing cycle is
  automatic — the cycle with the next Board meeting (operations Grant Cycle Board
  date), switching at the start of the Pacific day after that meeting (J27 from
  Dec 11, 2026). The setting is now an optional override; empty = automatic.
  §7 records the build.

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
surfaced only Final write-ups (below), which turned out to follow the shell (Codex review). Session and site-visit editors take the
cycle from the URL the Meeting Tracker passes; Workbench views (Staff
Deliberations, Initial Assessments, Awardees tab) take the shell's cycle.

| App | Default today | Cycle list comes from |
|---|---|---|
| Workbench shell + dashboard | Nearest upcoming meeting date via `resolveWorkingCycle` [VERIFIED via `lib/services/workbench/dashboard-service.js:214`; client takes URL cycle, else `defaultCycleCode`, `shared/components/workbench/WorkbenchShell.js:137`] | Cycles of visible ordinary requests (Phase II Pending or triage Advancing) [VERIFIED via audit W1, W3] |
| Meeting Tracker list, Discussion Sentiment | Same dashboard service [VERIFIED via audit M1, M3] | Same |
| Program Briefing | Same rule, own list [VERIFIED via `lib/services/meeting-tracker/program-briefing-service.js:95`] | Visible, non-set-aside requests |
| Awardees (Workbench view) | **Follows the Workbench shell's cycle**; the panel ignores the service's `defaultCycleCode` and uses only `lastDecidedCycleCode` for its "last decided" link [VERIFIED via `shared/components/workbench/AwardeesPanel.js:112-141`] | n/a (shell) |
| Proposal Ranking | Browser clock over conventional codes, month flip [VERIFIED via `shared/components/proposal-ranking/ProposalRankingApp.js:322`] | Six conventional codes |
| Expertise Finder batch | Browser clock, month flip [VERIFIED via `pages/expertise-finder.js:671`] | Next year back to 2020 (`:681-688`) |
| Final write-ups (Workbench view) | **Follows the Workbench shell's cycle**; the service's walk-back default is unused by this client [VERIFIED via `shared/components/final-writeups/FinalWriteupsViews.js:8-10`] | n/a (shell) |
| Board writeups / Board cycle setup | Literal `'D26'` unless `?cycle=` [VERIFIED via `pages/board-writeups.js:8`, `pages/board-cycle-setup.js:7`] | Cycles with a `board_writeups.cycle.<code>` setting [VERIFIED via audit B2, B5] |

## 3. Design

### 3.1 The setting

- Key `cycle.landing_cycle` in the apps system-settings table, value a modern
  cycle code (`^[JD]\d{2}$`). Read with `getSettingStrict`, written with
  `setSettingIfUnchanged` and the editor as actor
  [VERIFIED via `lib/services/dataverse-settings-service.js:11-17,202-211`].
- **Unset means today's rules, unchanged.** Shipping the build changes nothing
  until Sarah sets a value. **[Superseded by D45: unset now means automatic.]**
- **One server reader, `getLandingCycle()`, used by every consumer**,
  re-validates on each read: the pattern (an unclassifiable code thrown into
  `resolveWorkingCycle` fails the page, `lib/utils/cycle-code.js:105-109`; RECHECKED after this branch added `resolveLandingCycle` at :136) and
  that a Grant Cycle row with that code still exists (`listModernCycles`).
  The row can be edited outside the app or the Grant Cycle row removed later.
  An invalid or orphaned value is treated as unset, and the calendar control
  shows it to editors ("The saved landing cycle J27 is not in the Grant Cycle
  table; apps are using their own rules").
- **The reader is bounded (gpt-6.1-sol review).** Neither dependency has a
  deadline today: `getSettingStrict` passes no timeout
  [VERIFIED via `lib/services/dataverse-settings-service.js:87-89`] and the
  client only cancels when `timeoutMs` or `signal` is supplied
  [VERIFIED via `lib/dataverse/client.js:340-349`]; `listModernCycles` pages
  through every J/D row [VERIFIED via `lib/dataverse/adapters/operations-grant-cycle.js:48-53`; RECHECKED after this branch added `findCycleByCode`].
  The Workbench waits for its cycle list before rendering
  [VERIFIED via `shared/components/workbench/WorkbenchShell.js:103-110`].
  So `getLandingCycle()` has one short total deadline (about 1.5 s) covering
  both reads, passed down as `timeoutMs`/`signal`; the existence check is a
  new exact-code query (`$top=1` on `wmkf_cyclecode`), not the full list; it is
  skipped when the value is unset or malformed. A timeout or error from either
  read means "unset" for that request, logged with a reason code
  (`landing_setting_timeout`, `landing_setting_error`, `landing_cycle_missing`,
  `landing_validation_error`). The calendar control alone may report the
  failure to editors.
- A save is refused unless the code matches the pattern and a Grant Cycle row
  with that code exists (read through `listModernCycles`,
  `lib/dataverse/adapters/operations-grant-cycle.js:48`; RECHECKED after this branch's adapter change).
- Who/when: show "Set by <name>, <date>" from `listSettingsWithMetaStrict`
  (`updatedByName`, `updatedAt`) [VERIFIED via
  `lib/services/dataverse-settings-service.js:124-143`]; the writer takes the
  editor's profile id, which the calendar route already builds
  [VERIFIED via `pages/api/cycle-calendar.js:17`]. No audit history needed.
- **Write trust boundary (chosen; differs from calendar date saves):** the
  setting is written by the app's service principal, like every other app
  setting, with the editor recorded in `wmkf_UpdatedBy`
  [VERIFIED via `lib/services/dataverse-settings-service.js:33-37,223-233`].
  Calendar date saves impersonate the editor because they change Connor's
  operations table [VERIFIED via `lib/services/cycle-calendar-service.js:181-189`];
  this is app configuration, so impersonation and its environment flag are not
  required. Authorization is enforced only server-side: staff-only session
  (same refusals as `pages/api/cycle-calendar.js:13-16`), `withDalContext`,
  then `canEditCalendar`.

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
  [VERIFIED current rule via `lib/utils/cycle-code.js:122-128`; RECHECKED after this branch's change, unchanged]. Where an app
  carries a cycle in the URL (Workbench, Meeting Tracker, Board pages), the URL
  still wins; Proposal Ranking and Expertise Finder have no URL cycle (audit
  R1, E1).
- Server-side defaults change in two places only: the Workbench dashboard
  service (which also feeds Meeting Tracker and Discussion Sentiment) and
  Program Briefing. They return the result as `defaultCycleCode`, which their
  clients already use. Awardees and Final write-ups follow the shell and need
  no change. **A settings
  read failure falls back to today's rule** (`getSettingStrict` throws on an
  outage, `dataverse-settings-service.js:80-85`); it never fails the page.
- Client-only apps (Proposal Ranking, Expertise Finder) and the Board pages
  get it from a read endpoint (any signed-in staff). **Initialization is a
  one-shot decision per mount (gpt-6.1-sol review):** the first of success,
  failure, client timeout or an explicit user choice settles the default for
  that mount; every later completion is ignored by a settled/generation guard,
  whether or not the user touched the picker. Data loads and actions wait until
  it settles. Proposal Ranking's explicit `rehearsalCycle` still wins
  [VERIFIED via `shared/components/proposal-ranking/ProposalRankingApp.js:322`].
  This matters because Ranking reloads whenever its cycle changes
  (`ProposalRankingApp.js:506-527`) and Expertise Finder loads proposals
  separately from its selector (`pages/expertise-finder.js:693-705`).
- Board pages: candidates are the cycles with a Board setup
  (`board-writeups/config.js:36-42`, codes only) **whose setup has a valid
  `boardEnds`**; an inactive setup may have none
  [VERIFIED via `lib/services/board-writeups/model.js:45-47`] and is not a
  candidate. Order: the landing cycle if it is a candidate; else the earliest
  candidate whose `boardEnds` is today or later **by the Pacific calendar day**
  (not the UTC day the shared resolver uses); else the latest candidate; with
  no candidates, today's conventional rule. Codes alone would resolve by month
  and keep D26 through Dec 31.
  **Amended by D47 (2026-10-29); built on branch `claude/board-setup-calendar`, PR #561, not merged:** the setup's `boardEnds` goes
  away. Candidates become cycles with a Board setup row whose calendar Board
  Meeting Date is set; the same order then compares that date.
- Applies on first load only; an open page never switches.

### 3.4 Per-app behavior when the landing cycle is set to J27

| App | Result |
|---|---|
| Proposal Ranking, Expertise Finder | Open on J27 (already among their options) |
| Workbench, Meeting Tracker, Program Briefing | Open on J27 **only once a J27 request is visible there**; before that, today's rule (D26). See open question 1 |
| Awardees, Final write-ups | Whatever the Workbench shell is on (Awardees keeps its "last decided" link) |
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
| 1 | The Workbench lists only cycles with visible requests [VERIFIED via `lib/services/workbench/dashboard-service.js:204-215`], and J27 proposals arrive as Phase I Pending, which is not visible [ASSUMED from audit W3 and alignment log R-1]. Setting J27 on Dec 7 would silently leave the Workbench and meeting views on D26. | **Rollout prerequisite, not a silent fallback:** the Workbench-list build (Phase I Pending visible) ships before Sarah sets J27, and §6 adds a Dec 7 end-to-end check. The control's help text states the rule ("apps with no proposals in this cycle yet stay on their current cycle"). If that build slips, bring the empty-cycle option back to the owner |
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
- Tests added from the Codex review: orphaned and externally edited values
  (valid pattern, no Grant Cycle row); Board setup with null `boardEnds`;
  Board date at the UTC/Pacific evening boundary; settings save refused for a
  non-editor and for applicant/bypass sessions. From the gpt-6.1-sol review:
  hanging settings read, hanging and failing existence check, dashboard still
  loads with today's default; client timeout followed by a late success with no
  picker interaction is ignored; unmount/remount starts a fresh decision.
- Rollout: deploy dormant. Prerequisite before Sarah sets J27: the
  Workbench-list build is live, then check on Production that the Workbench,
  Meeting Tracker, Program Briefing, Proposal Ranking, Expertise Finder and
  Board pages each open on the expected cycle. Rollback: clear the setting.

## 7. Build status

**[MERGED TO `main` 2026-10-29 (`6c9a1013b`, PR #547); Production deploy completed per Vercel commit status, 2026-10-29]**

- Setting, reader, editor view, save and Board default:
  `lib/services/landing-cycle-service.js`; exact-code lookup
  `findCycleByCode` in `lib/dataverse/adapters/operations-grant-cycle.js`;
  `getSettingStrict(key, { timeoutMs })` in the settings services.
- Route `pages/api/landing-cycle.js` (matrix row added).
- Resolver `resolveLandingCycle` in `lib/utils/cycle-code.js`; wired into the
  Workbench dashboard service (also Meeting Tracker / Discussion Sentiment)
  and Program Briefing.
- Client: `shared/components/landing-cycle/useLandingCycleDefault.js`
  (one-shot, 2.5 s client wait) in Proposal Ranking and Expertise Finder;
  `useBoardPageCycle.js` on both Board pages (the `'D26'` literal and the
  `BoardWriteups` `'D26'` prop default are gone); `LandingCyclePanel.js` on
  `/cycle-calendar` and Admin → Workflows.
- Tests: `tests/unit/landing-cycle-{service,route,hook}.test.js`,
  `expertise-finder-landing-cycle.test.js`, `board-page-landing-cycle.test.js`, landing cases in
  `cycle-code-defaults`, `workbench-dashboard-service` and
  `program-briefing-service` tests.
- Citation recheck after this branch's code edits:
  - [RECHECKED after lib/dataverse/adapters/operations-grant-cycle.js change: `listModernCycles` now at :48 (paging :48-53), `findCycleByCode` added at :61; citations above updated]
  - [RECHECKED after lib/utils/cycle-code.js change: `normalizeCycles` :105-109 and `resolveWorkingCycle` :122-128 unchanged; `resolveLandingCycle` added at :136]
- Codex PR review (gpt-6.1-sol, 2026-10-29): one high finding, fixed — Board pages passed `skip` while the router was not ready, so the hook started settled and the Board view mounted on the fallback, then remounted when the default arrived. The hook now has a `wait` option (unsettled, no request) used until the router is ready; regression test mutation-checked.
- Codex re-review (gpt-6.1-sol, 2026-10-29): one medium finding, fixed — leaving `skip` (a Board URL cycle removed via the Tools menu link) or re-entering `wait` kept the old settled state, re-creating the fallback/remount race and an early `#discussion-cleanup` redirect. The hook's decision is now bound to its options (`view`/`skip`/`wait`) and discarded in the same render when they change; tests cover URL-cycle removal on both Board pages, URL-cycle arrival mid-read, wait re-entry, switching back to an earlier option set, and the redirect (5 of 18 fail against the previous hook).
- Not yet done: the rollout prerequisite (Workbench
  list shows Phase I Pending) and the Production check in §6.
- **Automatic default (D45), merged to `main` 2026-10-29 (PR #550, `aefaebdf7`):**
  `automaticLandingCycle` in `lib/services/landing-cycle-service.js` picks the
  earliest cycle whose Board date is today or later by the Pacific day (else the
  latest); `getLandingCycle` uses it when there is no valid override (absent,
  empty, malformed, orphaned or unreadable), reading Board dates through the new
  bounded adapter read `listBoardDates`. The editor view adds `automatic`
  (`code`, `boardDate`, `switchesOn`) and status `automatic`; the calendar box
  shows "Automatic: …", the next switch date, and "Automatic" as a choice.

