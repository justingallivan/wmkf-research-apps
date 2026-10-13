/**
 * Staff discussion sentiment: service, store and quote check (plan §4.4, §7). The real store runs over a
 * small in-memory Postgres stand-in (below) that applies the same row rules the SQL states, including
 * the `status = 'generating'` compare-and-set, so the fence tests fail if the SQL clause is removed.
 * The SQL itself is not run against Postgres (no Postgres harness exists for this store; named gap).
 *
 * @jest-environment node
 */
jest.mock('../../lib/services/portal-upload-staging.js', () => ({
  PORTAL_UPLOAD_SCOPES: { POST_PRESENTATION_TRANSCRIPT: 'post_presentation_transcript' },
  createPortalUpload: jest.fn(), recordPortalUploadCandidate: jest.fn(), renewPortalUploadLease: jest.fn(),
  staffActorBinding: jest.fn((id) => `profile:${id}`),
}));
jest.mock('../../lib/services/post-presentation-materials/transcript-summary-service.js', () => ({
  TRANSCRIPT_SUMMARY_DEPENDENCIES: {},
  assertEnabled: jest.fn(),
  bindCurrent: jest.fn(),
  loadVerifiedDiscussionTranscript: jest.fn(),
}));
jest.mock('@vercel/postgres', () => {
  const rows = [];
  const flags = { abandoned: new Set() };
  const clone = (row) => (row ? { ...row } : row);
  const find = (id) => rows.find((row) => row.id === id);
  const sqlText = (strings) => strings.join('?').replace(/\s+/g, ' ');
  const sql = jest.fn(async (strings, ...values) => {
    const text = sqlText(strings);
    if (/^ INSERT INTO staff_discussion_sentiments/.test(text) || /^INSERT INTO staff_discussion_sentiments/.test(text.trim())) {
      const [id, request_id, source_artifact_id, source_content_hash, prompt_name, failure_code, requested_by_profile_id] = values;
      const row = { id, request_id, source_artifact_id, source_content_hash, prompt_name, prompt_version: null, model: null,
        status: 'failed', failure_code, record: null, requested_by_profile_id, accepted_at: null, accepted_by_profile_id: null,
        withdrawn_at: null, withdrawn_by_profile_id: null, completed_at: new Date(), created_at: new Date() };
      rows.push(row);
      return { rows: [clone(row)] };
    }
    if (/SET status = 'ready'/.test(text)) {
      const [record, prompt_name, prompt_version, model, id] = values;
      const row = find(id);
      const cas = /WHERE id = \? AND status = 'generating'/.test(text);
      if (!row || (cas && row.status !== 'generating')) return { rows: [] };
      Object.assign(row, { status: 'ready', record: JSON.parse(record), prompt_name, prompt_version, model, completed_at: new Date() });
      return { rows: [clone(row)] };
    }
    if (/SET status = 'failed'/.test(text)) {
      const [failure_code, id] = values;
      const row = find(id);
      const cas = /WHERE id = \? AND status = 'generating'/.test(text);
      if (!row || (cas && row.status !== 'generating')) return { rows: [] };
      Object.assign(row, { status: 'failed', failure_code, record: row.status === 'ready' ? null : row.record, completed_at: new Date() });
      return { rows: [clone(row)] };
    }
    if (/SET withdrawn_by_profile_id/.test(text)) {
      const [profileId, id, requestId] = values;
      const row = find(id);
      if (!row || row.request_id !== requestId || !row.accepted_at || row.withdrawn_at) return { rows: [] };
      Object.assign(row, { withdrawn_by_profile_id: profileId, withdrawn_at: new Date() });
      return { rows: [clone(row)] };
    }
    if (/WHERE id = \? AND request_id = \?/.test(text)) {
      const row = find(values[0]);
      return { rows: row && row.request_id === values[1] ? [clone(row)] : [] };
    }
    if (/accepted_at IS NOT NULL AND withdrawn_at IS NULL/.test(text)) {
      return { rows: rows.filter((row) => row.request_id === values[0] && row.accepted_at && !row.withdrawn_at).map(clone).slice(0, 1) };
    }
    if (/ORDER BY created_at DESC/.test(text)) {
      return { rows: rows.filter((row) => row.request_id === values[0]).map(clone).slice(-1) };
    }
    throw new Error(`unhandled sql: ${text}`);
  });
  const client = () => {
    let snapshot = null;
    return {
      release: jest.fn(),
      query: jest.fn(async (rawText, params = []) => {
        const text = rawText.replace(/\s+/g, ' ').trim();
        if (text === 'BEGIN') { snapshot = rows.map(clone); return { rows: [] }; }
        if (text === 'COMMIT') { snapshot = null; return { rows: [] }; }
        if (text === 'ROLLBACK') { if (snapshot) { rows.splice(0, rows.length, ...snapshot); snapshot = null; } return { rows: [] }; }
        if (/pg_advisory_xact_lock/.test(text)) return { rows: [] };
        if (/status = 'generating' FOR UPDATE/.test(text)) {
          return { rows: rows.filter((row) => row.request_id === params[0] && row.status === 'generating')
            .map((row) => ({ id: row.id, abandoned: flags.abandoned.has(row.id) })) };
        }
        if (/sentiment_run_abandoned/.test(text)) {
          const row = find(params[0]);
          if (row && row.status === 'generating') Object.assign(row, { status: 'failed', failure_code: 'sentiment_run_abandoned' });
          return { rows: [] };
        }
        if (/^INSERT INTO/.test(text)) {
          const [id, request_id, source_artifact_id, source_content_hash, prompt_name, requested_by_profile_id] = params;
          const row = { id, request_id, source_artifact_id, source_content_hash, prompt_name, prompt_version: null, model: null,
            status: 'generating', failure_code: null, record: null, requested_by_profile_id, accepted_at: null,
            accepted_by_profile_id: null, withdrawn_at: null, withdrawn_by_profile_id: null, completed_at: null, created_at: new Date() };
          rows.push(row);
          return { rows: [clone(row)] };
        }
        if (/^SELECT id FROM staff_discussion_sentiments WHERE id = \$1/.test(text)) {
          const [id, requestId, artifact, hash, version] = params;
          const row = find(id);
          const ok = row && row.request_id === requestId && row.status === 'ready' && !row.accepted_at
            && row.source_artifact_id === artifact && row.source_content_hash === hash && row.prompt_version === version;
          return { rows: ok ? [{ id }] : [] };
        }
        if (/SET withdrawn_by_profile_id = \$2, withdrawn_at = NOW\(\) WHERE request_id = \$1/.test(text)) {
          rows.filter((row) => row.request_id === params[0] && row.accepted_at && !row.withdrawn_at)
            .forEach((row) => Object.assign(row, { withdrawn_by_profile_id: params[1], withdrawn_at: new Date() }));
          return { rows: [] };
        }
        if (/SET accepted_by_profile_id/.test(text)) {
          const row = find(params[0]);
          if (rows.some((other) => other.request_id === row.request_id && other.accepted_at && !other.withdrawn_at)) {
            throw new Error('duplicate key value violates unique constraint idx_staff_discussion_sentiments_accepted');
          }
          Object.assign(row, { accepted_by_profile_id: params[1], accepted_at: new Date() });
          return { rows: [clone(row)] };
        }
        throw new Error(`unhandled client sql: ${text}`);
      }),
    };
  };
  return { sql, db: { connect: jest.fn(async () => client()) }, __rows: rows, __flags: flags };
});

