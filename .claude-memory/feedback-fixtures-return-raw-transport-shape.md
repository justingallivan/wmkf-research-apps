---
name: feedback-fixtures-return-raw-transport-shape
description: "Test fakes must return what the transport really returns (raw OData annotation keys, no bypass wrapper around the CLI path, a manifest the real validator accepts); a fake that returns the already-processed shape or supplies context the real caller lacks passes the suite and hides a bug that stops every live run. Bit three times in Session 539 (Factory slice 6b)."
status: active
metadata:
  type: feedback
  scope: global
  last_verified: 2026-09-24 (S539) — Stage A P1, Stage B P1-A, Stage C P1-A and P1-B, all found by Opus review, none by the passing suites
---

## Recall Rule

Read before writing a fake `fetch`, fake client, fake ledger or fake manifest for a
path that will later run live, and before accepting a build agent's "all tests pass"
on such a path.

**Do:** make the fake return the raw wire shape (`@odata.etag`,
`X@OData.Community.Display.V1.FormattedValue`) and let the code under test apply
`processAnnotations`; build fixture manifests that the real validator
(`validateCloneManifest`) would accept; keep at least one test that calls the
entry point WITHOUT the bypass/context wrapper the unit suite normally adds, so a
missing `withDalContext` / `enterDynamicsBypassForScript` on the real CLI path fails
a test; give the fixture at least one real member of every set the code walks (a
Basic copy in a census that verifies copies).

**Do not:** pre-process the fake's rows into the shape the consumer wants; hand-set
an invariant (`expectedSharePointFiles: 2` over `documents: []`) that the real
builder could never produce; wrap every test in `bypassDynamicsRestrictions` and
call the context contract proven.

**Why:** S539, Factory slice 6b: (1) sandbox reads returned raw bodies with no
`_etag`, so `commitReadyLineage` would throw on every live run; the fake deps
already returned `_etag`. (2) The destination-request read skipped annotations so
the institution was always empty; the fake carried the processed key. (3) The
verifier's census count was off by exactly two on any real manifest; the fixture's
manifest was inconsistent. (4) The CLI `--advance` path never entered a trusted DAL
context; all three step suites wrapped `advanceRun` in a bypass. Each was caught only
by an Opus reviewer swapping the fake to the raw shape.

**How to apply:** when a reviewer asks "why does the test miss it", the answer
"the fake supplies what the code forgot to produce" is the tell. Sibling of
[[feedback-mutation-test-with-the-discriminating-fixture]] (that one is about the
fixture data; this one is about the fixture's shape and context).
