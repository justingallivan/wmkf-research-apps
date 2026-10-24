# Session 636 Prompt: Await owner-selected work after the co-PI backfill

## Session 635 Summary — Research co-PI backfill applied; CI fixes; Grant Reporting co-PIs

### What Was Completed

1. **CI repairs on main.** [VERIFIED via GitHub check-runs on `b8c957076`: all six workflows green]
   - `2ff96adf8`: reviewer-rehearsal browser test disambiguated a duplicated "Submit your review" heading (h2/h3 race).
   - `4a2ae96e2`: launcher test installs its SIGTERM handler before publishing the worker pid (signal race).
   - `b8c957076`: launcher cache tests build fixtures under the real temp path (macOS `/var` → `/private/var`).
2. **Stage B co-PI Institution at Award backfill applied to production.** [VERIFIED via owner-run `--verify`: 337 writes hold, 0 mismatch, 0 unresolved]
   - Owner-run resolve re-run `77fa82fc`; staff answers and owner decisions read back; approval workbook v3 (all five groups approved).
   - New-contact emails: staff addresses, free ContactEnrichment lookup, capped paid pass (Claude Haiku + SerpAPI, $1.71 of $5), owner overrides.
   - `scripts/apply-research-copi-stage-b.mjs` + `scripts/lib/research-copi-apply.mjs` (30 tests), four Codex adversarial-review passes, plan `378673af`: 109 contacts and 139 Co-PI rows on 76 requests, Institution at Award on 50 existing rows, 39 contact accounts. Ross's contact already matched (no write).
   - Follow-ups (owner-run, logged in the stage-b-2 folder): Nelson and Paddison → Fred Hutch; 1001012 liaison Aaron Diaz removed from `wmkf_copi1` and his Co-PI row deleted; duplicate Diaz contacts merged (kept `d6b3d757-…`, UC Berkeley liaison, which took UC Berkeley as account).
3. **Grant Reporting header lists junction co-PIs** (`529e8081a`, Tier 1 branch merge): PI, then `fetchCoPIs` Personnel co-PIs, then any slot-only co-PI; slot fallback on junction failure. [VERIFIED via GitHub check-runs on `529e8081a`: six workflows green]
4. **Production-read flag removed** from `.env.local` in this checkout and in `WMKF_Apps-claude-2026-10-22`, `-claude-debug`, `-claude-session` (owner-approved). Production reads now need `DATAVERSE_ALLOW_PROD_READS=yes` on the command line; writes still need a same-UTC-day `DATAVERSE_PROD_WRITE_ACK`.
5. **Owner retired** the Connor 2024-split confirmation and the held note to Connor (plan §7); **tabled** the confirm-your-details email campaign.

### Commits

- `2ff96adf8`, `4a2ae96e2`, `b8c957076` — CI test fixes.
- `580ab5b82` — read-only `scripts/probe-account-names.mjs`.
- `9f541d5e5`, `66c8f4124` — `scripts/lookup-research-copi-current-emails.mjs` (free + capped paid).
- `56c56c781`, `10535fcb3`, `e9899afb1`, `70479fcb4`, `7fcbaa5cd`, `6514e748b`, `d02d5458d` — Stage B apply rules, script and review fixes.
- `529e8081a` — Grant Reporting junction co-PIs.
- Remaining commits (`2b8570d1f` … `d744f7f24`) record decisions, runs and follow-ups in the plan doc and Atlas.

## Next Items

### Verified Open

- None selected. No owner-chosen next task this session.

### Parked

1. **Confirm-your-details email campaign** (PIs/co-PIs confirm current institution and email). Tabled by owner 2026-10-24; may be taken up in another context.
   Evidence: plan §3.2 "Tabled".
2. **Grant Reporting app sunset** (owner, 2026-10-24). Any successor that lists investigators should call `fetchCoPIs` (`lib/services/proposal-participants.js`), not the legacy `wmkf_copi1..5` slots.

### Verify Before Acting

1. **Stage B rollback** is available only for writes unchanged since apply: `node scripts/apply-research-copi-stage-b.mjs --rollback --ids=<file|all> --dir=<stage-b-2>` (needs prod-read flag + same-day write ack). Nelson's and Paddison's created contacts will refuse deletion (account set afterwards); `--plan` refuses while the apply log has activity.
   Evidence: plan §3.4; `research-copi-applied.jsonl` in `~/Downloads/Research Co-PI Searches/stage-b-2/`.
2. **Owner folder holds names** (`~/Downloads/Research Co-PI Searches/stage-b-2/`: plan, decisions, emails, logs, follow-up scripts). Keep it out of git.
3. **Untracked, not session-owned:** `.impeccable/critique/2026-10-19T02-04-42Z__…boardwriteups-js.md` and `output/` — preserved untouched.

### Do Not Reopen Without New Decision

- Connor 2024-split confirmation and the §7 note to Connor — retired (owner, 2026-10-23).
- Stage B row decisions (Part 1–5 answers, account mappings, emails) — applied and verified; changes go through a new, separate plan.
- Session 634 release, broad audits, mock fixes — unchanged from the prior handoff.

## Concurrent Workstreams — historical resume index

Prior handoff: `git show 5ba8efaf2:SESSION_PROMPT.md`. Recorded owner boundaries, not newly verified tasks:

- Personal email defaults: slice 3 shipped (PR #517); slice 2 plan-first. `docs/plans/PERSONAL_EMAIL_DEFAULTS_INVENTORY_2026-09-24.md`.
- Meeting coordination: design parked, no runtime build authorization. `docs/plans/review/MEETING_TRACKER_LANDING_STRUCTURE_2026-10-20.md`.
- J27 / overlapping cycles: proposed; calendar authority and related owner decisions open. `docs/plans/CYCLE_ROLLOVER_MINIMAL_CONFIGURATION_PLAN_2026-10-06.md`.
- Shared roles: PR #516 released; read assignment through config.
- Research Institution at Award backfill: Stage A (2026-10-20) and Stage B (2026-10-23/24) applied and verified; no follow-ups open. `docs/plans/RESEARCH_INSTITUTION_AT_AWARD_BACKFILL_PLAN_2026-10-20.md`.
- Reviewer panel coverage pilot parked; Expense Reporter as is; Literature Analyzer direction awaits scope.

## Key Files Reference

| File | Purpose |
|------|---------|
| `scripts/apply-research-copi-stage-b.mjs` | Stage B plan/apply/verify/rollback (owner-run) |
| `scripts/lib/research-copi-apply.mjs` | Row selection, payloads, ledger, injected-IO applier |
| `scripts/lookup-research-copi-current-emails.mjs` | New-contact email lookup (free; `--paid` capped) |
| `scripts/probe-account-names.mjs` | Read-only account name lookup |
| `lib/services/grant-reporting/lookup-grant-service.js` | Grant Reporting header (junction co-PIs) |
| `docs/plans/RESEARCH_INSTITUTION_AT_AWARD_BACKFILL_PLAN_2026-10-20.md` | Decisions, runs, rollback |

## Testing

```bash
npx jest tests/unit/research-copi-apply.test.js tests/unit/lookup-grant-service.test.js
```

Milestone determination: production Stage B co-PI backfill merits a DEVELOPMENT_LOG entry (added). CLAUDE.md requires no change.
