/**
 * @jest-environment node
 *
 * reviewer-suggestion adapter additions for the review-flow cross-entity
 * conversion wave (external context/submit + review-manager mark-received /
 * review-upload). Each method byte-mirrors an inline DynamicsService call
 * that lived at the caller before conversion — see
 * docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md Stages 3-6.
 */
import { jest } from '@jest/globals';
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import {
  getForEtagRefresh,
  stampProposalFirstAccessed,
  getForSubmitFinalityCheck,
  patchReviewReceipt,
} from '../../lib/dataverse/adapters/reviewer-suggestion.js';

const SUGGESTION_ID = '11111111-1111-4111-8111-111111111111';

afterEach(() => jest.restoreAllMocks());

describe('getForEtagRefresh', () => {
  it('reads only the id column (used to pick up the row\'s fresh etag)', async () => {
    const spy = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({ _etag: 'W/"2"' });
    await getForEtagRefresh(SUGGESTION_ID);
    expect(spy).toHaveBeenCalledWith('wmkf_appreviewersuggestions', SUGGESTION_ID, {
      select: 'wmkf_appreviewersuggestionid',
    });
  });

  it('propagates errors unchanged', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockRejectedValue(new Error('transient'));
    await expect(getForEtagRefresh(SUGGESTION_ID)).rejects.toThrow('transient');
  });
});

describe('stampProposalFirstAccessed', () => {
  it('PATCHes only wmkf_proposalfirstaccessed with an ISO timestamp', async () => {
    const spy = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue({});
    await stampProposalFirstAccessed(SUGGESTION_ID);
    expect(spy).toHaveBeenCalledTimes(1);
    const [entitySet, id, payload, opts] = spy.mock.calls[0];
    expect(entitySet).toBe('wmkf_appreviewersuggestions');
    expect(id).toBe(SUGGESTION_ID);
    expect(Object.keys(payload)).toEqual(['wmkf_proposalfirstaccessed']);
    expect(new Date(payload.wmkf_proposalfirstaccessed).toString()).not.toBe('Invalid Date');
    expect(opts).toBeUndefined();
  });
});

describe('getForSubmitFinalityCheck', () => {
  it('reads id + wmkf_reviewreceivedat (etag re-read that also re-checks finality)', async () => {
    const spy = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({ _etag: 'W/"reread"' });
    await getForSubmitFinalityCheck(SUGGESTION_ID);
    expect(spy).toHaveBeenCalledWith('wmkf_appreviewersuggestions', SUGGESTION_ID, {
      select: 'wmkf_appreviewersuggestionid,wmkf_reviewreceivedat',
    });
  });
});

describe('patchReviewReceipt', () => {
  it('forwards an arbitrary payload + opts unchanged (generic outcome PATCH)', async () => {
    const spy = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue({});
    const payload = { wmkf_reviewreceivedat: '2026-07-04T00:00:00.000Z', wmkf_reviewuploadedbystaff: true };
    await patchReviewReceipt(SUGGESTION_ID, payload, { actingUserSystemId: 'user-1' });
    expect(spy).toHaveBeenCalledWith('wmkf_appreviewersuggestions', SUGGESTION_ID, payload, { actingUserSystemId: 'user-1' });
  });

  it('omits opts when the caller passes none', async () => {
    const spy = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue({});
    await patchReviewReceipt(SUGGESTION_ID, { wmkf_reviewreceivedat: 'x' });
    expect(spy).toHaveBeenCalledWith('wmkf_appreviewersuggestions', SUGGESTION_ID, { wmkf_reviewreceivedat: 'x' }, {});
  });
});
