# Roster consumer transport checkpoint — November 10, 2026

## Scope and invariant

Justin approved a minimal rehearsal-only local `pg` transport after the Vercel
Postgres client rejected the pinned TCP fixture. `roster-sql.cjs` delegates normal
mode to the original Vercel client. Rehearsal reuses the existing target guard and
installed driver; query/connect admission requires the registered sandbox, both
Dataverse enforcement flags, and identical database aliases pinned to loopback
port 55439/database and user `roster_rehearsal`. Errors never fall back. No new
server, dependency, general database abstraction, schema setup or Production change.

The seam supports only the tag, query and connect operations used by the scoped
roster consumers: feedback, numeric roster projection, recipient directory, and
single/batch match persistence. SQL values remain parameters. Transactions retain
one checked-out client; feedback releases it immediately after commit/rollback,
before pooled hydration/recovery reads, with idempotent final cleanup.

## Evidence and discovered repairs

[VERIFIED via actual source bundle, TCP queries and sandbox adapter reads] The
read-only run used the real services with no mocked transport or adapter:

| Check | Result |
|---|---|
| Tagged value containing SQL syntax | Returned verbatim; parameterized |
| Database/current user | Pinned rehearsal database/user |
| Checked-out connection | BEGIN READ ONLY, feedback query, COMMIT, release |
| Target-scoped mapped roster | 39 profiles; 37 active |
| Active Board/Consultant picker projection | 33 |
| Unmapped/invalid synthetic exclusions | Four, with warnings |
| Historical feedback references | Seven retained; excluded ID 35 explicitly unavailable |
| Lead eligibility with live enabled-User reads | Three |

Receipt: private `consumer-transport-readback.json` under
`/Users/gallivan/.local/share/wmkf-roster/full-import-20261110` (0600). The temporary
bundle `outputs/roster-transport-live.cjs` was generated with the installed esbuild
from the actual consumer, matching, DAL-context and SQL seam modules; it contains no
credentials. Environment was loaded separately from the private `full.env`.

The first live read exposed an adapter bug: `queryAllRecords` requires an explicit
filter. The adapter now selects both supported lifecycle states with a stable GUID
order, retaining inactive historical authors and refusing capped reads. This was
verified by the successful real read, not just mocked adapter tests.

Independent fresh-agent review found that three concurrent feedback commits could
retain all pool connections while hydration requested another. The release-order
repair passed re-review with no further blocking finding in that bounded scope.
A three-commit barrier regression reproduces the old pool-exhaustion condition;
update hydration also asserts that the connection is already released.

Focused unit/regression tests, type checks, production build, and DAL/OData gates
with sequential self-tests passed. Tests cover normal-mode delegation, SQL
parameterization, invalid target rejection before either transport, cached-pool
revalidation, no fallback, complete lifecycle reads and concurrent release ordering.
The broader consumer/matching changes have focused regression coverage and prior
fresh-agent review; this checkpoint does not certify their full live workflow.

## Remaining gates

The local fixture contains import/bridge evidence, not the complete application
schema. This run made no persistent SQL writes, Dataverse writes or model calls.
Signed-in UI/auth, staff edit/native actor attribution, full feedback attachment
flows, matching-result persistence and live v2 prompt provisioning/parity remain
unverified. The separate v2 prompt manifest is source-built but was not published by
this transport task. No deployment, push or Production cutover occurred.

## Bounded reconciliation

Mode A: the local consumer transport blocker is resolved. Source → guarded SQL seam
→ local bridge/Dataverse → numeric picker and historical identity projection is
verified. Atlas, session handoff and permissions checkpoint now distinguish this
read proof from pending full-application verification. Existing import/replay and
permissions receipts remain valid historical evidence. The normal-mode delegation
and invalid-target negative tests are the disconfirming checks for accidental
runtime widening. This is not a whole migration completion claim.
