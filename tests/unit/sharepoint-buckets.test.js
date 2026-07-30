/**
 * Contract test for lib/utils/sharepoint-buckets.js's getRequestSharePointBuckets.
 * Golden path: Dynamics-tracked bucket + speculative archive buckets are merged
 * and de-duplicated. Failure path: the parent-location lookup failing falls back
 * to the 'akoya_request' library name for legacy read callers, while governed
 * writers can require positive parent resolution and fail closed.
 *
 * @jest-environment node
 */

import { jest } from '@jest/globals';
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import { getRequestSharePointBuckets, ARCHIVE_LIBRARIES } from '../../lib/utils/sharepoint-buckets.js';

afterEach(() => jest.restoreAllMocks());

const REQUEST_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const REQUEST_NUM = 'R-1000';

describe('getRequestSharePointBuckets (golden path)', () => {
  test('merges the Dynamics-tracked bucket with archive buckets, de-duplicated', async () => {
    jest.spyOn(DynamicsService, 'queryRecords').mockImplementation((entity, opts) => {
      if (opts.select === 'name,relativeurl,_parentsiteorlocation_value') {
        return Promise.resolve({ records: [{ name: 'loc1', relativeurl: 'Proposals/R-1000', _parentsiteorlocation_value: 'parent-1' }] });
      }
      if (opts.select === 'sharepointdocumentlocationid,relativeurl') {
        return Promise.resolve({ records: [{ sharepointdocumentlocationid: 'parent-1', relativeurl: 'GrantLibrary' }] });
      }
      throw new Error(`unexpected select ${opts.select}`);
    });

    const buckets = await getRequestSharePointBuckets(REQUEST_ID, REQUEST_NUM);
    expect(buckets[0]).toEqual({ library: 'GrantLibrary', folder: 'Proposals/R-1000', source: 'dynamics' });
    expect(buckets).toHaveLength(1 + ARCHIVE_LIBRARIES.length);
    const archiveFolder = `${REQUEST_NUM}_${REQUEST_ID.replace(/-/g, '').toUpperCase()}`;
    for (const library of ARCHIVE_LIBRARIES) {
      expect(buckets).toContainEqual({ library, folder: archiveFolder, source: 'archive' });
    }
  });

  test('parent-location lookup failure falls back to akoya_request (non-fatal)', async () => {
    jest.spyOn(DynamicsService, 'queryRecords').mockImplementation((entity, opts) => {
      if (opts.select === 'name,relativeurl,_parentsiteorlocation_value') {
        return Promise.resolve({ records: [{ name: 'loc1', relativeurl: 'Proposals/R-1000', _parentsiteorlocation_value: 'parent-1' }] });
      }
      return Promise.reject(new Error('boom'));
    });

    const buckets = await getRequestSharePointBuckets(REQUEST_ID, REQUEST_NUM);
    expect(buckets[0]).toEqual({ library: 'akoya_request', folder: 'Proposals/R-1000', source: 'dynamics' });
  });

  test('governed writer mode fails closed when the parent library cannot be verified', async () => {
    jest.spyOn(DynamicsService, 'queryRecords').mockImplementation((entity, opts) => {
      if (opts.select === 'name,relativeurl,_parentsiteorlocation_value') {
        return Promise.resolve({ records: [{ name: 'loc1', relativeurl: 'Proposals/R-1000', _parentsiteorlocation_value: 'parent-1' }] });
      }
      return Promise.reject(new Error('boom'));
    });

    await expect(getRequestSharePointBuckets(
      REQUEST_ID,
      REQUEST_NUM,
      { requireResolvedParents: true },
    )).rejects.toThrow(/Unable to verify the request SharePoint parent library/);
  });

  test('missing requestId throws', async () => {
    await expect(getRequestSharePointBuckets(null, REQUEST_NUM)).rejects.toThrow('requestId is required');
  });
});
