/**
 * @jest-environment node
 */

jest.mock('../../lib/services/openalex-service', () => ({
  OpenAlexService: {
    searchAuthors: jest.fn(),
  },
}));

const { OpenAlexService } = require('../../lib/services/openalex-service');
const { ORCIDService } = require('../../lib/services/orcid-service');
const { ReviewerIdentityEvidence } = require('../../lib/services/reviewer-identity-evidence');

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
