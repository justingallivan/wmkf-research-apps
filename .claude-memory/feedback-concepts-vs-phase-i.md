---
name: Concepts vs Phase I are different grant stages
description: Do not feed "Research Concepts" PDFs to the Phase I prompt; they are a pre-Phase-I stage, not a Phase I proposal
type: feedback
originSessionId: 0083d4e8-8936-4011-9989-1b099d0caeaa
---
**Concepts** (files named `Research Concepts`, `Concept Papers`, `Concepts Bios`, `Concepts Cover Page`, `Additional Concepts`) are a **separate grant-cycle stage** from **Phase I proposals** (files named `Research Phase I Application`). The two stages have different content, different expected output, and must not be cross-tested with the same prompt.

**Why:** User corrected me during Session 105 v2 validation — I discovered that Dec 2025 Keck submissions produced "Research Concepts_<timestamp>.pdf" files, which I mistakenly assumed were a naming variant of the Apr 2026 "Research Phase I Application". They are NOT. Feeding a Concepts PDF through the Phase I prompt pipeline produces misleading quality signals.

**How to apply:**
- When searching for Phase I test cases, filter for files matching `/proposal|narrative|phase.?i|research.phase/i`
- **Hard-exclude** any file whose name matches `/concept/i` — even if it's the largest PDF in the folder
- The Keck grant cycle has multiple pre-Phase-I stages; treat them as distinct until told otherwise
- Related: `project_staged_review_pipeline.md` mentions 3-stage automated triage (fit screen → intelligence brief → virtual panel). Concepts are likely an input to stage 1, Phase I to stage 2, etc. — confirm with user before mapping.
- The grant cycle is being redesigned (`Phase I may be eliminated` per `MEMORY.md`), so this taxonomy may shift; re-confirm when picking test cases in future sessions
