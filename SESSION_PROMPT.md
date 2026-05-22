# Session 177 Prompt: A7 follow-up — finish the Codex-review remediation (steps 2c–5)

## Session 176 Summary

A long, productive session. A7 (prompt-injection hardening) went from Parts 0–4
to **fully shipped**, then a full Codex re-audit of all the security work drove a
follow-up remediation that is ~60% done.

### What Was Completed

1. **A7 Parts 5 + 6 — all 16 remaining LLM-input surfaces hardened.**
   Routes #1–#6, #8, #9, #10, #11, #13, #14, #15, #16, #21, #22, #24. Each wraps
   untrusted text with `wrapUntrustedContent` (or carries the multimodal preamble
   for image/document content blocks); JSON sinks validate via `validateAiJson`.
   `check:prompt-injection-tagging` gained a `multimodal` surface flag. Gate now
   **24 migrated / 0 pending**. A7 plan marked Parts 0–6 SHIPPED.

2. **A7 Part 2 deploy done.** `seed-phase-i-summary-prompt.js --execute` re-run;
   live `wmkf_ai_prompts` row `d4201d8e-…` now declares `proposal_text`
   `untrusted: true`.

3. **Stale-model bug found + fixed (systemic).** 6 prompt-seed scripts
   hard-coded `claude-sonnet-4-20250514` (Sonnet 4.0). `resolveModel()` passes
   concrete ids through unchanged, so every deployed prompt row was pinned to a
   year-old model. Switched 5 to the `sonnet` tier key; `echo-parity` kept a
   pinned concrete id (parity-test requirement) bumped to `claude-sonnet-4-6`.
   **All 10 live `wmkf_ai_prompts` rows re-seeded** (phase-i, phase-ii ×4,
   peer-review ×2, reviewer-finder ×2, echo-parity).

4. **Codex re-audit of A1–A8** (`SECURITY_AUDIT_2026-05-21.md` as baseline).
   Verdict: all original findings closed or tracked. Caught a real residual —
   see below.

5. **A7 follow-up steps 1/2a/2b** (Codex-verified correct):
   - **1** — added a `record` node type to `validateAiJson` (dynamic-keyed maps;
     rejects `__proto__`/`constructor`/`prototype`).
   - **2a** — #8 (`evaluate-multi-perspective`): wrapped the re-fed
     concept/literature/perspective blocks; all 4 JSON sinks schema-validated
     (`shared/config/multi-perspective-output-schema.js`).
   - **2b** — #15 (`virtual-review-panel`): wrapped every re-fed block (search
     results, claim data, intelligence, prior reviews); added the preamble
     `createPanelSynthesisPrompt` was missing entirely.

### The Codex residual (HIGH) — now closed by 1/2a/2b

A7 Parts 5–6 hardened #8/#15 only at their *entry points* — both still re-fed
prior-stage LLM output and U-EXT results into later LLM calls **unwrapped**
(preamble present, but no sentinels around the data). Steps 2a/2b fixed it; a
second Codex pass confirmed no remaining unwrapped re-feed path in either file.

### Commits (S176, `main`, pushed — 18 + this doc commit)
`2ad5297`·`af80cae`·`cc1b36b`·`84a1d30`·`5a0f5e7`·`cb8da14`·`f4cac7f`·`51cdbf7`·`c1f5282`·`c133656` (A7 Parts 5–6) · `d1cfd4d` (deploy) · `ad348a8`·`0ce8514` (model fix) · `8e05fb5`·`4e390d8`·`f0f3fbd` (follow-up 1/2a/2b)

## Potential Next Steps — A7 follow-up steps 2c–5

The Codex review produced an explicit, ordered next-session plan. **Do them in
order.** Full detail: re-read the Codex output in the S176 transcript, or the
findings below.

### 0. FIRST — fix `validateStage()` fallback semantics
`pages/api/evaluate-multi-perspective.js` `validateStage()` returns the **raw**
parsed object on a validation failure — that bypasses the key-dropping. Make it
return the cleaned/stripped value (or throw). Do this before copying the pattern
into 2c/3.

### 1. Step 2c — VRP output-schema validation
`lib/services/panel-review-service.js`: add `validateAiJson()` at every
`parseJSONResponse()` site (lines ~362, 505, 598, 634, 669, 697). New schema
file for the 6–7 stage outputs (claim extraction, collation, intelligence
synthesis, claim verification, structured review, devil's advocate, synthesis).
Synthesis `ratingMatrix` is dynamic reviewer-keyed → use the `record` node.

### 2. Step 3 — Executor output-schema validation
`lib/services/execute-prompt.js`: after `JSON.parse` (~line 480), before
`persistOutputs()` (~540). JSON mode currently only checks `jsonSchema.required`
then writes to `akoya_request`. Validate via `validateAiJson` against a
declarative schema from the prompt row. **Raw mode must stay untouched** — the
seeded `phase-i.summary` prompt is raw mode.

### 3. Step 4 — make `check:prompt-injection-tagging` call-site-granular
File-granular `content.includes()` lets one hardened call mask an unhardened
sibling in the same file (this is how #8/#15 false-greened). Per-function
inspection: per registered builder, assert its body contains the marker calls.
Mandatory: add a self-test fixture `shared/config/prompts/fx-sibling.js` with a
safe + an unsafe builder; assert the gate fails on the unsafe one.

### 4. Step 5 — mop-up
- `contact-enrichment-service.js` `claudeWebSearch()` (~line 600): migrate the
  raw Anthropic `fetch` to `LLMClient` (keep web-search tool support).
- `wrapUntrustedContent` label escaping (`ai-payload-boundary.js`): strip/escape
  `]]` in `label`, not just `"`.

### Also add (Codex): invalid-but-parseable-JSON self-tests at each new schema
boundary — not only happy-path wrapping tests.

### Parked (unchanged): Slice-0 schema deploy
Destructive carryover; Connor field-review + Justin go-ahead pending. See memory
[[slice0-deactivate-not-delete-recalc]]. Verify before acting.

## Key Files Reference

| File | Purpose |
|------|---------|
| `lib/utils/ai-payload-boundary.js` | `wrapUntrustedContent` + preamble; `DATA_CLASSES` |
| `lib/utils/ai-output-schema.js` | `validateAiJson` — incl. the new `record` node |
| `scripts/check-prompt-injection-tagging.js` | A7 coverage gate (step 4 target) |
| `lib/services/panel-review-service.js` | VRP stage orchestration (step 2c target) |
| `lib/services/execute-prompt.js` | Executor (step 3 target) |
| `shared/config/multi-perspective-output-schema.js` | #8 output schemas (pattern for 2c) |
| `docs/security-audit/A7_PROMPT_INJECTION_PLAN.md` | A7 plan — Parts 0–6 SHIPPED |

## Testing

```bash
npm run check:prompt-injection-tagging && npm run check:prompt-injection-tagging:self-test
npx jest                                     # 645 passed as of S176
npm run build                                # green
```
