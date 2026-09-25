/**
 * @jest-environment node
 *
 * 6c-ii Stage A, plan "Read-side fan-out of the marker" (b): every
 * suggestion-creating adapter op reads the target person's marker and
 * refuses a marker-true person BEFORE any write -- a second, independent
 * fence alongside the read-side exclusions in potential-reviewer.js.
 */

import { DynamicsService } from '../../lib/services/dynamics-service.js';
import {
  upsert,
  ensureStaffManualCandidate,
  ensureApplicantRecommended,
  repointToPotentialReviewer,
} from '../../lib/dataverse/adapters/reviewer-suggestion.js';

const PERSON_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const SUGGESTION_ID = '33333333-3333-4333-8333-333333333333';
const KEEPER_ID = '44444444-4444-4444-8444-444444444444';

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.SYNTHETIC_REVIEWER_ISOLATION;
});

function mockSyntheticPersonRead() {
  return jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({
    wmkf_potentialreviewersid: PERSON_ID,
    wmkf_issyntheticreviewer: true,
  });
}

describe('switch OFF', () => {
  it('upsert never reads the person row and proceeds normally', async () => {
    const getRecord = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue(null);
    const query = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [] });
    const create = jest.spyOn(DynamicsService, 'createRecord').mockResolvedValue({ wmkf_appreviewersuggestionid: SUGGESTION_ID });

    await upsert({ potentialReviewerId: PERSON_ID, requestId: REQUEST_ID });

    expect(getRecord).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
    query;
  });
});

describe('switch ON — refuses before any write', () => {
  beforeEach(() => { process.env.SYNTHETIC_REVIEWER_ISOLATION = 'on'; });

  it('upsert refuses a synthetic person before create or the existing() lookup write', async () => {
    mockSyntheticPersonRead();
    const create = jest.spyOn(DynamicsService, 'createRecord').mockResolvedValue({});
    const update = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue({});

    await expect(upsert({ potentialReviewerId: PERSON_ID, requestId: REQUEST_ID }))
      .rejects.toMatchObject({ code: 'synthetic_reviewer_not_bindable' });

    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('ensureStaffManualCandidate refuses a synthetic person before any write', async () => {
    mockSyntheticPersonRead();
    const create = jest.spyOn(DynamicsService, 'createRecord').mockResolvedValue({});
    const update = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue({});

    await expect(ensureStaffManualCandidate({ potentialReviewerId: PERSON_ID, requestId: REQUEST_ID }))
      .rejects.toMatchObject({ code: 'synthetic_reviewer_not_bindable' });

    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('ensureApplicantRecommended refuses a synthetic person before any write', async () => {
    mockSyntheticPersonRead();
    const create = jest.spyOn(DynamicsService, 'createRecord').mockResolvedValue({});
    const update = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue({});

    await expect(ensureApplicantRecommended({ potentialReviewerId: PERSON_ID, requestId: REQUEST_ID }))
      .rejects.toMatchObject({ code: 'synthetic_reviewer_not_bindable' });

    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('repointToPotentialReviewer refuses a synthetic keeper before the PATCH', async () => {
    mockSyntheticPersonRead();
    const update = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue({});

    await expect(repointToPotentialReviewer(SUGGESTION_ID, KEEPER_ID, { ifMatch: 'W/"1"' }))
      .rejects.toMatchObject({ code: 'synthetic_reviewer_not_bindable' });

    expect(update).not.toHaveBeenCalled();
  });

  it('upsert proceeds normally for an ordinary (non-synthetic) person', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({
      wmkf_potentialreviewersid: PERSON_ID,
      wmkf_issyntheticreviewer: false,
    });
    jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [] });
    const create = jest.spyOn(DynamicsService, 'createRecord').mockResolvedValue({ wmkf_appreviewersuggestionid: SUGGESTION_ID });

    const result = await upsert({ potentialReviewerId: PERSON_ID, requestId: REQUEST_ID });

    expect(create).toHaveBeenCalledTimes(1);
    expect(result.id).toBe(SUGGESTION_ID);
  });
});
