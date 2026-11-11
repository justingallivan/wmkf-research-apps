# Full roster import rehearsal — November 10, 2026

[VERIFIED via private importer receipts and independent Dataverse/Postgres readback]
The full import and unchanged replay passed in sandbox and a dedicated local
PostgreSQL fixture. This verifies import/dependency persistence, not application
consumer integration, matching prompt parity, permissions, or Production readiness.

## Source and authority

Justin authorized recovery and the full rehearsal, then explicitly authorized a
fresh lineage if the original export/UUID could not be recovered and sandbox had no
prior real-import keys. Searches did not recover the November 9 export or UUID.
A complete sandbox census found four synthetic profiles and zero `legacy_` keys.
The fresh read-only export uses dataset UUID
`7770aa50-f1ac-4b66-9b62-c00ca14633c2`; it is not the original November 9 snapshot.
Do not regenerate this UUID or Amy's stable mutation UUID on replay.

Private evidence directory (0700; files 0600, outside Git):
`/Users/gallivan/.local/share/wmkf-roster/full-import-20261110`.
It contains credentials and personal data; never commit or copy it wholesale.
`inventory/source.json` retains original fields, audit values and Production links.
The parsed JSON canonical source hash is
`8a922782059a5a3099947a058f1391df52c2f8107390561b28c5490cc575ec63`;
mapping hash is
`06106b2b7a53bc0edfeb9c246bd317a226b9ea8e150eb1e4ff9c5ff50026045b`.
The inventory summary's older row hash was computed before Date serialization and
is not the canonical serialized-source checksum. Use the reviewed plan hashes and
file hashes in `replay-guard.json`; the source file was not rewritten to fit a plan.

Fresh source: 39 rows, IDs 1–39, sequence high-water 39, ten Contact links and seven
feedback references. The twelve optional text fields contain no exact-empty,
whitespace-only or edge-whitespace strings. No duplicate names/Contact links,
missing referenced roster IDs or schema-length overflow was found. Production
Site Visit/session attendee-map census found no explicit roster references; sandbox
maps also had none. Slot maps are inherited from their parent sessions.

Four approved staff User emails each resolve uniquely to an enabled sandbox User.
Five Contact links have verified active exact-email counterparts. The other five
(legacy IDs 9, 10, 24, 30 and 39) are null in sandbox by Justin's explicit approval;
Production links remain untouched in source. No Contact or User account was created.
John's Staff category override, three lead-eligible staff, Beth's eligibility off,
Kevin inactive, Amy staged inactive without links, and ID 35 exclusion were applied.

## Fixture and execution

The canary already occupied numeric ID 5, which the real source also uses. Its
container `wmkf-roster-rehearsal17-20261109` was backed up to
`canary-before-switch.dump`, then stopped with its volume preserved. New container
and volume `wmkf-roster-full-import17-20261110` use the same PostgreSQL 17.11 image
on loopback port 55439. `container-transition.json` records the transition.
The databases are separate; never replay the canary against the full fixture.

Committed preparation tool `scripts/prepare-roster-full-import-rehearsal.cjs`
(`04ec9148f`) refuses nonlocal targets, wrong database identity and any populated
public schema before writes. It copies all 39 source rows with timestamp-aware
parameters, verifies full readback parity before COMMIT, and retains seven feedback
IDs/references using synthetic feedback content/request IDs. It preserves audit
actor IDs and source sequence 39, and sets the feedback sequence to 8. Independent
review caught timestamp and feedback-sequence issues before execution; both were
fixed and re-reviewed. This minimal database is not a full application UAT fixture.

The existing six-argument importer used `inventory/source.json`, `full-mapping.json`,
`full-reviewed-plan.json`, `full.env`, `full-import-receipt.json` and
`--execute sandbox`. All three category labels/values, User navigation metadata,
active alternate keys, table audit/concurrency flags and mapped-person health passed
preflight. Native audit-event attribution and staff permissions remain separate.

