---
title: "Dynamics Explorer — Behavior Campaign Plan"
domain: dataverse
kind: plan
status: active
summary: "Explorer behavior campaign: telemetry, eval harness, Sonnet 5 posture, and a program-neutral vernacular rubric so SoCal staff can query in their terms."
canonical: false
cataloged: 2026-08-20
owner: product-engineering
related:
  - docs/DYNAMICS_EXPLORER_PHASE_B_TELEMETRY_PLAN.md
  - docs/DYNAMICS_EXPLORER_PATH_A_PLAN.md
  - docs/DYNAMICS_SCHEMA_ANNOTATION.md
  - shared/config/prompts/dynamics-explorer.js
  - pages/api/dynamics-explorer/chat.js
  - scripts/probe-programareaserved-twins.mjs
  - scripts/probe-dynexp-query-log-analysis.mjs
---

# Dynamics Explorer — Behavior Campaign Plan

**Status:** Active. Phase A is Production-live as of 2026-08-21 at commit
`9a54620d`; migration `032_api_usage_stop_reason.sql` is applied and deployment
`dpl_4d2fQegMKrZAnf6sHu9GsJ5QeqU8` is Ready on the Production aliases. Phase B
is implemented and verified in source on a feature branch; migration 033,
deployment, and Production joined-row proof remain open. Phases C-E remain
planned from the S449 probe evidence.

**Objective:** make the Explorer trustworthy for staff outside the Research
team — starting with SoCal — while making its behavior *measurable*, so the
next "did the change help?" question is answered from data instead of
recollection.

## 1. Problem statement (evidence-labeled)

1. **Failure visibility is near zero.** The reworked `record_count` telemetry
   only became trustworthy on 2026-08-08 (PR #117); rows before that carry
   broken semantics `[VERIFIED via commit 8873118f message]`. The
   `dynamics_feedback` table is empty `[VERIFIED via
   scripts/probe-dynamics-feedback-retention.mjs run, 2026-08-20]`. Rounds per
   request and terminal request outcome are computed but never persisted
   `[VERIFIED via pages/api/dynamics-explorer/chat.js — the complete event
   emits rounds; logQuery writes no request id]`. Phase A now passes each
   completed call's normalized `stopReason` through `LLMClient` to
   `api_usage_log.stop_reason`; migration 032 was applied to Production at
   `2026-08-21T16:43:26.023Z` and the nullable 50-character column plus
   migration tracker row were read back `[VERIFIED via source + Production
   schema/tracker probe, 2026-08-21]`.
2. **Organic traffic cannot validate changes.** ~160 sessions in 6 months;
   post-fix era = 62 tool calls / 11 sessions / 15 request-bursts
   `[VERIFIED via dynamics_query_log aggregates, 2026-08-20]`.
3. **The round-exhaustion era appears closed** — pre-2026-08-08, ~19% of
   request-bursts (37/191, 2-minute-gap proxy) reached ≥15 tool calls; after,
   0/15 `[VERIFIED same probe; small post sample]`. Do not re-fix blind.
4. **Sonnet 5 posture was mistuned before Phase A.** The model override moved the app from
   Haiku 4.5 to `claude-sonnet-5` by first August use `[VERIFIED via
   api_usage_log model column]`. Sonnet 5 runs adaptive thinking when the
   `thinking` param is omitted (chat.js omits it) and `maxTokens: 2048` caps
   thinking+output combined: 3 of 102 Sonnet calls hit exactly 2048 — silent
   hard truncations `[VERIFIED via api_usage_log output-token distribution]`.
   Latency rose ~3.5× (1.9s → 6.5s avg/round). Total Explorer spend ever
   logged: $4.09 — cost is a non-issue at this volume. Production now uses a
   16,000-token ceiling and low effort for the interactive call only; the
   separate export batch remains at 4,096 `[VERIFIED via source + focused
   tests, 2026-08-21]`.
5. **The vernacular layer speaks Research only.** LEXICON lifecycle/outcome/
   people phrases map to Phase I/II fields, PI lookups, and Research defaults
   `[VERIFIED via shared/config/prompts/dynamics-explorer.js LEXICON]`. SoCal
   asks in different terms and uses fields differently (measured: SoCal-area
   programs ~0% PI-bearing; declines in `wmkf_socalreasonsfordecline2` —
   `lib/services/dataverse-export/constants.js` PER_PROGRAM_ANNOTATION,
   probes dated 2026-05-17). Failure mode is silent plausible-wrong answers,
   invisible to every log.
6. **Schema twins are validator-approved traps.** Live pairs where one twin is
   dead: `wmkf_programareaservedsocal`/`wmkf_programareaservedresearch` (0
   rows each; the underscore forms carry 2,342/4,597) and `wmkf_supporttype`
   lookup (53 rows, 2024 only) vs `wmkf_supporttype2` (14,409, active)
   `[VERIFIED via scripts/probe-programareaserved-twins.mjs, user-run,
   2026-08-20]`. The OData validator accepts the dead twin → empty-but-valid
   results.

## 2. Non-goals

- Asker-profile-based program biasing (owner decided program-NEUTRAL,
  2026-08-20; revisit later — other program families must not be crowded out).
- Adapting the other apps to SoCal's workflow (waits for the Research team to
  complete a cycle).
