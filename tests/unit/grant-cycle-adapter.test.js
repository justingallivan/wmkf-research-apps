/**
 * Characterization test for the wmkf_appgrantcycles adapter
 * (lib/dataverse/adapters/grant-cycle.js).
 *
 * Byte-mirrors the raw queryAllRecords call in
 * lib/services/maintenance-service.js's cleanupBlobs blob-URL scan.
 *
 * @jest-environment node
 */

import { jest } from '@jest/globals';
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import * as grantCycle from '../../lib/dataverse/adapters/grant-cycle.js';

afterEach(() => jest.restoreAllMocks());

describe('grant-cycle.queryAllCycles (characterization)', () => {
  test('golden: forwards options verbatim', async () => {
    const q = jest.spyOn(DynamicsService, 'queryAllRecords').mockResolvedValue({ records: [], capped: false });
    const options = {
      select: 'wmkf_reviewtemplateurl,wmkf_additionalattachments',
      filter: 'wmkf_reviewtemplateurl ne null or wmkf_additionalattachments ne null',
    };
    const out = await grantCycle.queryAllCycles(options);
    expect(out).toEqual({ records: [], capped: false });
    expect(q).toHaveBeenCalledWith('wmkf_appgrantcycles', options);
  });

  test('failure path: propagates a queryAllRecords rejection', async () => {
    jest.spyOn(DynamicsService, 'queryAllRecords').mockRejectedValue(new Error('boom'));
    await expect(grantCycle.queryAllCycles({})).rejects.toThrow('boom');
  });
});
