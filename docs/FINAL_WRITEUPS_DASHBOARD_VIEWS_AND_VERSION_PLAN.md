---
title: Final Writeups Dashboard — Slices 6B and 6C Views, PD Filter, and Version Context Plan
domain: workbench
kind: plan
status: active
summary: "Opens the Final writeups dashboard on Needs my review with two alternative views and a PD filter, URL-persisted; renders the acknowledged publication version."
canonical: false
cataloged: 2026-09-06
last_verified: 2026-09-07
owner: product-engineering
related:
  - docs/FINAL_WRITEUPS_DASHBOARD_CYCLE_SCOPING_PLAN.md
  - docs/FINAL_WRITEUP_REVIEW_IMPLEMENTATION_PLAN.md
  - docs/CURRENT_WORK_QUEUE.md
  - docs/atlas/dataverse-wmkf-finalwriteupreviewacknowledgement.md
---

# Final Writeups Dashboard — Slices 6B and 6C Plan

**Status: Production-live 2026-09-07 via PR #175 merge `44bdd240`, deployment `dpl_2UrsDnydRqudu95wJyLCK7A6FUFR`; see §14.** Mode A `/contract-reconcile` plan for the two remaining
Slice 6 items the owner shaped on 2026-09-06 (queue item 5; 6A plan §12 tail). Slices 6D and 6E are
closed by owner decision and are not part of this plan. Every state claim below is labeled;
`[PLANNED]` marks intended behavior, never built state. Line numbers are as of `3e3645b0`.

## 1. Why now

D26 Final writeups do not exist yet. The dashboard is Production-live with Slice 6A cycle scoping
(`842c9f13`) and opens on three fixed queues: Awaiting your review, Reviewed history, Your writeups
`[VERIFIED via shared/components/final-writeups/FinalWriteupsViews.js:602-616]`. The owner wants the
page to open on the writeups that need the viewer's review, with two alternative views and a Program
Director filter, all bookmarkable, and wants the publication version that acknowledgements key to
visible per row so "Updated since review" is explainable without opening Word. Building before the
first D26 Final exists means the first real reviewers meet the intended shape.

## 2. Surface (contract-reconcile Step 0)

- **Change surface:** the dashboard gains a three-option view selector and a Program Director
  filter, both client-side over the already-loaded cycle and persisted in the page URL; each row
  and the focused acknowledgement panel gain the acknowledged publication version.
- **Entry points:** `shared/components/final-writeups/FinalWriteupsViews.js`
  (`FinalWriteupsDashboardView`, `WriteupRow`, `AcknowledgementPanel`, `FocusedDocument`);
  `lib/services/final-writeup/acknowledgement-service.js` (`projectAcknowledgementState`, one
  additive field); `lib/services/final-writeup/dashboard-service.js` (`projectRequestRow`, one
  additive field; `unconfiguredMatrixRow`, one additive field so the PD filter covers every matrix
  row). `GET /api/workbench/final-writeups` and
  `GET /api/workbench/final-writeup/acknowledgement` are **not edited**; their response bodies gain
  one additive field through the shared projection.
- **Persistence:** **none.** No Dataverse, Postgres, Blob, or settings write. Page-URL query
  parameters (`view`, `pd`) are the only new state and live in the browser address bar.
- **Consumers:** the two views; `shared/components/workbench/FinalWriteupTab.js` (consumes the
  acknowledgement GET response by named field, so an additive field is ignored
  `[VERIFIED via shared/components/workbench/FinalWriteupTab.js:98,350]`);
  `tests/unit/final-writeups-views.test.js`, `final-writeups-dashboard-service.test.js`,
  `final-writeup-acknowledgement-service.test.js`, `final-writeup-tab.test.js`; the two route rows in
  `docs/API_ROUTE_SECURITY_MATRIX.md`; the reader note in
  `docs/atlas/dataverse-wmkf-finalwriteupreviewacknowledgement.md`; Slice 6 in
  `docs/FINAL_WRITEUP_REVIEW_IMPLEMENTATION_PLAN.md`; queue item 5; the 6A plan §12 tail.
- **Prior findings being verified:** the 6B paragraph in the implementation plan Slice 6 still
  describes a stage filter and a four-state control `[STALE/CONFLICT via
  docs/FINAL_WRITEUP_REVIEW_IMPLEMENTATION_PLAN.md:684-692 against queue item 5 and 6A plan §12
  tail, owner 2026-09-06]`; this plan supersedes it and the build reconciles the paragraph in place.

