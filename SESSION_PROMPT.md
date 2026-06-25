# Session 288 Prompt: Demo stability after model-change hardening

## Session 287 Summary

Session 287 took the S286 model-change strategy from parked design to implemented
guardrails. The immediate goal was protecting the colleague-facing Workbench/reviewer
experience from future Anthropic model drift: new model ids, deprecated request
parameters, tier fallback drift, and silent parser failures. All code/doc work is
committed and pushed to `main`.

### What Was Completed

1. **Capability registry + request shaping**
   - Added `lib/services/model-capabilities.js` as the reviewed source of truth for
     Claude request-shaping metadata: temperature support, effort support, thinking
     mode, max tokens, refusal semantics, retention class, source, and review date.
   - Routed `LLMClient` request bodies and 529 fallback rebuilds through reviewed
     capabilities instead of ad-hoc model regexes.
   - Added refusal metadata normalization so HTTP-200 refusals cannot disappear as an
     ordinary empty response.

2. **Cross-transport coverage**
   - Routed `lib/services/multi-llm-service.js` Claude calls through the same
     capability registry and preserved refusal metadata for the virtual-review-panel
     path.
   - Routed `lib/services/execute-prompt.js` prompt-row model execution through the
     same resolver/capability contract.

3. **Model registry gates and write-path validation**
   - Added `npm run check:model-registry` and `npm run check:model-registry:self-test`.
   - Added admin/runtime validation so unreviewed concrete Claude ids are rejected
     before Dataverse model overrides, prompt publish/resume clones, or Executor
     prompt-row execution can persist/use them.
   - Added `resolveModelWithCapabilities()` so callers resolve a concrete model and
     retrieve reviewed capabilities together.

4. **Live model discovery + runtime safety net**
   - Extended `/api/cron/pricing-canary` to query Anthropic `/v1/models` and emit ops
     alerts when a newer same-family model is not covered by both capability and
     pricing registries.
   - Added a narrow retry-once safety net in `LLMClient` for recognized deprecated
     optional-parameter 400s only (`temperature` / `output_config.effort`), with
     structured ops telemetry and no broad 400 retry.

5. **Admin model visibility**
   - `/api/admin/models` now returns read-only capability/pricing registry status for
     each effective resolved model.
   - Admin Models UI displays compact `cap ok` / `price ok` style status beside the
     concrete resolved model id. Saving still goes through the reviewed-model validator.

6. **Reviewer-finder pre-flip replay artifacts**
   - `scripts/validate-reviewer-analyze.mjs` now supports `--json-out` for a structured
     replay artifact: request/file/extraction metadata, model/fallback/stop reason,
     prompt provenance, parse status, validation issues, quality signals, side effects,
     progress events, and human-review fields.
   - Added `docs/MODEL_PREFLIP_REPLAY_RUNBOOK.md`.
   - Updated `docs/MODEL_CHANGE_STRATEGY.md`; phases 0-8 are now marked done.

7. **Post-implementation verification and production smoke**
   - Verified the effective `reviewer-finder` model resolves to `claude-opus-4-8` with
     `.env.local` loaded.
   - Vercel production deployment `dpl_5vbDziZHX8WoLPchXAhtpcAdhcDT` was `Ready`
     and aliased to `reviews.wmkeck.org`, `grantees.wmkeck.org`,
     `submissions.wmkeck.org`, `applications.wmkeck.org`, and the Vercel aliases.
   - Production logs for the last hour had no `500/502/503/504`. Expanded error-level
     entries were `pg` SSL-mode warnings on successful `GET /api/cron/drain-submissions`
     requests with status `200`.
   - Unauthenticated `/admin` and `/admin/models` smokes correctly redirected to
     sign-in and returned `200` on the sign-in page.
   - Real proposal replay for request `1002836` was blocked by the Codex sandbox
     because it would transmit private proposal text to Anthropic. User approved, but
     the sandbox still rejected it. A synthetic non-confidential replay through
     `ClaudeReviewerService.analyzeProposal` succeeded on `claude-opus-4-8` with no
     fallback, `end_turn`, 6/6 suggestions, and 0 validation issues. That synthetic
     artifact was moved out of the repo to `/private/tmp/wmkf-model-replays/`.

### Commits

- `881f2555` - Add Claude model capability registry gate
- `e636d5f1` - Harden Claude request shaping across executor paths
- `690e3a82` - Validate reviewed Claude model overrides
- `67a9b04d` - Couple model resolution with capabilities
- `4ead7598` - Add live Claude model discovery canary
- `048540a9` - Add Claude deprecated-parameter retry safety net
- `a2e58f02` - Show model registry status in admin
- `d1c65eb5` - Add reviewer model preflip replay artifact

## Potential Next Steps

### 1. Real proposal replay evidence remains blocked in Codex

The one remaining pre-flip evidence gap is a real, previously-problematic proposal replay
through `scripts/validate-reviewer-analyze.mjs --json-out ...`. Codex could list files for
request `1002836` and found one proposal-classified PDF:

```text
akoya_request::1002836_AF594C797B42F11188B5000D3A3065B8/Phase I::ProjectDescription.pdf
```

