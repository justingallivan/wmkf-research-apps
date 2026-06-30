/**
 * @jest-environment jsdom
 *
 * Invite Reviewers tab "Export to Excel" — posts the saved candidate list to the
 * shared workbench export route as a slim invite-stage DTO (incl. expertise keywords).
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ReviewerInvitePanel from '../../shared/components/reviewers/ReviewerInvitePanel';

jest.mock('../../shared/components/Layout', () => ({
  Card: ({ children }) => <div>{children}</div>,
}));
jest.mock('../../shared/components/reviewers/CandidateEditModal', () => function CandidateEditModal() {
  return null;
});
jest.mock('../../shared/components/reviewers/InviteEmailModal', () => function InviteEmailModal() {
  return null;
});

const candidates = [
  {
    suggestionId: 'S1',
    name: 'Dr. Test Reviewer',
    affiliation: 'Example University',
    email: 'reviewer@example.org',
    reasoning: 'Strong fit for the proposal topic.',
    keywords: 'catalysis; surface chemistry',
    orcidUrl: 'https://orcid.org/0000-0002-1825-0097',
    googleScholarUrl: 'https://scholar.google.com/citations?user=abc',
    hIndex: 33,
    applicantRecommended: true,
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  global.URL.createObjectURL = jest.fn(() => 'blob:mock');
  global.URL.revokeObjectURL = jest.fn();
  global.fetch.mockImplementation(async (url) => {
    if (url === '/api/workbench/export-candidates') {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'attachment; filename="reviewer-candidates-1002836-2026-06-30.xlsx"' },
        blob: async () => new Blob(['x']),
      };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
});

describe('ReviewerInvitePanel export', () => {
  test('Export to Excel posts the full candidate list as a slim DTO with keywords', async () => {
    render(<ReviewerInvitePanel requestId="11111111-1111-1111-1111-111111111111" candidates={candidates} />);

    fireEvent.click(screen.getByRole('button', { name: /export to excel/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/workbench/export-candidates',
      expect.objectContaining({ method: 'POST' }),
    ));
    const call = global.fetch.mock.calls.find(([u]) => u === '/api/workbench/export-candidates');
    const payload = JSON.parse(call[1].body);
    expect(payload.requestId).toBe('11111111-1111-1111-1111-111111111111');
    expect(payload.candidates).toHaveLength(1);
    expect(payload.candidates[0]).toMatchObject({
      name: 'Dr. Test Reviewer',
      email: 'reviewer@example.org',
      keywords: 'catalysis; surface chemistry',
      isApplicantRecommended: true,
      hIndex: 33,
    });
    await waitFor(() => expect(global.URL.createObjectURL).toHaveBeenCalled());
  });

  test('no export button when the candidate list is empty', () => {
    render(<ReviewerInvitePanel requestId="11111111-1111-1111-1111-111111111111" candidates={[]} />);
    expect(screen.queryByRole('button', { name: /export to excel/i })).toBeNull();
  });
});
