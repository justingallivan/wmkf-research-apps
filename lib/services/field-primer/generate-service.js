/**
 * Field Primer — generation service (Route→Service Consolidation Plan, Stage 5).
 *
 * Holds the business logic for POST /api/field-primer/generate; the route is a
 * thin shell (method dispatch, app-access guard, model-override warm, input
 * validation, DAL context for Mode A, HTTP mapping).
 *
 * Two modes (see the route header for the caller-facing contract):
 *   - generateForRequest — Workbench mode. Persists a JSON envelope to
 *     `akoya_request.wmkf_ai_fieldprimer` behind an ETag-conditional generation
 *     LEASE (nonce-verified) so only one cold generation runs per request.
 *     REQUIRES a trusted DAL context (the shell establishes it).
 *   - generateStandalone — CLI / ad-hoc. Generates + returns, NO persistence
 *     and NO Dataverse access, so the shell historically ran it OUTSIDE any
 *     trusted context — preserved (do not widen the trust scope over it).
 *
 * Contract (plan Decision 3): plain argument objects; returns the exact
 * 200-envelope objects the route sends; throws ServiceHttpError (all this
 * route's non-2xx envelopes are `{ error }`-shaped, so the default body works).
 */

import { randomUUID } from 'crypto';
import { generateFieldPrimer, groundPrimerExperts } from '../field-primer-service';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import { getAiProposalNarrativeText } from '../workbench-proposal-documents';
import { ServiceHttpError } from '../service-http-error';
import { getExecutorBudget } from '../executor-budget-service.js';
import { EXECUTOR_BUDGET_DEFAULTS } from '../../../shared/config/executorBudgets.js';
import { FIELD_PRIMER_PROMPT_NAME } from '../field-primer-service.js';
import {
  FIELD_PRIMER_ENVELOPE_SCHEMA,
  parseFieldPrimerEnvelope,
  parseFieldPrimerLease,
  makeFieldPrimerLease,
  FIELD_PRIMER_LEASE_TTL_MS,
} from '../../../shared/utils/field-primer-envelope';

/**
 * Map a generation failure to the typed error the route sends. The transport
 * timeout is the one failure staff can act on (retry, or raise the published
 * `field-primer.generate` budget), so it is named with its seconds and a 504.
 * A provider HTTP status becomes a short 502. Everything else stays a generic
 * 500: raw provider or stack text never reaches the browser.
 */
export function classifyGenerationFailure(error, { timeoutMs = null } = {}) {
  const message = typeof error?.message === 'string' ? error.message : '';
  if (error?.code === 'executor_deadline_exhausted') {
    return new ServiceHttpError(
      'Field primer generation stopped: the generation window closed before the model finished (a slow proposal load or provider retries used it up). Try again.',
      { httpStatus: 504, code: 'field_primer_lease_exhausted' },
    );
  }
  const timedOut = error?.name === 'AbortError'
    || error?.code === 'ETIMEDOUT'
    || /timeout after \d+ms/i.test(message);
  if (timedOut) {
    const seconds = Number.isInteger(timeoutMs) && timeoutMs > 0 ? Math.round(timeoutMs / 1000) : null;
    const within = seconds ? ` within ${seconds} seconds` : ' in time';
    return new ServiceHttpError(
      `Field primer generation timed out: the model did not finish${within}. Try again; if it keeps timing out, an admin can raise the field primer timeout under Admin → Prompt templates → Executor output budgets.`,
      { httpStatus: 504, code: 'field_primer_generation_timeout' },
    );
  }
  const status = Number.isInteger(error?.status) ? error.status : null;
  if (status && status >= 400) {
    return new ServiceHttpError(
      `Field primer generation failed: the model provider returned HTTP ${status}. Try again in a few minutes.`,
      { httpStatus: 502, code: 'field_primer_provider_error' },
    );
  }
  return new ServiceHttpError('Field primer generation failed.', {
    httpStatus: 500,
    code: 'field_primer_generation_failed',
  });
}

