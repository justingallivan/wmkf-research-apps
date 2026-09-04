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

// The loser's suggestion rows and applicant slots are STATEFUL here on purpose.
// executeMerge re-reads both immediately before deactivating (Step 7), so a mock
// that replayed the plan's snapshot would report the loser as still-referenced
// after its own repoints/deletes and fail every green merge. Repointing or
// deleting a row removes it from the live set, and a slot repoint/clear moves the
// loser out of that slot — which is what Dataverse actually does. Tests simulate a
// concurrent writer by pushing onto the live set mid-merge (see `_addLoserSug`).
function makeDeps({ keeperRow, loserRow, loserSug = [], keeperSug = [], slots = [], slotsCapped = false } = {}) {
  const withEtags = (rows, prefix) => rows.map((row, index) => ({
    _etag: `W/"${prefix}-${index}"`,
    ...row,
  }));
  // Stamped once, so a row's ETag stays stable as the set shrinks.
  let liveLoserSug = withEtags(loserSug, 'loser-suggestion');
  const liveSlots = slots.map((row) => ({ ...row }));
  const dropLoserSug = (id) => { liveLoserSug = liveLoserSug.filter((r) => r.wmkf_appreviewersuggestionid !== id); };
  const slotNumberOf = (navProp) => Number(String(navProp).replace(/^wmkf_PotentialReviewer/, ''));

  // Person rows are stateful too, so a merge can be re-executed after a Step 7
  // replan and the second plan sees the first attempt's writes (notably the email
  // move) rather than the original snapshot. Without this a convergence test
  // cannot tell a preserved address from a re-derived one.
  const liveKeeper = keeperRow ? { ...keeperRow } : keeperRow;
  const liveLoser = loserRow ? { ...loserRow } : loserRow;
  const PERSON_FIELD = {
    name: 'wmkf_name', affiliation: 'wmkf_primaryaffiliation',
    email: 'wmkf_emailaddress', website: 'wmkf_website', hIndex: 'wmkf_hindex',
  };

  const deps = {
    potentialReviewer: {
      getByIdForMerge: jest.fn(async (id) => {
        const row = id === KEEPER ? liveKeeper : liveLoser;
        return row ? { ...row } : row;
      }),
      update: jest.fn(async (id, updates) => {
        const row = id === KEEPER ? liveKeeper : liveLoser;
        if (!row) return;
        for (const [k, v] of Object.entries(updates || {})) {
          if (PERSON_FIELD[k]) row[PERSON_FIELD[k]] = v;
        }
      }),
      clearEmail: jest.fn(async (id) => {
        const row = id === KEEPER ? liveKeeper : liveLoser;
        if (row) row.wmkf_emailaddress = null;
      }),
      deactivate: jest.fn(async (id) => {
        const row = id === KEEPER ? liveKeeper : liveLoser;
        if (row) row.statecode = 1;
      }),
    },
    suggestions: {
      findAllByPotentialReviewer: jest.fn(async (id) => (
        id === LOSER ? [...liveLoserSug] : withEtags(keeperSug, 'keeper-suggestion')
      )),
      repointToPotentialReviewer: jest.fn(async (id) => { dropLoserSug(id); }),
      hardDeleteById: jest.fn(async (id) => { dropLoserSug(id); }),
      isExcluded: jest.fn((row) => row?.wmkf_applicantdisposition === 'EXCLUDED'),
      // Sentinel-based mock (matches this file's string-disposition convention):
      // applicant provenance = 'RECOMMENDED' disposition OR an 'applicant' source token.
      hasApplicantProvenance: jest.fn((row) =>
        row?.wmkf_applicantdisposition === 'RECOMMENDED' ||
        String(row?.wmkf_sources || '').split(',').map((s) => s.trim()).includes('applicant')),
      ensureApplicantRecommended: jest.fn(async () => ({ id: 'keeper-sug', created: false, selected: true })),
    },
    requests: {
      queryAllRequests: jest.fn(async () => ({ records: liveSlots.map((r) => ({ ...r })), capped: slotsCapped })),
      getById: jest.fn(async (id) => ({ akoya_requestid: id, _etag: 'W/"request-refresh"' })),
      updateById: jest.fn(async (requestId, body) => {
        const bind = Object.keys(body || {}).find((k) => k.endsWith('@odata.bind'));
        if (!bind) return;
        const n = slotNumberOf(bind.replace('@odata.bind', ''));
        const row = liveSlots.find((r) => r.akoya_requestid === requestId);
        if (row) row[`_wmkf_potentialreviewer${n}_value`] = KEEPER;
      }),
      disassociate: jest.fn(async (requestId, navProp) => {
        const n = slotNumberOf(navProp);
        const row = liveSlots.find((r) => r.akoya_requestid === requestId);
        if (row) row[`_wmkf_potentialreviewer${n}_value`] = null;
      }),
    },
    researcher: { updateById: jest.fn(async () => {}) },
  };

  // Concurrency hooks for the Step 7 re-check tests: mimic a second staff member
  // referencing the loser while this merge is mid-flight.
  deps._addLoserSug = (row) => { liveLoserSug = [...liveLoserSug, { _etag: 'W/"late-suggestion"', ...row }]; };
  deps._addLoserSlot = (requestId, slot) => {
    const existing = liveSlots.find((r) => r.akoya_requestid === requestId);
    if (existing) existing[`_wmkf_potentialreviewer${slot}_value`] = LOSER;
    else liveSlots.push(slotRow(requestId, { [slot]: LOSER }, 'W/"late-req"'));
  };
  return deps;
}

