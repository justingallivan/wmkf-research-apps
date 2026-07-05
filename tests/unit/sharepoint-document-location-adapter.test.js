/**
 * Characterization tests for the sharepointdocumentlocations adapter
 * (lib/dataverse/adapters/sharepoint-document-location.js).
 *
 * Byte-mirrors the two raw query shapes shared by lib/utils/sharepoint-buckets.js
 * and pages/api/expertise-finder/batch-match.js.
 *
 * @jest-environment node
 */

import { jest } from '@jest/globals';
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import * as sdl from '../../lib/dataverse/adapters/sharepoint-document-location.js';

afterEach(() => jest.restoreAllMocks());

const REQUEST_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('sharepoint-document-location.findByRegardingObject (characterization)', () => {
  test('golden: quoted-GUID filter, default top 10', async () => {
    const q = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [{ relativeurl: 'folder1' }] });
    const select = 'name,relativeurl,_parentsiteorlocation_value';
    const out = await sdl.findByRegardingObject(REQUEST_ID, { select });
    expect(out.records).toHaveLength(1);
    expect(q).toHaveBeenCalledWith('sharepointdocumentlocations', {
      select,
      filter: `_regardingobjectid_value eq '${REQUEST_ID}'`,
      top: 10,
    });
  });

  test('accepts a custom top', async () => {
    const q = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [] });
    await sdl.findByRegardingObject(REQUEST_ID, { select: 'name', top: 5 });
    expect(q).toHaveBeenCalledWith('sharepointdocumentlocations', expect.objectContaining({ top: 5 }));
  });
});

describe('sharepoint-document-location.findByParentIds (characterization)', () => {
  test('golden: unquoted OR-chain filter, caller-owned select/top', async () => {
    const q = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [{ relativeurl: 'lib1' }] });
    const out = await sdl.findByParentIds(['p1', 'p2'], { select: 'relativeurl', top: 5 });
    expect(out.records).toHaveLength(1);
    expect(q).toHaveBeenCalledWith('sharepointdocumentlocations', {
      select: 'relativeurl',
      filter: 'sharepointdocumentlocationid eq p1 or sharepointdocumentlocationid eq p2',
      top: 5,
    });
  });

  test('failure path: propagates a queryRecords rejection', async () => {
    jest.spyOn(DynamicsService, 'queryRecords').mockRejectedValue(new Error('boom'));
    await expect(sdl.findByParentIds(['p1'], { select: 'relativeurl', top: 5 })).rejects.toThrow('boom');
  });
});
