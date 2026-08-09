/**
 * @jest-environment node
 *
 * Stage 1 of docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md:
 * segment-wise pair comparison, opt-in via
 * createInstitutionConsistencyChecker({ segmentComparison: true }).
 *
 * Resolvers used here are INJECTED STUBS constructed in this file, not
 * recorded provider responses. A stub that "returns null for decorated
 * strings" mirrors the S400 zero-result behavior for messy bylines, and a
 * stub that "resolves to distinct identities" stands in for two different
 * real institutions successfully resolving to different OpenAlex/ROR ids.
 */

const {
  createInstitutionConsistencyChecker,
} = require('../../lib/services/institution-affiliation-consistency');

// Stub resolver: always abstains (null), mirroring the S400 zero-result
// behavior for decorated/subset bylines that never resolve.
function nullResolver() {
  return { resolve: jest.fn(async () => null) };
}

// Stub resolver: resolves a fixed set of exact-name keys to distinct
// canonical identities; anything else abstains (null).
function identityResolver(recordsByName) {
  return {
    resolve: jest.fn(async (name) => recordsByName.get(name) || null),
  };
}

describe('segment-wise comparison (opt-in) — request-1002903 same-pairs', () => {
  // Exact strings from benchmarks/institution-pair-consistency/cases/request-1002903-pairs.jsonl
  const ROW1_LEFT = 'Department of Bioengineering, University of California San Diego, La Jolla, California 92093, United States.';
  const ROW1_RIGHT = 'University of California San Diego';

  const ROW2_LEFT = 'Dept. of Biomedical Engineering, Columbia University, New York, NY, USA; Dept. of Radiology, Columbia University, New York, NY, USA.';
  const ROW2_RIGHT = 'Columbia University';

  const ROW3_LEFT = 'Department of Mechanical and Aerospace Engineering, North Carolina State University, Raleigh, NC, 27695, USA.';
  const ROW3_RIGHT = 'North Carolina State University';

  const ROW4_LEFT = 'Department of Radiology, Vanderbilt University Institute of Imaging Science, Vanderbilt University Medical Center, Nashville, USA.';
  const ROW4_RIGHT = 'Vanderbilt University Medical Center';

  // Fail-closed-then-tolerant guard (post-live-gate hardening, Wave 3b policy
  // split): a direct segment match with unproven contiguous extensions no
  // longer auto-clears on string identity alone at step 1 — the pair needs
  // POSITIVE resolution evidence (the clean org segment resolving on its
  // own). Deliberately NOT stubbed here: the city/state/zip decoration
  // extensions (", La Jolla", ", Nashville", etc.). Live gate 2026-08-08
  // confirmed these definitively abstain on the real resolver — this
  // resolver mirrors that reality rather than optimistically resolving them,
  // and rows 1-4 still clear true via step 2's 'admit' policy, which
  // tolerates an abstaining extension once the fragment's OWN identity has
  // resolved cleanly.
  const cleanOrgResolver = () => {
    const identity = (id, name) => ({ openAlexId: id, displayName: name, associatedInstitutions: [] });
    return identityResolver(new Map([
      ['University of California San Diego', identity('I-UCSD', 'University of California San Diego')],
      ['Columbia University', identity('I-COLUMBIA', 'Columbia University')],
      ['North Carolina State University', identity('I-NCSU', 'North Carolina State University')],
      ['Vanderbilt University Medical Center', identity('I-VUMC', 'Vanderbilt University Medical Center')],
    ]));
  };

  test.each([
    ['row1 (UCSD decorated byline)', ROW1_LEFT, ROW1_RIGHT],
    ['row2 (Columbia semicolon double-department)', ROW2_LEFT, ROW2_RIGHT],
    ['row3 (NC State decorated byline)', ROW3_LEFT, ROW3_RIGHT],
    ['row4 (VUMC — listed institution is NOT the first org mentioned)', ROW4_LEFT, ROW4_RIGHT],
  ])('%s → consistent true when the clean org segment resolves (S400-real stub)', async (_label, left, right) => {
    const checker = createInstitutionConsistencyChecker({ resolver: cleanOrgResolver(), segmentComparison: true });

    await expect(checker.areConsistent(left, right)).resolves.toBe(true);
  });

  test('fail-closed: with a resolver that abstains on EVERYTHING, decorated rows surface instead of auto-clearing', async () => {
    // Total provider failure (or total ambiguity) must degrade to surfaced
    // review, never to a string-identity auto-clear — plan safety invariant 3.
    const resolver = nullResolver();
    const checker = createInstitutionConsistencyChecker({ resolver, segmentComparison: true });

    await expect(checker.areConsistent(ROW1_LEFT, ROW1_RIGHT)).resolves.toBe(false);
  });

  test('row4: proves segment matching hits the LISTED institution (VUMC), not a first-org extraction', async () => {
    // The left byline mentions "Vanderbilt University Institute of Imaging
    // Science" before "Vanderbilt University Medical Center". A first-match
    // extractor would pick the Institute of Imaging Science segment and fail
    // to match the right operand. Segment-wise comparison must instead test
    // EVERY segment against the other operand, so the VUMC segment (which
    // appears later) is what actually produces the match.
    const checker = createInstitutionConsistencyChecker({ resolver: cleanOrgResolver(), segmentComparison: true });

    await expect(checker.areConsistent(ROW4_LEFT, ROW4_RIGHT)).resolves.toBe(true);
    // A first-org extractor would have matched "Vanderbilt University
    // Institute of Imaging Science" against the right operand and failed;
    // confirm that string alone (without the later VUMC segment) does NOT
    // direct-match the right operand, so the true above is attributable to
    // the VUMC segment specifically.
    const {
      institutionsConsistent,
    } = require('../../lib/services/institution-affiliation-consistency');
    const { DeduplicationService } = require('../../lib/services/deduplication-service');
    expect(DeduplicationService.institutionDirectMatch(
      'Vanderbilt University Institute of Imaging Science',
      ROW4_RIGHT,
    )).toBe(false);
    // Sanity: the actually-matching segment is a direct match on its own.
    expect(DeduplicationService.institutionDirectMatch(
      'Vanderbilt University Medical Center',
      ROW4_RIGHT,
    )).toBe(true);
    void institutionsConsistent; // referenced for clarity of what areConsistent falls back to
  });
});

