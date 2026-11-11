# Sandbox recommendations roster read adapter

[VERIFIED via source and coordinating-session checks] The new
`lib/dataverse/adapters/expertise-recommendations-read.js` exports
`readRecommendationsRosterProjection()` with no selectors. It returns
`{targetHost, projection}` after reading the exact registered sandbox under the
caller's trusted DAL context, enabled enforcement and stable target configuration.
It validates complete selected fields/ETags, identities/lifecycle booleans and the
exact enabled/disabled candidate-User set, then applies the pure snapshot builder.
This establishes a target-bound read projection, not caller/Request authorization,
source selection, cross-environment assembly or Production cutover.

Opt-in `strictPagination`/`strictRead` in Dynamics read operations require an exact
`expectedOrigin`. The strict path rejects redirects, target drift, mismatched
continuation origin/entity/query semantics, duplicate identities/cursors,
incomplete or changing counts and caps. Ordinary callers retain their existing
behavior. User reads are strict too. There are no data writes or model calls.

The final updated combined run passed 207 tests across ten suites, superseding
the earlier 190-test checkpoint. Types and scoped lint passed. Opus initial review returned READY WITH NAMED CHANGES, without a blocking source
defect; required and recommended test additions passed; focused Opus closure returned READY. Live strict-adapter read at 2026-11-11T21:01:20Z returned
46 profiles, 40 active, three enabled candidate Users/three leads, zero warnings,
complete fields including nulls and all ETags. The hash matched the prior read:
`479ef02955ff983bf1d60faa1fec281603d243988ee431ee3c25243f30b3ec81`.
Roster text was 51,106 bytes; encoded record 52,035. Live data occupied one page;
strict multipage behavior is fabricated-test evidence, not live multipage proof.
The earlier 20:44Z probe used the old helper and is only a historical aggregate check.

## Shared-owner dependency handoff

Minimal source subset: the new adapter, `lib/services/dynamics/read-ops.js` and
facade option JSDoc in `lib/services/dynamics-service.js`. The shared checkout's
`lib/dataverse/core/entity-registry.js` lacks the existing roster entity entry
`wmkf_expertiseprofiles`, so that entry must accompany integration. Existing
trusted context, target registry, roster contract and snapshot builder are required
dependencies, not alternate implementations. Shared staff facade integration must
preserve same-target ownership and cannot combine sandbox roster with another
environment's Request/source/result. Runtime shared admission remains separate.

Initial document policy is owner-selected AI Materials combined narrative–bibliography;
general future placement/cache compatibility is not settled. Recommendations only;
no assignment, live generation, deployment or Production write is part of this slice.

## Initial review follow-up

The initial source review is `outputs/roster-read-adapter-opus-20261111.md`.
Named test changes cover the target-fixture false positive, exact select/wire ETag,
duplicate User and HTTP failure paths. Small follow-up hardening replaces URL.parse
with new URL, rejects malformed strict-flag types while preserving explicit-false
legacy behavior, clarifies cap JSDoc and allowlists probe failure codes. These changes and all required/recommended test groups are implemented; types and
scoped lint passed. The final 207-test run and repeated strict live GET probe passed;
focused Opus closure returned READY.

## Final closure

Opus focused closure returned READY in
`outputs/roster-read-adapter-opus-closure-20261111.md`. Required groups 1–4 and
recommended coverage are closed; bounded source changes were accepted. The required
combined run passed 207 tests across ten suites. DAL/context gate/self-test pairs
and scoped lint were rerun successfully after the final fixes; types passed.
Live strict reading remains a one-page observation; multipage claims rely on the
fabricated transport tests. No live authorization or Production readiness follows.

Scoped doc-currency, symbol-reference and Atlas gates with sequential self-tests
and diff checks passed for this source-policy/adapter reconciliation. Initial AI
Materials combined narrative–bibliography policy is selected; broader placement,
cache compatibility and same-target shared integration remain separate decisions.
