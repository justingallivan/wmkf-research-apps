/**
 * API Route: /api/admin/review-questions  (superuser only)
 *
 * The staff editor for the external-reviewer review question set
 * (wmkf_reviewquestion). Phase C of the staff-editable-questions epic.
 *
 * GET  — the current ACTIVE set (rows WITH their wmkf_reviewquestionid so the
 *        editor can update/reorder by identity) + a `version` token
 *        (questionSetVersion) for optimistic-concurrency on save.
 * POST — save the FULL ordered set the editor produced. Body:
 *        { questions: [{ id?, key, label, type, required, maxLength?, hint?, options? }], baseVersion }
 *
 * Thin route shell (Route→Service Consolidation Plan, Stage 5): multi-verb
 * dispatch inside ONE withDalContext (the historical route had a single shared
 * bypass for both verbs — P1m base case; label kept) → one service call per
 * verb → per-verb result/error→HTTP mapping. Business logic (validation,
 * baseVersion optimistic lock, atomic changeset, audit) lives in
 * lib/services/admin/review-questions-service.js.
 */

import { requireSuperuser } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { getQuestionSet, saveQuestionSet } from '../../../lib/services/admin/review-questions-service';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const gate = await requireSuperuser(req, res);
  if (!gate) return;

  try {
    return await withDalContext('admin-review-questions', async () => {
      if (req.method === 'GET') {
        try {
          return res.json(await getQuestionSet());
        } catch (err) {
          if (err instanceof ServiceHttpError) {
            return res.status(err.httpStatus).json(err.body ?? { error: err.message });
          }
          throw err;
        }
      }
      // POST (save)
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      try {
        const result = await saveQuestionSet({
          questions: body.questions,
          baseVersion: body.baseVersion,
          profileId: gate.profileId,
        });
        return res.status(200).json(result);
      } catch (err) {
        if (err instanceof ServiceHttpError) {
          return res.status(err.httpStatus).json(err.body ?? { error: err.message });
        }
        throw err;
      }
    });
  } catch (err) {
    console.error('[admin/review-questions] unexpected error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