describe('segment-wise comparison (opt-in) — request 1002912 (Lunenfeld-Tanenbaum, Wave 6 fixture)', () => {
  // Exact strings from benchmarks/institution-pair-consistency/cases/request-1002903-pairs.jsonl,
  // caseId "1002912-lunenfeld". Unlike rows 1-4 above, the SHORT string here
  // is the PubMed byline evidence and the LONG string is the recorded/claimed
  // affiliation — the inverse decoration direction, so this pin exercises the
  // rightSegments-vs-left branch of directMatchWithParentGuard rather than
  // the leftSegments-vs-right branch rows 1-4 exercise.
  const EVIDENCE = 'Lunenfeld-Tanenbaum Research Institute';
  const AFFILIATION = 'Lunenfeld-Tanenbaum Research Institute, University of Toronto';

  // Live-faithful stub (both live-verified 2026-08-09): "Lunenfeld-Tanenbaum
  // Research Institute" and "University of Toronto" each resolve to their
  // OWN distinct real identity — they are genuinely different organizations,
  // not one collapsing into the other. The whole decorated compound string
  // ("...Institute, University of Toronto" as one string) abstains, mirroring
  // the S400 finding that decorated/compound strings return zero OpenAlex
  // results. Step 1 (direct segment match) does NOT clear this pair: the
  // EVIDENCE segment has a contiguous extension in its own operand (the
  // whole-join fragment), which abstains, demoting it to 'parent' under
  // step 1's strict policy. The clear instead comes from step 2: EVIDENCE is
  // the whole left operand (always pool-admitted) and matches its own
  // segment-pool entry on the right side by identity equality — the
  // "shared string IS one of the whole operands" carve-out documented above
  // buildPool's shared-fragment self-pair exclusion.
  const identities = new Map([
    [EVIDENCE, { openAlexId: 'I-LTRI', displayName: EVIDENCE, associatedInstitutions: [] }],
    ['University of Toronto', {
      openAlexId: 'I-UOFT', displayName: 'University of Toronto', associatedInstitutions: [],
    }],
  ]);
  const liveFaithfulResolver = () => identityResolver(identities);

  test('evidence (short) vs affiliation (long): consistent true', async () => {
    const checker = createInstitutionConsistencyChecker({
      resolver: liveFaithfulResolver(), segmentComparison: true,
    });

    await expect(checker.areConsistent(EVIDENCE, AFFILIATION)).resolves.toBe(true);
  });

  test('reverse argument order (affiliation, evidence): also consistent true', async () => {
    const checker = createInstitutionConsistencyChecker({
      resolver: liveFaithfulResolver(), segmentComparison: true,
    });

    await expect(checker.areConsistent(AFFILIATION, EVIDENCE)).resolves.toBe(true);
  });

  test('default path (segmentComparison omitted): stays false, matching the production mismatch banner this fixture pins as fixed', async () => {
    const checker = createInstitutionConsistencyChecker({ resolver: liveFaithfulResolver() });

    await expect(checker.areConsistent(EVIDENCE, AFFILIATION)).resolves.toBe(false);
  });
});

describe('segment-wise comparison (opt-in) — genuine mismatches stay flagged', () => {
  test('Northwestern Feinberg vs Texas A&M → false (distinct identities)', async () => {
    const LEFT = 'Division of Nephrology and Hypertension, Northwestern University Feinberg School of Medicine, Chicago, IL';
    const RIGHT = 'Texas A&M';

    const NW_IDENTITY = {
      openAlexId: 'https://openalex.org/I999000001',
      displayName: 'Northwestern University Feinberg School of Medicine',
      associatedInstitutions: [],
    };
    const TAMU_IDENTITY = {
      openAlexId: 'https://openalex.org/I999000002',
      displayName: 'Texas A&M University',
      associatedInstitutions: [],
    };
    const resolver = identityResolver(new Map([
      ['Northwestern University Feinberg School of Medicine', NW_IDENTITY],
      ['Texas A&M', TAMU_IDENTITY],
      // ", Chicago" / ", Chicago, IL" extensions deliberately NOT stubbed
      // (abstain): under step 2's 'admit' policy the NW fragment is still
      // admitted to the pool (its own identity resolved), so the false
      // verdict below is still genuinely produced by
      // institutionsConsistent(NW_IDENTITY, TAMU_IDENTITY), not an empty pool.
    ]));
    const checker = createInstitutionConsistencyChecker({ resolver, segmentComparison: true });

    await expect(checker.areConsistent(LEFT, RIGHT)).resolves.toBe(false);
    // Ground the "distinct identities" claim: both stub keys must actually
    // have been queried by the resolve-candidate pools (segment side +
    // always-included whole-string side), so the false verdict above is
    // genuinely produced by institutionsConsistent(NW_IDENTITY, TAMU_IDENTITY)
    // and not by an empty resolve pool degrading to false for free.
    expect(resolver.resolve).toHaveBeenCalledWith('Northwestern University Feinberg School of Medicine', expect.anything());
    expect(resolver.resolve).toHaveBeenCalledWith('Texas A&M', expect.anything());
  });

  test('Northwestern Feinberg vs Texas A&M → false (both unresolved, stub abstains)', async () => {
    const LEFT = 'Division of Nephrology and Hypertension, Northwestern University Feinberg School of Medicine, Chicago, IL';
    const RIGHT = 'Texas A&M';

    const resolver = nullResolver();
    const checker = createInstitutionConsistencyChecker({ resolver, segmentComparison: true });

    await expect(checker.areConsistent(LEFT, RIGHT)).resolves.toBe(false);
  });
});

