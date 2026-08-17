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
import {
  FIELD_PRIMER_ENVELOPE_SCHEMA,
  parseFieldPrimerEnvelope,
  parseFieldPrimerLease,
  makeFieldPrimerLease,
} from '../../../shared/utils/field-primer-envelope';

// Ground named experts against OpenAlex — a safety control (catches the
// forename-hallucination class), so there's no off switch. Fail-soft.
async function groundExperts(primer) {
  if (primer && Array.isArray(primer.experts)) {
    try {
      primer.experts = await groundPrimerExperts(primer.experts);
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
 * @throws {ServiceHttpError} 404 no request; 503 no ETag (lock unacquirable);
 *   502 SharePoint read failed; 400 no readable document; 500 generation failed
 */
export async function generateForRequest({ requestId, focus, regenerate }) {
  const nowIso = new Date().toISOString();
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
  // REGENERATE doesn't destroy the existing primer.
  const restorePrior = async () => {
    try {
      await grantRequestAdapter.updateById(rec.akoya_requestid, { wmkf_ai_fieldprimer: priorValue });
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

  let gen;
  try {
    gen = await generateFieldPrimer({ proposalText: proposal.text, focus, runSource: 'Vercel Interactive' });
  } catch (e) {
    console.error('[field-primer/generate] generation failed:', e.message);
    await restorePrior();
    throw new ServiceHttpError('Field primer generation failed.', { httpStatus: 500 });
  }
  const primer = await groundExperts(gen.primer);

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
    // Generation succeeded; surface it even though the write failed. Our lease
    // self-expires after the TTL, so a later retry can re-claim.
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
