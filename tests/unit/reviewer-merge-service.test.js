/**
 * Chunk 2 (S289 reviewer-merge): planMerge + executeMerge.
 * Covers the fail-closed block predicate, the repoint/collision plan, and the
 * ordered execute (repoint, conditional-delete, email move, deactivate).
 *
 * @jest-environment node
 */

import { jest } from '@jest/globals';
import { planMerge, executeMerge, projectMergePlanForClient } from '../../lib/services/reviewer-merge.js';

const KEEPER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const LOSER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const REQ1 = 'd1111111-1111-1111-1111-111111111111';
const SUG_L = 'c1111111-1111-1111-1111-111111111111';

// Build an akoya_request slot row for the findApplicantSlotRefs query mock.
// slotMap maps slot number → person GUID, e.g. { 1: LOSER, 3: KEEPER }.
function slotRow(requestId, slotMap, etag = 'W/"req1"') {
  const row = { akoya_requestid: requestId, _etag: etag };
  for (const [n, v] of Object.entries(slotMap)) row[`_wmkf_potentialreviewer${n}_value`] = v;
  return row;
}

function makeDeps({ keeperRow, loserRow, loserSug = [], keeperSug = [], slots = [], slotsCapped = false } = {}) {
  return {
    potentialReviewer: {
      getByIdForMerge: jest.fn(async (id) => (id === KEEPER ? keeperRow : loserRow)),
      update: jest.fn(async () => {}),
      clearEmail: jest.fn(async () => {}),
      deactivate: jest.fn(async () => {}),
    },
    suggestions: {
      findAllByPotentialReviewer: jest.fn(async (id) => (id === LOSER ? loserSug : keeperSug)),
      repointToPotentialReviewer: jest.fn(async () => {}),
      hardDeleteById: jest.fn(async () => {}),
      isExcluded: jest.fn((row) => row?.wmkf_applicantdisposition === 'EXCLUDED'),
      // Sentinel-based mock (matches this file's string-disposition convention):
      // applicant provenance = 'RECOMMENDED' disposition OR an 'applicant' source token.
      hasApplicantProvenance: jest.fn((row) =>
        row?.wmkf_applicantdisposition === 'RECOMMENDED' ||
        String(row?.wmkf_sources || '').split(',').map((s) => s.trim()).includes('applicant')),
      ensureApplicantRecommended: jest.fn(async () => ({ id: 'keeper-sug', created: false, selected: true })),
    },
    requests: {
      queryAllRequests: jest.fn(async () => ({ records: slots, capped: slotsCapped })),
      updateById: jest.fn(async () => {}),
      disassociate: jest.fn(async () => {}),
    },
    researcher: { updateById: jest.fn(async () => {}) },
  };
}

const bareKeeper = { wmkf_potentialreviewersid: KEEPER, wmkf_name: 'Avery Quinn', wmkf_emailaddress: 'avery.quinn@example.org' };
const bareLoser = { wmkf_potentialreviewersid: LOSER, wmkf_name: 'Avery Quill', wmkf_emailaddress: null };

describe('planMerge — validation', () => {
  test('rejects non-GUID ids and identical ids', async () => {
    await expect(planMerge({ keeperId: 'x', loserId: LOSER }, makeDeps())).rejects.toThrow(/keeperId must be a GUID/);
    await expect(planMerge({ keeperId: KEEPER, loserId: 'y' }, makeDeps())).rejects.toThrow(/loserId must be a GUID/);
    await expect(planMerge({ keeperId: KEEPER, loserId: KEEPER }, makeDeps())).rejects.toThrow(/must differ/);
  });
});

