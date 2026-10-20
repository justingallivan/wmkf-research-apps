/**
 * contact.setOrcidIfAbsent `requireEtag` option (bulk-backfill fail-closed
 * guard). Default behavior is unchanged.
 *
 * @jest-environment node
 */

import { jest } from '@jest/globals';
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import * as contact from '../../lib/dataverse/adapters/contact.js';

afterEach(() => jest.restoreAllMocks());

const ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORCID = '0000-0002-1825-0097';

describe('contact.setOrcidIfAbsent requireEtag', () => {
  test('no ETag + requireEtag → failed, no write', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({ contactid: ID, wmkf_orcid: null });
    const update = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);
    const out = await contact.setOrcidIfAbsent(ID, ORCID, { requireEtag: true });
    expect(out).toEqual({ action: 'failed', reason: 'no-etag', incoming: ORCID });
    expect(update).not.toHaveBeenCalled();
  });

  test('ETag present + requireEtag → conditional write', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({ contactid: ID, wmkf_orcid: null, _etag: 'W/"1"' });
    const update = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);
    const out = await contact.setOrcidIfAbsent(ID, ORCID, { requireEtag: true });
    expect(out).toEqual({ action: 'write', orcid: ORCID });
    expect(update).toHaveBeenCalledWith('contacts', ID, { wmkf_orcid: ORCID }, expect.objectContaining({ ifMatch: 'W/"1"' }));
  });

  test('412 retry keeps requireEtag: retry read without ETag → failed', async () => {
    jest.spyOn(DynamicsService, 'getRecord')
      .mockResolvedValueOnce({ contactid: ID, wmkf_orcid: null, _etag: 'W/"1"' })
      .mockResolvedValueOnce({ contactid: ID, wmkf_orcid: null });
    const err = Object.assign(new Error('precondition failed'), { status: 412 });
    const update = jest.spyOn(DynamicsService, 'updateRecord').mockRejectedValueOnce(err);
    const out = await contact.setOrcidIfAbsent(ID, ORCID, { requireEtag: true });
    expect(out.action).toBe('failed');
    expect(update).toHaveBeenCalledTimes(1);
  });

  test('default (no requireEtag) keeps the unconditional fallback', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({ contactid: ID, wmkf_orcid: null });
    const update = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);
    const out = await contact.setOrcidIfAbsent(ID, ORCID);
    expect(out).toEqual({ action: 'write', orcid: ORCID });
    expect(update.mock.calls[0][3]).not.toHaveProperty('ifMatch');
  });
});
