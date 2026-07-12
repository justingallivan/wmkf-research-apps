# Session 358 Prompt: interlock observation (still soaking), post-BILL-tabling landscape

## Session 357 Summary

Hygiene + ops session. Full memory/Atlas/schema-as-code hygiene sweep (Codex
triage → probe verification → reconcile), two owner decisions recorded (Wave-1
elevations retained; **BILL API integration TABLED**), and the daily-maintenance
BILL subtask crash fixed (the error emails Justin got every day). All gates were
green at start (32/32) and after every commit. Neither S357 carryover item
(interlock log review; label-UX spot-check) was touched — both carry forward.

### What Was Completed

1. **Memory + Atlas hygiene sweep** (`0a2b3dee`) — Codex (gpt-5.5) triaged all
   128 memory-health-flagged files (1 factual fix, 115 structural false
   positives, 12 needing privileged probes). The 12 were then probe-verified
   live: 5 confirmed, 2 corrected (CRM user counts ~22 staff/~196 service
   accounts as OData proxies; Wave-1 role tail), 5 unprobeable organizational
   facts given single-line staleness acks. Atlas live counts reconciled across
   7 docs (wmkf_ai_prompt 17, wmkf_ai_run 351, appreviewersuggestion 662,
   potentialreviewers 4,416, as of 2026-07-12).
2. **Postgres schema-as-code aligned with live DB** (`348faaf2`) —
   `scripts/setup-database.js` + `lib/db/schema.sql` no longer declare the five
   tables dropped live 2026-06-04 by migration 018 (researchers, publications,
   researcher_keywords, reviewer_suggestions, proposal_searches; zero live app
   callers verified). `reconcile-memory-claims.js` now excludes
   `schema_migrations` (runner bookkeeping). All four drift-report buckets = 0.
