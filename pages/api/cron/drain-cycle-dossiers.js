import { withDalContext } from '../../../lib/dataverse/core/context';
import { drainCycleDossiers } from '../../../lib/services/cycle-dossier-worker';
import { verifyDossierCronSecret } from '../../../lib/services/cycle-dossier-rollout';
export const maxDuration = 300;
export default async function handler(req, res) {
  if (!['GET','POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
  if (!verifyDossierCronSecret(req, res)) return;
  if (process.env.CYCLE_DOSSIER_ENABLED !== 'true') return res.json({ enabled: false });
  return withDalContext('cron-drain-cycle-dossiers', async () => {
    try { return res.json(await drainCycleDossiers()); }
    catch (error) { console.error('[cycle-dossier-worker]', error.message); return res.status(503).json({ error: 'Dossier processing could not complete.' }); }
  });
}
