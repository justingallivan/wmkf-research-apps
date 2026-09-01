---
target: the complete WMKF Workbench experience
total_score: 23
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 4
timestamp: 2026-09-01T04-47-39Z
slug: pages-workbench-js
---
# Comprehensive Workbench Critique

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of system status | 3 | Request-level lifecycle feedback is strong, but the cycle dashboard hides received and outstanding review state. |
| 2 | Match system / real world | 3 | WMKF workflow language is specific; the split between Reviewers and Reviews divides one real-world follow-up task. |
| 3 | User control and freedom | 2 | Deep links and filters help, but triage can remove a row without undo and several mutations recover inconsistently. |
| 4 | Consistency and standards | 2 | Final Writeups, Awardees, Initial Assessments, the dashboard, and request tabs use different navigation and action patterns. |
| 5 | Error prevention | 3 | Identity, email, partial-result, and destructive-action safeguards are strong; two existing row actions fail important safety expectations. |
| 6 | Recognition rather than recall | 2 | Staff must remember reviewer states while moving through several requests and two request tabs. |
| 7 | Flexibility and efficiency | 2 | Request-level bulk operations exist, but there is no cycle-level follow-up queue. |
| 8 | Aesthetic and minimalist design | 2 | The palette is calm, but oversized framing, loose satellite links, nested navigation, and dense controls dilute focus. |
| 9 | Error recovery | 2 | Several modern flows recover well; notes/status failures can look successful and native dialogs remain. |
| 10 | Help and documentation | 2 | Explanatory copy is useful, but “needs attention” and the Reviewers/Reviews division are not explained around the user’s task. |
| **Total** |  | **23/40** | **Acceptable; significant IA, efficiency, and accessibility work remains.** |

## Design Specificity Verdict

The Workbench is operationally specific but structurally fragmented. Candidate provenance, invitations, materials release, deadlines, referrals, reminders, manual review entry, governed document production, and Final Writeup review are unmistakably WMKF workflows. The routes and page patterns, however, feel like successive internal tools sharing a prefix rather than one coherent operating environment.

The clearest incumbent model is Final Writeups: search-first, task-oriented, explicit about pending work, and restrained in its use of history and secondary detail. The main Workbench should adopt that hierarchy.

The deterministic scan produced 54 records across the broad Workbench/reviewer component set: 6 warnings and 48 advisories. After excluding four branch-collision color false positives and five email-preview compatibility findings, the meaningful signal is 45 literal 10px/11px type-ramp deviations. Authenticated browser inspection found no console errors, but it confirmed interaction-density and responsive problems: the representative request grew to 681px inside a 390px viewport; Reviewer secondary navigation overflowed visibly; and most request-page controls were smaller than 44px.

No visual overlay is claimed because the available browser surfaces did not permit mutable script injection.

## Overall Impression

The system is strongest when work becomes consequential: identity uncertainty, email preview and sending, partial results, document lineage, and governed transitions are handled with unusual care. Its main weakness is that staff must navigate the product’s internal structure to assemble a daily work queue.

For a PD tracking six proposals, “which reviews came in and whom should I chase?” requires opening each request and moving between Track Reviewers and Reviews. The current dashboard’s “In review” label can create false closure because it reports a coarse recruitment state, not the outstanding-review workload.

## What’s Working

1. Request identity and deep-linkable context remain stable across the workflow.
2. High-risk reviewer operations have strong identity, confirmation, and partial-result safeguards.
3. Final Writeups demonstrates an effective attention-first Workbench pattern worth reusing.

## Priority Issues

### P1 — No cycle-level reviewer follow-up workspace

The dashboard exposes proposal-level counts and coarse work stage, while individual receipt, reminder, due-date, link-opened, notes, and download state require per-request navigation.

**Fix:** add a sibling Workbench route, `/workbench/reviewer-follow-up`, sharing Cycle and My requests/All scope. Default to Needs attention and group individual reviewer rows by request.

### P1 — Reviewer follow-up is split between Reviewers and Reviews

Track Reviewers owns status, link, due date, activity, notes, email, downloads, and terminal actions. Reviews separately owns explicit reminders, manual review entry, outstanding duration, and submitted-review reading.