describe('segment-wise comparison (opt-in) — sibling-campus safety', () => {
  const UCSD_DECORATED = 'Department of Chemistry, University of California, San Diego, La Jolla, CA';
  const UCLA_PLAIN = 'University of California, Los Angeles';

  test('UCSD (decorated) vs UCLA → false, no resolver (string comparison alone)', async () => {
    // Direct segment match must not fire: no segment of the UCSD byline is a
    // string-identity match for "University of California, Los Angeles".
    const resolver = nullResolver();
    const checker = createInstitutionConsistencyChecker({ resolver, segmentComparison: true });

    await expect(checker.areConsistent(UCSD_DECORATED, UCLA_PLAIN)).resolves.toBe(false);
  });

  test('UCSD (decorated) vs UCLA → false, even when a stub resolves each campus to a DISTINCT identity', async () => {
    // Sibling campuses must never auto-clear even when both sides resolve
    // successfully to different, unrelated identities (hard safety
    // invariant from the plan doc). Stub keys are the WHOLE trimmed strings
    // on each side (always included in the resolve-candidate pool alongside
    // segments), mirroring a real resolver successfully identifying each
    // full decorated/plain string as its own distinct campus. Deliberately
    // NOT stubbed: the shared ambiguous segment "University of California"
    // (present on both sides) — if a resolver resolved that shared segment
    // to any single identity, the same resolved object would land in both
    // pools and trivially "match itself", which would be exactly the
    // shared-parent auto-clear this invariant forbids. Leaving it
    // unresolved (falls through to null) proves the checker doesn't rely on
    // that shortcut.
    const UCSD_IDENTITY = {
      openAlexId: 'https://openalex.org/I36258959',
      displayName: 'University of California, San Diego',
      associatedInstitutions: [],
    };
    const UCLA_IDENTITY = {
      openAlexId: 'https://openalex.org/I95457486',
      displayName: 'University of California, Los Angeles',
      associatedInstitutions: [],
    };
    const resolver = identityResolver(new Map([
      [UCSD_DECORATED, UCSD_IDENTITY],
      [UCLA_PLAIN, UCLA_IDENTITY],
    ]));
    const checker = createInstitutionConsistencyChecker({ resolver, segmentComparison: true });

    await expect(checker.areConsistent(UCSD_DECORATED, UCLA_PLAIN)).resolves.toBe(false);
    // Ground the claim: both whole-string stub keys were actually queried
    // (proof the false verdict comes from institutionsConsistent over two
    // resolved, distinct identities — not from an empty/unresolved pool).
    expect(resolver.resolve).toHaveBeenCalledWith(UCSD_DECORATED, expect.anything());
    expect(resolver.resolve).toHaveBeenCalledWith(UCLA_PLAIN, expect.anything());
  });
});

describe('segment-wise comparison (opt-in) — resolved-pair (step 2) fallback', () => {
  test('Wave 3c re-pin (superseded by Wave 3e, still FALSE): an admitted fragment does not earn associated-link credit', async () => {
    // Pre-Wave-3c this test asserted TRUE: "Broad Institute" (a fragment with
    // an abstaining ", Cambridge"/", Cambridge, MA" extension) crossed the
    // resolved MIT whole via Broad Institute's associatedInstitutions link.
    // Wave 3c narrowed this via a per-entry `admittedUnproven` tag; Wave 3e
    // (owner-directed, 2026-08-08) went further and REMOVED associated-link
    // evidence from the staged path (`segmentComparison: true`) entirely —
    // every step-2 crossing and the post-segment fallback now use
    // `institutionDirectMatch` (identity equality) ONLY, unconditionally, for
    // every pairing shape. Broad Institute's identity does not directly match
    // MIT's, so this pairing stays FALSE under Wave 3e too, but for the
    // simpler reason that NO staged pairing may draw on an associated link —
    // not even a whole-vs-whole one. See the Harvard Medical School vs
    // Harvard University test below, which — post-Wave-3e — now ALSO surfaces
    // (FALSE) at the staged path per the plan's Stage 2 relationship-policy
    // table (Harvard <-> HMS: surface), even though it still clears via
    // associated link on the DEFAULT/unstaged path.
    const LEFT = 'Dept of Genomics, Broad Institute, Cambridge, MA';
    const RIGHT = 'Massachusetts Institute of Technology';

    const MIT_IDENTITY = {
      openAlexId: 'https://openalex.org/I63966007',
      displayName: 'Massachusetts Institute of Technology',
      associatedInstitutions: [],
    };
    const BROAD_IDENTITY = {
      openAlexId: 'https://openalex.org/I107606265',
      displayName: 'Broad Institute',
      associatedInstitutions: [{
        openAlexId: MIT_IDENTITY.openAlexId,
        displayName: MIT_IDENTITY.displayName,
        relationship: 'related',
      }],
    };
    const resolver = identityResolver(new Map([
      ['Broad Institute', BROAD_IDENTITY],
      [RIGHT, MIT_IDENTITY],
      // ", Cambridge" / ", Cambridge, MA" extensions deliberately NOT stubbed
      // (abstain): step 2's 'admit' policy still admits "Broad Institute" to
      // the pool (its own identity resolved cleanly), but under Wave 3e pool
      // membership no longer matters for evidence type — no staged crossing
      // may use the associated link below regardless of admission reason.
    ]));
    const checker = createInstitutionConsistencyChecker({ resolver, segmentComparison: true });

    await expect(checker.areConsistent(LEFT, RIGHT)).resolves.toBe(false);
    expect(resolver.resolve).toHaveBeenCalledWith('Broad Institute', expect.anything());
    expect(resolver.resolve).toHaveBeenCalledWith(RIGHT, expect.anything());
  });
});