## 3. Current state (verified 2026-09-06)

- The server already computes the per-viewer review relationship. `projectRequestRow` sets
  `bucket` to `stewardship` when the viewer is the responsible PD, else `history` when the viewer
  has an acknowledgement row for the current Final (any version), else `open`
  `[VERIFIED via lib/services/final-writeup/dashboard-service.js:301-303]`. `personalState` is
  `not-applicable` for the responsible PD, else `reviewed` when the stored publication version
  equals the observed one, else `updated`; no row means `unreviewed`
  `[VERIFIED via lib/services/final-writeup/acknowledgement-service.js:317-320,360-362]`.
- "Needs my review" therefore equals `bucket === 'open'` (eligible and not yet acknowledged);
  "Reviewed by me" equals `bucket === 'history'`; "All writeups" is every persona-visible row.
- Rows carry `responsibleProgramDirector: { id, name }`, `stage`, `cycleCode`, `cycleLabel`,
  `document.publicationVersionId`, `document.lastModified`, `acknowledgedAt`, `mayAcknowledge`
  `[VERIFIED via dashboard-service.js:305-329]`. They do **not** carry the version the viewer
  acknowledged: `projectAcknowledgementState` returns `acknowledgedAt` from the personal row but
  not its `wmkf_publicationversionid` `[VERIFIED via acknowledgement-service.js:339-366]`.
- The route rejects any query key other than `requestId` and `cycleCode` with 400
  `[VERIFIED via pages/api/workbench/final-writeups.js:37-40]`. The component has exactly two
  fetches of that route: the index fetch sends only `cycleCode` and the focused fetch only
  `requestId` `[VERIFIED via FinalWriteupsViews.js:504,804; grep "fetch(\`/api/workbench/final-writeups" finds no other call in the file]`.
- The walk-back default picks the newest of the three newest cycles with **any** visible row
  (`visibleProjected.length > 0`), not any open row `[VERIFIED via dashboard-service.js:596-600]`.
  The header copy for that outcome reads "Nothing awaits your review in {newest}; showing {cycle}"
  `[VERIFIED via FinalWriteupsViews.js:471-474]`, which names a criterion the server does not use.
- The coordinator matrix (superuser or configured PC) is filtered by the search field only
  `[VERIFIED via FinalWriteupsViews.js:238,316]`. Configured matrix rows carry
  `responsibleProgramDirector` `[VERIFIED via dashboard-service.js:395]`; the
  `unconfiguredRows` DTO does not (request, title, institution, grant program only)
  `[VERIFIED via dashboard-service.js:412-422]`, so a client PD filter has no key for those rows
  today.
- The service sorts `visibleProjected` once by request number and then splits it into the three
  queues `[VERIFIED via dashboard-service.js:569-571,697-701]`; concatenating the queues does not
  restore that order.
- The publication version string comes verbatim from Graph file metadata `versionId`
  `[VERIFIED via acknowledgement-service.js:210-233]`. Its format is not established in any doc
  read for this plan; the string is treated as opaque.
- The acknowledgement GET route and the dashboard consume the same projection function
  `[VERIFIED via acknowledgement-service.js:405,538]`. The POST path (`markFinalWriteupReviewed`)
  does **not**: it returns a hand-built body with `acknowledgedAt`, `publicationVersionId`,
  `publicationLastModified`, `reused`, and `reviewers` `[VERIFIED via
  acknowledgement-service.js:520-531]`, and `FinalWriteupTab` stores that body as its acknowledgement
  state after a mark `[VERIFIED via FinalWriteupTab.js:334]`.

## 4. Decisions

### 4.1 View selector (6B)

`[PLANNED]` A segmented control with three options, rendered beside the cycle select:

| Key (URL `view`) | Label | Main list | Count shown |
|---|---|---|---|
| `needs-review` (default) | Needs my review | `queues.open` | open rows after PD filter and search |
| `reviewed` | Reviewed by me | `queues.history` | history rows after PD filter and search |
| `all` | All writeups | open + history + stewardship merged into one list | all rows after PD filter and search |

Every view's main list is re-sorted on the client by request number (string compare, the server's
rule) after merging and filtering, so the ordering rule is stated once and All writeups is not a
concatenation of three pre-sorted queues.

- The page opens on `needs-review` for every persona when the URL carries no `view`. This is the
  owner's 2026-09-06 shape: one opening view for every role, no per-persona default.
