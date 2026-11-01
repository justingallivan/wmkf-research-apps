---
name: Literature Analyzer outdated standalone app
description: Owner says Literature Analyzer is substantially out of date; possible capability reuse elsewhere must be checked before future investment.
type: project
status: active
scope: strategy
last_verified: 2026-10-21 via explicit owner statement
---

# Literature Analyzer — reassess before investing

[VERIFIED — owner statement, 2026-10-21] Justin considers the standalone
Literature Analyzer massively out of date.

[UNKNOWN — owner recollection, not source-verified] Some of its capabilities
may already have moved into other parts of the app suite. Do not claim a
specific migration, successor, or complete replacement without tracing the
current consumers.

**Current implementation boundary (repository source, 2026-10-31):** the standalone
Literature Analyzer remains an active app. Its checked-in workflow accepts uploaded
research-paper PDFs, extracts paper information, synthesizes across papers, and offers
JSON/Markdown export. Prompt resolution now uses the shared tool-prompt resolver and
composer; that plumbing change does not establish a successor or capability migration.

Future follow-up: identify which capabilities are already served elsewhere,
which remain useful, and whether the standalone app needs rework or another
disposition. No destination or retirement decision has been made.

## Recall Rule

Read when prioritizing Literature Analyzer work or assessing reuse of its capabilities.

For the current user-facing performance audit, deprioritize optimization of
this standalone app until its continuing role and actual use are established.
This note records product context only; it does not authorize removal of the
app, access, routes, or data.

Ground truth: the owner's statement on 2026-10-21, recorded above; the app's continued
presence and described upload workflow are source-backed in `shared/config/appRegistry.js`,
`pages/literature-analyzer.js`, and `pages/api/analyze-literature.js`. Capability reuse,
successor, and disposition remain unverified/open.
