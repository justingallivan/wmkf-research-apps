# Session 528 Prompt: Executor cache telemetry read; post-fix cross-document read still pending

## Session 527 Summary

[VERIFIED via owner-run production Dataverse reads, source, gates, Git, GitHub CI,
and the Vercel API] Session 527 ran in the worktree `worktree-claude-s525` while
Codex finished the Graph release on `main`. It took handoff item 1 (prove realized
cache reads for the S524 Executor prefix fix) as far as production traffic allows:
built a read-only run-row telemetry probe, had the owner run it three times, and
reconciled the durable docs against what the rows actually show. Sonnet wrote the
probe; interpretation, corrections, and docs were the orchestrator's.

### What Was Completed

1. **Read-only `wmkf_ai_run` cache-telemetry probe**
   - `scripts/probe-ai-run-cache-reads.js`: lists recent Executor run rows with
     `--prompt <name>`, `--request <num>`, `--since <ISO>`, `--limit N`; parses
     `cache_create`/`cache_read`/`cacheHit`/latency out of `wmkf_ai_notes`; prints
     the prompt name per row. Owner-run (reads whichever Dataverse `.env.local`
     points at). The `_wmkf_ai_prompt_value` lookup filter is now
     [VERIFIED via live query 2026-09-20].
   - Gates run sequentially after each change: dataverse-access-layer,
     dynamics-context-boundary, trust-boundary-guid, odata-escape, secret-scan,
     scaffolding-tokens (+ self-tests), all green.

2. **What production telemetry showed (rows since 2026-09-16)**
   - `phase-i.summary`, the prompt S524 planned to test with, has had no runs
     since 2026-04-25. The original test plan was moot.
   - The Executor prompts that batch within the TTL are `cycle-dossier.entry`
     (Opus 5; 3 documents in 28 s on 09-17, 2 in 4 s on 09-16; marked prefix
     610–618 tokens) and `review-synthesis.generate` (Sonnet 5; documents 4 min
     apart on 09-18; 1841–2258 tokens). Pre-fix rows show every document writing
     its own entry and none reading: the R4 write-no-read pattern, observed.
   - `cache_create` on a fresh run is the measured marked-block size for the live
     prompt row, which supersedes the chars/4 seed estimates. Review panel: seat v2
     552, chair v3 801, both on Opus 5, so the panel DOES cache its system block.
     The audit doc's "panel caches nothing" claim is withdrawn. The seat resolved to
     Opus 5 in the 09-17 row although source defaults it to Fable 5.1
     (`shared/config/baseConfig.js` `review-panel.seat.claude`); override config
     not read.
   - The fix landed on `main` at 2026-09-19 19:48Z. The only post-fix row is one
     `initial-assessment.generate` document (prefix 645 vs 677 pre-fix on the same
     row/version, consistent with the nonce line gone). **The post-fix
     cross-document read is not yet observed.**

3. **Durable reconciliation**
   - `docs/PROMPT_CACHING_AUDIT.md` §0 R4 (telemetry table, withdrawn panel claim,
     closing check), §3 R4 qualifier, §4 verification (script invocation),
     frontmatter. `.claude-memory/project-cache-hit-rate-review.md`, agent-wiki
     `prompt-executor.md` (telemetry bullet). Docs catalog regenerated.
   - `scripts/audit-system-prompt-sizes.js` could not run as documented: the bare
     `node scripts/...` form fails on the app's extensionless imports (S524's
     "re-verified" was a mocked-rows check). Added `npm run audit:prompt-sizes`
     (uses `scripts/lib/use-extensionless.mjs`) and fixed the docblock. It has
     still not been run end-to-end; it is owner-run (production prompt rows).
   - Handoff correction: Executor cache telemetry lives in Dataverse
     `wmkf_ai_run` notes (`aiRunAdapter.create` in `execute-prompt.js`
     `writeRunRow`), not Postgres.

4. **Release**
   - Branch rebased onto Codex's Graph closeout (`d9cf70b5`; no file overlap),
     then `main` fast-forwarded `d9cf70b5` → `7c729379` with owner approval and
     pushed from the worktree. Vercel production `dpl_6Z3Fv3mYxpkSYiQCjqmUQrbsQvbd`
     READY at `7c729379` (docs + scripts only, no runtime change). All five CI
     workflows passed. Rollback: `dpl_ExUrFDvxPXPfSrzYzhJVL7ieeQWJ` (`a24a02d5`).
   - Per-machine worktree setup: `.agents/skills` symlink, `node_modules` symlink,
     memory symlinks at both the harness slug (`--claude-worktrees-`) and the
     `check-agent-invariants` slug (`-.claude-worktrees-`); the two disagree on the
     dot, so a worktree needs both. `check:agent-invariants` was the only red at
     `/start` and cleared once the symlink existed.

### Commits
- `c6280aa1` - chore(scripts): add read-only wmkf_ai_run cache-telemetry probe
- `ea72f07a` - chore(scripts): show prompt name per run in the cache-telemetry probe
- `7c729379` - docs: record production cache telemetry for the Executor prefix fix

## Next Items

### Verified Open

1. **Observe the post-fix cross-document cache read (item 1 closing step).**
   Evidence: `docs/PROMPT_CACHING_AUDIT.md` §0 R4 telemetry table; only one
   post-fix row as of 2026-09-20 03:14Z. Owner-run:
   `node scripts/probe-ai-run-cache-reads.js --since 2026-09-19T19:48:00Z --limit 25`.
   Expect later documents of a `cycle-dossier.entry` or `review-synthesis.generate`
   batch to show `cache_read` ≈ the first document's `cache_create`. If they still
   show create-only, read that prompt row's system template in Dataverse for
   interpolated variables (S524's grep covered bundled seeds only). No deliberate
   test needed unless the owner wants it closed before the next natural batch.
2. **Await Connor's platform-owner evidence for the Test Request Factory** (carried
   from Session 526, unchanged). Evidence:
   `docs/plans/CONNOR_TEST_REQUEST_FACTORY_HANDOFF_2026-09-19.md`. Production
   enablement stays blocked; no clone route, schema apply, creation, or send.
3. **Preview CSRF origin check rejects alias-hosted POSTs** (carried from S523,
   unchanged). Evidence: `lib/utils/auth.js` `validateOrigin`;
   `docs/CURRENT_WORK_QUEUE.md` entry. Prefer the runbook step first.

### Owner Decision Needed

1. **Review-panel user-turn cache breakpoint, premise corrected.** The system
   block already caches on Opus 5 (seat 552, chair 801). The only open lever is
   the unmarked user turn holding the proposal + question set; it pays only if
   the same proposal is re-sent within the TTL (seat retries, chair rerun). Read
   panel run-row cadence with the probe (`--prompt review-panel.seat`,
   `--prompt review-panel.chair`) before deciding; if gaps exceed 5 minutes the
   lever is `ttl: '1h'`, not a breakpoint.
2. **R5 items** (`composeScorePrompt` batch loop, `process-phase-i-writeup` static
   block, ~10 single-shot callers with a random nonce at byte 0). Still gated on
   the `api_usage_log` hit-rate query per app; unchanged.
3. **Test Request Factory enablement boundary** (carried from Session 526).
   Decide only after Connor's evidence and the bounded rehearsal results.
4. **Reviewer search functional follow-ups** (carried;
   `docs/plans/REVIEWER_SEARCH_FOLLOW_UPS_2026-09-18.md`).