- Counts beside the options are navigation counts, never denominators (contract row "coordinator
  matrix is complete without becoming a compliance scorecard" holds). They reflect the current PD
  filter and search so the numbers match what switching would show.
- `personalState: 'updated'` rows stay in **Reviewed by me** with the amber "Updated since review"
  chip. This is the existing product decision, already in live copy: "A later edit is shown as an
  update, not a new requirement" `[VERIFIED via FinalWriteupsViews.js:610]`. Owner default; see §10.
- Stewardship rows (the viewer's own writeups, `mayAcknowledge: false`) never appear in Needs my
  review or Reviewed by me main lists. Under those two views the existing collapsed "Your writeups"
  section remains below the main list; under All writeups the section is omitted because its rows
  are already in the list. Owner default; see §10.
- An unknown or missing `view` value resolves to `needs-review`. Normalization is **immediate**:
  on mount the component sanitizes `view` and `pd`, and if either was invalid it rewrites the address
  bar at once (`replaceState`) so a bookmarked bad value never survives a reload. No error surface.
- The header line stays "{n} awaiting your review in {cycle}", but `n` is the **filtered** open
  count (after the PD filter and search), not the server's `counts.open`, so the header never says
  42 while the list shows one. When a PD is selected the sentence appends "for {PD name}". Under
  Reviewed by me and All writeups it remains the same sentence, because it states the viewer's work,
  not the view. The server `counts` object is left unchanged and unused by the header.

### 4.2 Program Director filter (6B)

`[PLANNED]` A `<select>` labeled "Program director" beside the view control:

- Options are derived from the loaded cycle's visible rows: distinct
  `responsibleProgramDirector.id` with its `name`, sorted by name, plus a first option
  "All program directors" (value empty). Existence-only; every listed PD already has a visible row,
  so this discloses nothing new.
- URL key `pd`, value the PD's `systemuserid` GUID (lowercased). A non-GUID value is dropped on
  mount, never applied, and removed from the address bar immediately (§4.1 timing rule). A GUID absent from the loaded rows still becomes the controlled value
  with an option labeled "Program director not in this cycle" (same rule the cycle select follows
  `[VERIFIED via FinalWriteupsViews.js:439-443]`); the main list shows the empty copy "No writeups
  for the selected Program Director in {cycle}. Choose All program directors to clear the filter."
  No silent fallback.
- The PD filter applies to the main list, the "Your writeups" section, **and** every coordinator
  matrix row, including `unconfiguredRows` (implementation plan Slice 6 text: filters apply to the
  matrix). To make that total, `unconfiguredMatrixRow` gains `responsibleProgramDirector: { id,
  name }` copied from the projected writeup (the same value configured rows already carry). A row
  whose PD id is null is shown only under "All program directors". The view selector
  does **not** apply to the matrix: the matrix is a per-reviewer grid and "Needs my review" has no
  meaning there. Owner default; see §10.
- Changing the cycle keeps both `view` and `pd` in the URL. If the PD has no rows in the new cycle
  the absent-PD rule above applies.

### 4.3 URL persistence (6B)

`[PLANNED]` `view` and `pd` join `cycleCode` in the page URL via the existing `replaceState`
pattern `[VERIFIED via FinalWriteupsViews.js:424-430]`. The default view and the empty PD filter
write **no** parameter (a clean URL stays clean). They are never sent to the API: the fetch query
is built from `cycleCode` alone. A views test pins that the fetch URL contains only `cycleCode`
when both new parameters are set, because the route rejects any other key with 400.

### 4.4 Walk-back interaction (6B)

The default cycle is chosen by "any visible row", so a viewer can land on Needs my review empty
while Reviewed by me has rows in that cycle. `[PLANNED]` Keep the server walk-back unchanged (a
view-aware walk-back would need a "no open rows in any cycle" outcome and reopens 6A's three-read
bound). Instead:

- The Needs my review empty state names the alternatives with their counts: "Nothing needs your
  review in {cycle}. {n} reviewed by you · {m} writeups in all." Each is a button that switches the
  view.
- The walk-back copy is corrected to the criterion the server uses (any visible row, whether
  open, history, or stewardship): "No current writeups visible to you in {newest}; showing {cycle}."
  and, for `exhausted`, "No current writeups visible to you in the most recent cycles; choose a cycle
  to look further back." Copy only; no behavior change.

### 4.5 Acknowledged publication version (6C)

`[PLANNED]` One additive field through the shared projection:

- `projectAcknowledgementState` returns `acknowledgedPublicationVersionId: isResponsiblePd ? null :
  (personal?.wmkf_publicationversionid || null)` beside `acknowledgedAt`. The responsible-PD branch is
  explicit because the projection today still exposes the personal row's fields for a PD who once
  held a historical acknowledgement `[VERIFIED via acknowledgement-service.js:359-364]`; a stale
  version must not surface on a stewardship row. The dashboard row and the
  acknowledgement GET response carry it unchanged. The POST response in `markFinalWriteupReviewed`
  adds the same key from the confirmed stored row (`existing.wmkf_publicationversionid`), so every
  response variant of the acknowledgement route carries it and the tab's post-mark state matches the
  GET shape. Both routes' response shapes grow by one nullable string; no request shape changes.
- **Dashboard row:** beside "Updated {lastModified}" render "Version {publicationVersionId}". When
  `personalState === 'updated'` add "You reviewed version {acknowledgedPublicationVersionId}". The
  string is rendered verbatim (no parsing, trimming, or numeric formatting); a null observed version
  cannot occur because the observation normalizer throws without one
  `[VERIFIED via acknowledgement-service.js:214-224]`.
- **Focused page:** `FocusedDocument` shows "Version {publicationVersionId}" under the last-updated
  line. `AcknowledgementPanel` in the `updated` state reads "You reviewed version {acknowledged}
  on {acknowledgedAt}. The current version is {current}." In the `reviewed` state it reads "You
  reviewed version {current} on {acknowledgedAt}."
- `FinalWriteupTab` is unchanged; it reads named fields from the response
  `[VERIFIED via FinalWriteupTab.js:98,350]`, so the additive field is inert there. No tab test is
  added for it: a fixture carrying an ignored key would be decorative. Exact-value assertions live
  on the projection, the dashboard row, and the focused render (§8).
- No embedded editor, no iframe, no "has edits" hint (6D closed).

### 4.6 Header thesis comment

`[PLANNED]` Replace the `FinalWriteupsViews.js` header comment's "one legible review queue replaces
a metrics-and-filters dashboard" thesis `[VERIFIED via FinalWriteupsViews.js:3]` with the amended
direction: one opening view (Needs my review), two alternatives, cycle and Program Director as the
only filters, one search field, no denominators. The implementation plan 6B text asks for this.

## 5. Contract trace (Step 3)

1. **Caller:** signed-in Workbench user opens `/workbench/final-writeups[?cycleCode&view&pd]`.
2. **Client state:** `view` and `pd` read from the URL on mount (validated: allowlist / GUID), held
   in component state, written back with `replaceState`. `cycleCode` unchanged.
3. **Request payload:** `GET /api/workbench/final-writeups?cycleCode=…` only. `view`/`pd` never
   leave the page.
4. **Route:** unchanged; allowlist still `requestId` | `cycleCode`.
5. **Service:** `projectAcknowledgementState` adds `acknowledgedPublicationVersionId`;
   `projectRequestRow` passes it through; `unconfiguredMatrixRow` adds `responsibleProgramDirector`.
   No query, filter, or bound changes.
6. **Persistence:** none (read-only paths unchanged).
7. **Response shape:** each row and the acknowledgement GET body gain one nullable string; each
   unconfigured matrix row gains the PD object configured rows already carry.
8. **Consumer render:** view selector partitions `queues`; PD filter narrows rows and matrix; row
   and focused panel render version strings.
9. **Docs/tests/gates:** §7, §8; docs in §9.

## 6. Audits (Step 4)

1. **Whole-flow:** every hop above accounted for; hops 4 and 6 are explicitly unchanged.
2. **Partial success:** N/A (no writes, no batches introduced).
3. **Async / stale state:** the existing `requestIdRef` generation guard covers the load
   `[VERIFIED via FinalWriteupsViews.js:504-506]`. View and PD changes do not refetch; they
   re-partition `data` in `useMemo`. A cycle change refetches under the existing guard. No new
   post-await state write.
4. **Helper extraction:** the partition helper (`rowsForView(queues, view)`) must not collapse
   `open` and `history` by `personalState`; it partitions by `bucket` only, so an `updated` row
   stays in history. The PD filter helper compares lowercased GUIDs and never falls back to name.
5. **Durable surface:** no migration, Atlas entity, or count change. Route matrix rows for both
   routes gain an additive-field sentence (`check:api-routes` verifies coverage, not shape).
6. **Doc reconcile:** §9, via `/sweep` at build time.
7. **Symbol fan-out:** `acknowledgedPublicationVersionId` is a new response key. Readers:
   `FinalWriteupsViews.js` (new consumer), `FinalWriteupTab.js` (ignores), tests. The persisted
   field `wmkf_publicationversionid` is already read by `sameObservedPublication`; adding a
   passthrough introduces no new persisted read. `view` is a new client enum with a label map: keep
   the allowlist and labels in one frozen map (`VIEWS = { 'needs-review': { label, select } … }`)
   so parity is structural and no `check:status-enum-parity` registry entry is needed; if the build
   splits them, register the pair. Complement check: an unknown `view` falls to the default, not to
   an empty list; an unknown `pd` falls to the absent-PD option, not to an unfiltered list.

## 7. Invariant table (Mode B guardrail for the build)

| Invariant | Files likely touched | Verification |
|---|---|---|
| Fetch query carries only `cycleCode`; `view`/`pd` never reach the API | `FinalWriteupsViews.js` | views test with both set asserts the fetch URL has one query key |
| Default view is `needs-review` for every persona; unknown `view` and non-GUID `pd` resolve to defaults and the address bar is rewritten on mount | `FinalWriteupsViews.js` | views tests assert `window.location.search` after mount for `?view=bogus&pd=not-a-guid` (both gone, `cycleCode` kept) and after each valid change |
| Needs my review = `bucket open`; Reviewed by me = `bucket history` incl. `updated`; All = every row | `FinalWriteupsViews.js` | fixture with rows in all three buckets plus one `updated`; switching proves exclusion |
| Every view's list is sorted by request number after merge and filter | `FinalWriteupsViews.js` | All-view fixture with interleaved numbers across buckets (open #200, history #100, stewardship #150) renders 100, 150, 200 |
| Stewardship rows never in the first two main lists; "Your writeups" section hidden under All | `FinalWriteupsViews.js` | views test per view |
| PD options are derived from loaded rows, existence-only; non-GUID `pd` dropped; absent GUID keeps an option and shows empty copy | `FinalWriteupsViews.js` | views tests: two PDs, `pd=not-a-guid`, `pd=<absent guid>` |
| PD filter applies to main list, Your writeups, configured matrix rows, and unconfigured matrix rows; view does not filter the matrix | `FinalWriteupsViews.js`, `dashboard-service.js` | superuser fixture with a configured group and an unconfigured row for PD-A: selecting PD-B removes both; switching view leaves matrix counts unchanged; service test pins `responsibleProgramDirector` on unconfigured rows |
| Counts beside views and the header count reflect PD filter and search; server `counts` unused by the header | `FinalWriteupsViews.js` | views test: PD filter and search each narrow the header number and the view counts together |
| `acknowledgedPublicationVersionId` present in the POST response and equal to the stored row's version | `acknowledgement-service.js` | service test asserts the exact value after mark, both fresh and `reused` |
| Cycle change preserves `view` and `pd` in the URL | `FinalWriteupsViews.js` | views test reading `window.location.search` after change |
| `acknowledgedPublicationVersionId` equals the personal row's `wmkf_publicationversionid`; null without a row and for the responsible PD | `acknowledgement-service.js`, `dashboard-service.js` | service tests on both projections |
| Version strings rendered verbatim | `FinalWriteupsViews.js` | views test with `"3.0"` and a non-numeric string |
| Walk-back copy names the server criterion | `FinalWriteupsViews.js` | re-pin the existing walk-back views test |

## 8. Tests (names to add or re-pin)

`tests/unit/final-writeups-views.test.js`
- re-pin `dashboard search filters all queues without adding filter controls other than the cycle selector` → "…other than the cycle select, view selector, and Program director filter"
- `dashboard opens on Needs my review for every persona and never sends view or pd to the API`
- `view selector partitions by bucket: updated rows stay in Reviewed by me, stewardship only in All`
- `All writeups merges the buckets and sorts by request number`
- `invalid view and pd are sanitized on mount and the address bar is rewritten immediately`
- `Program director options derive from loaded rows and filter list, Your writeups, configured and unconfigured matrix rows`
- `non-GUID pd is dropped; a GUID absent from the cycle keeps an option and shows the empty copy`
- `view does not filter the coordinator matrix`
- `header count and view counts reflect the PD filter and search together`
- `cycle change preserves view and pd in the URL`
- `Needs my review empty state offers the other views with counts`
- re-pin `walk-back outcomes are rendered from response fields only` with the corrected copy
- `rows render the exact publicationVersionId verbatim and the exact acknowledgedPublicationVersionId when updated`
- `focused panel states name the exact reviewed and current versions`

`tests/unit/final-writeup-acknowledgement-service.test.js`
- `projection returns acknowledgedPublicationVersionId from the personal row, null without one, and null for the responsible PD even with a historical row`
- `markFinalWriteupReviewed returns the exact acknowledgedPublicationVersionId of the confirmed row (fresh and reused)`

`tests/unit/final-writeups-dashboard-service.test.js`
- `rows carry the exact acknowledgedPublicationVersionId from the personal acknowledgement row`
- `unconfigured matrix rows carry responsibleProgramDirector`

Every negative assertion uses a fixture that would trip it (all three buckets populated, two PDs,
a matrix present) so a deleted guard turns the test red.

## 9. Docs to reconcile at build (in place, never appended)

- `docs/FINAL_WRITEUP_REVIEW_IMPLEMENTATION_PLAN.md` Slice 6: rewrite the 6B and 6C paragraphs to
  this shape (no stage filter, no four-state control), point to this plan, update the frontmatter
  summary; mark 6D/6E closed.
- `docs/FINAL_WRITEUPS_DASHBOARD_CYCLE_SCOPING_PLAN.md` §12 tail: pointer to this plan.
- `docs/CURRENT_WORK_QUEUE.md` item 5: 6B/6C status.
- `docs/API_ROUTE_SECURITY_MATRIX.md`: both route rows gain "response includes the viewer's
  acknowledged publication version (additive)"; note that `view`/`pd` are page-URL state the route
  never receives.
- `docs/atlas/dataverse-wmkf-finalwriteupreviewacknowledgement.md` read-path paragraph: the
  projection exposes the stored publication version to the dashboard and focused page.
- `shared/components/final-writeups/FinalWriteupsViews.js` header comment (§4.6).
- `npm run generate:docs-catalog` after adding this file.

## 10. Owner decisions

**Non-blocking; defaults stated. The build proceeds on the defaults unless the owner objects.**

1. **Updated-since-review rows stay in Reviewed by me** (amber chip), per the live copy "an update,
   not a new requirement". Alternative: move them to Needs my review. Default: stay.
2. **Your writeups** remains a collapsed section under Needs my review and Reviewed by me, and is
   folded into the list under All writeups. Alternative: a fourth view "My writeups". Default: as
   stated (the owner dropped the stage filter to keep controls minimal; a fourth view cuts the other
   way).
3. **The view selector does not filter the coordinator matrix; the PD filter does.** Default: as
   stated.
4. **Walk-back stays "any visible row"** with an informative empty state, rather than a view-aware
   server walk-back. Default: as stated.

## 11. Gates and exit

Sequential gate + self-test pairs for touched surfaces: `check:api-routes`,
`check:status-enum-parity`, `check:route-service-boundary`, `check:doc-currency`,
`check:fact-consistency`; then `check:docs-catalog`, `check:types`, lint, and
`npm test -- --runInBand --watch=false --testPathPatterns "final-writeup"`.

Process: Codex adversarial plan review (`/codex:adversarial-review --wait`) before the build; Tier 1
branch `claude/final-writeups-views-and-version`; Codex diff pass; PR to `main`; owner-run signed-in
smoke on the three views, the PD filter, a bookmarked URL, and one row's version label. Exit: queue
item 5 "Met when" clause satisfied except the two-cycle load, which 6A already covers.

## 12. Review disposition (Codex adversarial review, 2026-09-06, verdict NEEDS REWORK)

| # | Finding | Disposition |
|---|---|---|
| 1 (high) | Unconfigured matrix rows carry no PD key, so the PD filter cannot cover them | **Accepted.** `unconfiguredMatrixRow` gains `responsibleProgramDirector`; filter is total; service and views tests added (§3, §4.2, §5, §7, §8). |
| 2 (medium) | All writeups "sorted by request number" is not achieved by concatenating pre-sorted buckets | **Accepted.** Every view re-sorts after merge and filter; interleaved-number test (§4.1, §7, §8). |
| 3 (medium) | URL sanitization timing contradicted itself ("next write" vs "dropped") | **Accepted.** Normalization is immediate on mount with an address-bar rewrite; tests assert `window.location.search` after mount and after each change (§4.1, §4.2, §7, §8). |
| 4 (medium) | The proposed `FinalWriteupTab` fixture test would be decorative | **Accepted.** Test removed; exact-value assertions placed on projection, dashboard row, and focused render (§4.5, §7, §8). |

**Second pass (2026-09-07, verdict NEEDS REWORK):**

| # | Finding | Disposition |
|---|---|---|
| 1 (high) | The POST acknowledgement response is hand-built and would lack the new field, diverging from GET | **Accepted.** POST adds `acknowledgedPublicationVersionId` from the confirmed row; exact-value test fresh and reused (§3, §4.5, §7, §8). |
| 2 (medium) | Header count pinned to the unfiltered server count while view counts follow the filters | **Accepted.** Header derives from filtered open rows and names the selected PD; test narrows both together (§4.1, §7, §8). |
| 3 (medium) | Walk-back copy still conflated visibility with personal work | **Accepted.** Copy now says "visible to you", matching `visibleProjected` (§4.4). |

**Third pass (2026-09-07, verdict READY WITH NAMED CHANGES):**

| # | Finding | Disposition |
|---|---|---|
| 1 (medium) | `acknowledgedPublicationVersionId` was unconditional, so a responsible PD with a historical row would expose a stale version on a stewardship row | **Accepted.** Field is `isResponsiblePd ? null : …`; responsible-PD-with-row fixture added (§4.5, §8). |

Three passes reached the stopping rule; the build proceeds on this plan.

**Build diff, first pass (2026-09-07, verdict needs-attention):**

| # | Finding | Disposition |
|---|---|---|
| 1 (medium) | A valid `pd` GUID with surrounding whitespace passed `isGuid` but was stored untrimmed, so it matched no row and showed the absent-PD state | **Accepted.** `pd` is canonicalized (trim + lowercase) before validation; any raw value that differs from the canonical form triggers the on-mount rewrite; regression test added. |

**Build diff, second pass (2026-09-07, verdict approve):** no material findings; the pd canonicalization fix verified closed. Two build passes reached the stopping rule.

## 13. Explicitly out of scope

Stage filter (owner dropped it), 6D "has edits", 6E other-stage lists, approval gates,
denominators, program-taxonomy grouping, authorization changes, any route or query change, the
Leadership stage transition (separate plan), matrix redesign, inline preview.

## 14. Build record (2026-09-07, branch `claude/final-writeups-views-and-version`)

Built per §4–§8 with no deviation from the plan; merged to `main` via PR #175 as `44bdd240` (Production deployment `dpl_2UrsDnydRqudu95wJyLCK7A6FUFR`, Ready 2026-09-07 PT; all PR checks green including the full Jest run). Owner-run signed-in smoke pending. Files: `lib/services/final-writeup/acknowledgement-service.js`
(`acknowledgedPublicationVersionId` in the shared projection, null for the responsible PD, and in
the `markFinalWriteupReviewed` response from the confirmed row), `lib/services/final-writeup/dashboard-service.js`
(row passthrough; `responsibleProgramDirector` on unconfigured matrix rows),
`shared/components/final-writeups/FinalWriteupsViews.js` (one frozen `VIEWS` map holding allowlist,
labels, and selectors; `readLocationState` / `writeLocationState` with immediate on-mount rewrite of
an invalid `view` or `pd`; `ProgramDirectorSelector`, `ViewSelector`, per-view merge and sort by
request number; filtered header count naming the selected PD; Needs my review empty state with
view-switching counts; walk-back copy "visible to you"; `VersionContext` on rows and version copy
on the focused document and acknowledgement panel; header thesis comment rewritten), and the three
test files (13 new or re-pinned views tests, 2 acknowledgement-service tests, 2 dashboard-service
tests; 167 `final-writeup*` tests green). Complement check: unknown `view` → default and dropped
from the URL on mount; non-GUID `pd` → dropped on mount; GUID `pd` absent from the cycle → kept as
the controlled value with the absent-PD option and empty copy; `view=needs-review` written
explicitly → normalized away (clean URL stays clean); matrix rows with a null PD id → shown only
under All program directors. Docs reconciled in place: implementation plan Slice 6, 6A plan §12
tail, queue item 5, both route-matrix rows, the acknowledgement Atlas read path.
