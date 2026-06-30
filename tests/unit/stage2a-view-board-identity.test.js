/**
 * @jest-environment jsdom
 *
 * Stage 2a board-writeup identity card (S308): the required helper + the card's
 * prefill roundtrip and presence of the three fields.
 */

import { render, screen } from '@testing-library/react';
import Stage2aView, {
  missingBoardIdentityFields,
  buildSubmitContactEdits,
} from '../../shared/components/external/Stage2aView';

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

  it('no longer shows the removed contact fields (Display preference, Title, Affiliation)', () => {
    render(
      <Stage2aView
        data={makeData({ primaryDepartment: 'Chemistry', mainInstitution: 'MIT' })}
        token="tok"
        onRequestDecline={() => {}}
        onAccepted={() => {}}
      />,
    );
    expect(screen.getByText('Confirm your contact info')).toBeInTheDocument();
    expect(screen.queryByText('Display preference')).not.toBeInTheDocument();
    expect(screen.queryByText('Title')).not.toBeInTheDocument();
    expect(screen.queryByText('Affiliation')).not.toBeInTheDocument();
  });
});

describe('buildSubmitContactEdits', () => {
  const boardIdentity = { academicRank: 'Professor', primaryDepartment: 'Chemistry', mainInstitution: 'Princeton University' };

  it('derives title from academic rank and affiliation from main institution', () => {
    const edits = buildSubmitContactEdits({
      contact: { firstName: 'Jane', lastName: 'Doe', email: 'jane@x.org', orcid: '' },
      prefill: { firstName: 'Jane', lastName: 'Doe', email: 'jane@x.org', orcid: '' },
      boardIdentity,
    });
    // Title -> CRM job title; Affiliation -> COI mismatch value.
    expect(edits.title).toBe('Professor');
    expect(edits.affiliation).toBe('Princeton University');
  });

  it('still includes genuinely changed contact fields, omits unchanged ones', () => {
    const edits = buildSubmitContactEdits({
      contact: { firstName: 'Janet', lastName: 'Doe', email: 'jane@x.org', orcid: '' },
      prefill: { firstName: 'Jane', lastName: 'Doe', email: 'jane@x.org', orcid: '' },
      boardIdentity,
    });
    expect(edits.firstName).toBe('Janet'); // changed
    expect(edits).not.toHaveProperty('lastName'); // unchanged -> omitted
    expect(edits).not.toHaveProperty('email'); // unchanged -> omitted
  });

  it('trims the derived values and tolerates blank board identity', () => {
    const edits = buildSubmitContactEdits({
      contact: {},
      prefill: {},
      boardIdentity: { academicRank: '  Associate Professor  ', mainInstitution: '' },
    });
    expect(edits.title).toBe('Associate Professor');
    expect(edits.affiliation).toBe('');
  });

  it('clamps derived title/affiliation to the server contactEdits caps (200/300)', () => {
    const edits = buildSubmitContactEdits({
      contact: {},
      prefill: {},
      boardIdentity: { academicRank: 'R'.repeat(250), mainInstitution: 'I'.repeat(350) },
    });
    expect(edits.title).toHaveLength(200);
    expect(edits.affiliation).toHaveLength(300);
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