import * as pg from '@vercel/postgres';
import * as summaryService from '../../lib/services/post-presentation-materials/transcript-summary-service.js';
import * as store from '../../lib/services/post-presentation-materials/discussion-sentiment-store.js';
import {
  analyzeDiscussionSentiment, acceptDiscussionSentiment, withdrawDiscussionSentiment, validateSentimentOutput,
  rebuildTurns, attachSpeakers, isRunCurrent,
} from '../../lib/services/post-presentation-materials/discussion-sentiment-service.js';
import { formatTranscriptText } from '../../lib/services/transcription-pilot/transcript-format.js';
import { PROMPT_NAME } from '../../shared/config/prompts/meeting-staff-discussion-sentiment.js';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const ARTIFACT_ID = '22222222-2222-4222-8222-222222222222';
const HASH = 'a'.repeat(64);
const ACTOR = '77777777-7777-4777-8777-777777777777';
const SPEAKER_NAMES = { A: 'Dr. Lee', B: 'Pat Kim', C: 'Smith: Jr.' };
// Built with the real formatter, as the TXT producer does. Covers a mapped name, an unmapped id, an
// excluded (unidentifiedSpeaker) turn, speaker-null turns (one whose text starts with a name), a start of
// an hour or more (H:MM:SS), a name containing ": ", and two speakers' turns in the same second.
const utt = (speaker, start, text, extra = {}) => ({ speaker, start, end: start + 1000, text, ...extra });
const CONTENT = { text: '', utterances: [
  utt('A', 3000, 'This team is excellent and I am excited about it.'),
  utt('B', 10000, 'I worry the budget is far too large for the plan.'),
  utt('3', 20000, 'Not sure the timeline works at all.'),
  utt('A', 30000, 'I would fund it tomorrow.', { unidentifiedSpeaker: true }),
  utt(null, 40000, 'Plain remark without any label.'),
  utt(null, 50000, 'Pat Kim: I think the budget is fine really.'),
  utt('C', 3725000, 'Honestly the review panel will love this.'),
  utt('B', 4000000, 'Same second remark from Pat.'),
  utt('A', 4000500, 'Same second remark from Lee.'),
] };
const TRANSCRIPT = formatTranscriptText(CONTENT, SPEAKER_NAMES, { layout: 'turn' });