describe('default-off regression — factory default path is unchanged', () => {
  test('segmentComparison omitted: decorated byline vs clean listed institution still returns false (today\'s behavior)', async () => {
    const LEFT = 'Department of Bioengineering, University of California San Diego, La Jolla, California 92093, United States.';
    const RIGHT = 'University of California San Diego';

    const resolver = nullResolver();
    // No segmentComparison option passed at all — must behave exactly as
    // the pre-Stage-1 checker did: whole-string resolve only, no segmenting.
    const checker = createInstitutionConsistencyChecker({ resolver });

    await expect(checker.areConsistent(LEFT, RIGHT)).resolves.toBe(false);
    // Only the whole-string resolve should have been attempted (2 calls:
    // once per operand) — proof that no segment-level resolve calls happened.
    expect(resolver.resolve).toHaveBeenCalledTimes(2);
  });

  test('segmentComparison: false explicitly: same as omitted', async () => {
    const LEFT = 'Department of Bioengineering, University of California San Diego, La Jolla, California 92093, United States.';
    const RIGHT = 'University of California San Diego';

    const resolver = nullResolver();
    const checker = createInstitutionConsistencyChecker({ resolver, segmentComparison: false });

    await expect(checker.areConsistent(LEFT, RIGHT)).resolves.toBe(false);
    expect(resolver.resolve).toHaveBeenCalledTimes(2);
  });
});

describe('shared-fragment self-pair hardening (safety invariant 1)', () => {
  test('sibling pair stays false even when the shared bare parent fragment RESOLVES to one system identity', async () => {
    // Falsifies the Wave-1B-flagged hazard: both campus names comma-split to
    // contain the bare fragment "University of California". A resolver that
    // resolves that fragment to a single UC-system identity must NOT let the
    // fragment match itself across the pools and auto-clear the sibling pair.
    const ucSystem = {
      openAlexId: 'I-UC-SYSTEM',
      displayName: 'University of California System',
      associatedInstitutions: [],
    };
    const ucsd = {
      openAlexId: 'I-UCSD',
      displayName: 'University of California, San Diego',
      associatedInstitutions: [],
    };
    const ucla = {
      openAlexId: 'I-UCLA',
      displayName: 'University of California, Los Angeles',
      associatedInstitutions: [],
    };
    const resolver = identityResolver(new Map([
      ['University of California', ucSystem],
      ['University of California, San Diego', ucsd],
      ['University of California, Los Angeles', ucla],
    ]));
    const checker = createInstitutionConsistencyChecker({ resolver, segmentComparison: true });

    await expect(checker.areConsistent(
      'Department of Chemistry, University of California, San Diego, La Jolla, CA',
      'University of California, Los Angeles',
    )).resolves.toBe(false);
    // The shared fragment genuinely resolved on both sides — the exclusion, not
    // resolver abstention, is what kept the verdict false.
    expect(resolver.resolve).toHaveBeenCalledWith('University of California', expect.anything());
  });

  test('identical candidate strings still count when the string IS one of the whole operands', async () => {
    // Byline vs clean listed institution: the matching candidate string equals
    // the right operand itself, so it genuinely represents that operand and the
    // pair must still be allowed to match via resolution.
    const harvard = {
      openAlexId: 'I-HARVARD',
      displayName: 'Harvard University',
      associatedInstitutions: [],
    };
    const resolver = identityResolver(new Map([
      ['Harvard University', harvard],
      // ", Cambridge" / ", Cambridge, MA" extensions deliberately NOT
      // stubbed (abstain): step 2's 'admit' policy still admits the
      // "Harvard University" fragment since its own identity resolved.
    ]));
    const checker = createInstitutionConsistencyChecker({ resolver, segmentComparison: true });

    await expect(checker.areConsistent(
      'Laboratory of Molecular Biology, Harvard University, Cambridge, MA',
      'Harvard University',
    )).resolves.toBe(true);
  });
});