// Lease arithmetic. The lease (FIELD_PRIMER_LEASE_TTL_MS, counted from the
// claim) must outlive proposal pull + model call + expert grounding, or a peer
// can reclaim it and start a duplicate paid generation while ours is still
// running. Rather than trust a margin, the run is bounded against the lease:
// the model timeout is clamped so LEASE_GROUNDING_RESERVE_MS remains for
// grounding, and grounding itself is aborted (fail-soft, experts stay
// unverified) LEASE_SAFETY_MARGIN_MS before the lease expires.
export const LEASE_GROUNDING_RESERVE_MS = 45_000;
export const LEASE_SAFETY_MARGIN_MS = 15_000;
// Below this the model cannot realistically answer inside the lease. When the
// proposal pull has consumed that much of the lease, the run stops BEFORE the
// paid call instead of running past a lease a peer may reclaim.
export const MIN_MODEL_TIMEOUT_MS = 30_000;

// Resolve the server-owned transport timeout. A settings-store outage falls
// back to the bounded code default inside getExecutorBudget (non-strict read);
// anything else unexpected uses the same registry default rather than failing.
async function resolveGenerationTimeoutMs() {
  const fallback = EXECUTOR_BUDGET_DEFAULTS[FIELD_PRIMER_PROMPT_NAME].timeoutMsOverride;
  try {
    const budget = await getExecutorBudget(FIELD_PRIMER_PROMPT_NAME);
    return Number.isInteger(budget?.timeoutMsOverride) && budget.timeoutMsOverride > 0
      ? budget.timeoutMsOverride
      : fallback;
  } catch (e) {
    console.error('[field-primer/generate] executor budget read failed; using the registry default timeout:', e.message);
    return fallback;
  }
}

// Clamp the published timeout so the model call ends with grounding time left
// inside the lease. Returns null when the lease cannot cover even the minimum
// model call; the caller must not invoke the model in that case.
export function clampTimeoutToLease(timeoutMs, leaseDeadlineMs, nowMs = Date.now()) {
  const available = leaseDeadlineMs - nowMs - LEASE_GROUNDING_RESERVE_MS - LEASE_SAFETY_MARGIN_MS;
  if (available < MIN_MODEL_TIMEOUT_MS) return null;
  return Math.min(timeoutMs, available);
}

// Ground named experts against OpenAlex — a safety control (catches the
// forename-hallucination class), so there's no off switch. Fail-soft, and
// bounded by the lease deadline when one is supplied.
async function groundExperts(primer, { leaseDeadlineMs = null } = {}) {
  if (primer && Array.isArray(primer.experts)) {
    try {
      let signal;
      if (leaseDeadlineMs != null) {
        const remaining = leaseDeadlineMs - Date.now() - LEASE_SAFETY_MARGIN_MS;
        if (remaining <= 0) {
          console.warn('[field-primer/generate] lease nearly expired; skipping expert grounding');
          return primer;
        }
        signal = AbortSignal.timeout(remaining);
      }
      primer.experts = await groundPrimerExperts(primer.experts, { signal });
    } catch (e) {
      console.warn('[field-primer/generate] expert grounding failed:', e.message);
    }
  }
  return primer;
}

/**
 * Mode A: persisted, single-flight generation for a Dynamics request.
 * ASSUMES a trusted DAL context already exists.
 *
 * @param {Object} args
 * @param {string} args.requestId - GUID (already validated by the shell)
 * @param {string} [args.focus]
 * @param {boolean} [args.regenerate]
 * @returns {Promise<Object>} one of the historical 200 envelopes:
 *   { envelope, persisted, reused? } | { status: 'generating' } |
 *   { envelope, persisted: false, persistError: true }
 * @throws {ServiceHttpError} 404 no request; 503 no ETag (lock unacquirable); 504 transport timeout
 *   (`field_primer_generation_timeout`) or lease exhausted before the model call
 *   (`field_primer_lease_exhausted`); 502 provider HTTP error; 500 other generation failure;
 *   502 SharePoint read failed; 400 no readable document; 500 generation failed
 */