const ev = (time, quote) => ({ time, quote });
const goodRecord = (overrides = {}) => ({
  schemaVersion: 1, enthusiasm: 'moderate', reception: 'mixed', headline: 'Staff liked the team but doubted the budget.',
  supportPoints: [ev('00:03', 'This team is excellent')],
  concernPoints: [ev('00:10', 'budget is far too large')],
  disagreements: [], uncertainties: [], ...overrides,
});

let nextId; let promptVersion; let deps; let execute; let loaded;
const ids = () => `00000000-0000-4000-8000-${String(++nextId).padStart(12, '0')}`;
const rows = () => pg.__rows;
const row = (id) => rows().find((r) => r.id === id);

beforeEach(() => {
  rows().length = 0; pg.__flags.abandoned.clear(); nextId = 0; promptVersion = 1;
  loaded = { discussionRow: { wmkf_requestdocumentid: ARTIFACT_ID, wmkf_contenthash: HASH }, boundary: {}, utteranceCount: 5,
    transcriptText: TRANSCRIPT, speakerNames: SPEAKER_NAMES, discussionContent: CONTENT };
  summaryService.assertEnabled.mockReset();
  summaryService.bindCurrent.mockReset().mockImplementation(async () => ({
    discussion: { reason: 'bound', staffDiscussionTranscript: { wmkf_requestdocumentid: loaded.discussionRow.wmkf_requestdocumentid,
      wmkf_contenthash: loaded.discussionRow.wmkf_contenthash } } }));
  summaryService.loadVerifiedDiscussionTranscript.mockReset().mockImplementation(async () => loaded);
  execute = jest.fn(async () => ({ parsed: goodRecord(), meta: { promptName: PROMPT_NAME, promptVersion, modelUsed: 'claude-sonnet' } }));
  deps = {
    loadBinding: jest.fn(async () => ({ requestId: REQUEST_ID, siteVisitActivityId: 'visit' })),
    randomUUID: jest.fn(ids),
    loadModelOverrides: jest.fn(async () => {}),
    getExecutorBudget: jest.fn(async () => ({ maxTokensOverride: 16000, timeoutMsOverride: 240000 })),
    executePrompt: (...args) => execute(...args),
    fetchCurrentPrompt: jest.fn(async () => ({ wmkf_promptversion: promptVersion })),
    sentiments: store,
  };
});

const analyze = () => analyzeDiscussionSentiment({ requestId: REQUEST_ID, ownerProfileId: 12, actingUserSystemId: ACTOR }, deps);