describe('parent-fragment guard on direct segment matches (owner decision 2)', () => {
  test('campus vs bare parent surfaces (false) when the contiguous extension resolves to a different identity', async () => {
    // Live-gate falsification 2026-08-08: "University of California, Los
    // Angeles" vs "University of California" auto-cleared via a step-1 direct
    // fragment match. The matched fragment's contiguous extension (the full
    // campus name) resolves to UCLA — a different identity than the fragment —
    // so the fragment is a parent of something more specific and must not
    // auto-clear.
    const ucla = {
      openAlexId: 'I-UCLA',
      displayName: 'University of California, Los Angeles',
      associatedInstitutions: [],
    };
    const resolver = identityResolver(new Map([
      ['University of California, Los Angeles', ucla],
      // bare "University of California" abstains (ambiguous), per S400 evidence
    ]));
    const checker = createInstitutionConsistencyChecker({ resolver, segmentComparison: true });

    await expect(checker.areConsistent(
      'University of California, Los Angeles',
      'University of California',
    )).resolves.toBe(false);
    expect(resolver.resolve).toHaveBeenCalledWith('University of California, Los Angeles', expect.anything());
  });

  test('decoration extensions (city/country) do not block a genuine byline match', async () => {
    // VUMC has the identical string structure — matched segment plus a
    // contiguous ", Nashville" extension. Under the fail-closed guard the
    // unresolvable extension demotes the step-1 string match, and the pair
    // clears through step 2 instead: the clean VUMC segment resolves to the
    // same identity as the listed institution.
    const vumc = {
      openAlexId: 'I-VUMC',
      displayName: 'Vanderbilt University Medical Center',
      associatedInstitutions: [],
    };
    const resolver = identityResolver(new Map([
      ['Vanderbilt University Medical Center', vumc],
      // ", Nashville" / ", Nashville, USA." extensions deliberately NOT
      // stubbed (abstain, matching S400 reality). Step 2's 'admit' policy
      // still admits the VUMC fragment since its own identity resolved.
    ]));
    const checker = createInstitutionConsistencyChecker({ resolver, segmentComparison: true });

    await expect(checker.areConsistent(
      'Department of Radiology, Vanderbilt University Institute of Imaging Science, Vanderbilt University Medical Center, Nashville, USA.',
      'Vanderbilt University Medical Center',
    )).resolves.toBe(true);
  });

  test('extension resolving to the SAME identity as the segment still clears', async () => {
    const ncsu = {
      openAlexId: 'I-NCSU',
      displayName: 'North Carolina State University',
      associatedInstitutions: [],
    };
    const resolver = identityResolver(new Map([
      ['North Carolina State University', ncsu],
      ['North Carolina State University, Raleigh', ncsu],
      // "Raleigh, NC" / "Raleigh, NC, USA" deliberately NOT stubbed
      // (abstain): under the 'admit' policy, one proven-decoration extension
      // plus two abstaining ones still keeps the fragment in the pool.
    ]));
    const checker = createInstitutionConsistencyChecker({ resolver, segmentComparison: true });

    await expect(checker.areConsistent(
      'Department of Chemistry, North Carolina State University, Raleigh, NC, USA',
      'North Carolina State University',
    )).resolves.toBe(true);
  });

  test('Wave 3b: a fragment with an ABSTAINING (unresolvable) extension is ADMITTED to the step-2 pool and clears', async () => {
    // Flipped 2026-08-08 (live gate 141/145): the fragment itself resolves,
    // and its only contiguous extension abstains. Under step 2's 'admit'
    // policy (buildPool's unprovenExtensionPolicy), an abstaining extension
    // no longer demotes a fragment whose own identity resolved cleanly — it
    // is treated as unproven-but-tolerated decoration, and the fragment
    // stays in the pool to be tested via institutionsConsistent against the
    // other operand's independently-resolved identity.
    const org = {
      openAlexId: 'I-ORG',
      displayName: 'Example Research Institute',
      associatedInstitutions: [],
    };
    const resolver = identityResolver(new Map([
      ['Example Research Institute', org],
      // Deliberately NOT stubbed: 'Example Research Institute, Someplace' —
      // the extension abstains; under 'admit' this no longer excludes the
      // fragment (contrast with step 1's 'demote' policy, which still
      // requires this to be proven — see the "campus vs bare parent" test
      // above, where an abstaining extension keeps a STRING-ONLY match from
      // auto-clearing).
    ]));
    const checker = createInstitutionConsistencyChecker({ resolver, segmentComparison: true });

    await expect(checker.areConsistent(
      'Dept of X, Example Research Institute, Someplace',
      'Example Research Institute',
    )).resolves.toBe(true);
    expect(resolver.resolve).toHaveBeenCalledWith('Example Research Institute', expect.anything());
    expect(resolver.resolve).toHaveBeenCalledWith('Example Research Institute, Someplace', expect.anything());
  });

  test('accepted residual (documented, NOT fixed): campus vs bare parent can still clear when the bare parent RESOLVES and its campus extension definitively abstains', async () => {
    // This is a DELIBERATE, DOCUMENTED gap, not a bug to patch here. It
    // requires TWO independently-unlikely live conditions to co-occur:
    //   1. The bare parent string ("University of California") resolves at
    //      all — per S400 evidence this typically ABSTAINS live (it is
    //      exactly the ambiguous-string case the resolver tends to reject).
    //   2. The specific campus-extension string ("University of California,
    //      Los Angeles") is ALSO missing from the resolver, despite being a
    //      clean canonical institution name that would normally resolve fine
    //      on its own (see vector 1 / probe A, where it DOES resolve and the
    //      pair correctly stays false).
    // When both hold, step 1's 'demote' policy still correctly refuses the
    // string-only match (see "campus vs bare parent surfaces" above), but
    // step 2 admits the bare-parent fragment (its own identity resolved) and
    // the resulting crossing compares SYSTEM against SYSTEM (both sides
    // resolved the identical bare string) via
    // `DeduplicationService.institutionDirectMatch` — a genuine DIRECT
    // identity-EQUALITY match, not associated-link evidence. As of Wave 3e
    // (owner-directed, 2026-08-08), this is not a special restriction on this
    // one fragment shape — EVERY staged crossing is identity-equality-only,
    // unconditionally, so this residual is simply what's left once
    // associated-link evidence is removed from the staged path entirely: the
    // bare string resolving to the SAME identity object on both sides is not
    // new information the resolver invented — it's the literal identity
    // equality of "University of California" with itself. The sibling-campus
    // consequence of this same bare-parent fragment — crossing a genuinely
    // DIFFERENT sibling campus via that campus's associatedInstitutions link
    // back to SYSTEM — stays CLOSED, now for the simplest possible reason:
    // there is no associated-link evidence left to spend on the staged path
    // at all (see the sibling probe below, and the Wave 3e describe block for
    // the Harvard/HMS case that made the removal necessary).
    //
    // The obvious "fix" — rejecting a pairing whenever the matched candidate
    // strings are textually identical — was evaluated and REJECTED: it also
    // rejects the row-4 VUMC clear (request-1002903), where the listed
    // institution string is textually identical on both sides for the exact
    // same reason (a fragment resolving to the same identity as the whole
    // operand it names). There is no purely structural rule that
    // distinguishes "same string, same real institution" (VUMC, desired
    // true) from "same string, ambiguous bare parent" (this residual,
    // undesired true) without re-introducing the S400 false-positive risk
    // this rule exists to prevent.
    //
    // Tripwire: the 7 campus-vs-parent rows in the live gate
    // (benchmarks/institution-pair-consistency/) are the canary for this
    // residual actually firing in production — if the bare-parent resolve
    // rate rises (resolver improvement) while campus-extension coverage gaps
    // remain, watch those rows specifically.
    const system = {
      openAlexId: 'I-system',
      displayName: 'University of California',
      associatedInstitutions: [],
    };
    const resolver = identityResolver(new Map([
      ['University of California', system],
      // Deliberately NOT stubbed: 'University of California, Los Angeles' —
      // the campus extension abstains.
    ]));
    const checker = createInstitutionConsistencyChecker({ resolver, segmentComparison: true });

    await expect(checker.areConsistent(
      'University of California, Los Angeles',
      'University of California',
    )).resolves.toBe(true);
  });

  test('Wave 3c: sibling campuses never clear via an admitted-unproven bare-parent fragment\'s associated link', async () => {
    // Codex re-review HIGH, reproduced against production code (2026-08-08):
    // bare "University of California" RESOLVES to SYSTEM; the LEFT operand's
    // campus extension ("University of California, Los Angeles") is
    // definitively MISSING from the resolver (abstains); UCSD resolves with
    // SYSTEM in its associatedInstitutions. Pre-Wave-3c, step 2 admitted the
    // bare "University of California" fragment (its own identity resolved,
    // extension merely abstained) with identity SYSTEM, and crossed it
    // against the RIGHT whole operand (UCSD) via
    // institutionsConsistent(SYSTEM, UCSD) — true, because UCSD's
    // associatedInstitutions contains SYSTEM. That is a genuine
    // sibling-campus invariant violation: SYSTEM was never proven to
    // represent ONLY the left operand (UCLA) exclusively — the left
    // operand's own campus-specific extension was never confirmed — so
    // spending SYSTEM's one-hop associated link on UCSD's behalf is exactly
    // the auto-clear safety invariant 1 forbids.
    //
    // Wave 3c closed this with a per-entry `admittedUnproven` restriction;
    // Wave 3e (owner-directed, 2026-08-08) superseded that with the simpler,
    // strictly stronger rule that no staged crossing may use associated-link
    // evidence at all: the left pool's only surviving entry ("University of
    // California" -> SYSTEM) crosses UCSD via
    // `institutionDirectMatch(SYSTEM, UCSD)` only — which fails (different
    // identities) — never `associatedIdentityMatches`, regardless of any
    // admitted/proven distinction. Contrast with the accepted-residual test
    // above, where BOTH sides resolve to the literal SAME identity object
    // (SYSTEM vs SYSTEM) and a direct match legitimately succeeds; here the
    // right side is a genuinely different campus (UCSD),
    // so no direct match exists and the pair correctly stays false.
    const system = {
      openAlexId: 'I-system',
      displayName: 'University of California',
      associatedInstitutions: [],
    };
    const ucsd = {
      openAlexId: 'I-ucsd',
      displayName: 'University of California, San Diego',
      associatedInstitutions: [{ openAlexId: 'I-system', displayName: 'University of California' }],
    };
    const resolver = identityResolver(new Map([
      ['University of California', system],
      ['University of California, San Diego', ucsd],
      // Deliberately NOT stubbed: 'University of California, Los Angeles' —
      // the LEFT operand's campus extension abstains.
    ]));
    const checker = createInstitutionConsistencyChecker({ resolver, segmentComparison: true });

    await expect(checker.areConsistent(
      'University of California, Los Angeles',
      'University of California, San Diego',
    )).resolves.toBe(false);
  });

  test('Wave 3d scenario, now closed structurally by Wave 3e: extension-cap overflow cannot spend associated-link evidence', async () => {
    // Originally a Codex HIGH (2026-08-08): `fragmentExtensions` caps its
    // resolver-call check to the 3 SHORTEST contiguous extensions. When a
    // fragment has 4+ extensions and the contradictory one is the LONGEST
    // (excluded from the capped check), Wave 3d's fix was to force such a
    // fragment `admittedUnproven: true` so it could only cross via identity
    // equality, not the associated link. Wave 3e (owner-directed) makes that
    // per-fragment fix moot for THIS failure mode: no staged crossing may use
    // an associated link AT ALL anymore, regardless of overflow, so this
    // scenario is now closed by the same unconditional rule that closes every
    // other associated-link leak on the staged path. The `overflow` tracking
    // in `fragmentExtensions`/`classifyFragment` is still live code — it
    // still governs step 1's STRING-ONLY match (which still needs "prove
    // every extension" semantics, since string identity alone is otherwise
    // enough to auto-clear) — but it no longer needs to do double duty
    // gating step-2 evidence type. This test is kept to pin the outcome.
    //
    // Setup unchanged: LEFT comma-splits into "University of California" plus
    // three short filler segments ("A", "Ab", "Abc") before "Los Angeles", so
    // the bare-parent fragment's contiguous extensions are: ", A" (checked),
    // ", A, Ab" (checked), ", A, Ab, Abc" (checked), and the FULL operand
    // string itself (unchecked, 4th/longest match, excluded by the cap). The
    // stub resolves the 3 checked short extensions to SYSTEM (same identity
    // as the fragment) and the unchecked extension to UCLA (different
    // identity). RIGHT is UCSD, a sibling campus whose associatedInstitutions
    // links back to SYSTEM.
    const system = {
      openAlexId: 'I-system',
      displayName: 'University of California',
      associatedInstitutions: [],
    };
    const ucla = {
      openAlexId: 'I-ucla',
      displayName: 'University of California, A, Ab, Abc, Los Angeles',
      associatedInstitutions: [],
    };
    const ucsd = {
      openAlexId: 'I-ucsd',
      displayName: 'University of California, San Diego',
      associatedInstitutions: [{ openAlexId: 'I-system', displayName: 'University of California' }],
    };
    const resolver = identityResolver(new Map([
      ['University of California', system],
      ['University of California, A', system],
      ['University of California, A, Ab', system],
      ['University of California, A, Ab, Abc', system],
      ['University of California, A, Ab, Abc, Los Angeles', ucla],
      ['University of California, San Diego', ucsd],
    ]));
    const checker = createInstitutionConsistencyChecker({ resolver, segmentComparison: true });

    await expect(checker.areConsistent(
      'University of California, A, Ab, Abc, Los Angeles',
      'University of California, San Diego',
    )).resolves.toBe(false);
  });
});

