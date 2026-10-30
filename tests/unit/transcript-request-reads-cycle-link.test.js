/** @jest-environment node */
/**
 * The transcript and summary services pass their own request read into
 * `loadBoundContext`, which takes the cycle from the Grant Cycle link. Their
 * default reads must ask for the link, or every request is refused as having no
 * cycle (tests elsewhere inject rows that already carry it).
 */

const getById = jest.fn(async () => ({}));
jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({
  ...jest.requireActual('../../lib/dataverse/adapters/grant-request.js'),
  getById: (...args) => getById(...args),
}));
jest.mock('../../lib/dataverse/adapters/operations-grant-cycle.js', () => ({
  ...jest.requireActual('../../lib/dataverse/adapters/operations-grant-cycle.js'),
  linkedCycleExpand: () => 'wmkf_GrantCycle($select=wmkf_cyclecode)',
}));

const { PRESENTATION_TRANSCRIPT_DEPENDENCIES } = require('../../lib/services/post-presentation-materials/presentation-transcript-service.js');
const { TRANSCRIPT_SUMMARY_DEPENDENCIES } = require('../../lib/services/post-presentation-materials/transcript-summary-service.js');

const REQUEST_ID = '33333333-3333-4333-8333-333333333333';

test.each([
  ['presentation transcript', PRESENTATION_TRANSCRIPT_DEPENDENCIES],
  ['transcript summary', TRANSCRIPT_SUMMARY_DEPENDENCIES],
])('%s default request read carries the Grant Cycle expand', async (_name, dependencies) => {
  getById.mockClear();
  await dependencies.getRequest(REQUEST_ID);
  expect(getById).toHaveBeenCalledWith(REQUEST_ID, expect.objectContaining({
    expand: 'wmkf_GrantCycle($select=wmkf_cyclecode)',
  }));
});