describe('analysis run', () => {
  test('a named turn saves the name and both retention flags are passed by the service', async () => {
    const { run } = await analyze();
    expect(run).toMatchObject({ status: 'ready', promptVersion: 1 });
    expect(run.record.supportPoints[0]).toEqual({ time: '00:03', quote: 'This team is excellent', speakerLabel: 'Dr. Lee', speaker: 'Dr. Lee' });
    expect(run.record.concernPoints[0]).toMatchObject({ speakerLabel: 'Pat Kim', speaker: 'Pat Kim' });
    const call = execute.mock.calls[0][0];
    expect(call).toMatchObject({ promptName: PROMPT_NAME, requireNoPersistence: true, auditRetention: 'content-free',
      overrideVariables: { discussion_transcript: TRANSCRIPT }, actingUserSystemId: ACTOR });
    expect(row(run.id)).toMatchObject({ requested_by_profile_id: 12, source_artifact_id: ARTIFACT_ID, source_content_hash: HASH, model: 'claude-sonnet' });
  });

  test.each([
    ['numbered', '00:20', 'Not sure the timeline works', 'Speaker 3', null],
    ['excluded', '00:30', 'would fund it tomorrow', 'Unidentified speaker', null],
    ['label-free', '00:40', 'Plain remark without any label', null, null],
    ['unlabeled turn whose text begins with a name', '00:50', 'Pat Kim: I think the budget is fine', null, null],
    ['unlabeled turn quoted without the name', '00:50', 'I think the budget is fine', null, null],
  ])('a %s turn is saved with speaker null', async (_name, time, quote, label, speaker) => {
    execute.mockResolvedValueOnce({ parsed: goodRecord({ supportPoints: [ev(time, quote)] }), meta: { promptVersion: 1 } });
    const { run } = await analyze();
    expect(run.record.supportPoints[0]).toMatchObject({ speakerLabel: label, speaker });
  });

  test('the model cannot set the speaker: an extra speaker key rejects the record', async () => {
    execute.mockResolvedValueOnce({ parsed: goodRecord({ supportPoints: [{ ...ev('00:03', 'This team is excellent'), speaker: 'Pat Kim' }] }),
      meta: { promptVersion: 1 } });
    await expect(analyze()).rejects.toMatchObject({ code: 'sentiment_output_invalid' });
  });

  test('a quote that is not in the transcript is rejected and nothing is saved', async () => {
    execute.mockResolvedValueOnce({ parsed: goodRecord({ supportPoints: [ev('00:03', 'This team is mediocre')] }), meta: { promptVersion: 1 } });
    await expect(analyze()).rejects.toMatchObject({ httpStatus: 502, code: 'sentiment_evidence_unverified' });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ status: 'failed', failure_code: 'sentiment_evidence_unverified', record: null });
  });

  test('a quote whose time matches a different turn is rejected', async () => {
    execute.mockResolvedValueOnce({ parsed: goodRecord({ supportPoints: [ev('00:10', 'This team is excellent')] }), meta: { promptVersion: 1 } });
    await expect(analyze()).rejects.toMatchObject({ code: 'sentiment_evidence_unverified' });
    expect(rows()[0].record).toBeNull();
  });

  test('a quote found in two turns that share the time is ambiguous and rejected', async () => {
    const content = { text: '', utterances: [utt('A', 3000, 'Same words here for both.'), utt('B', 3400, 'Same words here for both.')] };
    loaded = { ...loaded, discussionContent: content, transcriptText: formatTranscriptText(content, SPEAKER_NAMES, { layout: 'turn' }) };
    execute.mockResolvedValueOnce({ parsed: goodRecord({ supportPoints: [ev('00:03', 'Same words here for both')], concernPoints: [] }), meta: { promptVersion: 1 } });
    await expect(analyze()).rejects.toMatchObject({ code: 'sentiment_evidence_unverified' });
  });

  test('two speakers in the same second with different text are each attributed correctly', async () => {
    execute.mockResolvedValueOnce({ parsed: goodRecord({ supportPoints: [ev('1:06:40', 'Same second remark from Pat')],
      concernPoints: [ev('1:06:40', 'Same second remark from Lee')] }), meta: { promptVersion: 1 } });
    const { run } = await analyze();
    expect(run.record.supportPoints[0]).toMatchObject({ speaker: 'Pat Kim' });
    expect(run.record.concernPoints[0]).toMatchObject({ speaker: 'Dr. Lee' });
  });

  test('an hour-plus turn uses the H:MM:SS time and a name containing a colon is kept whole', async () => {
    execute.mockResolvedValueOnce({ parsed: goodRecord({ supportPoints: [ev('1:02:05', 'the review panel will love this')], concernPoints: [] }), meta: { promptVersion: 1 } });
    const { run } = await analyze();
    expect(run.record.supportPoints[0]).toEqual({ time: '1:02:05', quote: 'the review panel will love this', speakerLabel: 'Smith: Jr.', speaker: 'Smith: Jr.' });
  });

  test('a TXT that the source content does not reproduce is refused before any run row or provider call', async () => {
    loaded = { ...loaded, transcriptText: `${TRANSCRIPT}[99:00] Pat Kim: A line the source never held.\n` };
    await expect(analyze()).rejects.toMatchObject({ httpStatus: 409, code: 'sentiment_transcript_mismatch' });
    expect(execute).not.toHaveBeenCalled();
    expect(rows()).toHaveLength(0);
  });

  test('a quote shorter than 12 characters is rejected by the shape check', async () => {
    execute.mockResolvedValueOnce({ parsed: goodRecord({ supportPoints: [ev('00:03', 'excellent')] }), meta: { promptVersion: 1 } });
    await expect(analyze()).rejects.toMatchObject({ code: 'sentiment_output_invalid' });
  });

  test('whitespace is normalized when matching a quote', async () => {
    execute.mockResolvedValueOnce({ parsed: goodRecord({ supportPoints: [ev('00:03', 'This   team\nis excellent')] }), meta: { promptVersion: 1 } });
    await expect(analyze()).resolves.toMatchObject({ run: { status: 'ready' } });
  });

  const dis = (sides) => [{ topic: 'Budget', sides }];
  test.each([
    ['a bad enum', { enthusiasm: 'huge' }],
    ['a wrong schema version', { schemaVersion: 2 }],
    ['a one-sided disagreement', { disagreements: dis([ev('00:10', 'budget is far too large')]) }],
    ['an empty quote', { supportPoints: [ev('00:03', '  ')] }],
    ['an extra top-level key', { extra: 1 }],
    ['an uncertainty with no evidence', { uncertainties: [{ topic: 'Timeline', evidence: [] }] }],
    ['a non-time turn stamp', { supportPoints: [ev('soon', 'This team is excellent')] }],
    ['too many points', { supportPoints: Array.from({ length: 9 }, () => ev('00:03', 'This team is excellent')) }],
    ['a strong rating with no evidence', { enthusiasm: 'high', supportPoints: [], concernPoints: [] }],
  ])('valid JSON with %s is rejected before the quote check', async (_name, overrides) => {
    // Every quote in this record is real, so only the shape check can be what rejects it.
    execute.mockResolvedValueOnce({ parsed: goodRecord(overrides), meta: { promptVersion: 1 } });
    await expect(analyze()).rejects.toMatchObject({ httpStatus: 502, code: 'sentiment_output_invalid' });
    expect(rows()[0]).toMatchObject({ status: 'failed', failure_code: 'sentiment_output_invalid', record: null });
  });

  test('disagreements and uncertainties get server-derived speakers too', async () => {
    execute.mockResolvedValueOnce({ parsed: goodRecord({
      disagreements: dis([ev('00:10', 'budget is far too large'), ev('00:30', 'fund it tomorrow')]),
      uncertainties: [{ topic: 'Timeline', evidence: [ev('00:20', 'Not sure the timeline works')] }] }), meta: { promptVersion: 1 } });
    const { run } = await analyze();
    expect(run.record.disagreements[0].sides.map((s) => s.speaker)).toEqual(['Pat Kim', null]);
    expect(run.record.uncertainties[0].evidence[0]).toMatchObject({ speakerLabel: 'Speaker 3', speaker: null });
  });

  test('an empty discussion records a failed row, makes no provider call and returns 422', async () => {
    loaded = { ...loaded, utteranceCount: 0, transcriptText: null };
    await expect(analyze()).rejects.toMatchObject({ httpStatus: 422, code: 'staff_discussion_not_recorded' });
    expect(execute).not.toHaveBeenCalled();
    expect(rows()[0]).toMatchObject({ status: 'failed', failure_code: 'staff_discussion_not_recorded', requested_by_profile_id: 12 });
  });

  test('a live generating run blocks a second analysis before any provider call', async () => {
    rows().push({ id: 'live', request_id: REQUEST_ID, status: 'generating', created_at: new Date() });
    await expect(analyze()).rejects.toMatchObject({ httpStatus: 409, code: 'sentiment_analysis_in_progress' });
    expect(execute).not.toHaveBeenCalled();
  });

  test('a provider failure marks the run failed with a content-free code', async () => {
    execute.mockRejectedValueOnce(Object.assign(new Error('secret transcript text'), { code: 'claude_output_refused' }));
    await expect(analyze()).rejects.toMatchObject({ httpStatus: 422, code: 'sentiment_claude_output_refused' });
    expect(rows()[0]).toMatchObject({ status: 'failed', failure_code: 'claude_output_refused' });
    expect(JSON.stringify(rows()[0])).not.toContain('secret transcript text');
  });
});

