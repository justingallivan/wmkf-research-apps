# Request Workbench top-matter recommendation (Codex, 2026-09-08)

> Written by Codex (gpt-5.6-sol) on 2026-09-08 at the owner's request as an independent second opinion; promoted from the gitignored `outputs/` directory so it travels with the repo. Owner chose this recommendation over Claude's on 2026-09-08, with two amendments: Initial assessments gets no new top matter until its J27 design (the D26 hide is deliberate, so the D26 deep-link item is dropped), and on Final writeups and Awardees the Grant Program select becomes read-only context with a note rather than a real filter.

## Executive recommendation

Make the top of every Workbench view read as one stable sentence:

> **You are in the Request Workbench, looking at this grant program and cycle, in this view, with these view-specific filters, showing this many results.**

Today those clauses are present, but their order, ownership, vocabulary, and count semantics vary by view. [ASSUMED] The strongest model is a fixed shell hierarchy followed by one repeated view pattern:

1. Page identity and a global **Find and open a request** utility.
2. Universal context: **Grant program** and **Grant cycle**.
3. Workbench view navigation.
4. Active-view heading and one-sentence purpose.
5. View-only controls.
6. One explicit results summary, then the list.

The most important correction is semantic, not cosmetic: a control should sit in the shell only if it actually constrains every view. The shell's Grant Program is always visible, but `programId` is passed only to Request list and Reviewer follow-up; Final writeups, Awardees, and Initial assessments receive cycle context without the program. [VERIFIED via shared/components/workbench/WorkbenchShell.js:195-246] Either make Program a real input to all five data contracts or stop presenting it as universal on the three views that ignore it.

This was a source-only Operate-mode review using Impeccable's consistency, cognitive-load, and UX-copy lenses. The Impeccable detector returned no deterministic findings. Browser and server inspection were intentionally skipped under the review constraints.

## 1. Current inventory

### Shared shell on all five views

The shell renders the page title and reviewer-specific subtitle, then the five-view navigation, then the Grant Program and Cycle selectors. [VERIFIED via shared/components/workbench/WorkbenchShell.js:151-186] The view strip offers Request list, Initial assessments, Reviewer follow-up, Final writeups, and Awardees; Initial assessments is hidden for D26. [VERIFIED via shared/components/workbench/WorkbenchViewsNav.js:5-26]

The Cycle options append `cycle.count` when it is truthy. [VERIFIED via shared/components/workbench/WorkbenchShell.js:173-185] That count is the number of non-set-aside, Workbench-eligible requests across the selected program—not a count of assessments, reviewer follow-ups, writeups, or awardees. [VERIFIED via lib/services/workbench/dashboard-service.js:92-105] [VERIFIED via lib/services/workbench/dashboard-service.js:127-161]

