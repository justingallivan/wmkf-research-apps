/**
 * @jest-environment node
 *
 * reviewer-suggestion.findForRollup — one Dataverse query for one already-built
 * request-id OR-chain, selected-only + not-excluded. Byte-mirrors the shape
 * lib/services/reviewer-rollup.js's fetchReviewerRollup used to build inline
 * (data-access-layer migration, Stage 3-6).
 */
import { jest } from '@jest/globals';
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import { findForRollup } from '../../lib/dataverse/adapters/reviewer-suggestion.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

afterEach(() => jest.restoreAllMocks());

describe('findForRollup', () => {
  it('queries the entity set with the rollup select and wraps the OR-chain with selected + not-excluded', async () => {
    const spy = jest.spyOn(DynamicsService, 'queryAllRecords').mockResolvedValue({ records: [{ _wmkf_request_value: A }] });
    const orChain = `_wmkf_request_value eq ${A} or _wmkf_request_value eq ${B}`;

    const out = await findForRollup(orChain);

    expect(out).toEqual([{ _wmkf_request_value: A }]);
    expect(spy).toHaveBeenCalledTimes(1);
    const [entitySet, opts] = spy.mock.calls[0];
    expect(entitySet).toBe('wmkf_appreviewersuggestions');
    expect(opts.select).toBe('_wmkf_request_value,wmkf_invited,wmkf_accepted,wmkf_declined,wmkf_emailsentat,wmkf_responsetype,wmkf_reviewstatus');
    expect(opts.filter).toBe(`(${orChain}) and wmkf_selected eq true and (wmkf_applicantdisposition eq null or wmkf_applicantdisposition ne 100000001)`);
  });
});
