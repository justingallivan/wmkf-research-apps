/**
 * @jest-environment node
 *
 * deriveProposalAuthorNames — the shared PI+co-investigator exclusion/COI set
 * used by BOTH reviewer-finder/discover.js and workbench/enrich-recommended.js
 * (S213 parity consolidation). Locks: co-PIs are folded in, sentinel
 * placeholders ("Not specified" / "None") never leak in as a literal name, and
 * dedup is case-insensitive.
 */
import { deriveProposalAuthorNames } from '../../lib/utils/proposal-authors.js';

describe('deriveProposalAuthorNames', () => {
  test('PI only → single name', () => {
    expect(deriveProposalAuthorNames({ proposalAuthors: 'Dr. Jane Smith', coInvestigators: 'None' }))
      .toEqual(['Dr. Jane Smith']);
  });

  test('folds in co-investigators (the parity fix)', () => {
    expect(deriveProposalAuthorNames({ proposalAuthors: 'Jane Smith', coInvestigators: 'John Doe, Maria Garcia' }))
      .toEqual(['Jane Smith', 'John Doe', 'Maria Garcia']);
  });

  test('PI "Not specified" but co-PIs present → only the co-PIs', () => {
    expect(deriveProposalAuthorNames({ proposalAuthors: 'Not specified', coInvestigators: 'John Doe' }))
      .toEqual(['John Doe']);
  });

  test('co-PI sentinels ("None"/"N/A") never leak in as a name', () => {
    expect(deriveProposalAuthorNames({ proposalAuthors: 'Jane Smith', coInvestigators: 'None' })).toEqual(['Jane Smith']);
    expect(deriveProposalAuthorNames({ proposalAuthors: 'Jane Smith', coInvestigators: 'n/a' })).toEqual(['Jane Smith']);
  });

  test('both unset → empty array', () => {
    expect(deriveProposalAuthorNames({ proposalAuthors: 'Not specified', coInvestigators: 'None' })).toEqual([]);
    expect(deriveProposalAuthorNames({})).toEqual([]);
    expect(deriveProposalAuthorNames()).toEqual([]);
  });

  test('case-insensitive dedup across PI + co-PI lists', () => {
    expect(deriveProposalAuthorNames({ proposalAuthors: 'Jane Smith', coInvestigators: 'jane smith, Bob Lee' }))
      .toEqual(['Jane Smith', 'Bob Lee']);
  });

  test('trims whitespace and drops empty segments', () => {
    expect(deriveProposalAuthorNames({ proposalAuthors: '  Jane Smith , , ', coInvestigators: ' Bob Lee ' }))
      .toEqual(['Jane Smith', 'Bob Lee']);
  });
});
