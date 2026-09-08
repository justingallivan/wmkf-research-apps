jest.mock('../../lib/utils/sharepoint-buckets', () => ({ getRequestSharePointBuckets: jest.fn() }));
jest.mock('../../lib/services/graph-service', () => ({ GraphService: { getSiteId: jest.fn(async () => 'site'), getDriveId: jest.fn(async () => 'drive'), getFileMetadataByPath: jest.fn() } }));
jest.mock('../../lib/services/cycle-dossier-store', () => ({ dossierError: message => new Error(message) }));
import { getRequestSharePointBuckets } from '../../lib/utils/sharepoint-buckets';
import { GraphService } from '../../lib/services/graph-service';
import { resolveDossierDestination } from '../../lib/services/cycle-dossier-sharepoint';

beforeEach(() => { jest.clearAllMocks(); getRequestSharePointBuckets.mockResolvedValue([{ source: 'dynamics', library: 'Requests', folder: 'Org/Request' }]); GraphService.getFileMetadataByPath.mockResolvedValue({ id: 'request-folder', mimeType: null }); });

test('pins the existing authoritative folder identity before artifact creation', async () => {
  expect(await resolveDossierDestination('request', 'D26-1')).toEqual({ siteId: 'site', driveId: 'drive', library: 'Requests', folder: 'Org/Request', requestFolderId: 'request-folder' });
  expect(GraphService.getFileMetadataByPath).toHaveBeenCalledWith('Requests', 'Org', 'Request', { siteId: 'site', driveId: 'drive' });
});
test.each([null, { id: 'file', mimeType: 'application/pdf' }])('refuses nonexistent or file-valued request roots', async metadata => {
  GraphService.getFileMetadataByPath.mockResolvedValue(metadata);
  await expect(resolveDossierDestination('request', 'D26-1')).rejects.toThrow('folder is unavailable');
});
test.each([{ buckets: [] }, { buckets: [{ source: 'archive', library: 'Requests', folder: 'Guess' }] }, { buckets: [{ source: 'dynamics' }, { source: 'dynamics' }] }])('refuses absent, guessed or ambiguous request destinations', async ({ buckets }) => {
  getRequestSharePointBuckets.mockResolvedValue(buckets);
  await expect(resolveDossierDestination('request', 'D26-1')).rejects.toThrow('missing or ambiguous');
  expect(GraphService.getFileMetadataByPath).not.toHaveBeenCalled();
});