### Parked

1. Dynamics Explorer history caching (carried; re-open only if the Explorer moves
   off Haiku). Impeccable 11px exception (carried). Memory router diet debt
   (router unchanged this session; `check:memory-router` reports 7054 bytes, under
   the 8 KiB trigger).

### Verify Before Acting

1. **`npm run audit:prompt-sizes` has never completed end-to-end.** The invocation
   is fixed but unproven past the first prompt module; it reads production prompt
   rows and spends `count_tokens` calls, so the owner runs it. For Executor rows
   prefer the measured `cache_create` from the probe.
2. **Remove two stale Entra callbacks for retired Codex branch aliases** (carried;
   owner-run tenant write). Destructive: list and confirm the exact redirect URIs
   before touching anything.
3. **Refresh production deployment and rollback facts before another release
   action** (carried from Session 526). Current: `dpl_6Z3Fv3mYxpkSYiQCjqmUQrbsQvbd`
   at `7c729379`; runtime evidence is sampled, not continuous.
4. **Worktree gate runs:** the harness memory slug and the gate's slug differ for
   dotted paths (`.claude/worktrees/...`); if `check:agent-invariants` is red in a
   worktree, create the symlink at both slugs before assuming a repo problem.

### Do Not Reopen Without New Decision

1. Do not re-add the nonce list to the Executor preamble; do not add a cache marker
   without a verified floor and repeat-within-TTL use (carried).
2. Do not reopen the completed GraphService decomposition or promote Test Request
   Factory capability from `codex/test-request-design` without Connor's evidence
   and release approval (carried from Session 526).
3. The "review panel caches nothing" claim is withdrawn on measured data; do not
   restore it from the older seed estimates.

## Key Files Reference

| File | Purpose |
|------|---------|
| `scripts/probe-ai-run-cache-reads.js` | Owner-run read-only run-row cache telemetry (prompt/request/since filters) |
| `docs/PROMPT_CACHING_AUDIT.md` | §0 R4 telemetry table, closing check, withdrawn panel claim |
| `.claude-memory/project-cache-hit-rate-review.md` | Cache remaining-work pointer with the measured prefixes |
| `docs/agent-wiki/topics/prompt-executor.md` | Executor hazards incl. where cache telemetry lives |
| `scripts/audit-system-prompt-sizes.js` + `npm run audit:prompt-sizes` | Bundled-app prefix-size audit (loader-required invocation) |
| `lib/services/execute-prompt.js` | `composeMessages` (nonce-free preamble), `callProvider` (system-only marker), `writeRunRow` / `buildSuccessNotes` (notes format) |
| `docs/plans/CONNOR_TEST_REQUEST_FACTORY_HANDOFF_2026-09-19.md` | Test Request Factory blockers (Codex, Session 526) |

## Testing

```bash
# Owner-run (production Dataverse read): post-fix cross-document read check
node scripts/probe-ai-run-cache-reads.js --since 2026-09-19T19:48:00Z --limit 25
# Owner-run: bundled-app prefix sizes (count_tokens + production prompt rows)
npm run audit:prompt-sizes
# Gates touched this session (sequential; each with its self-test)
npm run check:dataverse-access-layer && npm run check:dataverse-access-layer:self-test
npm run check:odata-escape && npm run check:odata-escape:self-test
npm run check:doc-currency && npm run check:doc-currency:self-test
npm run check:docs-catalog
```

## Stop-time notes

Claim-evidence pilot: the current-session report shows zero recorded advisory
events and no eligible plan/design edit, so no observation row was added. No
milestone entry: telemetry read and docs reconciliation, not a new capability or
cutover. Session docs were written on `worktree-claude-s525` and land on `main`
by fast-forward.

## Historical handoffs — not current instructions

Everything below preserves prior-session evidence. The Session 528 guidance above
controls current next steps. The Session 527 prompt body (Codex's Session 526
Graph release summary) follows unchanged, then older handoffs.

## Prior Session 527 Prompt: Production Graph release complete; Test Request Factory handoff pending

## Session 526 Summary

[VERIFIED via `/private/tmp/graph-production-release-receipt.json`, production smoke, CI results, and bounded runtime logs]
The GraphService release was promoted to `main` at `a24a02d588be728ade199069e7b953dbafdce96e` and deployed as `dpl_ExUrFDvxPXPfSrzYzhJVL7ieeQWJ`. All four custom domains are listed on the verified release. Authenticated staff, contributor, and proposal-download smoke checks passed. A bounded sample of 100 sanitized runtime records contained zero errors or 5xx responses. All five CI workflows passed. Rollback deployment: `dpl_Aui3x7NtH3MoKARNHZQB5YUyJLZS`.

### What Was Completed

1. **GraphService production release**
   - `main` was fast-forwarded and pushed with owner approval.
   - Secret Scanning, Dependency Scan, Security Scan, E2E (Playwright), and Tests all completed successfully.
   - Production smoke covered the authenticated staff page, expected contributor checklist/receipt, and proposal download HTTP 200.
   - Runtime evidence is bounded, not exhaustive monitoring: `/private/tmp/graph-production-runtime-sanitized.jsonl`.

2. **Test Request Factory handoff preparation**
   - The separate design/implementation branch is `codex/test-request-design` in `/Users/gallivan/.codex/worktrees/test-request-design/WMKF_Apps`.
   - Current factory status remains **production enablement blocked**. Offline policy/isolation work is accepted; no clone route, schema apply, live request creation, deployment, or email send is enabled.
   - Connor was emailed; response is pending. Handoff details are in `docs/plans/CONNOR_TEST_REQUEST_FACTORY_HANDOFF_2026-09-19.md`.

3. **Concurrent worktree boundary**
   - Claude's active clean worktree is `worktree-claude-s525` at `aed0337d`. Do not touch it from this session.

## Next Items

### Verified Open

1. **Await Connor's platform-owner response for Test Request Factory suppression and provisioning.**
   Evidence: `docs/plans/CONNOR_TEST_REQUEST_FACTORY_HANDOFF_2026-09-19.md` and the Stage 0 contract in the test-request-design worktree.
   Required evidence covers create/update automation suppression, narrative/package/status consumers, SharePoint location provisioning, numbering/defaults, and isolated fixture readback.

### Owner Decision Needed

1. **Test Request Factory enablement boundary.**
   Evidence: `TEST_REQUEST_FACTORY_DESIGN_2026-09-19.md` and `TEST_REQUEST_FACTORY_PLATFORM_CONTRACT_2026-09-19.md` in the separate branch.
   Decide only after Connor supplies named owner/config evidence and the required bounded rehearsal results; unknown suppression or folder provisioning keeps production disabled.

### Verify Before Acting

1. **Refresh production deployment and rollback facts before another release action.**
   Evidence: `/private/tmp/graph-production-release-receipt.json` is the current bounded receipt; runtime log review is sampled, not continuous monitoring.

### Do Not Reopen Without New Decision

1. Do not reopen the completed GraphService decomposition or promote Test Request Factory capability from `codex/test-request-design` without the explicit platform-owner evidence and release approval above.

## Key Files Reference

