---
target: pages/workbench.js
total_score: 25
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 3
timestamp: 2026-08-31T01-38-49Z
slug: pages-workbench-js
---
Method: dual-agent (A: /root/workbench_design_assessment · B: /root/workbench_detector_assessment)

# Impeccable Critique — Workbench

## Design Health Score

**25/40 (62.5%) — capable and trustworthy, but structurally overexposed.**

| Nielsen heuristic | Score | Evidence-based assessment |
|---|---:|---|
| Visibility of system status | 3/4 | Loading, saving, generation, document, and reviewer states are usually explicit. Some dashboard mutations do not provide durable success feedback. |
| Match with the real world | 3/4 | Grant-cycle, request, PI, reviewer, and board language match staff work; Dataverse, SharePoint paths, artifacts, prompts, and source-system labels sometimes displace task language. |
| User control and freedom | 2/4 | Back links, retries, reconsideration, and cancelable dialogs are solid. Triage can remove a row after a single selection without a visible undo. |
| Consistency and standards | 2/4 | Shared cards and tab patterns are coherent, but terminology, icon vocabulary, action colors, and nested navigation drift. |
| Error prevention | 3/4 | Consequential document actions use confirmations, disabled states, identity checks, and preserved canonical versions. Dashboard triage is the notable weak point. |
| Recognition rather than recall | 3/4 | Request context, badges, stages, and an Overview reduce recall. Nine equal-weight tabs and nested reviewer navigation still require a learned mental map. |
| Flexibility and efficiency | 2/4 | Direct lookup, deep links, bulk selection, exports, comparison, and manual entry support experts. There is no evident role-specific or compact task path. |
| Aesthetic and minimalist design | 2/4 | Neutral cards and restrained borders support scanning, but important and peripheral actions often receive equal weight and Reviewer Find exposes many decisions at once. |
| Error recognition and recovery | 3/4 | Errors commonly name the failed operation, preserve prior results, and offer retry. Raw server messages and browser-alert paths remain. |
| Help and documentation | 2/4 | Inline explanation and contextual help exist, but help is uneven and technical explanation sometimes substitutes for concise task guidance. |
| **Total** | **25/40** | All ten heuristics apply to this operating workspace. |

## Design Specificity Verdict

**Partially opinionated.** The workflow semantics are distinctly WMKF: grant cycles, PD scope, reviewer funnels, governed AI artifacts, canonical documents, and Draft → Share → Wrap Up are strongly authored for the actual work. The visual and navigational grammar is more generic: white Tailwind cards, gray borders, shallow shadows, mixed accent colors, emoji/glyph/Lucide icon styles, and capability-first tabs could belong to many internal SaaS tools.

The deterministic scan emitted **15 records: 3 warnings and 12 advisories**. Its main signal is small-type/token drift (`design-system-font-size`, 10 records), plus two color findings and one each for font choice, overused font, and gray-on-color. Five Awardee findings belong to generated email-preview HTML rather than the Workbench surface, and the Overview gray-on-green finding is a ternary-regex false positive. The remaining compact 10–13px labels deserve a legibility review, but the scan does not indicate broad visual-system collapse.

No browser overlay was produced. The fresh browser route correctly redirected to Microsoft organizational sign-in, and the browser’s injection preflight was read-only. Authenticated Workbench pixels, real data density, and responsive overflow therefore remain unverified; visual conclusions below are source-grounded inferences.

## Overall Impression

Workbench behaves like a careful operational system built by people who understand the consequences of grant decisions. It is strongest when work becomes risky or asynchronous: the interface preserves canonical files, distinguishes uncertain identity evidence, communicates retries, and keeps human judgment visible around AI-assisted work.

Its main weakness is not missing functionality; it is missing prioritization. The dashboard reports a roster but does not clearly answer “what needs me now?” The request shell exposes nine primary destinations—including an unfinished one—and Reviewer Find presents expert controls before the core task. The result is a trustworthy system that asks staff to understand too much of its internal shape.

The likely emotional arc is practical confidence on entry, brief disorientation at the nine-tab shell, sustained vigilance during reviewer search, reassurance during recovery, and only partial closure because the shell lacks one unified completion/next-action summary.

## What’s Working

1. **Request context stays anchored.** Request identity remains visible while staff move among proposal, reviewer, deliberation, document, and status work. The Overview consolidates the most useful facts and reviewer funnel counts.

2. **Governed asynchronous work is unusually honest.** Generation, replacement, retry, canonical-version preservation, sharing locks, reopen history, and ambiguous outcomes are communicated with care. This directly supports the North Star qualities of calm, precision, and trust.

3. **Human judgment remains explicit.** Reviewer identity, verification, exclusion, evidence, and staff-required content avoid presenting AI output as settled truth.

## Priority Issues

### P1 — Flat nine-tab navigation obscures the lifecycle

- **Evidence:** the request shell presents Overview, Proposal, Initial Assessment, Reviewers, Reviews, Staff Deliberations, Final Writeup, Status, and Awardee with equal weight; Final Writeup is selectable despite being a placeholder (`pages/workbench/[requestId].js:41-50`, `133-151`, `197-200`).
- **Why it matters:** a busy program director must memorize the product’s module map instead of seeing the current stage and next action. Equal treatment also makes unfinished or conditional work appear immediately relevant.
- **Repair direction:** keep four or five primary destinations visible, move secondary or conditional surfaces under “More,” add per-stage status, and feature one explicit next action. Hide or disable Final Writeup until it is actionable.
- **Suggested command:** `/impeccable simplify` the Workbench request navigation.