const bareKeeper = { wmkf_potentialreviewersid: KEEPER, wmkf_name: 'Avery Quinn', wmkf_emailaddress: 'avery.quinn@example.org', _etag: 'W/"keeper"' };
const bareLoser = { wmkf_potentialreviewersid: LOSER, wmkf_name: 'Avery Quill', wmkf_emailaddress: null, _etag: 'W/"loser"' };

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

  test('blocks when eligibility is the only populated closeout signal', async () => {
    const deps = makeDeps({
      keeperRow: bareKeeper, loserRow: bareLoser,
      loserSug: [{
        wmkf_appreviewersuggestionid: SUG_L,
        _wmkf_request_value: REQ1,
        wmkf_honorariumeligibility: 100000001,
      }],
    });
    const plan = await planMerge({ keeperId: KEEPER, loserId: LOSER }, deps);
    expect(plan.blocked).toBe(true);
    expect(plan.reasons.map((r) => r.code)).toContain('loser_engaged');
  });

  test('blocks when a loser suggestion carries a staff-set due-date override', async () => {
    const deps = makeDeps({
      keeperRow: bareKeeper,
      loserRow: bareLoser,
      loserSug: [{
        wmkf_appreviewersuggestionid: SUG_L,
        _wmkf_request_value: REQ1,
        wmkf_reviewduedateoverride: '2026-09-15',
      }],
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
  test('missing person ETag fails preflight before any merge write', async () => {
    const deps = makeDeps({
      keeperRow: { ...bareKeeper, _etag: null },
      loserRow: bareLoser,
      loserSug: [],
    });
    await expect(executeMerge({ keeperId: KEEPER, loserId: LOSER }, deps))
      .rejects.toMatchObject({
        code: 'merge_retryable_replan',
        operation: 'preflight',
        reason: 'etag_missing',
      });
    expect(deps.potentialReviewer.deactivate).not.toHaveBeenCalled();
  });

  test('missing suggestion ETag fails preflight before repoint/delete', async () => {
    const deps = makeDeps({
      keeperRow: bareKeeper,
      loserRow: bareLoser,
      loserSug: [{
        wmkf_appreviewersuggestionid: SUG_L,
        _wmkf_request_value: REQ1,
        _etag: null,
      }],
    });
    await expect(executeMerge({ keeperId: KEEPER, loserId: LOSER }, deps))
      .rejects.toMatchObject({
        code: 'merge_retryable_replan',
        operation: 'preflight',
        reason: 'etag_missing',
      });
    expect(deps.suggestions.repointToPotentialReviewer).not.toHaveBeenCalled();
    expect(deps.suggestions.hardDeleteById).not.toHaveBeenCalled();
  });

  test('missing applicant-slot request ETag fails preflight before slot writes', async () => {
    const deps = makeDeps({
      keeperRow: bareKeeper,
      loserRow: bareLoser,
      loserSug: [],
      slots: [slotRow(REQ1, { 2: LOSER }, null)],
    });
    await expect(executeMerge({ keeperId: KEEPER, loserId: LOSER }, deps))
      .rejects.toMatchObject({
        code: 'merge_retryable_replan',
        operation: 'preflight',
        reason: 'etag_missing',
      });
    expect(deps.requests.updateById).not.toHaveBeenCalled();
    expect(deps.requests.disassociate).not.toHaveBeenCalled();
  });

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
    expect(deps.potentialReviewer.deactivate).toHaveBeenCalledWith(LOSER, { actingUserSystemId: 'sys', ifMatch: 'W/"loser"' });
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
    expect(deps.requests.disassociate).toHaveBeenCalledWith(REQ1, 'wmkf_PotentialReviewer2', { actingUserSystemId: 'sys', ifMatch: 'W/"req1"' });
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
    // Wrap rather than replace: the underlying mock moves the loser out of the
    // slot, which the Step 7 pre-deactivate re-check depends on.
    const repointSlot = deps.requests.updateById;
    deps.requests.updateById = jest.fn(async (...args) => { order.push('slot'); return repointSlot(...args); });
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
    // Wrap rather than replace: the underlying mock drops the deleted row, which
    // the Step 7 pre-deactivate re-check depends on.
    const hardDelete = deps.suggestions.hardDeleteById;
    deps.suggestions.hardDeleteById = jest.fn(async (...args) => { order.push('delete'); return hardDelete(...args); });
    const summary = await executeMerge({ keeperId: KEEPER, loserId: LOSER, actingUserSystemId: 'sys' }, deps);
    expect(deps.suggestions.ensureApplicantRecommended).toHaveBeenCalledWith(
      { potentialReviewerId: KEEPER, requestId: REQ1 },
      { actingUserSystemId: 'sys', requireEtag: true },
    );
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

// The plan enumerates the loser's references once, then Steps 3-6 run as many
// sequential Dataverse round-trips. A reference created inside that window is
// absent from the plan and so is never repointed. The loser person's ETag cannot
// catch it: a new suggestion row / slot binding writes a DIFFERENT record and
// leaves the person row untouched, so the Step 7 If-Match still matches. Without
// the pre-deactivate re-read the merge returns success while a live reference
// points at an inactive reviewer.
describe('executeMerge — Step 7 pre-deactivate reference re-check', () => {
  const SUG_LATE = 'c9999999-9999-9999-9999-999999999999';
  const REQ2 = 'd2222222-2222-2222-2222-222222222222';
  // Force a Step 3 write, giving the concurrent writer a hook to fire from.
  const nameChoice = { fieldChoices: { name: 'loser' } };

  test('suggestion row created mid-merge: replan instead of deactivating', async () => {
    const deps = makeDeps({ keeperRow: bareKeeper, loserRow: bareLoser });
    deps.potentialReviewer.update = jest.fn(async () => {
      deps._addLoserSug({ wmkf_appreviewersuggestionid: SUG_LATE, _wmkf_request_value: REQ2 });
    });

    await expect(executeMerge({ keeperId: KEEPER, loserId: LOSER, ...nameChoice }, deps))
      .rejects.toMatchObject({
        code: 'merge_retryable_replan',
        status: 409,
        step: 7,
        operation: 'predeactivate_reference_recheck',
        reason: 'new_reference_created',
      });
    expect(deps.potentialReviewer.deactivate).not.toHaveBeenCalled();
  });

  test('applicant slot bound mid-merge: replan instead of deactivating', async () => {
    const deps = makeDeps({ keeperRow: bareKeeper, loserRow: bareLoser });
    deps.potentialReviewer.update = jest.fn(async () => { deps._addLoserSlot(REQ2, 3); });

    await expect(executeMerge({ keeperId: KEEPER, loserId: LOSER, ...nameChoice }, deps))
      .rejects.toMatchObject({ code: 'merge_retryable_replan', step: 7 });
    expect(deps.potentialReviewer.deactivate).not.toHaveBeenCalled();
  });

  // Codex S423: injecting from Step 3 is the CHEAPEST window, not the riskiest.
  // The costly interleavings are after Step 4/5 (rows already hard-deleted, slots
  // already rewritten) and after Step 6 (email already moved, and that step is
  // non-retryable by construction). Those are the ones that have to converge.
  test('suggestion created after the Step 4 delete: replan, and the retry converges', async () => {
    const COLLIDE = 'e0000000-0000-0000-0000-000000000000';
    const deps = makeDeps({
      keeperRow: bareKeeper, loserRow: bareLoser,
      loserSug: [{ wmkf_appreviewersuggestionid: SUG_L, _wmkf_request_value: REQ1 }],
      keeperSug: [{ wmkf_appreviewersuggestionid: COLLIDE, _wmkf_request_value: REQ1 }],
    });
    const hardDelete = deps.suggestions.hardDeleteById;
    deps.suggestions.hardDeleteById = jest.fn(async (...args) => {
      await hardDelete(...args);
      deps._addLoserSug({ wmkf_appreviewersuggestionid: SUG_LATE, _wmkf_request_value: REQ2 });
    });

    await expect(executeMerge({ keeperId: KEEPER, loserId: LOSER }, deps))
      .rejects.toMatchObject({ code: 'merge_retryable_replan', step: 7 });
    expect(deps.potentialReviewer.deactivate).not.toHaveBeenCalled();

    // Retry: the late row is now in the plan, gets repointed, and the merge lands.
    const summary = await executeMerge({ keeperId: KEEPER, loserId: LOSER }, deps);
    expect(summary).toMatchObject({ repointed: 1 });
    expect(deps.potentialReviewer.deactivate).toHaveBeenCalledTimes(1);
  });

  test('slot bound after the Step 5 repoint: replan, and the retry converges', async () => {
    const deps = makeDeps({
      keeperRow: bareKeeper, loserRow: bareLoser,
      slots: [slotRow(REQ1, { 2: LOSER })],
    });
    // Fire once: one concurrent writer, not a writer racing every retry.
    let injected = false;
    const repointSlot = deps.requests.updateById;
    deps.requests.updateById = jest.fn(async (...args) => {
      await repointSlot(...args);
      if (!injected) { injected = true; deps._addLoserSlot(REQ2, 3); }
    });

    await expect(executeMerge({ keeperId: KEEPER, loserId: LOSER }, deps))
      .rejects.toMatchObject({ code: 'merge_retryable_replan', step: 7 });
    expect(deps.potentialReviewer.deactivate).not.toHaveBeenCalled();

    const summary = await executeMerge({ keeperId: KEEPER, loserId: LOSER }, deps);
    expect(summary).toMatchObject({ slotsRepointed: 1 });
    expect(deps.potentialReviewer.deactivate).toHaveBeenCalledTimes(1);
  });

  // The highest-cost window: Step 6 already moved the address, and it is
  // non-retryable by construction. The retry must NOT re-derive an email move
  // against the keeper's now-updated value and must not null the address on
  // either record.
  test('reference created after the Step 6 email move: retry preserves the moved address', async () => {
    const deps = makeDeps({
      keeperRow: { ...bareKeeper, wmkf_emailaddress: 'old@example.org' },
      loserRow: { ...bareLoser, wmkf_emailaddress: 'avery.quinn@example.org' },
    });
    const clearEmail = deps.potentialReviewer.clearEmail;
    deps.potentialReviewer.clearEmail = jest.fn(async (...args) => {
      await clearEmail(...args);
      deps._addLoserSug({ wmkf_appreviewersuggestionid: SUG_LATE, _wmkf_request_value: REQ2 });
    });

    await expect(executeMerge({ keeperId: KEEPER, loserId: LOSER, fieldChoices: { email: 'loser' } }, deps))
      .rejects.toMatchObject({ code: 'merge_retryable_replan', step: 7 });
    expect(deps.potentialReviewer.deactivate).not.toHaveBeenCalled();

    // Second attempt: the address already lives on the keeper and is gone from
    // the loser, so there is nothing left to move — no second clearEmail.
    const clearCalls = deps.potentialReviewer.clearEmail.mock.calls.length;
    const summary = await executeMerge({ keeperId: KEEPER, loserId: LOSER, fieldChoices: { email: 'loser' } }, deps);
    expect(summary.emailMoved).toBe(false);
    expect(deps.potentialReviewer.clearEmail).toHaveBeenCalledTimes(clearCalls);
    expect((await deps.potentialReviewer.getByIdForMerge(KEEPER)).wmkf_emailaddress).toBe('avery.quinn@example.org');
    expect(deps.potentialReviewer.deactivate).toHaveBeenCalledTimes(1);
  });

  test('capped slot re-read at Step 7 is a replan, not a dead-end 400', async () => {
    const deps = makeDeps({ keeperRow: bareKeeper, loserRow: bareLoser });
    // Plan-time read is clean; the re-read comes back capped.
    let call = 0;
    deps.requests.queryAllRequests = jest.fn(async () => {
      call += 1;
      return { records: [], capped: call > 1 };
    });

    await expect(executeMerge({ keeperId: KEEPER, loserId: LOSER }, deps))
      .rejects.toMatchObject({
        code: 'merge_retryable_replan',
        status: 409,
        step: 7,
        reason: 'slot_query_capped',
      });
    expect(deps.potentialReviewer.deactivate).not.toHaveBeenCalled();
  });

  test('capped slot read at PLAN time stays a terminal validation error', async () => {
    const deps = makeDeps({ keeperRow: bareKeeper, loserRow: bareLoser, slotsCapped: true });
    await expect(executeMerge({ keeperId: KEEPER, loserId: LOSER }, deps))
      .rejects.toThrow(/Too many applicant-slot references/);
  });

  // Discriminating case: the re-check must clear on rows the merge ITSELF
  // handled. If it compared against the plan's snapshot rather than live state,
  // this repoint + delete would look like two surviving references and every
  // real merge would fail.
  test('rows the merge repointed/deleted do not trip the re-check', async () => {
    const COLLIDE = 'e0000000-0000-0000-0000-000000000000';
    const deps = makeDeps({
      keeperRow: bareKeeper, loserRow: bareLoser,
      loserSug: [
        { wmkf_appreviewersuggestionid: SUG_L, _wmkf_request_value: REQ1 },
        { wmkf_appreviewersuggestionid: COLLIDE, _wmkf_request_value: REQ2 },
      ],
      keeperSug: [{ wmkf_appreviewersuggestionid: 'e1111111-1111-1111-1111-111111111111', _wmkf_request_value: REQ2 }],
      slots: [slotRow(REQ1, { 2: LOSER })],
    });

    const summary = await executeMerge({ keeperId: KEEPER, loserId: LOSER }, deps);
    expect(summary).toMatchObject({ repointed: 1, deleted: 1, slotsRepointed: 1 });
    expect(deps.potentialReviewer.deactivate).toHaveBeenCalledWith(LOSER, expect.objectContaining({ ifMatch: 'W/"loser"' }));
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