describe('Wave 3 CHANGE 1 + CHANGE 2 — adversarial-review probes A/B/C (live-gate 2026-08-08)', () => {
  // Shared identities across probes A-D, matching the review's exact shapes:
  // SYSTEM = bare "University of California"; UCLA/UCSD are campuses whose
  // associatedInstitutions link back to SYSTEM (a real OpenAlex one-hop
  // relationship), never the reverse.
  const buildIdentities = () => {
    const system = {
      openAlexId: 'I-system',
      displayName: 'University of California',
      associatedInstitutions: [],
    };
    const ucla = {
      openAlexId: 'I-ucla',
      displayName: 'University of California, Los Angeles',
      associatedInstitutions: [{ openAlexId: 'I-system', displayName: 'University of California' }],
    };
    const ucsd = {
      openAlexId: 'I-ucsd',
      displayName: 'University of California, San Diego',
      associatedInstitutions: [{ openAlexId: 'I-system', displayName: 'University of California' }],
    };
    return { system, ucla, ucsd };
  };

  test('vector 1 / probe A: campus vs bare parent (parent RESOLVES to SYSTEM) never auto-clears', async () => {
    const { system, ucla } = buildIdentities();
    const resolver = identityResolver(new Map([
      ['University of California, Los Angeles', ucla],
      ['University of California', system],
    ]));
    const checker = createInstitutionConsistencyChecker({ resolver, segmentComparison: true });

    await expect(checker.areConsistent(
      'University of California, Los Angeles',
      'University of California',
    )).resolves.toBe(false);
  });

  test('vector 2 / probe B: sibling campuses never auto-clear even when the shared parent resolves', async () => {
    const { system, ucla, ucsd } = buildIdentities();
    const resolver = identityResolver(new Map([
      ['University of California', system],
      ['University of California, San Diego', ucsd],
      ['University of California, Los Angeles', ucla],
    ]));
    const checker = createInstitutionConsistencyChecker({ resolver, segmentComparison: true });

    await expect(checker.areConsistent(
      'Dept of Chemistry, University of California, San Diego, La Jolla, California',
      'University of California, Los Angeles',
    )).resolves.toBe(false);
  });

  test('vector 3 / probe C: segmentComparison true — bare parent ABSTAINS, fallback must not clear via associated-link NAME match', async () => {
    // The bare "University of California" resolver call abstains (null) —
    // mirroring real-world ambiguity — while UCLA's associatedInstitutions
    // contains an unresolved-looking entry named exactly "University of
    // California". Pre-Wave-3, the areConsistent default fallback substituted
    // the raw right-hand string on resolve failure and matched it against
    // UCLA's associated institution BY NAME alone. As of Wave 3e, the staged
    // fallback is unconditionally `institutionDirectMatch` only (no
    // associated-link evidence at all), which blocks this by construction —
    // stronger than the original shape-conditional CHANGE 2 guard this test
    // was written against.
    const ucla = {
      openAlexId: 'I-ucla',
      displayName: 'University of California, Los Angeles',
      associatedInstitutions: [{ displayName: 'University of California' }],
    };
    const resolver = identityResolver(new Map([
      ['University of California, Los Angeles', ucla],
      // bare "University of California" deliberately NOT stubbed (abstains)
    ]));
    const checker = createInstitutionConsistencyChecker({ resolver, segmentComparison: true });

    await expect(checker.areConsistent(
      'University of California, Los Angeles',
      'University of California',
    )).resolves.toBe(false);
  });

  test('vector 4 / probe C with segmentComparison OMITTED (false): pins today\'s unchanged default-path behavior', async () => {
    // Wave 3 CHANGE 2 is gated on segmentComparison === true (owner decision
    // 3: enrichment and identity-evidence consumers on the default path must
    // see byte-identical behavior). This pins that the pre-existing
    // associated-link-by-name fallback still fires when segmentComparison is
    // off — routed to Stage 2, not fixed here.
    const ucla = {
      openAlexId: 'I-ucla',
      displayName: 'University of California, Los Angeles',
      associatedInstitutions: [{ displayName: 'University of California' }],
    };
    const resolver = identityResolver(new Map([
      ['University of California, Los Angeles', ucla],
    ]));
    const checker = createInstitutionConsistencyChecker({ resolver });

    await expect(checker.areConsistent(
      'University of California, Los Angeles',
      'University of California',
    )).resolves.toBe(true);
  });
});

