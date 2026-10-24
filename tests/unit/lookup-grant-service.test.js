/**
 * Unit tests for lib/services/grant-reporting/lookup-grant-service.js
 * (Stage 5 batch 2). Logic-level; adapter, buckets, and Graph mocked. The
 * route characterization suite (lookup-grant.test.js) pins the HTTP
 * envelopes; this pins the listing/classification/best-guess semantics.
 *
 * @jest-environment node
 */

jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({
  findByRequestNumber: jest.fn(),
}));
jest.mock('../../lib/utils/sharepoint-buckets', () => ({
  getRequestSharePointBuckets: jest.fn(async () => []),
}));
jest.mock('../../lib/services/graph-service', () => ({
  GraphService: { listFiles: jest.fn() },
}));
jest.mock('../../lib/services/proposal-participants.js', () => ({
  fetchCoPIs: jest.fn(async () => []),
}));
const mockSiteVisitFilter = jest.fn();
const mockCreateSiteVisitFilter = jest.fn();
jest.mock('../../lib/services/site-visit-materials/recursive-reader-filter.js', () => ({
  createSiteVisitMaterialsRecursiveReaderFilter: (...args) => mockCreateSiteVisitFilter(...args),
}));

import * as grantRequestAdapter from '../../lib/dataverse/adapters/grant-request.js';
import { getRequestSharePointBuckets } from '../../lib/utils/sharepoint-buckets';
import { GraphService } from '../../lib/services/graph-service';
import { lookupGrant } from '../../lib/services/grant-reporting/lookup-grant-service';
import { fetchCoPIs } from '../../lib/services/proposal-participants.js';

const record = (over = {}) => ({
  akoya_requestid: 'guid-1', akoya_requestnum: '1002836', akoya_title: 'T', ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateSiteVisitFilter.mockReturnValue(mockSiteVisitFilter);
  mockSiteVisitFilter.mockImplementation(async (_library, _folder, files) => ({ files, omittedFiles: [], error: null }));
  getRequestSharePointBuckets.mockResolvedValue([]);
});

describe('lookupGrant co-PI header', () => {
  const rec = record({ _wmkf_projectleader_value_formatted: 'Pat PI', _wmkf_copi1_value_formatted: 'Sam Slot', _wmkf_copi2_value_formatted: 'Jo Junction' });
  it('lists the PI, then junction co-PIs, then legacy-slot co-PIs not already listed', async () => {
    grantRequestAdapter.findByRequestNumber.mockResolvedValue({ records: [rec] });
    fetchCoPIs.mockResolvedValue(['Jo Junction', 'New Copi']);
    const r = await lookupGrant({ requestNumber: '1002836' });
    expect(fetchCoPIs).toHaveBeenCalledWith('guid-1');
    expect(r.header.pis).toEqual(['Pat PI', 'Jo Junction', 'New Copi', 'Sam Slot']);
  });
  it('a junction-only co-PI (no slot) appears in the header', async () => {
    grantRequestAdapter.findByRequestNumber.mockResolvedValue({ records: [record({ _wmkf_projectleader_value_formatted: 'Pat PI' })] });
    fetchCoPIs.mockResolvedValue(['New Copi']);
    expect((await lookupGrant({ requestNumber: '1002836' })).header.pis).toEqual(['Pat PI', 'New Copi']);
  });
  it('a failed junction read falls back to the legacy slots and still returns found', async () => {
    grantRequestAdapter.findByRequestNumber.mockResolvedValue({ records: [rec] });
    fetchCoPIs.mockRejectedValue(new Error('down'));
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const r = await lookupGrant({ requestNumber: '1002836' });
    expect(r.found).toBe(true);
    expect(r.header.pis).toEqual(['Pat PI', 'Sam Slot', 'Jo Junction']);
    spy.mockRestore();
  });
});

