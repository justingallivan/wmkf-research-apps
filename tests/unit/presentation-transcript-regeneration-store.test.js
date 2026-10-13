/** @jest-environment node */
jest.mock('@vercel/postgres', () => ({ sql: { query: jest.fn() }, db: { connect: jest.fn() } }));

import {
  createPresentationTranscriptRegenerationStore, REGENERATION_MAX_ATTEMPTS,
} from '../../lib/services/meeting-tracker-transcription/presentation-transcript-regeneration-store.js';

const ID = '11111111-1111-4111-8111-111111111111';
const REQ = '22222222-2222-4222-8222-222222222AAA';
const ART = '33333333-3333-4333-8333-333333333333';
const ACTOR = '44444444-4444-4444-8444-444444444444';
const FP = 'a'.repeat(64);
const TOKEN = '55555555-5555-4555-8555-555555555555';
const flat = text => text.replace(/\s+/g, ' ');

function harness(respond = () => ({ rows: [{ id: ID }], rowCount: 1 })) {
  const calls = [];
  const database = {
    query: (text, params = []) => {
      calls.push({ text: flat(text), params });
      const out = respond(flat(text), params, calls.length);
      return out instanceof Error ? Promise.reject(out) : Promise.resolve(out);
    },
  };
  return { store: createPresentationTranscriptRegenerationStore(database), calls };
}
const duplicate = () => Object.assign(new Error('dup'), { code: '23505' });
const ENQUEUE = { requestId: REQ, transcriptArtifactId: ART, transcriptFingerprint: FP, actorProfileId: 7, actingUserSystemId: ACTOR };

describe('enqueue (latest publish wins)', () => {
  test('upserts the single pending row, replacing artifact, fingerprint, actors and attempts', async () => {
    const { store, calls } = harness();
    await store.enqueuePresentationTranscriptRegeneration(ENQUEUE);
    expect(calls).toHaveLength(1);
    const { text, params } = calls[0];
    expect(text).toContain("ON CONFLICT (request_id) WHERE state = 'pending' DO UPDATE");
    expect(text).toContain('transcript_artifact_id = EXCLUDED.transcript_artifact_id');
    expect(text).toContain('transcript_fingerprint = EXCLUDED.transcript_fingerprint');
    expect(text).toContain('acting_user_system_id = EXCLUDED.acting_user_system_id');
    expect(text).toContain('attempts = 0');
    expect(text).not.toMatch(/state = 'running'/);
    expect(params.slice(1)).toEqual([REQ, ART, FP, 7, ACTOR]);
  });

  test.each([
    ['requestId', { requestId: 'nope' }], ['artifact id', { transcriptArtifactId: 'nope' }],
    ['acting user', { actingUserSystemId: 'nope' }], ['fingerprint', { transcriptFingerprint: 'ABC' }],
    ['profile', { actorProfileId: 0 }],
  ])('refuses a bad %s before any SQL', async (_label, patch) => {
    const { store, calls } = harness();
    await expect(store.enqueuePresentationTranscriptRegeneration({ ...ENQUEUE, ...patch })).rejects.toThrow(TypeError);
    expect(calls).toHaveLength(0);
  });
});

describe('claim', () => {
  test('claims one due pending row with SKIP LOCKED, never a request that already has a running row, and counts the attempt', async () => {
    const { store, calls } = harness(() => ({ rows: [{ id: ID, request_id: REQ, attempts: 1 }] }));
    const claim = await store.claimPresentationTranscriptRegeneration({ leaseSeconds: 330 });
    const { text, params } = calls[0];
    expect(text).toContain("p.state = 'pending'");
    expect(text).toContain('p.next_attempt_at IS NULL OR p.next_attempt_at <= NOW()');
    expect(text).toContain("NOT EXISTS (SELECT 1 FROM presentation_transcript_regenerations r WHERE r.request_id = p.request_id AND r.state = 'running')");
    expect(text).toContain('FOR UPDATE SKIP LOCKED');
    expect(text).toContain("state = 'running', attempts = g.attempts + 1");
    expect(params[1]).toBe(330);
    expect(claim.leaseToken).toBe(params[0]);
    expect(claim.row.id).toBe(ID);
  });

  test('returns null when nothing is due', async () => {
    const { store } = harness(() => ({ rows: [] }));
    expect(await store.claimPresentationTranscriptRegeneration({ leaseSeconds: 330 })).toBeNull();
  });

  test('refuses a non-positive lease', async () => {
    const { store } = harness();
    await expect(store.claimPresentationTranscriptRegeneration({ leaseSeconds: 0 })).rejects.toThrow(TypeError);
  });
});

describe('outcome transitions are fenced and from-state guarded', () => {
  test('done', async () => {
    const { store, calls } = harness();
    await store.markPresentationTranscriptRegenerationDone({ id: ID, leaseToken: TOKEN });
    expect(calls[0].text).toContain("SET state = 'done'");
    expect(calls[0].text).toContain('lease_token = $2 AND lease_expires_at > NOW()');
    expect(calls[0].text).toContain("state = 'running'");
    expect(calls[0].params).toEqual([ID, TOKEN]);
  });

  test('superseded carries the code and is fenced', async () => {
    const { store, calls } = harness();
    await store.supersedePresentationTranscriptRegeneration({ id: ID, leaseToken: TOKEN, failureCode: 'meeting_transcript_current_changed' });
    expect(calls[0].text).toContain("SET state = 'superseded'");
    expect(calls[0].text).toContain('lease_expires_at > NOW()');
    expect(calls[0].params).toEqual([ID, TOKEN, 'meeting_transcript_current_changed']);
  });

  test('failed requires a snake_case code', async () => {
    const { store, calls } = harness();
    await store.failPresentationTranscriptRegeneration({ id: ID, leaseToken: TOKEN, failureCode: 'post_presentation_not_available' });
    expect(calls[0].text).toContain("SET state = 'failed'");
    for (const bad of ['Bad Code', '', 'UPPER', 'x'.repeat(81), null, undefined]) {
      await expect(store.failPresentationTranscriptRegeneration({ id: ID, leaseToken: TOKEN, failureCode: bad })).rejects.toThrow(TypeError);
    }
    await expect(store.supersedePresentationTranscriptRegeneration({ id: ID, leaseToken: TOKEN, failureCode: 'Bad' })).rejects.toThrow(TypeError);
    expect(calls).toHaveLength(1);
  });
});