describe('Wave 3e — associated-link evidence is consulted NOWHERE on the staged path', () => {
  test('vector 6, FLIPPED (Wave 3e, owner-directed 2026-08-08): Harvard Medical School vs Harvard University now SURFACES at the staged path', async () => {
    // Pre-Wave-3e this test asserted TRUE: neither operand contains the other
    // as a contiguous comma-fragment, so the old CHANGE 1/2 parent-shape
    // restriction never engaged and this whole-vs-whole pairing cleared via
    // Harvard Medical School's associatedInstitutions link back to Harvard
    // University. That is exactly the auto-clear the plan's Stage 2
    // relationship-policy table forbids without a typed relationship:
    // Harvard <-> Harvard Medical School is a SURFACE pair, not an
    // auto-clear (same table entry that also requires Dana-Farber <-> Harvard
    // to surface). Root cause (live-verified 2026-08-08): resolvable
    // "container" identities like this one — and "University of California
    // System", OpenAlex I2803209242, 15 associated institutions — make
    // associated-link evidence far too permissive to spend as WHOLE-OPERAND
    // corroboration on the staged path. Wave 3e removes the mechanism
    // entirely for `segmentComparison: true`: this pair now correctly
    // SURFACES (false) for human review. The associated link is not lost
    // information — it remains valid identity-corroboration evidence on the
    // DEFAULT/unstaged path (owner decision 3; see the default-path pin
    // below) and is exactly the kind of typed-relationship signal Stage 2 is
    // scoped to formalize for the staged path.
    const harvard = {
      openAlexId: 'I-harvard',
      displayName: 'Harvard University',
      associatedInstitutions: [],
    };
    const hms = {
      openAlexId: 'I-hms',
      displayName: 'Harvard Medical School',
      associatedInstitutions: [{ openAlexId: 'I-harvard', displayName: 'Harvard University' }],
    };
    const resolver = identityResolver(new Map([
      ['Harvard Medical School', hms],
      ['Harvard University', harvard],
    ]));
    const stagedChecker = createInstitutionConsistencyChecker({ resolver, segmentComparison: true });

    await expect(stagedChecker.areConsistent('Harvard Medical School', 'Harvard University')).resolves.toBe(false);

    // Default/unstaged path pin: the SAME associated link remains valid
    // identity-corroboration evidence for enrichment/identity-evidence
    // consumers (owner decision 3) — this must stay byte-identical to
    // pre-Wave-3 behavior.
    const defaultChecker = createInstitutionConsistencyChecker({ resolver });
    await expect(defaultChecker.areConsistent('Harvard Medical School', 'Harvard University')).resolves.toBe(true);
  });

  test('vector 7: short whole operand ("MIT") still participates and matches a decorated MIT byline', async () => {
    const mit = {
      openAlexId: 'I-mit',
      displayName: 'Massachusetts Institute of Technology',
      associatedInstitutions: [],
    };
    const resolver = identityResolver(new Map([
      ['MIT', mit],
      ['Massachusetts Institute of Technology', mit],
      // ", Cambridge" / ", Cambridge, MA" extensions deliberately NOT
      // stubbed (abstain): step 2's 'admit' policy still admits the MIT
      // fragment since its own identity resolved, and the crossing succeeds
      // via a direct identity match against the "MIT" whole-operand candidate.
    ]));
    const checker = createInstitutionConsistencyChecker({ resolver, segmentComparison: true });

    await expect(checker.areConsistent(
      'MIT',
      'Department of Physics, Massachusetts Institute of Technology, Cambridge, MA',
    )).resolves.toBe(true);
  });
});

