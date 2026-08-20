# Session 450 Prompt: Explorer Campaign Awaits SoCal Questions; Stage II Window Continues

## Session 449 Summary

Session 449 was a no-code exploratory session preparing the Dynamics Explorer
behavior campaign. It reconstructed the Explorer retooling history, measured
production behavior from Postgres logs, diagnosed the Sonnet 5 posture risk,
settled the SoCal twin-field questions by owner-run Dataverse probes, and
delivered the campaign plan (merged to main as PR #130, `7805b27f`).

### What Was Completed

1. **Retooling history + production behavior measured**
   - Three waves reconstructed: Feb round-limit bumps, May Path A, and the
     Aug 8 cluster (PR #117 thinking-delta fix + `79a27d13` validator lookup
     aliases). Query-log analysis: pre-Aug-8 ~19% of request-bursts hit ≥15
     tool calls; post-fix 0 of 15 (small sample). `dynamics_feedback` is
     empty — no user-reported failure signal exists.
   - Model flip Haiku→`claude-sonnet-5` occurred by first August use and is
     what triggered the Aug 7 "Query failed" incident. Sonnet posture risk
     measured: 3 of 102 calls hit the 2048 `maxTokens` cap (silent
     truncation); latency ~3.5×. Total Explorer spend ever: $4.09.

2. **SoCal vernacular gap diagnosed; twin fields settled by probe**
   - LEXICON/vocabulary is Research-dialect; SoCal concept-call pipeline,
     codes (owner's 7.15.22 spreadsheet, read this session), and field-usage
     differences are unrepresented. Owner decided a program-NEUTRAL rubric.
   - Owner-run probes: underscore `wmkf_programareaserved_socal`/`_research`
     carry all data (2,342/4,597); no-underscore twins are dead (0 rows);
     `wmkf_supporttype2` is real (14,409, active) vs the 53-row lookup;
     population-served twins ~abandoned since 2024. `akoya_dc_app` holds the
     Blackbaud application-id crosswalk on 22,879 rows (22,573 = exactly the
     migrated cohort); other `akoya_dc_*` fields empty on akoya_request.
     Lineage: Keck migrated from Blackbaud ("Sky"); Pearl was Bromelkamp's
     prior product — dc fields are stock conversion scaffolding.

3. **Campaign plan drafted and merged (PR #130, merge `7805b27f`)**
   - `docs/DYNAMICS_EXPLORER_BEHAVIOR_CAMPAIGN_PLAN.md`: Phase A model
     posture (Sonnet 5 + `effort: low` + 16K ceiling — owner-approved),
     B request-level telemetry, C eval harness, D program-neutral vernacular
     rubric, E probe backlog. Durable memory:
     `.claude-memory/project-dynamics-explorer-socal-campaign.md`.
   - Drafted the owner's outreach message asking SoCal staff for 10–20 real
     questions plus two field-usage questions (population-served, `_socal`
     program-area fill stop).

### Commits

- `1876b2fc` - Draft Dynamics Explorer behavior campaign plan (S449 exploration)
- `7805b27f` - Merge pull request #130 (landed the above on main)

## Next Items

### Verified Open

1. **Explorer campaign Phase A: Sonnet 5 posture fix.**
   Evidence: `docs/DYNAMICS_EXPLORER_BEHAVIOR_CAMPAIGN_PLAN.md` §Phase A;
   api_usage_log truncation measurements (S449).
   `maxTokens` 2048→16,000 + `output_config: {effort: 'low'}` in
   `pages/api/dynamics-explorer/chat.js` `callClaude`; verify LLMClient
   passes `output_config` through ([ASSUMED] unchecked); log `stop_reason`.
   Does NOT depend on the SoCal questions — buildable now.

2. **Observe Stage II Production outcomes through 2026-09-02.**
   Evidence: `docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md` (exact-on
   Production state, organic-observation window). Untouched in S449.
   Do not manufacture shared-roster rows.

3. **Run a staff acceptance smoke of reviewer identity remediation.**
   Evidence: `docs/REVIEWER_CONTACT_LEADS_SPEC.md`; commits `d9c29c7d`
   through `5fcd913c`. Untouched in S449.

4. **Re-probe and close Track A passive safety.**
   Evidence: `docs/WORKBENCH_OBSERVABILITY_AND_READ_COALESCING_PLAN.md`
   still carries the completed 48-hour window as open guidance. Untouched in
   S449. Reconcile against the live Log Drain first.

### Blocked on External Input

1. **Explorer campaign Phases C–D (eval harness seeds + vernacular rubric).**
   Evidence: plan §4 Open items; owner sent/is sending the SoCal outreach
   message drafted in S449.
   Blocked on: 10–20 real SoCal questions; answers on population-served and
   `_socal` program-area fill. Phase B (telemetry) is not blocked but is most
   valuable landed before behavior changes.

### Owner Decision Needed

1. **Choose an approved request for the Site Visit handoff smoke.**
   Evidence: `docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md` (signed-in
   Draft→Review smoke open). Untouched in S449. The action records a durable
   milestone — do not click without explicit approval.

2. **After 2026-09-02, retain or remove the Stage II rollout flag.**
   Evidence: `docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md`.
   Re-probe the live environment and replacement deployment before changing
   it; `NEXT_PUBLIC_` changes require a new build.

### Parked

1. **`NEXTAUTH_SECRET` rotation and Vercel Sensitive conversion.**
   Evidence: owner decision Session 447. Reopen only with a coordinated
   session-invalidation window.

2. **Reviewer multipart direct-upload conversion.**
   Evidence: `docs/LARGE_UPLOAD_DIRECT_BLOB_REMEDIATION_PLAN.md` §8.
   Complete consumer discovery + owner decision first.

3. **Stage III institution identity authority.**
   Evidence: `docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md`.
   Blocked until the execution-point contract exists.

4. **Site Visit dossier/logistics and Final copy transaction.**
   Evidence: `docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md`.

### Verify Before Acting

1. Production Dataverse reads (including the campaign's Phase E probes and
   any eval-harness run) are owner-run — never set
   `DATAVERSE_ALLOW_PROD_READS` yourself
   (`feedback-never-self-authorize-prod-dataverse-reads`).
2. `dynamics_query_log.record_count` rows before 2026-08-08 carry broken
   semantics (PR #117); never trend across that boundary.
3. `compactMessages` clearing prior-turn `tool_use.input` while thinking
   blocks remain is [ASSUMED] safe — untested with a thinking model; pin it
   in the Phase C harness before relying on it.
4. Stage II flag / Track A items: re-probe live state first (carried from
   S449 prompt, unchanged).

### Do Not Reopen Without New Decision

1. Asker-profile-based program biasing in the Explorer — owner chose
   program-NEUTRAL (2026-08-20); revisit only by new owner decision.
2. Round-exhaustion re-fixes (e.g. raising MAX_TOOL_ROUNDS) without new
   post-telemetry evidence — the Aug 8 cluster closed the measured era.
3. Items 1–6 from the Session 449 prompt's list (multipart fallback,
   Stage III flip on the 25-case benchmark, separate Site Visit memo, Vercel
   CLI reminders, direct-upload smoke, Phase II display smoke) — unchanged.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/DYNAMICS_EXPLORER_BEHAVIOR_CAMPAIGN_PLAN.md` | The campaign plan; §Phase A is the next buildable step |
| `.claude-memory/project-dynamics-explorer-socal-campaign.md` | Owner decisions + probe-verified twin/dc-field facts |
| `scripts/probe-dynexp-query-log-analysis.mjs` | Re-runnable query-log aggregate analysis (Postgres, read-only) |
| `scripts/probe-programareaserved-twins.mjs` | Owner-run Dataverse twin/dc-family population probe |
| `pages/api/dynamics-explorer/chat.js` | Phase A target (`callClaude` maxTokens/effort) + Phase B logQuery |
| `shared/config/prompts/dynamics-explorer.js` | LEXICON / TABLE_ANNOTATIONS — Phase D target |
| `lib/services/llm-client.js` | Verify `output_config` passthrough before Phase A |

## Testing

```bash
# Query-log behavior analysis (Postgres, read-only, aggregate-only)
node scripts/probe-dynexp-query-log-analysis.mjs

# Twin/dc-field population probe (production Dataverse — OWNER-RUN ONLY)
node scripts/probe-programareaserved-twins.mjs
```

S449 shipped no runtime changes; no test-suite deltas. The S449 claim-evidence
pilot report returned zero advisory events and zero claims; no observation row
was eligible.
