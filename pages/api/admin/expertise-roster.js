/** Superuser-only roster editor. Consumer reads retain their own app guards. */
import { requireSuperuser, getSession } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { usesDataverseRoster } from '../../../lib/services/expertise-finder/roster-mode';
import { listRoster, saveRoster } from '../../../lib/services/expertise-finder/roster-service';
import { getRosterContactById, searchRosterContacts } from '../../../lib/services/expertise-finder/roster-contact-link-service';
import { isGuid } from '../../../lib/utils/guid';
export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!['GET', 'POST', 'PATCH'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST, PATCH');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const access = await requireSuperuser(req, res);
  if (!access) return;
  return withDalContext('admin-expertise-roster', async () => {
    try {
      if (!usesDataverseRoster()) return res.status(req.method === 'GET' ? 200 : 409).json({ backend: 'postgres', error: 'The Admin roster editor becomes available after the roster migration.' });
      if (req.method === 'GET') {
        const query = req.query || {};
        if (Object.entries(query).some(([k, v]) => !['id', 'q', 'contactId', 'search', 'includeInactive', 'roleType'].includes(k) || typeof v !== 'string')) {
          return res.status(400).json({ error: 'Invalid roster query.' });
        }
        if (query.contactId !== undefined) {
          if (!isGuid(query.contactId)) return res.status(400).json({ error: 'Invalid Contact identity.' });
          return res.json({ contact: await getRosterContactById(query.contactId.toLowerCase()) });
        }
        if (query.q !== undefined) return res.json(await searchRosterContacts(query.q));
        if (query.id !== undefined && !isGuid(query.id)) return res.status(400).json({ error: 'Invalid roster identity.' });
        return res.json(await listRoster(query));
      }
      const session = await getSession(req, res);
      if (!session?.user || Number(session.user.profileId) !== Number(access.profileId)) {
        return res.status(403).json({ error: 'Your staff identity could not be verified.' });
      }
      const id = req.body?.id;
      if (req.method === 'PATCH' && !isGuid(id)) return res.status(400).json({ error: 'Invalid roster identity.' });
      const result = await saveRoster(req.body, session.user.dynamicsSystemuserId, { create: req.method === 'POST' });
      return res.status(req.method === 'POST' ? 201 : 200).json(result);
    } catch (error) {
      const status = error.httpStatus || error.status;
      console.error('Admin roster operation failed:', error.code || error.name);
      return res.status([400, 403, 404, 409, 412, 503].includes(status) ? status : 503).json({
        error: status === 412 ? 'The saved version changed. Reload it before saving again.' : error.serviceName && status === 403 ? 'Dataverse denied this operation. Ask an administrator to check your roster permissions.' : error.httpStatus || (error.status && !error.serviceName) ? error.message : 'The roster operation could not be completed. Reload or retry.',
      });
    }
  });
}