| View | View-owned top matter today | Scope/filter behavior today | Counts and headings today |
|---|---|---|---|
| **Request list** | A large **Find a request** card appears first. It contains a text query, its own Grant Program, Cycle, and Request status selects, an explicit Search action, and Clear. [VERIFIED via shared/components/workbench/RequestLocator.js:311-408] Below it are the list controls: a My requests/All segment and **Show set aside** checkbox. [VERIFIED via shared/components/workbench/RequestListPanel.js:185-222] | The list request changes with shell program, shell cycle, `scope`, and `includeSetAside`. [VERIFIED via shared/components/workbench/RequestListPanel.js:95-135] The locator owns separate program/cycle/status state and restores saved criteria/results from session storage. [VERIFIED via shared/components/workbench/RequestLocator.js:66-112] | **My requests** includes a count; **All** does not. A separate rollup reports total requests, those needing reviewers, and complete requests. [VERIFIED via shared/components/workbench/RequestListPanel.js:137-139] [VERIFIED via shared/components/workbench/RequestListPanel.js:189-220] There is no view heading before the locator. [VERIFIED via shared/components/workbench/RequestListPanel.js:185-188] |
| **Initial assessments** | No view-specific controls. The panel moves directly into error, loading, empty, or artifact cards. [VERIFIED via shared/components/workbench/InitialAssessmentsPanel.js:58-103] | The panel receives and fetches by shell cycle only. [VERIFIED via shared/components/workbench/WorkbenchShell.js:245-246] [VERIFIED via shared/components/workbench/InitialAssessmentsPanel.js:24-54] | There is no stable view heading or aggregate count; only empty/loading copy or individual artifact cards. [VERIFIED via shared/components/workbench/InitialAssessmentsPanel.js:58-103] |
| **Reviewer follow-up** | An optional read-only banner is followed by a bordered controls card containing **Requests** (My requests/All requests), **Reviewers** (Needs attention/Show all), a live search field, and Email templates. [VERIFIED via shared/components/workbench/ReviewerFollowUpPanel.js:253-336] | Program, cycle, and scope determine the loaded proposals; reviewer-state and search then filter the loaded set. [VERIFIED via shared/components/workbench/ReviewerFollowUpPanel.js:190-248] | Counts appear in the reviewer-state segment, below the live search, and again in a four-metric strip. [VERIFIED via shared/components/workbench/ReviewerFollowUpPanel.js:287-350] There is no view heading before the controls. [VERIFIED via shared/components/workbench/ReviewerFollowUpPanel.js:253-264] |
| **Final writeups** | A summary sentence appears first, then Program director, a three-way **View** segment, and a live search box. [VERIFIED via shared/components/final-writeups/FinalWriteupsViews.js:736-790] | Cycle determines the server load; Program Director and search filter the loaded queues client-side, while the selected writeups view chooses a queue. [VERIFIED via shared/components/final-writeups/FinalWriteupsViews.js:666-720] | The leading sentence always reports the **needs-review** count, even when Reviewed by me or All writeups is active. [VERIFIED via shared/components/final-writeups/FinalWriteupsViews.js:730-747] The segment counts are calculated after both Program Director and text-search filtering, so they change while the user types. [VERIFIED via shared/components/final-writeups/FinalWriteupsViews.js:704-717] The selected queue later gets its own heading and a bare numeric count. [VERIFIED via shared/components/final-writeups/FinalWriteupsViews.js:227-239] |
| **Awardees** | The result card itself begins with **Grant deliverables — awardees**, a **Show all programs** checkbox, and a cycle/count/scope string. [VERIFIED via shared/components/workbench/AwardeesPanel.js:143-160] | The checkbox writes the shared `scope` value; `all` is rendered as **all PDs** in adjacent copy. [VERIFIED via shared/components/workbench/AwardeesPanel.js:31-32] [VERIFIED via shared/components/workbench/AwardeesPanel.js:145-158] The request is keyed by cycle and scope, with no shell program argument. [VERIFIED via shared/components/workbench/AwardeesPanel.js:46-57] | The count is rendered as `N awardee(s)` inside the compound card header. [VERIFIED via shared/components/workbench/AwardeesPanel.js:155-158] |

### Search and URL semantics

The Request locator is a submitted server search over current and historical requests; it can immediately open an exact request-number match. [VERIFIED via shared/components/workbench/RequestLocator.js:196-231] Its Cycle defaults to **All cycles**, and its options use month-year labels derived from meeting dates. [VERIFIED via shared/components/workbench/RequestLocator.js:364-380] [VERIFIED via lib/services/workbench/request-search-service.js:242-274]

Reviewer follow-up and Final writeups instead filter already-loaded rows as the user types. [VERIFIED via shared/components/workbench/ReviewerFollowUpPanel.js:188-248] [VERIFIED via shared/components/final-writeups/FinalWriteupsViews.js:660-720] Their query is mirrored through the shell's `q` URL key. [VERIFIED via shared/components/workbench/workbench-location.js:52-70] [VERIFIED via shared/components/workbench/WorkbenchShell.js:209-235]

The `scope` key is consumed by Request list, Reviewer follow-up, and Awardees. [VERIFIED via shared/components/workbench/WorkbenchShell.js:195-244] View links currently rebuild the URL with only view, program, and cycle, so scope and all other view-level state reset on a tab switch. [VERIFIED via shared/components/workbench/WorkbenchViewsNav.js:13-17]

## 2. Inconsistencies ranked by scanning cost

