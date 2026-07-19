/**
 * @jest-environment node
 */

const {
  WORKS_FIRST_RESOLVER_VERSION,
  adaptCombinedIdentityResult,
  extractEvidenceBundle,
} = require('../../lib/services/reviewer-works-first-authoritative');
const {
  planIdentityBindingTransition,
} = require('../../lib/services/reviewer-identity-binding-writer');

const NOW = '2026-07-19T12:00:00.000Z';

function worksRescue() {
  return {
    decision: 'bind',
    anchor: 'orcid:0000-0003-2195-6258',
    evidenceBundle: {
      orcids: ['0000-0003-2195-6258'],
      anchorDois: ['10.1000/one', '10.1000/two', '10.1000/three'],
      rors: ['https://ror.org/05a0ya142'],
      openAlexAuthorIds: ['A100', 'A200'],
    },
  };
}

describe('works-first authoritative result adapter', () => {
  test('preserves the exact legacy object when W2 does not rescue', async () => {
    const legacyResult = { status: 'probable', selectedRecord: { openAlexId: 'A1' } };
    const result = await adaptCombinedIdentityResult({
      legacyResult,
      worksResult: worksRescue(),
      combinedResult: {
        decision: 'bind',
        anchor: 'orcid:0000-0003-2195-6258',
        reason: 'spine_works_consensus',
      },
    }, {
      getAuthorByOrcid: jest.fn(),
      now: NOW,
    });
    expect(result).toBe(legacyResult);
  });

  test('adapts a works rescue to probable and uses the current OpenAlex affiliation', async () => {
    const getAuthorByOrcid = jest.fn(async () => ({
      openAlexId: 'https://openalex.org/A100',
      displayName: 'Taekjip Ha',
      orcid: '0000-0003-2195-6258',
      lastKnownInstitution: 'Boston Children’s Hospital',
      lastKnownInstitutionId: 'https://openalex.org/I100',
      lastKnownInstitutionRor: 'https://ror.org/05a0ya142',
      worksCount: 300,
    }));
    const result = await adaptCombinedIdentityResult({
      suggestion: {
        name: 'Taekjip Ha',
        suggestedInstitution: 'Johns Hopkins University',
      },
      legacyResult: { status: 'abstain' },
      worksResult: worksRescue(),
      combinedResult: {
        decision: 'bind',
        anchor: 'orcid:0000-0003-2195-6258',
        reason: 'works_rescue',
      },
    }, {
      getAuthorByOrcid,
      now: NOW,
    });

    expect(result).toMatchObject({
      status: 'probable',
      resolverStatus: 'probable',
      orcid: '0000-0003-2195-6258',
      selectedRecord: {
        lastKnownInstitution: 'Boston Children’s Hospital',
      },
      identity: {
        status: 'probable',
        resolverVersion: WORKS_FIRST_RESOLVER_VERSION,
      },
    });
    expect(result.selectedRecord.lastKnownInstitution).not.toBe('Johns Hopkins University');
    expect(extractEvidenceBundle(result.anchors)).toEqual({
      orcids: ['0000-0003-2195-6258'],
      anchorDois: ['10.1000/one', '10.1000/three', '10.1000/two'],
      rors: ['https://ror.org/05a0ya142'],
      openAlexAuthorIds: ['A100', 'A200'],
    });

    const transition = planIdentityBindingTransition({
      _etag: 'W/"1"',
      wmkf_identitybindingversion: null,
      wmkf_identitybindingsource: null,
      wmkf_identitybindinganchor: null,
      wmkf_identityboundat: null,
      wmkf_identityderivedbindingversion: null,
      wmkf_identityfieldlineagejson: null,
    }, {
      source: 'automated',
      anchor: `orcid:${result.orcid}`,
      boundAt: NOW,
      fieldMode: 'replacement',
      fields: {
        wmkf_orcid: result.orcid,
        wmkf_orcidurl: `https://orcid.org/${result.orcid}`,
      },
      decision: result.identity,
    });
    expect(extractEvidenceBundle(
      transition.personPatch.wmkf_identityverifiedanchorsjson,
    )).toEqual({
      orcids: ['0000-0003-2195-6258'],
      anchorDois: ['10.1000/one', '10.1000/three', '10.1000/two'],
      rors: ['https://ror.org/05a0ya142'],
      openAlexAuthorIds: ['A100', 'A200'],
    });
  });

  test('fails closed on a contradictory profile or mismatched ORCID bundle', async () => {
    const contradictory = await adaptCombinedIdentityResult({
      suggestion: { name: 'Taekjip Ha' },
      worksResult: worksRescue(),
      combinedResult: {
        decision: 'bind',
        anchor: 'orcid:0000-0003-2195-6258',
        reason: 'works_rescue',
      },
    }, {
      getAuthorByOrcid: jest.fn(async () => ({
        displayName: 'Thomas Ha',
        orcid: '0000-0003-2195-6258',
      })),
      now: NOW,
    });
    expect(contradictory).toMatchObject({
      status: 'abstain',
      resolverStatus: 'ambiguous',
      reason: 'works_rescue_profile_contradiction',
    });

    const mismatchedBundle = await adaptCombinedIdentityResult({
      suggestion: { name: 'Taekjip Ha' },
      worksResult: {
        ...worksRescue(),
        evidenceBundle: {
          ...worksRescue().evidenceBundle,
          orcids: ['0000-0001-1111-1111'],
        },
      },
      combinedResult: {
        decision: 'bind',
        anchor: 'orcid:0000-0003-2195-6258',
        reason: 'works_rescue',
      },
    }, {
      getAuthorByOrcid: jest.fn(),
      now: NOW,
    });
    expect(mismatchedBundle).toMatchObject({
      status: 'abstain',
      resolverStatus: 'ambiguous',
      reason: 'works_rescue_bundle_orcid_mismatch',
    });
  });

  test('parses persisted anchor JSON fail closed', () => {
    expect(extractEvidenceBundle('{bad json')).toBeNull();
    expect(extractEvidenceBundle({})).toBeNull();
  });
});
