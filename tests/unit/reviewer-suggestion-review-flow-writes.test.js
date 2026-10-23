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
  getByIdWithSelect,
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

describe('getByIdWithSelect (generic passthrough)', () => {
  it('byte-mirrors reviewer-manual-reminder.js\'s SUGGESTION_SELECT read', async () => {
    const select = [
      'wmkf_appreviewersuggestionid', '_wmkf_request_value', '_wmkf_potentialreviewer_value',
      'wmkf_accepted', 'wmkf_reviewstatus', 'wmkf_reviewreceivedat',
      'wmkf_applicantdisposition', 'wmkf_remindercount',
    ].join(',');
    const spy = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({ wmkf_appreviewersuggestionid: SUGGESTION_ID });
    const out = await getByIdWithSelect(SUGGESTION_ID, select);
    expect(out).toEqual({ wmkf_appreviewersuggestionid: SUGGESTION_ID });
    expect(spy).toHaveBeenCalledWith('wmkf_appreviewersuggestions', SUGGESTION_ID, { select });
  });

  it('propagates errors unchanged', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockRejectedValue(new Error('not found'));
    await expect(getByIdWithSelect(SUGGESTION_ID, 'a,b')).rejects.toThrow('not found');
  });
});

describe('stampProposalFirstAccessed', () => {
  it('fresh-reads and conditionally PATCHes only wmkf_proposalfirstaccessed', async () => {
    const read = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({ _etag: 'W/"7"', wmkf_proposalfirstaccessed: null });
    const spy = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue({});
    await stampProposalFirstAccessed(SUGGESTION_ID);
    expect(read).toHaveBeenCalledWith('wmkf_appreviewersuggestions', SUGGESTION_ID, {
      select: 'wmkf_appreviewersuggestionid,wmkf_proposalfirstaccessed',
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const [entitySet, id, payload, opts] = spy.mock.calls[0];
    expect(entitySet).toBe('wmkf_appreviewersuggestions');
    expect(id).toBe(SUGGESTION_ID);
    expect(Object.keys(payload)).toEqual(['wmkf_proposalfirstaccessed']);
    expect(new Date(payload.wmkf_proposalfirstaccessed).toString()).not.toBe('Invalid Date');
    expect(opts).toEqual({ ifMatch: 'W/"7"' });
  });

  it('preserves a timestamp written after the caller snapshot without PATCHing', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({
      _etag: 'W/"8"', wmkf_proposalfirstaccessed: '2026-10-22T10:00:00Z',
    });
    const patch = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue({});
    await expect(stampProposalFirstAccessed(SUGGESTION_ID)).resolves.toEqual({ alreadySet: true });
    expect(patch).not.toHaveBeenCalled();
  });

  it('fails closed when the fresh row has no etag', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({ wmkf_proposalfirstaccessed: null });
    const patch = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue({});
    await expect(stampProposalFirstAccessed(SUGGESTION_ID)).rejects.toThrow('requires a concrete suggestion etag');
    expect(patch).not.toHaveBeenCalled();
  });

  it('after a 412 preserves the winner, or retries once only if still empty', async () => {
    jest.spyOn(DynamicsService, 'getRecord')
      .mockResolvedValueOnce({ _etag: 'W/"7"', wmkf_proposalfirstaccessed: null })
      .mockResolvedValueOnce({ _etag: 'W/"8"', wmkf_proposalfirstaccessed: '2026-10-22T10:00:00Z' });
    const patch = jest.spyOn(DynamicsService, 'updateRecord').mockRejectedValueOnce(Object.assign(new Error('changed'), { status: 412 }));
    await expect(stampProposalFirstAccessed(SUGGESTION_ID)).resolves.toEqual({ alreadySet: true });
    expect(patch).toHaveBeenCalledTimes(1);

    jest.restoreAllMocks();
    jest.spyOn(DynamicsService, 'getRecord')
      .mockResolvedValueOnce({ _etag: 'W/"7"', wmkf_proposalfirstaccessed: null })
      .mockResolvedValueOnce({ _etag: 'W/"8"', wmkf_proposalfirstaccessed: null });
    const retryPatch = jest.spyOn(DynamicsService, 'updateRecord').mockRejectedValueOnce(Object.assign(new Error('changed'), { status: 412 })).mockResolvedValueOnce({});
    await stampProposalFirstAccessed(SUGGESTION_ID);
    expect(retryPatch).toHaveBeenCalledTimes(2);
    expect(retryPatch.mock.calls[1][3]).toEqual({ ifMatch: 'W/"8"' });
  });

  it('propagates initial and retry reads that fail', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockRejectedValueOnce(new Error('read failed'));
    await expect(stampProposalFirstAccessed(SUGGESTION_ID)).rejects.toThrow('read failed');
    jest.restoreAllMocks();
    jest.spyOn(DynamicsService, 'getRecord')
      .mockResolvedValueOnce({ _etag: 'W/"7"', wmkf_proposalfirstaccessed: null })
      .mockRejectedValueOnce(new Error('retry read failed'));
    jest.spyOn(DynamicsService, 'updateRecord').mockRejectedValueOnce(Object.assign(new Error('changed'), { status: 412 }));
    await expect(stampProposalFirstAccessed(SUGGESTION_ID)).rejects.toThrow('retry read failed');
  });
});

describe('getForSubmitFinalityCheck', () => {
  it('reads all receipt eligibility fields with the fresh etag', async () => {
    const spy = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({ _etag: 'W/"reread"' });
    await getForSubmitFinalityCheck(SUGGESTION_ID);
    expect(spy).toHaveBeenCalledWith('wmkf_appreviewersuggestions', SUGGESTION_ID, {
      select: 'wmkf_appreviewersuggestionid,wmkf_accepted,wmkf_declined,wmkf_reviewreceivedat,wmkf_reviewstatus',
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