**Fix:** make Reviewer follow-up the canonical place for chasing, deadlines, reminders, manual receipt, notes, and downloads. Keep Review content focused on reading, comparing, synthesizing, and exporting submitted reviews.

### P1 — Existing action defects must be fixed before reuse

The current action menu can regenerate a portal link for a terminal reviewer, and the server does not reject that state. Notes and recorded-status controls also fail to check non-2xx responses, close the editor, and refresh as though the write succeeded.

**Fix:** add server-side terminal/unselected regeneration eligibility and defensive UI suppression. Introduce a checked single-row mutation helper that preserves edits and shows row-level errors.

### P1 — Track Reviewers is not responsive

At 390px the request page produced 291px of horizontal overflow. The Reviewer secondary bar expands beyond the viewport and Due Date, Last Action, Notes, and Actions disappear off-canvas.

**Fix:** render responsive reviewer cards below the desktop-table breakpoint, with identity, status, due date, and the current primary action visible. Keep secondary actions in a labeled menu.

### P2 — Workbench landing hierarchy hides the work

Historical lookup and three differently styled satellite links precede the cycle work. The request cards leave large empty centers while meaningful state is compressed at the right.

**Fix:** create a shared Workbench local navigation and compact utility header. Put Cycle, My work/All, attention totals, and the working view first. Add proposal titles to request cards.

### P2 — Workbench satellite pages do not feel like one product

Final Writeups is task-oriented and polished; Awardees is a utility table; Initial Assessments uses a large generic page header; `/workbench` uses loose text links.

**Fix:** use a shared Workbench shell with real sibling routes: Requests, Reviewer follow-up, Final writeups, Initial assessments, and Awardees.

### P2 — Accessibility semantics and touch targets are inconsistent

Dashboard cards are button-like containers holding a live select; reviewer selection checkboxes lack contextual names; tab strips lack a coherent semantic model; mobile navigation has an unnamed icon-only control; many controls are below 44px.

**Fix:** use real links for navigation, label every selection with reviewer/request context, normalize local navigation semantics, provide named modal/menu controls, and verify keyboard, focus, 200% zoom, and mobile behavior.

### P3 — Terminology drifts

“going-forward” and “Advancing” describe the same state. “Reviewers” and “Reviews” divide follow-up ambiguously. “Initial Assessment Pilot Locator” is implementation language rather than a durable staff task.

**Fix:** adopt a compact vocabulary: Requests, Reviewer follow-up, Review content, Final writeups, Initial assessments, and Awardees.

## Contract Findings

The consolidated page requires a new lean, cycle-scoped read endpoint. Existing dashboard data contains only counts; the existing reviewer loader is request-specific or lead-PD-specific and brings heavy answer/synthesis data that the tracker does not need. Mounting multiple existing request loaders would recreate the six-request problem as N+1 network work.

No schema or new persistence is required. The tracker should read the existing request, reviewer-suggestion, and potential-reviewer data and reuse existing write routes. Its read service must share the dashboard’s exact cycle/scope/Set Aside request population, batch reviewer/person hydration, and return server-computed `canManage` per request.

Selections and batch actions must remain request-local. A global selection spanning proposals is unsafe because email content, attachments, campaign settings, and lifecycle state are request-specific. Existing partial-success semantics must remain visible per reviewer; they must not be reduced to a success count.

The client must guard every load and mutation refresh with the complete `{cycle, scope, includeSetAside}` generation. A late response from an old filter state must never repaint the new view.

## Recommended Information Architecture

Use one Workbench family with stable sibling routes:

`Requests | Reviewer follow-up | Final writeups | Initial assessments | Awardees`

- `/workbench` remains the request-card roster.
- `/workbench/reviewer-follow-up` becomes the consolidated operational page.
- Shared Cycle and My work/All controls use the same request-scope contract.
- Per-request Workbench pages remain drill-down destinations, not the only place routine follow-up can be performed.

### Reviewer follow-up page

