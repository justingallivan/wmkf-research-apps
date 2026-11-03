/**
 * API Route: /api/admin/prompt-groups
 *
 * Superuser-only. PUT replaces the editable Admin prompt group list (add,
 * rename, reorder; no deletion, ids never change). Body:
 *   { groups: [{ id, label }], expectedRevision: string|null }
 * The current list and revision come from GET /api/admin/prompts. This path is
 * deliberately outside /api/admin/prompts/ so it can't capture a prompt named
 * "groups". Business logic: lib/services/admin/prompt-groups-service.js.
 */
import { requireSuperuser } from '../../../lib/utils/auth';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { savePromptGroups } from '../../../lib/services/admin/prompt-groups-service';

export default async function handler(req, res) {
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });
  const gate = await requireSuperuser(req, res);
  if (!gate) return;

  const { groups, expectedRevision } = req.body || {};
  try {
    return res.status(200).json(await savePromptGroups({
      groups,
      expectedRevision: expectedRevision ?? null,
      profileId: gate.profileId,
    }));
  } catch (err) {
    if (err instanceof ServiceHttpError) {
      return res.status(err.httpStatus).json(err.body ?? { error: err.message });
    }
    console.error('[admin/prompt-groups] save failed:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
