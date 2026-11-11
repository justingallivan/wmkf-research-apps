# Pure roster freshness comparison

[VERIFIED via source and coordinating-session tests] The exported
`compareRecommendationsRosterFreshness({expectedRosterHash, current})` is source-built.
It requires only a retained lowercase SHA-256 hash and fresh `{complete, profiles,
users}` projection. It rebuilds through `buildRecommendationsSnapshot` and returns
exactly `{freshness: 'current'}` for equality, `'stale'` for a valid changed projection,
or `'unknown'` for malformed hash, incomplete/invalid projection or overflow.
It needs no saved snapshot, clock, I/O, auth or source-selection policy. A complete
empty roster is a valid changed observation, not automatically an unknown result.
The caller owns authorization, contract version, expiry and trustworthy complete
fresh reads; `complete: true` alone is not pagination proof.

The final combined run passed 120 tests across seven suites: 21 freshness,
60 domain, one jsdom and 38 legacy matching cases. The earlier 82-case checkpoint
covered freshness/domain/jsdom only. Scoped lint/diff checks passed. Opus source review returned READY with no concrete defects. The combined plan review returned READY WITH NAMED CHANGES; the shared
facade owner accepted its changes, which did not alter this comparator contract.

Shared checkpoint `eb0010163` includes offline typed-fixture runtime `7d0cf0392`;
the coordinating session reports 380 tests/25 suites and Opus READY for that distinct
shared slice. This supersedes treating all typed integration as unbuilt. The staff
access/currentness facade is being implemented with injected fabricated readers;
no HTTP or live DAL bridge is claimed. Auth, version/expiry, source proof, result
projection and machine-principal release controls belong to that facade/shared
infrastructure. Source choice remains OPEN and results are recommendations only.

## Final review and scope closure

Opus source-only review returned READY in `outputs/roster-freshness-opus-20261111.md`.
The reviewer ran no tests or external calls; 120 passing tests/seven suites are
coordinating-session execution evidence. A null top-level argument throws rather
than yielding `unknown`; the shared facade owns that input shape and must contain
invalid calls. Existing locale-dependent sorting can conservatively produce stale
across runtime versions. Neither note required a source change.

Scoped Mode A reconciliation updated the roster plan, Session, Atlas, catalog and
prior receipt routing. Doc-currency, doc-symbol-reference and Atlas gates with
sequential self-tests and diff checks passed. The shared staff facade is still
being built; source selection, live authorization/observations and release are not
established by this pure helper or the shared offline fixture.
