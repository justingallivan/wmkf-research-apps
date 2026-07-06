/**
 * Characterization tests for the DiscoveryService PubMed query builders
 * (buildAuthorQuery, buildDisambiguatedAuthorQuery).
 *
 * Written before Stage 3 of the DiscoveryService decomposition
 * (docs/DISCOVERY_SERVICE_DECOMPOSITION_PLAN.md) to pin current behavior before the code moves to
 * lib/services/discovery/pubmed-query.js. Date-relative, so the year window is derived from "now".
 */

const { DiscoveryService } = require('../../lib/services/discovery-service');

const Y = new Date().getFullYear();
const from = Y - DiscoveryService.YEARS_LOOKBACK;

describe('DiscoveryService.buildAuthorQuery', () => {
  it('strips a leading title and appends the author + date window', () => {
    expect(DiscoveryService.buildAuthorQuery('Dr. Jane Smith')).toBe(
      `Jane Smith[Author] AND (${from}:${Y}[pdat])`,
    );
  });
});

describe('DiscoveryService.buildDisambiguatedAuthorQuery', () => {
  it('adds a Title/Abstract OR-block from the first two expertise areas', () => {
    expect(DiscoveryService.buildDisambiguatedAuthorQuery({
      name: 'Jane Smith',
      expertiseAreas: ['cancer immunology', 'genomics', 'ignored third'],
    })).toBe(
      `Jane Smith[Author] AND ((cancer immunology[Title/Abstract]) OR (genomics[Title/Abstract])) AND (${from}:${Y}[pdat])`,
    );
  });
  it('falls back to the plain author+date query when no expertise areas', () => {
    expect(DiscoveryService.buildDisambiguatedAuthorQuery({ name: 'Prof. Jane Smith' })).toBe(
      `Jane Smith[Author] AND (${from}:${Y}[pdat])`,
    );
  });
});
