# One-document Board archival rehearsal

This operator-only runner is deliberately bounded: one **existing marked test
request**, one fictional Word file, one Board archive, two Request Document rows,
and a local receipt. It never creates a request or changes current-document
pointers. It does not use the production cycle journal, scheduler, email service,
or saved staffing/cycle settings. No migration, route, queue, environment change,
deployment or automatic cleanup is part of this runner.

No live rehearsal has been performed merely by building or testing this script.
The production archival setting/schema work is separate from this rehearsal.

## Review targets first

The owner supplies an existing test-request GUID and an enabled administrator's
Dataverse system-user GUID. Alternatively use `--request-number 1003220` and
`--actor-name "Justin Gallivan"`; each lookup must return exactly one record,
and full test-marker/admin verification still follows. `plan` verifies the affirmative test marker and exact
Dynamics-tracked request folder. It resolves the registered SharePoint targets
and prints/saves the complete plan and SHA-256 approval digest. It makes no live
writes. Production Dataverse/Postgres reads remain owner-run.

From this worktree, run (replace the four uppercase arguments):

```bash
DATAVERSE_ALLOW_PROD_READS=yes node --import ./scripts/lib/use-extensionless.mjs \
  scripts/rehearse-board-archive.mjs plan \
  --request-id TEST_REQUEST_GUID --actor-id ADMIN_SYSTEMUSER_GUID \
  --env-file ABSOLUTE_OWNER_ENV_FILE --out ABSOLUTE_NEW_PLAN_FILE
```

The credential file is read, never modified or copied. Only app Graph/Dataverse
credentials, actor-readiness and Postgres connection settings needed for admin
verification are used. No agent/model credentials are used. Do not paste secrets.

**Stop and show Justin the saved plan before seed.** It identifies:

- Production Dataverse: `https://wmkf.crm.dynamics.com`.
- Source: Research / Board Materials / `WMKF-Archive-Rehearsal-<run UUID>`.
  This is a sibling of cycle folders, never inside D26.
- Destination: the verified test request's `Board Milestones/J00` folder.
- Filename: `J00 - <test number> - Archive Rehearsal <run UUID> - Writeup.docx`.
- Source row: the plan's newly generated `sourceDocumentId` and `sourceKey`.
- Archive row: generation key `board-writeup:J00:<test request GUID>`.
- Local files: plan, adjacent `.receipt.json`, and transient `.lock`.

If an earlier J00 archive already exists on that test request, the plan refuses.
It does not replace or adopt it. Select another marked test request.

## Approved live phases (not run during implementation)

Only after target approval, use the same CLI with `seed --plan ABSOLUTE_PLAN_FILE
--approve EXACT_DIGEST`. Additionally supply the owner-run write acknowledgement:
`DATAVERSE_PROD_WRITE_ACK="board-archive-rehearsal $(date -u +%F)"` and
`DATAVERSE_ALLOW_PROD_READS=yes`. The existing interlock is checked before any
SharePoint mutation. The script does not grant itself production write permission.

Seed generates fictional content, creates a uniquely named isolated folder/file,
registers its test-request source row, verifies readback and prints its Word URL.
Edit **that fictional file only**, append `REHEARSAL EDIT VERIFIED`, save and close.
Then separately approve `archive --plan ABSOLUTE_PLAN_FILE --approve EXACT_DIGEST`
with the same current-day write acknowledgement. It invokes the real
`startArchive` and `archiveOne`, Request Document adapter and Board reference
reader. The production default still rejects test requests; only this script
injects exact marked-test eligibility and local journal dependencies.

The fetch fence rejects all unplanned mutations, mail/SendEmail/sendMail and batch
APIs. It admits only scoped, create-only Graph operations and the two planned
registry identities. Signed upload URLs are single-use and never persisted.
No worker or notification dispatcher is called. This prevents this runner from
sending mail; it does not pause unrelated production notifications.

Every write phase is one-shot. Failure retains receipts and artifacts for manual
inspection, with no blind retry, overwrite, delete or automatic cleanup. A
read-only `verify --plan ABSOLUTE_PLAN_FILE` can repeat after a completed archive.

## What a PASS means

The archived file preserves a real saved Word edit, differs from the original,
has the approved readable filename, and has a verified registry row returned by
the normal Board reference reader. It does **not** prove production Postgres
journal transactions, scheduler behavior, dashboard authentication, browser
rendering, notifications, or a real D26 archival run.

Offline checks:

```bash
node --import ./scripts/lib/use-extensionless.mjs --test tests/operator/board-archive-rehearsal.test.mjs
npx jest tests/unit/board-writeup-workflow.test.js --runInBand
```
