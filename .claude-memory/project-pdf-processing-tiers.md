---
name: PDF Processing Tiers
description: Live named PDF paths extract text first; the former full-PDF evaluators (Literature Analyzer, Multi-Perspective) were retired 2026-11-19 and survive only in _archived/
type: project
status: active
scope: prompt
last_verified: 2026-11-20 via reviewer-finder/analyze.js, initial-assessment/artifact-service.js, execute-prompt.js preprocess, and the two 410 stubs; named surfaces plus one content-block grep, not a PDF ecosystem audit
---

## Recall Rule

Read this when: changing a proposal/PDF processing path. Check the named surface contract before choosing an input representation.

Do:
- For Reviewer Finder analysis, follow the current text path: `pages/api/reviewer-finder/analyze.js` extracts PDF text with `pdf-parse` and passes that text to `ClaudeReviewerService.analyzeProposal`.
- For governed Initial Assessment generation, follow the artifact-service contract: it passes the exact narrative text to the `initial-assessment.generate` Executor prompt.
- Do not model a new full-PDF input on `pages/api/analyze-literature.js` or `pages/api/evaluate-multi-perspective.js`: both are 410 retirement stubs since 2026-11-19. Their PDF document-block code is reference only under `_archived/pages/api/`. A 2026-11-20 grep of live pages/lib/shared for document/base64 content blocks found only the Expense Reporter image block; the Executor supports only `preprocess: pdf_to_text`.
- Treat these as distinct per-surface contracts. No shared `processingMode` parameter governs them.

Do not:
- Infer one universal PDF tier from the original design rationale or add a `processingMode` requirement without an owner decision and implemented contract.
- Claim the PDF paths are fully audited; this note records only the named surfaces below.

Ground truth: the named route/service source paths and `docs/EXECUTOR_CONTRACT.md` for governed Executor behavior. The text-versus-vision rationale below is historical design context, not a universal current policy.

## Historical design rationale (not a global runtime contract)

The original design proposed text extraction for high-volume summaries and full-PDF vision for selective work that benefits from figures, tables, and diagrams. The estimated cost ratio was not measured. The current implementation is per-surface as described above; do not read the historical proposal as a universal policy.
