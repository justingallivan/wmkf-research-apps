# Prepared J27 Factory: managed migration and bounded live test

Date: 2026-11-03 UTC. Initial runtime: `adedab12d6fe9b1202b7b1398cd94051e4fd9dc1`;
reviewed PDF correction and successful resumption: `c9e7800e9`.
Owner authorized migration, one bounded Production fixture, the narrow PDF
replacement correction, Fable review and resumption. **No merge or Production
deployment authorized.** Owner accepted interruption of the old deployed Factory
create/advance/status actions after migration 094. That interruption remains
until compatible code is promoted.

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

## One prepared fixture — VERIFIED

- Run: `c2da75d4-a737-4d81-8db1-96aca62e12a6`.
- Destination: `8f4f6bbf-7cfe-487b-8b03-9c02f131d738`, Request **1003456**.
- Fresh Basic prepared J27 fixture; completed D26 source package, seven files,
  5,708,780 source bytes, nonempty applicant abstract. Source bodies stay private.
- Clone verification passed after the reviewed correction: original source fence,
  seven copied-file receipts/final byte checks, exact destination identity,
  Foundation result/contact/rollup protection and other clone invariants.
- Phase I setter: null → Invited (`100000003`), journal sequence 1 complete;
  derived Request Status `Proposal Invited`; two successful jobs; zero new email,
  tracking or payment rows. Allowed email/tracking effects were absent.
- Phase II setter: null → Phase II Pending Committee Review (`100000002`),
  sequence 2 complete; derived Request Status `Phase II Pending`; two successful
  jobs; zero new email, tracking or payment rows.
- Readiness preview passed all prerequisites, returned false with no attempt,
  and wrote nothing. Owner confirmation then made one true-only ETag PATCH.
  Readback and the >=90-second quiet-job/effect observation completed; readiness
  journal status is **complete**, ready true, written true. No unexpected effects.
- Final bounded row read: correct marker/run identity and J27 link, Phase I
  Invited, Phase II Pending Committee Review, derived Phase II Pending,
  readiness true, one location, zero regarding emails (zero sent) and payments.
  The shared staff-readiness predicate returns true; the row meets Reviewer
  Finder's J27 actionable data criteria. This is data/contract verification,
  not an authenticated dashboard/Reviewer Finder browser smoke. Ordinary
  discovery still excludes marked test requests under existing isolation.
- Subsequent read-only Foundation recheck with the same prior-PDF evidence:
  `ok: true`, `outcome: refreshed`, no failures.
- No reviewer communications, explicit AI execution, cleanup, second fixture,
  direct Request Status write, merge or Production deployment was invoked.

## Initial stops and evidence-backed resolution — historical sequence

The sole Request POST timed out at 30 seconds. Exact-GUID readback found the
correct marked/run-owned Request. The existing guarded runner recovered it
without another Request POST and completed the seven document copies.

The first final clone verification stopped on the protected Foundation digest.
At 15:39:35 UTC the Request was unready with both phases null. Read-only recheck
confirmed the mismatch. The application user's audit query returned HTTP 403.
At this point no phase or readiness operation had run.

Justin's Chrome session then exposed the Foundation Audit History. At
07:32–07:33 Pacific it showed the app-suite user moving GOverify Trigger,
advancing Date Exemption Checked, temporarily clearing/restoring Tax Status,
and replacing the existing GOverify PDF. The prior PDF URL from that audit was
retained only in a private local file. Substituting ONLY that prior value into
the current protected projection reproduced the original immutable baseline
digest exactly. No other protected-column difference remained.

[Reviewed correction](goverify-pdf-replacement-review-2026-11-03.md): optional
owner CLI `--previous-goverify-pdf-file` evidence must be a generated URL with a
valid timestamp before baseline capture. The replacement still needs the tracked
shape, in-window timestamp and moved trigger. Its prior-value substitution must
reproduce the original whole-projection digest; a wrong candidate never falls
back to null. No baseline rewrite, field exclusion, schema change or web input.
The same evidence is threaded through advance, recheck, finalize and recovery.
Fable's plan named changes were incorporated; code verdict READY FOR LIVE TEST.

## Operating boundary and reproducible checks

Current Production project settings have both isolation switches literal `on`.
Vercel's exact-deployment environment pull refused the READY deployment, so the
running deployment's historical environment was not independently read. The two
safeguards and daily write acknowledgement were set only for local CLI processes;
no deployment settings changed.

Private bundle, manifest, prior-PDF file and raw logs remain outside Git at
`/private/tmp/wmkf-j27-live-2026-11-03`. Retain the prior-PDF file for later CLI
checks: the unchanged admin form supplies no such evidence and may still refuse
these replacements. Never commit raw artifacts or URLs.

Read-only diagnosis uses the existing CLI, adding the evidence flag:

```text
DATAVERSE_ALLOW_PROD_READS=yes node scripts/rehearse-test-request-sandbox.mjs --target=production --run-recheck=c2da75d4-a737-4d81-8db1-96aca62e12a6 --previous-goverify-pdf-file=<absolute private prior-URL file>
DATAVERSE_ALLOW_PROD_READS=yes node scripts/rehearse-test-request-sandbox.mjs --target=production --run-inspect=c2da75d4-a737-4d81-8db1-96aca62e12a6
DATAVERSE_ALLOW_PROD_READS=yes node scripts/rehearse-test-request-sandbox.mjs --target=production --finalize-readiness=c2da75d4-a737-4d81-8db1-96aca62e12a6 --manifest=<private manifest path> --previous-goverify-pdf-file=<absolute private prior-URL file>
```

The final bounded GET selected destination identity/number, test marker/run ID,
readiness, both phase fields and Request Status, with the linked cycle expansion.
Existing `getPayments`, `getEmails` and `getLocations` helpers returned counts.
The actual `isRequestReadyForStaff` predicate was evaluated on that row, alongside
the reviewed actionable status criteria. No ordinary/D26 row was written.
Reviewer invitation/acceptance/submission, authenticated app UI and long-term
external effects remain separate acceptance scopes.

## Changed-fact reconciliation and validation

Mode A: migration status, Foundation cause and this fixture's state. Authorities:
official migration/fingerprint results, owner browser audit, exact original-digest
reconstruction, reviewed code, real CLI runner/status/finalizer results and fresh
read-only row/Foundation checks. Owning plan, runbook, Atlas and production
transition contract were structurally updated; dated earlier review receipts
remain historical. No remaining live assertion that this fixture is blocked or
that migration 094 is missing remains in those scoped surfaces. The Foundation
cause is resolved; exact deployed historical environment and authenticated app UI
acceptance remain unverified. No whole-repo truth claim.

Correction checks: 192 focused tests; expanded 23 suites / 1,089 tests passed
(existing two suites / 20 tests skipped), types, scoped lint, production build,
DAL/OData/secret gates and sequential self-tests, Atlas/doc gates/self-tests.
All 13 hosted PR checks passed on runtime commit `c9e7800e9`, including Jest,
PostgreSQL 16 integration, CodeQL/security and Preview. This evidence update
changes no runtime source.
