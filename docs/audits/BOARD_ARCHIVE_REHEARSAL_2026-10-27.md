# Board archival readiness and isolated rehearsal — 2026-10-27

Owner: Justin Gallivan. Session 643. Branch: `codex/board-archive-rehearsal`.
Only readiness documentation is promoted to main; the runner, tests and testing
hooks remain on the named rehearsal branch. This is bounded evidence, not authorization to release/archive D26 or send mail.

## Verified production prerequisites

- [VERIFIED via owner-run exact schema output] Board Writeup option 100000014
  provisioned. `wmkf_initiatedat`, `wmkf_requestdocument_initiatedby` and
  `wmkf_requestdocument_milestonecreatedby` all exact; no schema apply needed.
- [VERIFIED via Vercel deployment/config GETs] Production alias resolved to Ready
  deployment `dpl_EWuXB8WrnksMdCx8WS48vUjNYK3Z`, main `80b1cd737`.
  `BOARD_WRITEUP_SCHEMA_READY=on`, `BOARD_WRITEUPS_ENABLED=on`,
  `RESEARCH_LEADERSHIP_DIGEST_MODE=board-release`, Dataverse interlock and DAL on.
  This was a redeployment of existing production source, not this rehearsal branch.
- [VERIFIED via signed-in setup and GET `/api/workbench/board-writeups?cycle=D26`]
  Active D26, 23 confirmed request identities; deadline 2026-11-02; Board end
  2026-12-10; President Allison Keller, CSO Beth Pruitt, Grants Manager Sarah
  Hibler, admin Justin Gallivan. Journal revision 189, no pending configuration
  intent, zero releases/archives, archive start/completion null at inspection.
- [VERIFIED via existing Vercel request logs] Six hourly worker requests from
  16:00 through 21:00 UTC returned HTTP 200. The six-hour warning/error query
  returned zero records. HTTP success does not prove archival of a queued item.
  No worker endpoint or reconciliation action was invoked by the read-only check;
  `reconcile` may persist discrepancies and was deliberately left alone.

## Test targets and result

[VERIFIED via retained rehearsal receipt, Graph/Dataverse readbacks and Word UI]

| Target | Identity |
| --- | --- |
| Existing marked test request | 1003220 / `4bfb6e40-678f-f111-8076-7ced8d3d15a6` |
| Fictional run | `014a60d7-a0fe-4ad7-8303-db22ce7f31a1` |
| Source folder | Research / Board Materials / `WMKF-Archive-Rehearsal-014a60d7-a0fe-4ad7-8303-db22ce7f31a1` |
| Source registry row | `87bcad26-9904-4a02-acc5-7395979db66a` |
| Archive registry row | `95d6535f-4bd2-f111-a05b-70a8a5b11800` |
| Archive item | `635D8B0B-4F25-4D59-ADC6-8F32A02142B2` (SharePoint unique ID) |
| Readable archive filename | `J00 - 1003220 - Archive Rehearsal - Writeup.docx` |
| Request-relative destination | `Board Milestones/J00` |

The real `startArchive`/`archiveOne`, Request Document adapter and Board reader
passed using an isolated local journal and exact marked-test eligibility.
The fictional document was edited in Word to append `REHEARSAL EDIT VERIFIED`.
Edited and archived governed hashes matched:
`gdc1:Amn1Fmcyyp3rPGyZRrlSuQUYEOx9b9q4fqCAJscjuqQ`.
Original hash differed: `gdc1:_gouFLX4lHhl1zHtrpKZ-cFyVUirlgyu1Uz1FcJOapM`.

[VERIFIED via native AkoyaGO read-only UI] Request 1003220 → More Tabs →
Documents → Board Milestones → J00 showed the readable filename. Its link opened
Word in view-only mode with the fictional content and saved edit marker intact.
No native app configuration or document edits accompanied this check.

## Local worker resumption

[VERIFIED via `worker-verify`, 2026-10-27] The real `runBoardWorkflow` dispatched
exactly one archive job, restricted to J00/request 1003220. A new local journal
queued verification of the existing destination while retaining its upload intent.
The real archive handler downloaded/hashed the copy, verified its existing registry
row and completed the local job. One completion-notice intent was captured locally;
notification services were not called. Cloud writes stayed blocked, and original
plan/receipt hashes were unchanged. No new upload was attempted.

Implementation: `03030b750`; initial runner `804f33b54`, readable names
`dbf428772`, retained upload-diagnosis/continuation fixes through `a950dec8b`.
Checks: 13 operator tests, 37 workflow tests, scoped ESLint, Request Document
writers gate/self-test and Dataverse DAL gate/self-test passed. Independent
read-only reviewer found no blocking issue for this bounded worker check.

## Limits and operating boundary

- Not tested: queued archival inside Vercel using the production Postgres journal;
  new upload through worker dispatch; real D26 archival; live notification delivery.
- The ordinary deployed worker scans active cycles and can send mail. It rejects
  marked test requests. Do not invoke it as an isolated test or change test markers
  to evade eligibility. Local worker execution uses explicit trusted overrides.
- Existing failed attempts and all old receipts remain intact; no cleanup is
  authorized. No D26 writeups were changed and the rehearsals sent no emails.
- Local output under `output/board-archive-rehearsal-2026-10-27/` and original
  `/private/tmp` receipts are retained on this Mac, untracked and not portable.
  This sanitized record carries the identities/results across machines, not secrets
  or a copy of the credential file. No Test Request Factory run/cast/status change
  was created; the rehearsal journal is LOCAL FILE ONLY, not a factory ledger.
- No additional configuration/development blocker was found. Staff still must
  release D26, finish editing, reconcile files and explicitly confirm/start
  archival; then observe completion and verify real request copies. Recheck live
  status before acting. This record grants no permission to start that batch.

## Bounded documentation sweep

Mode A: archival setup/readiness and test coverage. Source/services, exact owner
schema reports, Vercel GETs/logs, signed-in UI and retained receipts establish truth.
Atlas, workflow plan, service catalog, API security matrix, runner README and session handoff were checked for stale
setup/deployment/rehearsal claims. Historical October 16–18 audit receipts retain
their dated boundaries; unrelated calendar/corpus/J27 work is not reassessed.
Memory/wiki searches found no current archival-readiness restatement requiring
an edit. Production execution/mail limits remain explicit, rather than inferred
from the successful transport and local worker tests.

Structural fixes closed stale date/roster/schema setup reminders, separated the
historical pre-build baseline/implementation sequence, and corrected undeployed
Board labels in the catalog/matrix. Disconfirming check: the live D26 journal
contained no release/archive receipts; therefore no real D26 archival success is
inferred. Remaining unknowns are actual queued production archival and mail
delivery. No current contradictory readiness/setup claim remained in these
bounded surfaces after the repeated term search; this is not a whole-repo audit
of unrelated workflows. Documentation gates/self-tests passed for Atlas,
API routes, currency, fact consistency, canonical pointers and secret scanning;
agent symlink invariants passed. The API gate retained three existing unrelated
external-materials guard-recognition warnings. Claim-evidence pilot reporting
could not read local state; no observation row was invented.