describe('retry', () => {
  test('below the cap, requeues pending with a 1/5/15 minute backoff keyed on attempts and no lease', async () => {
    const { store, calls } = harness((text) => (text.includes("SET state = 'failed'") ? { rows: [] } : { rows: [{ id: ID }] }));
    const outcome = await store.retryPresentationTranscriptRegeneration({ id: ID, leaseToken: TOKEN, failureCode: 'graph_unavailable' });
    expect(outcome).toEqual({ state: 'pending' });
    const requeue = calls.find(c => c.text.includes("SET state = 'pending'"));
    expect(requeue.text).toContain("WHEN attempts <= 1 THEN INTERVAL '1 minute' WHEN attempts = 2 THEN INTERVAL '5 minutes'");
    expect(requeue.text).toContain('lease_token = NULL');
    expect(requeue.text).toContain('attempts < $3');
    expect(requeue.params).toEqual([ID, TOKEN, REGENERATION_MAX_ATTEMPTS]);
  });

  test('at the cap, fails with the last code instead of requeueing', async () => {
    const { store, calls } = harness(() => ({ rows: [{ id: ID }] }));
    const outcome = await store.retryPresentationTranscriptRegeneration({ id: ID, leaseToken: TOKEN, failureCode: 'graph_unavailable' });
    expect(outcome).toEqual({ state: 'failed' });
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain("SET state = 'failed', failure_code = $3");
    expect(calls[0].text).toContain('attempts >= $4');
    expect(calls[0].params).toEqual([ID, TOKEN, 'graph_unavailable', 3]);
  });

  test('a newer pending row (unique violation) turns the retry into superseded', async () => {
    const { store, calls } = harness((text) => {
      if (text.includes("SET state = 'failed'")) return { rows: [] };
      if (text.includes("SET state = 'pending'")) return duplicate();
      return { rows: [{ id: ID }] };
    });
    const outcome = await store.retryPresentationTranscriptRegeneration({ id: ID, leaseToken: TOKEN, failureCode: 'graph_unavailable' });
    expect(outcome).toEqual({ state: 'superseded' });
    expect(calls[2].text).toContain("SET state = 'superseded'");
    expect(calls[2].params[2]).toBe('presentation_transcript_regeneration_replaced');
  });

  test('a lost lease returns null', async () => {
    const { store } = harness(() => ({ rows: [] }));
    expect(await store.retryPresentationTranscriptRegeneration({ id: ID, leaseToken: TOKEN, failureCode: 'graph_unavailable' })).toBeNull();
  });

  test('a non-unique database error propagates', async () => {
    const { store } = harness((text) => (text.includes("SET state = 'pending'") ? new Error('boom') : { rows: [] }));
    await expect(store.retryPresentationTranscriptRegeneration({ id: ID, leaseToken: TOKEN, failureCode: 'x' })).rejects.toThrow('boom');
  });
});

describe('lease reclaim', () => {
  test('selects only running rows whose lease expired', async () => {
    const { store, calls } = harness(() => ({ rows: [] }));
    expect(await store.recoverExpiredPresentationTranscriptRegenerations()).toBe(0);
    expect(calls[0].text).toContain("state = 'running' AND lease_expires_at <= NOW()");
  });

  test('an expired row under the cap goes back to pending; at the cap it fails with the lease-expired code', async () => {
    const { store, calls } = harness((text) => (/^SELECT/.test(text)
      ? { rows: [{ id: ID, attempts: 1 }, { id: '66666666-6666-4666-8666-666666666666', attempts: REGENERATION_MAX_ATTEMPTS }] }
      : { rows: [{ id: ID }], rowCount: 1 }));
    expect(await store.recoverExpiredPresentationTranscriptRegenerations()).toBe(2);
    expect(calls[1].text).toContain("SET state = 'pending'");
    expect(calls[1].text).toContain("lease_expires_at <= NOW()");
    expect(calls[2].text).toContain("SET state = 'failed', failure_code = 'presentation_transcript_regeneration_lease_expired'");
  });

  test('a newer pending row supersedes the expired one', async () => {
    const { store, calls } = harness((text) => {
      if (/^SELECT/.test(text)) return { rows: [{ id: ID, attempts: 1 }] };
      if (text.includes("SET state = 'pending'")) return duplicate();
      return { rows: [{ id: ID }], rowCount: 1 };
    });
    expect(await store.recoverExpiredPresentationTranscriptRegenerations()).toBe(1);
    expect(calls[2].text).toContain("SET state = 'superseded'");
  });
});

describe('active read', () => {
  test('returns only pending or running artifact ids for the request', async () => {
    const { store, calls } = harness(() => ({ rows: [{ transcript_artifact_id: ART }] }));
    expect(await store.listActivePresentationTranscriptRegenerations({ requestId: REQ })).toEqual([{ transcript_artifact_id: ART }]);
    expect(calls[0].text).toContain("state IN ('pending', 'running')");
    expect(calls[0].text).not.toMatch(/lease_token|acting_user/);
    expect(calls[0].params).toEqual([REQ]);
  });
});
