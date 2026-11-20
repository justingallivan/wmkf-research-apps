/**
 * Proposal list link lifecycle — who may receive a list, expiry from the
 * Board meeting date, frozen items, marks, rebuild, and revoke
 * (docs/plans/J27_PROPOSAL_LIST_EMAILS_PLAN_2026-11-18.md).
 *
 * @jest-environment node
 */
import { hashToken } from '../../lib/services/external-token';
import {
  computeProposalListExpiry,
  createProposalList,
  getAdvisorPicks,
  getProposalListDetail,
  getProposalListOverview,
  rebuildProposalList,
  revokeProposalList,
  setAdvisorPick,
  setProposalListMarks,
} from '../../lib/services/proposal-lists/list-link-service';

const ACTOR = { systemUserId: '99999999-9999-4999-8999-999999999999', name: 'Staff Person', email: 'Staff@Example.org' };
const REQ_A = '11111111-1111-4111-8111-111111111111';
const REQ_B = '22222222-2222-4222-8222-222222222222';
const REQ_C = '33333333-3333-4333-8333-333333333333';
const LINK_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NOW = new Date('2026-12-08T18:00:00Z');

let originalBase;
beforeAll(() => {
  originalBase = process.env.NEXTAUTH_URL;
  process.env.NEXTAUTH_URL = 'https://apps.example.org';
});
afterAll(() => {
  if (originalBase === undefined) delete process.env.NEXTAUTH_URL;
  else process.env.NEXTAUTH_URL = originalBase;
});

function snapshotItem(requestId, number, institution = 'Caltech') {
  return { requestId, requestNumber: number, title: `Proposal ${number}`, institution, projectLeader: 'P. Leader', section: 'Physics' };
}

