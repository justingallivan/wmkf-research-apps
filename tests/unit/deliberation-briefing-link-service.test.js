/**
 * Deliberation briefing link lifecycle (docs/DELIBERATION_BRIEFING_PAGE_PLAN.md
 * §2.2, §4): expiry rule, idempotent ensure, expired-row replacement, reissue,
 * flag gating, and the sealed-token round trip.
 *
 * @jest-environment node
 */
import {
  computeBriefingExpiry,
  ensureLiveBriefingLink,
  getLiveBriefingLink,
  projectBriefingLink,
  reissueBriefingLink,
} from '../../lib/services/deliberation-briefing/briefing-link-service';
import { hashToken } from '../../lib/services/external-token';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-09-10T17:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

beforeAll(() => { process.env.NEXTAUTH_URL = 'https://apps.test'; });

function harness({ live = null, meetingDate = null, siteVisit = null, ready = true } = {}) {
  let liveRow = live;
  let mintCount = 0;
  const deps = {
    schemaReady: () => ready,
    getRequest: jest.fn(async () => ({ akoya_requestid: REQUEST_ID, wmkf_meetingdate: meetingDate })),
    findActiveSiteVisit: jest.fn(async () => siteVisit),
    getLiveLink: jest.fn(async () => liveRow),
    insertLink: jest.fn(async (row) => {
      liveRow = { id: row.id, request_id: row.requestId, jti: row.jti, token_digest: row.tokenDigest, token_ciphertext: row.tokenCiphertext, expires_at: row.expiresAt, created_by: row.createdBy, created_at: NOW, revoked_at: null };
      return liveRow;
    }),
    replaceLiveLink: jest.fn(async (_requestId, row) => {
      liveRow = { id: row.id, request_id: REQUEST_ID, jti: row.jti, token_digest: row.tokenDigest, token_ciphertext: row.tokenCiphertext, expires_at: row.expiresAt, created_by: row.createdBy, created_at: NOW, revoked_at: null };
      return liveRow;
    }),
    mint: jest.fn(async ({ subject, audience, expiresAt }) => {
      mintCount += 1;
      const jwt = `jwt-${subject}-${audience}-${mintCount}-${expiresAt.toISOString()}`;
      return { jwt, jti: `jti-${mintCount}`, hash: hashToken(jwt) };
    }),
    seal: (value) => `sealed:${value}`,
    unseal: (value) => (value.startsWith('sealed:') ? value.slice(7) : null),
    now: () => NOW,
    randomUUID: () => `4444${String(mintCount + 1).padStart(4, '0')}-4444-4444-8444-444444444444`,
  };
  return deps;
}

describe('computeBriefingExpiry', () => {
  test('site visit end + 7 days wins over meeting date', () => {
    const expiry = computeBriefingExpiry({ siteVisitEnd: '2026-10-01T22:00:00Z', meetingDate: '2026-12-01', now: NOW });
    expect(expiry.toISOString()).toBe(new Date(Date.parse('2026-10-01T22:00:00Z') + 7 * DAY).toISOString());
  });
  test('meeting date + 7 days when no visit', () => {
    const expiry = computeBriefingExpiry({ siteVisitEnd: null, meetingDate: '2026-12-01T00:00:00Z', now: NOW });
    expect(expiry.toISOString()).toBe(new Date(Date.parse('2026-12-01T00:00:00Z') + 7 * DAY).toISOString());
  });
  test('a cutoff minutes away is still honored, never widened', () => {
    const soon = new Date(NOW.getTime() - 7 * DAY + 30 * 60 * 1000); // visit ended 7d ago minus 30 min → cutoff in 30 min
    expect(computeBriefingExpiry({ siteVisitEnd: soon.toISOString(), meetingDate: '2026-12-01T00:00:00Z', now: NOW }).toISOString())
      .toBe(new Date(NOW.getTime() + 30 * 60 * 1000).toISOString());
  });
  test('a past visit falls through to a future meeting date before the 60-day default', () => {
    expect(computeBriefingExpiry({ siteVisitEnd: '2026-01-01T00:00:00Z', meetingDate: '2026-12-01T00:00:00Z', now: NOW }).toISOString())
      .toBe(new Date(Date.parse('2026-12-01T00:00:00Z') + 7 * DAY).toISOString());
  });
  test('falls back to 60 days only when nothing scheduled is still ahead', () => {
    expect(computeBriefingExpiry({ now: NOW }).toISOString()).toBe(new Date(NOW.getTime() + 60 * DAY).toISOString());
    expect(computeBriefingExpiry({ siteVisitEnd: '2026-01-01T00:00:00Z', meetingDate: '2026-02-01T00:00:00Z', now: NOW }).toISOString())
      .toBe(new Date(NOW.getTime() + 60 * DAY).toISOString());
  });
});

