---
name: PDF Processing Tiers
description: Current PDF handling differs by surface: some extract text first, while selected evaluators send full PDFs
type: project
status: active
scope: prompt
last_verified: 2026-10-22 via reviewer-finder/analyze.js, initial-assessment/artifact-service.js, analyze-literature.js, and evaluate-multi-perspective.js; named surfaces only, not a PDF ecosystem audit
---

## Recall Rule

Read this when: changing a proposal/PDF processing path. Check the named surface contract before choosing an input representation.

Do:
- For Reviewer Finder analysis, follow the current text path: `pages/api/reviewer-finder/analyze.js` extracts PDF text with `pdf-parse` and passes that text to `ClaudeReviewerService.analyzeProposal`.
- For governed Initial Assessment generation, follow the artifact-service contract: it passes the exact narrative text to the `initial-assessment.generate` Executor prompt.
- For full-PDF inputs, follow the surface-specific paths in `pages/api/analyze-literature.js` and `pages/api/evaluate-multi-perspective.js`, which contain PDF document blocks.
- Treat these as distinct per-surface contracts. No shared `processingMode` parameter governs them.

Do not:
- Infer one universal PDF tier from the original design rationale or add a `processingMode` requirement without an owner decision and implemented contract.
- Claim the PDF paths are fully audited; this note records only the named surfaces below.

Ground truth: the named route/service source paths and `docs/EXECUTOR_CONTRACT.md` for governed Executor behavior. The text-versus-vision rationale below is historical design context, not a universal current policy.

## Historical design rationale (not a global runtime contract)

The original design proposed text extraction for high-volume summaries and full-PDF vision for selective work that benefits from figures, tables, and diagrams. The estimated cost ratio was not measured. The current implementation is per-surface as described above; do not read the historical proposal as a universal policy.
