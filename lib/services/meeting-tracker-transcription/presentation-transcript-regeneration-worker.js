/**
 * Cron worker for presentation_transcript_regenerations (Site Visit redesign slice C1). Drains rows queued by a
 * meeting-transcript correction publish and calls `generatePresentationTranscript`, the same function the staff
 * Generate button calls, as the staff member who published (stored actor columns), with the stored expectations.
 * The generator is idempotent (an already bound pair returns early) and re-checks the expectation under its slot
 * lease, so this worker is just another caller.
 *
 * Outcomes:
 *   success or already bound                        -> done
 *   409 meeting_transcript_current_changed          -> superseded (a newer publish replaced the transcript)
 *   supervised-test-mode refusal                    -> failed
 *   5xx, timeout, network error, 408, 429           -> pending again with 1 / 5 minute backoff; third claimed attempt -> failed
 *   any other 4xx                                   -> failed
 * A failed row leaves the card on its normal "Out of date" with Regenerate. The generator's own configuration 503s
 * (feature flags, schema readiness, no SharePoint folder) are retried like any 5xx and then fail.
 *
 * A table that migration 081 has not created yet makes the tick idle quietly (a deploy may land first).
 * Logs carry ids, states and codes only.
 */
import { generatePresentationTranscript } from '../post-presentation-materials/presentation-transcript-service.js';
import * as store from './presentation-transcript-regeneration-store.js';

/** Work deadline: handler entry + 270 s, 30 s under the cron's 300 s maxDuration. */
export const TICK_WORK_MS = 270_000;
/** One generation can run up to the generator route's 120 s; a new row is claimed only with this much time left. */
const NEXT_ROW_ALLOWANCE_MS = 130_000;
const LEASE_SECONDS = 330;
const MAX_ROWS_PER_TICK = 5;
const UNDEFINED_TABLE = '42P01';
const CODE = /^[a-z0-9_]{1,80}$/;
const TRANSIENT_CODES = new Set(['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND', 'UND_ERR_CONNECT_TIMEOUT']);

export const CURRENT_CHANGED_CODE = 'meeting_transcript_current_changed';
export const SUPERVISED_TEST_CODE = 'meeting_transcription_supervised_test_unsupported';

const safeCode = (error, fallback) => (typeof error?.code === 'string' && CODE.test(error.code) ? error.code : fallback);

/** Classify a generator error as 'superseded', 'transient' or 'failed'. Never throws. */
export function classifyGenerationError(error) {
  const status = Number(error?.httpStatus ?? error?.status ?? error?.response?.status);
  const code = typeof error?.code === 'string' ? error.code : '';
  if (status === 409 && code === CURRENT_CHANGED_CODE) return { kind: 'superseded', code };
  if (code === SUPERVISED_TEST_CODE) return { kind: 'failed', code };
  const noStatus = !Number.isFinite(status) || status === 0;
  const transient = error?.isTransient === true || error?.noResponse === true || status >= 500 || status === 408 || status === 429
    || TRANSIENT_CODES.has(code) || error?.name === 'AbortError' || error?.name === 'TimeoutError'
    // An error with no HTTP status and no application code is a network or runtime fault; the attempt cap bounds the retries.
    || (noStatus && !CODE.test(code));
  return { kind: transient ? 'transient' : 'failed', code: safeCode(error, transient ? 'presentation_transcript_regeneration_transient' : 'presentation_transcript_regeneration_failed') };
}

const DEFAULT_DEPENDENCIES = {
  ...store,
  generate: generatePresentationTranscript,
  now: () => Date.now(),
  log: line => console.warn(JSON.stringify(line)),
};

async function runOne(deps, claim) {
  const { row, leaseToken } = claim;
  const fence = { id: row.id, leaseToken };
  let outcome;
  try {
    await deps.generate({
      requestId: row.request_id, ownerProfileId: row.actor_profile_id, actingUserSystemId: row.acting_user_system_id,
      body: { expectedCurrentArtifactId: row.transcript_artifact_id, expectedCurrentFingerprint: row.transcript_fingerprint },
    });
    outcome = { kind: 'done', code: null };
  } catch (error) {
    outcome = classifyGenerationError(error);
  }
  let moved;
  if (outcome.kind === 'done') moved = await deps.markPresentationTranscriptRegenerationDone(fence);
  else if (outcome.kind === 'superseded') moved = await deps.supersedePresentationTranscriptRegeneration({ ...fence, failureCode: outcome.code });
  else if (outcome.kind === 'failed') moved = await deps.failPresentationTranscriptRegeneration({ ...fence, failureCode: outcome.code });
  else moved = await deps.retryPresentationTranscriptRegeneration({ ...fence, failureCode: outcome.code });
  // A null move means the lease was lost (expired and reclaimed); the new holder owns the row.
  const state = !moved ? 'lease_lost' : outcome.kind === 'transient' ? moved.state : outcome.kind;
  deps.log({ event: 'presentation_transcript_regeneration', id: row.id, requestId: row.request_id, attempt: row.attempts, outcome: state, code: outcome.code });
  return { outcome: state, code: outcome.code };
}

/**
 * One cron tick: reclaim expired leases, then claim and run due rows while time remains. Returns counts only:
 * { outcome: 'idle' | 'worked' | 'schema_not_ready', worked, results: [{ outcome, code }] }.
 */
export async function runPresentationTranscriptRegenerationTick({ deadlineMs } = {}, dependencies = {}) {
  const deps = { ...DEFAULT_DEPENDENCIES, ...dependencies };
  const deadline = Number.isFinite(deadlineMs) ? deadlineMs : deps.now() + TICK_WORK_MS;
  const results = [];
  try {
    await deps.recoverExpiredPresentationTranscriptRegenerations({ limit: 5 });
    while (results.length < MAX_ROWS_PER_TICK && (results.length === 0 || deadline - deps.now() >= NEXT_ROW_ALLOWANCE_MS)) {
      const claim = await deps.claimPresentationTranscriptRegeneration({ leaseSeconds: LEASE_SECONDS });
      if (!claim) break;
      results.push(await runOne(deps, claim));
    }
  } catch (error) {
    if (error?.code === UNDEFINED_TABLE) return { outcome: 'schema_not_ready', worked: 0, results };
    throw error;
  }
  return { outcome: results.length ? 'worked' : 'idle', worked: results.length, results };
}