function makeDeps(overrides = {}) {
  const rows = new Map();
  const items = new Map();
  const picks = new Set(); // `${requestId}:${rosterId}`
  const store = {
    listLiveLinks: jest.fn(async () => [...rows.values()].filter((row) => !row.revoked_at)),
    getLinkById: jest.fn(async (id) => rows.get(id) || null),
    listItems: jest.fn(async (id) => items.get(id) || []),
    insertLinkWithItems: jest.fn(async (link, linkItems) => {
      const row = {
        id: link.id, cycle_code: link.cycleCode, list_kind: link.listKind, recipient_name: link.recipientName,
        recipient_email: link.recipientEmail, recipient_source: link.recipientSource, token_digest: link.tokenDigest,
        token_ciphertext: link.tokenCiphertext, expires_at: link.expiresAt, created_at: NOW, revoked_at: null,
      };
      rows.set(link.id, row);
      items.set(link.id, linkItems.map((i) => ({
        request_id: i.requestId, request_number: i.requestNumber, title: i.title, institution: i.institution,
        project_leader: i.projectLeader, section: i.section, highlighted: i.highlighted, own_institution: i.ownInstitution,
      })));
      return row;
    }),
    // Like the real store: marks on listed proposals are read at replacement
    // time; only a proposal new to the list takes the caller's highlight.
    replaceItems: jest.fn(async (id, snapshot) => {
      const before = new Map((items.get(id) || []).map((i) => [i.request_id, i]));
      items.set(id, snapshot.map((i) => ({
        request_id: i.requestId, request_number: i.requestNumber, title: i.title, institution: i.institution,
        project_leader: i.projectLeader, section: i.section,
        highlighted: before.has(i.requestId) ? before.get(i.requestId).highlighted === true : i.highlighted === true,
        own_institution: before.get(i.requestId)?.own_institution === true,
      })));
      return true;
    }),
    listPickedRequestIds: jest.fn(async (rosterId) => [...new Set([...picks]
      .map((key) => key.split(':'))
      .filter(([, roster]) => rosterId === null || Number(roster) === rosterId)
      .map(([request]) => request))]),
    listPicksForRequest: jest.fn(async (requestId) => [...picks]
      .map((key) => key.split(':')).filter(([request]) => request === requestId).map(([, roster]) => Number(roster))),
    listPicksForRequests: jest.fn(async (requestIds) => [...picks]
      .map((key) => key.split(':'))
      .filter(([request]) => requestIds.includes(request))
      .map(([requestId, roster]) => ({ requestId, rosterId: Number(roster) }))),
    setPick: jest.fn(async (requestId, rosterId, picked) => {
      if (picked) picks.add(`${requestId}:${rosterId}`); else picks.delete(`${requestId}:${rosterId}`);
    }),
    setMarks: jest.fn(async () => true),
    revokeLink: jest.fn(async (id) => {
      const row = rows.get(id);
      if (!row || row.revoked_at) return null;
      row.revoked_at = NOW;
      return row;
    }),
  };
  let n = 0;
  return {
    rows,
    items,
    picks,
    deps: {
      schemaReady: () => true,
      getBoardDates: jest.fn(async () => ({ wmkf_cyclecode: 'J27', wmkf_meetingdate: '2027-06-09T00:00:00Z' })),
      getDirectory: jest.fn(async () => ({
        staff: [],
        external: [
          { kind: 'roster', rosterId: 7, name: 'Board Member', email: 'board@example.org', roleType: 'Board', affiliation: 'Caltech' },
          { kind: 'roster', rosterId: 8, name: 'No Email', email: null, roleType: 'Board', affiliation: null },
          { kind: 'roster', rosterId: 9, name: 'A Consultant', email: 'consultant@example.org', roleType: 'Consultant', affiliation: null },
        ],
      })),
      loadSnapshot: jest.fn(async () => [snapshotItem(REQ_A, '1001'), snapshotItem(REQ_B, '1002', 'MIT')]),
      previewReadOnly: () => false,
      // REQ_A and REQ_B are Scored (J27); REQ_C is a J27 request not yet scored.
      readRequest: jest.fn(async (id) => ({
        [REQ_A]: { akoya_requestid: REQ_A, wmkf_phaseistatus: 100000004, wmkf_GrantCycle: { wmkf_cyclecode: 'J27' } },
        [REQ_B]: { akoya_requestid: REQ_B, wmkf_phaseistatus: 707510005, wmkf_GrantCycle: { wmkf_cyclecode: 'J27' } },
        [REQ_C]: { akoya_requestid: REQ_C, wmkf_phaseistatus: null, wmkf_GrantCycle: { wmkf_cyclecode: 'J27' } },
      })[id] || null),
      store,
      mint: jest.fn(async () => ({ jwt: `jwt-${++n}`, jti: `jti-${n}`, hash: hashToken(`jwt-${n}`) })),
      seal: (value) => `sealed:${value}`,
      unseal: (value) => value.replace(/^sealed:/, ''),
      now: () => NOW,
      randomUUID: jest.fn().mockReturnValueOnce('subject-1').mockReturnValue(LINK_ID),
      ...overrides,
    },
  };
}

describe('computeProposalListExpiry', () => {
  test('ends after the Board meeting day in Pacific time, never during it', () => {
    const expiry = computeProposalListExpiry('2027-06-09T00:00:00Z');
    // 11:59 pm Pacific daylight time on the meeting day is 06:59 UTC the next day.
    expect(expiry.getTime()).toBeGreaterThan(Date.parse('2027-06-10T06:59:00Z'));
    expect(expiry.toISOString()).toBe('2027-06-10T08:00:00.000Z');
  });
  test('no date gives no expiry', () => {
    expect(computeProposalListExpiry(null)).toBeNull();
    expect(computeProposalListExpiry('June 9')).toBeNull();
  });
});