describe('planMerge — block predicate (fail-closed)', () => {
  test('blocks when the loser is promoted to a contact', async () => {
    const deps = makeDeps({ keeperRow: bareKeeper, loserRow: { ...bareLoser, _wmkf_contact_value: 'ffffffff-ffff-ffff-ffff-ffffffffffff' } });
    const plan = await planMerge({ keeperId: KEEPER, loserId: LOSER }, deps);
    expect(plan.blocked).toBe(true);
    expect(plan.reasons.map((r) => r.code)).toContain('loser_has_contact');
  });

  test('blocks when a loser suggestion shows any engagement (invited)', async () => {
    const deps = makeDeps({
      keeperRow: bareKeeper, loserRow: bareLoser,
      loserSug: [{ wmkf_appreviewersuggestionid: SUG_L, _wmkf_request_value: REQ1, wmkf_invited: true }],
    });
    const plan = await planMerge({ keeperId: KEEPER, loserId: LOSER }, deps);
    expect(plan.blocked).toBe(true);
    expect(plan.reasons.map((r) => r.code)).toContain('loser_engaged');
  });

  test('blocks a submitted review via wmkf_reviewreceivedat even with NULL rating columns (Phase D co-set)', async () => {
    // The 3 rating columns were dropped from ENGAGEMENT_SIGNAL_FIELDS. A submitted
    // review co-sets wmkf_reviewreceivedat, so engagement is still detected from
    // that signal alone — proving the drop didn't weaken the merge block.
    const deps = makeDeps({
      keeperRow: bareKeeper, loserRow: bareLoser,
      loserSug: [{
        wmkf_appreviewersuggestionid: SUG_L, _wmkf_request_value: REQ1,
        wmkf_reviewreceivedat: '2026-06-28T00:00:00Z',
        wmkf_reviewerimpact: null, wmkf_reviewerrisk: null, wmkf_revieweroverallrating: null,
      }],
    });
    const plan = await planMerge({ keeperId: KEEPER, loserId: LOSER }, deps);
    expect(plan.blocked).toBe(true);
    expect(plan.reasons.map((r) => r.code)).toContain('loser_engaged');
  });

  test('blocks when a loser suggestion is applicant-excluded (disposition)', async () => {
    const deps = makeDeps({
      keeperRow: bareKeeper, loserRow: bareLoser,
      loserSug: [{ wmkf_appreviewersuggestionid: SUG_L, _wmkf_request_value: REQ1, wmkf_applicantdisposition: 'EXCLUDED' }],
    });
    const plan = await planMerge({ keeperId: KEEPER, loserId: LOSER }, deps);
    expect(plan.blocked).toBe(true);
    expect(plan.reasons.map((r) => r.code)).toContain('loser_engaged');
  });

  test('an applicant-slot reference NO LONGER blocks — it plans a slot repoint (v1 block lifted)', async () => {
    const deps = makeDeps({
      keeperRow: bareKeeper, loserRow: bareLoser,
      slots: [slotRow(REQ1, { 2: LOSER })],
    });
    const plan = await planMerge({ keeperId: KEEPER, loserId: LOSER }, deps);
    expect(plan.blocked).toBe(false);
    expect(plan.reasons.map((r) => r.code)).not.toContain('loser_in_applicant_slot');
    expect(plan.slotRepoints).toHaveLength(1);
    expect(plan.slotRepoints[0]).toMatchObject({ requestId: REQ1, etag: 'W/"req1"', ops: [{ slot: 2, action: 'repoint' }] });
  });
});

describe('planMerge — near-name duplicate shape (both pre-engagement, no collision)', () => {
  test('not blocked; loser suggestion is a repoint; field diff computed', async () => {
    const deps = makeDeps({
      keeperRow: { ...bareKeeper, wmkf_primaryaffiliation: 'Example University' },
      loserRow: { ...bareLoser, wmkf_primaryaffiliation: 'Example Research Branch' },
      loserSug: [{ wmkf_appreviewersuggestionid: SUG_L, _wmkf_request_value: REQ1, wmkf_selected: true, _etag: 'W/"1"' }],
      keeperSug: [],
    });
    const plan = await planMerge({ keeperId: KEEPER, loserId: LOSER }, deps);
    expect(plan.blocked).toBe(false);
    expect(plan.repoint).toHaveLength(1);
    expect(plan.collisions).toHaveLength(0);
    expect(plan.repoint[0]).toMatchObject({ suggestionId: SUG_L, requestId: REQ1, etag: 'W/"1"' });
    const aff = plan.fields.find((f) => f.field === 'affiliation');
    expect(aff.differs).toBe(true);
  });

  test('same-request rows become a collision, not a repoint', async () => {
    const deps = makeDeps({
      keeperRow: bareKeeper, loserRow: bareLoser,
      loserSug: [{ wmkf_appreviewersuggestionid: SUG_L, _wmkf_request_value: REQ1, _etag: 'W/"2"' }],
      keeperSug: [{ wmkf_appreviewersuggestionid: 'e0000000-0000-0000-0000-000000000000', _wmkf_request_value: REQ1 }],
    });
    const plan = await planMerge({ keeperId: KEEPER, loserId: LOSER }, deps);
    expect(plan.collisions).toHaveLength(1);
    expect(plan.repoint).toHaveLength(0);
  });
});