describe('terminal-write fence', () => {
  // Run A reaches the provider call and waits; it is then abandoned and replaced by run B.
  function twoRuns() {
    const gates = [];
    execute.mockImplementation(() => new Promise((resolve, reject) => gates.push({ resolve, reject })));
    return gates;
  }
  const tick = () => new Promise((resolve) => setImmediate(resolve));

  test('an abandoned run finishing after its replacement does not change either row', async () => {
    const gates = twoRuns();
    const a = analyze().catch((error) => error);
    await tick();
    const [idA] = rows().map((r) => r.id);
    pg.__flags.abandoned.add(idA);
    const b = analyze();
    await tick();
    const idB = rows()[1].id;
    expect(row(idA)).toMatchObject({ status: 'failed', failure_code: 'sentiment_run_abandoned' });
    gates[0].resolve({ parsed: goodRecord(), meta: { promptVersion: 1 } });
    await expect(a).resolves.toMatchObject({ code: 'sentiment_run_superseded', httpStatus: 409 });
    expect(row(idA)).toMatchObject({ status: 'failed', failure_code: 'sentiment_run_abandoned', record: null });
    expect(row(idB)).toMatchObject({ status: 'generating', record: null });
    gates[1].resolve({ parsed: goodRecord(), meta: { promptVersion: 1 } });
    await expect(b).resolves.toMatchObject({ run: { id: idB, status: 'ready' } });
  });

  test('an abandoned run failing late does not change the replacement', async () => {
    const gates = twoRuns();
    const a = analyze().catch((error) => error);
    await tick();
    pg.__flags.abandoned.add(rows()[0].id);
    const b = analyze();
    await tick();
    gates[0].reject(Object.assign(new Error('late'), { code: 'claude_output_refused' }));
    await expect(a).resolves.toMatchObject({ code: 'sentiment_run_superseded' });
    expect(rows()[0]).toMatchObject({ failure_code: 'sentiment_run_abandoned' });
    expect(rows()[1]).toMatchObject({ status: 'generating', failure_code: null });
    gates[1].resolve({ parsed: goodRecord(), meta: { promptVersion: 1 } });
    await b;
  });

  test('store level: a late failure after success, and a late completion after failure, change nothing', async () => {
    const reserved = await store.reserveRun({ id: 'run-1', requestId: REQUEST_ID, sourceArtifactId: ARTIFACT_ID, sourceContentHash: HASH, promptName: PROMPT_NAME, profileId: 12 });
    expect(reserved.run.id).toBe('run-1');
    const done = await store.completeRun({ id: 'run-1', record: goodRecord(), promptName: PROMPT_NAME, promptVersion: 1, model: 'm' });
    expect(done.status).toBe('ready');
    await expect(store.failRun({ id: 'run-1', failureCode: 'late' })).resolves.toBeNull();
    expect(row('run-1')).toMatchObject({ status: 'ready', failure_code: null, record: goodRecord() });
    await store.recordFailedRun({ id: 'run-2', requestId: REQUEST_ID, sourceArtifactId: ARTIFACT_ID, sourceContentHash: HASH, promptName: PROMPT_NAME, profileId: 12, failureCode: 'x' });
    await expect(store.completeRun({ id: 'run-2', record: goodRecord(), promptName: PROMPT_NAME, promptVersion: 1 })).resolves.toBeNull();
    expect(row('run-2')).toMatchObject({ status: 'failed', record: null });
  });
});

