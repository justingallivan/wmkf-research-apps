/**
 * Characterization test for the wmkf_proposalbudgetlines adapter
 * (lib/dataverse/adapters/proposal-budget-line.js).
 *
 * Byte-mirrors the single raw createRecord call in
 * pages/api/cron/drain-submissions.js's budget-line drain step.
 *
 * @jest-environment node
 */

import { jest } from '@jest/globals';
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import * as proposalBudgetLine from '../../lib/dataverse/adapters/proposal-budget-line.js';

afterEach(() => jest.restoreAllMocks());

describe('proposal-budget-line.create (characterization)', () => {
  test('golden: forwards payload verbatim, no options', async () => {
    const c = jest.spyOn(DynamicsService, 'createRecord').mockResolvedValue({ wmkf_proposalbudgetlineid: 'b1' });
    const payload = { wmkf_proposalbudgetlineid: 'b1', 'wmkf_Request@odata.bind': '/akoya_requests(r1)' };
    const out = await proposalBudgetLine.create(payload);
    expect(out).toEqual({ wmkf_proposalbudgetlineid: 'b1' });
    expect(c).toHaveBeenCalledWith('wmkf_proposalbudgetlines', payload);
    expect(c.mock.calls[0]).toHaveLength(2);
  });

  test('failure path: propagates a duplicate_pk-style rejection', async () => {
    jest.spyOn(DynamicsService, 'createRecord').mockRejectedValue(Object.assign(new Error('dup'), { status: 412 }));
    await expect(proposalBudgetLine.create({})).rejects.toThrow('dup');
  });
});
