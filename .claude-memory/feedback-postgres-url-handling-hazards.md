---
name: feedback-postgres-url-handling-hazards
description: Postgres connection-string hazards: a sed host-extract that fails to match prints the whole URL with its password; pg_dump output through Neon's pooler leaves an empty search_path on the pooled backend; the app driver cannot reach a plain local Postgres.
metadata:
  type: feedback
  status: active
---

## Recall Rule
Read before printing anything derived from a `POSTGRES_URL` or ledger URL, piping pg_dump output into a pooled Neon URL, or planning to run the app against a non-Neon database.

Do: parse with `new URL(u).hostname` and print only that (or a boolean); run `RESET search_path` through a pooled URL after any restore; use a disposable Neon branch for an isolated app run.
Do not: use a `sed`/regex substitution as redaction; point `npm run dev` at a local container.
Ground truth: `docs/CREDENTIALS_RUNBOOK.md` ("Rotating the app Postgres password"); `lib/db/ledger-registry.js` for ledger hosts.

**What happened (2026-10-01, S559):**
- A `sed -E 's#.*@[^.]+\.([a-z0-9-]+)\.aws\.neon\.tech.*#…#'` meant to print only the region did not match the `c-2.` host segment, so `sed` echoed the full `POSTGRES_URL`, password included, into the transcript. That turned a planned Sensitive conversion into a forced password rotation.
- `pg_restore` of pg_dump output through the pooled Neon ledger URL ran `set_config('search_path', '', false)`, which persisted on the transaction-mode pooler's single backend. `check:factory-ledger` then failed with `schema=null` until a `RESET search_path` ran through the pooler.
- `@vercel/postgres` uses Neon's WebSocket driver, so `npm run dev` cannot point at the local `wmkf-ledger-pg` container. A disposable Neon branch of the app project is the isolated local venue (S559 Part B browser rehearsal).

**Why:** connection strings are secrets, and a pattern that fails to match passes its input through unchanged. Pooled backends keep session state across clients.

**How to apply:**
- Parse with `new URL(u).hostname` (or compare hosts as booleans) and print nothing else. Never use a `sed`/regex substitution as a redaction.
- After a restore or `psql -f` of pg_dump output against a pooled URL, run `RESET search_path` through it (or use the direct host).
- For an isolated app run, use a Neon branch with every Postgres variable overridden in the dev process, not a local container.

Procedure: `docs/CREDENTIALS_RUNBOOK.md` → "Rotating the app Postgres password". Related: [[feedback-operational-state-must-be-reachable-from-every-workstation]].