test('ensure mints once and returns the same live link on the second call', async () => {
  const deps = harness({ meetingDate: '2026-12-01T00:00:00Z' });
  const first = await ensureLiveBriefingLink({ requestId: REQUEST_ID, actorId: ACTOR_ID }, deps);
  expect(first.reused).toBe(false);
  expect(first.link.url).toMatch(/^https:\/\/apps\.test\/external\/briefing\/jwt-/);
  expect(deps.mint).toHaveBeenCalledWith(expect.objectContaining({ subject: REQUEST_ID, audience: 'briefing', ops: ['view_briefing'] }));
  const second = await ensureLiveBriefingLink({ requestId: REQUEST_ID, actorId: ACTOR_ID }, deps);
  expect(second.reused).toBe(true);
  expect(second.link.id).toBe(first.link.id);
  expect(second.link.url).toBe(first.link.url);
  expect(deps.mint).toHaveBeenCalledTimes(1);
  expect(deps.insertLink).toHaveBeenCalledTimes(1);
  expect(deps.replaceLiveLink).not.toHaveBeenCalled();
});

test('ensure replaces an expired live row instead of reusing it', async () => {
  const stale = { id: '55555555-5555-4555-8555-555555555555', request_id: REQUEST_ID, token_digest: 'x', token_ciphertext: 'sealed:old', expires_at: new Date(NOW.getTime() - DAY), revoked_at: null };
  const deps = harness({ live: stale });
  const result = await ensureLiveBriefingLink({ requestId: REQUEST_ID, actorId: ACTOR_ID }, deps);
  expect(result.reused).toBe(false);
  expect(result.link.id).not.toBe(stale.id);
  expect(deps.replaceLiveLink).toHaveBeenCalledWith(REQUEST_ID, expect.objectContaining({ createdBy: ACTOR_ID }), { revokedBy: ACTOR_ID, expectedLiveId: stale.id });
});

test('reissue always revokes and replaces, and the old id is no longer live', async () => {
  const deps = harness();
  const first = await ensureLiveBriefingLink({ requestId: REQUEST_ID, actorId: ACTOR_ID }, deps);
  const second = await reissueBriefingLink({ requestId: REQUEST_ID, actorId: ACTOR_ID }, deps);
  expect(second.link.id).not.toBe(first.link.id);
  expect(deps.replaceLiveLink).toHaveBeenCalledTimes(1);
  const live = await getLiveBriefingLink({ requestId: REQUEST_ID }, deps);
  expect(live.id).toBe(second.link.id);
  expect(live.id).not.toBe(first.link.id);
});

test('a failed site-visit read refuses to mint instead of widening the window', async () => {
  const deps = harness();
  deps.findActiveSiteVisit = jest.fn(async () => { throw new Error('Dataverse 503'); });
  await expect(ensureLiveBriefingLink({ requestId: REQUEST_ID, actorId: ACTOR_ID }, deps)).rejects.toThrow('Dataverse 503');
  expect(deps.mint).not.toHaveBeenCalled();
  expect(deps.insertLink).not.toHaveBeenCalled();
});

test('flag off refuses mint and reads as null', async () => {
  const deps = harness({ ready: false });
  await expect(ensureLiveBriefingLink({ requestId: REQUEST_ID, actorId: ACTOR_ID }, deps))
    .rejects.toMatchObject({ code: 'briefing_schema_not_ready', httpStatus: 503 });
  expect(await getLiveBriefingLink({ requestId: REQUEST_ID }, deps)).toBeNull();
});