### P1 — Reviewer Find exposes expert machinery before the core task

- **Evidence:** Reviewers adds three subtabs plus Campaign settings, Email templates, and Manage in Profile; the idle search form then exposes source toggles, candidate count, context, referrals, exclusions, prompt editing, and Run before results (`ReviewersTab.js:414-472`; `ReviewerSearchSection.js:3064-3240`).
- **Why it matters:** staff must reason about search infrastructure at the same moment they are making a nuanced reviewer judgment. That is high extraneous cognitive load.
- **Repair direction:** sequence the work as **Setup → Search → Review → Invite**. Default Setup to proposal, candidate count, and Run; collapse sources, referrals, exclusions, and prompt editing under Advanced. Consolidate campaign/template utilities into one menu.
- **Suggested command:** `/impeccable clarify` the Reviewer Find workflow.

### P1 — Triage can make a request disappear without visible recovery

- **Evidence:** the dashboard selector commits on change, then refetches; a set-aside row may immediately leave the default view (`pages/workbench.js:36-51`, `168-195`).
- **Why it matters:** an accidental selection can look like data loss, especially during fast queue work.
- **Repair direction:** retain the row temporarily and show “Set aside — Undo” in an assertive toast, with adjacent Saving/Saved feedback. If the state is operationally consequential, add a concise confirmation that states the effect.
- **Suggested command:** `/impeccable harden` the dashboard triage interaction.

### P2 — The dashboard reports status but does not prioritize work

- **Evidence:** the rollup reports totals, needs-reviewers, and complete; cards show metadata, a stage chip, and reviewer counts but no explicit urgency, deadline, or recommended next action (`pages/workbench.js:306-375`).
- **Why it matters:** the primary persona arrives to decide what to do next, not merely to browse requests. Status without priority leaves comparison work to the user.
- **Repair direction:** group or sort into **Needs action**, **Waiting**, and **Complete**; surface the next action and relevant deadline on each row; subordinate cycle metadata.
- **Suggested command:** `/impeccable clarify` the Workbench dashboard hierarchy.

### P2 — Technical provenance is too often primary copy

- **Evidence:** “Initial Assessment Pilot Locator,” literal SharePoint paths, governed-operation language, Dataverse explanations, prompt editing, and source-system names appear in primary task surfaces (`pages/workbench.js:254-260`; `InitialAssessmentTab.js:168-176`; `StatusTab.js:64-66`).
- **Why it matters:** provenance is valuable for auditability, but implementation nouns slow recognition and can make recovery feel like diagnosis of the system rather than continuation of the task.
- **Repair direction:** lead with task language—“Create the assessment draft,” “Open source details,” “Current organizational status”—and place system, model, path, prompt, and version provenance in expandable details.
- **Suggested command:** `/impeccable distill` Workbench task copy.

## Persona Red Flags

### Busy internal program director

- The dashboard describes reviewer management, while the request workspace expands into the full grant lifecycle; the mental model changes after entry.
- Nine primary tabs plus nested reviewer navigation impose recurring orientation cost.
- No deadline- or urgency-first queue is evident.
- Reviewer Find makes a routine task feel like operating the retrieval/AI machinery.
- Triage can remove a row without an immediately visible recovery affordance.

### Reviewer or reviewer coordinator

- External reviewers should never be routed into this internal workspace; it contains campaign settings, templates, prompt controls, identity remediation, and Dataverse/SharePoint language.
- Staff coordinators see combined Track badge counts whose meaning is not obvious until the subtab opens.
- Deep-linked access failures should route external reviewers to their dedicated review flow with plain language rather than a generic access failure.

## Minor Observations

- The main and reviewer tab strips use buttons without explicit `tablist`/`tab` roles or `aria-selected`.
- Horizontal request tabs can overflow without a visible cue that more destinations are off-screen.
- Dashboard errors are styled red but lack the alert/live-region treatment found elsewhere.
- “Advancing” and “going-forward” appear to name the same state.
- Emoji, raw glyphs, and component-library icons do not form one icon vocabulary.
- Reviewer status correctly pairs text with color; that is a good accessibility baseline.
- Several 10–13px status and metadata labels fall below the documented type ramp and should be checked at real density and zoom.
- Browser evidence verified that the protected route and sign-in redirect work at desktop and mobile widths, but it cannot support claims about authenticated Workbench overflow.

## Questions to Consider

1. **What should the request shell optimize for?**
   - A stage-first workspace with four or five primary destinations and “More”
   - The current nine destinations, but with status/availability badges and a prominent next action
   - Role- and request-state-specific destinations that appear only when relevant

2. **How much reviewer-search machinery should a program director see by default?**
   - A guided Setup → Search → Review → Invite sequence
   - One page with all advanced controls collapsed
   - Standard and Expert modes, with current controls reserved for Expert

3. **What should organize the dashboard first?**
   - Urgency queues: Needs action, Waiting, Complete
   - A sortable cycle roster with deadline and next-action columns
   - Current cards, with a pinned “Needs attention now” section

4. **How visible should technical provenance be?**
   - Task language first, provenance in expandable details
   - Dataverse/SharePoint/model names always visible for auditability
   - A user-controlled concise/technical detail mode
