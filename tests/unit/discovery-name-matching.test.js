/**
 * Characterization tests for the DiscoveryService name-matching cluster
 * (normalizeNameForMatch, firstNamesEquivalent, generateNameVariants, nameMatchEvidence,
 * namesMatch, filterToMatchingAuthor, filterToMatchingAuthorMultiVariant, evaluateNameEvidence).
 *
 * Written BEFORE Stage 1 of the DiscoveryService decomposition
 * (docs/DISCOVERY_SERVICE_DECOMPOSITION_PLAN.md) to pin the current, observable behavior of these
 * previously-untested methods so the code-motion into lib/services/discovery/name-matching.js is
 * provably behavior-preserving. Every assertion here is the ACTUAL output of the pre-extraction code.
 */

const { DiscoveryService } = require('../../lib/services/discovery-service');

describe('DiscoveryService.normalizeNameForMatch', () => {
  it('lowercases, strips leading title, collapses whitespace, trims', () => {
    expect(DiscoveryService.normalizeNameForMatch('Dr. Jane  Smith')).toBe('jane smith');
    expect(DiscoveryService.normalizeNameForMatch('Professor John Doe')).toBe('john doe');
    expect(DiscoveryService.normalizeNameForMatch('  Alice   Munro ')).toBe('alice munro');
  });
  it('returns empty string for falsy input', () => {
    expect(DiscoveryService.normalizeNameForMatch('')).toBe('');
    expect(DiscoveryService.normalizeNameForMatch(null)).toBe('');
    expect(DiscoveryService.normalizeNameForMatch(undefined)).toBe('');
  });
});

describe('DiscoveryService.firstNamesEquivalent', () => {
  it('true for exact (case-insensitive) match', () => {
    expect(DiscoveryService.firstNamesEquivalent('Anne', 'anne')).toBe(true);
  });
  it('true for nickname-map equivalence in both directions', () => {
    expect(DiscoveryService.firstNamesEquivalent('Will', 'William')).toBe(true);
    expect(DiscoveryService.firstNamesEquivalent('William', 'Will')).toBe(true);
    expect(DiscoveryService.firstNamesEquivalent('Bob', 'Robert')).toBe(true);
  });
  it('false for unrelated names and falsy input', () => {
    expect(DiscoveryService.firstNamesEquivalent('Jane', 'John')).toBe(false);
    expect(DiscoveryService.firstNamesEquivalent('', 'x')).toBe(false);
    expect(DiscoveryService.firstNamesEquivalent('x', '')).toBe(false);
  });
});

describe('DiscoveryService.generateNameVariants', () => {
  it('emits full + nickname-expanded + initial variants', () => {
    expect(DiscoveryService.generateNameVariants('Will Harcombe')).toEqual([
      'Will Harcombe', 'William Harcombe', 'W Harcombe',
    ]);
    expect(DiscoveryService.generateNameVariants('Bob Dylan')).toEqual([
      'Bob Dylan', 'Robert Dylan', 'B Dylan',
    ]);
  });
  it('strips a leading title before splitting; no nickname → full + initial only', () => {
    expect(DiscoveryService.generateNameVariants('Dr. Jane Smith')).toEqual([
      'Jane Smith', 'J Smith',
    ]);
  });
  it('single-token name yields just the cleaned name', () => {
    expect(DiscoveryService.generateNameVariants('Cher')).toEqual(['Cher']);
  });
});

describe('DiscoveryService.nameMatchEvidence', () => {
  it('full forename + surname match', () => {
    expect(DiscoveryService.nameMatchEvidence('Jane Smith', 'Jane Smith')).toEqual({
      matches: true,
      fullForenameMatch: true,
      initialOnly: false,
      matchedAuthorName: 'jane smith',
      reason: 'Full forename and surname matched',
    });
  });
  it('flags missing name when either side normalizes empty', () => {
    expect(DiscoveryService.nameMatchEvidence('', 'Jane Smith')).toEqual({
      matches: false, fullForenameMatch: false, initialOnly: false, reason: 'Missing name',
    });
  });
  it('flags differing surnames', () => {
    expect(DiscoveryService.nameMatchEvidence('Jane Doe', 'Jane Smith')).toEqual({
      matches: false, fullForenameMatch: false, initialOnly: false, reason: 'Surnames differ',
    });
  });
  it('differing full forenames (same surname, same initial, equal lengths) do not match', () => {
    expect(DiscoveryService.nameMatchEvidence('Jane Smith', 'John Smith')).toEqual({
      matches: false, fullForenameMatch: false, initialOnly: false, reason: 'Full forenames differ',
    });
  });
  it('initial on the suggested side matching a full author forename is an initial-only match', () => {
    expect(DiscoveryService.nameMatchEvidence('J Smith', 'Jane Smith')).toEqual({
      matches: true,
      fullForenameMatch: false,
      initialOnly: true,
      matchedAuthorName: 'jane smith',
      reason: 'Only first initial matched the returned author forename',
    });
  });
  it('initial on the author side matching the suggested full forename', () => {
    expect(DiscoveryService.nameMatchEvidence('Jane Smith', 'J Smith')).toEqual({
      matches: true,
      fullForenameMatch: false,
      initialOnly: true,
      matchedAuthorName: 'j smith',
      reason: 'Returned author only provided a first initial',
    });
  });
  it('3-vs-2 token strings sharing a first initial match as initials-only', () => {
    expect(DiscoveryService.nameMatchEvidence('Jon A Smith', 'Jonathan Smith')).toEqual({
      matches: true,
      fullForenameMatch: false,
      initialOnly: true,
      matchedAuthorName: 'jonathan smith',
      reason: 'Only initials matched between author strings',
    });
  });
});

