/**
 * @jest-environment node
 */

jest.mock('../../lib/services/openalex-service', () => ({
  OpenAlexService: {
    searchAuthors: jest.fn(),
    getWorksByAuthor: jest.fn(),
  },
}));

const { OpenAlexService } = require('../../lib/services/openalex-service');
const { ORCIDService } = require('../../lib/services/orcid-service');
const { ReviewerIdentityEvidence, buildIdentityNote } = require('../../lib/services/reviewer-identity-evidence');

const record = (overrides = {}) => ({
  openAlexId: 'https://openalex.org/A1',
  displayName: 'Robert Sang',
  orcid: '0000-0002-1825-0097',
  lastKnownInstitution: 'Griffith University',
  topics: ['Attosecond physics'],
  worksCount: 1000,
  ...overrides,
});

describe('ReviewerIdentityEvidence.evaluateSuggestion', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.restoreAllMocks();
    process.env = { ...originalEnv, ORCID_CLIENT_ID: 'c', ORCID_CLIENT_SECRET: 's' };
    // Default: the work-grounding rescue (S249) finds nothing, so it never changes a
    // normal-path verdict. Rescue tests override these per-case.
    OpenAlexService.getWorksByAuthor.mockReset().mockResolvedValue({ totalCount: 0, records: [] });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('affiliation plus ORCID employment plus topic resolves confirmed', async () => {
    OpenAlexService.searchAuthors.mockResolvedValue({ totalCount: 1, records: [record()] });
    jest.spyOn(ORCIDService, 'getProfile').mockResolvedValue({
      orcidId: '0000-0002-1825-0097',
      currentAffiliation: 'Griffith University',
      affiliations: [{ organization: 'Griffith University', current: true }],
    });

    const out = await ReviewerIdentityEvidence.evaluateSuggestion(
      { name: 'Robert Sang', suggestedInstitution: 'Griffith University', expertiseAreas: ['attosecond science'] },
      { proposalInfo: { primaryResearchArea: 'Physics' } },
    );

    expect(out.status).toBe('confirmed');
    expect(out.orcid).toBe('0000-0002-1825-0097');
    expect(out.anchors.map((a) => a.type)).toEqual(expect.arrayContaining([
      'affiliation_match',
      'topic_match',
      'orcid_employment_corroborated',
    ]));
  });

  test('initial-only OpenAlex displayName still confirms WITH affiliation + ORCID employment (S236 Keller/Sang fix)', async () => {
    // OpenAlex stores the reviewer as an initial ("R. T. Sang"). forenamesContradict
    // is false (an initial can't contradict the full forename), and affiliation_match +
    // ORCID-employment corroboration are the 2nd independent signal that makes the match
    // safe. The first forename gate (forenameAgrees !== false) wrongly demoted this to
    // unresolved; the fix (forenameContradicts !== true) must confirm it.
    OpenAlexService.searchAuthors.mockResolvedValue({ totalCount: 1, records: [record({ displayName: 'R. T. Sang' })] });
    jest.spyOn(ORCIDService, 'getProfile').mockResolvedValue({
      orcidId: '0000-0002-1825-0097',
      currentAffiliation: 'Griffith University',
      affiliations: [{ organization: 'Griffith University', current: true }],
    });

    const out = await ReviewerIdentityEvidence.evaluateSuggestion(
      { name: 'Robert Sang', suggestedInstitution: 'Griffith University', expertiseAreas: ['attosecond science'] },
      { proposalInfo: { primaryResearchArea: 'Physics' } },
    );

    expect(out.status).toBe('confirmed');
  });

  test('weak affiliation plus topic resolves probable without ORCID demotion', async () => {
    delete process.env.ORCID_CLIENT_ID;
    delete process.env.ORCID_CLIENT_SECRET;
    OpenAlexService.searchAuthors.mockResolvedValue({ totalCount: 1, records: [record({ orcid: null })] });
    const profileSpy = jest.spyOn(ORCIDService, 'getProfile').mockResolvedValue(null);

    const out = await ReviewerIdentityEvidence.evaluateSuggestion(
      { name: 'Robert Sang', suggestedInstitution: 'Griffith University', expertiseAreas: ['attosecond science'] },
      { proposalInfo: { primaryResearchArea: 'Physics' } },
    );

    expect(out.status).toBe('probable');
    expect(profileSpy).not.toHaveBeenCalled();
    expect(out.identityNote).toMatch(/Identity probable/);
    expect(out.identityNote).toMatch(/Verify identity before outreach/);
  });

  test('topic-only match resolves unresolved and is not selectable', async () => {
    OpenAlexService.searchAuthors.mockResolvedValue({
      totalCount: 1,
      records: [record({ lastKnownInstitution: 'Florida State University', topics: ['Attosecond physics'], orcid: null })],
    });

    const out = await ReviewerIdentityEvidence.evaluateSuggestion(
      { name: 'Robert Sang', suggestedInstitution: 'Griffith University', expertiseAreas: ['attosecond science'] },
      { proposalInfo: { primaryResearchArea: 'Physics' } },
    );

    expect(out.status).toBe('unresolved');
    expect(out.anchors.map((a) => a.type)).toEqual(['topic_match']);
  });

  test('no constrained match abstains to unresolved', async () => {
    OpenAlexService.searchAuthors.mockResolvedValue({
      totalCount: 1,
      records: [record({ lastKnownInstitution: 'Florida State University', topics: ['Malaria epidemiology'], orcid: null })],
    });

    const out = await ReviewerIdentityEvidence.evaluateSuggestion(
      { name: 'Robert Sang', suggestedInstitution: 'Griffith University', expertiseAreas: ['attosecond science'] },
      { proposalInfo: { primaryResearchArea: 'Physics' } },
    );

    expect(out.status).toBe('abstain');
    expect(out.resolverStatus).toBe('unresolved');
    expect(out.reason).toBe('no_openalex_affiliation_or_topic_match');
    expect(out.identityNote).toMatch(/not verified/i);
  });

  test('collision abstains to unresolved when ORCID direct cannot break tie', async () => {
    OpenAlexService.searchAuthors.mockResolvedValue({
      totalCount: 2,
      records: [
        record({ openAlexId: 'https://openalex.org/A1', orcid: '0000-0000-0000-0001' }),
        record({ openAlexId: 'https://openalex.org/A2', orcid: '0000-0000-0000-0002' }),
      ],
    });
    jest.spyOn(ORCIDService, 'findContact').mockResolvedValue(null);

    const out = await ReviewerIdentityEvidence.evaluateSuggestion(
      { name: 'Robert Sang', suggestedInstitution: 'Griffith University', expertiseAreas: ['attosecond science'] },
      { proposalInfo: { primaryResearchArea: 'Physics' } },
    );

    expect(out.status).toBe('abstain');
    expect(out.reason).toBe('openalex_collision');
  });

  // S235 — trust ORCID-employment over OpenAlex institution drift (Olga Smirnova case), gated
  // on a strict forename agreement to keep the namesake fail-safe.
  const MBI = 'Max Born Institute for Nonlinear Optics and Short Pulse Spectroscopy';
  const smirnovaProfile = {
    orcidId: '0000-0002-7746-5733',
    currentAffiliation: MBI,
    affiliations: [{ organization: MBI, current: true }],
  };

  test('ORCID-employment + topic promotes to probable when OpenAlex institution has drifted', async () => {
    // OpenAlex last_known_institution drifted to a sabbatical host (Technion) → NO affiliation_match;
    // her ORCID profile still lists the claimed institution (MBI) → strong employment corroboration.
    OpenAlexService.searchAuthors.mockResolvedValue({ totalCount: 1, records: [record({
      displayName: 'Olga Smirnova', orcid: '0000-0002-7746-5733',
      lastKnownInstitution: 'Technion – Israel Institute of Technology', topics: ['Attosecond physics'],
    })] });
    jest.spyOn(ORCIDService, 'getProfile').mockResolvedValue(smirnovaProfile);

    const out = await ReviewerIdentityEvidence.evaluateSuggestion(
      { name: 'Olga Smirnova', suggestedInstitution: MBI, expertiseAreas: ['attosecond science'] },
      { proposalInfo: { primaryResearchArea: 'Physics' } },
    );

    expect(out.status).toBe('probable');
    expect(out.anchors.map((a) => a.type)).toEqual(expect.arrayContaining(['orcid_employment_corroborated', 'topic_match']));
    expect(out.anchors.map((a) => a.type)).not.toContain('affiliation_match'); // OpenAlex institution drifted away
  });

  test('FAIL-SAFE: a wrong-forename namesake is NOT promoted even with ORCID-employment + topic', async () => {
    // A fabricated "Olaf" selects the real "Olga" record (institution/topic match) whose ORCID
    // employment corroborates — the forename gate must block the promotion.
    OpenAlexService.searchAuthors.mockResolvedValue({ totalCount: 1, records: [record({
      displayName: 'Olga Smirnova', orcid: '0000-0002-7746-5733',
      lastKnownInstitution: 'Technion', topics: ['Attosecond physics'],
    })] });
    jest.spyOn(ORCIDService, 'getProfile').mockResolvedValue(smirnovaProfile);

    const out = await ReviewerIdentityEvidence.evaluateSuggestion(
      { name: 'Olaf Smirnova', suggestedInstitution: MBI, expertiseAreas: ['attosecond science'] },
      { proposalInfo: { primaryResearchArea: 'Physics' } },
    );

    expect(out.status).toBe('unresolved'); // forename Olaf ≠ Olga → promotion blocked
  });

  test('FAIL-SAFE: initial-only displayName with NO affiliation_match (drift) stays on the strict :188 gate → unresolved', async () => {
    // Distinct from the Keller/Sang fix above: here OpenAlex drifted to Technion, so there
    // is NO affiliation_match — the ONLY promotion path is :188 (ORCID-employment-only,
    // no affiliation), which keeps the stricter `forenameAgrees === true`. "O." can't fully
    // agree with "Olga" → blocked. (With an affiliation_match, an initial-only record now
    // confirms via :172/:175 on `forenameContradicts !== true` — see the Keller/Sang test.)
    OpenAlexService.searchAuthors.mockResolvedValue({ totalCount: 1, records: [record({
      displayName: 'O. Smirnova', orcid: '0000-0002-7746-5733',
      lastKnownInstitution: 'Technion', topics: ['Attosecond physics'],
    })] });
    jest.spyOn(ORCIDService, 'getProfile').mockResolvedValue(smirnovaProfile);

    const out = await ReviewerIdentityEvidence.evaluateSuggestion(
      { name: 'Olga Smirnova', suggestedInstitution: MBI, expertiseAreas: ['attosecond science'] },
      { proposalInfo: { primaryResearchArea: 'Physics' } },
    );

    expect(out.status).toBe('unresolved');
  });

  // --- S249 work-grounding rescue ------------------------------------------------------
  // A correct low-footprint researcher abstains on the normal path (her coarse x_concepts
  // miss the field, Claude gave no usable institution); her recent WORK TITLES rescue her.
  describe('work-grounding rescue', () => {
    // Scores 0 on the normal path: off-topic x_concepts + no usable institution.
    const offConcept = (overrides = {}) => record({
      topics: ['Organic synthesis'], lastKnownInstitution: 'Some Teaching College', ...overrides,
    });
    const physicsSuggestion = { name: 'Robert Sang', expertiseAreas: ['attosecond science'] };
    const physicsProposal = { proposalInfo: { primaryResearchArea: 'Attosecond physics' } };

    test('rescues a forename-agreeing author whose recent work titles are on-topic → probable', async () => {
      OpenAlexService.searchAuthors.mockResolvedValue({ totalCount: 2, records: [offConcept()] });
      OpenAlexService.getWorksByAuthor.mockResolvedValue({
        totalCount: 1,
        records: [{ title: 'Attosecond electron dynamics in helium' }],
      });
      jest.spyOn(ORCIDService, 'getWorks').mockResolvedValue(['Attosecond streaking of photoemission']);
      jest.spyOn(ORCIDService, 'getProfile').mockResolvedValue(null);

      const out = await ReviewerIdentityEvidence.evaluateSuggestion(physicsSuggestion, physicsProposal);

      expect(out.status).toBe('probable');
      expect(out.anchors.map((a) => a.type)).toContain('authorship_grounded');
      expect(out.anchors.map((a) => a.type)).not.toContain('topic_match'); // x_concepts didn't match — sole signal is work-grounding
      expect(out.identityNote).toMatch(/work-grounded authorship/);
    });

    test('FAIL-SAFE: a wrong-forename namesake with on-topic works is NOT rescued', async () => {
      OpenAlexService.searchAuthors.mockResolvedValue({
        totalCount: 2, records: [offConcept({ displayName: 'Olga Smirnova' })],
      });
      OpenAlexService.getWorksByAuthor.mockResolvedValue({
        totalCount: 1, records: [{ title: 'Attosecond electron dynamics' }],
      });
      jest.spyOn(ORCIDService, 'getWorks').mockResolvedValue(['Attosecond physics review']);

      const out = await ReviewerIdentityEvidence.evaluateSuggestion(
        { name: 'Olaf Smirnova', expertiseAreas: ['attosecond science'] }, physicsProposal,
      );

      expect(out.status).toBe('abstain'); // forename Olaf ≠ Olga → never probed for work-grounding
      expect(out.reason).toBe('no_openalex_affiliation_or_topic_match');
    });

    test('VETO: an informative ORCID works list that is OFF-topic blocks the rescue', async () => {
      OpenAlexService.searchAuthors.mockResolvedValue({ totalCount: 2, records: [offConcept()] });
      OpenAlexService.getWorksByAuthor.mockResolvedValue({
        totalCount: 1, records: [{ title: 'Attosecond electron dynamics in helium' }],
      });
      // 5+ ORCID titles, all off-topic → the OpenAlex author cluster is likely a merge /
      // wrong person for this ORCID; veto rather than bind.
      jest.spyOn(ORCIDService, 'getWorks').mockResolvedValue([
        'Synthesis of polyketides', 'Catalytic asymmetric hydrogenation', 'Total synthesis of taxol',
        'Organocatalysis review', 'Cross-coupling methodology',
      ]);

      const out = await ReviewerIdentityEvidence.evaluateSuggestion(physicsSuggestion, physicsProposal);

      expect(out.status).toBe('abstain');
    });

    test('a SPARSE off-topic ORCID list is uninformative and does NOT veto → still probable', async () => {
      OpenAlexService.searchAuthors.mockResolvedValue({ totalCount: 2, records: [offConcept()] });
      OpenAlexService.getWorksByAuthor.mockResolvedValue({
        totalCount: 1, records: [{ title: 'Attosecond electron dynamics in helium' }],
      });
      jest.spyOn(ORCIDService, 'getWorks').mockResolvedValue(['One unrelated paper']); // < veto threshold
      jest.spyOn(ORCIDService, 'getProfile').mockResolvedValue(null);

      const out = await ReviewerIdentityEvidence.evaluateSuggestion(physicsSuggestion, physicsProposal);

      expect(out.status).toBe('probable');
    });

    test('COLLISION: two forename-agreeing work-grounded namesakes abstain rather than guess', async () => {
      OpenAlexService.searchAuthors.mockResolvedValue({
        totalCount: 2,
        records: [
          offConcept({ openAlexId: 'https://openalex.org/A1', orcid: null }),
          offConcept({ openAlexId: 'https://openalex.org/A2', orcid: null }),
        ],
      });
      OpenAlexService.getWorksByAuthor.mockResolvedValue({
        totalCount: 1, records: [{ title: 'Attosecond electron dynamics' }],
      });

      const out = await ReviewerIdentityEvidence.evaluateSuggestion(physicsSuggestion, physicsProposal);

      expect(out.status).toBe('abstain');
      expect(out.reason).toBe('rescue_work_grounding_collision');
    });

    test('does not run when the normal path already resolves (additive only)', async () => {
      // Normal affiliation+topic match → selected without rescue; getWorksByAuthor untouched.
      OpenAlexService.searchAuthors.mockResolvedValue({ totalCount: 1, records: [record()] });
      jest.spyOn(ORCIDService, 'getProfile').mockResolvedValue({
        orcidId: '0000-0002-1825-0097', currentAffiliation: 'Griffith University',
        affiliations: [{ organization: 'Griffith University', current: true }],
      });

      const out = await ReviewerIdentityEvidence.evaluateSuggestion(
        { name: 'Robert Sang', suggestedInstitution: 'Griffith University', expertiseAreas: ['attosecond science'] },
        { proposalInfo: { primaryResearchArea: 'Physics' } },
      );

      expect(out.status).toBe('confirmed');
      expect(OpenAlexService.getWorksByAuthor).not.toHaveBeenCalled();
    });
  });

  test('OpenAlex outage abstains instead of verifying from partial evidence', async () => {
    OpenAlexService.searchAuthors.mockRejectedValue(new Error('network down'));

    const out = await ReviewerIdentityEvidence.evaluateSuggestion(
      { name: 'Robert Sang', suggestedInstitution: 'Griffith University', expertiseAreas: ['attosecond science'] },
      { proposalInfo: { primaryResearchArea: 'Physics' } },
    );

    expect(out.status).toBe('abstain');
    expect(out.resolverStatus).toBe('unresolved');
    expect(out.sources.openalex).toBe('error');
  });
});