But the sandbox forbids transmitting private proposal text to Anthropic, even with user
approval. To close this gap, use the normal logged-in app flow or run the harness from a
non-sandboxed local terminal. Once an artifact exists, Codex can inspect it and call the
pass/fail without rerunning the private replay.

### 2. Logged-in Admin Models visual smoke

Unauthenticated health is good, but the actual `/admin` Models content requires a logged-in
browser/session. If an authenticated browser is available, confirm the effective
`reviewer-finder` row shows `claude-opus-4-8` with capability/pricing status OK.

### 3. Historical carryovers from S285/S286

These were not re-verified in S287. Do not act on them until probing current state first:

- request `1002788` test-data triage/status revert;
- E2E verification of Restore Removed Candidates and PD identity override;
- reviewer-portal review-upload design decision;
- optional auto-on-award abstract cron.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/MODEL_CHANGE_STRATEGY.md` | Current model-change strategy; phases 0-8 done; pre-flip checklist still requires real replay evidence. |
| `docs/MODEL_PREFLIP_REPLAY_RUNBOOK.md` | How to run and judge reviewer-finder model replay artifacts. |
| `lib/services/model-capabilities.js` | Reviewed Claude model capability registry. |
| `lib/services/model-resolver.js` | Tier resolution and `resolveModelWithCapabilities()`. |
| `lib/services/llm-client.js` | Capability-shaped Claude transport, refusal normalization, deprecated-param retry safety net. |
| `lib/services/multi-llm-service.js` | Secondary Claude transport now uses the same capability contract. |
| `lib/services/execute-prompt.js` | Executor prompt-row model validation/resolution. |
| `lib/services/model-review-validation.js` | Admin/prompt write-path validator for reviewed Claude ids. |
| `pages/api/admin/models.js` | Admin model settings API with read-only registry status. |
| `pages/admin.js` | Admin Models UI status badges. |
| `pages/api/cron/pricing-canary.js` | Live Anthropic model discovery advisory alerting. |
| `scripts/check-model-registry.js` | Static model registry consistency gate. |
| `scripts/validate-reviewer-analyze.mjs` | Reviewer-finder replay harness with JSON artifact output. |

## Testing / Verification From S287

```bash
npm run check:model-registry
npm run check:model-registry:self-test
npm run check:doc-symbol-refs
npm run check:doc-symbol-refs:self-test
npm run check:build-claim-freshness
npm run check:build-claim-freshness:self-test
npm run check:doc-currency
npm run check:doc-currency:self-test
npm run check:fact-consistency
npm run check:fact-consistency:self-test
npx jest tests/unit/llm-client.test.js tests/unit/model-capabilities.test.js tests/unit/model-registry-check.test.js tests/unit/model-review-validation.test.js tests/unit/model-resolver-capabilities.test.js tests/unit/multi-llm-service.test.js tests/unit/execute-prompt-model-validation.test.js tests/unit/pricing-canary.test.js tests/unit/admin-models.test.js tests/unit/validate-reviewer-analyze-artifact.test.js --runInBand
npx eslint scripts/validate-reviewer-analyze.mjs tests/unit/validate-reviewer-analyze-artifact.test.js
node --import ./scripts/lib/use-extensionless.mjs scripts/validate-reviewer-analyze.mjs --help
```

Production smoke performed in S287:

```bash
vercel ls wmkf_research_apps --scope team_bAyoqgvSJhFJC3blheJgTMXQ
vercel inspect https://wmkfresearchapps-imn5cg34o-justin-gallivans-projects.vercel.app --scope team_bAyoqgvSJhFJC3blheJgTMXQ
vercel logs --project wmkf_research_apps --scope team_bAyoqgvSJhFJC3blheJgTMXQ --environment production --level error --since 1h --limit 3 --expand
vercel logs --project wmkf_research_apps --scope team_bAyoqgvSJhFJC3blheJgTMXQ --environment production --status-code 500,502,503,504 --since 1h --limit 50
curl -I -L --max-time 20 https://reviews.wmkeck.org/admin
curl -I -L --max-time 20 https://reviews.wmkeck.org/admin/models
```

Known recurring local noise remains the same unless re-verified otherwise: the two known-red
suites `tests/unit/bill.test.js` and `tests/unit/discovery-verification-status.test.js`.

## Gotchas / Continuity

- `SESSION_PROMPT.md` before this update was stale: it said the model strategy was parked
  and that the Opus cutover depended on an admin override flip. In S287, with `.env.local`
  loaded, `getModelForApp('reviewer-finder')` resolved to `claude-opus-4-8`.
- The real-proposal replay artifact is the only missing high-value evidence. Codex cannot
  create it from this sandbox if doing so requires sending private proposal text to Anthropic.
- The synthetic replay proves transport/model/parse mechanics only; it does not prove real
  reviewer quality on a private proposal.
- Keep `reviewer-finder` pinned to concrete `claude-opus-4-8` until a real replay artifact
  and human review support any tier advance or unpin.
- Broad feature work immediately before the colleague demo is probably higher risk than
  reward unless there is a known user-facing defect.
