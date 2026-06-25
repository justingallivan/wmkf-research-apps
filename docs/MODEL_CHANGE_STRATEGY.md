# Model-Change Strategy

**Status: PARTIALLY IMPLEMENTED (S286/S287, 2026-06-25).** This documents a durable
approach for navigating future Anthropic model changes (new releases, parameter
deprecations, capability differences, refusal semantics, retention classes). S286
shipped the interim Opus 4.8 hardening in §1. S287 shipped the first registry/gate
slice in §1.5. Transport, admin write-path, and resolver ergonomics hardening have
since landed; canary expansion and replay automation in §3 remain planned.

Authority note: this is a design doc. Live behavior is governed by source —
`lib/services/llm-client.js`, `lib/services/model-capabilities.js`,
`lib/services/model-review-validation.js`, `lib/services/model-resolver.js`,
`lib/utils/model-pricing.js`, and
`shared/config/baseConfig.js`. If this doc and code disagree, code wins and this doc
is stale.

## Why this exists (the incident)

Switching `reviewer-finder` origination to Opus 4.8 (S286) surfaced a class of
fragility: **Opus 4.8 deprecated the `temperature` request param** (the Messages API
returns `400 "temperature is deprecated for this model"`). Per-model knowledge needed
to shape a request safely is **scattered and hardcoded**, with no enforced consistency
and no pre-deploy tripwire:

- capability knowledge (does the model accept `temperature`? max output tokens?
  reasoning-tier?) lived only as an ad-hoc regex (`modelSupportsTemperature` in
  `lib/services/llm-client.js`);
- tier→concrete resolution lives separately in `lib/services/model-resolver.js`
  (`TIERS`, `TIER_FALLBACK_IDS`, `resolveModel`) and can drift from the capability gate;
- pricing lives separately again in `lib/utils/model-pricing.js`;
- `shared/config/baseConfig.js` `APP_MODELS` mixes tier keys with one concrete pin;
- before S288, a second LLM transport, `lib/services/multi-llm-service.js`
  `_callClaude`, built its own body and passed `temperature` unconditionally —
  bypassing the gate entirely;
- "Anthropic shipped a new model / deprecated a param" had **no checklist and no CI
  gate**, so it failed at *runtime* (a 400 in front of users), the one failure mode the
  reviewer/Workbench rollout cannot afford.

**Guiding principle: model drift must fail LOUD in CI, never silently in prod.**

## §1 — Interim hardening already shipped (S286)

These are DONE and make the current state safe to run:

- `reviewer-finder` pinned to the concrete `claude-opus-4-8` in
  `shared/config/baseConfig.js` (deterministic resolution; the `^claude-opus-4-8`
  temperature gate always matches the served model).
- `modelSupportsTemperature()` in `lib/services/llm-client.js` omits `temperature` for
  Opus 4.8; `_buildBody` is re-applied on the 529 fallback model-swap (both directions
  + the stream path covered by tests).
- `TIER_FALLBACK_IDS.opus` corrected to `claude-opus-4-8` in
  `lib/services/model-resolver.js`.
- `claude-opus-4-8` added to `lib/utils/model-pricing.js`.

These were patches, not the system.

## §1.5 — First registry/gate slice shipped (S287)

These are DONE and reduce the next-model blast radius:

- Added `lib/services/model-capabilities.js`, a reviewed local capability registry for
  Anthropic request shaping. It covers temperature support, effort support, thinking
  mode, max input/output tokens, refusal semantics, retention class, review date, and
  source URL. Unknown runtime ids fail closed for optional request params.
- `lib/services/llm-client.js` now shapes `temperature` and `output_config.effort`
  from reviewed capabilities, not an ad-hoc model regex. Fallback-body rebuilds reuse
  the same capability lookup for the fallback model.
- `LLMClient` normalizes successful refusal responses explicitly (`stopReason`,
  `stopDetails`, `refused`) so Fable-style HTTP-200 refusals cannot disappear as an
  ordinary empty response.