| Rank | Cost | Inconsistency | Why it costs a program director |
|---:|---|---|---|
| 1 | **High** | **Grant Program looks global but is not universally wired.** It is always rendered in the shell, but Final writeups, Awardees, and Initial assessments are not passed `programId`. [VERIFIED via shared/components/workbench/WorkbenchShell.js:160-185] [VERIFIED via shared/components/workbench/WorkbenchShell.js:223-246] | The strongest control on the page can imply a data boundary that the active view does not honor. Staff cannot safely infer what population they are seeing. [ASSUMED] |
| 2 | **High** | **Cycle options display a Request-list metric everywhere.** The shell appends the dashboard cycle's eligible-request count to the option label. [VERIFIED via shared/components/workbench/WorkbenchShell.js:173-185] [VERIFIED via lib/services/workbench/dashboard-service.js:127-161] | On Final writeups or Awardees, “December 2026 (42)” reads like a count for the active work even though it is not. That damages trust in every other number. [ASSUMED] |
| 3 | **High** | **“Search” names two different interaction contracts.** Request locator submits a historical server search and may navigate; the other two fields live-filter loaded rows. [VERIFIED via shared/components/workbench/RequestLocator.js:196-231] [VERIFIED via shared/components/workbench/ReviewerFollowUpPanel.js:245-248] [VERIFIED via shared/components/final-writeups/FinalWriteupsViews.js:709-720] | Users must infer whether typing changes the current list, needs a button press, crosses cycles, or opens a record. [ASSUMED] |
| 4 | **High** | **Request list presents two apparently authoritative Program/Cycle pairs.** The shell pair and locator pair are simultaneously visible, and the locator can restore different saved criteria. [VERIFIED via shared/components/workbench/WorkbenchShell.js:160-185] [VERIFIED via shared/components/workbench/RequestLocator.js:66-112] [VERIFIED via shared/components/workbench/RequestLocator.js:349-397] | The user must continuously remember which pair controls the list and which pair controls a separate result set. This is extraneous cognitive load, not task complexity. [ASSUMED] |
| 5 | **Medium-high** | **Shared scope changes presentation, words, and persistence.** Request list says My requests/All, Reviewer follow-up says My requests/All requests, and Awardees uses Show all programs while describing the state as all PDs/yours. [VERIFIED via shared/components/workbench/RequestListPanel.js:189-203] [VERIFIED via shared/components/workbench/ReviewerFollowUpPanel.js:265-307] [VERIFIED via shared/components/workbench/AwardeesPanel.js:145-158] Switching views resets that shared URL state. [VERIFIED via shared/components/workbench/WorkbenchViewsNav.js:13-17] | A program director cannot learn one reliable “mine versus all” pattern and carry it across the three views. [ASSUMED] |
| 6 | **Medium** | **Every view opens with a different anatomy.** Request list opens with a locator, Reviewer follow-up with a control card, Final writeups with count prose, Awardees with a compound card header, and Initial assessments with content. [VERIFIED via shared/components/workbench/RequestListPanel.js:185-222] [VERIFIED via shared/components/workbench/ReviewerFollowUpPanel.js:253-338] [VERIFIED via shared/components/final-writeups/FinalWriteupsViews.js:736-790] [VERIFIED via shared/components/workbench/AwardeesPanel.js:143-160] [VERIFIED via shared/components/workbench/InitialAssessmentsPanel.js:58-103] | The user must re-parse the hierarchy after every tab switch instead of scanning the same landmarks. [ASSUMED] |
| 7 | **Medium** | **Counts have unstable or unclear denominators.** Request list counts only My in the segment; Reviewer follow-up repeats related request totals; Final writeups' segment counts shrink with live search and its lead sentence ignores the active subview; Awardees uses `awardee(s)`; Initial assessments has no total. [VERIFIED via shared/components/workbench/RequestListPanel.js:189-220] [VERIFIED via shared/components/workbench/ReviewerFollowUpPanel.js:287-350] [VERIFIED via shared/components/final-writeups/FinalWriteupsViews.js:704-747] [VERIFIED via shared/components/workbench/AwardeesPanel.js:155-158] [VERIFIED via shared/components/workbench/InitialAssessmentsPanel.js:58-103] | Numbers stop being quick confirmation and become another item to interpret. [ASSUMED] |
| 8 | **Medium-low** | **The page subtitle describes only reviewer work.** It always reads “Find and manage peer reviewers for your grant requests, one cycle at a time.” [VERIFIED via shared/components/workbench/WorkbenchShell.js:151-157] | Assessments, final writeups, and awardee deliverables feel like add-ons rather than equal Workbench stages. [ASSUMED] |
| 9 | **Low but real** | **A D26 deep link can have no visible active tab.** Initial assessments is removed from the rendered nav for D26, while the panel still renders an explanatory D26 state. [VERIFIED via shared/components/workbench/WorkbenchViewsNav.js:19-27] [VERIFIED via shared/components/workbench/InitialAssessmentsPanel.js:65-69] | The page explains why the view is unavailable but weakens current-location feedback at the same moment. [ASSUMED] |

