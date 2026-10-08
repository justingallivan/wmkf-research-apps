---
name: project-vercel-workflow-runs-pinned-to-deployment
description: "Vercel Workflow runs (transcription) keep executing on the deployment they started on; a worker fix does not reach in-flight jobs. Recovery: cancel the run in Vercel, then run drain-transcriptions?recovery=1."
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

Recovery that worked:
1. The owner cancels the pinned runs in the Vercel Workflows view.
2. The owner runs `/api/cron/drain-transcriptions?recovery=1`.
3. `recoverTerminalTranscriptionWorkflowDispatch` (`lib/services/transcription-pilot/store.js`)
   resets the dispatch to `pending`, and the cron starts a new run on its own (current)
   deployment.

Jobs keep their state, so a job in `saving` re-polled its finished AssemblyAI transcript with no
second charge.

**Why:** a fix that "deployed" but changed nothing cost an incident round trip.
**How to apply:** after merging a worker fix, list the active jobs and their
`transcription_workflow_dispatches.workflow_run_id`, and plan cancel plus recovery for runs
started before the deploy. Delete duplicate queued jobs first, or they will run on old code
too. Related: [[feedback-verify-deploy-is-the-merge-build]].