- `lib/services/multi-llm-service.js` now uses the same capability registry for its
  Claude request body and preserves refusal metadata for virtual-review-panel calls.
- `lib/services/execute-prompt.js` now resolves prompt-row models before execution
  and fails loud when a concrete Claude id is not reviewed in the capability/pricing
  registry.
- Added Fable/Mythos 5 pricing entries to `lib/utils/model-pricing.js`.
- Added `check:model-registry` + `check:model-registry:self-test`. The offline gate
  fails when static configured concrete ids, tier fallback ids, capabilities, or
  pricing drift from one another.
- Added `lib/services/model-review-validation.js`. `/api/admin/models` now rejects
  unreviewed concrete Claude ids before writing Dataverse model overrides, and
  `/api/admin/prompts/[name]` rejects publishing/resuming a prompt version whose
  cloned `wmkf_ai_model` is an unreviewed concrete Claude id.
- Added `resolveModelWithCapabilities()` in `lib/services/model-resolver.js`.
  `LLMClient`, `multi-llm-service`, and `execute-prompt` now resolve tier/concrete
  ids and retrieve reviewed request capabilities through one helper.

Important remaining boundary: the offline gate is static. Executor runtime and admin
Dataverse writes now reject unreviewed prompt/model ids, but environment overrides are
deployment configuration and still rely on the pre-deploy registry/pricing checklist.

## §2 — Target design

1. **Single source of truth for capabilities.** `lib/services/model-capabilities.js`
   answers request-shaping and response-semantics questions (`supportsTemperature`,
   `supportsEffort`, `thinkingMode`, `maxOutputTokens`, `refusalSemantics`,
   retention class, future flags), keyed by concrete model id/prefix with a
   `reviewedAt`/`source` per entry. Unknown ids **fail loud in CI** where statically
   configured, and **fail closed in prod** for optional params (omit non-required
   params until reviewed). Hybrid: use `/v1/models` for existence / release ordering /
   max-token limits; keep request-param compatibility and response semantics in the
   reviewed local registry.

2. **Consistency by construction.** Capability lookup happens **after** resolution, on
   the concrete id that will actually be sent (and again for the fallback id on a 529
   swap). One helper resolves `{ resolvedId, capabilities }`; `_buildBody` shapes the
   request from it. Tier tracking then cannot advance past capability knowledge, because
   an unknown resolved id is rejected.

3. **Tier-vs-pin policy.** Tier keys are the default; **pin a concrete id for high-risk
   workflows** (expensive, user-visible, long-running, quality-sensitive — e.g. reviewer
   origination) until the new model passes the pre-flip checklist (§4). Keep
   `reviewer-finder` pinned to `claude-opus-4-8` until the remaining transport/admin
   coverage is complete and the replay checklist passes.

4. **Explicit first, narrow self-healing second.** The registry + gate are the primary
   defense. Add a **narrow** runtime retry-once safety net for *recognized*
   deprecated-param 400s only (strip the named param, log structured telemetry, retry
   once; never broad 400s, never auto-persist registry changes). Claude review note:
   given the rollout stakes, treat this as **should-do**, not optional — it catches the
   *next* uncatalogued deprecation gracefully where the gate (which only knows *current*
   drift) cannot.

5. **CI gate — the keystone.** `check:model-registry` plus its self-test now follows
   the existing `check:*` pattern. v1 is offline/static (no Anthropic creds): it scans
   `BASE_CONFIG.APP_MODELS`, `TIER_FALLBACK_IDS`, pricing keys, and the capability
   registry. Runtime/publish/write validation now covers prompt rows and Dataverse
   admin model overrides; env overrides remain a deploy-time preflight because they
   are not written through an app route. A credentialed cron (extend
   `pages/api/cron/pricing-canary.js`) should compare live `/v1/models` against the
   registry review date as an advisory ops alert. Do not rely on the pricing canary
   alone — it only sees a model *after* runtime usage has already occurred.