describe('currentness, accept and withdraw', () => {
  const current = { sourceArtifactId: ARTIFACT_ID, sourceContentHash: HASH, promptVersion: 1 };
  const accept = (runId) => acceptDiscussionSentiment({ requestId: REQUEST_ID, ownerProfileId: 12, runId }, deps);
  const withdraw = (runId) => withdrawDiscussionSentiment({ requestId: REQUEST_ID, ownerProfileId: 13, runId }, deps);

  test('isRunCurrent: an older content hash, another artifact or another prompt version is out of date', () => {
    const run = { source_artifact_id: ARTIFACT_ID, source_content_hash: HASH, prompt_version: 1 };
    expect(isRunCurrent(run, current)).toBe(true);
    expect(isRunCurrent({ ...run, source_content_hash: 'b'.repeat(64) }, current)).toBe(false);
    expect(isRunCurrent({ ...run, source_artifact_id: '33333333-3333-4333-8333-333333333333' }, current)).toBe(false);
    expect(isRunCurrent(run, { ...current, promptVersion: 2 })).toBe(false);
    expect(isRunCurrent(run, { ...current, sourceArtifactId: null })).toBe(false);
  });

  test('a prompt version bump makes the row out of date and accept is refused with the row unchanged', async () => {
    const { run } = await analyze();
    promptVersion = 2;
    await expect(accept(run.id)).rejects.toMatchObject({ httpStatus: 409, code: 'sentiment_out_of_date' });
    expect(row(run.id).accepted_at).toBeNull();
  });

  test('a transcript republish makes the row out of date for accept', async () => {
    const { run } = await analyze();
    loaded.discussionRow = { ...loaded.discussionRow, wmkf_contenthash: 'c'.repeat(64) };
    await expect(accept(run.id)).rejects.toMatchObject({ code: 'sentiment_out_of_date' });
  });

  test('accept on a current ready row records the actor; a generating or failed row is not accepted', async () => {
    const { run } = await analyze();
    const accepted = await accept(run.id);
    expect(accepted.run.acceptedAt).toBeTruthy();
    expect(row(run.id)).toMatchObject({ accepted_by_profile_id: 12, withdrawn_at: null });
    rows().push({ id: 'g', request_id: REQUEST_ID, status: 'generating' });
    await expect(accept('g')).rejects.toMatchObject({ code: 'sentiment_not_found' });
    const failedId = '44444444-4444-4444-8444-444444444444';
    rows().push({ id: failedId, request_id: REQUEST_ID, status: 'failed' });
    await expect(accept(failedId)).rejects.toMatchObject({ code: 'sentiment_not_ready' });
  });

  test('accepting a newer run withdraws the previous accepted run, recording the actor, in one step', async () => {
    const first = (await analyze()).run;
    await accept(first.id);
    const second = (await analyze()).run;
    await accept(second.id);
    expect(row(first.id)).toMatchObject({ withdrawn_by_profile_id: 12 });
    expect(row(first.id).withdrawn_at).toBeTruthy();
    expect(row(second.id).withdrawn_at).toBeNull();
    expect(rows().filter((r) => r.accepted_at && !r.withdrawn_at)).toHaveLength(1);
    await expect(store.getAcceptedRun({ requestId: REQUEST_ID })).resolves.toMatchObject({ id: second.id });
  });

  test('withdraw never falls back to an older accepted row', async () => {
    const first = (await analyze()).run;
    await accept(first.id);
    const second = (await analyze()).run;
    await accept(second.id);
    await withdraw(second.id);
    expect(row(second.id)).toMatchObject({ withdrawn_by_profile_id: 13 });
    await expect(store.getAcceptedRun({ requestId: REQUEST_ID })).resolves.toBeNull();
    await expect(withdraw(second.id)).rejects.toMatchObject({ code: 'sentiment_not_accepted' });
    await expect(withdraw(first.id)).rejects.toMatchObject({ code: 'sentiment_not_accepted' });
  });

  test('a withdrawn row cannot be accepted again', async () => {
    const { run } = await analyze();
    await accept(run.id);
    await withdraw(run.id);
    await expect(accept(run.id)).rejects.toMatchObject({ code: 'sentiment_not_acceptable' });
  });

  test('a failed re-analysis leaves the accepted row unchanged', async () => {
    const { run } = await analyze();
    await accept(run.id);
    execute.mockRejectedValueOnce(new Error('provider down'));
    await expect(analyze()).rejects.toMatchObject({ code: 'sentiment_generation_failed' });
    await expect(store.getAcceptedRun({ requestId: REQUEST_ID })).resolves.toMatchObject({ id: run.id, status: 'ready' });
  });

  test('the SQL fence in accept also refuses stale expected values', async () => {
    const { run } = await analyze();
    await expect(store.acceptRun({ id: run.id, requestId: REQUEST_ID, profileId: 12, expected: { ...current, promptVersion: 9 } })).resolves.toBeNull();
    expect(row(run.id).accepted_at).toBeNull();
  });
});

