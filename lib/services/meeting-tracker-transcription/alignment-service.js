/**
 * Post-ready Zoom VTT speaker alignment (plan ZOOM_VTT_SPEAKER_MAPPING_PLAN_2026-10-04, section 7).
 *
 * Claims a ready job under the job lease, matches Zoom display names to provider speaker IDs by
 * wording evidence (zoom-vtt.js), asks the Executor for a verdict, re-verifies it deterministically,
 * and writes names through the fenced `completeAlignment`. The job's `status` never changes here.
 *
 * Privacy: transcript text, names, samples, verdicts, and error messages are never logged and
 * never persisted as failure codes; failures carry a code from the fixed allowlist below.
 */
import crypto from 'node:crypto';
import { executePrompt } from '../execute-prompt.js';
import { loadModelOverrides } from '../model-override-loader.js';
import { withDalContext } from '../../dataverse/core/context.js';
import {
  claimTranscriptionJobForAlignment, completeTranscriptionAlignment, failTranscriptionAlignment,
  claimNextPendingTranscriptionAlignmentJob, expireExhaustedTranscriptionAlignments,
} from '../transcription-pilot/store.js';
import { readPrivateContentIfPresent, MAX_ZOOM_TRANSCRIPT_BYTES } from '../transcription-pilot/runtime.js';
import {
  ZOOM_ALIGNMENT_DEFAULTS, buildAlignmentPrior, computeNameSupport, parseZoomVtt,
  sampleAlignmentPairs, verifyAlignmentVerdict, reassignShortUtterances,
} from '../transcription-pilot/zoom-vtt.js';
import { PROMPT_NAME } from '../../../shared/config/prompts/meeting-speaker-alignment.js';
import { VARIABLE_MAX, serializeSpeakerSamples } from './alignment-samples.js';

export { serializeSpeakerSamples };

const MAX_TRANSCRIPT_BYTES = 4_000_000;
const BLOB_READ_BUDGET_MS = 60_000;
const MIN_ALIGNMENT_BUDGET_MS = 45_000;
const RUN_SOURCE = 'Vercel Interactive';

const LEASE_SAFE_BUDGET_MS = 150_000;

/**
 * Terminal means retrying cannot change the outcome (the manual editor is the fallback):
 *   zoom_transcript_missing/invalid/hash_mismatch, transcript_missing/invalid/hash_mismatch,
 *   alignment_blocked, samples_over_budget, zoom_names_over_budget, content_too_large, and the
 *   Executor codes claude_output_schema_invalid/invalid_json/refused/incomplete/empty/missing_field,
 *   claude_context_window_exceeded, claude_output_truncated.
 * Non-terminal (retried up to the attempt cap): executor_deadline_exhausted, blob_deadline_exhausted,
 *   blob_read_failed, private_uploads_not_configured, and anything unrecognized (stored as
 *   alignment_unavailable).
 */
const TERMINAL_CODES = Object.freeze(new Set([
  'samples_over_budget', 'zoom_names_over_budget', 'content_too_large',
  'claude_output_missing_field', 'claude_output_empty',
  'zoom_transcript_missing', 'zoom_transcript_invalid', 'zoom_transcript_hash_mismatch',
  'transcript_missing', 'transcript_invalid', 'transcript_hash_mismatch', 'alignment_blocked',
  'claude_output_schema_invalid', 'claude_output_invalid_json', 'claude_output_refused',
  'claude_output_incomplete', 'claude_context_window_exceeded', 'claude_output_truncated',
]));
const NON_TERMINAL_CODES = Object.freeze(new Set([
  'executor_deadline_exhausted', 'blob_deadline_exhausted', 'blob_read_failed',
  'private_uploads_not_configured',
]));
const FALLBACK_CODE = 'alignment_unavailable';

class AlignmentFailure extends Error {
  constructor(code) { super(code); this.code = code; }
}

function classify(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  if (TERMINAL_CODES.has(code)) return { code, terminal: true };
  if (NON_TERMINAL_CODES.has(code)) return { code, terminal: false };
  return { code: FALLBACK_CODE, terminal: false };
}

const sha256 = buffer => crypto.createHash('sha256').update(buffer).digest('hex');

