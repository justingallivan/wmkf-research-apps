/**
 * @jest-environment node
 *
 * Stage 3J: `deselectLegacyDeclinedSuggestion` is a narrow adapter op for the
 * external-respond legacy-decline repair (row 13 of the Stage 7 generic-writer
 * census, `docs/REVIEWER_LIFECYCLE_STAGE7_BUILD_PLAN.md`). It delegates to
 * `updateLifecycle` with a fixed `{ selected: false }` payload, so this suite
 * pins that the underlying transport call it produces is IDENTICAL to what
 * `updateLifecycle(id, { selected: false }, opts)` produces directly today —
 * not a reimplementation of the guards/fallback/picklist logic.
 */
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import {
  deselectLegacyDeclinedSuggestion,
  updateLifecycle,
  APPLICANT_DISPOSITION_EXCLUDED,
} from '../../lib/dataverse/adapters/reviewer-suggestion.js';

afterEach(() => jest.restoreAllMocks());

function mockCleanGuardRead() {
  return jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({
    wmkf_applicantdisposition: null,
    wmkf_completedat: null,
    wmkf_reviewreceivedat: null,
    wmkf_reviewstatus: null,
    wmkf_honorariumeligibility: null,
  });
}

function mockExcludedGuardRead() {
  return jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({
    wmkf_applicantdisposition: APPLICANT_DISPOSITION_EXCLUDED,
    wmkf_completedat: null,
    wmkf_reviewreceivedat: null,
    wmkf_reviewstatus: null,
    wmkf_honorariumeligibility: null,
  });
}

describe('deselectLegacyDeclinedSuggestion', () => {
  test('with a concrete ETag: same transport call/payload as updateLifecycle(id, { selected: false }, opts)', async () => {
    const getRecord = mockCleanGuardRead();
    const patch = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);

    await deselectLegacyDeclinedSuggestion('sug-1', { ifMatch: 'W/"1"' });
    // Guard against a vacuous pass: prove both sides actually reached the
    // transport (and its guard read) exactly once before comparing args.
    expect(getRecord).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledTimes(1);
    const opCallArgs = patch.mock.calls[0];

    getRecord.mockClear();
    patch.mockClear();
    await updateLifecycle('sug-1', { selected: false }, { ifMatch: 'W/"1"' });
    expect(getRecord).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledTimes(1);
    const directCallArgs = patch.mock.calls[0];

    expect(opCallArgs).toEqual(directCallArgs);
    expect(opCallArgs[0]).toBe('wmkf_appreviewersuggestions');
    expect(opCallArgs[1]).toBe('sug-1');
    expect(opCallArgs[2]).toEqual({ wmkf_selected: false });
    expect(opCallArgs[3]).toEqual({ ifMatch: 'W/"1"' });
  });

  test('with ifMatch: undefined, the same fallback behavior as updateLifecycle today (equality, not a specific policy)', async () => {
    const getRecord = mockCleanGuardRead();
    const patch = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);

    await deselectLegacyDeclinedSuggestion('sug-2', { ifMatch: undefined });
    expect(getRecord).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledTimes(1);
    const opCallArgs = patch.mock.calls[0];

    getRecord.mockClear();
    patch.mockClear();
    await updateLifecycle('sug-2', { selected: false }, { ifMatch: undefined });
    expect(getRecord).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledTimes(1);
    const directCallArgs = patch.mock.calls[0];

    expect(opCallArgs).toEqual(directCallArgs);
    // The specific fallback policy (no ifMatch supplied → no key on this
    // non-status, non-invitation-response payload) is updateLifecycle's to
    // define; this only pins that the op did not add one of its own.
    expect(opCallArgs[3]).not.toHaveProperty('ifMatch');
  });

  test('actingUserSystemId is forwarded to the same transport call as updateLifecycle', async () => {
    const getRecord = mockCleanGuardRead();
    const patch = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);

    await deselectLegacyDeclinedSuggestion('sug-3', {
      ifMatch: 'W/"3"',
      actingUserSystemId: 'user-9',
    });
    expect(getRecord).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledTimes(1);
    const opCallArgs = patch.mock.calls[0];

    getRecord.mockClear();
    patch.mockClear();
    await updateLifecycle('sug-3', { selected: false }, {
      ifMatch: 'W/"3"',
      actingUserSystemId: 'user-9',
    });
    expect(getRecord).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledTimes(1);
    const directCallArgs = patch.mock.calls[0];

    expect(opCallArgs).toEqual(directCallArgs);
    expect(opCallArgs[3]).toMatchObject({ actingUserSystemId: 'user-9', ifMatch: 'W/"3"' });
  });

  test('a 412 from the transport propagates unchanged (same as updateLifecycle)', async () => {
    mockCleanGuardRead();
    const err = Object.assign(new Error('Precondition Failed'), { status: 412 });
    jest.spyOn(DynamicsService, 'updateRecord').mockRejectedValue(err);

    await expect(deselectLegacyDeclinedSuggestion('sug-4', { ifMatch: 'W/"stale"' }))
      .rejects.toMatchObject({ status: 412 });
  });

  test('inherits the excluded-row refusal: an applicant-excluded row rejects without a PATCH', async () => {
    mockExcludedGuardRead();
    const patch = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);

    await expect(deselectLegacyDeclinedSuggestion('sug-5', { ifMatch: 'W/"5"' }))
      .rejects.toThrow(/refusing to mutate an applicant-excluded suggestion/);
    expect(patch).not.toHaveBeenCalled();
  });
});