describe('preconditions and reads', () => {
  test('analyze runs the shared preconditions with the request, profile and Dataverse actor', async () => {
    await analyze();
    expect(summaryService.assertEnabled).toHaveBeenCalledTimes(1);
    expect(summaryService.assertEnabled).toHaveBeenCalledWith(REQUEST_ID, 12, ACTOR, deps);
  });

  test('accept and withdraw run the preconditions without requiring a Dataverse actor', async () => {
    const { run } = await analyze();
    summaryService.assertEnabled.mockClear();
    await acceptDiscussionSentiment({ requestId: REQUEST_ID, ownerProfileId: 12, runId: run.id }, deps);
    expect(summaryService.assertEnabled).toHaveBeenLastCalledWith(REQUEST_ID, 12, null, deps, { needsActor: false });
    summaryService.assertEnabled.mockClear();
    await withdrawDiscussionSentiment({ requestId: REQUEST_ID, ownerProfileId: 12, runId: run.id }, deps);
    expect(summaryService.assertEnabled).toHaveBeenLastCalledWith(REQUEST_ID, 12, null, deps, { needsActor: false });
  });

  test('a refused precondition stops analyze before any read, run row or provider call', async () => {
    summaryService.assertEnabled.mockImplementationOnce(() => { throw Object.assign(new Error('off'), { code: 'post_presentation_not_available' }); });
    await expect(analyze()).rejects.toMatchObject({ code: 'post_presentation_not_available' });
    expect(deps.loadBinding).not.toHaveBeenCalled();
    expect(rows()).toHaveLength(0);
    expect(execute).not.toHaveBeenCalled();
  });

  test('getLatestCurrentReadyRun returns the newest ready row for the exact source and prompt version', async () => {
    const mk = (id, over) => ({ id, request_id: REQUEST_ID, status: 'ready', source_artifact_id: ARTIFACT_ID, source_content_hash: HASH,
      prompt_version: 1, completed_at: new Date('2026-10-13T10:00:00Z'), ...over });
    // The stand-in does not evaluate this query's ORDER BY; this pins the statement text and parameters.
    pg.sql.mockClear();
    pg.sql.mockImplementationOnce(async () => ({ rows: [mk('r-new')] }));
    const got = await store.getLatestCurrentReadyRun({ requestId: REQUEST_ID, sourceArtifactId: ARTIFACT_ID, sourceContentHash: HASH, promptVersion: 1 });
    expect(got.id).toBe('r-new');
    const [strings, ...values] = pg.sql.mock.calls[0];
    const text = strings.join('?').replace(/\s+/g, ' ');
    expect(text).toMatch(/status = 'ready'/);
    expect(text).toMatch(/source_artifact_id = \? AND source_content_hash = \? AND prompt_version = \?/);
    expect(text).toMatch(/ORDER BY completed_at DESC, id DESC LIMIT 1/);
    expect(values).toEqual([REQUEST_ID, ARTIFACT_ID, HASH, 1]);
  });

  test('getAcceptedRun returns the one accepted, not withdrawn row and null after withdrawal', async () => {
    const { run } = await analyze();
    await expect(store.getAcceptedRun({ requestId: REQUEST_ID })).resolves.toBeNull();
    await acceptDiscussionSentiment({ requestId: REQUEST_ID, ownerProfileId: 12, runId: run.id }, deps);
    await expect(store.getAcceptedRun({ requestId: REQUEST_ID })).resolves.toMatchObject({ id: run.id });
    await withdrawDiscussionSentiment({ requestId: REQUEST_ID, ownerProfileId: 12, runId: run.id }, deps);
    await expect(store.getAcceptedRun({ requestId: REQUEST_ID })).resolves.toBeNull();
  });
});

