# Session 562 Prompt: Factory admin form slice 2 (routes); office Mac sync when back at work

## Session 561 Summary — 2026-10-01 (Fable orchestrating; Sonnet build, Opus/Fable/Codex reviews; home Mac)

The Test Request Factory admin form went from "parked P7 sketch" to an accepted plan and a merged first slice in one session. The owner answered eleven design decisions; the plan survived three Codex adversarial rounds, two Fable reviews and `/contract-reconcile`; slice 1 (server plumbing, no routes or UI) was built by Sonnet, reviewed by Opus, fixed by Fable, passed two Codex adversarial rounds, and merged as PR #395 (`6b9478d44`). Separately, the "Email is disabled for test requests" refusal on test Request 1003302 was diagnosed (the early email guard never passed recipients to the allowlist), handed to Codex with a brief, and merged by the owner as PR #392. Factory plan docs were brought current, and the Codex default model is now `gpt-6-astra` at medium. All 68 start-of-session gate runs were green.

### What Was Completed

1. **Factory docs brought current** (`0cfc9726f`). The production plan now records MVP items 1–5 merged (PRs #349–#352, #354); the design doc lists the three production runs (1003301 stopped at verify, 1003302 and 1003303 `ready`); Codex's B4 promotion record and plan updates were carried from `codex/factory-reviewer-b4-runtime` to `main` (its lane `SESSION_PROMPT.md` left behind).
2. **Admin form plan** `docs/plans/TEST_REQUEST_FACTORY_ADMIN_FORM_PLAN_2026-10-01.md`: drafted by Fable (`fba7da66b`); owner decisions 1–9 recorded, status setter moved into v1 (`b763e3d8f`); Codex (Astra, medium) rounds 1–3 each needs-attention and revised (`ddeba4e43`, `cf1ae1df7`, `080715c69`); decisions 10 (a: branch-scoped Preview rehearsal) and 11 (deploy-time kill switch; rollback is the instant stop) recorded; Fable review → Codex-rescue fixes → Fable re-review "ready" (`5cee05b2f`, `1cebefae8`, `5ee5b2257`); `/contract-reconcile` READY WITH NAMED CHANGES, seven build requirements written into the plan (`7a95313f4`).
3. **Slice 1 built and merged** (PR #395, `6b9478d44`): `admin-run-identity.js` (UUIDv5 actor and ids, `targetFromDeployment`), `factory-artifact-store.js` (private Blob, create-only, capped digest-checked reads, daily sweep), `admin-run-service.js` (export/confirm/advance/list/inspect/artifacts/recheck), `buildCloneManifest` optional ids, `pgLedgerDb` pool options, `vercelPostgresLedgerDb` deleted, `factoryFormEnabled`, tracked secret `factory_blob_rw_token`, DAL-gate exemption, maintenance-cron sweep task, `scripts/factory-artifacts-download.mjs`. 1,996 unit tests; slice gates green. Review chain: Opus approve (P2s fixed by Fable: `createRequire` loader, typed number on retry, manifest pre-size, sweep scan 1000 / delete 200 caps); Codex round 1 one HIGH (document discovery went through the deployment's `DYNAMICS_URL`, not the production client, so a Preview export would silently omit documents — fixed with `getLocations`/`resolveLocationParents`, mutation-tested); Codex round 2 approve. Brief: `docs/plans/briefs/FACTORY_ADMIN_FORM_SLICE1_BRIEF_2026-10-01.md`.
4. **Test-request email fix** (Codex, merged by owner as PR #392 `fix: pass test-request email recipients to early allowlist checks`). Cause: `assertRequestEmailAllowed` applies the S546 allowlist rule only when given `recipients`, and all four callers (materials create/invite/remind, grantee invite) called it bare since Stage 1b. Brief: `docs/plans/briefs/TEST_REQUEST_EMAIL_RECIPIENTS_BRIEF_2026-10-01.md` (on that branch). **Not yet verified in the browser.**
5. **Codex default model**: `~/.codex/config.toml` now `gpt-6-astra` / `medium` (owner-authorized); memory `feedback-codex-model-gpt56-sol.md` leads with the new rule (`6b4cd2b5c`). Astra is accepted on ChatGPT OAuth.

### Commits (main)
- `0cfc9726f` docs(factory): bring current status to the Factory plans; land B4 promotion record
- `fba7da66b`, `b763e3d8f`, `ddeba4e43`, `cf1ae1df7`, `080715c69`, `5cee05b2f`, `1cebefae8`, `5ee5b2257`, `7a95313f4` — admin form plan through contract-reconcile
- `6b4cd2b5c` memory: Codex default is gpt-6-astra at medium
- `6b9478d44` Merge PR #395 (slice 1); PR #392 merged by owner (email recipients)
- Parallel Codex merges on `main` today: #389, #393, #394.

## Next Items

### Verified Open

1. **Slice 2: routes + matrix rows** (plan slice table; estimate 1 session). Owner directive: Fable orchestrates, Sonnet builds and reconnoiters, Opus reviews, Fable final review, Codex adversarial to satisfaction; no tail-chasing. Build-brief must carry: (a) `next.config.js` `outputFileTracingIncludes` entries for `lib/db/ledger-schema-fingerprint.json` and `ledger-schema-ahead.json` on the reserve route, since `ledgerSchemaCheck` reads them from `process.cwd()` [VERIFIED S561 recon, `ledger-schema.js:35-36`]; (b) contract-reconcile items 3 (director email from `session.user.azureEmail`, never the body), 5 (bump `docs/CANONICAL_COUNTS.md` `api-route-file-count` 241 → +new route files; Atlas rows for `test_request_status_changes` second writer and the Factory Blob store), 6 (GUID-validate `runId`/`draftId`/`changeId` at the route; require a label), 7 (UI stale-run guard belongs to slice 3); (c) **never run `npm run check:factory-ledger` during a build** — it connects to the live managed ledgers (Sonnet did this in slice 1 by mistake; read-only, names only, but against the no-live-systems rule).
   Evidence: plan `## Slices, build order, verification`; `## Contract-reconcile`; slice 1 PR #395 body.
2. **Verify the email fix in the browser on 1003303** (cast-bound; PI/Liaison are synthetic allowlisted addresses). Request site-visit materials from Meeting Tracker. 1003302 will still be refused by design: it is not cast-bound (owner S548 #4), so its real PI/Liaison are not allowlisted; the message should now name the recipient, not "Email is disabled". Then the read-only review of PR #392's diff that was promised and not done (merged before review).
   Evidence: PR #392 merged 2026-10-01T20:54Z; `lib/services/test-requests/request-test-state.js:71-96`.
3. **Office Mac: run `docs/plans/briefs/OFFICE_MAC_SYNC_BRIEF_2026-10-01.md` first thing at the office** (owner there next week). Unchanged from S560. Record the `--run-inspect` result (`managed-ledger/ledger_prod`) in the ledger evidence file.
4. **Worktree hygiene** (home Mac): `/Users/gallivan/Code/WMKF_Apps-factory-form` (branch `claude/factory-admin-form-slice1`, merged) and `/Users/gallivan/Code/WMKF_Apps-codex-email` (branch `codex/test-request-email-recipients`, merged) can be removed with `git worktree remove`; both branches are fully on `origin`. Reuse `-factory-form` for slice 2 if preferred (`git -C <path> fetch origin && git -C <path> checkout -B claude/factory-admin-form-slice2 origin/main`).

### Owner Decision Needed

1. **Before slice 3 (Preview rehearsal), owner provisions:** a Preview Blob store + `FACTORY_BLOB_RW_TOKEN`, `TEST_REQUEST_SANDBOX_LEDGER_URL`, `TEST_REQUEST_FACTORY_FORM=on`, and the branch-scoped `DATAVERSE_ALLOW_PROD_READS=yes` (decision 10a); before slice 4, the Production store + token and `TEST_REQUEST_LEDGER_URL` (decision 1). Nothing needed for slice 2.
2. **D2: retire the home Mac's local ledger copies** (`wmkf-ledger-pg/ledger_prod`, `/ledger`) and the scratch DBs `ledger_ci_s547`, `ledger_ci_s548`, `ledger_test`. Deferred (S560) until the office Mac is set up. Destructive: list and confirm first.

### Parked

1. Deeper recipes, slice 5a, late-2026 `expiresAt` fixtures, cast ledger reset path, AkoyaGO TEST Factory Reviewer search, Liaison follow-ups, the Dataverse "Integrity review complete" flag. Unchanged since S553.
2. Postgres in `lib/utils/tracked-secrets.js`: not tracked (runbook step 6).
3. **First live Part B send:** waits for whichever real reminder sends next.
4. Form v2: status-setter `rerun`, bind-reviewer, slot PATCH, retire (decision 7).

### Verify Before Acting

1. **Factory test Requests 1003301–1003303 are NOT residue:** tracked runs in `managed-ledger/ledger_prod` (verified S559). Do not delete as cleanup.
2. **Blob overwrite-refusal wording is UNVERIFIED:** `factory-artifact-store.js putCreateOnly` matches `/already exists/i` because @vercel/blob 2.6.1 attaches no error code. The slice 3 rehearsal must plant an object at a run path, retry Confirm, and record the real message (a miss gives a raw error, never a wrong write).
3. **Slice 1 is not deployable on its own** (no routes; `ledgerSchemaCheck` fingerprint files untraced). The merge deployed inert code: the cron sweep skips when `TEST_REQUEST_LEDGER_URL`/`FACTORY_BLOB_RW_TOKEN` are unset (tested). Production deployment of `6b9478d44`: see the line under *Testing*.

### Do Not Reopen Without New Decision

1. Admin form decisions 1–11 (owner, S561; plan `## Owner decisions`): ledger URL in Vercel; kill switch + typed confirmation; private Blob store, ready-run cleanup; P4 closed; v1 scope incl. status setter; defer bind/slot/retire; Tier 2; delete `vercelPostgresLedgerDb`; rehearsal (a) branch-scoped; deploy-time kill switch.
2. Slice-1 scope decisions (owner, S561): CLI-made runs (`cli:` actors) are invisible to the form in v1; the sweep skips quietly when unconfigured; slice 1 touched no live systems.
3. Status-setter contract change (plan): one PATCH per change, no automatic redispatch for CLI or form, owner `--status-abandon` for `dispatched` only, producing replays need CLI `--rerun`.
4. 058 on the app DB (applied); Sensitive option A; Part B decisions B-1/B-2/B-3; the 1003220 reminder stopped (S560); Neon protection app `main` only; refactor-survey items are Codex's; DOCX/VTT incident closed (S558).

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/plans/TEST_REQUEST_FACTORY_ADMIN_FORM_PLAN_2026-10-01.md` | Admin form plan: decisions, Codex rounds, contract-reconcile, slices |
| `docs/plans/briefs/FACTORY_ADMIN_FORM_SLICE1_BRIEF_2026-10-01.md` | Slice 1 build brief (template for slice 2) |
| `lib/services/test-requests/admin-run-service.js` | The form's service: export/confirm/advance/list/inspect/artifacts/recheck |
| `lib/services/test-requests/factory-artifact-store.js` | Private Blob store + daily sweep |
| `lib/services/test-requests/admin-run-identity.js` | Actor and id derivation, `targetFromDeployment` |
| `scripts/factory-artifacts-download.mjs` | Owner-run CLI fallback for a run's manifest and bundle |
| `docs/plans/briefs/OFFICE_MAC_SYNC_BRIEF_2026-10-01.md` | Office Mac env sync + ledger check |
| `docs/AGENT_ADJACENT_VERIFICATION_PILOT_DIRECTIVE.md` | Pilot observation table (S561 row added) |

## Testing

```bash
npx jest --testPathPatterns "test-request|ledger|maintenance"     # 80 suites, 1996 tests (3 .pg suites skip without TEST_REQUEST_LEDGER_TEST_URL)
npm run check:dataverse-access-layer && npm run check:dataverse-access-layer:self-test
npm run check:api-routes && npm run check:api-routes:self-test     # slice 2 adds matrix rows
npm run check:factory-ledger -- --allow-unreachable                # session start only; never inside a build
```

Production deployment of merge `6b9478d44`: [VERIFIED via `gh api …/commits/6b9478d44/statuses` → Vercel deployment `dpl_DyystUaYAbp33mKK36tHyLBgv7ab`, and `vercel inspect` of that deployment → status Ready, target production, url `wmkfresearchapps-g02951hdc`, created 2026-10-01 16:08 PT] The serving production build is the slice-1 merge.

Production reads: the auto-mode classifier blocks agent reads of the Production app DB. Write a read-only script to the scratchpad that prints no addresses, bodies or URLs, and have the owner run it with `!`. Load packages via `createRequire('<repo>/package.json')` and env via `process.loadEnvFile` (`dotenv` is not installed).

Prior handoff (S560 detail): `8a050bb4b:SESSION_PROMPT.md` and earlier in Git history.