| File | Purpose |
|---|---|
| `docs/plans/CONNOR_TEST_REQUEST_FACTORY_HANDOFF_2026-09-19.md` | Connor's required platform-owner evidence and factory blockers |
| `/Users/gallivan/.codex/worktrees/test-request-design/WMKF_Apps/docs/plans/TEST_REQUEST_FACTORY_DESIGN_2026-09-19.md` | Separate factory design and stage boundary |
| `/Users/gallivan/.codex/worktrees/test-request-design/WMKF_Apps/docs/plans/TEST_REQUEST_FACTORY_PLATFORM_CONTRACT_2026-09-19.md` | Stage 0 metadata, automation, provisioning and suppression evidence |
| `/private/tmp/graph-production-release-receipt.json` | Production release, smoke, CI and rollback receipt |
| `docs/plans/GRAPH_SERVICE_DECOMPOSITION_EXECUTION_2026-09-19.md` | Historical Graph stage evidence and release boundary |

## Testing

- Production receipt: authenticated staff/contributor/download smoke passed; 100 sampled sanitized runtime records had zero errors/5xx.
- CI: Secret Scanning, Dependency Scan, Security Scan, E2E (Playwright), and Tests passed.
- No additional live calls or writes are authorized by this handoff.

## Historical handoffs — not current instructions

The following prior Session 525 prompt and older summaries are retained evidence.
Their deployment claims and authorizations belong to those named releases;
current Graph migration status and next actions are above.

## Prior Session 525 Prompt: Prompt-cache prefix fix shipped; panel breakpoint and R5 wait on telemetry

## Session 524 Summary

[VERIFIED via source, scoped Jest, gates, Codex adversarial review, Git, and Vercel
API] A read-only prompt-caching review (delta against the July 2026 audit in
`docs/PROMPT_CACHING_AUDIT.md`) found the audit's open item R4 was overstated, fixed
the one-line cause on a Tier 1 branch, reconciled the durable restatements, and
promoted the branch to production as a fast-forward of `main`.

### What Was Completed