describe('executeMerge', () => {
  test('refuses a blocked plan and mutates nothing', async () => {
    const deps = makeDeps({ keeperRow: bareKeeper, loserRow: { ...bareLoser, _wmkf_contact_value: 'ffffffff-ffff-ffff-ffff-ffffffffffff' } });
    await expect(executeMerge({ keeperId: KEEPER, loserId: LOSER }, deps)).rejects.toThrow(/Merge blocked/);
    expect(deps.potentialReviewer.deactivate).not.toHaveBeenCalled();
    expect(deps.suggestions.repointToPotentialReviewer).not.toHaveBeenCalled();
  });

  test('happy path: repoints the loser suggestion (with ETag), deactivates loser, no email move', async () => {
    const deps = makeDeps({
      keeperRow: bareKeeper, loserRow: bareLoser,
      loserSug: [{ wmkf_appreviewersuggestionid: SUG_L, _wmkf_request_value: REQ1, _etag: 'W/"1"' }],
    });
    const summary = await executeMerge({ keeperId: KEEPER, loserId: LOSER, fieldChoices: {}, actingUserSystemId: 'sys' }, deps);
    expect(deps.suggestions.repointToPotentialReviewer).toHaveBeenCalledWith(SUG_L, KEEPER, { actingUserSystemId: 'sys', ifMatch: 'W/"1"' });
    expect(deps.potentialReviewer.deactivate).toHaveBeenCalledWith(LOSER, { actingUserSystemId: 'sys' });
    expect(deps.potentialReviewer.clearEmail).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ repointed: 1, deleted: 0, emailMoved: false });
  });

  test('chosen loser field is written to the keeper (affiliation → both adapters)', async () => {
    const deps = makeDeps({
      keeperRow: { ...bareKeeper, wmkf_primaryaffiliation: 'Example University' },
      loserRow: { ...bareLoser, wmkf_primaryaffiliation: 'Example Research Branch' },
      loserSug: [],
    });
    await executeMerge({ keeperId: KEEPER, loserId: LOSER, fieldChoices: { affiliation: 'loser' } }, deps);
    expect(deps.potentialReviewer.update).toHaveBeenCalledWith(KEEPER, { affiliation: 'Example Research Branch' }, expect.any(Object));
    expect(deps.researcher.updateById).toHaveBeenCalledWith(KEEPER, expect.objectContaining({ affiliation: 'Example Research Branch' }), expect.any(Object));
  });

  test('collision row is conditional-deleted (ifMatch), not repointed', async () => {
    const deps = makeDeps({
      keeperRow: bareKeeper, loserRow: bareLoser,
      loserSug: [{ wmkf_appreviewersuggestionid: SUG_L, _wmkf_request_value: REQ1, _etag: 'W/"5"' }],
      keeperSug: [{ wmkf_appreviewersuggestionid: 'e0000000-0000-0000-0000-000000000000', _wmkf_request_value: REQ1 }],
    });
    const summary = await executeMerge({ keeperId: KEEPER, loserId: LOSER }, deps);
    expect(deps.suggestions.hardDeleteById).toHaveBeenCalledWith(SUG_L, { actingUserSystemId: undefined, ifMatch: 'W/"5"' });
    expect(deps.suggestions.repointToPotentialReviewer).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ repointed: 0, deleted: 1 });
  });

  test('step 4 repoint 412 becomes retryable re-plan and stops before email/deactivate', async () => {
    const deps = makeDeps({
      keeperRow: bareKeeper, loserRow: bareLoser,
      loserSug: [{ wmkf_appreviewersuggestionid: SUG_L, _wmkf_request_value: REQ1, _etag: 'W/"1"' }],
    });
    deps.suggestions.repointToPotentialReviewer = jest.fn(async () => {
      throw Object.assign(new Error('precondition failed'), { status: 412 });
    });

    await expect(executeMerge({ keeperId: KEEPER, loserId: LOSER, fieldChoices: {} }, deps))
      .rejects.toMatchObject({
        code: 'merge_retryable_replan',
        status: 409,
        retryable: true,
        action: 'replan',
        step: 4,
        operation: 'suggestion_repoint',
        reason: 'precondition_failed',
      });
    expect(deps.potentialReviewer.clearEmail).not.toHaveBeenCalled();
    expect(deps.potentialReviewer.deactivate).not.toHaveBeenCalled();
  });

  test('step 4 duplicate-key 409 becomes retryable re-plan', async () => {
    const deps = makeDeps({
      keeperRow: bareKeeper, loserRow: bareLoser,
      loserSug: [{ wmkf_appreviewersuggestionid: SUG_L, _wmkf_request_value: REQ1, _etag: 'W/"1"' }],
    });
    deps.suggestions.repointToPotentialReviewer = jest.fn(async () => {
      throw Object.assign(new Error('duplicate alternate key matching key exists'), { status: 409 });
    });

    await expect(executeMerge({ keeperId: KEEPER, loserId: LOSER, fieldChoices: {} }, deps))
      .rejects.toMatchObject({
        code: 'merge_retryable_replan',
        status: 409,
        retryable: true,
        step: 4,
        operation: 'suggestion_repoint',
        reason: 'duplicate_key',
      });
    expect(deps.potentialReviewer.clearEmail).not.toHaveBeenCalled();
    expect(deps.potentialReviewer.deactivate).not.toHaveBeenCalled();
  });

  // S387: the keeper's address and its 'manual' provenance move in ONE patch, so a
  // failure can no longer leave the keeper holding the moved address under its OLD
  // source (which the invite gate could read as a stronger tier than the evidence).
  test('email move: clears loser email, then sets keeper address + manual provenance atomically', async () => {
    const calls = [];
    const deps = makeDeps({
      keeperRow: { ...bareKeeper, wmkf_emailaddress: 'old@example.org' },
      loserRow: { ...bareLoser, wmkf_emailaddress: 'avery.quinn@example.org' },
      loserSug: [],
    });
    deps.potentialReviewer.clearEmail = jest.fn(async () => { calls.push('clearLoser'); });
    deps.potentialReviewer.update = jest.fn(async (id, u) => {
      if (u.email) calls.push(u.emailSource ? 'setKeeperWithProvenance' : 'setKeeperAddressOnly');
    });
    deps.researcher.updateById = jest.fn(async (id, u) => { if (u.emailSource) calls.push('stampManual'); });

    const summary = await executeMerge({ keeperId: KEEPER, loserId: LOSER, fieldChoices: { email: 'loser' } }, deps);
    expect(summary.emailMoved).toBe(true);
    expect(calls).toEqual(['clearLoser', 'setKeeperWithProvenance']);
    expect(deps.potentialReviewer.update).toHaveBeenCalledWith(
      KEEPER, { email: 'avery.quinn@example.org', emailSource: 'manual' }, expect.any(Object),
    );
    // No separate provenance write that could land without its address.
    expect(deps.researcher.updateById).not.toHaveBeenCalledWith(KEEPER, { emailSource: 'manual' }, expect.any(Object));
  });

  test('step 6 keeper email update failure stays a 500 email-move failure', async () => {
    const deps = makeDeps({
      keeperRow: { ...bareKeeper, wmkf_emailaddress: 'old@example.org' },
      loserRow: { ...bareLoser, wmkf_emailaddress: 'avery.quinn@example.org' },
      loserSug: [],
    });
    deps.potentialReviewer.update = jest.fn(async (id, u) => {
      if (u.email) throw Object.assign(new Error('Dataverse unavailable'), { status: 503 });
    });

    await expect(executeMerge({ keeperId: KEEPER, loserId: LOSER, fieldChoices: { email: 'loser' } }, deps))
      .rejects.toMatchObject({
        code: 'merge_email_move_failed',
        status: 500,
        retryable: false,
        phase: 'email_move',
      });
    expect(deps.potentialReviewer.clearEmail).toHaveBeenCalledWith(LOSER, expect.any(Object));
    expect(deps.potentialReviewer.deactivate).not.toHaveBeenCalled();
  });
});

