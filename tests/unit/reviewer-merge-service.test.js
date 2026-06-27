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

function makeDeps({ keeperRow, loserRow, loserSug = [], keeperSug = [], slots = [] } = {}) {
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
    },
    dynamics: { queryRecords: jest.fn(async () => ({ records: slots })) },
    researcher: { updateById: jest.fn(async () => {}) },
  };
}

const bareKeeper = { wmkf_potentialreviewersid: KEEPER, wmkf_name: 'Joshua Rabinowitz', wmkf_emailaddress: 'joshr@princeton.edu' };
const bareLoser = { wmkf_potentialreviewersid: LOSER, wmkf_name: 'Joshua Ravinowitz', wmkf_emailaddress: null };

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

  test('blocks when a loser suggestion is applicant-excluded (disposition)', async () => {
    const deps = makeDeps({
      keeperRow: bareKeeper, loserRow: bareLoser,
      loserSug: [{ wmkf_appreviewersuggestionid: SUG_L, _wmkf_request_value: REQ1, wmkf_applicantdisposition: 'EXCLUDED' }],
    });
    const plan = await planMerge({ keeperId: KEEPER, loserId: LOSER }, deps);
    expect(plan.blocked).toBe(true);
    expect(plan.reasons.map((r) => r.code)).toContain('loser_engaged');
  });

  test('blocks when the loser is referenced by an applicant slot', async () => {
    const deps = makeDeps({ keeperRow: bareKeeper, loserRow: bareLoser, slots: [{ akoya_requestid: REQ1 }] });
    const plan = await planMerge({ keeperId: KEEPER, loserId: LOSER }, deps);
    expect(plan.blocked).toBe(true);
    expect(plan.reasons.map((r) => r.code)).toContain('loser_in_applicant_slot');
  });
});

describe('planMerge — the Rabinowitz shape (both pre-engagement, no collision)', () => {
  test('not blocked; loser suggestion is a repoint; field diff computed', async () => {
    const deps = makeDeps({
      keeperRow: { ...bareKeeper, wmkf_primaryaffiliation: 'Princeton' },
      loserRow: { ...bareLoser, wmkf_primaryaffiliation: 'Ludwig Princeton Branch' },
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
      keeperRow: { ...bareKeeper, wmkf_primaryaffiliation: 'Princeton' },
      loserRow: { ...bareLoser, wmkf_primaryaffiliation: 'Ludwig Princeton Branch' },
      loserSug: [],
    });
    await executeMerge({ keeperId: KEEPER, loserId: LOSER, fieldChoices: { affiliation: 'loser' } }, deps);
    expect(deps.potentialReviewer.update).toHaveBeenCalledWith(KEEPER, { affiliation: 'Ludwig Princeton Branch' }, expect.any(Object));
    expect(deps.researcher.updateById).toHaveBeenCalledWith(KEEPER, expect.objectContaining({ affiliation: 'Ludwig Princeton Branch' }), expect.any(Object));
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

  test('email move: clears loser email, sets keeper, stamps manual provenance — in that order', async () => {
    const calls = [];
    const deps = makeDeps({
      keeperRow: { ...bareKeeper, wmkf_emailaddress: 'old@princeton.edu' },
      loserRow: { ...bareLoser, wmkf_emailaddress: 'joshr@princeton.edu' },
      loserSug: [],
    });
    deps.potentialReviewer.clearEmail = jest.fn(async () => { calls.push('clearLoser'); });
    deps.potentialReviewer.update = jest.fn(async (id, u) => { if (u.email) calls.push('setKeeper'); });
    deps.researcher.updateById = jest.fn(async (id, u) => { if (u.emailSource) calls.push('stampManual'); });

    const summary = await executeMerge({ keeperId: KEEPER, loserId: LOSER, fieldChoices: { email: 'loser' } }, deps);
    expect(summary.emailMoved).toBe(true);
    expect(calls).toEqual(['clearLoser', 'setKeeper', 'stampManual']);
    expect(deps.researcher.updateById).toHaveBeenCalledWith(KEEPER, { emailSource: 'manual' }, expect.any(Object));
  });

  test('step 6 keeper email update failure stays a 500 email-move failure', async () => {
    const deps = makeDeps({
      keeperRow: { ...bareKeeper, wmkf_emailaddress: 'old@princeton.edu' },
      loserRow: { ...bareLoser, wmkf_emailaddress: 'joshr@princeton.edu' },
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
      keeperRow: { ...bareKeeper, wmkf_emailaddress: 'keeper@princeton.edu' },
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
      keeperRow: { ...bareKeeper, wmkf_primaryaffiliation: 'Princeton' },
      loserRow: { ...bareLoser, wmkf_primaryaffiliation: null },
      loserSug: [],
    });
    await executeMerge({ keeperId: KEEPER, loserId: LOSER, fieldChoices: { affiliation: 'loser' } }, deps);
    expect(deps.potentialReviewer.update).not.toHaveBeenCalled();
    expect(deps.researcher.updateById).not.toHaveBeenCalled();
  });

  test('whitespace-only loser value is treated as empty (name)', async () => {
    const deps = makeDeps({
      keeperRow: { ...bareKeeper, wmkf_name: 'Joshua Rabinowitz' },
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