export async function generateForRequest({ requestId, focus, regenerate }) {
  const nowMs = Date.now();

  let rec;
  try {
    rec = await grantRequestAdapter.getById(String(requestId), {
      select: 'akoya_requestid,akoya_requestnum,wmkf_ai_fieldprimer',
    });
  } catch {
    throw new ServiceHttpError(`No request found for ${requestId}`, { httpStatus: 404 });
  }

  const priorValue = rec.wmkf_ai_fieldprimer || null;

  // Already generated → return it, no paid call. (regenerate bypasses this.)
  const existing = parseFieldPrimerEnvelope(priorValue);
  if (existing && !regenerate) {
    return { envelope: existing, persisted: true, reused: true };
  }
  // A FRESH lease means another session is mid-generation — block EVERYONE,
  // including regenerate (don't stomp an in-flight generation). Stale leases
  // (TTL-expired / future-dated) fall through and are re-claimable.
  const lease = parseFieldPrimerLease(priorValue, nowMs);
  if (lease && lease.fresh) {
    return { status: 'generating' };
  }
  // Fail closed: without an ETag the claim can't be atomic, so we can't
  // single-flight safely. Better to ask the caller to retry than risk a
  // double cold generation.
  if (!rec._etag) {
    throw new ServiceHttpError('Could not acquire a generation lock; please try again.', { httpStatus: 503 });
  }

  // Read the transport budget before claiming the lease so the settings read
  // never eats into the lease window.
  const publishedTimeoutMs = await resolveGenerationTimeoutMs();

  // The lease clock starts at the claim itself, not at function entry, so the
  // request read and the budget lookup above never count against it.
  const nowIso = new Date().toISOString();
  const leaseDeadlineMs = Date.parse(nowIso) + FIELD_PRIMER_LEASE_TTL_MS;
  // The model call must end with the grounding reserve and safety margin left.
  const modelDeadlineMs = leaseDeadlineMs - LEASE_GROUNDING_RESERVE_MS - LEASE_SAFETY_MARGIN_MS;

  // Atomically claim the generation lease (ETag optimistic concurrency) with a
  // unique nonce so the final persist can verify we still own it. A racing
  // claim 412s on the stale ETag and backs off — only one cold generation runs.
  const myNonce = randomUUID();
  try {
    await grantRequestAdapter.updateById(
      rec.akoya_requestid,
      { wmkf_ai_fieldprimer: makeFieldPrimerLease(nowIso, myNonce) },
      { ifMatch: rec._etag },
    );
  } catch (e) {
    const re = await grantRequestAdapter.getById(rec.akoya_requestid, { select: 'wmkf_ai_fieldprimer' });
    const reEnv = parseFieldPrimerEnvelope(re.wmkf_ai_fieldprimer);
    if (reEnv) return { envelope: reEnv, persisted: true, reused: true };
    return { status: 'generating' };
  }

  // We hold the lease. Restore the prior value on ANY failure so a crashed
  // generation never leaves the field stuck on a lease, and a failed
  // REGENERATE doesn't destroy the existing primer. Every restore is
  // conditional: only while the stored lease still carries OUR nonce, and only
  // against its current ETag, so a run that outlived its lease can never
  // overwrite a peer's newer lease or envelope.
  const restorePrior = async () => {
    try {
      const cur = await grantRequestAdapter.getById(rec.akoya_requestid, { select: 'wmkf_ai_fieldprimer' });
      const lease = parseFieldPrimerLease(cur.wmkf_ai_fieldprimer, Date.now());
      if (lease && lease.nonce === myNonce && cur._etag) {
        await grantRequestAdapter.updateById(
          rec.akoya_requestid,
          { wmkf_ai_fieldprimer: priorValue },
          { ifMatch: cur._etag },
        );
      }
    } catch (e) {
      console.error('[field-primer/generate] lease restore failed:', e.message);
    }
  };

  let proposal;
  try {
    proposal = await getAiProposalNarrativeText(rec.akoya_requestid, rec.akoya_requestnum);
  } catch (e) {
    console.error('[field-primer/generate] proposal fetch failed:', e.message);
    await restorePrior();
    throw new ServiceHttpError('Could not read the proposal document from SharePoint.', { httpStatus: 502 });
  }
  if (!proposal || !proposal.text || proposal.text.trim().length < 50) {
    await restorePrior();
    throw new ServiceHttpError(
      `No readable AI proposal narrative was found at AI Materials/ProposalNarrative_${rec.akoya_requestnum}.pdf.`,
      { httpStatus: 400 },
    );
  }

  const timeoutMs = clampTimeoutToLease(publishedTimeoutMs, leaseDeadlineMs);
  if (timeoutMs == null) {
    console.error('[field-primer/generate] lease exhausted before the model call (slow proposal pull); not generating');
    await restorePrior();
    throw new ServiceHttpError(
      'Field primer generation did not start: loading the proposal took so long that the generation window closed. Try again.',
      { httpStatus: 504, code: 'field_primer_lease_exhausted' },
    );
  }
  let gen;
  try {
    gen = await generateFieldPrimer({
      proposalText: proposal.text,
      focus,
      runSource: 'Vercel Interactive',
      timeoutMs,
      // Enforced again by the Executor immediately before the provider call, so
      // prompt/model preflight cannot push the paid call past the lease.
      deadlineMs: modelDeadlineMs,
    });
  } catch (e) {
    console.error('[field-primer/generate] generation failed:', e.message);
    await restorePrior();
    throw classifyGenerationFailure(e, { timeoutMs });
  }
  const primer = await groundExperts(gen.primer, { leaseDeadlineMs });

  const envelope = {
    schema: FIELD_PRIMER_ENVELOPE_SCHEMA,
    generatedAt: nowIso,
    model: gen.model,
    runId: gen.runId,
    promptName: gen.promptName,
    promptVersion: gen.promptVersion ?? null,
    primer,
  };
  // Persist ONLY if we still own the lease (nonce match), conditionally on a
  // fresh ETag — so a regenerate/slow generator can't overwrite a newer
  // envelope, and we never clobber a peer that reclaimed an expired lease.
  try {
    const cur = await grantRequestAdapter.getById(rec.akoya_requestid, {
      select: 'wmkf_ai_fieldprimer',
    });
    const curLease = parseFieldPrimerLease(cur.wmkf_ai_fieldprimer, Date.now());
    if (curLease && curLease.nonce === myNonce) {
      if (!cur._etag) {
        await restorePrior();
        return { envelope, persisted: false, persistError: true };
      }
      await grantRequestAdapter.updateById(
        rec.akoya_requestid,
        { wmkf_ai_fieldprimer: JSON.stringify(envelope) },
        { ifMatch: cur._etag },
      );
      return { envelope, persisted: true };
    }
    // We lost ownership (lease expired + reclaimed, or a peer already wrote a
    // result). Prefer the stored result; otherwise return ours unpersisted.
    const curEnv = parseFieldPrimerEnvelope(cur.wmkf_ai_fieldprimer);
    if (curEnv) return { envelope: curEnv, persisted: true, reused: true };
    return { envelope, persisted: false, persistError: true };
  } catch (e) {
    console.error('[field-primer/generate] persist failed:', e.message);
    // Generation succeeded; surface it even though the write failed. Put the
    // prior value back if we still hold the lease so the field is not stuck on
    // a lease marker until the TTL; a later retry can then re-claim at once.
    await restorePrior();
    return { envelope, persisted: false, persistError: true };
  }
}

/**
 * Mode B: standalone generation — NOT persisted, no Dataverse access.
 * Runs OUTSIDE any trusted DAL context (historical scope preserved).
 *
 * @param {Object} args
 * @param {string} args.proposalText - already validated by the shell
 * @param {string} [args.focus]
 * @returns {Promise<{ primer: Object, runId: string, model: string }>}
 * @throws {ServiceHttpError} 500 on generation failure
 */
export async function generateStandalone({ proposalText, focus }) {
  try {
    const { primer, runId, model } = await generateFieldPrimer({
      proposalText,
      focus,
      runSource: 'Vercel Interactive',
    });
    return { primer: await groundExperts(primer), runId, model };
  } catch (err) {
    console.error('[field-primer/generate] failed:', err.message);
    throw new ServiceHttpError('Field primer generation failed.', { httpStatus: 500 });
  }
}
