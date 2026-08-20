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
  - docs/DYNAMICS_EXPLORER_PATH_A_PLAN.md
  - docs/DYNAMICS_SCHEMA_ANNOTATION.md
  - shared/config/prompts/dynamics-explorer.js
  - pages/api/dynamics-explorer/chat.js
  - scripts/probe-programareaserved-twins.mjs
  - scripts/probe-dynexp-query-log-analysis.mjs
---

# Dynamics Explorer — Behavior Campaign Plan

**Status:** Draft (S449 exploratory session, 2026-08-20). No code written; every
phase below is scoped from probe evidence gathered that session.

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
   request and stop_reason are computed but never persisted `[VERIFIED via
   pages/api/dynamics-explorer/chat.js — the complete event emits rounds;
   logQuery writes no request id]`.
2. **Organic traffic cannot validate changes.** ~160 sessions in 6 months;
   post-fix era = 62 tool calls / 11 sessions / 15 request-bursts
   `[VERIFIED via dynamics_query_log aggregates, 2026-08-20]`.
3. **The round-exhaustion era appears closed** — pre-2026-08-08, ~19% of
   request-bursts (37/191, 2-minute-gap proxy) reached ≥15 tool calls; after,
   0/15 `[VERIFIED same probe; small post sample]`. Do not re-fix blind.
4. **Sonnet 5 posture is mistuned.** The model override moved the app from
   Haiku 4.5 to `claude-sonnet-5` by first August use `[VERIFIED via
   api_usage_log model column]`. Sonnet 5 runs adaptive thinking when the
   `thinking` param is omitted (chat.js omits it) and `maxTokens: 2048` caps
   thinking+output combined: 3 of 102 Sonnet calls hit exactly 2048 — silent
   hard truncations `[VERIFIED via api_usage_log output-token distribution]`.
   Latency rose ~3.5× (1.9s → 6.5s avg/round). Total Explorer spend ever
   logged: $4.09 — cost is a non-issue at this volume.
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

- `maxTokens` 2048 → 16,000 in `callClaude` (a ceiling, not spend) and
  `output_config: { effort: 'low' }` for the Explorer's calls (owner-approved
  compromise). Verify LLMClient passes `output_config` through; add if absent
  `[ASSUMED: not yet checked]`.
- Log `stop_reason` per call (Phase B row or api_usage_log column) so
  truncation becomes visible.
- Eval-harness case (Phase C) for a long multi-round conversation exercising
  `compactMessages` with thinking blocks present — clearing prior-turn
  `tool_use.input` while thinking blocks remain is `[ASSUMED]` safe, untested
  with a thinking model.
- Acceptance: no output_tokens-at-cap events over the next observation window;
  round latency materially down from the 6.5s Sonnet average.

### Phase B — Request-level telemetry

- Mint/propagate `requestId` into `logQuery`; add columns (existing-DB
  migration via `node scripts/apply-migrations.js` conventions):
  `request_id`, `round`, `stop_reason`. Write one terminal row per request:
  outcome (`completed | max_rounds | error | truncated`), rounds used, model.
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
3. Approval point per phase; Phase A can land first at the appropriate tier
   per `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`.

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