describe('executeMerge — applicant-slot repoint (v1 block lifted)', () => {
  test('keeper not in any slot: repoints the loser slot to the keeper (with request ETag)', async () => {
    const deps = makeDeps({
      keeperRow: bareKeeper, loserRow: bareLoser, loserSug: [],
      slots: [slotRow(REQ1, { 2: LOSER }, 'W/"req9"')],
    });
    const summary = await executeMerge({ keeperId: KEEPER, loserId: LOSER, actingUserSystemId: 'sys' }, deps);
    expect(deps.requests.updateById).toHaveBeenCalledWith(
      REQ1,
      { 'wmkf_PotentialReviewer2@odata.bind': `/wmkf_potentialreviewerses(${KEEPER})` },
      { ifMatch: 'W/"req9"', actingUserSystemId: 'sys' },
    );
    expect(deps.requests.disassociate).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ slotsRepointed: 1, slotsCleared: 0 });
  });

  test('keeper already in a slot: clears the loser slot ($ref disassociate), does NOT repoint', async () => {
    const deps = makeDeps({
      keeperRow: bareKeeper, loserRow: bareLoser, loserSug: [],
      slots: [slotRow(REQ1, { 2: LOSER, 3: KEEPER })],
    });
    const summary = await executeMerge({ keeperId: KEEPER, loserId: LOSER, actingUserSystemId: 'sys' }, deps);
    expect(deps.requests.disassociate).toHaveBeenCalledWith(REQ1, 'wmkf_PotentialReviewer2', { actingUserSystemId: 'sys' });
    expect(deps.requests.updateById).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ slotsRepointed: 0, slotsCleared: 1 });
  });

  test('loser in TWO slots, keeper in none: repoints the first, clears the rest (no keeper-in-two-slots)', async () => {
    const deps = makeDeps({
      keeperRow: bareKeeper, loserRow: bareLoser, loserSug: [],
      slots: [slotRow(REQ1, { 1: LOSER, 4: LOSER })],
    });
    const summary = await executeMerge({ keeperId: KEEPER, loserId: LOSER }, deps);
    expect(deps.requests.updateById).toHaveBeenCalledTimes(1);
    expect(deps.requests.updateById).toHaveBeenCalledWith(
      REQ1,
      { 'wmkf_PotentialReviewer1@odata.bind': `/wmkf_potentialreviewerses(${KEEPER})` },
      expect.any(Object),
    );
    expect(deps.requests.disassociate).toHaveBeenCalledWith(REQ1, 'wmkf_PotentialReviewer4', expect.any(Object));
    expect(summary).toMatchObject({ slotsRepointed: 1, slotsCleared: 1 });
  });

  test('slot repoint runs BEFORE the email move and the loser deactivate', async () => {
    const order = [];
    const deps = makeDeps({
      keeperRow: { ...bareKeeper, wmkf_emailaddress: 'old@example.org' },
      loserRow: { ...bareLoser, wmkf_emailaddress: 'avery.quinn@example.org' },
      loserSug: [],
      slots: [slotRow(REQ1, { 2: LOSER })],
    });
    deps.requests.updateById = jest.fn(async () => { order.push('slot'); });
    deps.potentialReviewer.clearEmail = jest.fn(async () => { order.push('email'); });
    deps.potentialReviewer.deactivate = jest.fn(async () => { order.push('deactivate'); });
    await executeMerge({ keeperId: KEEPER, loserId: LOSER, fieldChoices: { email: 'loser' } }, deps);
    expect(order).toEqual(['slot', 'email', 'deactivate']);
  });

  test('slot PATCH 412 → retryable replan (step 5) and stops before email/deactivate', async () => {
    const deps = makeDeps({
      keeperRow: bareKeeper, loserRow: bareLoser, loserSug: [],
      slots: [slotRow(REQ1, { 2: LOSER })],
    });
    deps.requests.updateById = jest.fn(async () => { throw Object.assign(new Error('precondition failed'), { status: 412 }); });
    await expect(executeMerge({ keeperId: KEEPER, loserId: LOSER }, deps))
      .rejects.toMatchObject({ code: 'merge_retryable_replan', status: 409, step: 5, operation: 'slot_repoint', reason: 'precondition_failed' });
    expect(deps.potentialReviewer.clearEmail).not.toHaveBeenCalled();
    expect(deps.potentialReviewer.deactivate).not.toHaveBeenCalled();
  });

  test('slot PATCH 404 stays a HARD failure (not a retryable replan)', async () => {
    const deps = makeDeps({
      keeperRow: bareKeeper, loserRow: bareLoser, loserSug: [],
      slots: [slotRow(REQ1, { 2: LOSER })],
    });
    deps.requests.updateById = jest.fn(async () => { throw Object.assign(new Error('not found'), { status: 404 }); });
    await expect(executeMerge({ keeperId: KEEPER, loserId: LOSER }, deps)).rejects.toMatchObject({ status: 404 });
    expect(deps.potentialReviewer.deactivate).not.toHaveBeenCalled();
  });

  test('planMerge fails closed when the slot query is capped', async () => {
    const deps = makeDeps({ keeperRow: bareKeeper, loserRow: bareLoser, slotsCapped: true });
    await expect(planMerge({ keeperId: KEEPER, loserId: LOSER }, deps)).rejects.toThrow(/Too many applicant-slot references/);
  });
});

