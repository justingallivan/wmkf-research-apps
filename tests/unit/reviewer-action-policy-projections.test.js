/**
 * @jest-environment node
 */

import { DynamicsService } from '../../lib/services/dynamics-service.js';
import {
  REVIEWER_ACTION_POLICY_PERSON_FIELDS,
  REVIEWER_ACTION_POLICY_SUGGESTION_FIELDS,
} from '../../lib/services/reviewer-action-policy.js';
import { getActionPolicyById } from '../../lib/dataverse/adapters/potential-reviewer.js';
import {
  APPLICANT_DISPOSITION_EXCLUDED,
  findActionPolicyById,
} from '../../lib/dataverse/adapters/reviewer-suggestion.js';

afterEach(() => jest.restoreAllMocks());

describe('reviewer action-policy projections', () => {
  test('person projection reads exactly the id and every raw policy field', async () => {
    const row = { wmkf_potentialreviewersid: 'person-1' };
    const getRecord = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue(row);

    await expect(getActionPolicyById('person-1')).resolves.toBe(row);
    expect(getRecord).toHaveBeenCalledWith('wmkf_potentialreviewerses', 'person-1', {
      select: ['wmkf_potentialreviewersid', ...REVIEWER_ACTION_POLICY_PERSON_FIELDS].join(','),
    });
  });

  test('person projection rejects a missing id before reading', async () => {
    const getRecord = jest.spyOn(DynamicsService, 'getRecord');
    await expect(getActionPolicyById()).rejects.toThrow(/id required/);
    expect(getRecord).not.toHaveBeenCalled();
  });

  test('suggestion projection reads linkage, exclusion, and every raw policy field', async () => {
    const row = { wmkf_appreviewersuggestionid: 'suggestion-1', wmkf_applicantdisposition: null };
    const getRecord = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue(row);

    await expect(findActionPolicyById('suggestion-1')).resolves.toBe(row);
    expect(getRecord).toHaveBeenCalledWith('wmkf_appreviewersuggestions', 'suggestion-1', {
      select: [
        'wmkf_appreviewersuggestionid',
        '_wmkf_potentialreviewer_value',
        '_wmkf_request_value',
        'wmkf_applicantdisposition',
        ...REVIEWER_ACTION_POLICY_SUGGESTION_FIELDS,
      ].join(','),
    });
  });

  test('suggestion projection refuses a present applicant-excluded row', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({
      wmkf_appreviewersuggestionid: 'suggestion-1',
      wmkf_applicantdisposition: APPLICANT_DISPOSITION_EXCLUDED,
    });

    await expect(findActionPolicyById('suggestion-1')).rejects.toThrow(/applicant-excluded/);
  });

  test('suggestion projection rejects a missing id before reading', async () => {
    const getRecord = jest.spyOn(DynamicsService, 'getRecord');
    await expect(findActionPolicyById()).rejects.toThrow(/id required/);
    expect(getRecord).not.toHaveBeenCalled();
  });
});
