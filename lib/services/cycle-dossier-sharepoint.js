/** Resolve one authoritative request destination; archive guesses never become
 * dossier write targets. Preview pins this identity and worker checks it again.
 */
import { getRequestSharePointBuckets } from '../utils/sharepoint-buckets';
import { GraphService } from './graph-service';
import { dossierError } from './cycle-dossier-store';
export async function resolveDossierDestination(requestId, requestNumber) {
  const buckets = (await getRequestSharePointBuckets(requestId, requestNumber, { requireResolvedParents: true })).filter(b => b.source === 'dynamics');
  if (buckets.length !== 1) throw dossierError('The request SharePoint destination is missing or ambiguous.');
  const { library, folder } = buckets[0];
  const siteId = await GraphService.getSiteId();
  const driveId = await GraphService.getDriveId(library, { siteId });
  const segments = folder.split('/').filter(Boolean);
  const requestFolder = await GraphService.getFileMetadataByPath(library, segments.slice(0, -1).join('/'), segments.at(-1), { siteId, driveId });
  if (!requestFolder?.id || requestFolder.mimeType) throw dossierError('The authoritative request SharePoint folder is unavailable.');
  return { library, folder, siteId, driveId, requestFolderId: requestFolder.id };
}
