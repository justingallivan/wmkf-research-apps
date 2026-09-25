/**
 * 6c-ii Stage A, plan "Read-side fan-out of the marker" (b'): the merge path
 * refuses a synthetic keeper OR loser before the first write, as a second,
 * independent fence -- planMerge's block predicate AND executeMerge's own
 * re-check (deliberately not derived from plan.blocked) each catch it.
 *
 * @jest-environment node
 */

import { planMerge, executeMerge } from '../../lib/services/reviewer-merge.js';

const KEEPER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const LOSER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const REQ1 = 'd1111111-1111-1111-1111-111111111111';
const SUG_L = 'c1111111-1111-1111-1111-111111111111';

function makeDeps({ keeperRow, loserRow, loserSug = [], keeperSug = [], slots = [] } = {}) {
  const withEtags = (rows, prefix) => rows.map((row, index) => ({ _etag: `W/"${prefix}-${index}"`, ...row }));
  return {
    potentialReviewer: {
      getByIdForMerge: jest.fn(async (id) => (id === KEEPER ? { ...keeperRow } : { ...loserRow })),
      update: jest.fn(async () => {}),
      clearEmail: jest.fn(async () => {}),
      deactivate: jest.fn(async () => {}),
    },
    suggestions: {
      findAllByPotentialReviewer: jest.fn(async (id) => (
        id === LOSER ? withEtags(loserSug, 'loser-suggestion') : withEtags(keeperSug, 'keeper-suggestion')
      )),
      repointToPotentialReviewer: jest.fn(async () => {}),
      hardDeleteById: jest.fn(async () => {}),
      isExcluded: jest.fn(() => false),
      hasApplicantProvenance: jest.fn((row) => row?.wmkf_applicantdisposition === 'RECOMMENDED'),
      ensureApplicantRecommended: jest.fn(async () => ({ id: 'keeper-sug', created: false, selected: true })),
    },
    requests: {
      queryAllRequests: jest.fn(async () => ({ records: slots, capped: false })),
      getById: jest.fn(async (id) => ({ akoya_requestid: id, _etag: 'W/"request-refresh"' })),
      updateById: jest.fn(async () => {}),
      disassociate: jest.fn(async () => {}),
    },
    researcher: { updateById: jest.fn(async () => {}) },
  };
}

const bareKeeper = { wmkf_potentialreviewersid: KEEPER, wmkf_name: 'Avery Quinn', wmkf_emailaddress: 'avery.quinn@example.org', _etag: 'W/"keeper"', statecode: 0 };
const bareLoser = { wmkf_potentialreviewersid: LOSER, wmkf_name: 'Avery Quill', wmkf_emailaddress: null, _etag: 'W/"loser"', statecode: 0 };
const syntheticKeeper = { ...bareKeeper, wmkf_issyntheticreviewer: true };
const syntheticLoser = { ...bareLoser, wmkf_issyntheticreviewer: true };

function assertZeroWrites(deps) {
  expect(deps.potentialReviewer.update).not.toHaveBeenCalled();
  expect(deps.potentialReviewer.clearEmail).not.toHaveBeenCalled();
  expect(deps.potentialReviewer.deactivate).not.toHaveBeenCalled();
  expect(deps.suggestions.repointToPotentialReviewer).not.toHaveBeenCalled();
  expect(deps.suggestions.hardDeleteById).not.toHaveBeenCalled();
  expect(deps.suggestions.ensureApplicantRecommended).not.toHaveBeenCalled();
  expect(deps.requests.updateById).not.toHaveBeenCalled();
  expect(deps.requests.disassociate).not.toHaveBeenCalled();
}

describe('planMerge blocks a synthetic keeper or loser', () => {
  test('synthetic keeper', async () => {
    const plan = await planMerge({ keeperId: KEEPER, loserId: LOSER }, makeDeps({ keeperRow: syntheticKeeper, loserRow: bareLoser }));
    expect(plan.blocked).toBe(true);
    expect(plan.reasons.map((r) => r.code)).toContain('keeper_synthetic_reviewer');
  });

  test('synthetic loser', async () => {
    const plan = await planMerge({ keeperId: KEEPER, loserId: LOSER }, makeDeps({ keeperRow: bareKeeper, loserRow: syntheticLoser }));
    expect(plan.blocked).toBe(true);
    expect(plan.reasons.map((r) => r.code)).toContain('loser_synthetic_reviewer');
  });

  test('neither synthetic stays unblocked by this fence', async () => {
    const plan = await planMerge({ keeperId: KEEPER, loserId: LOSER }, makeDeps({ keeperRow: bareKeeper, loserRow: bareLoser }));
    expect(plan.reasons.map((r) => r.code)).not.toContain('keeper_synthetic_reviewer');
    expect(plan.reasons.map((r) => r.code)).not.toContain('loser_synthetic_reviewer');
  });
});

describe('executeMerge refuses zero-writes for a synthetic keeper or loser', () => {
  test('synthetic keeper, no suggestion repoint', async () => {
    const deps = makeDeps({ keeperRow: syntheticKeeper, loserRow: bareLoser });
    await expect(executeMerge({ keeperId: KEEPER, loserId: LOSER, fieldChoices: {} }, deps))
      .rejects.toMatchObject({ status: 409 });
    assertZeroWrites(deps);
  });

  test('synthetic loser, no suggestion repoint', async () => {
    const deps = makeDeps({ keeperRow: bareKeeper, loserRow: syntheticLoser });
    await expect(executeMerge({ keeperId: KEEPER, loserId: LOSER, fieldChoices: {} }, deps))
      .rejects.toMatchObject({ status: 409 });
    assertZeroWrites(deps);
  });

  test('synthetic keeper, with a loser suggestion to repoint', async () => {
    const deps = makeDeps({
      keeperRow: syntheticKeeper,
      loserRow: bareLoser,
      loserSug: [{ wmkf_appreviewersuggestionid: SUG_L, _wmkf_request_value: REQ1 }],
    });
    await expect(executeMerge({ keeperId: KEEPER, loserId: LOSER, fieldChoices: {} }, deps))
      .rejects.toMatchObject({ status: 409 });
    assertZeroWrites(deps);
  });

  test('synthetic loser, with an applicant-slot reference', async () => {
    const deps = makeDeps({
      keeperRow: bareKeeper,
      loserRow: syntheticLoser,
      slots: [{ akoya_requestid: REQ1, _etag: 'W/"req1"', _wmkf_potentialreviewer1_value: LOSER }],
    });
    await expect(executeMerge({ keeperId: KEEPER, loserId: LOSER, fieldChoices: {} }, deps))
      .rejects.toMatchObject({ status: 409 });
    assertZeroWrites(deps);
  });
});
