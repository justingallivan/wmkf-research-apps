---
target: integrated reviewer workflow
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-09-02T06-01-00Z
slug: pages-workbench-reviewer-follow-up-js
---
Method: dual-agent (A: /root/critique_visual · B: /root/critique_workflow)

# Integrated Reviewer Workflow Critique

## Design Health Score

| Nielsen heuristic | Score / 4 | Assessment |
|---|---:|---|
| Visibility of system status | 3 | Dashboard counts, status chips, banners, and alert states are useful; loading and some lifecycle states are not consistently announced or explained. |
| Match between system and real world | 4 | The request, reviewer, due-date, campaign, and review vocabulary closely matches the grant-review workflow. |
| User control and freedom | 3 | Search, filters, collapse controls, and retry paths are present; dense expanded content and mobile horizontal panning reduce practical control. |
| Consistency and standards | 2 | The three views use different responsive patterns, date styles, lifecycle language, and preview-safety treatment. |
| Error prevention | 1 | The dashboard communicates Preview read-only behavior, but request-level pages still present enabled write actions even though the runtime interlock blocks them. |
| Recognition rather than recall | 2 | Labels and proposal context are generally visible, but users must remember hidden table columns and infer lifecycle relationships across views. |
| Flexibility and efficiency of use | 2 | Filtering and direct actions help experienced users; the attention view defaults to a long wall of expanded tables and lacks batch navigation shortcuts. |
| Aesthetic and minimalist design | 2 | The restrained visual style is credible, but hierarchy is flat and repeated controls/tables create substantial visual weight. |
| Help users recognize, diagnose, and recover from errors | 3 | Alerts and retry affordances are solid; search-empty and outstanding/overdue terminology can misdiagnose the current state. |
| Help and documentation | 2 | Contextual explanations exist, especially around Preview, but action consequences and state terminology need more in-place guidance. |
| **Total** | **24 / 40** | **Acceptable, with significant improvements needed.** |

## Design Specificity Verdict

The information architecture and vocabulary feel purpose-built for grant-review operations. The visual language is less distinctive: gray tables, blue chips, underline tabs, and outline buttons could belong to many administrative products. The strongest opportunity is to make the reviewer lifecycle—assigned, invited, opened, outstanding, overdue, received, escalated—the shared visual grammar across all three views.

The deterministic scan found five advisory design-system departures, all literal `text-[10px]` uses: four in `ReviewsTab.js` and one in `ReviewerStatusIndicator.js`. These are real typography off-ramps, though most were conditional and not visible in the reviewed request. No reliable live `[Human]` overlay could be produced because the available browser evaluation path was read-only, so visual corroboration used accessibility snapshots, screenshots, DOM measurements, and responsive viewport checks.

## Overall Impression

This is a credible operational tool with unusually strong domain continuity: the dashboard, reviewer tracking, and review-entry views clearly belong to one workflow. Its core weakness is that the interface becomes hardest to use precisely where the work becomes urgent. The dashboard expands seven attention-heavy proposals into a 5,077-pixel page, mobile tables conceal most of their content and actions, and Preview safety changes from an explicit contract on the dashboard to a hidden runtime safeguard on request pages. The result is functional depth without a sufficiently coherent interaction hierarchy.

The emotional journey begins calm and legible at the summary level, drops sharply when users reach the dense attention tables or mobile tracking view, and partially recovers in the Reviews view, whose stacked mobile cards are much easier to scan. The runtime interlock protects data, but the visible interface still invites actions that cannot succeed in Preview, which is a trust problem rather than merely a backend concern.

## What’s Working

- Cycle-to-request continuity is strong: users can move from aggregate workload to a proposal without losing the operational context.
- Domain labels are clear and specific, and long reviewer or proposal identities are constrained with truncation plus title text rather than allowed to destroy layouts.
- The dashboard Preview banner is prominent, uses a status region, and disabled reminder controls include useful reasons.
- Semantic headings, labels, tables, `aria-expanded` on collapse controls, text-plus-color status indicators, alert/retry behavior, and visible focus rings provide a solid accessibility base.
- The Reviews mobile layout proves a card-based small-screen treatment can work well for this product.

## Priority Issues

### 1. [P1] Preview safety is not a workflow-wide visual contract

**Why it matters:** The dashboard says the environment is read-only and disables reminder actions, while Track Reviewers and Reviews still show enabled Campaign settings, templates, extensions, notes, reminders, management, and manual-entry controls. The runtime interlock blocks writes, but users receive contradictory promises from adjacent screens and may invest work only to hit an error.

