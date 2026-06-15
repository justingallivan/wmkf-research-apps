/**
 * API Route: POST /api/field-primer/generate
 *
 * Generates a standalone, staff-facing FIELD PRIMER for a grant proposal's
 * research field. Decoupled from reviewer-candidate origination (no
 * discovery/save/COI write path).
 *
 * Two modes:
 *   - { requestId, regenerate? } — Workbench Proposal tab. Pulls the request's
 *     ProjectDescription from SharePoint, generates, grounds experts, and
 *     PERSISTS a JSON envelope to `akoya_request.wmkf_ai_fieldprimer`. Idempotent:
 *     returns the stored primer without a paid call unless `regenerate:true`.
 *     Concurrency: an ETag-conditional generation LEASE ensures only one cold
 *     generation runs per request — a racing request gets `{status:'generating'}`.
 *   - { proposalText, focus? } — standalone (CLI / ad-hoc). Generates + returns,
 *     NO persistence (no request to write to).
 *
 * Untrusted-content hardening + model resolution + audit logging live in the
 * Executor (executePrompt → field-primer.generate). See docs/EXECUTOR_CONTRACT.md.
 */

import { randomUUID } from 'crypto';
import { requireAppAccess } from '../../../lib/utils/auth';
import { loadModelOverrides } from '../../../lib/services/model-override-loader';
import { generateFieldPrimer, groundPrimerExperts } from '../../../lib/services/field-primer-service';
import { DynamicsService } from '../../../lib/services/dynamics-service';
import { bypassDynamicsRestrictions } from '../../../lib/services/dynamics-context';
import { meetingDateToCycleCode } from '../../../lib/utils/cycle-code';
import { getProposalText } from '../../../lib/services/workbench-proposal-documents';
import {
  FIELD_PRIMER_ENVELOPE_SCHEMA,
  parseFieldPrimerEnvelope,
  parseFieldPrimerLease,
  makeFieldPrimerLease,
} from '../../../shared/utils/field-primer-envelope';

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const config = {
  api: { bodyParser: { sizeLimit: '2mb' } },
  maxDuration: 800,
};

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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Accept the standalone reviewer-finder app AND the merged Workbench `reviewers`
  // grant (the Proposal tab calls this).
  const access = await requireAppAccess(req, res, 'reviewer-finder', 'reviewers');
  if (!access) return;

  await loadModelOverrides();

  const { proposalText, focus, requestId, regenerate } = req.body || {};
  const focusArg = typeof focus === 'string' ? focus : undefined;

  // ---- Mode A: requestId (Workbench) — persisted, single-flight -------------
  if (requestId !== undefined && requestId !== null && requestId !== '') {
    if (!GUID_RE.test(String(requestId))) {
      return res.status(400).json({ error: 'requestId is not a valid GUID' });
    }
    return bypassDynamicsRestrictions('field-primer-generate', async () => {
      const nowIso = new Date().toISOString();
      const nowMs = Date.now();

      let rec;
      try {
        rec = await DynamicsService.getRecord('akoya_requests', String(requestId), {
          select: 'akoya_requestid,akoya_requestnum,wmkf_meetingdate,wmkf_ai_fieldprimer',
        });
      } catch {
        return res.status(404).json({ error: `No request found for ${requestId}` });
      }

      const priorValue = rec.wmkf_ai_fieldprimer || null;

      // Already generated → return it, no paid call. (regenerate bypasses this.)
      const existing = parseFieldPrimerEnvelope(priorValue);
      if (existing && !regenerate) {
        return res.status(200).json({ envelope: existing, persisted: true, reused: true });
      }
      // A FRESH lease means another session is mid-generation — block EVERYONE,
      // including regenerate (don't stomp an in-flight generation). Stale leases
      // (TTL-expired / future-dated) fall through and are re-claimable.
      const lease = parseFieldPrimerLease(priorValue, nowMs);
      if (lease && lease.fresh) {
        return res.status(200).json({ status: 'generating' });
      }
      // Fail closed: without an ETag the claim can't be atomic, so we can't
      // single-flight safely. Better to ask the caller to retry than risk a
      // double cold generation.
      if (!rec._etag) {
        return res.status(503).json({ error: 'Could not acquire a generation lock; please try again.' });
      }

      // Atomically claim the generation lease (ETag optimistic concurrency) with a
      // unique nonce so the final persist can verify we still own it. A racing
      // claim 412s on the stale ETag and backs off — only one cold generation runs.
      const myNonce = randomUUID();
      try {
        await DynamicsService.updateRecord(
          'akoya_requests', rec.akoya_requestid,
          { wmkf_ai_fieldprimer: makeFieldPrimerLease(nowIso, myNonce) },
          { ifMatch: rec._etag },
        );
      } catch (e) {
        const re = await DynamicsService.getRecord('akoya_requests', rec.akoya_requestid, { select: 'wmkf_ai_fieldprimer' });
        const reEnv = parseFieldPrimerEnvelope(re.wmkf_ai_fieldprimer);
        if (reEnv) return res.status(200).json({ envelope: reEnv, persisted: true, reused: true });
        return res.status(200).json({ status: 'generating' });
      }

      // We hold the lease. Restore the prior value on ANY failure so a crashed
      // generation never leaves the field stuck on a lease, and a failed
      // REGENERATE doesn't destroy the existing primer.
      const restorePrior = async () => {
        try {
          await DynamicsService.updateRecord('akoya_requests', rec.akoya_requestid, { wmkf_ai_fieldprimer: priorValue });
        } catch (e) {
          console.error('[field-primer/generate] lease restore failed:', e.message);
        }
      };

      const cycleCode = rec.wmkf_meetingdate ? meetingDateToCycleCode(rec.wmkf_meetingdate) : null;
      let proposal;
      try {
        proposal = await getProposalText(rec.akoya_requestid, rec.akoya_requestnum, cycleCode);
      } catch (e) {
        console.error('[field-primer/generate] proposal fetch failed:', e.message);
        await restorePrior();
        return res.status(502).json({ error: 'Could not read the proposal document from SharePoint.' });
      }
      if (!proposal || !proposal.text || proposal.text.trim().length < 50) {
        await restorePrior();
        return res.status(400).json({ error: 'No readable Project Description document found for this request.' });
      }

      let gen;
      try {
        gen = await generateFieldPrimer({ proposalText: proposal.text, focus: focusArg, runSource: 'Vercel Interactive' });
      } catch (e) {
        console.error('[field-primer/generate] generation failed:', e.message);
        await restorePrior();
        return res.status(500).json({ error: 'Field primer generation failed.' });
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
        const cur = await DynamicsService.getRecord('akoya_requests', rec.akoya_requestid, {
          select: 'wmkf_ai_fieldprimer',
        });
        const curLease = parseFieldPrimerLease(cur.wmkf_ai_fieldprimer, Date.now());
        if (curLease && curLease.nonce === myNonce) {
          if (!cur._etag) {
            return res.status(200).json({ envelope, persisted: false, persistError: true });
          }
          await DynamicsService.updateRecord(
            'akoya_requests', rec.akoya_requestid,
            { wmkf_ai_fieldprimer: JSON.stringify(envelope) },
            { ifMatch: cur._etag },
          );
          return res.status(200).json({ envelope, persisted: true });
        }
        // We lost ownership (lease expired + reclaimed, or a peer already wrote a
        // result). Prefer the stored result; otherwise return ours unpersisted.
        const curEnv = parseFieldPrimerEnvelope(cur.wmkf_ai_fieldprimer);
        if (curEnv) return res.status(200).json({ envelope: curEnv, persisted: true, reused: true });
        return res.status(200).json({ envelope, persisted: false, persistError: true });
      } catch (e) {
        console.error('[field-primer/generate] persist failed:', e.message);
        // Generation succeeded; surface it even though the write failed. Our lease
        // self-expires after the TTL, so a later retry can re-claim.
        return res.status(200).json({ envelope, persisted: false, persistError: true });
      }
    });
  }

  // ---- Mode B: proposalText (standalone) — NOT persisted ----------------------
  if (!proposalText || typeof proposalText !== 'string' || proposalText.trim().length < 50) {
    return res.status(400).json({ error: 'proposalText is required (min ~50 chars), or pass a requestId.' });
  }
  try {
    const { primer, runId, model } = await generateFieldPrimer({
      proposalText,
      focus: focusArg,
      runSource: 'Vercel Interactive',
    });
    return res.status(200).json({ primer: await groundExperts(primer), runId, model });
  } catch (err) {
    console.error('[field-primer/generate] failed:', err.message);
    return res.status(500).json({ error: 'Field primer generation failed.' });
  }
}
