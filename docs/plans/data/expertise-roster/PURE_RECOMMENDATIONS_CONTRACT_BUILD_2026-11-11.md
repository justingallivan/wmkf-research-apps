# Pure expertise recommendations contract — build receipt

This receipt preserves the original pure-contract checkpoint. Later shared offline
typed integration and roster freshness progress are recorded in
[the freshness receipt](ROSTER_FRESHNESS_CONTRACT_BUILD_2026-11-11.md).

[VERIFIED via source and coordinating-session test results] The pure domain module
`lib/services/expertise-finder/recommendations-contract.js` is source-built. Its
focused suite passed 60/60; four existing matching/consumer suites separately passed
38 tests. Scoped ESLint and diff checks passed. Opus returned READY WITH NAMED CHANGES with no remaining source blockers. All
three named test groups are now implemented and passing. Result aliasing and
optional schema-limit handling were repaired during review and accepted. The final
run passed 98 tests across five suites (60 focused plus 38 regressions). Opus
focused closure returned READY for those tests and the pure validation extraction.
A source/import search found only the unit suite importing the new module, with
no production caller. No shared Executor, PA or live-source integration is claimed.

## Caller and DTO contract

- `RECOMMENDATIONS_CONTRACT_VERSION`: `expertise-recommendations-v1`.
- `buildRecommendationsSnapshot({complete, profiles, users})` returns deeply frozen
  `{snapshot, rosterBlock, rosterRecord}`. Profiles carry `profile_guid`, ETag and
  the full normalized roster projection; Users are exact `{userGuid, disabled}`
  records for valid active lead candidates, including disabled candidates.
- `rebuildRecommendationsRosterBlock(snapshot)` validates deserialized membership,
  row/manifest fingerprints, eligibility and visible roster association.
- `validateRecommendationsOutput(value, {snapshot, rosterBlock})` rejects extra or
  malformed fields recursively before existing GUID/category/lead canonicalization,
  rejects duplicate leads and returns a detached canonical result.

The manifest covers every supplied profile, including inactive and invalid excluded
entries; candidate User sets must match exactly with explicit boolean states.
Fingerprinting has no timestamp/nonce, and disabled/re-enabled candidates change it.
The visible record is bounded to 64,000 encoded bytes, the private roster extension
to 4 MiB and canonical result to 128 KiB. Invalid snapshot membership, altered visible
text, overflow or invalid identities fail closed. Existing legacy validation is reused
without changing its callers. No assignment, Contact/User or Request writes exist.

## Contract reconciliation and limits

Input producer is a future trusted adapter; `complete: true` does not establish
paging completeness, permission or freshness. The current consumer is the unit
suite. I/O, persistence, retries and external partial success are N/A to this pure
module; future source reads, sealed integrity, authorization and result storage
remain shared integration work. The extension bound does not prove the full shared
snapshot/prompt budget fits. Schema validation is not scientific factuality proof.

The agreed interface checkpoint is `a756735fa`; historical shared runtime baseline
is `0c4b8d39c`. Release gates include typed-result/compiler/checkpoint integration,
source/cache selection (OPEN), PA authorization, worker/recovery operations,
machine audit attribution, cleanup after principal revocation and roster cutover.
Recommendations only; future assignment remains a separate Connor contract.

Scoped sweep Mode A covered plan, Session, roster Atlas and service catalog. Source,
exports/imports and the test evidence support pure-module claims; shared readiness
is explicitly excluded. Broader workflow plans and historical receipts are outside
this bounded implementation change. See the
[implementation plan](POWER_AUTOMATE_RECOMMENDATIONS_PLAN_2026-11-11.md).

## Review disposition and residuals

[VERIFIED via `outputs/roster-recommendations-contract-opus-20261111.md`] The named
test groups cover duplicate candidate Users, additional snapshot tampering, and
output/build edge cases. No second full review is planned for test-only additions
unless they expose a source defect. The review is source-only; its test count is
reported evidence rather than execution by the reviewer.

Existing secondary-only lead semantics are intentionally preserved; this slice
does not change recommendation policy. Invalid GUIDs/ETags fail the whole projection;
a valid identity with invalid roster fields remains in the manifest and is excluded
with a warning. SHA-256 establishes internal consistency, not authenticated integrity;
shared sealing is still required. Locale-dependent order can conservatively refuse
a cross-runtime snapshot. Error-code classification for shared recovery remains an
integration concern. The minimal extraction to `roster-match-validation.js` removes the transitive DAL
imports. Its schema and validator body are unchanged; `roster-match-contract.js`
re-exports them for existing callers, while recommendations imports the pure file.
The module performs no operational I/O. Full shared encoding,
source authority, currentness and release remain unverified by this slice.

## Final closure

Opus focused closure returned READY in
`outputs/roster-recommendations-contract-opus-closure-20261111.md`; the initial
review is `outputs/roster-recommendations-contract-opus-20261111.md`. All three
named test groups are closed. The four legacy suites recommended in the closure
were already run after extraction: the final 98 tests across five suites comprise
60 focused cases and 38 legacy regressions. The reviewer read source only; test
execution and byte-identical extraction verification are coordinating-session evidence.

Scoped Mode A reconciliation updated plan, Session, roster Atlas and catalog.
Doc-currency, doc-symbol-reference and Atlas gates and their sequential self-tests
passed, as did diff checks. No remaining pending-review claim remains in those
current surfaces. At this checkpoint shared integration remained open. The later offline typed fixture
is built; source choice, live PA authorization, machine audit/revocation-safe cleanup
and release remain open.
