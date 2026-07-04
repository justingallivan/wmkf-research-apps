/**
 * @jest-environment node
 *
 * reviewer-suggestion.getForAcceptanceDrain — byte-mirrors
 * reviewer-acceptance-drain.js's readCurrentSuggestion inline getRecord call
 * (data-access-layer migration, Stage 3-6).
 */
import { jest } from '@jest/globals';
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import { getForAcceptanceDrain } from '../../lib/dataverse/adapters/reviewer-suggestion.js';

const SUGGESTION_ID = '11111111-1111-4111-8111-111111111111';

afterEach(() => jest.restoreAllMocks());

describe('getForAcceptanceDrain', () => {
  it('calls getRecord with the acceptance-drain select', async () => {
    const spy = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({ wmkf_appreviewersuggestionid: SUGGESTION_ID, wmkf_accepted: true });
    const row = await getForAcceptanceDrain(SUGGESTION_ID);
    expect(spy).toHaveBeenCalledWith('wmkf_appreviewersuggestions', SUGGESTION_ID, {
      select: 'wmkf_appreviewersuggestionid,wmkf_accepted,wmkf_declined,wmkf_responsetype,wmkf_reviewstatus,wmkf_reviewreceivedat,wmkf_responsereceivedat,wmkf_honorariumoptout,wmkf_reviewerfirstname,wmkf_reviewerlastname,wmkf_reviewernickname,wmkf_reviewertitle,wmkf_revieweraffiliation,wmkf_revieweremail,wmkf_reviewerorcid,_wmkf_honorariumrequest_value,_wmkf_request_value,_wmkf_potentialreviewer_value',
    });
    expect(row.wmkf_accepted).toBe(true);
  });
});
