/**
 * @jest-environment node
 */

import {
  CANDIDATE_REASON_PRESENTATION,
  getCandidateReasonPresentation,
} from '../../shared/components/reviewers/reviewer-search-logic';

describe('candidate reasoning presentation contract', () => {
  test('every presentation kind has a label and an explicit remedy contract', () => {
    expect(Object.keys(CANDIDATE_REASON_PRESENTATION).sort()).toEqual([
      'identity_review',
      'record_repair',
      'suggestion',
    ]);
    for (const presentation of Object.values(CANDIDATE_REASON_PRESENTATION)) {
      expect(presentation.label).toEqual(expect.any(String));
      expect(Object.prototype.hasOwnProperty.call(presentation, 'remedyId')).toBe(true);
    }
  });

  test('unresolved identity reasoning is review copy with the confirm-identity remedy', () => {
    expect(getCandidateReasonPresentation({
      reasoning: 'Could not confirm this is the right person.',
      identityStatus: 'unresolved',
    })).toMatchObject({
      kind: 'identity_review',
      label: 'Why this needs review:',
      remedyId: 'confirm_identity',
    });
  });

  test('server-required identity review cannot inherit positive suggestion framing', () => {
    expect(getCandidateReasonPresentation({
      reasoning: 'The ORCID and email resolve to different people.',
      identityStatus: 'probable',
      serverIdentityReviewReason: 'orcid_email_split',
      pdIdentityConfirmed: false,
    })).toMatchObject({
      kind: 'identity_review',
      label: 'Why this needs review:',
      remedyId: 'confirm_identity',
    });
  });

  test('positive rationale keeps the suggestion label', () => {
    expect(getCandidateReasonPresentation({
      reasoning: 'Their work directly addresses the proposal.',
      identityStatus: 'probable',
      email: 'reviewer@example.edu',
      emailSource: 'institution_page',
    })).toMatchObject({
      kind: 'suggestion',
      label: 'Suggested because:',
      remedyId: null,
    });
  });

  test('record-repair reasoning maps to the repair remedy', () => {
    expect(getCandidateReasonPresentation({
      reasoning: 'The linked record is inactive.',
      applicantKnownReviewer: { status: 'inactive' },
    })).toMatchObject({
      kind: 'record_repair',
      label: 'Why this needs repair:',
      remedyId: 'create_repair_request',
    });
  });

  test('missing reasoning renders nothing', () => {
    expect(getCandidateReasonPresentation({ identityStatus: 'unresolved' })).toBeNull();
  });
});
