/**
 * @jest-environment node
 *
 * reviewer-suggestion.getForExternalVerification — thin passthrough that
 * byte-mirrors verify-suggestion-token.js's inline getRecord call (entity
 * set fixed by the adapter; select/expand supplied by the caller). No
 * excluded-row throw, no bypassDynamicsRestrictions — those stay with the
 * caller (data-access-layer migration, Stage 3-6).
 */
import { jest } from '@jest/globals';
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import { getForExternalVerification } from '../../lib/dataverse/adapters/reviewer-suggestion.js';

const SUGGESTION_ID = '11111111-1111-4111-8111-111111111111';

afterEach(() => jest.restoreAllMocks());

describe('getForExternalVerification', () => {
  it('forwards the entity set fixed and select/expand exactly as given', async () => {
    const spy = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({ wmkf_appreviewersuggestionid: SUGGESTION_ID });
    const select = 'wmkf_appreviewersuggestionid,wmkf_externaltokenhash';
    const expand = 'wmkf_Request($select=akoya_requestid),wmkf_PotentialReviewer($select=wmkf_name)';

    await getForExternalVerification(SUGGESTION_ID, { select, expand });

    expect(spy).toHaveBeenCalledWith('wmkf_appreviewersuggestions', SUGGESTION_ID, { select, expand });
  });

  it('propagates errors (incl. 404) unchanged for the caller\'s own try/catch', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockRejectedValue(new Error('Get record failed (404): {}'));
    await expect(getForExternalVerification(SUGGESTION_ID, { select: 'x', expand: 'y' })).rejects.toThrow(/404/);
  });
});