describe('lookupGrant', () => {
  it('trims the request number and queries top 1 with the header select', async () => {
    grantRequestAdapter.findByRequestNumber.mockResolvedValue({ records: [] });
    const r = await lookupGrant({ requestNumber: '  1002836  ' });
    expect(grantRequestAdapter.findByRequestNumber).toHaveBeenCalledWith('1002836', expect.objectContaining({ top: 1 }));
    expect(r.found).toBe(false);
    expect(r.errors.dynamics).toBe('No request found with number "1002836"');
  });

  it('Dynamics failure returns found:false with a generic category (raw error stays server-side)', async () => {
    grantRequestAdapter.findByRequestNumber.mockRejectedValue(new Error('OData table detail'));
    const r = await lookupGrant({ requestNumber: '1002836' });
    expect(r).toMatchObject({ found: false, requestId: null, documents: null });
    expect(r.errors.dynamics).toBe('Dynamics query failed');
  });

  it('flattens buckets, dedupes composite keys, computes subfolder + classification + best guesses', async () => {
    grantRequestAdapter.findByRequestNumber.mockResolvedValue({ records: [record()] });
    getRequestSharePointBuckets.mockResolvedValue([
      { library: 'akoya_request', folder: 'F1' },
      { library: 'RequestArchive1', folder: 'F1' },
    ]);
    GraphService.listFiles.mockImplementation(async (library) => {
      if (library === 'akoya_request') {
        return [
          { name: 'Project Narrative.docx', folder: 'F1/Final Report', size: 1, mimeType: 'd', lastModified: '2026-01-02' },
          { name: 'Annual Report.pdf', folder: 'F1', size: 2, mimeType: 'p', lastModified: '2026-01-03' },
        ];
      }
      return [{ name: 'Annual Report.pdf', folder: 'F1', size: 2, mimeType: 'p', lastModified: '2026-01-03' }];
    });

    const r = await lookupGrant({ requestNumber: '1002836' });
    expect(r.found).toBe(true);
    // Cross-library duplicates are NOT deduped (different library key); same-key dupes are.
    expect(r.documents.files).toHaveLength(3);
    for (const call of GraphService.listFiles.mock.calls) {
      expect(call[2]).toMatchObject({ recursive: true, excludeApplicantMaterialsBackgroundUploads: true });
    }
    const narrative = r.documents.files.find((f) => f.name.includes('Narrative'));
    expect(narrative).toMatchObject({ subfolder: 'Final Report', classification: 'proposal' });
    expect(r.documents.proposalBestGuess).toBe('akoya_request::F1/Final Report::Project Narrative.docx');
    expect(r.documents.reportBestGuess).toMatch(/::Annual Report\.pdf$/);
    expect(r.documents.libraries).toHaveLength(2);
    expect(mockCreateSiteVisitFilter).toHaveBeenCalledWith('guid-1', '1002836');
    expect(mockSiteVisitFilter).toHaveBeenCalledWith('akoya_request', 'F1', expect.any(Array));
  });

  it('bucket listing errors are tolerated per-bucket (error captured, other buckets still listed)', async () => {
    grantRequestAdapter.findByRequestNumber.mockResolvedValue({ records: [record()] });
    getRequestSharePointBuckets.mockResolvedValue([
      { library: 'akoya_request', folder: 'F1' },
      { library: 'RequestArchive1', folder: 'F1' },
    ]);
    GraphService.listFiles
      .mockRejectedValueOnce(new Error('404 folder'))
      .mockResolvedValueOnce([{ name: 'Interim Report.pdf', folder: 'F1' }]);
    const r = await lookupGrant({ requestNumber: '1002836' });
    expect(r.documents.libraries.find((l) => l.library === 'akoya_request').error).toBe('404 folder');
    expect(r.documents.files).toHaveLength(1);
  });

  it('uses the filtered inventory and preserves a status warning alongside unrelated files', async () => {
    grantRequestAdapter.findByRequestNumber.mockResolvedValue({ records: [record()] });
    getRequestSharePointBuckets.mockResolvedValue([
      { library: 'akoya_request', folder: 'F1', source: 'dynamics' },
    ]);
    const candidate = { id: 'old', name: 'Old presentation.pptx', folder: 'F1/Site Visit - Slides' };
    const unrelated = { id: 'other', name: 'Annual Report.pdf', folder: 'F1', size: 2, mimeType: 'p' };
    GraphService.listFiles.mockResolvedValue([candidate, unrelated]);
    mockSiteVisitFilter.mockImplementationOnce(async () => ({
      files: [unrelated],
      omittedFiles: [candidate],
      error: { code: 'site_visit_materials_status_unavailable', message: 'Some materials were omitted.' },
    }));

    const r = await lookupGrant({ requestNumber: '1002836' });
    expect(r.documents.files).toEqual([expect.objectContaining({ name: 'Annual Report.pdf' })]);
    expect(r.documents.libraries).toEqual([expect.objectContaining({
      library: 'akoya_request',
      count: 1,
      error: 'Some materials were omitted.',
    })]);
  });

  it('SharePoint discovery failure is non-fatal: found stays true, documents null, category error', async () => {
    grantRequestAdapter.findByRequestNumber.mockResolvedValue({ records: [record()] });
    getRequestSharePointBuckets.mockRejectedValue(new Error('Graph down'));
    const r = await lookupGrant({ requestNumber: '1002836' });
    expect(r.found).toBe(true);
    expect(r.documents).toBeNull();
    expect(r.errors.sharepoint).toBe('SharePoint listing failed');
  });
});
