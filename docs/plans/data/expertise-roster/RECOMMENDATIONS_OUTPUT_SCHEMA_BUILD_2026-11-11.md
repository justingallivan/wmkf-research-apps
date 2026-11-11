# Recommendations native output schema — pure builder

[VERIFIED via source at `94b361c04` and coordinating-session checks]
`lib/services/expertise-finder/recommendations-output-schema.js` exports
`buildRecommendationsOutputSchema({snapshot, rosterBlock})`. The pure builder
revalidates the frozen context and exact visible block before deriving role-specific
GUID enums: eligible leads for both lead slots, staff for consultation, Consultants
for overlap, Board for interest and all visible identities for conflicts. It emits
a closed native JSON Schema for direct recommendations, with no persistence or
checkpoint wrapper. Descriptions are generic; only already-visible GUIDs enter enums.

Empty categories are omitted from properties and required keys; existing unchanged
postvalidation supplies their default empty arrays. Empty eligible-lead sets produce
null-only primary/secondary fields, never empty enums. Nullable text uses anyOf.
The existing domain validator remains authoritative for lengths, identity, distinct
leads and retained-result rules. This builder constrains generation; it grants no
authority and performs no I/O.

Follow-up `c4857ce9b` clarifies that every identified conflict must be preserved,
without changing schema shape; all 20 builder tests passed again. Shared imports
are `7b140b6ee` (initial builder) and `3ce88acb6` (conflict wording).

Twenty new builder tests passed; the combined builder/domain run passed 80 tests
across two suites. Scoped ESLint, types and diff checks passed. The 512 total enum-
entry and 64 KiB encoded-schema bounds are conservative LOCAL guards, not provider
acceptance or context/latency guarantees. Offline validation cannot prove that the
provider accepts the real schema, or that hidden provider formatting overhead fits.

The shared stream owns compilerVersion 2 integration, effective-schema budget/call
selection, unchanged parsing/postvalidation, checkpoint binding and shared docs.
Shared integration checks passed 225 unit tests across nine suites and final 90
PostgreSQL tests across three real suites, plus types, lint, paired gates and an
environment-free build. Opus returned domain PASS with no blockers; shared
NAMEDCHANGES required execution evidence only, with no code edits. The final PG
run locally resolved that condition, including two post-packet worker negatives
for unknown GUID and wrapper output. The reviewer executed no tests. Shared integration is committed as `aa763f044`; the prior three live receipts and
prompt bodies remain unchanged. The design review is
`/private/tmp/wmkf-expertise-native-schema-design-opus-20261111.json` (NAMED CHANGES);
this receipt does not claim every shared integration item is complete.
No fourth live trial, prompt publication or admission change is authorized or run
by this pure build. Any future live compiler-2 test needs separate approval and may
still incur a billed schema rejection. Existing runtime/legacy validator behavior
and prior trial evidence remain unchanged.

## Final review boundary

Exact source review: `/private/tmp/wmkf-expertise-native-schema-build-opus-20261111.json`.
Domain PASS and the locally resolved shared execution-evidence condition do not
prove provider acceptance, hidden formatting overhead, latency or cache-prefix
reuse with a per-roster schema. No fourth trial, compiler-2 prompt publication or
admission extension was performed. Those require separately reviewed artifacts
and authorization. Existing secondary-only lead semantics and strict domain limits
remain unchanged; the provider schema does not replace postvalidation.

The next step, if requested, is a separately reviewed fourth-cohort prompt/admission
plan and explicit approval; no automatic provider call follows from this build.