describe('buildIdentityNote', () => {
  test('confirmed identities mention work-grounded authorship when that anchor is present', () => {
    const note = buildIdentityNote(
      'confirmed',
      [{ type: 'authorship_grounded' }, { type: 'topic_match' }],
      record({ lastKnownInstitution: null }),
      null,
    );
    expect(note).toMatch(/Identity confirmed/);
    expect(note).toMatch(/work-grounded authorship/);
  });
});

describe('forenamesContradict — full-forename contradiction only, not initial-only (S236)', () => {
  const { forenamesContradict, forenameFullyAgrees } = ReviewerIdentityEvidence._internals;

  test('two full, different forenames contradict (the Alfred/Alain fabrication signature)', () => {
    expect(forenamesContradict('Alfred Laederach', 'Alain Laederach')).toBe(true);
    expect(forenamesContradict('Olga Smirnova', 'Anna Smirnova')).toBe(true);
  });

  test('an initial-only record does NOT contradict (Keller/Sang)', () => {
    expect(forenamesContradict('Ursula Keller', 'U. Keller')).toBe(false);
    expect(forenamesContradict('Robert Sang', 'R. T. Sang')).toBe(false);
    expect(forenamesContradict('U. Keller', 'Ursula Keller')).toBe(false); // either side initial
  });

  test('matching full forenames do not contradict', () => {
    expect(forenamesContradict('Robert Sang', 'Robert Sang')).toBe(false);
    expect(forenamesContradict('Prof. Ursula Keller', 'Ursula Keller')).toBe(false); // honorific stripped
  });

  test('a nickname vs formal forename contradicts — fails safe (over-blocks rather than mis-verifies)', () => {
    expect(forenamesContradict('Bob Smith', 'Robert Smith')).toBe(true);
  });

  test('empty / missing forename never contradicts', () => {
    expect(forenamesContradict('', 'Robert Sang')).toBe(false);
    expect(forenamesContradict('Robert Sang', '')).toBe(false);
  });

  test('contradiction and full-agreement are mutually exclusive on full names', () => {
    // a full, equal forename: agrees=true, contradicts=false
    expect(forenameFullyAgrees('Robert Sang', 'Robert Sang')).toBe(true);
    expect(forenamesContradict('Robert Sang', 'Robert Sang')).toBe(false);
    // initial-only: agrees=false AND contradicts=false (the gap the fix exploits)
    expect(forenameFullyAgrees('Ursula Keller', 'U. Keller')).toBe(false);
    expect(forenamesContradict('Ursula Keller', 'U. Keller')).toBe(false);
  });
});
