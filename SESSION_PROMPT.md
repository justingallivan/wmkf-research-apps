# Session 178 Prompt: open — A7 follow-up fully closed, pick next work

## Session 177 Summary

A focused session: the A7 prompt-injection follow-up (steps 0, 2c–5 from the
S176 Codex remediation plan) was implemented in full, then taken through
**three** Codex review rounds to a **FULLY RESOLVED** verdict.

### What Was Completed

1. **Step 0 — `validateStage()` fallback fixed** (`evaluate-multi-perspective.js`)
   Now throws on a schema-validation failure instead of returning the raw
   parse — an injected key could otherwise ride through into the next stage's
   re-feed. All call sites are inside try/catch that degrades safely.

2. **Step 2c — VRP output-schema validation** (`panel-review-service.js`)
   New `shared/config/virtual-review-panel-output-schema.js` (7 declarative
   `validateAiJson` schemas). New `_validateStageOutput()` helper wired into
   all 6 `parseJSONResponse` sites. Synthesis (the mandatory final stage) now
   throws on a null/invalid summary rather than persisting `panelSummary: null`
   under `status: 'completed'`.

3. **Step 3 — Executor output-schema validation** (`execute-prompt.js`)
   Prompt rows may declare an optional `validationSchema`; JSON mode validates
   the parsed output against it before `persistOutputs()`. Additive — prompts
   without it are unchanged; raw mode untouched. `EXECUTOR_CONTRACT.md`
   documents the field.

4. **Step 4 — `check:prompt-injection-tagging` is now call-site-granular**
   A surface can declare a `builders` list; the gate slices the prompt file
   per `export function` and asserts each builder carries the preamble in its
   own body (closing the file-level masking hole that false-greened #8/#15).
   Two exemption flags: `routePreamble` (preamble injected at the route) and
   `noCallSite` (exported but A7-inert). 8 surfaces registered. Lesson F added
   to `CLAUDE_COVERAGE_LESSONS.md`; self-test 16/16.

5. **Step 5 — mop-up**
   `wrapUntrustedContent` label now strips `[`/`]` (a `]]` could forge a
   sentinel); `claudeWebSearch()` migrated from raw Anthropic fetch to
   `LLMClient` (web_search tool preserved).

### Codex review trail
Round 1 → NEEDS FIXES (1 MEDIUM + 3 LOW + 1 NIT); round 2 → partial;
round 3 → **FULLY RESOLVED**. Every finding closed (synthesis-failure-presents-
as-success, fail-open schemaKey, `_truncated` provenance, includes-vs-call-form,
multi-builder registry coverage, dead-builder misclassification).

### Commits (S177, `main`, 8 — pushed)
`22de5c7` step 0 · `8b9575c` step 2c · `95c0f4e` step 3 · `2d5c2bb` step 4 ·
`4940681` step 5 · `f6c0011` Codex round-1 fixes · `7b37b9e` Codex round-2 fixes ·
`b54e78b` Codex round-3 fixes

## Potential Next Steps

A7 and its follow-up are now fully shipped and Codex-verified — **no A7 work
is pending.** Pick from the roadmap:

### 1. Slice-0 schema deploy (PARKED — destructive carryover, verify first)
Connor field-review + Justin go-ahead still pending. See memory
[[slice0-deactivate-not-delete-recalc]]. P1-Update (statecode-Update
trigger-filter binding) is the single open pre-deploy gate. Verify live state
before acting — do not treat the carryover as green-lit.

### 2. Staged Review Pipeline / Proposal Context Extraction
Roadmap initiatives (see memory + `docs/PROPOSAL_CONTEXT_EXTRACTION_PLAN.md`).

### 3. Interim grant report auto-evaluation
Unblocked; field/prompt/process design still needed (memory
[[project-interim-report-automation]]).

## Key Files Reference

| File | Purpose |
|------|---------|
| `shared/config/virtual-review-panel-output-schema.js` | 7 VRP stage output schemas (S177) |
| `lib/services/panel-review-service.js` | VRP orchestration — `_validateStageOutput()` |
| `lib/services/execute-prompt.js` | Executor — optional `validationSchema` |
| `scripts/check-prompt-injection-tagging.js` | A7 gate — call-site-granular `builders` layer |
| `docs/CLAUDE_COVERAGE_LESSONS.md` | Lesson F: file-granular `content.includes()` masking |
| `docs/security-audit/A7_PROMPT_INJECTION_PLAN.md` | A7 plan — Parts 0–6 + follow-up SHIPPED |

## Testing

```bash
npx jest                                     # 656 passed as of S177
npm run build                                # green
npm run check:prompt-injection-tagging && npm run check:prompt-injection-tagging:self-test  # 16/16
npm run check:atlas && npm run check:api-routes && npm run check:fact-consistency
```
