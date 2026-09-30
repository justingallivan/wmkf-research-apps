# Test Request Factory ledger: portability and single source of truth

Status: **MERGED, revision 7 (2026-09-30, S553). D1 and D3 decided; the managed ledger exists with 054 + 058 applied. Phase 2 items 1–2 and Phase 3 items 1–2 built on branch `claude/factory-ledger-registry` and merged to `main` as PR #374 (`66dd0974b`, 2026-09-30) after B4 PR #369; verified live against both Neon ledgers. The first Codex adversarial round (5 high, 2 medium) came back NO-SHIP and every finding but #5 (the B4 merge-conflict note, left for the orchestrator) is now fixed on the same branch — see "Codex round 1" below. The second Codex round (5 high, 2 medium) found real holes in the round-1 fixes; all but #5 are fixed on the branch (see "Codex round 2"), #5 is adjudicated below. The third Codex round (5 high, 2 medium, all new surfaces) is answered in full on the branch (owner decision: address all seven; see "Codex round 3"). The fourth Codex round found three defects; all three are fixed and live-Postgres-tested on this branch — see "Codex round 4 fixes" below. Phase 1 (tonight's dump/restore) and Phase 2 item 3 (restore into Neon, then retire local) follow the brief. D2 open.**

## Problem

The Factory's operational state for production test Requests (cast members, cast bindings, run journal, status changes) lives in `ledger_prod`, a Postgres database inside the `wmkf-ledger-pg` Docker container on the home Mac. It was built by hand (`psql -f` of an in-place-edited 054, then explicit `ALTER TABLE`s), it has never been dumped, and nothing on the office Mac can reach it [VERIFIED 2026-09-30: this Mac's container holds only a stale `ledger` with the two original 054 tables and no `ledger_prod`].

That placement was deliberate. Rule P6 of the production plan and the CLI guard `requireLedgerUrl` (`scripts/rehearse-test-request-sandbox.mjs:749-760`) forbid running ledger-driven modes against the app's shared database, by refusing any `TEST_REQUEST_LEDGER_URL` that equals a configured `POSTGRES_URL*`/`DATABASE_URL` or names a `neon.tech` host. The guard has no positive notion of where the ledger *should* be, so the only place that satisfied it was a laptop.

Consequences today:

1. Any owner-run Factory step, and every B4 readiness check that reads `test_request_cast_members`, is impossible away from the home Mac.
2. A disk failure or a Colima reset (which already deleted the container once, S538) loses the production cast's GUID-to-digest record. A rebuilt ledger would let a clone re-create contacts that already exist in production.
3. Two ledgers (`ledger_prod`, `ledger`) plus each machine's copies drift in schema silently: 054 was edited in place at least three times (S547 status changes, S548 cast tables, S548 role check) and applied by hand each time; nothing verifies a ledger matches the migration files before a command runs.
4. Session handoffs record *what* was run but not *which ledger* held the result (the cast plan itself notes the 1003303 ledger is unrecorded).

## Goal

One operational ledger, reachable from every machine the owner works on, still never the app's database, with its schema verified by tooling before any command touches it, and a recovery path that does not depend on one laptop.

## Owner decisions

- **D1 — Where the ledger lives: DECIDED (owner, 2026-09-30, S553).** Neon project `wmkf-factory-ledger`, created through the Vercel Marketplace (Neon is managed under Vercel; there is no separate Neon account), **not connected to any Vercel project**, region AWS US East 1 (the app database is us-west-2; accepted for owner-run tooling), Launch plan. Databases `ledger_prod` and `ledger` on branch `main`, default `_owner` role. Migrations 054 (`main`) and 058 (`origin/codex/factory-reviewer-b4-runtime`) applied to both by the session, in that order, on 2026-09-30 [VERIFIED: seven `test_request_*` tables and `test_request_receipt_ok` present in each]. Connection strings live only in each Mac's `.env.local` as `TEST_REQUEST_LEDGER_URL` (ledger_prod) and `TEST_REQUEST_SANDBOX_LEDGER_URL` (ledger).
- **D2 — Local Docker ledgers after the move.** Recommendation: keep the container for the live-Postgres test suites only (`TEST_REQUEST_LEDGER_TEST_URL`); retire `ledger_prod` locally once the managed copy is verified and one dump is archived.
- **D3 — Interim transport: DECIDED (owner, 2026-09-30, S553).** Dumps are written directly to the owner's shared documents folder, which both Macs reach, unencrypted. The owner accepts that posture for these files (production Request and contact GUIDs, address digests, journal JSON; no credentials). Digests are compared on both sides before a restore.

