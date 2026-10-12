// "A newer transcript is on its way" for a Site Visit's meeting transcription. Shared by the Recording and transcript
// card (which disables every edit of the published transcript while it holds) and createMeetingCorrection (which
// refuses on the server), so the UI gate and the server guard cannot drift. Inputs are the projected shapes the
// transcription overview returns: jobs from projectMeetingTranscriptionJob, publications from publicationDto.

export const BLOCKING_STATUSES = new Set(['queued', 'submitting', 'processing', 'saving']);
export const PUBLISHED_FOR_JOB = new Set(['published', 'published_reconcile', 'unknown']);
// A cancelled queued run stays 'queued' until its audio is cleaned up, which can take days for an uploaded file. It no
// longer blocks a new transcription.
export const isCancelledRun = (job) => job?.status === 'queued' && job.cleanupPending === true;

const createdAtMs = (job) => {
  const ms = new Date(job?.created_at ?? '').getTime();
  return Number.isFinite(ms) ? ms : 0;
};

// Pending means a run still transcribing (not being cancelled), or an unpublished ready run, newer than the latest
// published run, whose content can still be reviewed. It does not depend on which run is focused for review, and a
// discarded, expired, purged or unreadable run never blocks (queue: "Old-transcript edit buttons look current";
// Site Visit redesign commit 3, Codex rounds 1-2).
export function isNewerMeetingTranscriptPending({ jobs = [], publications = [] } = {}) {
  const isPublishedJob = (job) => publications.some((row) => row.inputJobId === job.id && PUBLISHED_FOR_JOB.has(row.state));
  const latestPublishedAt = Math.max(0, ...jobs.filter(isPublishedJob).map(createdAtMs));
  const reviewableReady = (job) => job.status === 'ready' && job.contentAccessAllowed === true && !job.cleanup_requested_at
    && !job.content_purged_at && job.cleanupPending !== true;
  return jobs.some((job) => BLOCKING_STATUSES.has(job.status) && !isCancelledRun(job) && job.cleanupPending !== true)
    || jobs.some((job) => reviewableReady(job) && !isPublishedJob(job) && createdAtMs(job) > latestPublishedAt);
}