**Fix:** Lift Preview capability state into the shared Workbench/request shell. Show one consistent environment banner on every reviewer surface, disable or hide every write affordance using the same reason text, and preserve the backend interlock as the final safety boundary. Verify keyboard and screen-reader states, not just visual disabled styling.

**Suggested command:** `$impeccable harden`

### 2. [P1] Mobile reviewer tables conceal the workflow

**Why it matters:** At 390px, the dashboard and Track Reviewers tables are about 1,216–1,280px wide inside roughly 322–356px scrollers. Critical status and primary actions sit off-screen, the horizontal-scroll requirement is not signposted, and Track Reviewers leaks the document to 681px wide. A user can see a reviewer name without knowing the state or discovering the action.

**Fix:** Reuse the Reviews view’s stacked-card pattern below the medium breakpoint. Put reviewer identity, lifecycle state, due/outstanding information, and one primary action in the visible card; place secondary actions in an accessible overflow menu. As an interim containment fix, wrap the Track toolbar, eliminate page-level overflow, make identity/status sticky, and add a clear horizontal-scroll affordance.

**Suggested command:** `$impeccable adapt`

### 3. [P1] “Needs attention” opens as a wall of expanded tables

**Why it matters:** Seven proposals are expanded by default, producing a page over 5,000px tall at desktop width. Repeated table chrome overwhelms urgency cues, increases scanning cost, and makes it difficult to answer the basic question: what should I do next?

**Fix:** Default to compact proposal summaries showing urgency, affected-reviewer count, nearest due date, and recommended next action. Expand only the highest-urgency item, remember deliberate expansion state, and add Expand all/Collapse all for power users. Keep filters and counts visible while scrolling.

**Suggested command:** `$impeccable distill`

### 4. [P2] Navigation and selected-state semantics are too visual

**Why it matters:** The mobile Workbench navigation is clipped inside a 702px strip, keyboard focus does not reliably reveal the full label, the Needs attention/All requests selection lacks pressed or tab semantics, and the mobile avatar and menu controls have incomplete accessible names/state. This especially affects keyboard, screen-reader, and zoom users.

**Fix:** Use a responsive navigation pattern with visible overflow affordance or a small-screen selector. Implement the view switch as tabs or a segmented control with `aria-selected`/`aria-pressed`, name the avatar and menu buttons, and expose `aria-expanded` plus `aria-controls` for the menu. Ensure focus scrolls the active item fully into view.

**Suggested command:** `$impeccable audit`

### 5. [P2] Lifecycle hierarchy and feedback drift across views

**Why it matters:** Flat KPI cards, inconsistent date formats, ambiguous “14 days outstanding” copy beside zero overdue items, and a search miss that says there are no follow-ups needing attention make users reinterpret the same lifecycle repeatedly. Loading text is also not announced as status.

**Fix:** Define one lifecycle model and apply its labels, colors, date treatment, and urgency ordering everywhere. Separate “days since request” from “days overdue,” make empty-state copy reflect the active search/filter, announce loading and result-count changes, and reserve the smallest type token for genuinely secondary metadata.

**Suggested command:** `$impeccable clarify`

## Persona Red Flags

- **Alex, the power user:** Seven expanded proposals and repeated per-row controls slow rapid triage; there is no compact queue or efficient next-item rhythm.
- **Sam, the screen-reader or keyboard user:** Visually selected filters are not fully expressed semantically, loading changes are quiet, mobile navigation can hide focused destinations, and icon-only shell controls are insufficiently named.
- **Casey, the distracted mobile user:** Horizontal table panning hides state and action context, Track Reviewers exceeds the viewport, and Preview pages visibly offer actions that will fail.

## Minor Observations

- Date formatting changes between surfaces; choose one human-readable operational format.
- KPI cards are visually flat and do not distinguish workload from urgency.
- Some proposal navigation is duplicated as both a linked title and a separate action.
- The five `text-[10px]` literals should move to the product typography scale rather than remain one-off values.
- The Reviews card layout is a useful internal pattern to reuse rather than inventing a second mobile solution.

## Questions to Consider

- Is the dashboard’s primary job comparison across proposals, immediate action, or both—and which one deserves the first viewport?
- Which reviewer lifecycle event should visually dominate: deadline risk, lack of response, or completed-review quality?
- Should Preview behave as a fully read-only rehearsal surface, or should selected safe actions be available with an explicit capability model?
- Can the same card anatomy serve dashboard attention rows, reviewer tracking, and reviews on small screens so users learn one pattern?
