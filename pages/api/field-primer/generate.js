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
 *   - { proposalText, focus? } — standalone (CLI / ad-hoc). Generates + returns,
 *     NO persistence (no request to write to).
 *
 * Untrusted-content hardening + model resolution + audit logging live in the
 * Executor (executePrompt → field-primer.generate). See docs/EXECUTOR_CONTRACT.md.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { loadModelOverrides } from '../../../lib/services/model-override-loader';
import { generateFieldPrimer, groundPrimerExperts } from '../../../lib/services/field-primer-service';
import { DynamicsService } from '../../../lib/services/dynamics-service';
import { bypassDynamicsRestrictions } from '../../../lib/services/dynamics-context';
import { meetingDateToCycleCode } from '../../../lib/utils/cycle-code';
import { getProposalText } from '../../../lib/services/workbench-proposal-documents';

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENVELOPE_SCHEMA = 'field-primer/v1';

export const config = {
  api: { bodyParser: { sizeLimit: '2mb' } },
  maxDuration: 800,
};

function parseEnvelope(raw) {
  if (!raw) return null;
  try {
    const env = JSON.parse(raw);
    return env && env.primer ? env : null;
  } catch {
    return null;
  }
}

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

  // ---- Mode A: requestId (Workbench) — persisted -----------------------------
  if (requestId !== undefined && requestId !== null && requestId !== '') {
    if (!GUID_RE.test(String(requestId))) {
      return res.status(400).json({ error: 'requestId is not a valid GUID' });
    }
    return bypassDynamicsRestrictions('field-primer-generate', async () => {
      let rec;
      try {
        rec = await DynamicsService.getRecord('akoya_requests', String(requestId), {
          select: 'akoya_requestid,akoya_requestnum,wmkf_meetingdate,wmkf_ai_fieldprimer',
        });
      } catch {
        return res.status(404).json({ error: `No request found for ${requestId}` });
      }

      // Already generated and not regenerating → return it, no paid call.
      const existing = parseEnvelope(rec.wmkf_ai_fieldprimer);
      if (existing && !regenerate) {
        return res.status(200).json({ envelope: existing, persisted: true, reused: true });
      }

      // Pull the proposal text (ProjectDescription) from SharePoint.
      const cycleCode = rec.wmkf_meetingdate ? meetingDateToCycleCode(rec.wmkf_meetingdate) : null;
      let proposal;
      try {
        proposal = await getProposalText(rec.akoya_requestid, rec.akoya_requestnum, cycleCode);
      } catch (e) {
        console.error('[field-primer/generate] proposal fetch failed:', e.message);
        return res.status(502).json({ error: 'Could not read the proposal document from SharePoint.' });
      }
      if (!proposal || !proposal.text || proposal.text.trim().length < 50) {
        return res.status(400).json({ error: 'No readable Project Description document found for this request.' });
      }

      let gen;
      try {
        gen = await generateFieldPrimer({ proposalText: proposal.text, focus: focusArg, runSource: 'Vercel Interactive' });
      } catch (e) {
        console.error('[field-primer/generate] generation failed:', e.message);
        return res.status(500).json({ error: 'Field primer generation failed.' });
      }
      const primer = await groundExperts(gen.primer);

      const envelope = {
        schema: ENVELOPE_SCHEMA,
        generatedAt: new Date().toISOString(),
        model: gen.model,
        runId: gen.runId,
        promptName: gen.promptName,
        promptVersion: gen.promptVersion ?? null,
        primer,
      };

      // Pre-write re-check: if another tab persisted one while we generated, don't
      // clobber it (unless regenerate was explicit).
      try {
        const now = await DynamicsService.getRecord('akoya_requests', rec.akoya_requestid, { select: 'wmkf_ai_fieldprimer' });
        const concurrent = parseEnvelope(now.wmkf_ai_fieldprimer);
        if (concurrent && !regenerate) {
          return res.status(200).json({ envelope: concurrent, persisted: true, reused: true });
        }
        await DynamicsService.updateRecord('akoya_requests', rec.akoya_requestid, {
          wmkf_ai_fieldprimer: JSON.stringify(envelope),
        });
      } catch (e) {
        console.error('[field-primer/generate] persist failed:', e.message);
        // Generation succeeded; surface the primer even though the write failed.
        return res.status(200).json({ envelope, persisted: false, persistError: true });
      }
      return res.status(200).json({ envelope, persisted: true });
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