| Check | Verified result |
|---|---|
| Plan | 40 entries: 39 creates, one exclusion, zero blocked |
| First execution | Success, bridge COMMIT acknowledged, 39 create attempts |
| Imported profiles | 38 legacy people plus Amy; 37 active, two inactive |
| Numeric identity | 40 identities; legacy IDs retained; Amy allocated ID 40 |
| Bindings | 39 target-scoped bindings; ID 35 remains identity-only |
| Source/feedback | All 39 raw source rows and seven original references preserved |
| Exclusion | Feedback ID 1 still references numeric ID 35; no profile for ID 35 |
| Sequences | Roster 40 / called true; feedback 8 / called true |
| Existing sandbox data | All four prior profiles unchanged, including ETags |
| Complete sandbox census | 43 profiles |
| Replay | Success, 51 Dataverse GETs, zero attempted Dataverse writes |
| Replay stability | GUIDs, ETags, full local rows, bindings and sequences identical |
| Input preservation | Reviewed canonical hashes match; file SHA-256s stable across replay |

`scripts/verify-roster-full-import.cjs` (`5f33594ac`) independently replans against a
complete current census and verifies every managed field, receipt identity, SQL
binding, source row and feedback reference. It enforces GET-only Dataverse access
and a repeatable-read/read-only SQL transaction. Its second run compares complete
persisted snapshots, including ETags and synthetic feedback content. Corruption tests
exercise changed fields, identities, bindings, source, references, sequence, receipts,
missing ETags, extra profiles and changed replay state. Independent review found no
blocking issue; its feedback-sequence `is_called` recommendation was included.
24 tests across the two new fixture/verifier suites passed; relevant lint, types,
DAL and OData gates plus sequential self-tests passed.

Reproduce read-only verification using new exclusive output paths:

```bash
node scripts/verify-roster-full-import.cjs PRIVATE_DIRECTORY NEW_OUTPUT_JSON
node scripts/verify-roster-full-import.cjs PRIVATE_DIRECTORY NEW_REPLAY_OUTPUT_JSON PREVIOUS_OUTPUT_JSON
```

Primary evidence: `lineage.json`, `mapping-approval.json`, `mapping-evidence.json`,
`missing-contact-probes.json`, `metadata-preflight.json`, `fixture-receipt.json`,
`full-reviewed-plan.json`, `full-import-receipt.json`, `full-verification.json`,
`full-replay-receipt.json`, `replay-guard.json`, `full-replay-verification.json`.
The replay operator also intercepted Dataverse fetches to reject every non-GET;
no forbidden request was attempted, and every receipt row has `createAttempted:false`.

## Boundaries and next work

No Production writes, numbered/shared-Postgres migration, FK retarget, runtime
cutover, deployment, push, email or application model call occurred in this full-import step.
The source table remains present and feedback still uses its original FK in this
fixture. No existing sandbox profile was updated or deleted; inactive new profiles
used the previously reviewed atomic create/deactivate path.

Remaining work: consumer/formatter and prompt parity, staff permissions and native
audit attribution, linked-person lifecycle cases, forced live changeset rollback,
operational freeze/admission/drain and rollback after new writes, followed by a
separately authorized Production release. These import results do not close those gates.

## Narrow sweep record

Mode A: changed fact is full-source sandbox import and stable replay now verified.
Authoritative path: explicit CLI → reviewed planner projection → sandbox store →
Dataverse profiles/local identity transaction → receipts → committed independent
GET/read-only verifier. UI/rendering is N/A for this command; runtime parity remains
open. Unknown/invalid targets fail closed; partial Dataverse success remains covered
by the existing retained-profile/rollback contract, with no destructive cleanup.

Current restatements reconciled: this record, README, owner decisions, Dataverse
Atlas, migration-plan status/evidence and isolated branch SESSION_PROMPT. Earlier
November 9 inventory/schema reports and explicitly historical canary sections remain
dated evidence. Existing Postgres runtime documentation remains accurate and is not
changed into a false deployment claim. Unrelated reviewer-roster search hits are
outside this expertise-roster task. Disconfirming tests mutate persisted fields,
references and ETags and are rejected; live replay shows the unchanged state hash.

Final documentation checks: Atlas, doc-currency, fact-consistency, canonical pointers,
doc-symbol references and their sequential self-tests passed; docs catalogue and
migration manifest passed. Follow-up searches leave zero live stale claims within
these eight roster surfaces (six current records and two explicitly historical
checkpoints). Remaining unknown/unverified claims are the release gates above.