1. Header: Cycle, My requests/All, Needs attention/All reviewers, search, optional Show set aside.
2. Attention totals: awaiting response, materials not sent, due soon/overdue, newly received, still outstanding.
3. Request groups: request number, proposal title, institution, PD, received count, strongest attention state, full-request link.
4. Reviewer rows: identity, lifecycle status, link opened, effective due date, last action/reminder, receipt/download, notes, state-specific primary action, secondary menu.
5. Full request-local action parity: email/reminder, release materials, extension, notes, history, manual receipt, download, status correction, link actions, terminal actions.

## Action Plan

### Phase 0 — Safety prerequisites

1. Block portal-link regeneration for terminal or unselected reviewers on the server and hide it in the UI.
2. Make note and recorded-status writes check HTTP success, preserve edits on failure, and report row-level errors.
3. Decide terminal-row population explicitly: active/received rows in the main queue; closed history read-only or omitted consistently.
4. Define the exact Needs attention buckets and due-soon/fresh-receipt rules.

### Phase 1 — Shared read contract

1. Extract the exact dashboard request-scope query so Requests and Reviewer follow-up cannot drift.
2. Add `GET /api/workbench/reviewer-tracker` as a thin authenticated route.
3. Batch-load the lean reviewer projection and people data; fail loudly on truncation/caps.
4. Return server-derived `canManage` and request-grouped rows.
5. Add route, service, scope, projection, and query-count tests plus durable route/Atlas updates.

### Phase 2 — Consolidated working queue

1. Add the shared Workbench navigation and `/workbench/reviewer-follow-up` route.
2. Build attention filters, request groups, reviewer rows/cards, and received/outstanding summaries.
3. Extract action primitives rather than mounting full ReviewersTab/ReviewsTab instances.
4. Add full action parity progressively, keeping selection and partial outcomes request-local.
5. Guard loads and mutation refreshes against cycle/scope changes.

### Phase 3 — Responsive and accessibility hardening

1. Replace mobile tables with reviewer cards and contain both navigation strips.
2. Fix nested interactive-card semantics, names, focus behavior, live regions, and small targets.
3. Verify 390px, tablet, desktop, 200% zoom, keyboard-only use, and no page-level overflow.

### Phase 4 — Workbench coherence

1. Reframe per-request Reviews as Review content and move follow-up actions to the canonical follow-up model.
2. Normalize Awardees and Initial Assessments into the shared Workbench shell.
3. Reduce technical/temporary labels and align state vocabulary.
4. Revisit lifecycle-sensitive request navigation after the tracker is proven.

### Phase 5 — End-to-end verification

Exercise pending invitation, accepted/no materials, materials sent/unopened, due soon, overdue, reminder sent, extension, received with and without file, terminal status, manual receipt, partial email failure, stale filter state, non-lead All view, and superuser behavior.

## Persona Red Flags

**Power user / PD:** no cycle-level outstanding-review queue, no search/attention filter over current requests, and repeated Request → Reviewers/Reviews navigation prevents a fast daily pass.

**Keyboard, screen-reader, or high-zoom user:** unnamed selection controls, nested interactive semantics, overflowing Reviewer navigation, clipped columns, small targets, and inconsistent modal naming block efficient use.

**Program-operations coordinator:** actions are comprehensive within one request, but the split between Track Reviewers and Reviews obscures where follow-up belongs and offers no cycle-level completion state.

## Minor Observations

- Add proposal titles to request cards and request-group headers.
- “In review” is too coarse when all reviewers may still need attention.
- Campaign Settings, Email Templates, and Manage in Profile compete as peer controls.
- Empty states should offer the next direct action.
- The Workbench subtitle still describes a reviewer tool although the route now spans the broader request lifecycle.
- The 45 meaningful small-type findings should be resolved as components are touched rather than by a blind global rewrite.

## Questions to Consider

- What exact condition removes a reviewer from Needs attention, and should staff be able to snooze an item?
- Should newly received reviews stay highlighted until explicitly acknowledged or only for a time window?
- Should a PD ever need to open Review content merely to chase a reviewer?
- Which late-lifecycle request tabs should remain visible before their stage is active?
- What should the end of a daily follow-up pass display so staff know they are caught up?
