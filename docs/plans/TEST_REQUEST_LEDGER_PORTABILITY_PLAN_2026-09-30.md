# Test Request Factory ledger: portability and single source of truth

Status: **DRAFT, revision 2 (2026-09-30, S553). D1 and D3 decided; the managed ledger exists with 054 + 058 applied. Phase 2 items 1–2 and Phase 3 items 1–2 SOURCE-BUILT on branch `claude/factory-ledger-registry` (registry, guard, runner, fingerprint check, gate, CLI `--ledger-check`, `/start` gate line, `/stop` ledger-identity line), verified live against both Neon ledgers; not merged, one Codex adversarial round pending. Phase 1 (tonight's dump/restore) and Phase 2 item 3 (restore into Neon, then retire local) follow the brief. D2 open.**

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

1. **BUILT (S553):** `lib/db/ledger-registry.js` (outside Codex's B4 surface, beside the migrations it governs): the managed pooled hostname labelled `managed-ledger`, plus `localhost`/`127.0.0.1` labelled `local`; the direct non-pooler host is deliberately unregistered until verified. Both ledger databases share the managed host, so `requireLedgerUrl(target)` requires: URL set; not equal to any configured shared URL; hostname in the registry; and on the managed host the database `ledger_prod` for `--target=production`, `ledger` otherwise (local hosts keep their names). The `neon.tech` regex is gone. Verified live: production ledger passes for production and is refused for sandbox, the app's `POSTGRES_URL` is refused as shared.
2. `TEST_REQUEST_LEDGER_URL` (production ledger) and `TEST_REQUEST_SANDBOX_LEDGER_URL` (sandbox) documented in `docs/CREDENTIALS_RUNBOOK.md` (which does not mention `TEST_REQUEST_LEDGER_URL` today [VERIFIED 2026-09-30 by grep]) and `lib/utils/tracked-secrets.js`, stored in each machine's `.env.local` only, never in Vercel. Rotation procedure: Neon console reset, update both Macs, same as the office sync done in S553.
3. Migrate: restore the Phase 1 dump into the new project (the brief's Neon section; `--clean --no-owner` then re-apply 058 for parity), run the Phase 3 schema check, then run one read-only `--run-inspect` against it from each Mac once the registry admits the host. Only then retire the local `ledger_prod` (D2).
4. Update the cast plan §6 and the B4 release checklist to name the managed ledger instead of "local `ledger_prod` and `ledger`"; update the Atlas ledger page header.
5. **Review:** the registry and the new `requireLedgerUrl` loosen a fence that went through Codex review, so they get one Codex adversarial round before merge, on their own Tier 1 branch (CLI and scripts only, no app runtime).

### Phase 3 — Schema verification (with or after Phase 2; ~half a day)

The in-place edits to 054 are the drift source. Two build items:

1. **BUILT (S553):** `scripts/apply-ledger-migrations.js --url-env=<VARIABLE NAME>` (`npm run ledger:apply -- --url-env=TEST_REQUEST_LEDGER_URL`) applies every `test_request_*` migration file in the checkout with a `ledger_schema_migrations` tracker inside the ledger, `applied_by` recorded, refusing any URL the registry rejects. It takes the variable name, never the URL. No reset step: 054 and 058 are idempotent (`IF NOT EXISTS`, `OR REPLACE`, `DROP CONSTRAINT IF EXISTS` + `ADD`) [VERIFIED S553 by re-applying both], so a hand-built ledger simply has them re-applied once and recorded. Run against both Neon ledgers on 2026-09-30.
2. **BUILT (S553):** `lib/db/ledger-schema.js` reads a *structural* fingerprint (column names/types/nullability, constraint names and kinds, index names, function signatures; definition text is excluded because it differs between CI's Postgres 16 and Neon's 18, and NOT NULL pseudo-constraints are excluded for the same reason) and compares it with the tracked `lib/db/ledger-schema-fingerprint.json`: MISSING and DIFFERING fail, EXTRA warns (a ledger ahead of the checkout, e.g. Neon carrying B4's 058 before it merges). `tests/integration/factory-ledger-fingerprint.pg.test.js` (CI ledger job) proves the tracked file equals the migration files applied to an empty schema, and fails with the regenerate command (`scripts/check-factory-ledger.js --write-expected`) whenever a ledger migration changes; **whichever of PR #369 and this branch lands second regenerates it.** `npm run check:factory-ledger` checks every configured ledger, prints `skipped` when none is set, and `/start` runs it. The CLI runs the same comparison before every ledger-driven mode and offers `--ledger-check`; first landing blocks on MISSING only, `--strict-ledger-check` also blocks on DIFFERS, to be promoted to the default once both real ledgers have been reconciled.

### Phase 4 — Durable facts and hygiene (~1 h)

1. Atlas `docs/atlas/postgres-test-request-runs.md`: ledger location, registry, fingerprint check, dump procedure.
2. `docs/agent-wiki/topics/dev-environment.md` and `.claude-memory/project-local-docker-is-colima.md`: the container is for tests; the operational ledger is managed.
3. Make `tests/integration/test-request-run-ledger.pg.test.js` and `test-request-run-runner.pg.test.js` schema-scoped like the newer suites, so residue in a local `ledger` database cannot fail them (they fail on this Mac today for that reason while passing in CI). Not done in S553.
4. Memory entry: *feedback-operational-state-must-be-reachable-from-every-workstation* — any owner-run tool that keeps durable state must name where that state lives, and the location must not be one machine.

## Order and dependencies

Phase 0 → Phase 1 (tonight) → D1 → Phase 2 and Phase 3 in parallel on separate branches (Tier 1: CLI and scripts only, no app runtime) → Phase 4. B4's ledger-dependent checks can run on the restored local copy after Phase 1; they do not wait for Phase 2.

## Risks

- **Two live copies during Phase 1.** Mitigated by the evidence file naming the current copy and by the restore helper refusing a populated target without `--replace`.
- **Allowlist mistakes.** A wrong host in the registry is a reviewed commit; the shared-URL equality refusal stays as a second fence.
- **Managed-tier compute suspension** [ASSUMED for Neon's free tier] may pause an idle project so the first command of a session takes a few seconds. Acceptable for owner-run tooling.

## Not in scope

The P7 admin form and the "Q2 shared ledger" it needs are unchanged; if P7 ever lands, its ledger is the managed one from Phase 2, not the app database.
