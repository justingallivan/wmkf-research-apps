/**
 * Single source for the transcription audio byte cap.
 *
 * Shared by the browser pickers (Meeting Tracker panel, admin pilot page), the
 * runtime token/start validation, the store's row validation, the media
 * inspector, and the AssemblyAI upload guard. The database CHECK constraints
 * on transcription_jobs.declared_bytes / verified_bytes mirror this value
 * (migration 066); raising it again needs a new migration.
 *
 * Why 200 MiB (2026-10-04): an observed Zoom M4A ran about 0.66 MB per
 * minute (40.8 MB for 62 minutes), so the original 50 MiB pilot cap covered
 * roughly 76 minutes. 200 MiB covers about five hours at that rate; the
 * four-hour duration cap (media-inspector.js) is the governing limit again.
 * The worker still buffers the whole file in Function memory (caller buffer
 * plus a worker copy for inspection plus the upload body), so this is a
 * memory-bounded ceiling, not a provider or Blob limit. Streaming the Blob
 * read into the provider upload is the planned follow-up that removes it.
 */
export const MAX_TRANSCRIPTION_MIB = 200;
export const MAX_TRANSCRIPTION_BYTES = MAX_TRANSCRIPTION_MIB * 1024 * 1024;

/**
 * Per-utterance text cap, shared by the worker's provider normalization and the
 * Meeting Tracker bundle builder; the two must agree or a transcript accepted
 * by one is rejected by the other.
 *
 * Why 200,000 (2026-10-08): a real site-visit presentation produced one
 * uninterrupted utterance of 24,213 characters. The former 20,000 cap rejected
 * it with an uncoded error, and the job retried in 'saving' indefinitely while
 * holding the single global transcription slot. Total size stays bounded by the
 * worker's 12 MiB text cap and 4 MB serialized-output cap.
 */
export const MAX_TRANSCRIPT_UTTERANCE_CHARS = 200_000;
