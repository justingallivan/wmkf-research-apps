/**
 * Stage 6C — pure structural extraction pin
 * (docs/REVIEWER_LIFECYCLE_STAGE6C_BUILD_PLAN.md). ReviewerManagePanel.js
 * moved ReleaseMaterialsModal, TokenActionsMenu/TokenStateBadge, and
 * ReviewReminderAction (plus supporting constants) into their own modules,
 * re-exporting each named symbol so existing importers keep working. This
 * file is the only regression teeth a pure move can add: it pins that the
 * re-exports are reference-identical (not copies) to the new modules'
 * exports, and that the extracted `membershipKeyFor`/`proposalKeyFor` still
 * produce the exact strings the 6B3 suites depend on. Behavior teeth for the
 * moved components themselves live in the retained suites listed in the
 * Stage 6C plan.
 */

import ReviewerManagePanel, {
  TokenActionsMenu,
  TokenStateBadge,
  ReviewReminderAction,
  PREVIEW_RENDER_TIMEOUT_MS,
} from '../../shared/components/reviewers/ReviewerManagePanel';

import {
  TokenActionsMenu as TokenActionsMenuDirect,
  TokenStateBadge as TokenStateBadgeDirect,
} from '../../shared/components/reviewers/TokenActionsMenu';
import { ReviewReminderAction as ReviewReminderActionDirect } from '../../shared/components/reviewers/ReviewReminderAction';
import { PREVIEW_RENDER_TIMEOUT_MS as PREVIEW_RENDER_TIMEOUT_MS_DIRECT } from '../../shared/components/reviewers/ReleaseMaterialsModal';
import { membershipKeyFor, proposalKeyFor } from '../../shared/components/reviewers/reviewer-draft-keys';

// Two-reviewer fixture copied from reviewer-materials-modal-lifetimes.test.js
// (Stage 6B3) so the pinned membershipKeyFor string matches what that suite's
// session-identity assertions rely on.
const REVIEWER_A = { suggestionId: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Accepted A', email: 'a@example.org', reviewStatus: 'accepted' };
const REVIEWER_B = { suggestionId: 'bbbbbbbb-0000-0000-0000-000000000002', name: 'Accepted B', email: 'b@example.org', reviewStatus: 'accepted' };

// Proposal fixture copied from the same suite's PROPOSAL constant.
const PROPOSAL = {
  proposalId: '00000000-0000-0000-0000-000000000001',
  proposalTitle: 'Proposal Under Review',
  reviewDeadline: '2026-07-22',
  proposalAbstract: 'Original abstract text.',
  proposalAuthors: 'Dr. Original PI',
  proposalInstitution: 'Original University',
};

describe('ReviewerManagePanel re-exports (Stage 6C extraction)', () => {
  it('is still the default export', () => {
    expect(typeof ReviewerManagePanel).toBe('function');
  });

  it('re-exports TokenActionsMenu reference-identical to TokenActionsMenu.js', () => {
    expect(TokenActionsMenu).toBe(TokenActionsMenuDirect);
  });

  it('re-exports TokenStateBadge reference-identical to TokenActionsMenu.js', () => {
    expect(TokenStateBadge).toBe(TokenStateBadgeDirect);
  });

  it('re-exports ReviewReminderAction reference-identical to ReviewReminderAction.js', () => {
    expect(ReviewReminderAction).toBe(ReviewReminderActionDirect);
  });

  it('re-exports PREVIEW_RENDER_TIMEOUT_MS reference-identical to ReleaseMaterialsModal.js', () => {
    expect(PREVIEW_RENDER_TIMEOUT_MS).toBe(PREVIEW_RENDER_TIMEOUT_MS_DIRECT);
  });
});

describe('reviewer-draft-keys (Stage 6C extraction)', () => {
  it('membershipKeyFor produces the exact two-reviewer key', () => {
    const FIELD_SEP = String.fromCharCode(0);
    const ROW_SEP = String.fromCharCode(1);
    const expected = [
      `aaaaaaaa-0000-0000-0000-000000000001${FIELD_SEP}Accepted A${FIELD_SEP}a@example.org${FIELD_SEP}`,
      `bbbbbbbb-0000-0000-0000-000000000002${FIELD_SEP}Accepted B${FIELD_SEP}b@example.org${FIELD_SEP}`,
    ].join(ROW_SEP);

    expect(membershipKeyFor([REVIEWER_A, REVIEWER_B])).toBe(expected);
  });

  it('membershipKeyFor is order-independent (sorted, not array order)', () => {
    expect(membershipKeyFor([REVIEWER_A, REVIEWER_B])).toBe(membershipKeyFor([REVIEWER_B, REVIEWER_A]));
  });

  it('membershipKeyFor of an empty array is the empty string', () => {
    expect(membershipKeyFor([])).toBe('');
  });

  it('proposalKeyFor produces the exact four-field key', () => {
    const FIELD_SEP = String.fromCharCode(0);
    const expected = [
      'Proposal Under Review',
      'Original abstract text.',
      'Dr. Original PI',
      'Original University',
    ].join(FIELD_SEP);

    expect(proposalKeyFor(PROPOSAL)).toBe(expected);
  });

  it('proposalKeyFor of a null proposal is the four-empty-field join', () => {
    const FIELD_SEP = String.fromCharCode(0);
    expect(proposalKeyFor(null)).toBe(['', '', '', ''].join(FIELD_SEP));
  });
});