describe('executeMerge — collision-row applicant-provenance union', () => {
  const COLLIDE = 'e0000000-0000-0000-0000-000000000000';

  test('applicant-recommended colliding loser: transplants intent onto keeper BEFORE deleting the loser row', async () => {
    const order = [];
    const deps = makeDeps({
      keeperRow: bareKeeper, loserRow: bareLoser,
      loserSug: [{ wmkf_appreviewersuggestionid: SUG_L, _wmkf_request_value: REQ1, _etag: 'W/"5"', wmkf_applicantdisposition: 'RECOMMENDED' }],
      keeperSug: [{ wmkf_appreviewersuggestionid: COLLIDE, _wmkf_request_value: REQ1 }],
    });
    deps.suggestions.ensureApplicantRecommended = jest.fn(async () => { order.push('union'); return { skippedExcluded: false }; });
    deps.suggestions.hardDeleteById = jest.fn(async () => { order.push('delete'); });
    const summary = await executeMerge({ keeperId: KEEPER, loserId: LOSER, actingUserSystemId: 'sys' }, deps);
    expect(deps.suggestions.ensureApplicantRecommended).toHaveBeenCalledWith({ potentialReviewerId: KEEPER, requestId: REQ1 }, { actingUserSystemId: 'sys' });
    expect(order).toEqual(['union', 'delete']);
    expect(summary).toMatchObject({ provenanceTransferred: 1, deleted: 1 });
  });

  test('ordinary (non-applicant) colliding loser: no union, just delete', async () => {
    const deps = makeDeps({
      keeperRow: bareKeeper, loserRow: bareLoser,
      loserSug: [{ wmkf_appreviewersuggestionid: SUG_L, _wmkf_request_value: REQ1, _etag: 'W/"5"' }],
      keeperSug: [{ wmkf_appreviewersuggestionid: COLLIDE, _wmkf_request_value: REQ1 }],
    });
    const summary = await executeMerge({ keeperId: KEEPER, loserId: LOSER }, deps);
    expect(deps.suggestions.ensureApplicantRecommended).not.toHaveBeenCalled();
    expect(deps.suggestions.hardDeleteById).toHaveBeenCalled();
    expect(summary).toMatchObject({ provenanceTransferred: 0, deleted: 1 });
  });

  test('union skippedExcluded (keeper row is applicant-EXCLUDED): fail closed, no delete, no deactivate', async () => {
    const deps = makeDeps({
      keeperRow: bareKeeper, loserRow: bareLoser,
      loserSug: [{ wmkf_appreviewersuggestionid: SUG_L, _wmkf_request_value: REQ1, _etag: 'W/"5"', wmkf_sources: 'applicant' }],
      keeperSug: [{ wmkf_appreviewersuggestionid: COLLIDE, _wmkf_request_value: REQ1 }],
    });
    deps.suggestions.ensureApplicantRecommended = jest.fn(async () => ({ skippedExcluded: true }));
    await expect(executeMerge({ keeperId: KEEPER, loserId: LOSER }, deps))
      .rejects.toMatchObject({ code: 'merge_applicant_provenance_conflict', status: 409, requestId: REQ1 });
    expect(deps.suggestions.hardDeleteById).not.toHaveBeenCalled();
    expect(deps.potentialReviewer.deactivate).not.toHaveBeenCalled();
  });
});

