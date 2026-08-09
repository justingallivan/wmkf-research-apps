/**
 * Offline unit tests for the cycle-unresolved pair-consistency measurement
 * tool (benchmarks/institution-pair-consistency/measure-cycle-unresolved.js).
 * No network — exercises the pure extraction/funnel/pair-building logic
 * against fixture rows shaped like real Dataverse responses.
 */

const path = require('path');

const {
  parseArgs,
  identityStatusBucket,
  isInScopeBucket,
  parseAnchorsJson,
  affiliationMatchInstitutions,
  tallyAnchorTypes,
  buildFunnel,
  buildMeasurablePairs,
  odataString,
  chunk,
} = require(path.join('..', '..', '..', 'benchmarks', 'institution-pair-consistency', 'measure-cycle-unresolved.js'));

describe('measure-cycle-unresolved: identity status bucketing', () => {
  test('buckets unresolved/ambiguous/null distinctly, everything else as other', () => {
    expect(identityStatusBucket('unresolved')).toBe('unresolved');
    expect(identityStatusBucket('ambiguous')).toBe('ambiguous');
    expect(identityStatusBucket(null)).toBe('null');
    expect(identityStatusBucket(undefined)).toBe('null');
    expect(identityStatusBucket('')).toBe('null');
    expect(identityStatusBucket('confirmed')).toBe('other');
    expect(identityStatusBucket('probable')).toBe('other');
  });

  test('isInScopeBucket only admits unresolved/ambiguous/null', () => {
    expect(isInScopeBucket('unresolved')).toBe(true);
    expect(isInScopeBucket('ambiguous')).toBe(true);
    expect(isInScopeBucket('null')).toBe(true);
    expect(isInScopeBucket('other')).toBe(false);
  });
});

describe('measure-cycle-unresolved: anchors JSON parsing', () => {
  test('blank/missing value parses as blank, not an error', () => {
    expect(parseAnchorsJson(null)).toEqual({ anchors: [], parseOk: true, blank: true });
    expect(parseAnchorsJson(undefined)).toEqual({ anchors: [], parseOk: true, blank: true });
    expect(parseAnchorsJson('')).toEqual({ anchors: [], parseOk: true, blank: true });
    expect(parseAnchorsJson('   ')).toEqual({ anchors: [], parseOk: true, blank: true });
  });

  test('unparseable JSON is flagged, not thrown', () => {
    const result = parseAnchorsJson('{not json');
    expect(result.parseOk).toBe(false);
    expect(result.anchors).toEqual([]);
  });

  test('a non-array parsed value returns an empty anchors array', () => {
    expect(parseAnchorsJson('{"a":1}').anchors).toEqual([]);
  });

  test('valid compact anchors array (real persisted shape) parses through', () => {
    const raw = JSON.stringify([
      { type: 'affiliation_match', canonicalKey: 'affiliation_match:Harvard University', sourceUrl: null, verifier: 'x@1.0.0' },
      { type: 'orcid_present', canonicalKey: 'orcid_present:0000-0001-2345-6789', sourceUrl: null, verifier: 'x@1.0.0' },
    ]);
    const { anchors, parseOk, blank } = parseAnchorsJson(raw);
    expect(parseOk).toBe(true);
    expect(blank).toBe(false);
    expect(anchors).toHaveLength(2);
  });
});

describe('measure-cycle-unresolved: affiliationMatchInstitutions extraction', () => {
  test('extracts the institution string by stripping the type prefix, not splitting on colon', () => {
    const anchors = [
      { type: 'affiliation_match', canonicalKey: 'affiliation_match:Johns Hopkins: School of Medicine' },
    ];
    expect(affiliationMatchInstitutions(anchors)).toEqual(['Johns Hopkins: School of Medicine']);
  });

  test('ignores non-affiliation_match anchor types', () => {
    const anchors = [
      { type: 'authorship_grounded', canonicalKey: 'authorship_grounded:A123456789' },
      { type: 'topic_match', canonicalKey: 'topic_match:A123456789' },
    ];
    expect(affiliationMatchInstitutions(anchors)).toEqual([]);
  });

  test('skips a null canonicalKey (source anchor had no value)', () => {
    const anchors = [{ type: 'affiliation_match', canonicalKey: null }];
    expect(affiliationMatchInstitutions(anchors)).toEqual([]);
  });

  test('dedupes identical evidence strings within one person', () => {
    const anchors = [
      { type: 'affiliation_match', canonicalKey: 'affiliation_match:Duke University' },
      { type: 'affiliation_match', canonicalKey: 'affiliation_match:Duke University' },
    ];
    expect(affiliationMatchInstitutions(anchors)).toEqual(['Duke University']);
  });

  test('handles missing/malformed anchor entries without throwing', () => {
    expect(affiliationMatchInstitutions([null, undefined, {}, { type: 'affiliation_match' }])).toEqual([]);
  });
});