describe('createProposalList', () => {
  test('creates a Board member’s link with every proposal frozen onto it', async () => {
    const { deps, items } = makeDeps();
    const { link } = await createProposalList({ cycleCode: 'J27', listKind: 'ordinary', rosterId: 7, actor: ACTOR }, deps);
    expect(link.recipientEmail).toBe('board@example.org');
    expect(link.url).toBe('https://apps.example.org/external/proposal-list/jwt-1');
    expect(link.expiresAt).toBe('2027-06-10T08:00:00.000Z');
    expect(items.get(LINK_ID).map((i) => i.request_number)).toEqual(['1001', '1002']);
    const stored = deps.store.insertLinkWithItems.mock.calls[0][0];
    expect(stored.tokenCiphertext).not.toBe('jwt-1');
    expect(stored.recipientSource).toBe('expertise_roster:7');
    expect(stored.createdBy).toBe(ACTOR.systemUserId);
  });

  test('suggests the own-institution mark only for the recipient’s institution', async () => {
    const { deps, items } = makeDeps();
    await createProposalList({ cycleCode: 'J27', listKind: 'ordinary', rosterId: 7, actor: ACTOR }, deps);
    expect(items.get(LINK_ID).map((i) => [i.request_number, i.own_institution])).toEqual([['1001', true], ['1002', false]]);
  });

  test('the token outlives the row, so the row’s expiry is the one enforced', async () => {
    const { deps } = makeDeps();
    await createProposalList({ cycleCode: 'J27', listKind: 'ordinary', rosterId: 7, actor: ACTOR }, deps);
    const minted = deps.mint.mock.calls[0][0];
    expect(minted.audience).toBe('proposal-list');
    expect(minted.expiresAt.getTime()).toBeGreaterThan(Date.parse('2027-06-10T08:00:00Z'));
  });

  test.each([
    [9, 'a consultant on the roster'],
    [8, 'a Board member with no email address'],
    [404, 'someone not on the roster'],
  ])('refuses roster id %p (%s)', async (rosterId) => {
    const { deps } = makeDeps();
    await expect(createProposalList({ cycleCode: 'J27', listKind: 'ordinary', rosterId, actor: ACTOR }, deps))
      .rejects.toMatchObject({ httpStatus: 409 });
    expect(deps.store.insertLinkWithItems).not.toHaveBeenCalled();
  });

  test('a test list goes to the signed-in staff member even when a Board member is named', async () => {
    const { deps } = makeDeps();
    const { link } = await createProposalList({ cycleCode: 'J27', listKind: 'test', rosterId: 7, actor: ACTOR }, deps);
    expect(link.recipientEmail).toBe('staff@example.org');
    expect(deps.getDirectory).not.toHaveBeenCalled();
    expect(deps.loadSnapshot).toHaveBeenCalledWith({ cycleCode: 'J27', listKind: 'test' });
  });

  test('refuses when the cycle has no Board meeting date', async () => {
    const { deps } = makeDeps({ getBoardDates: jest.fn(async () => ({ wmkf_cyclecode: 'J27', wmkf_meetingdate: null })) });
    await expect(createProposalList({ cycleCode: 'J27', listKind: 'ordinary', rosterId: 7, actor: ACTOR }, deps))
      .rejects.toMatchObject({ code: 'proposal_list_meeting_date_missing' });
    expect(deps.mint).not.toHaveBeenCalled();
  });

  test('refuses when the Board meeting has passed', async () => {
    const { deps } = makeDeps({ getBoardDates: jest.fn(async () => ({ wmkf_meetingdate: '2026-06-10T00:00:00Z' })) });
    await expect(createProposalList({ cycleCode: 'J27', listKind: 'ordinary', rosterId: 7, actor: ACTOR }, deps))
      .rejects.toMatchObject({ code: 'proposal_list_meeting_date_passed' });
  });

  test('refuses an empty cycle, a second list for the same person, a staff account with no Dynamics identity, and the flag off', async () => {
    const empty = makeDeps({ loadSnapshot: jest.fn(async () => []) });
    await expect(createProposalList({ cycleCode: 'J27', listKind: 'ordinary', rosterId: 7, actor: ACTOR }, empty.deps))
      .rejects.toMatchObject({ code: 'proposal_list_empty' });

    const duplicate = makeDeps();
    duplicate.deps.store.insertLinkWithItems.mockRejectedValue(Object.assign(new Error('dup'), { code: '23505' }));
    await expect(createProposalList({ cycleCode: 'J27', listKind: 'ordinary', rosterId: 7, actor: ACTOR }, duplicate.deps))
      .rejects.toMatchObject({ code: 'proposal_list_already_exists' });

    await expect(createProposalList({ cycleCode: 'J27', listKind: 'ordinary', rosterId: 7, actor: { ...ACTOR, systemUserId: null } }, makeDeps().deps))
      .rejects.toMatchObject({ httpStatus: 403 });

    const off = makeDeps({ schemaReady: () => false });
    await expect(createProposalList({ cycleCode: 'J27', listKind: 'ordinary', rosterId: 7, actor: ACTOR }, off.deps))
      .rejects.toMatchObject({ httpStatus: 503 });
    expect(off.deps.getDirectory).not.toHaveBeenCalled();
  });
});

