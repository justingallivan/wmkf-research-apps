/**
 * cleanupBlobs keep-set coverage for grant-cycle materials (Codex SLICE2-5).
 *
 * The orphaned-blob scanner deletes PUBLIC-store blobs not referenced in
 * Dataverse. It previously read only wmkf_reviewtemplateurl, so a cycle's PUBLIC
 * additional-attachment blobs were missing from the keep-set and could be reaped
 * after retention (a live data-loss bug). It also must NOT treat a private
 * cycle-material pathname as a public URL once the migration starts.
 *
 * This pins: (1) public attachment URLs ARE protected, (2) the template URL is
 * protected, (3) a genuine orphan IS collected, (4) a private pathname is not
 * added to the public keep-set (and does not crash the scan).
 */

jest.mock('@vercel/blob', () => ({ list: jest.fn(), del: jest.fn() }));
jest.mock('@vercel/postgres', () => ({ sql: jest.fn(async () => ({ rows: [] })) }));
jest.mock('../../lib/services/database-service', () => ({ DatabaseService: {} }));
jest.mock('../../lib/services/settings-service', () => ({ listSettings: jest.fn() }));
jest.mock('../../lib/services/dynamics-service', () => ({ DynamicsService: { queryAllRecords: jest.fn() } }));
jest.mock('../../lib/services/dynamics-context', () => ({ bypassDynamicsRestrictions: (_name, fn) => fn() }));
jest.mock('../../lib/services/intake-draft-service', () => ({}));
jest.mock('../../lib/services/intake-audit-service', () => ({}));
jest.mock('../../lib/utils/intake-blob', () => ({ getIntakeBlobToken: jest.fn() }));

const { list } = require('@vercel/blob');
const { DynamicsService } = require('../../lib/services/dynamics-service');
const MaintenanceService = require('../../lib/services/maintenance-service');

const TEMPLATE_URL = 'https://store.public.blob.vercel-storage.com/Review_Template-aaa.docx';
const ATTACHMENT_URL = 'https://store.public.blob.vercel-storage.com/Guidelines-bbb.pdf';
const ORPHAN_URL = 'https://store.public.blob.vercel-storage.com/orphan-ccc.pdf';
const PRIVATE_PATH = 'cycle-materials/Review_Template-ddd.docx';

const OLD = '2020-01-01T00:00:00.000Z'; // older than any positive retention cutoff

beforeEach(() => {
  DynamicsService.queryAllRecords.mockReset().mockImplementation(async (entity) => {
    if (entity === 'wmkf_appgrantcycles') {
      return {
        capped: false,
        records: [
          {
            wmkf_reviewtemplateurl: TEMPLATE_URL,
            wmkf_additionalattachments: JSON.stringify([{ blobUrl: ATTACHMENT_URL, filename: 'Guidelines.pdf' }]),
          },
          // A cycle already migrated to a private template — must not crash and the
          // pathname must not be matched against public blobs.
          { wmkf_reviewtemplateurl: PRIVATE_PATH, wmkf_additionalattachments: null },
        ],
      };
    }
    return { capped: false, records: [] }; // suggestions
  });

  list.mockReset().mockResolvedValue({
    cursor: undefined,
    blobs: [
      { url: TEMPLATE_URL, pathname: 'Review_Template-aaa.docx', uploadedAt: OLD, size: 10 },
      { url: ATTACHMENT_URL, pathname: 'Guidelines-bbb.pdf', uploadedAt: OLD, size: 20 },
      { url: ORPHAN_URL, pathname: 'orphan-ccc.pdf', uploadedAt: OLD, size: 30 },
    ],
  });
});

it('protects public template + attachment blobs and collects only the genuine orphan', async () => {
  const stats = await MaintenanceService.cleanupBlobs(1, /* dryRun */ true);

  // Template (TEMPLATE_URL) + attachment (ATTACHMENT_URL) are referenced → skipped.
  expect(stats.skipped).toBe(2);
  // Only the orphan would be deleted.
  expect(stats.deleted).toBe(1);
  expect(stats.details.some((d) => d.includes('orphan-ccc.pdf'))).toBe(true);
  // The attachment must NOT appear in any "would delete" line (the SLICE2-5 fix).
  expect(stats.details.some((d) => /Would delete/.test(d) && d.includes('Guidelines-bbb.pdf'))).toBe(false);
});
