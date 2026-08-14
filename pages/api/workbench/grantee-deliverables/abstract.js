/**
 * API: /api/workbench/grantee-deliverables/abstract
 *
 * Lets a Program Director review + EDIT + SAVE the grantee award abstract that
 * will be PUBLISHED, from the Workbench Awardee tab (S278).
 *
 *   GET ?requestId=  -> { abstractFormatted, abstractApproved, effective,
 *                         effectiveField, etag, status, statusLabel, editable,
 *                         caption, imageRef, imageUrl, hasImage, submittedAt,
 *                         invitedAt, remindedAt }
 *   PUT { requestId, text, etag, baseField }
 *
 * Thin multi-verb route shell (Route→Service Consolidation Plan, Stage 4
 * series C — P1m template): method dispatch → auth guard → per-verb input
 * validation → per-verb `withDalContext` → one service method per verb →
 * per-verb error mapping. The two historical branch-specific DAL scopes
 * ('grantee-abstract-load' / 'grantee-abstract-save') are PRESERVED per the
 * P1m ruling caveat. All target-resolution / provenance / status-gate /
 * concurrency logic lives in
 * lib/services/workbench/grantee-deliverables/abstract-service.js.
 *
 * AUTH: requireAppAccess('reviewers') (matches the other grantee-deliverable
 * workbench routes). requestId GUID-validated off req.body/req.query before it
 * becomes a record selector (check:trust-boundary-guid).
 */

import { requireAppAccess } from '../../../../lib/utils/auth';
import { withDalContext } from '../../../../lib/dataverse/core/context';
import { isGuid } from '../../../../lib/utils/guid';
import { ServiceHttpError } from '../../../../lib/services/service-http-error';
import { loadGranteeAbstract, saveGranteeAbstract } from '../../../../lib/services/workbench/grantee-deliverables/abstract-service';
import { MAX_GRANTEE_ABSTRACT_MARKDOWN_LENGTH } from '../../../../shared/config/granteeAbstract';

export const config = {
  api: { bodyParser: { sizeLimit: '32kb' } },
};

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'PUT') {
    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;

  if (req.method === 'GET') {
    // GUID-validate BEFORE requestId becomes a record-id selector.
    const requestId = typeof req.query?.requestId === 'string' ? req.query.requestId.trim() : '';
    if (!isGuid(requestId)) {
      return res.status(400).json({ error: 'requestId must be a GUID' });
    }
    return withDalContext('grantee-abstract-load', async () => {
      try {
        const body = await loadGranteeAbstract({ requestId });
        return res.status(200).json(body);
      } catch (error) {
        if (error instanceof ServiceHttpError) {
          return res.status(error.httpStatus).json(error.body ?? { error: error.message });
        }
        console.error('[grantee-deliverables/abstract] load error:', error);
        return res.status(500).json({ error: 'Failed to load the abstract.' });
      }
    });
  }

  // PUT — save a PD edit.
  // Read requestId directly off req.body so the trust-boundary-guid gate tracks
  // the taint root through to the isGuid guard.
  const requestId = typeof req.body?.requestId === 'string' ? req.body.requestId.trim() : '';
  if (!isGuid(requestId)) {
    return res.status(400).json({ error: 'requestId must be a GUID' });
  }

  const text = typeof req.body?.text === 'string' ? req.body.text : null;
  const clientEtag = typeof req.body?.etag === 'string' ? req.body.etag.trim() : '';
  const baseField = req.body?.baseField === 'approved' || req.body?.baseField === 'formatted'
    ? req.body.baseField
    : null;

  if (text === null) {
    return res.status(400).json({ error: 'text is required' });
  }
  if (!text.trim()) {
    // Never blank the published abstract through this path.
    return res.status(400).json({ error: 'The abstract cannot be empty.' });
  }
  if (text.length > MAX_GRANTEE_ABSTRACT_MARKDOWN_LENGTH) {
    return res.status(400).json({ error: `The abstract is too long (max ${MAX_GRANTEE_ABSTRACT_MARKDOWN_LENGTH} characters).` });
  }
  // Fail closed: without the loaded etag the write can't be conditional, so we
  // refuse rather than risk a bare last-write PATCH.
  if (!clientEtag) {
    return res.status(400).json({ error: 'etag is required for a conditional save' });
  }

  return withDalContext('grantee-abstract-save', async () => {
    try {
      const body = await saveGranteeAbstract({
        requestId,
        text,
        clientEtag,
        baseField,
        actingUserSystemId: access.session?.user?.dynamicsSystemuserId || null,
      });
      return res.status(200).json(body);
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body ?? { error: error.message });
      }
      console.error('[grantee-deliverables/abstract] save error:', error);
      return res.status(500).json({ error: 'Failed to save the abstract.' });
    }
  });
}
