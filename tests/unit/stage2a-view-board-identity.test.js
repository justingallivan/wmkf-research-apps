/**
 * @jest-environment jsdom
 *
 * Stage 2a board-writeup identity card (S308): the required helper + the card's
 * prefill roundtrip and presence of the three fields.
 */

import { render, screen } from '@testing-library/react';
import Stage2aView, { missingBoardIdentityFields } from '../../shared/components/external/Stage2aView';

function makeData(identityPrefill = {}) {
  return {
    etag: 'W/"1"',
    proposal: { title: 'A Proposal', requestNumber: 'R-123', applicantInstitution: 'Example University', projectLeader: 'Dr. PI', coPIs: [], abstract: 'x' },
    prefill: {
      firstName: 'Jane', lastName: 'Doe', email: 'jane@example.org', honorariumOptOut: true,
      ...identityPrefill,
    },
    policies: {
      'reviewer-coi': { slotCode: 'reviewer-coi', title: 'Conflict of Interest', versionLabel: '1', body: 'COI body' },
      'reviewer-ai-use': { slotCode: 'reviewer-ai-use', title: 'AI Use', versionLabel: '1', body: 'AI body' },
    },
  };
}

describe('Stage2aView board-identity card', () => {
  it('renders the three identity fields, prefilling department + institution', () => {
    render(
      <Stage2aView
        data={makeData({ primaryDepartment: 'Department of Chemistry', mainInstitution: 'Stanford University' })}
        token="tok"
        onRequestDecline={() => {}}
        onAccepted={() => {}}
      />,
    );
    expect(screen.getByText('Your academic identity')).toBeInTheDocument();
    expect(screen.getByText('Academic rank')).toBeInTheDocument();
    // Prefill roundtrip from the person enrichment seed.
    expect(screen.getByDisplayValue('Department of Chemistry')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Stanford University')).toBeInTheDocument();
  });
});

describe('missingBoardIdentityFields', () => {
  const complete = { academicRank: 'Professor', primaryDepartment: 'Chemistry', mainInstitution: 'MIT' };

  it('returns [] when all three are present', () => {
    expect(missingBoardIdentityFields(complete)).toEqual([]);
  });

  it('flags each empty/whitespace field', () => {
    expect(missingBoardIdentityFields({ ...complete, academicRank: '' })).toEqual(['academicRank']);
    expect(missingBoardIdentityFields({ ...complete, primaryDepartment: '   ' })).toEqual(['primaryDepartment']);
    expect(missingBoardIdentityFields({ academicRank: '', primaryDepartment: '', mainInstitution: '' }))
      .toEqual(['academicRank', 'primaryDepartment', 'mainInstitution']);
  });
});