describe('marks, rebuild, revoke, overview', () => {
  async function withList() {
    const made = makeDeps();
    await createProposalList({ cycleCode: 'J27', listKind: 'ordinary', rosterId: 7, actor: ACTOR }, made.deps);
    return made;
  }

  test('marks are refused for a proposal that is not on this list', async () => {
    const { deps } = await withList();
    // REQ_C is a well-formed id that exists nowhere on this link.
    await expect(setProposalListMarks({ linkId: LINK_ID, highlightedRequestIds: [REQ_A, REQ_C], ownInstitutionRequestIds: [], actor: ACTOR }, deps))
      .rejects.toMatchObject({ code: 'proposal_list_marks_not_on_list' });
    expect(deps.store.setMarks).not.toHaveBeenCalled();
  });

  test('marks for listed proposals are saved', async () => {
    const { deps } = await withList();
    await setProposalListMarks({ linkId: LINK_ID, highlightedRequestIds: [REQ_A.toUpperCase()], ownInstitutionRequestIds: [REQ_B], actor: ACTOR }, deps);
    expect(deps.store.setMarks).toHaveBeenCalledWith(LINK_ID, { highlightedRequestIds: [REQ_A], ownInstitutionRequestIds: [REQ_B] });
  });

  test('marks reject input that is not a list of ids', async () => {
    const { deps } = await withList();
    await expect(setProposalListMarks({ linkId: LINK_ID, highlightedRequestIds: 'all', ownInstitutionRequestIds: [], actor: ACTOR }, deps))
      .rejects.toMatchObject({ httpStatus: 400 });
  });

  test('rebuild keeps the link and the marks on proposals still listed, and adds new ones unmarked', async () => {
    const { deps, items } = await withList();
    items.get(LINK_ID)[1].highlighted = true; // REQ_B highlighted by staff
    deps.loadSnapshot.mockResolvedValue([snapshotItem(REQ_B, '1002', 'MIT'), snapshotItem(REQ_C, '1003', 'UCLA')]);
    const { link, items: after } = await rebuildProposalList({ linkId: LINK_ID, actor: ACTOR }, deps);
    expect(link.url).toBe('https://apps.example.org/external/proposal-list/jwt-1');
    expect(after.map((i) => [i.requestNumber, i.highlighted])).toEqual([['1002', true], ['1003', false]]);
    expect(deps.mint).toHaveBeenCalledTimes(1);
  });

  test('marks saved while the cycle is being re-read survive the rebuild', async () => {
    const { deps, items } = await withList();
    // Another staff member highlights REQ_A during the slow snapshot read.
    deps.loadSnapshot.mockImplementation(async () => {
      items.get(LINK_ID)[0].highlighted = true;
      return [snapshotItem(REQ_A, '1001'), snapshotItem(REQ_B, '1002', 'MIT')];
    });
    const { items: after } = await rebuildProposalList({ linkId: LINK_ID, actor: ACTOR }, deps);
    expect(after.find((i) => i.requestNumber === '1001').highlighted).toBe(true);
    // The service supplies only pick highlights; the store keeps listed proposals' marks.
    expect(deps.store.replaceItems.mock.calls[0][1].every((i) => !('ownInstitution' in i))).toBe(true);
  });

  test('revoke switches the link off once; a second revoke is a 404', async () => {
    const { deps } = await withList();
    expect(await revokeProposalList({ linkId: LINK_ID, actor: ACTOR }, deps)).toEqual({ revoked: true, id: LINK_ID });
    expect(deps.store.revokeLink).toHaveBeenCalledWith(LINK_ID, ACTOR.systemUserId);
    await expect(revokeProposalList({ linkId: LINK_ID, actor: ACTOR }, deps)).rejects.toMatchObject({ httpStatus: 404 });
  });

  test('overview offers only Board members and never returns the digest or sealed token', async () => {
    const { deps } = await withList();
    const overview = await getProposalListOverview({ cycleCode: 'J27', listKind: 'ordinary', actor: ACTOR }, deps);
    expect(overview.recipients.map((r) => r.name)).toEqual(['Board Member', 'No Email']);
    expect(overview.sectionSource.placeholder).toBe(false);
    expect(overview.links).toHaveLength(1);
    expect(JSON.stringify(overview)).not.toMatch(/sealed:|token_digest|token_ciphertext/);
  });
});