6. **Repeatable pre-flip validation.** Build on the existing read-only harness
   `scripts/validate-reviewer-analyze.mjs` (resolves a request, downloads the proposal,
   replays the production analyze prompt). Make it emit a machine-readable JSON artifact
   (model, fallback used, parse status, reviewer count, quality signals) so transport /
   model / parse invariants are deterministic while humans still judge quality.

7. **Cover every transport.** Capability wiring now includes
   `lib/services/multi-llm-service.js` and `LLMClient`; future Anthropic transports
   must use one of those paths or the same capability helper.

## §3 — Phased plan (mixed status — extend existing machinery, do not greenfield)

| Phase | What | Effort | Risk |
|---|---|---|---|
| 0 (done S286) | Keep `reviewer-finder` pinned to `claude-opus-4-8`; unpinning requires registry + gate + replay checklist. | S | Low |
| 1 (done S287) | Add capability registry with exact/prefix matching, unknown handling, `reviewedAt`/`source`, and unit tests. | M | Med |
| 2a (done S287) | Wire `LLMClient._buildBody` + 529 rebuild through capabilities; normalize refusal metadata. | M | Med |
| 2b (done S288) | Fix `lib/services/multi-llm-service.js` Claude request shaping and refusal metadata. | M | Med |
| 2c (done S288) | Route `lib/services/execute-prompt.js` prompt-row model/temperature handling through the same capability helper. | M | Med |
| 3a (done S287) | Add `check:model-registry` + self-test for static config/fallback/pricing/capability parity. | M | Low |
| 3b (done 2026-06-25) | Executor runtime rejects unreviewed prompt-row ids; admin model override writes reject unreviewed concrete Claude ids before Dataverse persistence; prompt publish rejects cloning an unreviewed concrete Claude id. Env overrides are documented as deploy-time preflight values, not route-validated writes. | M | Med |
| 4 (done 2026-06-25) | Resolver returns `{ resolvedId, capabilities }` through `resolveModelWithCapabilities()` so callers cannot accidentally split resolution from capability lookup. | M | Med |
| 5 (should) | Extend the pricing-canary cron to alert when `/v1/models` has a newer same-family id than the registry review date, before runtime use. | M | Med |
| 6 (should) | Narrow retry-once deprecated-param safety net in `lib/services/llm-client.js`, with structured alerting; disabled for broad 400s. | M | Med |
| 7 (nice) | Admin Models tab shows resolved capability + pricing status read-only beside each effective model. | M | Low |
| 8 (nice) | `validate-reviewer-analyze.mjs` JSON artifact + a one-page pre-flip runbook. | S | Low |

## §4 — Pre-flip validation checklist (use NOW, before any reviewer-affecting model change)

1. Pick the candidate model + fallback.
2. Add the capability-registry entry and confirm the pricing prefix in
   `lib/utils/model-pricing.js`.
3. Run `npm run check:model-registry && npm run check:model-registry:self-test` plus
   the pricing self-test.
4. Resolve the effective app model through the same path prod uses
   (`getModelForApp` after `loadModelOverrides`).
5. Replay at least one real, previously-problematic proposal PDF through
   `scripts/validate-reviewer-analyze.mjs`.
6. Confirm: no request-param 400, no fallback unless expected, no empty parse.
7. Confirm quality invariants: real independent names, no quota-padding loop, no
   duplicate/excluded names, topical reasoning, no COI text (COI is screened
   server-side).
8. Record model, request GUID, prompt source/version, reviewer count, temperature
   requested, actual model returned, fallback usage, pass/fail notes.
9. Only then advance the tier fallback or remove a concrete pin.

## §5 — "Anthropic shipped a new model" runbook (target state, once §2/§3 land)

Add capability entry → add/confirm pricing prefix → run `check:model-registry` +
pricing self-test → run §4 replay if reviewer-finder is affected → record reviewed
date/source → only then advance a tier fallback or unpin. If the target is
Fable/Mythos-class, also verify refusal handling, retention constraints, and effort /
thinking behavior before any user-facing cutover.
