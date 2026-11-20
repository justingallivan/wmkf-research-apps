---
name: Literature Analyzer retirement and preservation
description: Standalone Literature Analyzer retirement preserves paper-analysis prompts and implementations; shared scholarly search remains live elsewhere.
type: project
status: active
scope: strategy
last_verified: 2026-11-19 via owner retirement decision and caller inventory
---

# Literature Analyzer — retire the standalone surface, preserve the capability

[VERIFIED — owner direction, 2026-11-19] Retire the standalone Literature Analyzer.
This resolves the October 21 request to reassess the outdated app. The source
change is tracked in `docs/plans/APP_SUITE_RETIREMENT_2026-11-19.md`; deployment is
a separate step.

The uploaded-paper extraction, cross-paper synthesis/comparison, and JSON/Markdown
export implementations are preserved under `_archived/`. Prompt templates,
stored prompt rows/history, shared resolver/composer, and model infrastructure
are retained. Do not infer that another app completely replaces these capabilities.
The future home of uploaded-paper analysis remains undecided.

Scholarly search in reviewer discovery and scientific-dossier workflows remains
live. Retiring this page does not authorize removing shared PubMed/OpenAlex or
other discovery services.

## Recall Rule

Read before deleting literature/search helpers or reviving paper-analysis UI.
Use the retirement manifest and current caller search to separate the retired
standalone workflow from live scholarly services. Preserve existing uploaded
files, prompt rows, and audit/usage history. No data deletion or new destination
is implied by this decision.
