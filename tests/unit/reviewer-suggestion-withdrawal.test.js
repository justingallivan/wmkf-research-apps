/**
 * @jest-environment node
 */

jest.mock('../../lib/dataverse/core/changeset.js', () => ({
  runChangeset: jest.fn(async () => ({ ok: true })),
}));

import { runChangeset } from '../../lib/dataverse/core/changeset.js';
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import {
  applyStage2aResponse,
  applyStaffReviewerWithdrawal,
  deleteLinkedHonorariumForDeclinedSuggestion,
  RESPONSE_TYPE_MAP,
  REVIEW_STATUS_MAP,
} from '../../lib/dataverse/adapters/reviewer-suggestion.js';

const SUGGESTION_ID = '11111111-1111-4111-8111-111111111111';
const HONORARIUM_ID = '22222222-2222-4222-8222-222222222222';

beforeEach(() => jest.clearAllMocks());

describe('reviewer withdrawal changeset', () => {
  it('atomically declines and deletes only the exact linked honorarium request', async () => {
    await applyStage2aResponse(
      SUGGESTION_ID,
      {
        action: 'decline',
        decline: {
          reasonPicklist: 'too-busy',
          reasonText: 'Schedule changed',
          referral: 'Dr. Alternate',
        },
      },
      {
        ifMatch: 'W/"17"',
        deleteHonorariumRequestId: HONORARIUM_ID,
      },
    );

    expect(runChangeset).toHaveBeenCalledTimes(1);
    const [operations] = runChangeset.mock.calls[0];
    expect(operations).toHaveLength(2);
    expect(operations[0]).toMatchObject({
      method: 'PATCH',
      entitySet: 'wmkf_appreviewersuggestions',
      key: SUGGESTION_ID,
      ifMatch: 'W/"17"',
      body: {
        wmkf_selected: false,
        wmkf_accepted: false,
        wmkf_declined: true,
        wmkf_responsetype: RESPONSE_TYPE_MAP.declined,
        wmkf_declinereason: 'Schedule changed',
        wmkf_declinereferral: 'Dr. Alternate',
      },
    });
    expect(operations[1]).toEqual({
      method: 'DELETE',
      entitySet: 'akoya_requests',
      key: HONORARIUM_ID,
    });
  });

  it('race cleanup guards the exact delete with the declined row ETag', async () => {
    await deleteLinkedHonorariumForDeclinedSuggestion(
      SUGGESTION_ID,
      HONORARIUM_ID,
      { ifMatch: 'W/"18"' },
    );

    const [operations] = runChangeset.mock.calls[0];
    expect(operations[0]).toMatchObject({
      method: 'PATCH',
      key: SUGGESTION_ID,
      ifMatch: 'W/"18"',
      body: {
        wmkf_selected: false,
        wmkf_accepted: false,
        wmkf_declined: true,
      },
    });
    expect(operations[1]).toEqual({
      method: 'DELETE',
      entitySet: 'akoya_requests',
      key: HONORARIUM_ID,
    });
  });

  it('atomically applies a staff withdrawal, revokes the token, and deletes only the linked honorarium', async () => {
    await applyStaffReviewerWithdrawal(
      SUGGESTION_ID,
      {
        ifMatch: 'W/"19"',
        actingUserSystemId: 'staff-1',
        deleteHonorariumRequestId: HONORARIUM_ID,
        responseReceivedAt: '2026-07-24T20:00:00.000Z',
      },
    );

    const [operations, options] = runChangeset.mock.calls[0];
    expect(options).toEqual({ actingUserSystemId: 'staff-1' });
    expect(operations).toHaveLength(2);
    expect(operations[0]).toMatchObject({
      method: 'PATCH',
      entitySet: 'wmkf_appreviewersuggestions',
      key: SUGGESTION_ID,
      ifMatch: 'W/"19"',
      body: {
        wmkf_selected: false,
        wmkf_accepted: false,
        wmkf_declined: true,
        wmkf_responsetype: RESPONSE_TYPE_MAP.declined,
        wmkf_responsereceivedat: '2026-07-24T20:00:00.000Z',
        wmkf_reviewstatus: REVIEW_STATUS_MAP.withdrew,
        wmkf_externaltokenrevoked: true,
        wmkf_declinereferral: null,
      },
    });
    expect(operations[1]).toEqual({
      method: 'DELETE',
      entitySet: 'akoya_requests',
      key: HONORARIUM_ID,
    });
  });

  it('applies the same ETag-guarded staff correction when no honorarium is linked', async () => {
    const updateSpy = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);

    await applyStaffReviewerWithdrawal(
      SUGGESTION_ID,
      {
        ifMatch: 'W/"20"',
        actingUserSystemId: 'staff-2',
        responseReceivedAt: '2026-07-24T21:00:00.000Z',
      },
    );

    expect(runChangeset).not.toHaveBeenCalled();
    expect(updateSpy).toHaveBeenCalledWith(
      'wmkf_appreviewersuggestions',
      SUGGESTION_ID,
      expect.objectContaining({
        wmkf_selected: false,
        wmkf_accepted: false,
        wmkf_declined: true,
        wmkf_responsetype: RESPONSE_TYPE_MAP.declined,
        wmkf_responsereceivedat: '2026-07-24T21:00:00.000Z',
        wmkf_reviewstatus: REVIEW_STATUS_MAP.withdrew,
        wmkf_externaltokenrevoked: true,
      }),
      { ifMatch: 'W/"20"', actingUserSystemId: 'staff-2' },
    );

    updateSpy.mockRestore();
  });

  it('re-selects a reviewer who changes a pre-materials decline back to accept', async () => {
    const updateSpy = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);

    await applyStage2aResponse(
      SUGGESTION_ID,
      {
        action: 'accept',
        acks: {
          coiVersionId: '33333333-3333-4333-8333-333333333333',
          aiUseVersionId: '44444444-4444-4444-8444-444444444444',
        },
      },
      { ifMatch: 'W/"21"' },
    );

    expect(updateSpy).toHaveBeenCalledWith(
      'wmkf_appreviewersuggestions',
      SUGGESTION_ID,
      expect.objectContaining({
        wmkf_selected: true,
        wmkf_accepted: true,
        wmkf_declined: false,
        wmkf_responsetype: RESPONSE_TYPE_MAP.accepted,
      }),
      { ifMatch: 'W/"21"', actingUserSystemId: undefined },
    );

    updateSpy.mockRestore();
  });
});