test('an unreadable sealed token is reported to staff and replaced by Share, never served', async () => {
  const row = { id: '55555555-5555-4555-8555-555555555555', request_id: REQUEST_ID, token_digest: hashToken('other'), token_ciphertext: 'sealed:jwt-tampered', expires_at: new Date(NOW.getTime() + DAY), revoked_at: null, created_at: NOW, created_by: ACTOR_ID };
  const deps = harness({ live: row });
  const read = await getLiveBriefingLink({ requestId: REQUEST_ID }, deps);
  expect(read).toMatchObject({ id: row.id, url: null, unreadable: true });
  const ensured = await ensureLiveBriefingLink({ requestId: REQUEST_ID, actorId: ACTOR_ID }, deps);
  expect(ensured.reused).toBe(false);
  expect(ensured.link.id).not.toBe(row.id);
  expect(ensured.link.url).toMatch(/^https:\/\/apps\.test\/external\/briefing\//);
  expect(deps.replaceLiveLink).toHaveBeenCalledTimes(1);
  // A throwing unseal (key rotation) is the same case.
  const rotated = harness({ live: { ...row, token_ciphertext: 'sealed:x' } });
  rotated.unseal = () => { throw new Error('bad key'); };
  expect(await getLiveBriefingLink({ requestId: REQUEST_ID }, rotated)).toMatchObject({ unreadable: true, url: null });
});

test('recovery of an expired row is a compare-and-swap: a concurrent replacement is adopted, not revoked', async () => {
  const stale = { id: '55555555-5555-4555-8555-555555555555', request_id: REQUEST_ID, token_digest: 'x', token_ciphertext: 'sealed:old', expires_at: new Date(NOW.getTime() - DAY), revoked_at: null };
  const winnerJwt = 'jwt-from-the-other-caller';
  const winner = { id: '66666666-6666-4666-8666-666666666666', request_id: REQUEST_ID, token_digest: hashToken(winnerJwt), token_ciphertext: `sealed:${winnerJwt}`, expires_at: new Date(NOW.getTime() + DAY), revoked_at: null, created_at: NOW, created_by: ACTOR_ID };
  const deps = harness({ live: stale });
  const { linkSupersededError } = await import('../../lib/services/deliberation-briefing/briefing-link-store');
  deps.getLiveLink = jest.fn().mockResolvedValueOnce(stale).mockResolvedValueOnce(winner);
  deps.replaceLiveLink = jest.fn(async (_requestId, _replacement, options) => {
    expect(options.expectedLiveId).toBe(stale.id);
    throw linkSupersededError();
  });
  const result = await ensureLiveBriefingLink({ requestId: REQUEST_ID, actorId: ACTOR_ID }, deps);
  expect(result.reused).toBe(true);
  expect(result.link.id).toBe(winner.id);
  expect(result.link.url).toBe(`https://apps.test/external/briefing/${winnerJwt}`);
});

test('staff reissue passes the inspected link id and surfaces a superseded refusal', async () => {
  const deps = harness();
  const first = await ensureLiveBriefingLink({ requestId: REQUEST_ID, actorId: ACTOR_ID }, deps);
  const { linkSupersededError } = await import('../../lib/services/deliberation-briefing/briefing-link-store');
  deps.replaceLiveLink = jest.fn(async (_r, _rep, options) => {
    expect(options.expectedLiveId).toBe(first.link.id);
    throw linkSupersededError();
  });
  await expect(reissueBriefingLink({ requestId: REQUEST_ID, actorId: ACTOR_ID, expectedLinkId: first.link.id }, deps))
    .rejects.toMatchObject({ code: 'briefing_link_superseded', httpStatus: 409 });
  await expect(reissueBriefingLink({ requestId: REQUEST_ID, actorId: ACTOR_ID, expectedLinkId: 'nope' }, deps))
    .rejects.toMatchObject({ code: 'briefing_request_invalid' });
});

test('reissue surfaces the store refusal while a send bound to the live link holds a lease', async () => {
  const deps = harness();
  await ensureLiveBriefingLink({ requestId: REQUEST_ID, actorId: ACTOR_ID }, deps);
  const { sendInProgressError } = await import('../../lib/services/deliberation-briefing/briefing-link-store');
  deps.replaceLiveLink = jest.fn(async () => { throw sendInProgressError(); });
  await expect(reissueBriefingLink({ requestId: REQUEST_ID, actorId: ACTOR_ID }, deps))
    .rejects.toMatchObject({ code: 'briefing_send_in_progress', httpStatus: 409 });
});

test('projection never exposes the digest or ciphertext', () => {
  const projected = projectBriefingLink({ id: 'a', request_id: REQUEST_ID, token_digest: 'd', token_ciphertext: 'c', expires_at: NOW, created_at: NOW, created_by: ACTOR_ID }, { url: 'u' });
  expect(Object.keys(projected).sort()).toEqual(['createdAt', 'createdBy', 'expiresAt', 'id', 'requestId', 'unreadable', 'url']);
});

test('actor and request identity are required before any store read', async () => {
  const deps = harness();
  await expect(ensureLiveBriefingLink({ requestId: 'nope', actorId: ACTOR_ID }, deps)).rejects.toMatchObject({ code: 'briefing_request_invalid' });
  await expect(ensureLiveBriefingLink({ requestId: REQUEST_ID, actorId: null }, deps)).rejects.toMatchObject({ code: 'briefing_actor_required' });
  expect(deps.getLiveLink).not.toHaveBeenCalled();
});

test('a racing first insert that loses the partial unique index adopts the winner', async () => {
  const deps = harness();
  const winnerJwt = 'jwt-winner';
  const winner = { id: '55555555-5555-4555-8555-555555555555', request_id: REQUEST_ID, token_digest: hashToken(winnerJwt), token_ciphertext: `sealed:${winnerJwt}`, expires_at: new Date(NOW.getTime() + DAY), revoked_at: null, created_at: NOW, created_by: ACTOR_ID };
  deps.getLiveLink = jest.fn()
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(winner);
  deps.insertLink = jest.fn(async () => { const e = new Error('duplicate'); e.code = '23505'; throw e; });
  const result = await ensureLiveBriefingLink({ requestId: REQUEST_ID, actorId: ACTOR_ID }, deps);
  expect(result.reused).toBe(true);
  expect(result.link.id).toBe(winner.id);
  expect(result.link.url).toBe(`https://apps.test/external/briefing/${winnerJwt}`);
});