- Re-raising MAX_TOOL_ROUNDS or re-fixing round exhaustion without new
  post-telemetry evidence.
- Rebuilding what Power Tools/Path A already provide (live schema discovery,
  taxonomy resolution, per-program constants) — extend by reference.
- Exposing `wmkf_ai_run`, `akoya_dc_*`, or other operational/vendor plumbing
  in user-facing schema.

## 3. Phases

Ordered so measurement lands before behavior changes.

### Phase A — Model posture (small, immediate)

- **PRODUCTION-LIVE 2026-08-21:** `maxTokens` 2048 → 16,000 in the
  interactive `callClaude` (a ceiling, not spend) plus
  `outputConfig: { effort: 'low' }`. `LLMClient` converts that to Anthropic's
  `output_config` only for effort-capable reviewed models and rebuilds the body
  under the fallback model's capabilities. The separate export batch remains
  at 4,096.
- **PRODUCTION-LIVE 2026-08-21:** completed calls pass normalized
  `stopReason` into the existing fire-and-forget usage row. Fresh-install
  schema and existing-DB migration 032 add nullable
  `api_usage_log.stop_reason`; migration 032 is applied and the Production
  schema/tracker readback matches the source contract.
- Eval-harness case (Phase C) for a long multi-round conversation exercising
  `compactMessages` with thinking blocks present — clearing prior-turn
  `tool_use.input` while thinking blocks remain is `[ASSUMED]` safe, untested
  with a thinking model.
- **Signed-in Production smoke passed 2026-08-21:** the harmless question
  “What tables are available?” completed in two read-only query rounds. Usage
  rows `5354` and `5355` recorded successful `tool_use` and `end_turn` stop
  reasons, 27 and 545 output tokens, and 1.851s and 4.970s latency. Over the
  next observation window, require no output-tokens-at-cap events; round latency
  should remain materially down from the 6.5s Sonnet average.

### Phase B — Request-level telemetry

- **IMPLEMENTED IN SOURCE; NOT YET DEPLOYED/MIGRATED:**
  `docs/DYNAMICS_EXPLORER_PHASE_B_TELEMETRY_PLAN.md`. Preserve the unit of
  meaning of each log: a new `dynamics_explorer_requests` lifecycle table owns
  one row per request; nullable request/round columns correlate tool rows in
  `dynamics_query_log` and model attempts in `api_usage_log`; verified request
  IDs may correlate `dynamics_feedback`. Do not add a synthetic terminal row to
  the per-tool query log.
- Terminal outcomes are `completed | truncated | max_rounds | refused | error |
  client_disconnected`; stale `running` rows are reported as derived
  `abandoned`. Telemetry remains fail-soft toward the user.
- Keep the 2026-08-08 era boundary documented wherever record_count trends
  are read (earlier rows are not comparable).
- Acceptance: one SQL query answers "distribution of rounds and outcomes per
  request this month".

### Phase C — Eval harness (replay, not soak)

- Golden question set replayed against the chat route on demand; grade tool
  choice, field choice, and answer shape (not prose wording).
- Seed sources: (1) SoCal colleagues' real questions in their own words
  (owner collecting; also serves rubric elicitation), (2) Research-dialect
  questions from existing usage, (3) adversarial cases: dead-twin fields,
  "who leads this?" on a SoCal grant, concept-pipeline counts, migration-era
  ("Blackbaud"/"Sky"/"old system") phrasing, code-based asks ("BSN grants",
  "PEA"), truncation-length answers.
- Runs read production Dataverse through the existing tool stack → runs are
  owner-initiated per the prod-access rule; design for capture/replay of tool
  results where feasible so re-grading doesn't re-hit Dataverse.
- Acceptance: harness green on the Research dialect before Phase D lands;
  Phase D may not merge with Research-dialect regressions.

### Phase D — Program-neutral vernacular rubric

All programs stay first-class; phrasing (not asker identity) disambiguates.

