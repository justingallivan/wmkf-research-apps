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
  test('a decorated byline resolves via a segment identity + one-hop associated link to a plain right operand', async () => {
    // No segment of the left byline is a string-identity match for the right
    // operand ("Massachusetts Institute of Technology"), so step 1 (direct
    // segment match) cannot fire. This proves a `true` verdict can arrive
    // via step 2: resolving a promising segment ("Broad Institute") and
    // testing it, via the existing one-hop associated-institution check,
    // against the resolved right whole string (MIT).
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
      // (abstain): step 2's 'admit' policy still admits "Broad Institute"
      // since its own identity resolved cleanly.
    ]));
    const checker = createInstitutionConsistencyChecker({ resolver, segmentComparison: true });

    await expect(checker.areConsistent(LEFT, RIGHT)).resolves.toBe(true);
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

  test('Wave 3b accepted residual (documented, NOT fixed): campus vs bare parent can still clear when the bare parent RESOLVES and its campus extension definitively abstains', async () => {
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
    // the resulting directOnly-restricted crossing compares SYSTEM against
    // SYSTEM (both sides resolved the identical bare string) — a genuine
    // DIRECT identity match, not associated-link evidence, so CHANGE 1/2's
    // restriction does not (and structurally cannot) block it.
    //
    // The obvious "fix" — rejecting a directOnly pairing whenever the
    // matched candidate strings are textually identical — was evaluated and
    // REJECTED: it also rejects the row-4 VUMC clear (request-1002903), where
    // the listed institution string is textually identical on both sides for
    // the exact same reason (a fragment resolving to the same identity as
    // the whole operand it names). There is no purely structural rule that
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
    // UCLA's associated institution BY NAME alone. CHANGE 2 must block that.
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

describe('Wave 3 — associated-link evidence still admissible for non-parent-fragment shapes', () => {
  test('vector 6: Harvard Medical School vs Harvard University clears via associated link (no comma-fragment relation)', async () => {
    // Neither operand contains the other as a contiguous comma-fragment, so
    // the CHANGE 1/2 parent-shape restriction never engages and associated
    // link evidence remains admissible, exactly as before Wave 3.
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
    const checker = createInstitutionConsistencyChecker({ resolver, segmentComparison: true });

    await expect(checker.areConsistent('Harvard Medical School', 'Harvard University')).resolves.toBe(true);
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