describe('DiscoveryService.namesMatch', () => {
  it('matches full and initial-only by default', () => {
    expect(DiscoveryService.namesMatch('Jane Smith', 'Jane Smith')).toBe(true);
    expect(DiscoveryService.namesMatch('J Smith', 'Jane Smith')).toBe(true);
    expect(DiscoveryService.namesMatch('Jane Smith', 'John Smith')).toBe(false);
  });
  it('rejects initial-only matches when allowInitialOnly is false', () => {
    expect(DiscoveryService.namesMatch('J Smith', 'Jane Smith', { allowInitialOnly: false })).toBe(false);
    expect(DiscoveryService.namesMatch('Jane Smith', 'Jane Smith', { allowInitialOnly: false })).toBe(true);
  });
});

describe('DiscoveryService.filterToMatchingAuthor', () => {
  const articles = [
    { title: 'A', authors: [{ name: 'Jane Smith' }, { name: 'X Y' }] },
    { title: 'B', authors: [{ name: 'Bob Jones' }] },
    { title: 'C' }, // no authors
  ];
  it('keeps only articles whose author list contains the target', () => {
    expect(DiscoveryService.filterToMatchingAuthor(articles, 'Jane Smith').map(a => a.title)).toEqual(['A']);
  });
  it('guards null/empty inputs', () => {
    expect(DiscoveryService.filterToMatchingAuthor(null, 'x')).toEqual([]);
    expect(DiscoveryService.filterToMatchingAuthor(articles, null)).toEqual([]);
  });
});

describe('DiscoveryService.filterToMatchingAuthorMultiVariant', () => {
  const articles = [
    { title: 'A', authors: [{ name: 'W Harcombe' }] },
    { title: 'B', authors: [{ name: 'Someone Else' }] },
  ];
  it('keeps an article when ANY variant matches an author', () => {
    const out = DiscoveryService.filterToMatchingAuthorMultiVariant(articles, ['William Harcombe', 'W Harcombe']);
    expect(out.map(a => a.title)).toEqual(['A']);
  });
  it('empty variant list yields empty result', () => {
    expect(DiscoveryService.filterToMatchingAuthorMultiVariant(articles, [])).toEqual([]);
  });
});

describe('DiscoveryService.evaluateNameEvidence', () => {
  it('short-circuits on a full forename match', () => {
    expect(DiscoveryService.evaluateNameEvidence('Jane Smith', [{ authors: [{ name: 'Jane Smith' }] }])).toEqual({
      suggestedName: 'jane smith',
      hasFullForenameMatch: true,
      hasInitialOnlyMatch: false,
      matchedAuthorName: 'jane smith',
      reason: 'Full forename and surname matched',
    });
  });
  it('records an initial-only match', () => {
    expect(DiscoveryService.evaluateNameEvidence('Jane Smith', [{ authors: [{ name: 'J Smith' }] }])).toEqual({
      suggestedName: 'jane smith',
      hasFullForenameMatch: false,
      hasInitialOnlyMatch: true,
      matchedAuthorName: 'j smith',
      reason: 'Returned author only provided a first initial',
    });
  });
  it('reports no byline match when nothing lines up', () => {
    expect(DiscoveryService.evaluateNameEvidence('Jane Smith', [{ authors: [{ name: 'Bob Jones' }] }])).toEqual({
      suggestedName: 'jane smith',
      hasFullForenameMatch: false,
      hasInitialOnlyMatch: false,
      matchedAuthorName: null,
      reason: 'No returned author full forename matches the suggested full forename',
    });
  });
  it('empty article list yields the no-match reason', () => {
    expect(DiscoveryService.evaluateNameEvidence('Jane Smith', [])).toEqual({
      suggestedName: 'jane smith',
      hasFullForenameMatch: false,
      hasInitialOnlyMatch: false,
      matchedAuthorName: null,
      reason: 'No returned author full forename matches the suggested full forename',
    });
  });
});