1. **SoCal LEXICON section** from the owner's code spreadsheet (7.15.22
   vintage — verify codes against live option sets first, Phase E):
   internal-program codes (AC/CC/EC/EP/HC/LA/UG/SG → `akoya_program`),
   program-area-served codes (PEA/BSN/CVE/… → `wmkf_programareaserved_socal`
   option labels), support types (BLD/CBG/… → `wmkf_supporttype2`),
   `wmkf_socalprogramorcapital`, `wmkf_firsttimegranteeflag`,
   `wmkf_impactrating`, concept-call pipeline (`wmkf_socalconceptstatus`,
   `wmkf_conceptcalloutcome`). Handle known ambiguities explicitly: CAS
   (College Access) exists under both Civic & Community and Education; WD/CT
   collide with common abbreviations.
2. **Conditional disambiguation rules** for program-dependent phrases:
   "declined" (Phase I/II fields vs `wmkf_socalreasonsfordecline2` vs
   `wmkf_declinereason`), "who leads this" (PI vs program director —
   SoCal-area ~0% PI), "pipeline"/"applications" (the default
   `wmkf_request_type eq Request` filter excludes SoCal's concept records —
   make the default conditional or teach the model to ask).
3. **Twin deny/redirect entries:** dead twins
   (`wmkf_programareaservedsocal`, `wmkf_programareaservedresearch`, and
   `wmkf_supporttype` on requests) get explicit "do not query; use X"
   annotations; wire `wmkf_supporttype2` properly.
4. **Era vocabulary:** "Blackbaud"/"Sky"/"old system"/"migrated" → the
   `createdon == 2023-12-03` provenance rule (never business dates).
   `akoya_dc_app` exists as the legacy application-id crosswalk (22,879 rows
   `[VERIFIED via twins probe rerun, 2026-08-20]`) but stays out of
   user-facing schema.
5. Import per-program facts **by reference** from `PER_PROGRAM_ANNOTATION`
   (the A4 pattern) — no transcribed values.
- Acceptance: eval harness green on both dialects; prompt-contract tests
  updated alongside prompt changes.

### Phase E — Probe backlog (owner-run, dated, before encoding)

Per `.claude/rules/claim-evidence.md`, each rubric fact that is a live-data
claim gets a dated probe first:

| Question | Probe shape |
|---|---|
| Spreadsheet codes ↔ live option-set labels for `wmkf_programareaserved_socal`, `wmkf_supporttype2`, `wmkf_populationserved2`, `wmkf_impactrating`, `wmkf_socalprogramorcapital` | Metadata option-set dump + label diff vs spreadsheet |
| Is population-served abandoned? (both twins ~all 2023-created, no fill since 2024) | Ask SoCal team; counts already probed |
| Why did `wmkf_programareaserved_socal` fill stop (6 rows 2025, 0 in 2026)? | Ask SoCal team |
| Per-program semantics of statuses / report types beyond the two measured families | Extend the 2026-05-17 probe pattern |

## 4. Open items owner/staff must supply

1. 10–20 real SoCal questions, in SoCal staff's own words (seeds Phases C+D).
2. Answers to the population-served and `_socal` fill-rate questions above.
3. Approval point per remaining phase; Phase A promotion is complete.

## 5. Standing constraints

- Production Dataverse probes are owner-run (never self-authorized).
- Explorer routes are Route→Service-exempt, but restriction guards, the OData
  validator, and the `wmkf_ai_run` denial must be preserved at every
  extension point; taxonomy injection stays whitelisted and escaped (the
  Path A A2 contract).
- Reuse Power Tools assets; no OData `/$count`; `queryRecords` is one-page —
  print denominators on any sweep.
- Session evidence and durable facts live in
  `.claude-memory/project-dynamics-explorer-socal-campaign.md`; reconcile
  both on change.

## 6. Phase A implementation and reconciliation report (2026-08-21)

| Claim | Producer / entry | Persistence | Consumer | Evidence | Status |
|---|---|---|---|---|---|
| Interactive calls use 16K + low effort | `/api/dynamics-explorer/chat` `callClaude` | N/A | Anthropic request body built by `LLMClient` | Deployed source + route-config test + Ready Production deployment + signed-in two-round smoke | VERIFIED in Production |
| Unsupported/fallback models do not receive effort | `LLMClient._buildBody` and fallback rebuild | N/A | Anthropic request body | Capability registry + existing body-shaping tests + model gate | VERIFIED |
| Completed calls retain stop reason | Unary/stream normalizers → `_logSuccess` | `api_usage_log.stop_reason` via `usage-logger` | Operational SQL analysis | Deployed source + logger/client tests + migration 032 + fresh-install parity + Production schema/tracker readback + usage rows 5354/5355 | VERIFIED in Production (`tool_use`, then `end_turn`) |
| Export batch remains independently bounded | `callClaudeBatch` | N/A | Anthropic request | Deployed source + route-config test | VERIFIED in Production at 4,096 |
| Request-level rounds/outcomes are queryable | Chat handler + request telemetry service | Source-defined `dynamics_explorer_requests`; nullable request/round correlations on query/usage logs; verified optional feedback FK | Aggregate analysis probe and feedback review | Migration 033 + fresh-install parity + focused route/service/client/cleanup tests; Production migration/deployment not yet performed | VERIFIED IN SOURCE; PRODUCTION OPEN |

