/**
 * @jest-environment node
 */

jest.mock('../../lib/dataverse/core/changeset.js', () => ({
  runChangeset: jest.fn(async () => ({ ok: true })),
}));

import { runChangeset } from '../../lib/dataverse/core/changeset.js';
import {
  applyStage2aResponse,
  deleteLinkedHonorariumForDeclinedSuggestion,
  RESPONSE_TYPE_MAP,
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
});
