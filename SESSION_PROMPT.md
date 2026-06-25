# Session 287 Prompt: Opus cutover pending an /admin override flip; model-change strategy parked

## Session 286 Summary

A diagnosis-driven session: a colleague's reviewer search **failed on a niche proposal**,
which traced to a model limitation, not a bug. We switched reviewer-finder origination to
**Opus 4.8**, hardened the surrounding machinery, ran a **Codex adversarial review → Codex
fixes → Claude review** loop, and wrote a durable **model-change strategy**. All work is
committed and pushed to `main`. **The Opus switch is INERT in prod until the `/admin`
override is flipped — that flip is the actual cutover and has NOT happened.**

### What Was Completed

1. **Diagnosed the live failure (req 1002821, synthetic-torpor proposal).** The reviewer
   search intermittently hard-failed (`analysis_invalid`). Root cause via Vercel runtime
   logs + a local replay of the real PDF: **Sonnet 4.6 fell into a token-repetition /
   hallucination loop** — for a niche topic it could confidently name only ~6 reviewers
   (all already named in the proposal's prose), then **padded the fixed 15-quota with an
   invented, repeated name ("Dr. Bhanu Bhanu")** until it truncated. Temperature/count
   tuning did not fix it; **Opus 4.8 handled the same proposal cleanly and added real
   *independent* names.** Owner's instinct confirmed: higher temperature would worsen
   hallucination, not help.

2. **Switched reviewer-finder origination to Opus 4.8 + guardrails** (`8f22bbd8`): anti-
   fabrication prompt block (`ANALYZE_INTEGRITY_BLOCK`, code-owned, survives Dataverse
   prompt overrides — "return fewer real reviewers, never pad"); first-attempt token
   budget 4096→8192; `temperature` omitted for Opus 4.8 (it deprecates the param — the
   API 400s) via `modelSupportsTemperature()` in `llm-client.js`; `claude-opus-4-8` priced;
   dead temperature plumbing removed from the analyze route.

3. **Split the exclusion parser onto its own Haiku key** (`875abd11`). `reviewer-exclusion-parser`
   was riding the `reviewer-finder` model key, so the Opus switch would have dragged a cheap
   deterministic name-parse onto Opus. New `reviewer-exclusion` APP_MODELS key → Haiku.

4. **Codex adversarial review → fixes → Claude review** (`ca7f1e4d`). Codex found 2 HIGH issues:
   (a) `_fetchWithRetries` swapped only `body.model` on a 529 fallback, so the temperature
   decision was carried to the wrong model; (b) `TIER_FALLBACK_IDS.opus` was stale (4-7).
   Fixes: rebuild the body for the fallback model on swap (both directions + stream tested);
   bump the tier fallback to 4-8; **pin `reviewer-finder` to the concrete `claude-opus-4-8`**
   so resolution is deterministic and the temperature gate always matches.

5. **Model-change strategy doc** (`2fd322ac`, `docs/MODEL_CHANGE_STRATEGY.md`). Design proposal:
   a single capability registry, capability derived from the *resolved concrete id*, a
   fail-loud CI gate (`check:model-registry`), a narrow self-healing retry, and "cover every
   transport" (incl. the `multi-llm-service` gap). **Implementation is PLANNED / deferred.**

6. **Process memory** (`d5b8650a`): `feedback-pause-for-codex-on-high-stakes` — on high-stakes
   colleague-facing work, offer Codex plan/review BEFORE solo-implementing.

### Commits
- `8f22bbd8` — reviewer-finder → Opus 4.8 + anti-fabrication guardrails
- `875abd11` — split reviewer-exclusion parser onto a Haiku key
- `d5b8650a` — memory: pause-for-Codex-on-high-stakes
- `ca7f1e4d` — Codex-reviewed fixes (fallback body rebuild + concrete pin)
- `2fd322ac` — docs: Model-Change Strategy (proposal)

Full suite green throughout except the 2 known-red suites (bill, discovery-verification-status).

## Potential Next Steps

> Verify each against ground truth before treating as actionable.

### 1. GO-LIVE: flip the `/admin` override to Opus (NEW — the actual cutover, not yet done)
The code is pushed but **prod still runs Sonnet**: model resolution is governed by the
Dataverse `model_override:reviewer-finder:model` setting, which overrides baseConfig.
**Set it in `/admin` → Models to the concrete `claude-opus-4-8`** (we pin concrete — pick
the concrete id, NOT the `opus` tier), and confirm no `CLAUDE_MODEL_REVIEWER_FINDER` env var
pins Sonnet in Vercel. Then **re-validate live**: `node scripts/validate-reviewer-analyze.mjs
--request 1002821` — confirm a clean result with real added names. ⚠️ Local dev hits PROD
Dataverse; this harness is read-only.

### 2. Model-change strategy sprint (PARKED by owner — deliberate later session)
Phases 1-3 of `docs/MODEL_CHANGE_STRATEGY.md`: capability registry
(`lib/services/model-capabilities.js`), wire `_buildBody`/529-rebuild + `multi-llm-service`
through it (retire the regex), and the offline `check:model-registry` gate. Do NOT start
without an explicit go — owner chose to park it.

### 3. Carryovers NOT touched this session (from S285/S286 — re-verify before acting)
- **Test-data revert:** 1002788 was flipped to Advancing for testing; revert to Set-aside when
  done. Verify current `wmkf_triagestatus` first. (OWED since S284/S285.)
- **E2E-verify the two S285 workbench features** (Restore removed candidates; PD identity
  override) against parked req 1002788 — still only unit-tested.
- **Reviewer-portal review-upload DESIGN decision** (S283/S285, OPEN): keep "3 ratings + PDF"
  or capture more of the 11 questions as structured fields? Flow is built/live — not greenfield.
- **Auto-on-award abstract cron** — still unbuilt, OPTIONAL/low priority.

## Key Files Reference

| File | Purpose |
|------|---------|
| `shared/config/baseConfig.js` | `reviewer-finder` pinned to `claude-opus-4-8`; new `reviewer-exclusion` → Haiku |
| `lib/services/llm-client.js` | `modelSupportsTemperature` + `_buildBody(opts,stream,model)`; 529 fallback rebuilds the body |
| `lib/services/model-resolver.js` | `TIER_FALLBACK_IDS.opus` = `claude-opus-4-8` |
| `lib/services/claude-reviewer-service.js` | first-attempt `MAX_TOKENS` 8192 (origination engine) |
| `shared/config/prompts/reviewer-finder.js` + `lib/services/reviewer-prompt-composer.js` | `ANALYZE_INTEGRITY_BLOCK` (always appended) |
| `lib/services/reviewer-exclusion-parser.js` | resolves/logs under `reviewer-exclusion` (Haiku, temp 0) |
| `docs/MODEL_CHANGE_STRATEGY.md` | the parked strategy + pre-flip validation checklist |
| `scripts/validate-reviewer-analyze.mjs` | sanctioned read-only replay harness for the analyze prompt |

## Testing

```bash
npm test                       # full suite (only the 2 known-red suites should fail locally)
npm run lint
node scripts/validate-reviewer-analyze.mjs --request 1002821   # live replay after the override flip
```

## Gotchas / Continuity

- **The Opus switch does nothing until the `/admin` override flips** — model resolution is
  DB-override → env → baseConfig; the Dataverse override wins. This is the #1 next step.
- **`reviewer-finder` is now pinned to a CONCRETE id** by design (the `^claude-opus-4-8`
  temperature gate must match the served model). Unpinning requires the registry + gate +
  replay checklist in `docs/MODEL_CHANGE_STRATEGY.md`.
- **Opus 4.8 rejects `temperature`.** `llm-client` omits it for that model only; this is a
  per-model regex today (`/^claude-opus-4-8/`) — the strategy doc is the plan to generalize it.
- **`multi-llm-service._callClaude` still passes `temperature` unconditionally** — a second
  transport that bypasses the gate. Latent (its consumer is on Sonnet); folded into the strategy.
- **Known-red suites:** `bill.test.js` + `discovery-verification-status.test.js` only.
