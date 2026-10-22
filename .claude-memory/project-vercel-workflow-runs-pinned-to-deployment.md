---
name: project-vercel-workflow-runs-pinned-to-deployment
description: "A dated S586 incident showed transcription Workflow runs pinned to their starting deployment. Use owner-scoped run/job/attempt inventory and current status before any authorized recovery; no general cancellation or queued-job deletion instruction."
status: active
last_verified: 2026-10-08 via Vercel log deploymentId per /.well-known/workflow/v1/flow request and the S586 recovery
metadata:
  type: project
---

## Recall Rule

Read before shipping a fix to `lib/services/transcription-pilot/worker.js` (or anything a
transcription workflow step calls), or when a transcription job keeps failing after a deploy.

[VERIFIED 2026-10-08, S586] During the transcription-queue incident, the 20,000-character cap fix
(PR #465) deployed at about 12:55 PT, but the stuck job kept failing. Vercel logs showed the
`/.well-known/workflow/v1/flow` requests served by three older deployments (06:42, 12:11 and
12:25 PT), one per run start time. No run used the new deployment.

Observed recovery in that S586 incident:
1. The owner canceled the then-pinned runs in the Vercel Workflows view.
2. The owner ran `/api/cron/drain-transcriptions?recovery=1`.
3. `recoverTerminalTranscriptionWorkflowDispatch` (`lib/services/transcription-pilot/store.js`)
   reset a matching terminal run dispatch to `pending`; the drain started a new run.

In that incident, a job in `saving` re-polled its finished AssemblyAI transcript without
a second charge. This is a dated observation, not a guarantee for other statuses or jobs.
Current recovery checks terminal status and matches the exact job, workflow run, and
attempt; it also requires the job to remain eligible (not expired or pending cleanup).
The drain is bounded and can leave recovery incomplete.

**Why:** a fix that "deployed" but changed nothing cost an incident round trip.
**How to apply:** before proposing recovery, build a read-only, owner-scoped inventory
with named run IDs, job IDs, attempt numbers, and current workflow/job status. Confirm
which runs are terminal and eligible against current source. Any cancellation or other
change requires an owner-authorized action scoped to those named records; do not assume
there is current API authorization to cancel runs or delete jobs, and do not delete
queued jobs as a blanket precaution. Related: [[feedback-verify-deploy-is-the-merge-build]].