### Impeccable lens summary

- **Consistency:** the controls share a respectable neutral visual language and `ToolbarSelect` supplies consistent labeled 44/48px selects. [VERIFIED via shared/components/ToolbarSelect.js:1-18] The inconsistency is primarily semantic and structural: similar-looking controls do not have the same reach or behavior. [ASSUMED]
- **Cognitive load:** Request list is the heaviest view because five primary views, two shell context controls, a full cross-cycle locator, another three filter controls, a second scope decision, and set-aside visibility all precede the list. [VERIFIED via shared/components/workbench/WorkbenchViewsNav.js:43-74] [VERIFIED via shared/components/workbench/WorkbenchShell.js:160-186] [VERIFIED via shared/components/workbench/RequestLocator.js:311-408] [VERIFIED via shared/components/workbench/RequestListPanel.js:185-222] The user has to classify controls before using them. [ASSUMED]
- **UX copy:** “Find/open” should consistently mean cross-record retrieval and navigation; “Filter this view” should consistently mean immediate narrowing of the already loaded rows. [ASSUMED] “View,” “All,” and naked or parenthetical counts are too weak when their denominator changes by surface. [ASSUMED]

## 3. Recommended model

### A. Fixed shell hierarchy

Use this order on every tab:

1. **Page header:** Request Workbench + broad subtitle.
2. **Shell context row:** Grant program, Grant cycle, and a compact **Find and open a request** action.
3. **View navigation:** the five workflow views.
4. **Active-view intro:** one `h2` and one sentence.
5. **View toolbar:** only controls that change the active view.
6. **Results summary:** one line with an explicit noun and denominator.
7. **List/content.**

Moving Program/Cycle above the view strip makes their cross-view reach legible. Do not put view-specific scope, search, set-aside, reviewer-state, Program Director, or writeup-queue controls in the shell row.

Before shipping that hierarchy, resolve the Program contract:

- **Preferred:** make selected Grant program genuinely constrain all five views. Then “global context” is truthful.
- **Interim:** on any view that cannot honor Program, replace the active select with explicit read-only context such as “All grant programs” and a short explanation. Do not leave an enabled control whose changes do not change the results.

Remove all counts from the shell Cycle select. A cycle is context; its option label should identify the cycle, not borrow a count from one particular view.

### B. Repeated view anatomy

Use one small metadata registry for view label and description, rendered by the shell immediately below the view strip. Panels should own their controls and result data, but not invent a different opening composition.

| View | View toolbar | Results summary |
|---|---|---|
| **Request list** | **Scope:** Assigned to me / All in program; **Include set-aside requests** | `N requests` plus optional secondary operational metrics such as `X need reviewers · Y complete` |
| **Initial assessments** | None | `N initial assessments` |
| **Reviewer follow-up** | **Scope:** Assigned to me / All in program; **Reviewer status:** Needs attention / All; visible live-filter label | `N requests · X active reviewers · Y overdue · Z reviews received` |
| **Final writeups** | **Responsible program director**; **Review queue:** Needs my review / Reviewed by me / All writeups; visible live-filter label | `N writeups`, or `Showing X of Y writeups` during text filtering |
| **Awardees** | **Scope:** Assigned to me / All in program | `N awardees` |

Use the same labeled segmented-control component for the three `scope` consumers, in the same first position. Preserve `scope` when moving among Request list, Reviewer follow-up, and Awardees. Reset truly view-specific state—set-aside, reviewer status, writeup queue, Program Director, and query—when its owning view is left unless product evidence supports persistence.

### C. Search taxonomy

Adopt two visibly and verbally distinct patterns:

1. **Find and open a request**
   - Global navigation utility.
   - Explicit Search button.
   - Searches current and historical records and may leave the list for a request.
   - Advanced Program/Cycle/Status criteria live behind **Search options**.

2. **Filter this view**
   - View-owned control.
   - No Search button; filtering is live.
   - Searches only the rows already loaded for the selected program/cycle and structural filters.
   - Always reports `Showing X of Y {unit}` while a query is active and offers a visible Clear action.