describe('projectMergePlanForClient', () => {
  test('strips internal GUID/ETag fields and returns display fields plus counts', () => {
    const plan = {
      blocked: true,
      keeper: { id: KEEPER, name: 'Keeper', email: 'keeper@example.org' },
      loser: { id: LOSER, name: 'Loser', email: 'loser@example.org' },
      fields: [{ field: 'email', keeper: 'keeper@example.org', loser: 'loser@example.org', differs: true }],
      reasons: [{ code: 'loser_engaged', detail: 'Engaged.', requestIds: [REQ1] }],
      repoint: [{ suggestionId: SUG_L, requestId: REQ1, etag: 'W/"1"' }],
      collisions: [{ suggestionId: 'c2222222-2222-2222-2222-222222222222', requestId: 'd2222222-2222-2222-2222-222222222222', etag: 'W/"2"' }],
      slotRepoints: [{ requestId: REQ1, etag: 'W/"req1"', ops: [{ slot: 2, action: 'repoint' }, { slot: 4, action: 'clear' }] }],
    };

    const projected = projectMergePlanForClient(plan);
    expect(projected).toEqual({
      blocked: true,
      keeper: plan.keeper,
      loser: plan.loser,
      fields: plan.fields,
      reasons: [{ code: 'loser_engaged', detail: 'Engaged.' }],
      repointCount: 1,
      collisionCount: 1,
      slotRepointCount: 2,
    });
    expect(JSON.stringify(projected)).not.toContain(SUG_L);
    expect(JSON.stringify(projected)).not.toContain(REQ1);
    expect(JSON.stringify(projected)).not.toContain('W/"1"');
    expect(JSON.stringify(projected)).not.toContain('requestIds');
  });
});

