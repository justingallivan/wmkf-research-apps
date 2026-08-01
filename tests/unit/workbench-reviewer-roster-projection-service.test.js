/** @jest-environment node */

const findByRequest = jest.fn();
const findById = jest.fn();
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  findByRequest: (...args) => findByRequest(...args),
  findById: (...args) => findById(...args),
}));

import {
  reconcileRosterEngagement,
  validateRosterPromotionEngagement,
} from '../../lib/services/workbench/reviewer-roster-projection-service';

const REQ = '11111111-1111-1111-1111-111111111111';
const SUG_INVITED = '22222222-2222-2222-2222-222222222222';
const SUG_ACTIVE = '33333333-3333-3333-3333-333333333333';
const SUG_MISSING = '44444444-4444-4444-4444-444444444444';
const SUG_DECLINED = '55555555-5555-5555-5555-555555555555';

test('all suggestion-anchored roster rows reconcile against Dataverse; handled and missing anchors are not actionable', async () => {
  findByRequest.mockResolvedValue([
    { wmkf_appreviewersuggestionid: SUG_INVITED, wmkf_selected: true, wmkf_invited: true },
    { wmkf_appreviewersuggestionid: SUG_ACTIVE, wmkf_selected: false },
    { wmkf_appreviewersuggestionid: SUG_DECLINED, wmkf_selected: false, wmkf_declined: true },
  ]);
  const roster = {
    active: [
      { candidateKey: `suggestion:${SUG_INVITED}`, suggestionId: SUG_INVITED, name: 'Invited Search Result', provenance: { kind: 'literature_retrieved' } },
      { candidateKey: `suggestion:${SUG_ACTIVE}`, suggestionId: SUG_ACTIVE, name: 'Unengaged Applicant', isApplicantRecommended: true },
      { candidateKey: `suggestion:${SUG_MISSING}`, suggestionId: SUG_MISSING, name: 'Orphan' },
      { candidateKey: 'candidate:unanchored', name: 'Unanchored Search Result' },
    ],
    excluded: [
      { candidateKey: `suggestion:${SUG_DECLINED}`, suggestionId: SUG_DECLINED, name: 'Declined Reviewer' },
    ],
    ineligible: [],
    blocked: [],
    savedKeys: [],
  };

  const result = await reconcileRosterEngagement({ requestId: REQ, roster });

  expect(findByRequest).toHaveBeenCalledWith(REQ, { selectedOnly: false, requireComplete: true });
  expect(result.active.map((candidate) => candidate.name)).toEqual([
    'Unengaged Applicant',
    'Unanchored Search Result',
  ]);
  expect(result.excluded).toEqual([]);
  expect(result.handled).toEqual([
    {
      suggestionId: SUG_INVITED,
      candidateKey: `suggestion:${SUG_INVITED}`,
      name: 'Invited Search Result',
      stage: 'invited',
    },
    {
      suggestionId: SUG_DECLINED,
      candidateKey: `suggestion:${SUG_DECLINED}`,
      name: 'Declined Reviewer',
      stage: 'declined',
    },
  ]);
});

test('excluded promotion validation rejects handled and missing anchors', async () => {
  findById.mockResolvedValueOnce({
    wmkf_appreviewersuggestionid: SUG_DECLINED,
    _wmkf_request_value: REQ,
    wmkf_declined: true,
  });
  await expect(validateRosterPromotionEngagement({
    requestId: REQ,
    candidate: { suggestionId: SUG_DECLINED },
  })).resolves.toMatchObject({ allowed: false, code: 'reviewer_already_handled', stage: 'declined' });

  findById.mockResolvedValueOnce(null);
  await expect(validateRosterPromotionEngagement({
    requestId: REQ,
    candidate: { suggestionId: SUG_MISSING },
  })).resolves.toMatchObject({ allowed: false, code: 'reviewer_anchor_unavailable' });
});
