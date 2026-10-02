# Claude Fable planning review — 2026-10-01

Read-only review through verified claude.ai OAuth subscription, explicitly authorized by owner after usage/source-sharing disclosure. Model reported: `claude-fable-5-1`. No permission denials. Source/plan review only; no deployment certification. Full review follows. Root's dispositions are in the integration plan; reviewer assertions are not automatically established facts.

# Fable planning review: Meeting Tracker transcription plan (2026-10-01)

**Verdict: implementable as one bounded slice once the three blocking decisions below are recorded in the plan. This is not live-deployment approval.** 

This was a read-only source review: nothing was run, and no audio, transcripts, secrets or live systems were touched. I could not save this to the plan file because the session has no write tool, so the review exists only in this message.

## Blocking decisions

1. **Confidential-use approval.** The pilot only queues a job after a "non-sensitive" acknowledgement and records `non_sensitive_acknowledged_at` (`runtime.js:156`, `060_transcription_jobs.sql:10`). Site-visit recordings are not non-sensitive, and the Atlas says confidential use is not approved. The Meeting Tracker start step needs its own acknowledgement (credits plus provider processing under one-day retention), and the owner must approve real recordings explicitly. A build must not reuse the pilot checkbox.

2. **Deployment target.** The isolated pilot denies every Meeting Tracker route (`deployment-policy.js:185`) and has no Dataverse. So this slice can only run in the shared project. Root must confirm three things:
   - **Shared runtime:** the AssemblyAI key, webhook, worker and crons go live there. On this branch `vercel.json:11,37-38` already registers the drain cron; it is secret-gated (`drain-transcriptions.js:8`) and the webhook is signature-gated (`assemblyai.js:11`).
   - **Migrations:** 060–062 plus one new migration must be applied to shared Postgres. The Atlas says they exist only in isolated Neon. Shared-database state and number collisions with `main` are unknown; I could not check either.
   - **Flags:** `TRANSCRIPTION_PILOT_ENABLED` also turns on the superuser pilot routes in the shared app (`runtime.js:26-32`, `deployment-policy.js:197`). Add a separate Meeting Tracker flag that fails closed, mirroring `post-presentation-materials-readiness.js:20-40` including its `test:<requestId>` mode.

3. **One governed format.** There is one transcript winner per request, and finalize supersedes every eligible predecessor regardless of producer (`material-model.js:146-178`, `material-service.js:1794-1801`). Publishing TXT then VTT would make VTT replace TXT. See the recommendation below.

## Recommended designs for the three open items

- **Collaboration scope: request-scoped drafts.** Any Meeting Tracker staff member on that request can view, name and publish; `owner_profile_id` stays as the initiator for audit. Published materials are already visible to all Meeting Tracker staff, and initiator-only would strand a paid draft when the initiator is away. The cost is new request-scoped store accessors, because the existing ones filter by owner (`store.js:104-110`, `:873`). The existing version check already handles concurrent name edits.

- **Durable format: publish exactly one TXT.** It is the minute-headed readable record and passes existing validation (`post-presentation-transcript-file.js:6-11`). VTT stays a staff download while the draft lives. A durable VTT would need a new artifact type, which is a separate decision.

- **Later name correction: republish, then manual upload.** Inside the 7-day content window (`store.js:624`), edit names and publish again; the new file supersedes the old. After that, use the existing manual transcript upload. The plan should state the 7-day limit and promise no regeneration beyond it; the owner should confirm 7 days is acceptable.

## Contracts the build needs

- **Identity.** Add `request_id` and `site_visit_activity_id` to `transcription_jobs`. Every Meeting Tracker operation runs `requireAppAccess('meeting-tracker')`, then `loadBoundContext` (exactly one active visit, `material-service.js:208-216`), then checks the job's request and visit against the route. MP4 uploads already bind the visit this way (`:598-600`). Pilot list and detail queries must exclude request-bound jobs; today they select by owner only (`store.js:113-125`).

- **Publication ledger on the job row, not the staging table.** Staging rows expire after 60 minutes and the sweep deletes unbound SharePoint candidates (`portal-upload-staging.js:63`, `:620-639`). Instead:
  - Set `publication_operation_id` once with a version-checked update, and snapshot the names in their own column, because cleanup clears `speaker_names` (`store.js:889`, `:1056`).
  - Call `finalizeTranscriptUpload` with the operation id as `stagingId` and a dependency override that stores the candidate on the job.
  - Inside that function the staging id only feeds the generation key, filename and lease calls (`:1703`, `:1729`, `:1719-1720`, `:1765-1770`, `:1786`, `:1819`), so retries converge on one SharePoint file and one Dataverse row.
  - Retry needs the job content, so it works for 7 days. After that, cleanup should raise a reconciliation event for any job with a candidate but no document.

- **Silent-overwrite guard.** A fresh publish supersedes a manual transcript uploaded after the draft was reviewed; only the replay branch compares versions (`:1857-1859`). Add an optional `expectedCurrentArtifactId` checked under the slot lease, returning 409 on mismatch. Manual uploads keep current behaviour when it is omitted.

- **Speaker candidates.** These are suggestion strings only; keep storing plain names of up to 80 characters (`transcript-format.js:21-41`).
  - Attendees: visits scheduled directly in Dynamics yield email-only attendees (`logistics-service.js:277-293`), and names fall back to the email (`:128`, `applicant-contacts.js:82`). Never offer an email as a speaker name, or it ends up in recipient-visible text. An invalid attendee map throws (`:306-309`); show "unavailable" and keep manual entry.
  - PI: use the project-leader contact name; `resolveProposalPI` calls ORCID and OpenAlex (`proposal-pi-identity.js:183,198`) and is the wrong reader.
  - Co-PIs: `fetchCoPIs` returns names only, but `queryCoPIs` already selects contact ids for dedup (`app-request-person.js:26-34`).

- **Recipient exposure.** Published rows are written as lifecycle Draft (`material-service.js:1825`) and readers exclude only Superseded. A published transcript therefore appears immediately on live presentation links, the Board briefing page and the Workbench (`presentation-page-service.js:79-82`, `briefing-page-service.js:294-295`, `logistics-service.js:395-397`). The Publish confirmation must say so. A keyword grep found no withdraw path; a wrong transcript can only be replaced.

- **Draft isolation is true by construction.** There are zero Dataverse, SharePoint or Request Document references in `lib/services/transcription-pilot/` and `pages/api/admin/transcription-pilot/`. Publish is the only bridge.

## Known limitations, not blockers

- Only one transcription can be in flight across the whole shared app (`060_transcription_jobs.sql:113-115`). An uncertain submission blocks every request until reconciled or abandoned, so Meeting Tracker needs wrappers for those two actions and a content-free "busy" message.
- Publishing requires a mapped Dataverse staff identity (`material-service.js:1666-1668`); show this before the user reaches Publish.
- Audio is deleted when the transcript is ready (`worker.js:102-106`), so re-transcribing means re-uploading.
- The malware scan will run on generated text; harmless, but a scanner outage makes Publish retryable rather than failed.
- Maximum-size (50 MiB) processing and scheduled cron delivery remain unverified per the Atlas.

## Plan corrections

- Workflow step 6 says "reuse the governed path" but that path is staging-bound; the plan should name the job-row ledger above.
- "Request access checked independently" overstates what exists: access is the app grant, the request flag and the bound visit, with no per-user request permission.
- The governed transcript row is bound to the request, not the visit (`:1820-1844`); visit binding is job-side only.