1. **Executor cache prefix is now byte-identical across documents (R4 closed)**
   - `composeMessages` in `lib/services/execute-prompt.js` prepended
     `buildUntrustedContentPreamble(untrustedNonces)` to the `cache_control`-marked
     system block, so every document put a unique nonce line at byte 0 and the
     marker was a cache write with no read. It now calls the preamble with no
     nonce list (the helper documents the line as optional; sentinels carry the
     nonce on open and close; the Dynamics Explorer has shipped nonce-free since
     A7 Part 3). No schema split was needed: no prompt definition places an
     untrusted variable in a system template (disconfirming greps recorded in the
     audit doc §0 R4).
   - Pinned by `tests/unit/execute-prompt-payload-boundary.test.js` (nonce-free
     system assertion + "two different documents share a byte-identical marked
     system block"); mutation-tested by restoring the nonce list (2 tests red).
   - `/contract-reconcile` (Mode B) confirmed both `assertSystemIncludes` callers
     are unaffected: peer-review asserts its own route-built preamble nonces and
     declares no untrusted variable; pre-site-visit asserts static sentences.
   - Codex adversarial review (OAuth, `--base main`): no A7 regression; one medium
     finding (audit script still read the removed `FLOOR`), fixed and re-verified
     with mocked rows.

2. **Durable reconciliation**
   - `docs/PROMPT_CACHING_AUDIT.md` §0/§3 R4 rewritten (DONE; historical framing
     kept and labelled), per-tier floors recorded (Opus 5 / Fable 5.1 512; Opus 4.8 /
     Sonnet 5 1024; Haiku 4.5 4096), `last_verified` 2026-09-19.
   - `.claude-memory/project-cache-hit-rate-review.md`, agent-wiki
     `prompt-executor.md` (new "preamble is nonce-free by design" bullet),
     `scripts/audit-system-prompt-sizes.js` (per-tier `FLOORS`, `verdict(n, tier)`),
     docs catalog regenerated.

3. **Release**
   - `main` fast-forwarded `62454b07` → `b54d11b5`; Vercel production deployment
     `dpl_VruCcbXfwdB96Fxmh7H6rjdYUjpB` READY at commit `b54d11b5` (verified via
     `vercel api`). Rollback: `wmkfresearchapps-g8484ufro` (`62454b07`) or revert
     `486ba38b`.
   - Gates: full `/start` run 35 gates + 32 self-tests green before work; affected
     gates re-run green after each edit. Scoped Jest 46 suites / 774 tests. Full
     `npm test` NOT run (Tier 1; scoped suites + gates).

### Commits
- `486ba38b` - fix(executor): keep the nonce list out of the cached system prefix
- `b54d11b5` - fix(scripts): finish per-tier floors in the prompt-size audit report

## Next Items

### Verified Open

1. Prove realized cache reads for the Executor fix.
   Evidence: `lib/services/execute-prompt.js` `callProvider` marks only the system
   block; the Executor does not write `api_usage_log` (comment at the LLMClient
   construction site), so cache tokens appear only in the `wmkf_ai_run` notes
   string (`cache_read=`). Of the seeded system templates only `phase-i-dynamics`
   (~1.5k tok incl. preamble, Sonnet 5 floor 1024) and
   `pre-site-visit-proposal-core` (~1.4k) clear their floor; both are chars/4
   estimates [ASSUMED until `scripts/audit-system-prompt-sizes.js` is run].
   Next: after a Phase I batch (two documents through the same prompt row within
   5 minutes), read the second run row's notes; expect `cache_read>0`. Owner reads
   production Postgres; do not self-authorize.
2. Preview CSRF origin check rejects alias-hosted POSTs (carried from S523,
   unchanged). Evidence: `lib/utils/auth.js validateOrigin`; logged in
   `docs/CURRENT_WORK_QUEUE.md`. Prefer the runbook step first.
3. Remove two stale Entra callbacks for retired Codex branch aliases (carried,
   owner-run tenant write).

### Owner Decision Needed

1. Review-panel user-turn cache breakpoint.
   Evidence: `shared/config/prompts/review-panel-seat.js` system ~360 tok
   (< Fable 5.1 floor 512) and chair ~510 (borderline at Opus 5 512); proposal
   narrative + question set sit in the unmarked user turn
   (`execute-prompt.js` `callProvider` `messages: [{ role: 'user', content: body }]`).
   The panel caches nothing today. A second breakpoint on the user block pays only
   if the same proposal is re-sent within the TTL (seat retries up to 5, chair
   rerun); otherwise it is a 1.25× write on the most expensive tokens in the
   system. Decide after reading `wmkf_ai_run` timestamps for panel runs
   (cadence [ASSUMED unknown]); if gaps exceed 5 minutes the lever is `ttl: '1h'`.
2. R5 items (`composeScorePrompt` batch loop, `process-phase-i-writeup` static
   block) and the ~10 single-shot callers with a random nonce at byte 0
   (`process.js`, `process-phase-i.js`, `summarize-service.js`, reviewer
   analyze/score, `integrity-service.js`, `multi-llm-service.js`). Gate on the
   `api_usage_log` hit-rate query per app (30-day window, grouped by app/model)
   before any marker is added. `process.js`/`process-phase-i.js` call twice per
   document with separate nonces, so nothing is shared today — verify, don't
   assume a win.
3. Reviewer search functional follow-ups (carried; `docs/plans/REVIEWER_SEARCH_FOLLOW_UPS_2026-09-18.md`).

### Parked

1. Dynamics Explorer history caching. Evidence:
   `lib/services/dynamics-explorer/chat-session.js` `compactMessages` rewrites
   earlier rounds each turn, so no message-level marker can hit; system+tools
   (~11k tok) cache on Haiku 4.5. Re-open only if the Explorer moves off Haiku.
2. Impeccable 11px exception (carried). Memory router diet debt (carried; router
   unchanged this session).

### Verify Before Acting

1. Peer-review route still puts a nonce-bearing preamble at byte 0 of its system
   prompt via `{{a7_preamble}}` (`pages/api/process-peer-reviews.js`). Out of this
   session's scope; a cacheable variant would need the route to pass a nonce-free
   preamble AND switch `assertSystemIncludes` from nonces to preamble text. Only
   worth it if peer-review summaries repeat within the TTL.
2. S523 carryovers unchanged: Graph drive-item 4xx events on Workbench Proposal tab
   in Preview; transient Explorer 503 after redeploy; Explorer disconnect path not
   live-proven post-extraction.

### Do Not Reopen Without New Decision

1. Do not re-add the nonce list to the Executor preamble "for explicitness"
   (wiki `prompt-executor.md`; audit doc §0 R4). Do not add a cache marker to any
   site without a verified floor for the concrete model and repeat-within-TTL use
   (`project-cache-hit-rate-review` memory).
2. Explorer extraction complete through S9; Workbench cache/code-splitting trials
   rejected by measured gates; no routine paid Explorer smokes (carried from S523).

## Key Files Reference

| File | Purpose |
|------|---------|
| `lib/services/execute-prompt.js` | `composeMessages` (nonce-free preamble), `applyVariableBoundaries` (stable per-document nonce), `callProvider` (system-only marker) |
| `lib/utils/ai-payload-boundary.js` | `wrapUntrustedContent`, `deriveStableNonce`, `buildUntrustedContentPreamble` |
| `tests/unit/execute-prompt-payload-boundary.test.js` | Pins nonce-free system + cross-document prefix equality |
| `docs/PROMPT_CACHING_AUDIT.md` | July audit + R4 closure record, per-tier floors, remaining data-gated items |
| `scripts/audit-system-prompt-sizes.js` | Per-tier prefix-size audit (needs `.env.local` CLAUDE_API_KEY; `count_tokens`) |
| `docs/agent-wiki/topics/prompt-executor.md` | Executor hazards incl. the nonce-free preamble rule |

## Testing

```bash
npx jest tests/unit/execute-prompt --silent
npm run check:prompt-injection-tagging && npm run check:prompt-injection-tagging:self-test
npm run check:doc-currency && npm run check:doc-currency:self-test
node scripts/audit-system-prompt-sizes.js   # measures real prefix sizes per tier
```

## Stop-time notes

Claim-evidence pilot: report shows zero recorded advisory events for this session
key, so no observation row was added. No milestone entry: a cost fix, not a new
capability or cutover. This handoff push triggers a documentation-only production
deployment.

## Historical handoffs — not current instructions

Everything below preserves prior-session evidence. The Session 525 guidance above
controls current next steps. The Session 524 prompt body (Session 523 summary)
follows unchanged.

## Session 523 Summary

[VERIFIED via source, tests, gates, Git, Vercel CLI, Preview and production
signed-in browser checks] Two Tier 1 refactors were built on separate branches,
integrated on a throwaway integration branch, verified together, validated on a
Preview deployment, and promoted to production as one fast-forward of `main`.

### What Was Completed

1. **Dynamics Explorer chat-service extraction (Claude, S0–S9)**
   - `pages/api/dynamics-explorer/chat.js` 2,983 → 197 lines; logic moved verbatim
     into 17 modules under `lib/services/dynamics-explorer/` (`chat-session.js`,
     `tool-executor.js`, `model-call.js`, `explorer-store.js`, `tools/*`, …).
   - S0 characterization suite (18 tests) and SSE census snapshot pinned behaviour;
     the snapshot never changed after S0. Restriction-guard suite (17 tests).
   - Three gate exemptions for `pages/api/dynamics-explorer/` retired
     (route-service-boundary, dataverse-access-layer, odata-escape) with red
     fixtures proven by mutation. Registries repointed; J27-026 register row moved.
   - Orchestration: Sonnet built and scouted, Opus reviewed each stage (two rounds
     max), root fixed small findings itself. Codex adversarial review of the plan
     used OAuth only. Receipt: `docs/plans/DYNAMICS_EXPLORER_CHAT_SERVICE_EXTRACTION_EXECUTION_2026-09-19.md`.

2. **Workbench responsiveness (Codex, local-first S0–S3)**
   - Request list rows retained during refresh; independent request sections load
     before context; Reviews tab retains children during refresh. No API, service,
     schema, dependency or auth change. Cache experiment omitted; code splitting
     trial rejected below its 5% gate. Receipt:
     `docs/plans/WORKBENCH_RESPONSIVENESS_EXECUTION_2026-09-18.md`.

3. **Integration and promotion (Claude owned; Codex read-only)**
   - `integration/2026-09-19`: merges `4c3ce24d` (Explorer), `35610f64`
     (Workbench), `71a1ae4f` (memory frontmatter). No conflicts; changed-file sets
     did not overlap. Combined tree: 38 gates + 29 self-tests green, Jest 976
     suites / 14,358 tests, lint 0 errors, types, canonical Turbopack build, 9/9
     route-mocked browser journeys.
   - Preview validation on the alias with branch-scoped `DATAVERSE_ALLOW_PROD_READS`
     and `NEXTAUTH_URL`: Explorer query, parallel two-tool round, UI list + Excel
     export (209 rows) all `completed`; Workbench list/request/Overview/Proposal/
     Reviews rendered live data. One transient 503 on the first invocation after a
     redeploy, not reproducible. Disconnect test inconclusive (answer finished
     before the abort landed); wiring is byte-identical and pinned by S0 tests.
   - Production: `main` fast-forwarded `7c18b622` → `3f4a1068`, deployed as
     `dpl_2zkcS5GMKaadkjJNdzujZTj5mLda` (`wmkfresearchapps-g8484ufro`). Read-only
     production check passed (sign-in, Workbench list and request 1002852, Explorer
     query completed in 3 rounds). Rollback: `dpl_6paPmnhgjdZ6bu23b57Q5A7XpGXK`
     (`7c18b622`); revert `4c3ce24d` or `35610f64` individually.
   - Cleanup done: alias removed, branch-scoped env vars removed, integration
     worktree and local branch removed, `origin/integration/2026-09-19` deleted,
     Explorer worktree and branch removed. Seven `smoke-*` telemetry rows remain in
     production Postgres as retained residue.

### Commits
- `52059e6b`…`bdb2bd00` - Explorer extraction plan and its review revisions.
- `4c3ce24d` - Merge `claude/explorer-chat-extraction` (39 stage commits, `ca56aa36`).
- `35610f64` - Merge `codex/workbench-responsiveness` (8 commits, `9f0d1b55`).
- `3f4a1068` - Merge `main` (memory) into integration; the promoted commit.
- `4ed2dbea` - Queue: Preview CSRF alias-origin follow-up.
- `ba060914` - Release record appended to the Explorer execution receipt.

## Next Items

### Verified Open

1. Preview CSRF origin check rejects alias-hosted POSTs.
   Evidence: `lib/utils/auth.js validateOrigin` derives the Preview origin from
   `VERCEL_URL`; observed 403 on the Explorer chat POST via the alias, cleared by a
   branch-scoped `NEXTAUTH_URL`. Logged in `docs/CURRENT_WORK_QUEUE.md` (Audit
   follow-ups). Prefer documenting the runbook step first; widening the allowlist
   goes through `/contract-reconcile`. Pre-existing, not a regression.
2. Remove two stale Entra callbacks for retired Codex branch aliases.
   Evidence: `az ad app show` redirect URIs on 2026-09-19 list
   `…git-codex-pau-5b4bef…` and `…git-codex-wor-464bcd…`. Owner-run tenant write.

### Owner Decision Needed

1. Reviewer search functional follow-ups (carried from Session 523; unchanged).
   Evidence: `docs/plans/REVIEWER_SEARCH_FOLLOW_UPS_2026-09-18.md`. Choose one scope.

### Parked

1. Impeccable 11px exception scoped to CandidateCard and IdentityComparisonPanel
   (carried; `.impeccable/config.json`). Re-open on a readability review.
2. Memory router diet debt (router at 7,054 bytes / 67 lines after this session's
   one added pointer; gate green). Re-open when the router gate advises.

### Verify Before Acting

1. Graph drive-item 4xx dependency events on the Workbench Proposal tab in Preview
   (three, page still rendered every document). Unclassified against production;
   check fresh logs before treating as new.
2. The transient Explorer 503 (first invocation after redeploy `e6b2sn5dd`). Not
   reproduced across four subsequent requests; re-check only if it recurs in
   production logs.
3. Explorer disconnect path on a long-running request has not been live-proven
   post-extraction; S0 tests 4b–4g pin it. Only test live if a report suggests
   telemetry outcomes are wrong.

### Do Not Reopen Without New Decision

1. The Explorer extraction is complete through S9; do not re-add route-dir gate
   exemptions or re-export helpers from the route shell.
2. Workbench cache experiment (S4) and code-splitting trial (S5) were omitted or
   rejected by measured gates; do not resurrect without a new measurement.
3. Do not rerun paid Explorer smokes or Preview promotions as routine verification.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/plans/DYNAMICS_EXPLORER_CHAT_SERVICE_EXTRACTION_PLAN_2026-09-18.md` | Staged plan, §3.2 module map, §11 review log |
| `docs/plans/DYNAMICS_EXPLORER_CHAT_SERVICE_EXTRACTION_EXECUTION_2026-09-19.md` | Per-stage receipts, final acceptance, release record |
| `docs/plans/WORKBENCH_RESPONSIVENESS_EXECUTION_2026-09-18.md` | Codex execution and review receipt |
| `lib/services/dynamics-explorer/chat-session.js` | `runExplorerChat` agentic loop behind the callback contract |
| `lib/services/dynamics-explorer/tool-executor.js` | `executeTool` dispatcher |
| `pages/api/dynamics-explorer/chat.js` | 197-line route shell (auth, SSE, lifecycle, telemetry) |
| `docs/CURRENT_WORK_QUEUE.md` | Preview CSRF alias follow-up |
| `.claude-memory/feedback-one-session-runs-gates-per-worktree.md` | Gate concurrency and stage-gate-list lessons |

## Testing

```bash
npx jest tests/unit/dynamics-explorer-chat-characterization.test.js tests/unit/dynamics-explorer-restriction-guard.test.js --silent
npm run check:route-service-boundary && npm run check:route-service-boundary:self-test
npm run check:odata-escape && npm run check:odata-escape:self-test
npm test -- --runInBand --silent
```

## Stop-time notes

Claim-evidence pilot: one universal-shape advisory (session key `966249cee7dcca4a`)
on the Explorer plan document; classified in
`docs/AGENT_ADJACENT_VERIFICATION_PILOT_DIRECTIVE.md`. Milestone entry added to
`DEVELOPMENT_LOG.md`. Lesson memory committed: only one session runs gates per
worktree; per-stage gate lists must include every gate that scans moved paths.
This handoff push may trigger a documentation-only production deployment.

## Session 522 Summary

[VERIFIED via source, tests, Git, Vercel and signed-in browser checks] Completed
ReviewerSearchSection decomposition, Stages 0–10, into 19 focused modules behind
the same public facade. Stage 0 fixed stale async-state/lock/export hazards;
subsequent stages preserved behavior. No backend route, schema or dependency change.
Luna built, fresh Sol reviewed, root accepted; root took over bounded corrections.
Claude Opus planning review used OAuth only. The owner's fresh Claude review found
no material regression; three unused imports were then removed.

### Release and verification

- Runtime release `e332ad84` pushed to main; production deployment
  `dpl_F8DFjHtMGGJgPohZ1naM9YDZiXac` READY. Documentation release `8da7f595`
  also reached production, `dpl_CNmuQKa9UgcUiFvdXo3dbKqgYTCA` READY.
- Final local gates: 71 commands, 971 suites / 14,272 tests and canonical build
  passed. All five remote workflows passed for runtime release e332ad84.
- Thirteen mocked browser scenarios matched the post-Stage-0 monolith. Live smoke
  proved Microsoft sign-in and a populated Workbench request list after retry.
  Initial Dataverse 30-second timeouts also affected unrelated cron routes; cause
  is unproven, dashboard recovered without a code/config change or rollback.
- No live reviewer save/search/email rehearsal ran. The full live workflow remains
  untested; do not convert the read-only dashboard smoke into that claim.
- Rollback target: `dpl_EwRv2sCRMoTC5n7CwYpyyJxRLNyo` / baseline `b400c97d`.
  Full evidence and rollback instructions are in the execution receipt.

### Key commits

- `8609d6ff`: revised plan; `a5bdc539`: bounded lifecycle fixes.
- `307aa914` through `e6b74792`: presentation, workflow hooks and controller stages.
- `1fde149c`: boundary tests; `6c3ec888`: verified stage closure.
- `30bca34a` / `e332ad84`: dead-import and whitespace cleanup.
- `8da7f595`: release receipt; `59184b39`: scoped Impeccable exception.
- `d4d0e0e9`: functional follow-up queue and separate design notes.

## Next Items

### Verified Open — choose a separate scope before implementation

Read `docs/plans/REVIEWER_SEARCH_FOLLOW_UPS_2026-09-18.md` for evidence and
prerequisite tests. It records uncertain-save reconciliation, incomplete
same-context exclusion rollback, uncancelled stale streams, and proposal-key-only
reset semantics. Priority is proposed, not owner authorization to implement all.

### Owner Decision Needed

Choose one functional follow-up. For proposal-key-only reset, first decide the
intended document identity contract. Do not combine fixes with a redesign.

### Parked — separate Impeccable notes

Five original 11px notes remain unchanged. `.impeccable/config.json` contains an
11px exception scoped to CandidateCard and IdentityComparisonPanel, with rationale.
The follow-up document's D1 section records the locations, future readability
review and exception-removal criteria. Typography scan passed. This is not a
project-wide approval for 11px text.

### Verify Before Acting

- If Dataverse timeouts recur, examine fresh logs; no root cause or durable fix
  was established. Do not assume the refactor caused them.
- Prior-session carryovers below were not revalidated; they are historical routing
  aids, not an automatic worklist. In particular, retained rehearsal records must
  be re-read before any separately authorized modification or cleanup.
- Memory router measured 7005 bytes / 67 lines / 52 direct leaf references after
  adding this queue pointer. Gates passed; existing router-diet debt remains
  separate work and must not be silently dropped.

### Do Not Reopen Without New Decision

No decomposition stage remains unfinished. Do not remove legacy behavior or alter
save/recovery contracts merely because the modules are now easier to edit. Do not
rerun live provider, promotion or email operations as routine verification.

## Key Files Reference

- Plan: `docs/plans/REVIEWER_SEARCH_WORKSPACE_DECOMPOSITION_PLAN_2026-09-18.md`
- Evidence: `docs/plans/REVIEWER_SEARCH_WORKSPACE_EXECUTION_2026-09-18.md`
- Follow-ups: `docs/plans/REVIEWER_SEARCH_FOLLOW_UPS_2026-09-18.md`
- Facade: `shared/components/reviewers/ReviewerSearchSection.js`
- Extracted owners: `shared/components/reviewers/search/`

## Stop-time notes

The claim-evidence pilot report could not read local state; no observation row was
inferred. No root-instruction change was needed. The development milestone is
“Reviewer search workspace decomposition promoted (Session 522)”. This handoff and
the pending follow-up/exception commits are synced by the stop workflow; its
main-branch push may trigger a documentation/config-only Vercel deployment.

## Historical handoffs — not current instructions

Everything below preserves prior-session evidence. The Session 523 guidance above
controls current next steps; historical completion and authorization statements
are scoped to their named releases.

## Session 521 Summary

**[VERIFIED via GitHub PR/deployment records and signed-in production checks.]**
All migration stages (0–8) and review hardening shipped through PR #315, merge
`8d3ad3a7`, production deployment `6535352663`. The documentation follow-up shipped
through PR #316, merge `74066c53`, deployment `6535429238` (success
2026-09-19T00:57:35Z). Its runtime tree is unchanged from PR #315.
CI passed 958 suites / 14,195 tests, canonical build and required checks.
Post-deploy reads confirmed IA Ready/Draft with version 1.0, Final leadership
state, and five signed-out redirects. The final documentation deployment was
also reloaded successfully in the signed-in production Workbench.

The owner confirmed receipt of the approved test email. Final and leadership
exact retries passed in the controlled rehearsal. Wrong-app access and
review-bundle rebuild remain mock-only by explicit owner decision; unrun fault
cases are not claimed as live passes. No further smoke or data cleanup is queued.
Test rows remain retained evidence; do not delete or retire them without approval.
Both local rehearsal servers are stopped. Claude's shared checkout was untouched.

### Commits and durable records

- `aff3049d`: integrate the deployed IA budget fix with the refactor.
- `c17e2a0f`: Final/leadership rehearsal and exact-retry receipt.
- `8d3ad3a7`: PR #315 production release.
- `839f4218` / `74066c53`: release documentation and PR #316 merge.
- Execution and smoke receipts: `docs/plans/GOVERNED_DOCUMENT_LIFECYCLE_EXECUTION_2026-09-18.md`
  and `docs/plans/GOVERNED_DOCUMENT_LIFECYCLE_SMOKE_TESTS_2026-09-18.md`.
- Milestone already recorded in `DEVELOPMENT_LOG.md`: “Governed document lifecycle
  decomposition promoted (Session 521)”; no duplicate milestone is needed.
- Rollback reference: commit `7a335e27`, deployment `6534771071`; rolling code back
  does not reverse retained rehearsal data.
- Stop-time claim-evidence report could not read local state; no observation was inferred.

The summaries below are historical evidence. Current next-session guidance is
under **Next Items**; historical restrictions and fixture snapshots do not override it.

## Prior Session 519 Summary

Session 519 was short. It started on `main` in sync with origin, ran every `check:*` gate
(one red: `check:j27-register`, see below), explained the open applicant-materials
reminder-cron question to the owner, and then recorded the owner's decision to retire that
cron. No code behaviour changed.

### What Was Completed

1. **Applicant-materials reminder cron retired (owner decision 2026-09-17), commit `28d719d9`.**
   The staff member who monitors whether materials arrive will do that follow-up manually,
   so `/api/cron/site-visit-materials-reminders` will not be scheduled. The route and
   `lib/services/site-visit-materials/reminder-sweep.js` stay in the tree, callable with
   `CRON_SECRET`, absent from `vercel.json`. Reconciled restatements: plan
   `docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md` (§16.6 item 1 decided, M5 follow-up closed,
   Slice 3 list), the route header comment, `docs/atlas/postgres-infra-tables.md`, the
   closed-work archive line, and memory leaf `project-ops-meeting-2026-09-16-agenda`
   (now `status: closed`, all six items decided; its router line removed because closed
   leaves route only via the archive). Gates run on the touched surfaces: memory-router,
   api-routes, atlas, doc-currency, fact-consistency, canonical-pointers, doc-symbol-refs,
   build-claim-freshness, harness-framing, agent-wiki, reviewer-reminder-hold, types; the
   cron route unit test passes (3/3).
2. **Start-of-session gate sweep.** Every other `check:*` gate and self-test green,
   `check:types` green, `check:memory-health` at the expected 7 advisory flags, and the
   memory router did NOT print the 8 KiB audit notice (the S518 diet held).

### Commits (main)
- `28d719d9` - docs: retire the applicant-materials reminder cron (owner decision 2026-09-17)

## Session 520 Summary

1. **J27 register citation repair.** The four rows in
   `docs/J27_TRANSITION_REGISTER.md` (J27-053 line 97, J27-057 line 101, J27-062 line 111,
   J27-064 line 113) now bind to exact excerpts in
   `.claude-memory/project-reviewer-apps-redesign-history.md` (lines 369, 303, 319, and
   329 respectively). J27-062 retains its separate `project-grant-phasing-evolution.md`
   plan fragment; J27-064 retains the current owner decision in the register disposition
   while using the historical allowlist-removal sentence as its source excerpt. The gate
   and self-test pass: 61 ok, 0 stale, 6 unverifiable, 11 closed. The six unverifiable
   rows (J27-034, -061, -067, -075, -076, -077) are advisory and pre-existing.

2. **Governed document lifecycle refactor — local execution authorized 2026-09-18.** The owner requested
   a staged plan, with fresh-context assumption reviews, for the largest defensible
   remaining refactor. The plan is
   `docs/plans/GOVERNED_DOCUMENT_LIFECYCLE_DECOMPOSITION_PLAN_2026-09-17.md`.
   It covers four document service coordinators, preserves separate state machines
   and public facades, and specifies prerequisite tests, ordered symbol/file moves,
   stage gates, review receipts and rollback. Planning was committed as `02c41a08`.
   The owner subsequently authorized local execution: Luna implements and builds,
   Sol reviews, and the orchestrator performs final acceptance, taking over stalled
   correction loops. Branch: `codex/document-lifecycle-decomposition`. Stage 0
   accepted in `7a2ed504`: 955 suites / 14,075 tests, lint/types/canonical build and
   required gates passed; Sol approved and root verified the real-route tests.
   Stage 1 accepted in `8a7060b9` after prerequisite commit `c58237c4`: neutral
   hash leaf, ten consumer imports, unchanged public hash API; 955 suites / 14,076
   tests and all required checks passed. Stage 2 accepted in `e4c10355` after test
   prerequisite `de875d68`: IA model/read modules; fresh Sol review and root checks
   passed, 955 suites / 14,078 tests plus all required checks. Stage 3 accepted in
   `2f7668b6` after test prerequisite `fbede538`: IA lineage/upload-recovery modules;
   fresh Sol review and root checks passed with the same full test count and all
   required checks. Stage 4 accepted in `569ab797`: Pre-Site model/defaults/read/
   lineage/recovery, with populated/historical fixtures verified on both old and new
   code; fresh Sol and root approval, 955 suites / 14,085 tests and required checks.
   Stage 5a accepted in `d673afc6`: distribution model/composition/defaults/context,
   unchanged public facade and writer; fresh Sol and root approval, 957 suites /
   14,100 tests and required checks. Calendar-send prerequisites passed on old/new code.
   Stage 5b accepted in `555a7bda`: retained snapshot module and atomic writer-registry
   move; fresh Sol/root approval, 957 suites / 14,101 tests and required checks.
   Stage 6 accepted in `c76703eb`: prepare/send/history/email recovery separated,
   unchanged facade exports and sequencing; fresh Sol/root approval, 957 suites /
   14,113 tests and required checks. Stage 7 accepted in `a9d4b0e8`: Final model/
   defaults/state/claims separated, both commands and five public names preserved;
   fresh Sol/root approval, 957 suites / 14,121 tests and required checks. Stage 8
   accepted in `588fd382` (boundary prerequisites) and `7ed52a45` (closure): AST
   import/cycle/export/writer enforcement, source headers and ownership docs; fresh
   Sol/root approval, 958 suites / 14,151 tests and required checks. All stages 0–8
   are complete locally; no migration stage remains to build. Receipts:
   `docs/plans/GOVERNED_DOCUMENT_LIFECYCLE_EXECUTION_2026-09-18.md`. PR #315 is merged as `8d3ad3a7670220f09ebd7828bfd7ea14d2ac3942`; production deployment `6535352663` succeeded at 2026-09-19T00:48:45Z. See the plan's release receipt and evidence limits before acting.

3. **Post-review hardening (2026-09-18).** Claude reviewed `5f069b32` as READY
   with three low findings. Removed four unused imports, corrected the facade/leaf
   export receipt wording, and extended boundary mutation tests for cross-domain
   imports, adapter aliases, optional/call/apply writes and hash-consumer ownership.
   [VERIFIED via local commands] Core smoke: 18 suites / 478 tests; auth routes:
   9 suites / 64 tests; full Jest: 958 suites / 14,174 tests. Lint/types pass.
   Operator smoke stages, fixtures, evidence and stop criteria are in
   `docs/plans/GOVERNED_DOCUMENT_LIFECYCLE_SMOKE_TESTS_2026-09-18.md`.
   Fresh Sol acceptance and root final review passed after one bounded correction
   round. A subsequent source-mode read-only smoke on ZZTEST-03 passed signed-in
   IA/version/Pre-Site/history/Final reads and signed-out redirects; S1 is partial.
   The subsequent read-only S1 subset and incomplete S2 rehearsal are recorded separately; bounded service reconciliation completed the restore metadata. The later guarded Pre-Site reopen and return-to-Review succeeded; the exact retry/stale/fault matrix remains unrun, while S3 passed separately and S4 was NOT RUN at that earlier run. No fresh canonical build for the earlier hardening import/test/docs follow-up; prior build evidence remains historical. The current restore fix has 4 suites / 42 tests plus a successful canonical build recorded in the execution receipt. PR #315 has been merged and deployed; no schema or migration change was included.

   A separately owner-authorized controlled rehearsal on ZZTEST-03 was stopped after two IA failures. Generation returned HTTP 500 `claude_output_truncated` (run `7d8b647c-abb3-f111-aaac-000d3a361c1f`) and created one Failed row `ea6e4768-abb3-f111-aaac-6045bd04539e`; request state, 24 pre-existing Dataverse Request Document rows and 13 distribution attempts were unchanged; the SharePoint restore effect is recorded separately. Restore selected version 1.0 from current 2.0; Graph produced stable current 3.0 with historical 1.0/2.0 retained and equal governed hashes, but the API returned `initial_assessment_restore_bytes_mismatch` before registry metadata persistence. Readback is `/tmp/wmkf-restore-readback.json`; raw package differences were limited to custom XML/properties/trash parts. No PSV, distribution prepare/send, email, Final or leadership action ran. The initial browser restore failure is historical. A bounded PATCH-only service recovery then returned `restored:false`, `reconciled:true` with one registry update and zero Graph restores; independent readback confirmed the existing IA row at version 3.0, preserved history and the same governed hash. The recovery process exited 0. This is not a global database audit, and the browser restore was not rerun; S2 remains incomplete and S3–S4 were NOT RUN at that earlier run.

   Production follow-up attributed to the Claude handoff: PR #314 merge `0b240f0a` deployed the IA thinking-budget fix, and the signed-in production rerun on request 1003222 reported PASS at 23:38Z. Run `7770d508-bab3-f111-aaac-7ced8d3c3a59` ended `end_turn` with 1,065 output tokens, `thinkingTokens=0`, and `maxTokens=12000`; Ready row `7d00fffd-b9b3-f111-aaac-000d3a361c1f` became the current IA pointer, superseding `a6876ad6-3b94-f111-8075-70a8a59cded0`, and the exact retry reused the row without a new run. Root independently verified the sanitized pointer/reconciliation readbacks: 28 Request Document rows, one new Ready row, only the prior IA lifecycle/modified fields changed among 27 prior rows, current PSV `205da1cd-b7b3-f111-aaac-6045bd04539e` unchanged in Review, Final null, and all 14 attempts unchanged. Provider tokens, stop reason and exact retry remain Claude-attributed evidence; the isolated candidate now integrates prompt v2 and has passed local validation; it has not been live-rerun.

   Follow-up smoke continuation on isolated candidate `f45581ed`: the 269-route build passed; Board snapshot returned row `dc7558c4-b2b3-f111-aaac-7ced8d3c3a59` for IA artifact `a6876ad6-3b94-f111-8075-70a8a59cded0` at v3.0 with governed hash `gdc1:yGi7ISeqZspD0PwIecM9bbGPZQhn7hJpEV_k6Qgv4Yk` and distinct item `01G4GVMS5XTETQIS3JPNEIXAKRDZPRBY35`. The earlier pre-override distribution prepare returned 503 `distribution_briefing_required`, and the earlier guarded reopen returned 503 because `GUARDED_REOPEN_SCHEMA_READY` was unset; those readbacks were unchanged.

   On accepted code `cbad8a8d`, migration 038 was verified already applied; process-only briefing readiness, `DELIBERATION_BRIEFING_PUBLIC_BASE_URL`, and impersonation configuration enabled the approved S3 rehearsal while local `NEXTAUTH_URL=http://localhost:3000` remained the staff-auth origin. Prepare passed, the first send failed closed before claim, and the same preview then returned `Sent for delivery`; Dynamics later reached status 3 with `senton` (initial status 6), the user confirmed inbox receipt on 2026-09-18; this does not infer that the user clicked the public briefing link. Request and 26 Request Document rows were unchanged; 13 prior attempts remained unchanged and total attempts became 14. S3 approved happy-path email smoke passed and inbox receipt was user-confirmed. The later PSV reopen and return-to-Review happy path passed; the exact retry/stale/fault matrix remains unrun. No AI regeneration ran. S4 Final and leadership happy paths subsequently passed on the same PSV fixture; the remaining fault matrix and wrong-app account case remain unrun/mock-only.

   S4 controlled production smoke from local candidate `aff3049d` on the approved ZZTEST-03 request passed after the PSV successor was in Review. Final row `473c9160-c0b3-f111-aaac-000d3a361c1f` was created on the same SharePoint item, group review started at `2026-09-19T00:23:51Z`, leadership at `2026-09-19T00:24:37Z`, and both transitions used the session-derived actor `29b0de0d-4ff7-ee11-a1fd-000d3a3621c7`. Exact start and leadership retries returned HTTP 200 with `reused:true` and equal DTOs. Independent reconciliation showed 28→29 Request Document rows, only the prior source lifecycle/modified fields changed plus the four expected Final leadership fields, and all 14 distribution attempts unchanged; no AI, email or SharePoint upload/copy calls were observed in the bounded dependency capture, and no schema action ran. Three Dataverse writes first rejected impersonation and then succeeded through the supported service-principal fallback; this does not claim native CreatedBy impersonation. Sanitized evidence is in `/tmp/wmkf-final-smoke-{before,group,leadership,reconciliation,graph-before,graph-after,unauth,inventory,dependency-summary}.json` and the HTTP/proxy captures. The UI showed leadership after reload, and five signed-out route checks returned 307. Final fault cases and the wrong-app account case remain unrun/mock-only.

Current fixture: IA `7d00fffd` remains unchanged; PSV `205da1cd` is now Final; current Final `473c9160` is in leadership review. Both rehearsal servers are stopped. The owner chose mock-only coverage for wrong-app access and review-bundle rebuild. Sol accepted the sanitized S4 evidence and root completed final review.

## Next Items

**Refactor release boundary:** all stages were committed on
`codex/document-lifecycle-decomposition` and promoted through PR #315. UI behavior
is intended to remain unchanged; no schema or migration change was included. The
production milestone is recorded for deployment `6535352663`. The optional
claim-evidence report could not read its local state; no observation was inferred.
The unrelated carryovers below retain their prior evidence and need fresh checks
before any live work; this release did not re-probe those unrelated carryovers.


### Verified Open

None for the released document refactor. Deployment and the agreed smoke scope
are complete; no additional implementation or release is queued.

### Unrelated carryovers — verify before scheduling

These prior-session items were not revalidated during this release and are not
an automatic worklist.

1. **Memory deep-audit remainder.** Evidence: `docs/audits/memory-routine-audit-2026-09-17.md`
   "Unknowns". Shrink `project-site-visit-materials-planning-handoff` (7.6 KB; its line 42
   "Open (plan §12)" list still names "reminder cadence", now decided). The other four
   oversize-routed leaves are accepted. `check:memory-health` is advisory and prints 7 flags:
   5 oversize-routed plus 2 accepted shadow-atlas false positives.

### Prior owner-decision carryovers — verify before acting

1. **Whether to delete the unscheduled reminder-cron code.** Evidence: commit `28d719d9`
   kept `pages/api/cron/site-visit-materials-reminders.js`, `reminder-sweep.js`, and
   `tests/unit/site-visit-materials-reminders-cron.test.js`; the owner was told this is a
   separate decision and did not ask for removal. If asked: destructive carryover, so grep
   live callers first, and expect edits to `docs/API_ROUTE_SECURITY_MATRIX.md` (line 169),
   the Atlas, plan §16.3, and `check:api-routes`.
2. **Plan §11 "Open for owner" (PR #312):** unconvertible review fails Share closed vs a
   placeholder page; Unicode reviewer names need `@pdf-lib/fontkit` + a bundled TTF;
   separator-page content; the three bundle bounds as code literals (memory
   `feedback-mutable-parameters-not-in-code`). Unchanged from S517.
3. **Plan §10.4 residual (PR #311)** and **plan §12 accepted residual (Codex round 3)**:
   unchanged from S517.
4. **Managed private-repository migration gates** (unchanged from S514). Evidence:
   `docs/MANAGED_PRIVATE_GITHUB_REPOSITORY_MIGRATION_PLAN.md`.
5. **Memory-drift report refresh.** `check:memory-drift` evaluates a committed report it
   flags as stale; `npm run refresh:memory-drift` is an authorized live refresh
   (production reads) and was not run.

### Parked

1. Plan §8 (vi) panel defaults-seed case and the To-field caret splice (plan §12 note 1);
   plan §8 remaining items; plan §12 note 3 (Administration "Guarded reopen attempts"
   shows Pre-Site only). Unchanged from S517.
2. Five protected historical branches; reviewer-institution Phase 3 flags (unchanged).
3. Router diet landing point (6.9 KiB / 51 leaves after S519 removed one line) is above
   the §10 target (~6 KiB / ~45); going further needs a norms hub page, a design choice.

### Verify Before Acting

1. ZZTEST-03 retained evidence: last verified IA `7d00fffd`, PSV `205da1cd`
   in Final, and current Final `473c9160` in leadership. Earlier failed and superseded
   IA rows and the older Board snapshot remain. Re-read authoritative state before
   any future writes; cleanup requires a new owner decision.
2. The #311/#312 conflict resolution (`dcc9c796`) and the fixture fix (`8f8cfc1b`) are
   test-verified but were never Codex-reviewed.
3. Worktree `../WMKF_Apps-codex` was left clean on `codex/parked` at `6ed14ae9` by S518;
   S519 did not touch it. Confirm before delegating to Codex.

### Do Not Reopen Without New Decision

0. **Wrong-app access and review-bundle rebuild live fixtures** are mock-only by
   the owner's explicit choice. Do not solicit a third review or another staff
   account as unfinished work for this release.

1. **Applicant-materials reminder cron is retired** (owner, 2026-09-17). Staff monitor
   arrivals manually. Do not add `/api/cron/site-visit-materials-reminders` to
   `vercel.json`. Recorded in plan §16.6 item 1 and the closed memory leaf.
2. **Cycle Dossier drain cadence is `*/5 * * * *`** (owner, 2026-09-16). Recorded in
   `docs/CYCLE_DOSSIER_PILOT_DESIGN.md`. Do not reopen Vercel Workflow or alternatives.
3. Ops-meeting items 2–6 (plan §16.6). Item 3's guard exists since S507 `90641978`.
4. Owner decisions B1–B14 in the Pre-RP Brief plan; Word snapshot identity is the
   governed content hash; confirmed sends render only **Sent for delivery.**

## Key Files Reference

| File | Purpose |
|---|---|
| `docs/J27_TRANSITION_REGISTER.md` | Lines 97, 101, 111, 113 carry the repaired J27 citations |
| `.claude-memory/project-reviewer-apps-redesign-history.md` | Authoritative historical excerpts for J27-053, -057, -062, and -064 |
| `docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md` §16.6 | Reminder-cron retirement decision, item 1 |
| `.claude-memory/project-ops-meeting-2026-09-16-agenda.md` | Closed ops-meeting record, all items decided |
| `pages/api/cron/site-visit-materials-reminders.js` | Built, unscheduled, header records the retirement |
| `vercel.json` | Crons; the reminder route is intentionally absent |
| `docs/audits/memory-routine-audit-2026-09-17.md` | S518 audit note with the remaining unknowns |

## Testing

```bash
npm run check:j27-register           # 61 ok / 0 stale / 6 unverifiable / 11 closed
npm test -- --runInBand --silent
npm run lint
npm run check:memory-router && npm run check:memory-router:self-test
npm run check:memory-health          # advisory; expect 7 flags (5 oversize-routed, 2 accepted shadow-atlas)
```

Session 519: all `check:*` gates green at start except `check:j27-register` (pre-existing,
caused by the S518 leaf split); touched-surface gates green at the one commit.
`report:claim-evidence-pilot -- --current` recorded no eligible plan/design edit; no
observation row added.
