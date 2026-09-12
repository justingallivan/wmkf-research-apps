---
name: feedback-mocked-sql-hides-parameter-typing
description: "Unit tests that mock @vercel/postgres never reach the planner, so a statement can pass every test and fail in production on parameter typing (e.g. jsonb_build_object('k', $1) → 'could not determine data type of parameter'). Cast bound params passed to variadic/any functions and EXPLAIN new statements against the live schema before shipping (S504, 2026-09-10)."
metadata:
  node_type: memory
  type: feedback
  status: active
  scope: data-layer
  last_verified: 2026-09-10 via production incident and EXPLAIN probe
---

## Recall Rule

Read before adding or changing any `sql\`…\`` statement whose bound parameters feed a
Postgres function, CASE, or bare expression rather than a typed column comparison.

**What happened (S504, 2026-09-10).** The first applicant PDF finalize in production failed
with `could not determine data type of parameter $2`. `acquireSlotLease` in
`lib/services/site-visit-materials/collection-store.js` passed the lease token and expiry
straight into `jsonb_build_object('token', ${leaseToken}, 'expiresAt', ${expiresAtMs})`.
`jsonb_build_object` is variadic `"any"`, so the planner cannot infer a bound parameter's
type there. Every unit test mocked `sql`, and the store test had even pinned the uncast text.
Two Codex adversarial reviews and a schema-parity test did not catch it.

**Why:** a mocked client asserts the SQL *string*; only the planner asserts the SQL *types*.

**How to apply:**
- Cast parameters that feed variadic/`any` functions (`jsonb_build_object`, `jsonb_build_array`,
  `concat`, `format`), `CASE` arms, `VALUES` in CTEs, or standalone `SELECT $1`:
  `${value}::text`, `${ms}::double precision`, `${json}::jsonb`.
- Before shipping a new statement, run it once through `EXPLAIN` with placeholder values
  against a database with the real schema (a nil UUID makes an UPDATE match nothing;
  EXPLAIN without ANALYZE executes nothing). A repo-local Node script with
  `node --env-file=.env.local` and `@vercel/postgres` `sql.query('EXPLAIN ' + text, params)`
  works; delete it afterwards.
- When a store test pins query text, pin the casts too, so a "cleanup" cannot remove them.