describe('measure-cycle-unresolved: tallyAnchorTypes', () => {
  test('counts blank vs unparseable vs typed anchors across persons', () => {
    const persons = [
      { wmkf_identityverifiedanchorsjson: null },
      { wmkf_identityverifiedanchorsjson: '{bad' },
      { wmkf_identityverifiedanchorsjson: JSON.stringify([{ type: 'affiliation_match' }, { type: 'orcid_present' }]) },
    ];
    const tally = tallyAnchorTypes(persons);
    expect(tally.personsInspected).toBe(3);
    expect(tally.blankCount).toBe(1);
    expect(tally.unparseableCount).toBe(1);
    expect(tally.totalAnchors).toBe(2);
    expect(tally.typeCounts).toEqual({ affiliation_match: 1, orcid_present: 1 });
  });
});

describe('measure-cycle-unresolved: buildFunnel', () => {
  const suggestions = [
    { wmkf_appreviewersuggestionid: 's1', _wmkf_potentialreviewer_value: 'p1', wmkf_revieweraffiliation: 'Reported U' },
    { wmkf_appreviewersuggestionid: 's2', _wmkf_potentialreviewer_value: 'p2', wmkf_revieweraffiliation: null },
    { wmkf_appreviewersuggestionid: 's3', _wmkf_potentialreviewer_value: 'p3', wmkf_revieweraffiliation: null },
    { wmkf_appreviewersuggestionid: 's4', _wmkf_potentialreviewer_value: 'p4', wmkf_revieweraffiliation: null },
  ];
  const persons = [
    {
      wmkf_potentialreviewersid: 'p1',
      wmkf_identitystatus: 'unresolved',
      wmkf_primaryaffiliation: null, // blank claimed, but suggestion has one -> found-not-measured
      wmkf_identityverifiedanchorsjson: null,
    },
    {
      wmkf_potentialreviewersid: 'p2',
      wmkf_identitystatus: 'ambiguous',
      wmkf_primaryaffiliation: 'Yale University',
      wmkf_identityverifiedanchorsjson: JSON.stringify([
        { type: 'affiliation_match', canonicalKey: 'affiliation_match:Yale School of Medicine' },
      ]),
    },
    {
      wmkf_potentialreviewersid: 'p3',
      wmkf_identitystatus: null,
      wmkf_primaryaffiliation: 'Cornell University',
      wmkf_identityverifiedanchorsjson: null, // measurable person minus evidence
    },
    {
      wmkf_potentialreviewersid: 'p4',
      wmkf_identitystatus: 'confirmed', // out of scope entirely
      wmkf_primaryaffiliation: 'Confirmed U',
      wmkf_identityverifiedanchorsjson: JSON.stringify([
        { type: 'affiliation_match', canonicalKey: 'affiliation_match:Confirmed U' },
      ]),
    },
  ];

  test('produces the full denominator chain', () => {
    const funnel = buildFunnel({
      suggestions, distinctPersonIds: ['p1', 'p2', 'p3', 'p4'], persons, limit: null,
    });
    expect(funnel.suggestionsInCycle).toBe(4);
    expect(funnel.distinctPersonsInCycle).toBe(4);
    expect(funnel.personsFetched).toBe(4);
    expect(funnel.byIdentityStatus).toEqual({
      unresolved: 1, ambiguous: 1, null: 1, other_excluded: 1,
    });
    expect(funnel.inScopeTotal).toBe(3); // p1, p2, p3 (p4 excluded)
    expect(funnel.withClaimedInstitution).toBe(2); // p2, p3 (p1 blank)
    expect(funnel.claimedBlankButSuggestionAffiliationPresent_foundNotMeasured).toBe(1); // p1
    expect(funnel.withEvidenceInstitution).toBe(1); // p2 only (p3 has no anchors)
    expect(funnel.measurablePersons).toBe(1);
  });

  test('--limit caps the in-scope list before claimed/evidence extraction', () => {
    const funnel = buildFunnel({
      suggestions, distinctPersonIds: ['p1', 'p2', 'p3', 'p4'], persons, limit: 1,
    });
    expect(funnel.limitApplied).toBe(1);
    expect(funnel.inScopeAfterLimit).toBe(1); // only p1 (first in-scope entry: unresolved bucket first)
    // p1 has a blank claimed institution, so nothing downstream is measurable under this cap.
    expect(funnel.withClaimedInstitution).toBe(0);
    expect(funnel.measurablePersons).toBe(0);
  });
});