3. **Wave-1 role tail closed by owner decision** (`03d2e73c`) — temp elevations
   (`WMKF AI Elevated TEMP` + `System Customizer`) are intentionally retained
   for the rest of the project; Justin handles any eventual revert with Connor
   directly. Also probe-settled a naming conflation: `# WMK: Research Review
   App Suite` is the app USER's display name; the suite ROLE has been `WMKF
   Research Review App Suite - Staff` since its 2026-04-24 creation — there was
   never a tenant-side rename.
4. **Daily-maintenance BILL subtask crash fixed** (`66e4367b`, merge
   `bd5df78e`) — `sweepBillOnboarding()`/`cleanupBillOnboardingState()` loaded
   ESM bill modules via CJS `require()`; in the prod Turbopack bundle the named
   exports are missing → daily "listPending is not a function" /
   "cleanupCompleted is not a function" error emails. Switched to
   `await import()` (repo's established seam). 24/24 tests, prod build green
   with exports present in built chunks. Tier-1: short-lived branch, `--no-ff`.
5. **BILL API integration TABLED — owner decision recorded** (`9f4dbac3`) —
   tabled for several months, possibly permanently; onboarding will use
   reviewer address + existing foundation systems. Reconciled across
   finance-honoraria wiki, MEMORY.md router, and 4 BILL memories. Nothing live
   needed disabling (`BILL_ENABLED` unset in every Vercel env — verified; the
   path already degrades to alert_only). The required address+phone collection
   on Stage 2a accept is now load-bearing (relax question CLOSED as moot).

### Commits (main, all pushed)

- `0a2b3dee` — memory + Atlas hygiene sweep
- `348faaf2` — schema-as-code alignment (5 retired tables removed from fresh-install)
- `03d2e73c` — Wave-1 elevations retained + role-name conflation fix
- `66e4367b`/`bd5df78e` — maintenance BILL ESM-interop fix (branch + merge)
- `9f4dbac3` — BILL tabling reconciliation

## Next Items

### Verified Open

1. **Interlock observation → flip to `on` (plan §5 Stage 3).** `warn` live
   everywhere since 2026-07-11; still soaking, untouched in S357. Review prod
   logs after normal staff use + at least one full cron cycle: every
   `[dataverse-interlock] would deny` line is a real hazard or a policy gap.
   EXPECTED noise: local `npm run dev` reads prod Dataverse (S357's memory
   probes did exactly this); at flip time decide whether `.env.local` gets
   `DATAVERSE_ALLOW_PROD_READS=yes`. Evidence:
   `docs/DATAVERSE_TARGET_WRITE_INTERLOCK_PLAN.md` §5; `vercel logs`.
2. **Confirm tomorrow's Daily Maintenance email is clean** —
   `billOnboardingResume`/`billOnboardingState` should report counts, not
   errors, after `bd5df78e` deployed. First clean run may process a backlog of
   torn/TTL rows. 2-minute check of the email or cron log. Evidence:
   `lib/services/maintenance-service.js:147-260`.
3. **Spot-check the label_conflict UX on the live admin page** (carried from
   S357, still unverified live; component tests cover it). Admin → Policies →
   Publish new version → expect amber taken-label warning + suggestion.
   Evidence: `tests/unit/policies-section-label-guidance.test.js`.

### Owner Decision Needed (carryover, unchanged, still blocked)

1. Reviewer-institution→CRM linking brief to Connor + Sarah
   (`outputs/reviewer-institution-crm-linking-brief.md`, local-only).
2. Whack-a-mole reconciliation; holistic-redesign green-light; rescue-tool
   location; closeout payability scope; `check:types` end state. Evidence:
   S353–S357 SESSION_PROMPT history + cited memories.
3. **Address-based reviewer onboarding — scope undefined.** Owner said (S357)
   onboarding will use reviewer address + existing foundation systems; the
   portal already captures/requires address+phone at Stage 2a accept. What (if
   anything) the repo needs beyond that awaits Justin's definition of the flow.
   Evidence: `.claude-memory/project-honorarium-payment-landscape.md` (2026-07-12
   decision block).

### Parked

1. Interlock Stage 4 (`check:dataverse-interlock` gate) — re-open after the
   flip to `on` or any hook-file refactor. Evidence: plan §5.
2. `DYNAMICS_SANDBOX_URL || DYNAMICS_URL` fallback cleanup — quiet-window work.
3. Memory-health advisory worklist: 117 files flagged, now purely structural
   (missing Recall-Rule headings, size, vocabulary) after S357 removed all
   factual staleness — cosmetic memory-shape work, no urgency. Evidence:
   `npm run check:memory-health` (advisory, never fails).
4. Prior parked items carry forward unchanged (reviewer holistic redesign
   branch; accepted-reviewer stand-down; review rendition formatting; campaign
   settings UX; prompt-cache-hit audit; reviewer ack provenance parity;
   Dependabot PR #53; intake portal; deferred dead-code cleanup — the dormant
   BILL code is now also a candidate for that session IF the tabling ever
   firms up to permanent, owner call first).

### Verify Before Acting

1. Any `[dataverse-interlock]` line in PROD logs = env misconfig or an
   unregistered target — investigate the caller; extending
   `lib/dataverse/core/target-registry.js` is a reviewed commit, not an env
   edit. Evidence: registry header + wiki dataverse topic.
2. Re-verify affiliation probe numbers before quoting
   (`scripts/probe-reviewer-affiliation-account-match.js`).

### Do Not Reopen Without New Decision

1. **BILL API integration is TABLED (owner, 2026-07-12; possibly permanent).**
   Do not build on, extend, or propose the BILL pipeline; code stays dormant,
   not deleted; the known-red bill test suites stay red indefinitely. Evidence:
   `.claude-memory/project-honorarium-payment-landscape.md`;
   `docs/agent-wiki/topics/finance-honoraria.md`; `9f4dbac3`.
2. **Wave-1 temp elevations are intentionally retained (owner, 2026-07-12).**
   Do not re-surface the revert as an open item; Justin handles it with Connor.
   Evidence: `.claude-memory/project-wave1-closeout-role-tail.md`; `03d2e73c`.
3. Interlock policy calls are owner-decided (S355): prod→sandbox = deny;
   preview prod-reads denied by default; `$batch`/alt-key writes never
   grant-coverable in v1; invalid flag → `on`. Evidence: plan §3.2/§3.3/§7.
4. Codex calls use `--model gpt-5.5` unless the owner says otherwise; do not
   edit `~/.codex/config.toml`. Evidence: `feedback-codex-model-gpt55`.
5. Policy version immutability + label_conflict 409 work as designed (S353/
   S356); client-side guidance only, no server mutation.

## Key Files Reference

| File | Purpose |
|------|---------|
| `lib/services/maintenance-service.js` | Daily cleanup; BILL sweeps now `await import()` ESM bill modules (S357) |
| `lib/bill/onboarding-state.js` | ESM named exports the sweeps consume (unchanged S357) |
| `scripts/setup-database.js` | Fresh-install shape; five retired tables removed (S357) |
| `scripts/reconcile-memory-claims.js` | Drift-report generator; schema_migrations excluded (S357) |
| `.claude-memory/project-honorarium-payment-landscape.md` | BILL tabling decision + address-based onboarding context |
| `docs/agent-wiki/topics/finance-honoraria.md` | BILL/honoraria routing; tabling recorded at top |
| `lib/dataverse/core/interlock.js` | Interlock policy module (warn mode live, still soaking) |

## Testing

```bash
npx jest tests/unit/maintenance-bill-onboarding.test.js tests/unit/bill-onboarding-state.test.js
node scripts/reconcile-memory-claims.js   # all four drift buckets should stay 0
# Observe interlock warn logs on the live prod deployment:
vercel ls --prod   # get current deployment URL
vercel logs <url> | grep dataverse-interlock
```