Do not use placeholder text as the only explanation of either contract. Give each field a visible label; the placeholder should only provide examples of searchable attributes.

### D. Count rules

1. **No counts in universal context controls.** Remove the request count from Cycle.
2. **One primary result count per view.** Put it immediately above the content with its noun: requests, initial assessments, writeups, or awardees.
3. **Queue counts may remain navigation aids.** Calculate them after structural filters such as program, cycle, scope, or Program Director, but before free-text filtering so they do not flicker while typing.
4. **Live-filter feedback is separate.** Use `Showing X of Y requests/writeups`.
5. **Operational metrics are not result counts.** Keep overdue reviewers, reviews received, and completion metrics in a quieter secondary line.
6. **Use real pluralization.** `1 awardee`; `2 awardees`. Never `awardee(s)` and never a naked number.

### E. What to do with “Find a request”

Keep the capability and remove the full, always-open card from the Request list's primary flow.

Promote it to a compact shell utility labeled **Find and open a request**, available from every Workbench view. A button or short disclosure in the shell context row should open the existing form in a dialog or inline disclosure. This matches what the feature actually does: locate a record across time and navigate to it, independently of the active list.

Inside the utility:

- Lead with one query field and **Search requests**.
- Initialize Program from the shell's selected Grant program.
- Put Program, Cycle, and Request status behind **Search options**.
- Keep Cycle defaulted to **All cycles**.
- State that these search options do not change the Workbench's selected program or cycle.
- Preserve exact-number auto-open and historical results.
- Label the returned block **Request search results** so it cannot be mistaken for the active view's list.

If a global disclosure is too large for the first implementation slice, use a collapsed **Find another request** disclosure beneath the shell context row. Do not leave the expanded card as the first content inside Request list.

## 4. UX copy proposals

### Shell and view intros

| Element | Proposed copy |
|---|---|
| Page subtitle | **Manage requests and the work around them by grant program and cycle.** |
| Shell select label | **Grant program** |
| Shell select label | **Grant cycle** |
| Request list | **Requests** — “Triage requests and open reviewer work for the selected program and cycle.” |
| Initial assessments | **Initial assessments** — “Open governed Initial Assessment documents for the selected program and cycle.” |
| Reviewer follow-up | **Reviewer follow-up** — “Track invitations, overdue reviews, and received reviews for the selected program and cycle.” |
| Final writeups | **Final writeups** — “Review current writeups and acknowledge the latest versions.” |
| Awardees | **Awardees** — “Track grantee deliverables for awardees in the selected program and cycle.” |

*Amended at build (2026-09-08): research awardees in the selected cycle; the Awardees scope's second option reads All program directors.*

### Controls, search, and counts

| Current idea | Proposed label/copy |
|---|---|
| My/All request scope | Label: **Scope**; options: **Assigned to me** / **All in program** |
| Show set aside | **Include set-aside requests** |
| Reviewer state | Label: **Reviewer status**; options: **Needs attention** / **All** |
| Final writeups “View” | Label: **Review queue**; options unchanged: **Needs my review** / **Reviewed by me** / **All writeups** |
| Final writeups PD | **Responsible program director**; default: **All program directors** |
| Global locator heading | **Find and open a request** |
| Global locator helper | **Search current and past requests. Search options do not change the Workbench context.** |
| Locator query label | **Request number, institution, PI, or title** |
| Locator placeholder | **e.g., 1002959 or University of Washington** |
| Locator primary action | **Search requests** |
| Locator advanced disclosure | **Search options** |
| Reviewer live-filter label | **Filter reviewer follow-up** |
| Reviewer placeholder | **Request #, institution, PI, or reviewer** |
| Final-writeups live-filter label | **Filter final writeups** |
| Final-writeups placeholder | **Request #, title, institution, PI, or program director** |
| Search feedback | **Showing 7 of 24 requests** / **Showing 3 of 18 writeups** |
| Empty live-filter state | **No requests match this filter. Clear the filter or try another term.** |
| Awardee count | **1 awardee** / **12 awardees** |