**Sweep mode:** Mode A — changed fact. Source → persistence → consumer was
traced before documentation edits. Searches covered source/tests, active docs,
Atlas pages, agent wiki, memory, and `SESSION_PROMPT.md`; historical 2,048-token
measurements remain explicitly historical. Live current-state contradictions
were structurally corrected in this plan, both Atlas surfaces, the AI data-flow
matrix, the shipped Path A plan, campaign memory, and the session handoff.

**Verification:** 123 expanded Explorer/LLM tests; `check:types`;
`check:migrations-manifest`; Atlas, model-registry, API-route, and
route-service-boundary gates plus their self-tests; docs catalog,
fact-consistency, and agent-wiki gates plus applicable self-tests; Next.js
webpack production build. A route-boundary self-test was rerun alone after its
first concurrent run collided with the Atlas self-test's temporary fixture;
the isolated gate + self-test passed.

**Remaining live stale statements:** 0 in the searched current-state scope.
**Production release evidence:** migration 032 applied at
`2026-08-21T16:43:26.023Z`, followed by exact schema/tracker readback; commit
`9a54620d` deployed Ready as `dpl_4d2fQegMKrZAnf6sHu9GsJ5QeqU8` and owns the
Production aliases. The unauthenticated Explorer route correctly redirected to
the Production sign-in page in both available browser surfaces. After the
owner authenticated in Chrome, “What tables are available?” completed in two
read-only rounds; immediate Postgres readback found successful usage rows 5354
and 5355 with non-null `tool_use` and `end_turn` stop reasons.

**Remaining live stale statements:** 0 in the searched current-state scope.
**Remaining unverified external state:** the post-deploy latency/cap observation
window beyond this single two-round smoke. **Verdict:** RECONCILED for
Production release and signed-in call telemetry; longer observation remains
explicitly pending.

## 7. Phase B source implementation and reconciliation report (2026-08-21)

| Claim | Producer / entry | Persistence | Consumer | Evidence | Status |
|---|---|---|---|---|---|
| One accepted request has one lifecycle | Chat route + request telemetry service | `dynamics_explorer_requests` via migration 033 | Monthly outcome/round analysis | Focused service/route tests + Fable P0/P1 review | VERIFIED IN SOURCE |
| Tool/model rows retain their own units | `logQuery` + `LLMClient`/usage logger | Nullable request/round fields on query/usage logs | Joined request diagnosis | Route/client/logger tests + pre-migration fallback tests | VERIFIED IN SOURCE |
| Feedback correlation is non-authoritative | Browser request ID → feedback route/service | Nullable feedback FK after owner + exact-session verification | Admin feedback review | Client/service tests, mismatch/outage cases | VERIFIED IN SOURCE |
| Retention preserves feedback | Maintenance cron/service | Request rows 365d; FK `ON DELETE SET NULL` | Aggregate analysis and retained feedback | Cleanup service/cron tests + migration | VERIFIED IN SOURCE |

**Verification:** 121 focused tests; `check:types`; changed-file ESLint;
migration-manifest, Atlas, API-route, route-boundary, model-registry,
model-override-warming, prompt-injection, Dynamics-context, docs/fact/currency,
canonical-pointer, symbol-reference, build-claim, agent-wiki, instruction, and
agent-invariant gates plus applicable self-tests; Next.js webpack production
build. The ordinary Turbopack build could not bind its local helper port in the
host sandbox; the webpack production build completed successfully. The global
memory-router gate retains one pre-existing unrelated overlong prose line in
`.claude-memory/MEMORY.md`; this change did not touch that router.

**Adversarial review:** one OAuth-authenticated, read-only Claude Fable
implementation review, restricted to P0/P1 defects, returned **READY**. No
material fix or follow-up review was required.

**Sweep mode:** Mode A changed-fact reconciliation. Source → persistence →
consumer was traced across code, migration/fresh setup, tests, analysis,
retention, both Atlas surfaces, API matrix, service catalog, this plan, the
detailed Phase B plan, campaign memory, and session handoff. Historical Phase A
Production evidence and the pre-2026-08-08 `record_count` warning remain
unchanged.

**Remaining unverified external state:** migration 033 application/tracker
readback, deployment, and one signed-in harmless request with joined
lifecycle/query/usage evidence. **Verdict:** RECONCILED for source completion;
not Production-live.