describe('executeMerge — empty-loser overwrite guard (Codex S289 ITEM-3)', () => {
  // Picking "loser" for a field the loser left EMPTY must never null the keeper's
  // real value — even though the field "differs" (keeper-has / loser-empty).
  test('email: empty loser email is NOT moved over the keeper (no clearEmail, no null set)', async () => {
    const deps = makeDeps({
      keeperRow: { ...bareKeeper, wmkf_emailaddress: 'keeper@example.org' },
      loserRow: { ...bareLoser, wmkf_emailaddress: null },
      loserSug: [],
    });
    const summary = await executeMerge({ keeperId: KEEPER, loserId: LOSER, fieldChoices: { email: 'loser' } }, deps);
    expect(summary.emailMoved).toBe(false);
    expect(deps.potentialReviewer.clearEmail).not.toHaveBeenCalled();
    // keeper email must not be patched to null
    expect(deps.potentialReviewer.update).not.toHaveBeenCalledWith(KEEPER, expect.objectContaining({ email: null }), expect.any(Object));
  });

  test('affiliation: empty loser value does not overwrite the keeper', async () => {
    const deps = makeDeps({
      keeperRow: { ...bareKeeper, wmkf_primaryaffiliation: 'Example University' },
      loserRow: { ...bareLoser, wmkf_primaryaffiliation: null },
      loserSug: [],
    });
    await executeMerge({ keeperId: KEEPER, loserId: LOSER, fieldChoices: { affiliation: 'loser' } }, deps);
    expect(deps.potentialReviewer.update).not.toHaveBeenCalled();
    expect(deps.researcher.updateById).not.toHaveBeenCalled();
  });

  test('whitespace-only loser value is treated as empty (name)', async () => {
    const deps = makeDeps({
      keeperRow: { ...bareKeeper, wmkf_name: 'Avery Quinn' },
      loserRow: { ...bareLoser, wmkf_name: '   ' },
      loserSug: [],
    });
    await executeMerge({ keeperId: KEEPER, loserId: LOSER, fieldChoices: { name: 'loser' } }, deps);
    expect(deps.potentialReviewer.update).not.toHaveBeenCalled();
  });

  test('website/hIndex: empty loser values do not overwrite; hIndex 0 IS a real value', async () => {
    const deps = makeDeps({
      keeperRow: { ...bareKeeper, wmkf_website: 'https://keeper.edu', wmkf_hindex: 42 },
      loserRow: { ...bareLoser, wmkf_website: '', wmkf_hindex: 0 },
      loserSug: [],
    });
    await executeMerge({ keeperId: KEEPER, loserId: LOSER, fieldChoices: { website: 'loser', hIndex: 'loser' } }, deps);
    // website empty → skipped; hIndex 0 is real and differs → written
    expect(deps.researcher.updateById).toHaveBeenCalledWith(KEEPER, { hIndex: 0 }, expect.any(Object));
    expect(deps.researcher.updateById).not.toHaveBeenCalledWith(KEEPER, expect.objectContaining({ website: expect.anything() }), expect.any(Object));
  });
});

