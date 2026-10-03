---
title: Transcription disabled-release verification
domain: transcription
kind: evidence
status: pre-merge-verification-complete
summary: "Owner-authorized production migrations 060–064 applied and physically read back; transcription remains off. Disabled Preview and focused synthetic tests passed. This is not regular feature enablement."
owner: product-engineering
---

# Disabled release verification — October 2, 2026

This is a dated pre-merge receipt, not a claim that a merge or production
deployment has completed. GitHub PR #416 and its later deployment receipt are
the source of truth for the eventual merge. Runtime candidate:
`1c98237890dbf91b426f5daaf4c76d825e2c5b6d`; base:
`5e96c1d53d018d1119066f91a342ae6f64b98872`.

## Authorized production schema change

The owner explicitly authorized applying the five missing transcription
migrations, verifying the schema, completing the Preview check, and merging
with transcription disabled. Vercel project inspection verified
`wmkf_research_apps` (`prj_56SJKzNer1aV38kKVoP8tl3X0lf3`). Its Production
environment resolved to Neon endpoint `ep-frosty-credit-afovxswa` in
`c-2.us-west-2.aws.neon.tech`; credentials were never included in this receipt.

The initial read-only probe found exactly five missing migration names and
none of the three transcription tables. The canonical existing-database
runner, `scripts/apply-migrations.js`, applied:

- `060_transcription_jobs.sql`
- `061_transcription_workflow_dispatches.sql`
- `062_transcription_speaker_names.sql`
- `063_meeting_tracker_transcription.sql`
- `064_meeting_transcript_close_attribution.sql`

Result: **5 applied, 59 skipped, 64 total**. The first connection attempt
with startup lock/statement timeouts was rejected by the pooler before SQL
execution. The configured unpooled connection to the same endpoint completed
with 5-second lock and 60-second statement timeouts. Each migration committed
separately through the canonical runner; no pre-existing migration was rerun.

Independent `scripts/probe-transcription-release.js --env-file <protected-file>`
readback verified a read-only transaction and rollback, exact 64-name ledger
parity, and these empty physical tables:

| Table | Columns | Constraints | Indexes | Rows |
|---|---:|---:|---:|---:|
| transcription_jobs | 61 | 27 | 10 | 0 |
| transcription_workflow_dispatches | 10 | 7 | 2 | 0 |
| meeting_transcript_publications | 30 | 17 | 4 | 0 |

Sol independently compared the schema snapshot with migrations 060–064,
including speaker JSON bounds, paired request/visit binding, global active
slot, publication constraints, and close attribution. The probe does not
independently attest migration-file hashes or deployment identity.

## Disabled controls and rollback

All seven transcription controls were unset in Production: pilot enabled,
submissions enabled, Tracker access, Tracker schema readiness, transcript
bundle readiness, rehearsal enabled, and supervised-test enabled. Source
requires explicit opt-in. Existing post-presentation materials access/readiness
remain on and were not changed. Shared `vercel.json` registers no transcription
schedule. Maintenance reconciliation returns before database work while
transcription schema readiness is unset.

The recorded current Production rollback deployment is
`dpl_6Uc2FSgXstWnW2yFkvzp91Uh5jNE`, URL
`https://wmkfresearchapps-kwj8vwofi-justin-gallivans-projects.vercel.app`.
Vercel inspection showed READY with the production aliases assigned. Production
Microsoft sign-in and a read-only Meeting Tracker dashboard load passed before
merge. If code rollback is necessary, use `vercel rollback` with that exact URL
and scope `justin-gallivans-projects`, explicitly targeting the shared app.
Leave the additive schema in place; code rollback is not database rollback.

## Candidate verification and limitations

Dedicated disabled Preview `dpl_3iH7CKudRB2WrzmjGq9y4evgJAWi` reached READY at
`https://wmkf-meeting-transcription-test-j23rygsu2.vercel.app` using the dedicated
no-cron configuration. Auth status, sign-in page and anonymous session returned
200; normal Tracker collection, unrelated cron, AssemblyAI webhook GET and
Workflow flow GET returned 404. All seven expected responses passed. No error
logs were returned by the bounded Preview log query; this is not comprehensive
runtime-observability proof.

Six focused Jest suites passed **60 tests**, covering mocked upload ordering,
speaker labels, minute-based formatting, TXT/VTT generation, and Workbench
presentation. These are synthetic isolated tests, not a fresh hosted
upload-to-Workbench browser test. All eleven GitHub checks passed on the runtime
candidate before this documentation/probe-only follow-up. Final-head checks
must pass again before merge.

Regular enablement remains separate: verify scheduled daily cleanup, hourly
recovery and failure alerts, production provider/storage/Dataverse prerequisites,
and a controlled end-to-end rehearsal before turning transcription on. No
AssemblyAI call, audio upload, SharePoint write, or transcription activation
occurred during this release pass.
