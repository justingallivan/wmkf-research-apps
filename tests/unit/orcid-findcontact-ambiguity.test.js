/**
 * @jest-environment node
 *
 * ORCIDService.findContact — the `strictAmbiguity` option (S237, Codex finding 2).
 *
 * When multiple DISTINCT name-matching ORCID iDs remain and none is disambiguated
 * by affiliation, the default behavior is a "single contactable record breaks the
 * tie" heuristic — load-bearing for the identity spine (contact-enrichment +
 * identity-evidence), which re-checks the pick downstream. The Workbench manual
 * lookup has no such downstream gate and does NOT pass the staff email in as a
 * search key, so it opts into `strictAmbiguity: true` to abstain instead of
 * attaching a namesake purely for being contactable.
 */
const { ORCIDService } = require('../../lib/services/orcid-service.js');

const TWO_NAMESAKES = [
  // Same name, distinct ORCID iDs. Only the second exposes a public email.
  { orcidId: '0000-0001-0000-0001', orcidUrl: 'https://orcid.org/0000-0001-0000-0001', givenNames: 'John', familyName: 'Smith', otherNames: [], emails: [], institutions: [] },
  { orcidId: '0000-0002-0000-0002', orcidUrl: 'https://orcid.org/0000-0002-0000-0002', givenNames: 'John', familyName: 'Smith', otherNames: [], emails: ['jsmith@uni.edu'], institutions: [] },
];

afterEach(() => jest.restoreAllMocks());

function mockSearch(rows) {
  jest.spyOn(ORCIDService, 'searchByName').mockResolvedValue(rows);
}

const args = (over = {}) => ({ name: 'John Smith', clientId: 'cid', clientSecret: 'secret', ...over });

describe('findContact distinct-ORCID ambiguity', () => {
  test('default: a single contactable record breaks the tie (spine behavior, unchanged)', async () => {
    mockSearch(TWO_NAMESAKES);
    // getProfile is hit for the selected record; null → falls back to the
    // search-record resolved shape, which is enough to assert the pick.
    jest.spyOn(ORCIDService, 'getProfile').mockResolvedValue(null);

    const result = await ORCIDService.findContact(args());
    expect(result).toMatchObject({ status: 'resolved', orcidId: '0000-0002-0000-0002' });
  });

  test('strictAmbiguity: abstains (ambiguous) instead of picking the contactable one', async () => {
    mockSearch(TWO_NAMESAKES);
    const getProfile = jest.spyOn(ORCIDService, 'getProfile').mockResolvedValue(null);

    const result = await ORCIDService.findContact(args({ strictAmbiguity: true }));
    expect(result).toMatchObject({ status: 'ambiguous', orcidId: null, candidateCount: 2 });
    // It abstained before ever fetching a profile — nobody's identity touched.
    expect(getProfile).not.toHaveBeenCalled();
  });
});