Use sentence case consistently: **Grant program**, **Program director**, **Initial assessments**, and **Final writeups**. Current capitalization varies between the navigation and panel copy. [VERIFIED via shared/components/workbench/WorkbenchViewsNav.js:5-10] [VERIFIED via shared/components/workbench/InitialAssessmentsPanel.js:65-73] [VERIFIED via shared/components/final-writeups/FinalWriteupsViews.js:773-783]

## 5. Implementation sketch

### First slice: reconcile structure and semantics

- **`shared/components/workbench/WorkbenchViewsNav.js`**
  - Export one view metadata registry containing key, label, and description.
  - Accept and preserve `scope` only when navigating among its three consumer views.
  - Keep view-specific query state out of unrelated links.
  - Resolve the D26 deep-link state so the active location remains visible, or redirect with an explanatory notice.

- **`shared/components/workbench/WorkbenchShell.js`**
  - Replace the reviewer-only subtitle.
  - Reorder the shell to Page header → context row → view strip → active-view intro.
  - Remove counts from Cycle option labels.
  - Mount the compact locator trigger/disclosure globally.
  - Pass the metadata-defined active-view heading and description.
  - Make the Program control truthful: either wire `programId` to every view or render an explicit non-program-scoped state on exceptions.

- **`shared/components/workbench/RequestLocator.js`**
  - Accept shell program as its initial search scope.
  - Convert the existing card body into a disclosure/dialog body.
  - Put Program/Cycle/Status under Search options.
  - Replace generic Search language with find/open language and label the result block.
  - Keep locator state separate from the live-filter `q` URL key.

- **`shared/components/workbench/RequestListPanel.js`**
  - Remove the leading `RequestLocator` mount.
  - Add the standard Scope segment and results summary.
  - Normalize set-aside copy and separate operational rollups from the result count.

- **`shared/components/workbench/ReviewerFollowUpPanel.js`**
  - Use the standard view toolbar rather than a unique all-in-one card header.
  - Normalize Scope and Reviewer status labels.
  - Add a visible **Filter reviewer follow-up** label and explicit Clear action.
  - Keep the reviewer-health metrics, but remove duplicate request-count presentation.

- **`shared/components/final-writeups/FinalWriteupsViews.js`**
  - Rename **View** to **Review queue** and Program director to **Responsible program director**.
  - Compute queue counts before applying text search.
  - Make the primary result summary reflect the active queue.
  - Report `Showing X of Y writeups` during live filtering.

- **`shared/components/workbench/AwardeesPanel.js`**
  - Move controls out of the result card header.
  - Replace the checkbox with the standard Scope segment.
  - Remove the contradictory **Show all programs** / **all PDs** vocabulary.
  - Use grammatical, explicit result counts.

- **`shared/components/workbench/InitialAssessmentsPanel.js`**
  - Participate in the standard view intro and result-summary pattern despite having no controls.
  - Return an aggregate count for the loaded artifacts to the standard summary.

- **`shared/components/ToolbarSelect.js`**
  - No change is required for the base recommendation; it already distinguishes 48px shell controls from 44px compact controls and associates labels with selects. [VERIFIED via shared/components/ToolbarSelect.js:1-18] [VERIFIED via shared/components/ToolbarSelect.js:28-59]

- **`shared/components/workbench/workbench-location.js`**
  - Keep shell and view state URL-owned.
  - Do not overload `q` with locator criteria.
  - If navigation preservation is centralized here, define the rule explicitly: preserve shared `scope` across its three views; drop view-only state when leaving its owner.

### Contract prerequisite if Program becomes truly universal

The UI should not imply universal Program scoping until the three affected data paths accept and enforce it. That likely extends beyond top-matter components to `pages/api/workbench/final-writeups.js`, `pages/api/workbench/grantee-deliverables/awardees.js`, `pages/api/workbench/initial-assessment.js`, and their service/adapter boundaries. Treat that as a separate contract-reconciliation slice: caller → route → service → Dataverse filter → count/empty-state copy.

### Suggested sequence

1. Remove the cycle count suffix and replace the shell subtitle.
2. Establish the shared view metadata and repeated intro/toolbar/results anatomy.
3. Normalize scope, live-filter labels, and count rules.
4. Move Request locator into the global disclosure.
5. Reconcile universal Program behavior across the three currently unwired views.
6. Resolve the D26 deep-link/current-location edge case.

This sequence delivers immediate clarity without hiding the deeper program-scoping contract that must be settled before the shell can be considered fully trustworthy.
