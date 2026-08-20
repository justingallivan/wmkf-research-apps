---
name: project-dynamics-explorer-socal-campaign
description: "Dynamics Explorer behavior campaign (S449 exploration) — SoCal vernacular gap is the priority, program-NEUTRAL rubric decided, telemetry/eval-harness prerequisites, Sonnet 5 maxTokens/effort finding"
metadata: 
  node_type: memory
  type: project
  status: active
  scope: dynamics
  originSessionId: abb437dd-056c-45cf-9188-a6ea7a903c05
  modified: 2026-08-20T21:45:22.514Z
---

## Recall Rule

Read this when working on the Dynamics Explorer behavior campaign, SoCal/program
vernacular support, Explorer telemetry, or the Explorer eval harness.

## Decisions (owner, 2026-08-20, S449)

- **Program-NEUTRAL rubric, not asker-profile bias.** Keep all program dialects
  in the prompt; disambiguate from question phrasing. Rationale: other program
  families beyond Research/SoCal (Directors', Arts & Culture, Strategic Fund…)
  must not fly under the radar. May be revisited later.
- Owner has a **spreadsheet of codes** the SoCal team uses — incorporate into
  the rubric when provided.
- SoCal colleagues want to use the Explorer now; adapting the OTHER apps to
  SoCal's workflow waits until the Research team completes a cycle.
- Sonnet 5 at `effort: low` + `maxTokens` ~16K accepted as the model posture
  (spend is a non-issue: $4.09 total Explorer spend ever; 3 of 102 Sonnet calls
  hit the 2048 cap — real truncations).

## Campaign shape (findings-backed, S449)

1. Telemetry first: persist requestId + round + terminal outcome (and
   stop_reason) in dynamics_query_log; `complete` computes rounds but never
   persists it. record_count rows before 2026-08-08 carry broken semantics.
2. Eval harness (golden questions, both Research and SoCal dialects) — organic
   traffic ~1 session/day cannot validate changes.
3. Behavior: SoCal/program-aware LEXICON + conditional disambiguation
   ("declined", "who leads this", default Request-type filter excludes
   concept pipeline); import per-program facts by reference from
   `lib/services/dataverse-export/constants.js` PER_PROGRAM_ANNOTATION
   (probe-dated discipline, fail-loud on unmeasured programs).

## Key evidence (see git/docs for detail)

- Aug 8 fix cluster (PR #117 + lookup-alias validator fix) resolved the
  round-exhaustion era: pre-fix ~19% of request-bursts hit ≥15 tool calls,
  post-fix 0 of 15 (small sample). Model flip Haiku→Sonnet 5 happened by
  first August use and is what triggered the thinking-block incident.
- dynamics_feedback table is EMPTY — no user-reported failure signal exists.
- Research-centric phrases live in LEXICON in
  `shared/config/prompts/dynamics-explorer.js`; SoCal field annotations exist
  but no SoCal phrase layer. Failure mode is silent plausible-wrong answers.

## Twin-field probe results [VERIFIED via scripts/probe-programareaserved-twins.mjs, user-run against production, 2026-08-20]

- `wmkf_programareaserved_socal` (2,342) / `wmkf_programareaserved_research`
  (4,597) carry ALL data; the no-underscore twins `wmkf_programareaservedsocal`
  / `wmkf_programareaservedresearch` have ZERO populated rows — dead fields the
  OData validator still accepts (empty-result trap; deny/redirect in rubric).
- Support type: `wmkf_supporttype2` is the real field (14,409 rows, active
  through 2026); the `wmkf_supporttype` LOOKUP has only 53 rows, all created
  2024 — near-dead despite appearing in SoCal saved views.
- Population served: `wmkf_populationserved` (1,471) vs `wmkf_populationserved2`
  (1,504) — both ~all created 2023 (migration bulk), essentially no fill since
  2024. Dimension appears abandoned post-migration; confirm with SoCal before
  annotating as live.
- Provenance caveat: `akoya_dc_importid` was null on ALL populated rows, so it
  is NOT the migration marker for these fields; the 2023 creation-year bulk
  (e.g. supporttype2 2023:14,239) is the migration-import signature instead.
- `akoya_dc_*` = akoyaGO "Data Conversion" crosswalk family (dc_importid,
  dc_app, dc_num, dc_ser, dc_payeeser, dc_finished on akoya_request; also
  dc_payeeser / dc_defaultpayee on payment/account per Atlas evidence).
  Lineage (owner, 2026-08-20): Keck's previous GMS was **Blackbaud (aka
  "Sky"; Blackbaud is the vendor)** — the 2023-12-03 migration source, matching
  the constants.js comment. **Pearl** was Bromelkamp's (akoyaGO's vendor's)
  PRIOR PRODUCT: the akoya_dc_* fields are stock conversion scaffolding
  (named for Pearl→akoyaGO, but reusable for any source). Keck never used
  Pearl; the fields held migrated Blackbaud crosswalk data — not actively
  used (owner, 2026-08-20). [VERIFIED via probe rerun, user-run, 2026-08-20]:
  **`akoya_dc_app` is populated on 22,879 requests** (2023:22,573 — exactly
  the constants.js migrated-row count, i.e. 100% of migrated rows — plus
  2024:306, nothing after): it carries the legacy Blackbaud application-id
  crosswalk. The other five (dc_importid/num/ser/payeeser/finished) have
  ZERO populated rows on akoya_request.
  No application code touches any akoya_dc_ field. Keep them out of Explorer
  user-facing schema.

Related: [[project-dynamics-explorer-details]],
[[project-dynamics-explorer-reuse-power-tools]],
[[project-dynamics-explorer-schema-diff]].
