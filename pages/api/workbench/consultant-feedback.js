/**
 * API: /api/workbench/consultant-feedback
 * (docs/plans/CONSULTANT_FEEDBACK_PLAN_2026-09-14.md §3.4)
 *
 * GET    ?requestId=<GUID>            → list active entries for the request.
 * POST   { requestId, mutationId, consultantRosterId | oneOff, bodyHtml, receivedOn, shared } → create.
 * PATCH  { id, requestId, ...patch }  → update body/receivedOn/shared/author.
 * DELETE { id, requestId }            → hard delete.
 *
 * Same `reviewers` app gate as the sibling `staff-deliberations` route.
 * Actor identity is `access.profileId` from the authenticated session, never
 * from the request body.
 */
import { requireAppAccess } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import {
  listConsultantFeedback,
  writeFeedbackEntry,
  updateFeedbackEntry,
  deleteFeedbackEntry,
} from '../../../lib/services/consultant-feedback-service';

export default async function handler(req, res) {
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;

  return withDalContext('workbench-consultant-feedback', async () => {
    try {
      if (req.method === 'GET') {
        const requestId = String(req.query.requestId || '').trim();
        return res.status(200).json({ items: await listConsultantFeedback({ requestId }) });
      }

      if (req.method === 'POST') {
        const body = req.body || {};
        const entry = await writeFeedbackEntry({
          requestId: String(body.requestId || '').trim(),
          actorProfileId: access.profileId,
          mutationId: String(body.mutationId || '').trim(),
          consultantRosterId: body.consultantRosterId ?? null,
          oneOff: body.oneOff ?? null,
          bodyHtml: body.bodyHtml,
          receivedOn: body.receivedOn,
          shared: body.shared,
        });
        return res.status(200).json({ item: entry });
      }

      if (req.method === 'PATCH') {
        const body = req.body || {};
        // requestdocumentId is bound only by the finalize service
        // (lib/services/consultant-feedback-attachment-service.js), never by
        // this client-facing route (plan §5).
        const { id, requestId, requestdocumentId: _stripped, ...patch } = body;
        const entry = await updateFeedbackEntry({
          id,
          requestId: String(requestId || '').trim(),
          actorProfileId: access.profileId,
          patch,
        });
        return res.status(200).json({ item: entry });
      }

      // DELETE
      const body = req.body || {};
      const result = await deleteFeedbackEntry({
        id: body.id,
        requestId: String(body.requestId || '').trim(),
        actorProfileId: access.profileId,
      });
      return res.status(200).json({ ok: true, ...result });
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body ?? { error: error.message });
      }
      console.error('workbench consultant-feedback error:', error);
      return res.status(500).json({
        error: 'Consultant feedback request failed.',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  });
}