function fitNames(names, maxChars) {
  const kept = [];
  for (const name of names) {
    if (JSON.stringify([...kept, name]).length > maxChars) break;
    kept.push(name);
  }
  return kept;
}

function serializePrior(prior, allowedNames, maxChars) {
  const allowed = new Set(allowedNames);
  const ordered = Object.fromEntries(Object.entries(prior).map(([speakerId, rows]) => [
    speakerId, rows.map(row => row.name).filter(name => allowed.has(name)).slice(0, 5),
  ]));
  for (let limit = 5; limit >= 0; limit--) {
    const trimmed = Object.fromEntries(Object.entries(ordered).map(([id, list]) => [id, list.slice(0, limit)]));
    const text = JSON.stringify(trimmed);
    if (text.length <= maxChars) return text;
  }
  return '{}';
}

/** A verdict entry that cites a pair the model never saw is neutralized (suggestion-only outcome). */
function rejectUnseenCitations(verdict, keptPairIds) {
  if (!verdict || typeof verdict !== 'object' || Array.isArray(verdict)) return verdict;
  return Object.fromEntries(Object.entries(verdict).map(([id, entry]) => [id,
    entry && typeof entry === 'object' && Array.isArray(entry.pairIds)
      && entry.pairIds.some(pairId => !keptPairIds.has(pairId))
      ? { name: null, confidence: 0, pairIds: [], reason: 'cited_unseen_pair' } : entry]));
}

async function readBlob(pathname, maxBytes, deadline, missingCode) {
  const stored = await readPrivateContentIfPresent(pathname, maxBytes, deadline);
  if (!stored?.buffer) throw new AlignmentFailure(missingCode);
  return stored.buffer;
}

async function runAlignment(job, deadlineMs) {
  const blobDeadline = Math.min(deadlineMs, Date.now() + BLOB_READ_BUDGET_MS);
  const transcriptBuffer = await readBlob(job.output_pathname, MAX_TRANSCRIPT_BYTES, blobDeadline, 'transcript_missing');
  if (sha256(transcriptBuffer) !== job.output_sha256) throw new AlignmentFailure('transcript_hash_mismatch');
  const vttBuffer = await readBlob(job.zoom_transcript_pathname, MAX_ZOOM_TRANSCRIPT_BYTES, blobDeadline, 'zoom_transcript_missing');
  if (sha256(vttBuffer) !== job.zoom_transcript_sha256) throw new AlignmentFailure('zoom_transcript_hash_mismatch');

  let content;
  try { content = JSON.parse(transcriptBuffer.toString('utf8')); } catch { throw new AlignmentFailure('transcript_invalid'); }
  let parsed;
  try { parsed = parseZoomVtt(vttBuffer.toString('utf8')); } catch { throw new AlignmentFailure('zoom_transcript_invalid'); }
  const utterances = Array.isArray(content?.utterances) ? content.utterances : [];
  const names = fitNames(parsed.names, VARIABLE_MAX.zoom_names);
  if (names.length !== parsed.names.length) throw new AlignmentFailure('zoom_names_over_budget');

  const prior = buildAlignmentPrior(utterances, parsed.cues);
  const sampled = sampleAlignmentPairs(utterances, parsed.cues, { maxChars: VARIABLE_MAX.speaker_samples });
  // Reserved samples (the per-speaker minimum) are the same set the sampler picks with no extras.
  const reservedPairIds = new Set(sampleAlignmentPairs(utterances, parsed.cues, {
    maxChars: Infinity, maxPerSpeaker: ZOOM_ALIGNMENT_DEFAULTS.minPerSpeaker,
  }).samples.map(sample => sample.pairId));
  const { text: speakerSamples, keptPairIds, droppedReserved, droppedSpeaker } = serializeSpeakerSamples(
    sampled.samples, VARIABLE_MAX.speaker_samples, reservedPairIds);
  // Losing any reserved sample could erase a conflicting name: fail closed rather than decide on less.
  if (sampled.reservedOverBudget || droppedSpeaker || droppedReserved.length) throw new AlignmentFailure('samples_over_budget');
  // Conflict detection sees the FULL sampled set; only extras may have been trimmed from the prompt.
  const conflictSupport = computeNameSupport(sampled.samples, utterances, names, ZOOM_ALIGNMENT_DEFAULTS);
  // Positive acceptance sees only the samples serialized for the model: a name supported solely by a
  // trimmed sample cannot be applied on the model's say-so (Codex round 2). computeNameSupport itself
  // reads every utterance through the rendered text slice, so wording past it never counts (rounds 3-4).
  const visibleSamples = sampled.samples.filter(sample => keptPairIds.has(sample.pairId));
  const support = computeNameSupport(visibleSamples, utterances, names, ZOOM_ALIGNMENT_DEFAULTS);

  await loadModelOverrides();
  const result = await executePrompt({
    promptName: PROMPT_NAME,
    overrideVariables: {
      speaker_samples: speakerSamples,
      zoom_names: JSON.stringify(names),
      prior: serializePrior(prior, names, VARIABLE_MAX.prior),
    },
    runSource: RUN_SOURCE,
    requireNoPersistence: true,
    auditRetention: 'content-free',
    deadlineMs,
    forceOverwrite: true,
  });
  if (result?.blocked) throw new AlignmentFailure('alignment_blocked');
  const verdict = verifyAlignmentVerdict(visibleSamples, support, rejectUnseenCitations(result?.parsed, keptPairIds), {
    zoomNames: names, content, floor: ZOOM_ALIGNMENT_DEFAULTS.floor, conflictSupport,
  });
  // Short-utterance reassignment from Zoom evidence, keyed by the ORIGINAL Zoom names the alignment
  // applied (display reordering is cosmetic). Dropped, not truncated, if it would breach the 64 KiB row bound.
  const appliedZoomNames = Object.fromEntries(Object.entries(verdict.alignment.speakers || {})
    .map(([id, value]) => [id, value.zoomName ?? value.name]));
  if (Object.keys(appliedZoomNames).length) {
    const { reassigned, reassignedCount } = reassignShortUtterances(utterances, parsed.cues, appliedZoomNames, ZOOM_ALIGNMENT_DEFAULTS);
    const candidate = { ...verdict.alignment, reassigned, reassignedCount };
    if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') <= 65536) verdict.alignment = candidate;
    else verdict.alignment = { ...verdict.alignment, reassigned: {}, reassignedCount: 0, reassignedDropped: true };
  }
  return verdict;
}