describe('advisor picks', () => {
  test('a Board member’s list highlights only the proposals ticked for them', async () => {
    const { deps, items } = makeDeps();
    await setAdvisorPick({ requestId: REQ_B, rosterId: 7, picked: true, actor: ACTOR }, deps);
    await setAdvisorPick({ requestId: REQ_A, rosterId: 8, picked: true, actor: ACTOR }, deps);
    const { link } = await createProposalList({ cycleCode: 'J27', listKind: 'ordinary', rosterId: 7, actor: ACTOR }, deps);
    expect(items.get(LINK_ID).map((i) => [i.request_number, i.highlighted])).toEqual([['1001', false], ['1002', true]]);
    expect(link.highlightedCount).toBe(1);
    expect(deps.store.listPickedRequestIds).toHaveBeenCalledWith(7);
  });

  test('a test list highlights a proposal ticked for anyone', async () => {
    const { deps, items } = makeDeps();
    await setAdvisorPick({ requestId: REQ_A, rosterId: 8, picked: true, actor: ACTOR }, deps);
    await createProposalList({ cycleCode: 'J27', listKind: 'test', rosterId: 7, actor: ACTOR }, deps);
    expect(deps.store.listPickedRequestIds).toHaveBeenCalledWith(null);
    expect(items.get(LINK_ID).map((i) => [i.request_number, i.highlighted])).toEqual([['1001', true], ['1002', false]]);
  });

  test('rebuild highlights a newly listed ticked proposal but leaves marks on listed ones alone', async () => {
    const { deps, items } = makeDeps();
    await createProposalList({ cycleCode: 'J27', listKind: 'ordinary', rosterId: 7, actor: ACTOR }, deps);
    // Ticked after the list was made: REQ_B is already listed (unmarked), REQ_C is new.
    await deps.store.setPick(REQ_B, 7, true);
    await deps.store.setPick(REQ_C, 7, true);
    deps.loadSnapshot.mockResolvedValue([snapshotItem(REQ_B, '1002', 'MIT'), snapshotItem(REQ_C, '1003', 'UCLA')]);
    const { items: after } = await rebuildProposalList({ linkId: LINK_ID, actor: ACTOR }, deps);
    expect(after.map((i) => [i.requestNumber, i.highlighted])).toEqual([['1002', false], ['1003', true]]);
    expect(items.get(LINK_ID)).toHaveLength(2);
  });

  test('reads every Board member with their tick, and whether the request is Scored', async () => {
    const { deps } = makeDeps();
    await setAdvisorPick({ requestId: REQ_A, rosterId: 7, picked: true, actor: ACTOR }, deps);
    expect(await getAdvisorPicks({ requestId: REQ_A.toUpperCase() }, deps)).toEqual({
      scored: true,
      readOnly: false,
      advisors: [
        { rosterId: 7, name: 'Board Member', picked: true },
        { rosterId: 8, name: 'No Email', picked: false },
      ],
    });
    expect((await getAdvisorPicks({ requestId: REQ_C }, deps)).scored).toBe(false);
  });

  test('an untick removes the pick', async () => {
    const { deps, picks } = makeDeps();
    await setAdvisorPick({ requestId: REQ_A, rosterId: 7, picked: true, actor: ACTOR }, deps);
    const result = await setAdvisorPick({ requestId: REQ_A, rosterId: 7, picked: false, actor: ACTOR }, deps);
    expect(picks.size).toBe(0);
    expect(result.advisors.find((a) => a.rosterId === 7).picked).toBe(false);
  });

  test.each([
    [{ requestId: REQ_C, rosterId: 7, picked: true }, 'proposal_list_pick_not_scored'],
    [{ requestId: REQ_A, rosterId: 9, picked: true }, 'proposal_list_recipient_unresolved'],
    [{ requestId: REQ_A, rosterId: 7, picked: 'yes' }, 'proposal_list_pick_invalid'],
    [{ requestId: 'not-a-guid', rosterId: 7, picked: true }, 'proposal_list_request_invalid'],
    [{ requestId: LINK_ID, rosterId: 7, picked: true }, 'proposal_list_request_not_found'],
  ])('refuses %p', async (args, code) => {
    const { deps } = makeDeps();
    await expect(setAdvisorPick({ ...args, actor: ACTOR }, deps)).rejects.toMatchObject({ code });
    expect(deps.store.setPick).not.toHaveBeenCalled();
  });

  test('refuses a request outside a J27-or-later cycle, a staff account with no Dynamics identity, the flag off, and a read-only preview', async () => {
    const legacy = makeDeps({ readRequest: jest.fn(async () => ({ akoya_requestid: REQ_A, wmkf_phaseistatus: 100000004, wmkf_GrantCycle: { wmkf_cyclecode: 'J26' } })) });
    await expect(setAdvisorPick({ requestId: REQ_A, rosterId: 7, picked: true, actor: ACTOR }, legacy.deps))
      .rejects.toMatchObject({ httpStatus: 404 });
    const noActor = makeDeps();
    await expect(setAdvisorPick({ requestId: REQ_A, rosterId: 7, picked: true, actor: { ...ACTOR, systemUserId: null } }, noActor.deps))
      .rejects.toMatchObject({ httpStatus: 403 });
    const off = makeDeps({ schemaReady: () => false });
    await expect(getAdvisorPicks({ requestId: REQ_A }, off.deps)).rejects.toMatchObject({ httpStatus: 503 });
    const preview = makeDeps({ previewReadOnly: () => true });
    expect((await getAdvisorPicks({ requestId: REQ_A }, preview.deps)).readOnly).toBe(true);
    await expect(setAdvisorPick({ requestId: REQ_A, rosterId: 7, picked: true, actor: ACTOR }, preview.deps))
      .rejects.toMatchObject({ code: 'proposal_list_preview_read_only' });
    for (const made of [legacy, noActor, off, preview]) expect(made.deps.store.setPick).not.toHaveBeenCalled();
  });
});

