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
  getProposalListOverview,
  rebuildProposalList,
  revokeProposalList,
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
    // Like the real store: marks are read at replacement time, not passed in.
    replaceItems: jest.fn(async (id, snapshot) => {
      const before = new Map((items.get(id) || []).map((i) => [i.request_id, i]));
      items.set(id, snapshot.map((i) => ({
        request_id: i.requestId, request_number: i.requestNumber, title: i.title, institution: i.institution,
        project_leader: i.projectLeader, section: i.section,
        highlighted: before.get(i.requestId)?.highlighted === true,
        own_institution: before.get(i.requestId)?.own_institution === true,
      })));
      return true;
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
    // The service hands the store the bare snapshot; it never supplies marks of its own.
    expect(deps.store.replaceItems.mock.calls[0][1].every((i) => !('highlighted' in i) && !('ownInstitution' in i))).toBe(true);
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
