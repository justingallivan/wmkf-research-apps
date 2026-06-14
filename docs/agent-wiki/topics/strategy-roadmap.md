---
agent_wiki: topic
status: active
last_verified: 2026-06-13
stale_after_days: 90
owner: product-strategy
source_files:
  - docs/SYSTEM_MODEL.md
  - DEVELOPMENT_LOG.md
  - SESSION_PROMPT.md
canonical_docs:
  - docs/SYSTEM_MODEL.md
  - DEVELOPMENT_LOG.md
watch_paths:
  - docs/SYSTEM_MODEL.md
  - DEVELOPMENT_LOG.md
  - SESSION_PROMPT.md
  - docs/**/*ROADMAP*.md
update_triggers:
  - roadmap or phasing changes
  - cross-capability architecture changes
  - backend automation/post-award planning changes
---

# Strategy & Roadmap

Use this page for system model, roadmap, grant-cycle phasing, planned review
pipeline/proposal extracts, backend automation, interim reports, post-award work,
and broad AI capability planning.

## Durable Memory

- Strategy/system model: `project-system-model`, `project-strategy-direction`.
- Virtual Review Panel: `project-virtual-review-panel`.
- Roadmap snapshots: `project-app-roadmap-2026-04-25`, `project-phase-i-summary-app-winddown`.
- Phasing/cycle scoping: `project-grant-phasing-evolution`, `feedback-cycle-vs-executor-scope`, `feedback-concepts-vs-phase-i`.
- Planned review/proposal work: `project-staged-review-pipeline`, `project-proposal-context-extraction`.
- Planned automation/reports/post-award/AI: `project-backend-automation`, `project-interim-report-automation`, `project-awardee-onboarding`, `project-new-ai-capabilities`.
- IRS verify-EIN: `project-irs-exempt-verification`.

## Standard Probe

```bash
rg -n "roadmap|phase|cycle|interim|post-award|proposal extract|review pipeline|EIN" docs .claude-memory SESSION_PROMPT.md DEVELOPMENT_LOG.md
```