describe('Wave 3e — owner-directed live probes (2026-08-08): "University of California System" resolves live', () => {
  // Live-verified root cause: "University of California System" resolves on
  // the real resolver (OpenAlex I2803209242, 15 associated institutions), so
  // any WHOLE-OPERAND pairing with a sibling campus that carries SYSTEM in
  // its associatedInstitutions cleared via associated-link evidence — on both
  // the staged path (step 2 whole-vs-whole crossing or the fallback) AND the
  // pre-existing default path. These three tests are stub encodings of that
  // live finding: SYSTEM {I-system, "University of California System"},
  // UCSD carrying SYSTEM in its associatedInstitutions.
  const system = {
    openAlexId: 'I-system',
    displayName: 'University of California System',
    associatedInstitutions: [],
  };
  const ucsd = {
    openAlexId: 'I-ucsd',
    displayName: 'University of California San Diego',
    associatedInstitutions: [{ openAlexId: 'I-system', displayName: 'University of California System' }],
  };
  const resolver = () => identityResolver(new Map([
    ['University of California System', system],
    ['University of California San Diego', ucsd],
  ]));

  test('(a) "Los Angeles, University of California System" vs "University of California San Diego" — staged — FALSE', async () => {
    // LEFT decorates SYSTEM with a leading "Los Angeles" segment (mirroring a
    // byline where the system name appears after a campus-city fragment).
    // "University of California System" has no contiguous extension within
    // this LEFT operand (nothing follows it), so it's a 'standalone' pool
    // candidate — admitted, but on the staged path that only earns it a
    // chance at `institutionDirectMatch`, never an associated link. SYSTEM's
    // display name does not directly match UCSD's, so this stays FALSE.
    const checker = createInstitutionConsistencyChecker({ resolver: resolver(), segmentComparison: true });

    await expect(checker.areConsistent(
      'Los Angeles, University of California System',
      'University of California San Diego',
    )).resolves.toBe(false);
  });

  test('(b) plain "University of California System" vs "University of California San Diego" — staged — FALSE', async () => {
    // The CRITICAL TRAP this test exists to pin: LEFT here is the bare WHOLE
    // operand string, with no comma-fragment relationship to RIGHT at all —
    // "University of California System" is not a segment of the UCSD
    // operand, and UCSD's own name is not a segment of the SYSTEM operand.
    // The prior wave's shape-conditional fallback guard (`wholeIsParentWithin`)
    // would NEVER have fired for this pairing, because there is no
    // parent/child STRING shape between the two operands to detect — the
    // leak here is purely that SYSTEM resolves as a WHOLE and carries a
    // one-hop associated link to UCSD's family, with no fragment/parent
    // shape involved at all. Only Wave 3e's unconditional
    // (`segmentComparison: true` => `institutionDirectMatch` ONLY, always)
    // rule closes this — a shape-conditional guard structurally cannot.
    const checker = createInstitutionConsistencyChecker({ resolver: resolver(), segmentComparison: true });

    await expect(checker.areConsistent(
      'University of California System',
      'University of California San Diego',
    )).resolves.toBe(false);
  });

  test('(c) same pair as (b) with segmentComparison FALSE — TRUE — pins pre-existing main/default corroboration behavior (Stage 2 scope)', async () => {
    // The default/off path is untouched by Wave 3e (owner decision 3): it
    // still uses `institutionsConsistent`, so this same pair clears via
    // UCSD's associatedInstitutions -> SYSTEM link exactly as it did before
    // any Stage 1 work started. This is the live behavior the owner
    // identified as the actual production root cause (system/campus pairs
    // auto-clearing on main) — fixing IT is explicitly Stage 2 scope
    // (typed-relationship classification), not this wave's job. This test
    // exists so that scope boundary is visible and enforced in CI: if this
    // flips to false without a corresponding Stage 2 change, something
    // touched default-path behavior that shouldn't have.
    const checker = createInstitutionConsistencyChecker({ resolver: resolver() });

    await expect(checker.areConsistent(
      'University of California System',
      'University of California San Diego',
    )).resolves.toBe(true);
  });
});
