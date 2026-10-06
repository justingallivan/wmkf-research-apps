---
version: 1
slug: "ents-workbench-staffdeliberationspanel-js-1912c47b"
primary_target: "shared/components/workbench/StaffDeliberationsPanel.js"
related_targets: ["shared/components/workbench/StaffDeliberationsTab.js", "shared/components/workbench/FinalWriteupTab.js"]
---

# Staff Deliberations: first-use clarity

Mode: Operate. Refine the existing Workbench style, preserving document and review contracts.

## Audience and purpose

Owner decision, 2026-10-05: every PD is new to this application AND this workflow, including its owner. Experience as a program director does not establish familiarity with the app. Explain document purpose, current facts, the next action and its consequence where needed. Do not require a tutorial, prior training or knowledge of internal lifecycle names.

The overview helps staff find a request and start its current task. Request details explain and support that task. The pre-site briefing is a concise document for circulation before the presentation. The working writeup is the fuller editable foundation, optional before the presentation and amended with presentation findings afterward. Staff explicitly start group and leadership review.

## Approved direction

- Compact overview: request identity, institution/PD, accurately labelled presentation timing, relevant document/review status and clear next action.
- Owner refinement: give each card a colored stage label, one prominent next-task instruction, and a blue primary action. Keep identity and schedule quieter; omit redundant document-status lines. Blue signals action/information, violet review, and amber an issue to check, always accompanied by text.
- Match the primary destination to the task: Word for editing a suitable document, request details for preparation or issues, and review details for active review. Retain existing Word access as secondary where appropriate. Do not classify configuration-off as staff failure.
- Keep routine sharing history, secondary documents, session and materials details in request details. Preserve access to information; do not treat missing in-app records as proof an email was not sent or files do not exist.
- Differentiate opening a destination from preparing a document or starting review. Explain consequences near the state-changing action.
- A scheduled end is not proof a presentation occurred. Disabled automation is not proof a draft is ready or blocked. Distinguish queued, running, missing, unavailable and blocked states.
- Preserve eligible request cohort, mine/all-PD scope, TEST badges, Word identity, authorization, readiness checks, confirmations and all backend behavior. Do not activate automation.

## Owner refinements, 2026-10-06 (S578; supersede the bullets above where they conflict)
- List matches Reviewer follow-up: one card per request with #number + title, "Institution · PI · PD", stage chip (gray Before presentation, blue After presentation, violet review, amber issue / Not scheduled) with time, then the next step or the specific problem. One ink "Open request" / "Open review" button that deep-links to the request-page card holding the next action. No Word link on the list: the step after editing (Share, Finish corrections, group review) lives on the request page.
- Request tab: no status card. A five-step stepper — Pre-site briefing → Deliberation session → Presentation → Working writeup → Group review — with only the current step expanded; finished and upcoming steps fold details but keep actions and alerts. A problem notice appears above the steps only when something is wrong. Recording, transcripts and summary sit in the Presentation step.
- Deliberation sessions come before the site visit; the pre-site briefing is shared with staff and select Board members for that session.
- Do not rename workflow terms on this surface alone; vocabulary is held for a suite-wide decision after D26 (`docs/NOMENCLATURE_GLOSSARY.md`).

## Verification boundary

One complete implementation, independent Sol review, parent integration/visual review and OAuth Claude Opus adversarial review. Batch desktop/narrow-screen and keyboard inspection; fix substantive issues together, then one confirmation pass. No unrelated design-system cleanup, new infrastructure or repeated cosmetic review loops.
