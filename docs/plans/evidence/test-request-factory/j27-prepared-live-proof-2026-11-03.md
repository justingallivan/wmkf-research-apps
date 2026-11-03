# Prepared J27 Factory: managed migration and bounded live test

Date: 2026-11-03 UTC. Branch runtime: `adedab12d6fe9b1202b7b1398cd94051e4fd9dc1`.
Release boundary: owner authorized migration and one bounded Production fixture;
**no merge or deployment authorized**. Owner explicitly accepted interruption of
the old deployed Factory create/advance/status actions after migration 094.

## Managed migration — VERIFIED

Used `scripts/apply-ledger-migrations.js`, sandbox first, Production second:

```text
node scripts/apply-ledger-migrations.js --url-env=TEST_REQUEST_SANDBOX_LEDGER_URL
node scripts/apply-ledger-migrations.js --url-env=TEST_REQUEST_LEDGER_URL
node scripts/check-factory-ledger.js
```

Each runner skipped checksum-current 054 and 058, applied 094, adopted no schema,
and accepted no changed checksum. Both managed databases (`ledger`, `ledger_prod`)
then matched the branch 054+058+094 fingerprint: two inspected, zero refused,
unreachable or skipped. Shared app databases were not targeted.
Migration 094 SHA-256:
`318cbd5b237d04509c7899e22d1c8ee228d64836cd39d3b879e2330ed5cccb38`.

## One fixture — BLOCKED BY PROTECTION GUARD

- Run: `c2da75d4-a737-4d81-8db1-96aca62e12a6`.
- Destination: `8f4f6bbf-7cfe-487b-8b03-9c02f131d738`, Request **1003456**.
- Fresh Basic prepared J27 fixture; completed D26 source package, seven files,
  5,708,780 bytes, nonempty applicant abstract. Source bodies remain private.
- Current Production project settings have both isolation switches literal `on`.
  Vercel's exact-deployment environment pull refused the READY deployment, so
  the running deployment's historical environment was not independently read.
  Both safeguards and the date-bound write acknowledgement were enabled only
  in the local CLI process; deployment settings were unchanged.
- The sole Request POST timed out at 30 seconds. Exact-GUID readback found the
  correct marked/run-owned Request with readiness false. The existing guarded
  runner recovered it without another Request POST and resumed provisioning.
- All seven file-copy steps passed. Observation completed; final verification
  reported only `Foundation account protected columns changed during the run`.
  Source fencing, final destination-byte checks, email/payment checks and other
  clone checks reported no failure in that pass. These bounded checks do not
  prove every possible external effect absent.
- Read-only `--run-recheck` confirmed the same Foundation mismatch. The baseline
  stores a whole-projection digest, not raw prior values; audit access returned
  HTTP 403, so the changed column and cause remain UNKNOWN. Do not assume it is
  the GoVerify PDF or relax the protected projection to force a pass.
- Final state: `needs_attention`, step `verify`, request readiness false. At 15:39:35 UTC, exact-GUID readback returned Phase I null, Phase II null, derived
  Request Status `Pending`, readiness false, correct marker/run ID, one location,
  zero regarding emails and zero payments. No phase setter or readiness
  confirmation was invoked. No new fixture or repeated Request POST.
- No reviewer sends, AI runs, cleanup, merge or deployment were performed.
- Next requirement: a privileged read-only Foundation audit investigation (or
  other independently retained before/after evidence). Any allowance change is
  separately reviewed code; the existing baseline must remain immutable. Until
  resolved, do not advance statuses or finalize readiness. Dashboard/actionable
  ready-state acceptance has not been exercised by this stopped fixture. A final
  read-only readiness preview refused the incomplete run before any stamp.

Private bundle, manifest and raw logs are retained outside Git at
`/private/tmp/wmkf-j27-live-2026-11-03`; they must not be published.

## Changed-fact sweep scope

Mode A: migration 094 changed from branch-only to applied on both managed ledgers.
Authorities: official runner results and post-apply physical fingerprint checks.
Live restatements: owning Factory plan, operational runbook, ledger Atlas and
service catalog. Earlier dated Fable/implementation receipts preserve their
pre-application evidence and do not establish current live acceptance.
No runtime change is made by this evidence update. Live fixture acceptance and
consumer visibility remain separate from migration success.

Validation: Atlas coverage/self-test, doc currency/self-test, symbol-reference
gate/self-test and docs catalog passed after migration-status edits. No runtime
source changed; the previously reviewed implementation and CI evidence remain
scoped to the branch runtime SHA above.


Reproducible read-only diagnosis uses the existing CLI modes:

```text
DATAVERSE_ALLOW_PROD_READS=yes node scripts/rehearse-test-request-sandbox.mjs --target=production --run-recheck=c2da75d4-a737-4d81-8db1-96aca62e12a6
DATAVERSE_ALLOW_PROD_READS=yes node scripts/rehearse-test-request-sandbox.mjs --target=production --run-inspect=c2da75d4-a737-4d81-8db1-96aca62e12a6
DATAVERSE_ALLOW_PROD_READS=yes node scripts/rehearse-test-request-sandbox.mjs --target=production --finalize-readiness=c2da75d4-a737-4d81-8db1-96aca62e12a6 --manifest=<private manifest path>
```

The bounded final Dataverse GET selected only the destination identity/number,
`wmkf_istestrequest`, `wmkf_testcreationrunid`, `wmkf_readyforreview`, both phase
fields and `akoya_requeststatus`; existing `getPayments`, `getEmails` and
`getLocations` helpers returned counts only. The Foundation audit GET was scoped
to the manifest's exact organization and `createdon ge 2026-11-03T15:20:00Z`,
ordered ascending, capped at 100, selecting `auditid,createdon,changedata`; it
returned 403 and no audit rows. No claim about a particular changed field follows.


Sweep result (migration-status claim only): four live restatement files were
STALE and structurally corrected; four dated review/implementation receipts are
HISTORICAL pre-application evidence. The current managed-ledger fingerprint
check falsifies the old missing-094 claim on both targets. No remaining live
missing-094 statement was found in the scoped Factory surfaces. The migration
claim is VERIFIED; fixture acceptance is PARTIAL, and the Foundation field/cause
and exact deployed environment remain UNKNOWN. No general whole-repo truth or
ready-fixture success is claimed.