describe('executeMerge — re-run / double-submit safety (Codex S289 ITEM-1)', () => {
  test('refuses an already-inactive loser (statecode=1) before any mutation', async () => {
    const deps = makeDeps({
      keeperRow: bareKeeper,
      loserRow: { ...bareLoser, statecode: 1 },
      loserSug: [],
    });
    await expect(executeMerge({ keeperId: KEEPER, loserId: LOSER, fieldChoices: { email: 'loser' } }, deps))
      .rejects.toThrow(/already inactive/i);
    expect(deps.potentialReviewer.clearEmail).not.toHaveBeenCalled();
    expect(deps.potentialReviewer.update).not.toHaveBeenCalled();
    expect(deps.potentialReviewer.deactivate).not.toHaveBeenCalled();
  });

  test('an active loser (statecode=0) is NOT blocked by the guard', async () => {
    const deps = makeDeps({
      keeperRow: bareKeeper,
      loserRow: { ...bareLoser, statecode: 0 },
      loserSug: [],
    });
    const summary = await executeMerge({ keeperId: KEEPER, loserId: LOSER, fieldChoices: {} }, deps);
    expect(summary).toMatchObject({ repointed: 0, deleted: 0 });
    expect(deps.potentialReviewer.deactivate).toHaveBeenCalled();
  });
});

describe('planMerge — identity non-downgrade block (Codex S289 ITEM-5)', () => {
  test('blocks when the loser is confirmed and the keeper is not', async () => {
    const deps = makeDeps({
      keeperRow: { ...bareKeeper, wmkf_identitystatus: 'probable' },
      loserRow: { ...bareLoser, wmkf_identitystatus: 'confirmed' },
      loserSug: [],
    });
    const plan = await planMerge({ keeperId: KEEPER, loserId: LOSER }, deps);
    expect(plan.blocked).toBe(true);
    expect(plan.reasons.map((r) => r.code)).toContain('loser_confirmed_identity');
  });

  test('does NOT block when both are confirmed (keeper keeps its own attestation)', async () => {
    const deps = makeDeps({
      keeperRow: { ...bareKeeper, wmkf_identitystatus: 'confirmed' },
      loserRow: { ...bareLoser, wmkf_identitystatus: 'confirmed' },
      loserSug: [],
    });
    const plan = await planMerge({ keeperId: KEEPER, loserId: LOSER }, deps);
    expect(plan.reasons.map((r) => r.code)).not.toContain('loser_confirmed_identity');
  });
});
