/** Superuser-only immutable profile publication and fabricated shared-task preview. */
import { requireSuperuser } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { getPromptProfiles, publishPromptProfile, previewSharedTask } from '../../../lib/services/admin/prompt-profiles-service';

export const config = { api: { bodyParser: { sizeLimit: '128kb' } } };
export default async function handler(req, res) {
  if (!['GET', 'PUT', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, PUT, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const gate = await requireSuperuser(req, res);
  if (!gate) return;
  try {
    return await withDalContext('admin-prompt-profiles', async () => {
      try {
        if (req.method === 'GET') return res.json(await getPromptProfiles());
        if (req.method === 'POST') return res.json(await previewSharedTask({ task: req.body?.task }));
        const { profile, expectedVersion, requestId } = req.body || {};
        return res.json(await publishPromptProfile({ profile, expectedVersion, requestId, profileId: gate.profileId }));
      } catch (error) {
        if (error instanceof ServiceHttpError) return res.status(error.httpStatus).json(error.body ?? { error: error.message });
        throw error;
      }
    });
  } catch {
    // Avoid logging administrator-authored instruction text from storage failures.
    return res.status(500).json({ error: 'Profile configuration is unavailable. Retry or contact an administrator.' });
  }
}
