# Model-Change Strategy

**Status: PROPOSAL / strategy (design only — S286, 2026-06-24).** This documents a
durable approach for navigating future Anthropic model changes (new releases,
parameter deprecations, capability differences). It is the deliverable of a Codex
design pass plus Claude review; **the registry + CI-gate sprint below is PLANNED, not
built.** What *is* shipped is the interim hardening in §1.

Authority note: this is a design doc. Live behavior is governed by source —
`lib/services/llm-client.js`, `lib/services/model-resolver.js`,
`lib/utils/model-pricing.js`, and `shared/config/baseConfig.js`. If this doc and code
disagree, code wins and this doc is stale.

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
- a second LLM transport, `lib/services/multi-llm-service.js` `_callClaude`, builds its
  own body and passes `temperature` unconditionally — bypassing the gate entirely;
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

These are patches, not the system. The rest of this doc is the system.

## §2 — Target design

1. **Single source of truth for capabilities.** A new capability registry — planned
   module `lib/services/model-capabilities.js` (planned, not yet created) — is the only
   place that answers request-shaping questions (`supportsTemperature`,
   `maxOutputTokens`, reasoning-tier, future flags), keyed by concrete model id with
   exact/prefix matching and a `reviewedAt`/`source` per entry. Unknown ids **fail loud
   in CI** and **fail closed in prod** (omit non-required params until reviewed).
   Hybrid: use `/v1/models` for existence / release ordering / max-token limits; keep
   request-param compatibility (e.g. `supportsTemperature`) in the reviewed local
   registry. (Whether `/v1/models` exposes temperature compatibility is unverified and
   does not matter — the local registry owns that field regardless.)

2. **Consistency by construction.** Capability lookup happens **after** resolution, on
   the concrete id that will actually be sent (and again for the fallback id on a 529
   swap). One helper resolves `{ resolvedId, capabilities }`; `_buildBody` shapes the
   request from it. Tier tracking then cannot advance past capability knowledge, because
   an unknown resolved id is rejected.

3. **Tier-vs-pin policy.** Tier keys are the default; **pin a concrete id for high-risk
   workflows** (expensive, user-visible, long-running, quality-sensitive — e.g. reviewer
   origination) until the new model passes the pre-flip checklist (§4). Keep
   `reviewer-finder` pinned to `claude-opus-4-8` until the registry + gate exist.

4. **Explicit first, narrow self-healing second.** The registry + gate are the primary
   defense. Add a **narrow** runtime retry-once safety net for *recognized*
   deprecated-param 400s only (strip the named param, log structured telemetry, retry
   once; never broad 400s, never auto-persist registry changes). Claude review note:
   given the rollout stakes, treat this as **should-do**, not optional — it catches the
   *next* uncatalogued deprecation gracefully where the gate (which only knows *current*
   drift) cannot.

5. **CI gate — the keystone.** A planned gate `check:model-registry` (planned) plus its
   self-test, following the existing `check:*` pattern, fails the build when any
   configured / fallback / resolver-served concrete model id is missing from either the
   capability registry or `lib/utils/model-pricing.js`. v1 is offline/static (no
   Anthropic creds): it scans `BASE_CONFIG.APP_MODELS`, `TIER_FALLBACK_IDS`, pricing
   keys, and the capability registry. A credentialed cron (extend
   `pages/api/cron/pricing-canary.js`) compares live `/v1/models` against the registry
   review date as an advisory ops alert. Do not rely on the pricing canary alone — it
   only sees a model *after* runtime usage has already occurred.

6. **Repeatable pre-flip validation.** Build on the existing read-only harness
   `scripts/validate-reviewer-analyze.mjs` (resolves a request, downloads the proposal,
   replays the production analyze prompt). Make it emit a machine-readable JSON artifact
   (model, fallback used, parse status, reviewer count, quality signals) so transport /
   model / parse invariants are deterministic while humans still judge quality.

7. **Cover every transport.** The capability wiring must include
   `lib/services/multi-llm-service.js`, not just `LLMClient` — a second transport that
   bypasses the gate is not "done."

## §3 — Phased plan (PLANNED — extend existing machinery, do not greenfield)

| Phase | What | Effort | Risk |
|---|---|---|---|
| 0 (now, done) | Keep `reviewer-finder` pinned to `claude-opus-4-8`; this doc records that unpinning requires the registry + gate + replay checklist. | S | Low |
| 1 (must) | Add the planned capability registry module with exact/prefix matching, unknown handling, `reviewedAt`/`source`, and unit tests. | M | Med |
| 2 (must) | Wire `_buildBody` + the 529 rebuild through resolved-model capabilities and retire the `modelSupportsTemperature` regex; also fix the `multi-llm-service.js` Claude path. | M | Med |
| 3 (must) | Add the planned `check:model-registry` gate + self-test (offline/static across `APP_MODELS`, `TIER_FALLBACK_IDS`, pricing, capabilities); register in `package.json`. | M | Low |
| 4 (should) | Resolver returns `{ resolvedId, capabilities }`; route the `lib/services/execute-prompt.js` Executor path through it too. | M | Med |
| 5 (should) | Extend the pricing-canary cron to alert when `/v1/models` has a newer same-family id than the registry review date, before runtime use. | M | Med |
| 6 (should) | Narrow retry-once deprecated-param safety net in `lib/services/llm-client.js`, with structured alerting; disabled for broad 400s. | M | Med |
| 7 (nice) | Admin Models tab shows resolved capability + pricing status read-only beside each effective model. | M | Low |
| 8 (nice) | `validate-reviewer-analyze.mjs` JSON artifact + a one-page pre-flip runbook. | S | Low |

## §4 — Pre-flip validation checklist (use NOW, before any reviewer-affecting model change)

1. Pick the candidate model + fallback.
2. Add the capability-registry entry (once §2 exists) and confirm the pricing prefix in
   `lib/utils/model-pricing.js`.
3. Run the static gates (once `check:model-registry` exists) + the pricing self-test.
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
date/source → only then advance a tier fallback or unpin.