describe('pure helpers', () => {
  test('rebuildTurns returns labels from structured data and null when the TXT is not reproduced', () => {
    const turns = rebuildTurns(CONTENT, SPEAKER_NAMES, TRANSCRIPT);
    expect(turns.map((t) => [t.time, t.label, t.named])).toEqual([
      ['00:03', 'Dr. Lee', true], ['00:10', 'Pat Kim', true], ['00:20', 'Speaker 3', false], ['00:30', 'Unidentified speaker', false],
      ['00:40', null, false], ['00:50', null, false], ['1:02:05', 'Smith: Jr.', true], ['1:06:40', 'Pat Kim', true], ['1:06:40', 'Dr. Lee', true]]);
    expect(rebuildTurns(CONTENT, SPEAKER_NAMES, `${TRANSCRIPT} `)).toBeNull();
    expect(rebuildTurns(CONTENT, { ...SPEAKER_NAMES, B: 'Someone Else' }, TRANSCRIPT)).toBeNull();
  });

  test('validateSentimentOutput returns a fresh object without unknown nested keys', () => {
    const result = validateSentimentOutput(goodRecord());
    expect(result.ok).toBe(true);
    expect(validateSentimentOutput('nope').ok).toBe(false);
  });

  test('attachSpeakers fails when any item has no unique matching turn', () => {
    const record = validateSentimentOutput(goodRecord()).value;
    const turns = rebuildTurns(CONTENT, SPEAKER_NAMES, TRANSCRIPT);
    expect(attachSpeakers(record, turns).ok).toBe(true);
    expect(attachSpeakers(record, turns.slice(1)).ok).toBe(false);
  });
});