## Phases

### Phase 0 — Today, office (no ledger access needed; ~1 h)

1. **Codex on B4:** every checklist step that needs `ledger_prod` or `ledger` is recorded as *blocked: ledger not on this machine*, not improvised against the stale local `ledger`. Everything else on the B4 checklist proceeds.
2. **Snapshot helper (Tier 0 script, this plan's first build item):** `scripts/factory-ledger-snapshot.sh dump|restore --db=ledger_prod|ledger --file=<path>`. `dump` runs `pg_dump -Fc` inside `wmkf-ledger-pg`, writes the file, prints its SHA-256 and the row counts of every `test_request_*` table. `dump` writes to the path given (the shared folder under D3). `restore` creates the database when it is absent (this Mac has no `ledger_prod`), refuses if the target already has rows unless `--replace` is passed (which drops and recreates it; the office `ledger` needs this because of residue), then `pg_restore`s and prints the same counts so the two sides can be compared. No credentials in output.
3. **Ledger identity in handoffs — DONE (S553):** the `/stop` skill now requires any handoff or evidence line that records a Factory run, cast change or status change to name the ledger (registry host label plus database) beside the run id.

### Phase 1 — Tonight, home Mac (~20 min)

Step-by-step brief for the agent on each machine: `docs/plans/briefs/FACTORY_LEDGER_SNAPSHOT_BRIEF_2026-09-30.md`.

1. `dump` both `ledger_prod` and `ledger` with the helper; keep the printed digests and counts in `docs/plans/evidence/test-request-factory/ledger-snapshot-2026-09-30.md` (digests and counts only, never the dump).
2. Wait for the shared folder to sync; the office side compares digests before restoring.
3. Next office morning: compare digests, `restore` both here (`createdb` for the absent `ledger_prod`, `--replace` for the residue-laden `ledger`); compare counts to the evidence file; record the restore in the same evidence file. Codex's blocked B4 steps become runnable.

This is the stopgap. It is manual in both directions and must be repeated after every home-Mac Factory command until Phase 2 lands, so the evidence file must say which copy is current.

### Phase 2 — Managed ledger (after D1; ~half a day plus review)

**Options considered**

| Option | Reachable from both Macs | Satisfies "never the app database" | Guard change | Cost |
|---|---|---|---|---|
| A. Second Neon project, own credentials | yes | yes (different project, host and role) | replace the `neon.tech` blanket refusal with a tracked host allowlist | free tier [ASSUMED; verify current Neon pricing before D1] |
| B. Non-Neon managed Postgres (Supabase, Railway, Fly) | yes | yes | allowlist as in A | free or low tier [ASSUMED]; a second vendor to run |
| C. Keep local, automate dump/restore via cloud folder | partly (restore lag, two-way conflicts) | yes | none | zero, but the drift and loss risks stay |
| D. Schema in the shared database under a separate schema name | yes | **no** (P6; the CLI would have to be taught to accept a shared URL) | large | rejected |

**Recommendation: A.** Same operational knowledge as today's Neon, one console, branchable for rehearsal, and the isolation P6 wants is by project rather than by laptop.

**Build items for A**

1. **BUILT (S553); hardened Codex round 1 Fix 1 (S553):** `lib/db/ledger-registry.js` (outside Codex's B4 surface, beside the migrations it governs): the managed pooled hostname labelled `managed-ledger`, plus `localhost`/`127.0.0.1`/`::1` labelled `local`; the direct non-pooler host is deliberately unregistered until verified. `classifyLedgerUrl` now validates the EFFECTIVE connection destination via `pg-connection-string` (the same parser `pg.Client` uses), not the URL's `new URL()` authority text: it refuses any `host`/`hostaddr`/`port`/`dbname`/`user`/`password`/`options`/`service`/`uselibpqcompat` query override outright, refuses socket destinations, requires port 5432-or-unset on the managed host, and compares shared-URL refusal on the canonical `{host, port, database, user}` tuple as well as raw-string equality. Both ledger databases share the managed host, so `requireLedgerUrl(target)` requires: URL set; not equal (canonically) to any configured shared URL; hostname in the registry; and on the managed host the database `ledger_prod` for `--target=production`, `ledger` otherwise (local hosts keep their names). The `neon.tech` regex is gone. Verified live: production ledger passes for production and is refused for sandbox, the app's `POSTGRES_URL` is refused as shared.
2. `TEST_REQUEST_LEDGER_URL` (production ledger) and `TEST_REQUEST_SANDBOX_LEDGER_URL` (sandbox) documented in `docs/CREDENTIALS_RUNBOOK.md` (which does not mention `TEST_REQUEST_LEDGER_URL` today [VERIFIED 2026-09-30 by grep]) and `lib/utils/tracked-secrets.js`, stored in each machine's `.env.local` only, never in Vercel. Rotation procedure: Neon console reset, update both Macs, same as the office sync done in S553.
3. Migrate: restore the Phase 1 dump into the new project (the brief's Neon section; `--clean --no-owner` then re-apply 058 for parity), run the Phase 3 schema check, then run one read-only `--run-inspect` against it from each Mac once the registry admits the host. Only then retire the local `ledger_prod` (D2).
4. Update the cast plan §6 and the B4 release checklist to name the managed ledger instead of "local `ledger_prod` and `ledger`"; update the Atlas ledger page header.
5. **Review:** the registry and the new `requireLedgerUrl` loosen a fence that went through Codex review, so they get one Codex adversarial round before merge, on their own Tier 1 branch (CLI and scripts only, no app runtime).

### Phase 3 — Schema verification (with or after Phase 2; ~half a day)

The in-place edits to 054 are the drift source. Two build items:

1. **BUILT (S553); hardened Codex round 1 Fix 3 (S553):** `scripts/apply-ledger-migrations.js --url-env=<VARIABLE NAME>` (`npm run ledger:apply -- --url-env=TEST_REQUEST_LEDGER_URL`) applies every `test_request_*` migration file in the checkout with a `ledger_schema_migrations` tracker inside the ledger (now including a `sha256` column), refusing any URL the registry rejects. It takes the variable name, never the URL. Per file it now decides one of skip / apply / adopt / refuse (`lib/db/ledger-migrations.js` `decideFileAction`, pure and unit-tested): a tracked file whose current checksum no longer matches refuses ("write a forward migration instead"); an untracked file whose objects already exist live is only recorded ("adopted") if applying the checkout's files up to and including it into a scratch schema produces a clean semantic comparison against the live ledger — otherwise it refuses with the diff. This replaces the earlier "054/058 are idempotent so blind re-apply is safe" reasoning, which a real stale/partial hand-applied local shape (found while testing this fix) demonstrated was not safe in general. `--accept-tracked-checksums` run once against each real Neon ledger on 2026-09-30 after confirming 054 had not changed since they were provisioned.
2. **BUILT (S553); hardened Codex round 1 Fix 2 and Fix 4 (S553):** `lib/db/ledger-schema.js` now reads a *semantic* fingerprint — column defaults (`pg_get_expr`), full constraint/index/trigger definitions (`pg_get_constraintdef`/`pg_get_indexdef`/`pg_get_triggerdef`), index uniqueness/primary flags, and function return type/language/volatility/body-hash — not just names and types, which let same-named objects (a CHECK body, a partial-index predicate) drift silently. One `canonicalizeDefinition(text, schemaName)` strips self-schema-qualification and collapses whitespace before comparison; regenerating on local Postgres 16 and diffing against both real Neon (Postgres 18) ledgers needed zero canonicalization rules beyond that — 054's definitions print identically on 16 and 18. MISSING and DIFFERING fail; EXTRA is checked against the new tracked `lib/db/ledger-schema-ahead.json` approved-ahead list — a table named there (currently just B4's `test_request_cast_slot_bindings`) warns only if its live shape compares clean against the tracked fingerprint entry (a name-only match with a different shape is NOT approved; Opus round-1 item 6), anything else fails too. **When 058 lands on `main`, regenerate the fingerprint AND empty `approvedAhead`** — a stale shape entry would otherwise keep excusing a future extra object sharing that table name. `tests/integration/factory-ledger-fingerprint.pg.test.js` (CI ledger job) proves the tracked file equals the migration files applied to an empty schema and adds mutation cases (a CHECK body, a default, a partial-index predicate, index uniqueness, a function body, each under a stable name) proving the comparison catches same-named drift, plus a historical-upgrade case proving an older hand-built 054 shape refuses to adopt; it fails with the regenerate command (`scripts/check-factory-ledger.js --write-expected`) whenever a ledger migration changes; **whichever of PR #369 and this branch lands second regenerates it.** `npm run check:factory-ledger -- --allow-unreachable` checks every configured ledger against its mapped target, prints `skipped` when none is set, retries an unreachable ledger 3 times before counting it (not failing, with the flag), and never prints a passing summary for zero inspected ledgers; `/start` runs it. The CLI runs the same comparison before every ledger-driven mode; MISSING/DIFFERING always block (the earlier `--strict-ledger-check` opt-in default is gone) except the read-only `--ledger-check` diagnostic, which never throws.

### Phase 4 — Durable facts and hygiene (~1 h)

1. Atlas `docs/atlas/postgres-test-request-runs.md`: ledger location, registry, fingerprint check, dump procedure.
2. `docs/agent-wiki/topics/dev-environment.md` and `.claude-memory/project-local-docker-is-colima.md`: the container is for tests; the operational ledger is managed.
3. Make `tests/integration/test-request-run-ledger.pg.test.js` and `test-request-run-runner.pg.test.js` schema-scoped like the newer suites, so residue in a local `ledger` database cannot fail them (they fail on this Mac today for that reason while passing in CI). Not done in S553.
4. Memory entry: *feedback-operational-state-must-be-reachable-from-every-workstation* — any owner-run tool that keeps durable state must name where that state lives, and the location must not be one machine.


**Staleness acknowledgements (S553, after the Opus round-1 fix-up commits c8eeb59d9..146aaa962; each on one line for the Stop hook):**
- [RECHECKED after scripts/rehearse-test-request-sandbox.mjs change: requireLedgerUrl now throws on a missing target and any non-ok verdict, every ledger-driven dispatch calls ledgerSchemaCheck with a mode; tests/unit/test-request-sandbox-clone.test.js bounds each block]
- [RECHECKED after lib/db/ledger-registry.js change: LEDGER_VAR_TARGETS/targetForLedgerVar added; pg PGHOST/PGPORT/PGDATABASE fallback documented in the header; tests/unit/ledger-registry.test.js]
- [RECHECKED after scripts/apply-ledger-migrations.js change: target-bound by variable name; --dry-run executes no DDL and tolerates an absent tracker or sha256 column]
- [RECHECKED after scripts/check-factory-ledger.js change: refused URLs counted separately from inspected; final line is N inspected, R refused, M unreachable, K skipped]
- [RECHECKED after lib/db/ledger-schema.js change: unapprovedExtras approves an extra table only when its live fingerprint compares clean against lib/db/ledger-schema-ahead.json; isolated field mutations covered in tests/unit/ledger-schema.test.js]

## Order and dependencies

Phase 0 → Phase 1 (tonight) → D1 → Phase 2 and Phase 3 in parallel on separate branches (Tier 1: CLI and scripts only, no app runtime) → Phase 4. B4's ledger-dependent checks can run on the restored local copy after Phase 1; they do not wait for Phase 2.

## Risks

- **Two live copies during Phase 1.** Mitigated by the evidence file naming the current copy and by the restore helper refusing a populated target without `--replace`.
- **Allowlist mistakes.** A wrong host in the registry is a reviewed commit; the shared-URL equality refusal stays as a second fence.
- **Managed-tier compute suspension** [ASSUMED for Neon's free tier] may pause an idle project so the first command of a session takes a few seconds. Acceptable for owner-run tooling.

## Not in scope

The P7 admin form and the "Q2 shared ledger" it needs are unchanged; if P7 ever lands, its ledger is the managed one from Phase 2, not the app database.

## Codex round 1 (2026-09-30, S553)

The first Codex adversarial review of this branch (`codex-review-round1.md`, NO-SHIP) found 5 high and 2 medium findings against the built Phase 2/3 items. All but #5 were fixed on the same branch, each as its own commit:

1. **High — the allowlist validated the URL's authority text, not node-postgres's actual destination.** A `?host=`/`?port=`/`?dbname=`/`?user=` query override, or a `?host=%2Ftmp` socket redirect, could point the real connection somewhere the registry never saw; local canonicalization (reordered query params) also defeated the shared-URL refusal. Fixed: `classifyLedgerUrl` now parses with `pg-connection-string` (the driver's own parser) and refuses any of those override keys outright, refuses socket destinations, requires port 5432-or-unset on the managed host, and compares shared-URL refusal on the canonical tuple.
2. **High — the fingerprint omitted the semantic definitions that actually drifted.** Column defaults, CHECK/FK bodies, index predicates/uniqueness, function bodies and triggers were not read at all, so a same-named object could change shape silently (054's own git history shows exactly this). Fixed: the fingerprint now reads and compares all of them via one canonicalization function; mutation tests prove each class is caught.
3. **High — the filename-only tracker could permanently baseline a stale hand-built schema.** `CREATE TABLE IF NOT EXISTS` silently preserves an older table; recording only the filename meant future runs would skip it forever. Fixed: per-file checksums, a pure decide-then-act function, and a scratch-schema semantic comparison before any untracked/pre-existing objects are "adopted" rather than blindly recorded.
4. **High — ledger-driven writes proceeded past detected schema differences by default, and every EXTRA object was treated as equivalent to B4's known 058.** Fixed: MISSING/DIFFERING always block now (no more strict opt-in); EXTRA objects are checked against a new tracked approved-ahead list (`lib/db/ledger-schema-ahead.json`), and an unapproved extra blocks write modes.
5. **High — the pending B4 merge can reintroduce the no-target guard on a production write path.** Not this branch's work — left for the orchestrator to resolve as part of the B4 merge conflict.
6. **Medium — the configured-ledger gate could print `factory-ledger OK` without reaching or correctly identifying either ledger.** Fixed: each variable maps to its expected target/database, an unreachable ledger retries before failing (or is counted separately with `--allow-unreachable`), and the final line always states how many ledgers were actually inspected.
7. **Medium — the documented sandbox ledger variable was never selected by the CLI.** `requireLedgerUrl` always read `TEST_REQUEST_LEDGER_URL` regardless of `--target`. Fixed: `selectLedgerVariable(target, env)` picks the variable from the target, with a single-variable local fallback.

Verified against both real Neon ledgers after all fixes: `npm run check:factory-ledger -- --allow-unreachable` and `node scripts/rehearse-test-request-sandbox.mjs --ledger-check --target=production|sandbox` report `matches (extra objects all approved-ahead)`, exit 0.

## Codex round 2 (2026-09-30, S553; NO-SHIP at 36070b0e3, fixed in 32fbbb8b5..df8f1d977)

1. **Ambient `PG*` variables bypassed the effective-destination check (high) — fixed.** `buildLedgerClientConfig(url)` in `lib/db/ledger-registry.js` builds an explicit pg config (host, port, database, user, password, ssl) from the parsed URL only, so `PGHOST`/`PGPORT`/`PGUSER`/`PGDATABASE` can never fill a field; `pgLedgerDb` (`lib/services/test-requests/run-ledger-db.js`) routes every string through it. `options` is deliberately left unset: Neon's pooled endpoint rejects any `options` startup parameter outright [VERIFIED live 2026-09-30: "unsupported startup parameter in options: search_path"], which also means an ambient `PGOPTIONS` fails the connection before any query. `assertLedgerConnectionIdentity` then checks `current_database()`, `current_schema() = 'public'` and `inet_server_port()` after connecting (port compared on managed hosts, where both Neon ledgers report 5432; skipped for `local`, whose Docker port mapping differs from the container-internal port).
2. **Whitespace/schema canonicalization inside SQL literals hid real differences (high) — fixed.** `canonicalizeDefinition` is now literal-aware (`tokenizeSqlLiterals`: `'...'` with `''` escapes and `$$`/`$tag$` blocks stay byte-exact; schema stripping and whitespace collapse apply only to code). The regenerated fingerprint is byte-identical to the previous one and both Neon ledgers still match.
3. **Approved-ahead accepted supersets (high) — fixed.** An approved table must compare with no missing, differing OR extra objects.
4. **Adoption ignored extras (high) — fixed.** `decideFileAction` refuses on any scratch-diff extra unless it is exactly shape-approved via `lib/db/ledger-schema-ahead.json`; the unit fixture that had encoded the bug was corrected.
5. **B4 merge conflict still carries a no-target, no-check path (high) — ADJUDICATED, not fixed here.** The conflicting block lives in Codex's B4 surface and cannot be resolved on this branch. Executable safeguard on this branch: `requireLedgerUrl` throws on a missing target and on any non-ok verdict (`tests/unit/ledger-guard.test.js`), so B4's no-argument call fails closed at runtime until its conflict resolution adds `args.target` and `ledgerSchemaCheck` (PR #369 carries the instruction). Accepted residual: a resolver who also deletes the check would need to defeat the block-bound literal test.
6. **`--dry-run` still ran scratch DDL inside a rolled-back transaction (medium) — fixed.** A dry run issues SELECTs only and prints `[would need adoption analysis]` for an untracked file whose objects exist live; a recording-client test proves no BEGIN/CREATE/ALTER/DROP/SET is sent.
7. **Guard tests were literal-source only (medium) — fixed.** `requireLedgerUrl` and `ledgerSchemaCheck` moved to `lib/db/ledger-guard.js` (injectable env/db/expected/ahead) and `tests/unit/ledger-guard.test.js` executes them; deleting each throw fails 1, 14 and 7 tests respectively [VERIFIED by the builder and independently by the orchestrator].

**Staleness acknowledgements (round 2, one line each):**
- [RECHECKED after lib/db/ledger-registry.js change: buildLedgerClientConfig and assertLedgerConnectionIdentity added; classification unchanged]
- [RECHECKED after lib/db/ledger-schema.js change: literal-aware canonicalizeDefinition; approved-table comparison requires no extras]
- [RECHECKED after scripts/apply-ledger-migrations.js change: explicit client config; --dry-run is SELECT-only]
- [RECHECKED after scripts/check-factory-ledger.js change: explicit client config and post-connect identity check]
- [RECHECKED after scripts/rehearse-test-request-sandbox.mjs change: guard and schema check now imported from lib/db/ledger-guard.js; dispatch unchanged]
- [RECHECKED after lib/services/test-requests/run-ledger-db.js change: pgLedgerDb accepts a string or config and routes strings through buildLedgerClientConfig]
- [RECHECKED after lib/db/ledger-migrations.js change: decideFileAction refuses any scratch-diff extra unless exactly shape-approved via ledger-schema-ahead.json; tests/unit/apply-ledger-migrations.test.js]

## Opus round 2 (2026-09-30, S553; APPROVE, four lows)

Opus re-checked commits 32fbbb8b5..df8f1d977 read-only and approved. Lows and their disposition:
1. **Identity-check wiring untested — fixed by the orchestrator:** `tests/unit/apply-ledger-migrations.test.js` now runs `--dry-run` against a fake connection whose `current_schema()` is `shadow` and requires exit 1 with no tracker query sent.
2. **`ledgerSchemaCheck` skipped the identity check silently when the URL was unclassifiable — fixed:** it now throws on any non-ok or effective-less verdict (`lib/db/ledger-guard.js`).
3. **Tokenizer ignored comments and `E''` escapes — fixed:** `--` and `/* */` comments are skipped outside literals and `E'\''` strings are parsed with backslash escapes; the regenerated fingerprint is byte-identical, so 054's definitions were unaffected.
4. **Adoption compares "files up to here" only — ACCEPTED as a documented limitation:** once a second ledger migration exists in the checkout, adopting the first on an untracked ledger that already carries the second's tables refuses (fails closed). It only bites when adopting a hand-built ledger after 058 merges; the remedy is to adopt before, or to approve the later file's objects explicitly. Also latent: a `table X` entry in the `objects` name list would be approved by name only; the list is empty and `tables` entries must be used for tables.

- [RECHECKED after lib/db/ledger-guard.js change: identity check now fails closed on an unclassifiable URL]
- [RECHECKED after lib/db/ledger-schema.js change: tokenizer skips comments and parses E'' escape strings; fingerprint byte-identical]

## Codex round 3 (2026-09-30, S553; NO-SHIP at 675abcdb8; owner: address all seven; fixed in ad268e157..a29a6b559 plus the preview merge)

1. **Shared-database refusal compared the role and spelled loopback two ways (high) — fixed:** `tuplesMatch` compares canonical host, effective port and database only; `localhost`/`127.0.0.1`/`::1` normalize to one value.
2. **A tracked file with a matching checksum was skipped without checking the live schema still matched it (high) — fixed:** `verifyTrackedPrefix` (`lib/db/ledger-migrations.js`) fingerprints the tracked prefix in a rolled-back scratch schema and refuses the whole run on missing/differing objects before any file is considered; `--dry-run` prints that it cannot verify. Live-proved against a hand-mutated CHECK.
3. **Managed-host TLS was optional (high) — fixed:** managed URLs must carry `sslmode=require|verify-ca|verify-full` (`tls_required` otherwise) and the client config forces `ssl: { rejectUnauthorized: true }` on managed hosts.
4. **`--write-expected` bypassed the registry (medium) — fixed:** it classifies the scratch URL, requires label `local`, compares canonically against every shared and ledger variable, connects through the explicit config and checks identity before creating the scratch schema.
5. **Relation kind and row-level security were not fingerprinted (medium) — fixed:** `relkind`, `relrowsecurity`, `relforcerowsecurity` and policies are recorded and compared; live mutation tests added.
6. **Double-quoted identifiers were not protected (medium) — fixed:** `"..."` and `U&"..."` identifiers are tokens; schema stripping applies only to an exact `"<schema>".` prefix. Fingerprint byte-identical.
7. **B4 merge conflict (high) — resolved in an actual combined commit on preview branch `claude/factory-ledger-b4-preview`** (this branch + `origin/codex/factory-reviewer-b4-runtime`): the cast block reads `createCast || bindReviewer || bindReviewerSlot`, takes `requireLedgerUrl(args.target)` and runs `ledgerSchemaCheck` with mode `bind-reviewer-slot` before the client is created; the fingerprint is regenerated with 058 and `approvedAhead` emptied; the merged tree passes the ledger suites and both Neon ledgers match exactly. PR #369 landed first; PR #374 applied that resolution in its merge commit `3956d8ad7` (after Codex round 4 the fingerprint was regenerated with `relpersistence`), and landed as `66dd0974b`. A generic, name-independent test now requires every client-creating dispatch block to guard and schema-check first (`tests/unit/test-request-sandbox-clone.test.js`); proven by mutation.

**Staleness acknowledgements (round 3, one line each):**
- [RECHECKED after lib/db/ledger-registry.js change: tuplesMatch without user, loopback canonicalization, tls_required, managed ssl rejectUnauthorized]
- [RECHECKED after lib/db/ledger-schema.js change: quoted identifiers protected; relkind/RLS/policies fingerprinted]
- [RECHECKED after lib/db/ledger-migrations.js change: verifyTrackedPrefix / decideTrackedPrefixVerification added]
- [RECHECKED after scripts/apply-ledger-migrations.js change: tracked-prefix verification before any write; dry run reports it cannot verify]
- [RECHECKED after scripts/check-factory-ledger.js change: --write-expected classified, local-only, identity-checked]
- [RECHECKED after scripts/rehearse-test-request-sandbox.mjs change: none on this branch this round; the preview merge changes the cast block as described in item 7]

## Opus round 3 (2026-09-30, S553; NEEDS-FIXES, one medium; all addressed in cbf196aef..4fdf0d055)

- **M1 — the tracked-prefix check refused the real Neon ledgers after the merge (058 applied but untracked, `approvedAhead` empty) — fixed:** prefix extras are exempt when a later checkout file produces the same object with the same shape (the full file list is fingerprinted in the same rolled-back scratch pass); missing and differing stay fatal. Verified live by the builder: 054 tracked + 058 untracked → prefix ok, then `adopt` for 058.
- L1 NULL-checksum tracked rows join the prefix before `--accept-tracked-checksums` can act; L2 tracker DDL now runs only after the identity check and prefix verification; L3 an unparseable configured shared URL fails closed (`shared_unparseable`); L4 the write-expected "unset" test mocks the env file and installs its environment verbatim; L5 the `""` identifier test now has teeth; L6 bare schema stripping requires an identifier boundary; L7 the ordering test also covers `} else if` / `} else` branches and blocks reusing the shared client; L8 the merged Atlas no longer claims no ledger carries 058 (fixed in the preview merge).
- Preview merge rebuilt from `4fdf0d055` on `claude/factory-ledger-b4-preview`: same block resolution, Atlas fix, fingerprint regenerated with 058, `approvedAhead` emptied; the merged tree's ledger suites pass and both Neon ledgers match; `ledger:apply --dry-run` on the merged tree reports 054 skip and 058 pending adoption.

- [RECHECKED after lib/db/ledger-migrations.js change: later-file exemption in verifyTrackedPrefix; NULL-checksum rows in the prefix]
- [RECHECKED after scripts/apply-ledger-migrations.js change: tracker DDL after identity + prefix verification]
- [RECHECKED after lib/db/ledger-registry.js change: shared_unparseable fails closed]
- [RECHECKED after lib/db/ledger-schema.js change: identifier-boundary schema stripping]
- [RECHECKED after scripts/check-factory-ledger.js change: none this round; write-expected test hardened only]
- [RECHECKED after scripts/rehearse-test-request-sandbox.mjs change: none on this branch this round; ordering test widened]

## Codex round 4 fixes (2026-09-30, S553)

1. **Untracked later migrations with repeated `CREATE TABLE IF NOT EXISTS` statements could not advance a tracked prefix — fixed.** The runner now fingerprints the checkout prefix immediately BEFORE each untracked file and THROUGH that file, applies only when live matches BEFORE, adopts only when live matches THROUGH, and refuses partial/ambiguous states with both mismatch sets named (`scripts/apply-ledger-migrations.js:205-252`; `lib/db/ledger-migrations.js:117-173`). Approved-ahead extras remain shape-checked, but an approved object from the current file cannot disguise a partial application. `--dry-run` remains SELECT-only and reports that untracked files need adoption analysis; `--migrations-dir` supplies isolated synthetic files to the actual runner test. Unit classification coverage is in `tests/unit/apply-ledger-migrations.test.js:57-160`; live Postgres coverage proves tracked-first-only applies the repeated-CREATE second file, a wrong-shaped partial second state refuses, and a fully-live second state adopts and tracks (`tests/integration/factory-ledger-fingerprint.pg.test.js:351-505`).
2. **Relation persistence was absent from the semantic fingerprint — fixed.** `readLedgerFingerprint` now records `pg_class.relpersistence` and `compareLedgerFingerprint` reports it as a table-level difference (`lib/db/ledger-schema.js:219-224,281-298,385-401`). The tracked fingerprint and approved-ahead table shape now record permanent persistence. Unit coverage verifies the clear `p → u` message (`tests/unit/ledger-schema.test.js:71-78`); the live mutation test runs `ALTER TABLE ... SET UNLOGGED` and proves ordinary comparison, the later-file exemption, and adoption all refuse (`tests/integration/factory-ledger-fingerprint.pg.test.js:166-196`). The fingerprint was regenerated only against a throwaway database on local `127.0.0.1:5433`; no managed host was contacted.
3. **Hostless/database-less configured shared URLs and the omitted unpooled variable weakened the shared-database fence — fixed.** Shared comparison now requires an explicit PostgreSQL URL host and database, returning `shared_unparseable` for hostless, empty, and non-URL configured values while leaving candidate-URL semantics unchanged (`lib/db/ledger-registry.js:142-153,312-325`). `SHARED_DATABASE_URL_VARS` is the one exported list and includes `DATABASE_URL_UNPOOLED`; the guard and both ledger scripts consume it (`lib/db/ledger-registry.js:59-66`; `lib/db/ledger-guard.js:18-54`; `scripts/apply-ledger-migrations.js:97-120`; `scripts/check-factory-ledger.js:104-142`). Registry regressions cover malformed shared values and an unpooled-only same-database collision (`tests/unit/ledger-registry.test.js:38-45,130-153`), and the executable guard test proves `requireLedgerUrl` refuses the unpooled-only collision (`tests/unit/ledger-guard.test.js:87-93`).

Both branches are merged. Both Neon ledgers already hold the full 058 shape untracked (hand-applied by the B4 session), so the migration runner — not hand SQL — is expected to apply `058_test_request_cast_slot_bindings.sql` to both managed ledgers. The runner should classify each live ledger against the merged checkout, apply 058 when it matches the 054 prefix, or adopt it only when the full 058 shape is already live.
