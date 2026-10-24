# Meeting Tracker bounded rehearsal — passed; controlled deployment recommended

Subsequent status (2026-10-24): owner-authorized deployment and migrations are recorded in the [controlled production receipt](MEETING_CONTROLLED_DEPLOYMENT_2026-10-24.md). The rehearsal and pre-release verdict below retain their dated scope.

[VERIFIED via API receipts, isolated Postgres, Vercel builds, real Blob/Sandbox execution and exact production-fixture readback, 2026-10-23 America/Los_Angeles] Runtime candidate `1f99d7635` on `codex/session-start-20261023`. The owner explicitly authorized isolated Preview tests followed by a production rehearsal using dedicated synthetic records, without emails or changes to existing business records. Production application deployment, configuration and primary-database migrations were not performed.

## Results and execution boundary

The clean candidate built on the separate Preview project with both Webpack and the canonical Node 22 / `npm run build` Turbopack configuration. Final canonical deployment: [Preview](https://wmkf-meeting-rehearsal-20261023-7hln9k8zc.vercel.app), `dpl_GwEv6cqMcQZUcjy9UqX8ZCupEDKN`. Authenticated worker and signed test-session checks passed; unauthenticated worker access was denied. Preview scheduling was disabled.

The production-data workflow ran through a loopback-only candidate using the fresh isolated database/Blob store, production Dataverse/SharePoint, and an additional operator write fence. It was not deployed to the production application. Staff sessions were controlled role-play sessions with fresh signing secrets and verified active staff/Coordinator IDs. Existing Coordinator configuration was read, never reassigned.

| Flow | Observed result |
|---|---|
| Coordinator authorization | Configured Coordinator recognized; helper denied even with isolated admin role; enrollment persisted |
| Durable preparation | All five persisted steps succeeded; execution continued through server restart; source reconciliation and selective retry recovered confirmed failures |
| Summary edits | Presentation edit survived discussion-only retry unchanged; actual provider responses and published SharePoint artifacts verified |
| Manual video | Real scoped-token private upload; exact original-audio proof; real hosted FFmpeg cut; 9.5-second audio/video output verified without private red-frame tail |
| External readers | Presentation reader exposed approved summary/video; briefing reader exposed approved transcript/summary/video; both served identical reviewed summary bytes |
| Negative controls | Full recording and staff discussion summary existed but direct opens were denied through both readers; non-utterance boundary rejected |
| Correction/replacement | Both readers retained identical old approved member IDs and bytes during drafting and after candidate publication; explicit replacement approval switched both |
| Withdrawal | Both readers immediately listed no presentation members and denied direct opens; stale approval and replay at a fresh version both returned 409 |
| Separate cloud components | Actual Neon duplicate-start/exclusive-claim/selective-retry/edition tests passed and cleaned; hosted media correspondence acceptance, mismatch rejection and private Blob roundtrip passed and cleaned |

## Defects found and reviewed

- `d72283c60`: settings used a dynamic require that failed in a bundled server, making Coordinator checks false. A literal server-only backend import fixes it. 29 focused tests, lint/types, DAL gate/self-test and build passed. Ordinary Claude Opus OAuth review approved, session `15cf1f9a-ca46-43aa-a56b-924361d46921`.
- `1f99d7635`: private client upload passed server-only `addRandomSuffix` and `allowOverwrite` options, which the installed SDK rejects even when false. Removed these client fields; server token retains its pathname/overwrite policy. 19 panel/service tests, lint/types and a real minted-token upload passed. Ordinary Claude Opus OAuth review approved, session `59260abd-d97a-4167-aa92-13ea16f0712d`.

Operator-perimeter errors were recorded separately: ownership-check impersonation, AI audit bindings and the installed Sandbox SDK host initially caused confirmed failures. They were reconciled or explicitly retried after the perimeter correction. A rejected client upload dispatched no cut; the first failed cut had no VM creation. No unknown paid attempt was blindly reset. Four small synthetic summary calls were made, including one confirmed-response failure followed by explicit retry. No AssemblyAI call was made.

## Safety, ownership and retained fixture

[VERIFIED via final exact-ID readback] Production synthetic request **1003371**, `185415ef-3750-4806-84c7-fb6dd032af31`, run `0615eece-39d1-4028-bbe7-6384cd58b356`, remains marked `wmkf_istestrequest=true`. Applicant, payee, primary-contact, recommender and payment-contact bindings remain null. Regarding-email query returned **zero rows**. Both reminder flags were created false. Only the new request's eligibility, its new Site Visit, new document registry/AI audit rows and its own SharePoint folder/files were written. No existing account/contact/business record was bound or edited; no global workflow was disabled.

Retained dedicated visit `6976986d-a760-4a51-bd1f-1add2697a9dd`, location `3916552b-c00e-499d-88d4-9c954163c5fd`, folder `1003371_185415EF3750480684C7FB6DD032AF31`. Final approved edition was withdrawn. Both isolated reader links were revoked, and the loopback candidate was stopped. Dedicated synthetic records/files are retained for reuse rather than recreating fixtures.

Isolated resources: Vercel `wmkf-meeting-rehearsal-20261023` (`prj_Or9GhMbRSulLI47ZuAeqxSb2ZRxg`); Neon `meeting_coord_rehearsal_20261023` on test endpoint `ep-aged-dew-b7gtigyy-pooler.c-13.us-east-1.aws.neon.tech` (88 fresh migrations); private Blob `meeting-coord-rehearsal-20261023` (`store_Q4GFCvXEuzRiQbhY`). Shared `/neondb` and production primary Postgres were not changed. The 151144252-byte pinned FFmpeg archive remains in the isolated store, SHA-256 `14020417ff8ef01470e8cb771355e65c37aff62b80fb0be41eeb7611d1360902`.

[VERIFIED via persisted worker cleanup receipts] Successful split `2987497c-1de1-46b7-8779-7030f5a34e65` is approved with Sandbox cleanup recorded; usage 19658 active CPU ms, 600198 provisioned ms, two vCPUs. The pre-start failed split also has a cleanup receipt. Separate component-test VMs were stopped/deleted and transient output bytes deleted. No rehearsal compute is intentionally left running. Credential/token receipts remain protected outside Git; raw external URLs are never committed.

## Limits and release verdict

Actual Azure sign-in/callback, genuine Zoom import/AssemblyAI transcription, real email delivery and clock-triggered scheduling were not exercised. A synthetic provider-ready transcript seeded the workflow; actual summary providers, production document registration, SharePoint files, hosted cut and external-reader HTTP paths were exercised. The loopback candidate used explicit drains and isolated rollout flags, not full production configuration parity. Explicit RequestDocument actor-field mode was off; normal document service fallback was observed, not a test of strict email sender fallback. No real mail is authorized by this receipt.

**Verdict: ready for a controlled, gated deployment.** No demonstrated runtime blocker remains from this bounded rehearsal. This is not unrestricted activation or production-deployment authorization. Recheck branch/migration allocation, apply additive 086–089 through the existing migration runner, deploy edition-aware readers/writers together with ordinary admission off, establish a compatible rollback floor, then deliberately enable exact-request admission before wider owner promotion. See the [release checklist](../plans/MEETING_COORDINATION_RELEASE_CHECKLIST_2026-10-23.md).

## Contract reconciliation and historical boundary

Contract-reconcile Mode B now covers caller → durable preparation → source/provider/media → registered immutable files → Coordinator edition → both external readers, including partial failure, stale versions and withdrawal. Sweep scope reconciles this receipt, implementation checkpoint, release checklist, manual review conclusion and session pointer. Earlier plan/review sections remain dated historical evidence.

The initial Dataverse sandbox fixture failed with `0x80040265` and exact-ID 404, and its Shared Admin Coordinator setting was absent. That sandbox is not maintained to production parity; its precise downstream failure remains unproven. The owner authorized the dedicated production-fixture alternative rather than repairing shared sandbox infrastructure. Initial partial receipts are superseded by the bounded results above, not retroactively promoted to successes. Machine-local detailed journals use `/private/tmp/wmkf-meeting-*`; main inventories are the protected resource journal, production fixture, final safety, drains, first readers and replacement receipts.