/** Never throws for alignment failures; they are recorded on the row. Infrastructure errors propagate. */
export async function alignMeetingTranscriptionSpeakers({ jobId, deadlineMs = Date.now() + 150_000 }) {
  const claimed = await claimTranscriptionJobForAlignment({ jobId });
  if (!claimed) return { outcome: 'not_claimed' };
  const { job, leaseToken } = claimed;
  // Stay inside the 180 s lease even when the caller (cron recovery) offers more time.
  deadlineMs = Math.min(deadlineMs, Date.now() + LEASE_SAFE_BUDGET_MS);
  const fence = { jobId, leaseToken, expectedVersion: job.version };
  try {
    const { names, alignment } = await withDalContext('meeting-transcript-alignment', () => runAlignment(job, deadlineMs));
    const completed = await completeTranscriptionAlignment({ ...fence, speakerNames: names, alignment });
    if (!completed) return { outcome: 'superseded' };
    return { outcome: alignment.status };
  } catch (error) {
    const { code, terminal } = classify(error);
    console.warn('[meeting transcription alignment] failed:', code);
    const failed = await failTranscriptionAlignment({ ...fence, terminal, code });
    return failed ? { outcome: terminal ? 'failed' : 'retry', code } : { outcome: 'superseded' };
  }
}

/** Recovery: expire exhausted attempts, then run stranded or pending jobs until the deadline. */
export async function recoverPendingAlignments({ limit = 5, deadlineMs }) {
  const counts = { expired: 0, attempted: 0, outcomes: {} };
  const expired = await expireExhaustedTranscriptionAlignments({ limit });
  counts.expired = Array.isArray(expired) ? expired.length : 0;
  const ids = await claimNextPendingTranscriptionAlignmentJob({ limit });
  for (const jobId of ids) {
    if (deadlineMs - Date.now() < MIN_ALIGNMENT_BUDGET_MS) break;
    const { outcome } = await alignMeetingTranscriptionSpeakers({ jobId, deadlineMs });
    counts.attempted += 1;
    counts.outcomes[outcome] = (counts.outcomes[outcome] || 0) + 1;
  }
  return counts;
}
