/**
 * @jest-environment node
 *
 * reviewer-suggestion.getForTokenRegeneration — byte-mirrors the
 * regenerate-token.js route's inline getRecord call (data-access-layer
 * migration, Stage 3-6).
 */
import { jest } from '@jest/globals';
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import { getForTokenRegeneration } from '../../lib/dataverse/adapters/reviewer-suggestion.js';

const SUGGESTION_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';

afterEach(() => jest.restoreAllMocks());

describe('getForTokenRegeneration', () => {
  it('calls getRecord with the regeneration-scoped select', async () => {
    const spy = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({
      wmkf_appreviewersuggestionid: SUGGESTION_ID,
      _wmkf_request_value: REQUEST_ID,
      wmkf_applicantdisposition: null,
    });

    const row = await getForTokenRegeneration(SUGGESTION_ID);

    expect(spy).toHaveBeenCalledWith('wmkf_appreviewersuggestions', SUGGESTION_ID, {
      select: 'wmkf_appreviewersuggestionid,_wmkf_request_value,wmkf_applicantdisposition,wmkf_accepted,wmkf_reviewduedateoverride',
    });
    expect(row._wmkf_request_value).toBe(REQUEST_ID);
  });

  it('propagates a 404 error unchanged', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockRejectedValue(new Error('Get record failed (404): {}'));
    await expect(getForTokenRegeneration(SUGGESTION_ID)).rejects.toThrow(/404/);
  });
});