describe('measure-cycle-unresolved: buildMeasurablePairs', () => {
  test('dedupes identical (claimed, evidence) pairs across persons and tracks contributing GUIDs', () => {
    const withEvidence = [
      {
        person: { wmkf_potentialreviewersid: 'p1', wmkf_primaryaffiliation: 'Yale University' },
        evidenceInstitutions: ['Yale School of Medicine'],
      },
      {
        person: { wmkf_potentialreviewersid: 'p2', wmkf_primaryaffiliation: 'Yale University' },
        evidenceInstitutions: ['Yale School of Medicine'],
      },
      {
        person: { wmkf_potentialreviewersid: 'p3', wmkf_primaryaffiliation: 'Duke University' },
        evidenceInstitutions: ['Duke Health', 'Duke University Medical Center'],
      },
    ];
    const pairs = buildMeasurablePairs(withEvidence);
    expect(pairs).toHaveLength(3); // Yale (deduped p1+p2) + Duke Health + Duke University Medical Center
    const yalePair = pairs.find((p) => p.claimedInstitution === 'Yale University');
    expect(yalePair.evidenceInstitution).toBe('Yale School of Medicine');
    expect(yalePair.personIds).toEqual(['p1', 'p2']);
    const dukePair = pairs.find((p) => p.evidenceInstitution === 'Duke Health');
    expect(dukePair.personIds).toEqual(['p3']);
  });

  test('does not collide two distinct (claimed, evidence) pairs whose space-joined strings coincide', () => {
    // "A B" + "C" and "A" + "B C" both space-join to "A B C" — the dedup key
    // must not use a plain space or any character that appears in real
    // institution strings.
    const withEvidence = [
      {
        person: { wmkf_potentialreviewersid: 'p1', wmkf_primaryaffiliation: 'A B' },
        evidenceInstitutions: ['C'],
      },
      {
        person: { wmkf_potentialreviewersid: 'p2', wmkf_primaryaffiliation: 'A' },
        evidenceInstitutions: ['B C'],
      },
    ];
    const pairs = buildMeasurablePairs(withEvidence);
    expect(pairs).toHaveLength(2);
    expect(pairs).toEqual(expect.arrayContaining([
      { claimedInstitution: 'A B', evidenceInstitution: 'C', personIds: ['p1'] },
      { claimedInstitution: 'A', evidenceInstitution: 'B C', personIds: ['p2'] },
    ]));
  });

  test('a person contributing multiple distinct evidence institutions produces multiple pairs', () => {
    const withEvidence = [
      {
        person: { wmkf_potentialreviewersid: 'p1', wmkf_primaryaffiliation: 'MIT' },
        evidenceInstitutions: ['MIT Media Lab', 'Broad Institute'],
      },
    ];
    const pairs = buildMeasurablePairs(withEvidence);
    expect(pairs).toHaveLength(2);
  });
});

describe('measure-cycle-unresolved: CLI arg parsing', () => {
  test('parses --cycle, --slug, --limit, --case, --timeout-ms', () => {
    const args = parseArgs(['--cycle', 'FY26-1', '--slug', 'smoke', '--limit', '5', '--timeout-ms', '20000']);
    expect(args).toMatchObject({
      cycle: 'FY26-1', slug: 'smoke', limit: 5, timeoutMs: 20000, caseId: null, help: false,
    });
  });

  test('--case mode ignores --cycle/--slug requirements', () => {
    const args = parseArgs(['--case', 'suggestion-guid-1']);
    expect(args.caseId).toBe('suggestion-guid-1');
  });

  test('--help sets help flag', () => {
    expect(parseArgs(['--help']).help).toBe(true);
  });

  test('a non-numeric --limit is ignored, leaving limit null', () => {
    expect(parseArgs(['--limit', 'not-a-number']).limit).toBeNull();
  });
});

describe('measure-cycle-unresolved: OData helpers', () => {
  test('odataString doubles embedded single quotes', () => {
    expect(odataString("O'Brien University")).toBe("O''Brien University");
  });

  test('chunk splits an array into fixed-size groups, last group may be smaller', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });
});
