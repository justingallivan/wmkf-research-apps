---
title: Real Zoom audio import and AssemblyAI Preview acceptance
domain: meeting-tracker
kind: audit
status: active
summary: "Owner-approved 85-minute Zoom recording passed real Preview import, AssemblyAI transcription, saved-content and TXT checks. Disposable resources removed; one automatic cleanup warning email was queued to the owner."
owner: product-engineering
---

# Real recording acceptance — PR 513

[VERIFIED via hosted responses, isolated Postgres readback, provider API and Blob SDK,
2026-10-19] The owner confirmed the selected October 5 recording belongs to this
cycle, is non-sensitive, and may incur AssemblyAI transcription charges. It was
the longest occurrence in the approved host's 120-day listing; there was one
configured host. The listing's meeting start was 10:46 a.m. Pacific; its audio
began at 11:00:59 a.m. and ran **85 minutes, 34.677 seconds**. No second
transcription or model comparison was run.

Tested source: `1dc8f3d1b75e8dc517f7cb42db65abddb430d362`, whose 12 CI checks had
passed. Preview `dpl_2bcyRsH3JmSUPHPcapoaCV6VNqgr` used the existing shared-app
project with branch-only test configuration, Node 22, and sandbox Dataverse.
The deployment has since been deleted. Application runtime source was unchanged
for this acceptance; the added operator scripts are not application endpoints.

## Boundaries and invariant evidence

| Invariant | Evidence |
|---|---|
| One approved occurrence and one paid job | Fixed occurrence in HTTP operator, one fresh DB job/import, one workflow dispatch attempt; no automatic import retry |
| Exercise production import/upload implementations | Normal authenticated Zoom listing/import routes, real Zoom downloads, private Blob SDK, parser worker, workflow and AssemblyAI provider code; no mocks |
| Preserve complete verified audio | 56,283,857 declared/verified bytes; capture and job SHA-256 both `34a1d8360eb4ceefa0a5843ae6157aa461f4dde448138d260fd8952c55044171` |
| Keep data isolated | New `audio_pr513_acceptance_20261019` database on existing test endpoint; new private `store_K1ouNXIpH2j48fJ4`; request 1000334 and its existing visit in sandbox; no publication action |
| Exercise access checks | Unauthenticated import redirected to sign-in; signed test session authenticated, but listing first returned 403 until the existing owner role was copied into the fresh DB |
| Do not change Production permissions | Production role read in a read-only transaction; copied only the verified owner's existing role to the disposable DB; no Production writes or configuration changes |
| Bound optional processing | Pilot switches false; Meeting transcription limited to the sandbox request; Claude/OpenAI keys empty, so optional speaker naming failed safely without a model request |

Authentication used an expiring NextAuth session signed with a newly generated
Preview-only secret. JWT callbacks still resolved the live test-DB identity and
routes enforced Origin, active-account and role checks. This verifies the
application API flow, not Azure browser sign-in or ordinary-staff permissions.

## Results

| Check | Observed result |
|---|---|
| Real Zoom listing | Approved audio 56,283,857 bytes, accompanying VTT 112,697 bytes, no existing import |
| Import HTTP request | 200, started import and queued verified job, **10.686 seconds** |
| Job lifecycle | Created 22:35:33.737Z; submission intent 22:35:45.716Z; Ready 22:36:38.380Z (**64.643 seconds from creation**) |
| AssemblyAI | One accepted transcript with requested/returned `universal-3-5-pro`; workflow attempt 1 completed without an error |
| Verified saved content GET | 200; **306 utterances, 8 speaker IDs, 68,101 utterance-text characters** |
| Coverage | First speech at 7.694 s; last speech at 5,133.104 s, 1.573 s before audio end; all utterance timestamps valid |
| TXT download | 200; 75,184 bytes, 612 lines; SHA-256 `ed35f78f007e685fbd17ae3d201917ec95e8995e99f01c10c5c45480d1f1ec4a` |
| Provider/input cleanup | Provider cleanup recorded 22:36:41.798Z; audio deletion recorded 22:36:41.909Z |

The saved-content route verifies the stored output hash before returning it.
Content-free raw results are in [the JSON receipt](ZOOM_AUDIO_REAL_PREVIEW_RESULTS_2026-10-19.json).
This is mechanical and temporal coverage evidence, not a listening-based accuracy
review, speaker-name assessment, or an additional memory-capacity measurement.

## Cleanup and automatic notification

The draft deletion route succeeded. The existing cron removed content but
reported incomplete cleanup because the 15-minute upload capability window still
required its tombstone. **That cron also queued one automatic warning email to
the owner** at 22:38:25.146Z, subject `[WARNING] Daily transcription cleanup or
lease recovery is incomplete`, category `ops`, source `roster`. The fresh database
contained only the owner's superuser identity. The owner was told about this
unnecessary notification; inbox delivery was not verified. The guessed
`NOTIFICATION_EMAIL_ENABLED=false` setting was not an actual sending control and
must not be reused. Future rehearsals must verify and disable the real sender
configuration before invoking notification-producing recovery/cleanup.

Independent provider GET returned status `completed`, the exact deletion marker
`Deleted by user.`, and zero words/utterances. This observes API-visible content
removal; it does not establish physical deletion timing. AssemblyAI documents
[transcript deletion](https://www.assemblyai.com/docs/delete-transcripts) separately
from its [retention policy](https://www.assemblyai.com/docs/data-retention-and-model-training).
The SDK listed **zero blobs, no remaining page** before store removal.

Branch access and database fences were restored to disabled baseline, temporary
branch credentials removed, both test deployments deleted, the new database
dropped with absence verified, and the empty new store deleted. Deleting the
entire store invalidates the outstanding upload capabilities; no late-upload
window was shortened or bypassed in application state. Temporary local
credentials and transcript-response files were removed. Original Zoom files,
existing test-database rows, Production settings and SharePoint files were
preserved. Sandbox Executor/operational audit and notification records from the
normal workflow were not purged. No transcript publication was attempted.

Operator syntax/lint checks and wrong-target/unsafe-cron refusal checks passed.
Documentation currency, symbol references, build-claim, secret and scaffolding
gates/self-tests passed sequentially. A fresh read-only agent found no actionable
blocker in the scripts, receipt and reconciliation diff; it did not rerun the
live test or independently recheck external deletion. No application fix was
needed.

## Contract audit and limits

Whole-flow: operator session → guarded route → sandbox binding → approved Zoom
listing/detail/download → private Blob → queue validation → leased workflow →
verified streaming provider upload → provider result → hashed stored output →
authenticated content/TXT consumer. Import/job association and one completed
workflow dispatch were read back. Existing partial-success, lease, intent,
uncertainty and abort contracts were unchanged; no schema or application route,
status or helper extraction was introduced by the test. Operator setup used the
guarded fresh-install bootstrap solely on the newly created database.

Sweep Mode A scope: this new acceptance fact, queue audio item, implementation
receipt and review disposition. Dated synthetic/prototype receipts remain
historical evidence of their own runs. The reviewed specification fingerprint
is unchanged. Release remains a deliberate owner decision: **PR 513 is unmerged**.
The 200 MiB/four-hour limits stay unchanged. Browser sign-in, callback delivery,
optional name alignment, publication, hosted slow-source/disconnect behavior,
sustained concurrency and transcription quality scoring were not verified here.