describe('ticked-for note in the staff highlight editor', () => {
  test('each listed proposal carries the names ticked for it; a name off the Board roster is left out', async () => {
    const { deps, picks } = makeDeps();
    await createProposalList({ cycleCode: 'J27', listKind: 'ordinary', rosterId: 7, actor: ACTOR }, deps);
    picks.add(`${REQ_A}:8`);
    picks.add(`${REQ_A}:7`);
    picks.add(`${REQ_B}:404`); // no longer on the roster
    picks.add(`${REQ_C}:7`); // not on this list
    const { items } = await getProposalListDetail({ linkId: LINK_ID }, deps);
    expect(items.map((i) => [i.requestNumber, i.tickedFor])).toEqual([
      ['1001', ['Board Member', 'No Email']],
      ['1002', []],
    ]);
    expect(deps.store.listPicksForRequests).toHaveBeenCalledWith([REQ_A, REQ_B]);
  });

  test('no picks means no roster read', async () => {
    const { deps } = makeDeps();
    await createProposalList({ cycleCode: 'J27', listKind: 'ordinary', rosterId: 7, actor: ACTOR }, deps);
    deps.getDirectory.mockClear();
    const { items } = await getProposalListDetail({ linkId: LINK_ID }, deps);
    expect(items.every((i) => Array.isArray(i.tickedFor) && i.tickedFor.length === 0)).toBe(true);
    expect(deps.getDirectory).not.toHaveBeenCalled();
  });
});
