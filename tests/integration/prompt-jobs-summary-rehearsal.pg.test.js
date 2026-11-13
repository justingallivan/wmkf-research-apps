/** @jest-environment node */
/**
 * Offline composition rehearsal using the EXISTING synthetic capability.
 * Real Summary initialize is deliberately rejected by admission/worker/publication.
 * This does not implement its policy, intake event, marker column or filename contract.
 * Synthetic known-failure release differs from permanent real-Summary reservations;
 * prompt-jobs-summary-reservations.pg.test.js verifies that separate contract.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { createPromptJobStore } from '../../lib/services/prompt-jobs/store.js';
import { advanceJob } from '../../lib/services/prompt-jobs/worker.js';
import { createSummarySource } from '../../lib/services/prompt-jobs/summary-source.js';
import { captureSummaryBaseline, prepareSummaryStaffEdit } from '../../lib/services/prompt-jobs/summary-edit-protection.js';
import { canonical, hashProfile, sha256 } from '../../lib/services/prompt-jobs/profile.js';
import { verifyContextSnapshot } from '../../lib/services/prompt-jobs/context.js';

// Fail loudly if a default external dependency is accidentally used.
jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({ getById: () => { throw Error('Live Request forbidden'); } }));
jest.mock('../../lib/dataverse/adapters/contact.js', () => ({ getByIdWithSelect: () => { throw Error('Live Contact forbidden'); } }));
jest.mock('../../lib/utils/file-loader.js', () => ({ extractTextFromBuffer: () => { throw Error('Real extraction forbidden'); } }));
jest.mock('../../lib/utils/sharepoint-buckets.js', () => ({ getRequestSharePointBuckets: () => { throw Error('Live buckets forbidden'); } }));
jest.mock('../../lib/services/graph-service.js', () => ({ GraphService: {
  getFileMetadataByPath: () => { throw Error('Live Graph forbidden'); },
  downloadFile: () => { throw Error('Live download forbidden'); },
} }));

const url = process.env.SUMMARY_REHEARSAL_PG_TEST_URL || '';
if (!url && process.env.SUMMARY_REHEARSAL_PG_TEST_REQUIRE === '1') throw Error('Explicit rehearsal database required');
if (url) {
  const u = new URL(url);
  if (!['postgres:', 'postgresql:'].includes(u.protocol) || u.hostname !== '127.0.0.1'
    || !u.port || u.pathname !== '/summary_reservations' || u.search || u.hash
    || url === process.env.POSTGRES_URL) throw Error('Dedicated loopback summary_reservations database required');
}
const suite = url ? describe : describe.skip;
const TASK = 'synthetic.executive-summary';
const FIELD = 'fixture_summary';
const TEXT = 'Synthetic narrative describing a controlled experiment.';
const OUTPUT = 'This synthetic project tests a research hypothesis.';
const SECRET = 'offline-summary-rehearsal-nonce-secret';
const profile = { key: 'proposal-analysis', revision: 1, wrapperVersion: 1,
  sharedInstructions: 'Analyze only the synthetic narrative.', documentRoles: ['proposal'], recordNames: ['pi_name'],
  limits: { maxDocuments: 1, maxDocumentBytes: 3000, maxTotalDocumentBytes: 3000, maxRecordBytes: 1000 } };

suite('offline Summary composition: real worker/ledger, synthetic capability and adapters', () => {
  let admin, pool, schema, store;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    schema = `summary_rehearsal_${randomUUID().replaceAll('-', '')}`;
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}`, max: 6 });
    await pool.query(readFileSync('lib/db/migrations/097_shared_prompt_jobs.sql', 'utf8'));
    store = createPromptJobStore(pool);
  });
  afterAll(async () => {
    try { if (pool) await pool.end(); }
    finally {
      try { if (schema) await admin.query(`DROP SCHEMA "${schema}" CASCADE`); }
      finally { if (admin) await admin.end(); }
    }
  });

  async function fixture({ text = null, staffEdited = false } = {}) {
    const requestId = randomUUID(), contactId = randomUUID();
    const scope = { environment: 'test', authorizationScope: `offline-summary:${randomUUID()}`, requestId };
    const filename = 'Project-Narrative_1003109.pdf'; // Candidate convention, not producer approval.
    let revision = 1, row = { text, staffEdited, version: 'W/"1"' };
    const files = {
      [filename]: { name: filename, siteId: 'site', driveId: 'drive', id: 'narrative', eTag: 'W/"source1"', versionId: '1' },
      'Narrative-Bibliography_1003109.pdf': { name: 'Narrative-Bibliography_1003109.pdf', id: 'combined' },
    };
    const source = createSummarySource({
      readRequest: async () => ({ akoya_requestid: requestId, akoya_requestnum: '1003109', _wmkf_projectleader_value: contactId,
        wmkf_abstract: 'EXCLUDED applicant abstract' }),
      readContact: async () => ({ contactid: contactId, fullname: 'Synthetic PI' }),
      getBuckets: async () => [{ library: 'akoya_request', folder: 'fixture', source: 'dynamics' }],
      getFileMetadataByPath: async (_library, folder, name) => {
        if (folder.endsWith('/AI Materials')) return files['Narrative-Bibliography_1003109.pdf'];
        return files[name] || null;
      },
      downloadFile: async (_drive, id) => {
        expect(id).toBe('narrative');
        return { filename, buffer: Buffer.from('%PDF-synthetic-narrative') };
      },
      extractText: async () => TEXT,
    });
    const manifest = await source.inspect({ requestId });
    const promptRow = {
      wmkf_ai_promptid: randomUUID(), wmkf_ai_promptname: TASK, wmkf_promptversion: 1,
      wmkf_ai_systemprompt: '', wmkf_ai_promptbody: 'Summarize the narrative for {{pi_name}}.',
      wmkf_ai_model: 'claude-sonnet-4-6', wmkf_ai_maxtokens: 1000, wmkf_ai_temperature: 0,
      wmkf_ai_promptvariables: JSON.stringify({ execution: { contractVersion: 1, mode: 'shared-document-task',
        profile: { key: profile.key, revision: 1, sha256: hashProfile(profile) } }, variables: [
        { name: 'proposal_context', source: { kind: 'prepared_context' }, required: true },
        { name: 'pi_name', source: { kind: 'frozen_record' }, required: true },
      ] }),
      wmkf_ai_promptoutputschema: JSON.stringify({ parseMode: 'raw', outputs: [{ name: 'summary', maxWords: 200, target: { kind: 'none' } }] }),
    };
    const command = { ...scope, principalKey: 'fixture:summary-rehearsal', idempotencyKey: randomUUID(),
      operation: 'initialize', sourceEventId: randomUUID(), sourceExpiresAt: new Date(Date.now() + 3600000),
      resultExpiresAt: new Date(Date.now() + 86400000), tasks: [{ taskKey: TASK,
        configuration: { promptRow, profile, scope, manifest, runSource: 'Vercel Test' } }] };
    const admitted = await store.admit(command);
    const jobId = admitted.job.id;
    const patch = c => {
      if (c.ifMatch !== row.version) throw Object.assign(Error('Synthetic conflict'), { status: 412 });
      row = { ...row, ...c.patch, version: `W/"${++revision}"` };
    };
    const staff = text => patch(prepareSummaryStaffEdit({ text, version: row.version }));
    const audit = jest.fn(async () => {});
    const generate = jest.fn(async () => OUTPUT);
    const executePrompt = jest.fn(async args => {
      const snapshot = verifyContextSnapshot({ ...args.profiledContext });
      expect(snapshot.documents[0].text).toBe(TEXT);
      expect(snapshot.records[0].value).toBe('Synthetic PI');
      expect(args.requireNoPersistence).toBe(true);
      if (args.responseCheckpoint) {
        expect(args.onDispatch).toBeUndefined();
        expect(args.onResponse).toBeUndefined();
        expect(args.responseCheckpoint.response.text).toBe(OUTPUT);
      } else {
        await args.onDispatch();
        const text = await generate();
        await args.onResponse({ version: 1, binding: sha256('fixture response'), response: { text } });
      }
      return { parsed: { summary: OUTPUT }, deferredAudit: {
        wmkf_ai_status: 682090000, wmkf_ai_runsource: 682090005, wmkf_ai_model: promptRow.wmkf_ai_model,
        'wmkf_ai_Prompt@odata.bind': `/wmkf_ai_prompts(${promptRow.wmkf_ai_promptid})`,
        wmkf_ai_promptversion: 1, 'wmkf_ai_Request@odata.bind': `/akoya_requests(${requestId})`,
        wmkf_ai_promptoverridden: false,
        wmkf_ai_notes: 'profiled=true; outcome=completed; code=none; stopReason=end_turn',
      } };
    });
    const writer = jest.fn(async ({ job, expectedEtag, fields }) => {
      expect(job.id).toBe(jobId);
      expect(expectedEtag).toBe(job.target_etag);
      expect(Object.keys(fields)).toEqual([FIELD]);
      patch({ ifMatch: expectedEtag, patch: { text: fields[FIELD] } });
      return 'applied';
    });
    const deps = { jobId, store, executePrompt, writer, audit, nonceSecret: SECRET,
      authorize: async ({ job }) => job.id === jobId && job.request_id === requestId,
      checkFreshness: async () => source.isCurrent({ manifest }),
      prepareSnapshot: ({ configuration }) => source.prepare({ manifest: configuration.manifest, scope, profile, nonceSecret: SECRET }),
      readTarget: async () => {
        const observed = { ...row };
        const baseline = captureSummaryBaseline(observed);
        // The fixture projects content protection into the ledger's existing blank guard.
        // A runtime marker adapter and its error/status semantics remain undecided.
        return { etag: observed.version, fields: { [FIELD]: {
          blank: baseline !== null, sha256: sha256(canonical(observed.text)),
        } } };
      },
    };
    return { command, jobId, deps, source, files, filename, staff, writer, audit, executePrompt, generate,
      read: () => store.readJob({ jobId, environment: 'test', principalKey: command.principalKey }),
      row: () => ({ ...row }), tick: () => advanceJob(deps),
      replaceSource: () => { files[filename] = { ...files[filename], eTag: 'W/"source2"', versionId: '2' }; } };
  }
  async function stages(f, expected) {
    for (const stage of expected) expect(await f.tick()).toEqual({ stage });
  }
  const prepared = ['snapshot_saved', 'target_captured'];
  const generated = [...prepared, 'validated', 'audit_delivered'];
  async function reserved(f) {
    expect((await pool.query('SELECT released_at FROM prompt_job_initializations WHERE job_id=$1', [f.jobId])).rows)
      .toEqual([{ released_at: null }]);
  }

  test('narrative → snapshot → fake Executor → audit → original-version publication; replay survives clear and expiry', async () => {
    const f = await fixture();
    const concurrent = await Promise.all([store.admit(f.command), store.admit(f.command)]);
    expect(concurrent.every(r => r.job.id === f.jobId && r.replayed)).toBe(true);
    await stages(f, [...generated, 'published']);
    expect(f.row()).toEqual({ text: OUTPUT, staffEdited: false, version: 'W/"2"' });
    expect((await f.read()).publication.state).toBe('applied');
    f.staff('');
    await reserved(f);
    await pool.query("UPDATE prompt_job_content SET expires_at=now()-interval '1 second' WHERE job_id=$1", [f.jobId]);
    expect(await store.expireContent({ scope: { environment: 'test', requestId: f.command.requestId,
      principalKey: f.command.principalKey, authorizationScope: f.command.authorizationScope } })).toBeGreaterThan(0);
    expect((await store.admit(f.command)).job.id).toBe(f.jobId);
    await f.tick(); await f.tick();
    expect(f.row().text).toBeNull();
    expect(f.executePrompt).toHaveBeenCalledTimes(1);
    expect(f.writer).toHaveBeenCalledTimes(1);
    expect(f.audit).toHaveBeenCalledTimes(1);
    await reserved(f);
    await expect(store.admit({ ...f.command, idempotencyKey: randomUUID(), sourceEventId: randomUUID() }))
      .rejects.toMatchObject({ code: 'prompt_job_initialization_reserved' });
  });

  test.each(['edit-clear', 'blank-clear', 'whitespace', 'missing-marker'])('%s before capture prevents dispatch', async kind => {
    const f = await fixture(kind === 'missing-marker' ? { staffEdited: null } : {});
    await stages(f, ['snapshot_saved']);
    if (kind === 'edit-clear') { f.staff('Staff draft'); f.staff(''); }
    if (kind === 'blank-clear') f.staff('');
    if (kind === 'whitespace') f.staff(' ');
    const before = f.row();
    await stages(f, ['target_captured']);
    await f.tick();
    expect((await f.read()).tasks[0]).toMatchObject({ state: 'failed_pre_dispatch', writeback_state: 'blocked' });
    expect(f.row()).toEqual(before);
    expect(f.executePrompt).not.toHaveBeenCalled();
    expect(f.writer).not.toHaveBeenCalled();
    await reserved(f);
  });

  test.each(['edit', 'clear', 'edit-clear'])('%s during generation preserves staff intent and original ETag', async kind => {
    const f = await fixture();
    const execute = f.deps.executePrompt;
    f.deps.executePrompt = async args => {
      const result = await execute(args);
      if (kind !== 'clear') f.staff('Staff revision');
      if (kind !== 'edit') f.staff('');
      return result;
    };
    await stages(f, generated);
    const before = f.row();
    await stages(f, ['conflict']);
    await f.tick(); await f.tick();
    expect(f.row()).toEqual(before);
    expect((await f.read()).publication).toMatchObject({ state: 'conflict', expected_etag: 'W/"1"' });
    expect(f.writer).toHaveBeenCalledTimes(1);
    expect(f.executePrompt).toHaveBeenCalledTimes(1);
    await reserved(f);
  });

  test('overlapping worker ticks cannot double-dispatch or double-publish', async () => {
    const f = await fixture();
    await stages(f, prepared);
    await Promise.all([f.tick(), f.tick(), f.tick()]);
    // Advance whatever stage remains after competing claims, with a fixed bound.
    for (let i = 0; i < 5; i++) await f.tick();
    expect(f.executePrompt).toHaveBeenCalledTimes(1);
    expect(f.audit).toHaveBeenCalledTimes(1);
    expect(f.writer).toHaveBeenCalledTimes(1);
    expect((await f.read()).publication.state).toBe('applied');
    expect((await pool.query(`SELECT count(*)::int AS n FROM prompt_job_attempts a
      JOIN prompt_job_tasks t ON t.id=a.task_id WHERE t.job_id=$1`, [f.jobId])).rows).toEqual([{ n: 1 }]);
    expect((await pool.query('SELECT count(*)::int AS n FROM prompt_job_publications WHERE job_id=$1', [f.jobId])).rows)
      .toEqual([{ n: 1 }]);
  });

  test('source replacement after capture stops dispatch', async () => {
    const f = await fixture();
    await stages(f, prepared);
    f.replaceSource();
    await stages(f, ['failed_pre_dispatch']);
    expect(f.executePrompt).not.toHaveBeenCalled();
    expect(f.writer).not.toHaveBeenCalled();
    expect((await f.read()).tasks[0].error_code).toBe('dispatch_denied');
  });

  test('source replacement after generation prevents publication without discarding retained result', async () => {
    const f = await fixture();
    await stages(f, generated);
    f.replaceSource();
    await expect(f.tick()).rejects.toThrow('authorization or freshness denied');
    await expect(f.tick()).rejects.toThrow('authorization or freshness denied');
    expect(f.writer).not.toHaveBeenCalled();
    expect(f.executePrompt).toHaveBeenCalledTimes(1);
    expect((await f.read()).tasks[0].state).toBe('validated');
    expect((await f.read()).publication).toBeNull();
    await reserved(f);
  });

  test('missing narrative never substitutes the present combined PDF or applicant abstract', async () => {
    const f = await fixture();
    delete f.files[f.filename];
    await expect(f.tick()).rejects.toMatchObject({ code: 'summary_source_changed' });
    expect(f.executePrompt).not.toHaveBeenCalled();
    expect(f.writer).not.toHaveBeenCalled();
    expect((await f.read()).job.snapshot_content_id).toBeNull();
  });

  test('uncertain generation remains fenced and is not retried', async () => {
    const f = await fixture();
    f.executePrompt.mockImplementation(async args => { await args.onDispatch(); throw Error('Synthetic lost response'); });
    await stages(f, [...prepared, 'unknown']);
    await store.admit(f.command);
    await f.tick(); await f.tick();
    expect((await f.read()).tasks[0].state).toBe('unknown');
    expect(f.executePrompt).toHaveBeenCalledTimes(1);
    expect(f.writer).not.toHaveBeenCalled();
    await reserved(f);
  });

  test('known generation failure is terminal; synthetic release exception is explicit', async () => {
    const f = await fixture();
    f.executePrompt.mockRejectedValue(Error('Synthetic pre-dispatch failure'));
    await stages(f, [...prepared, 'failed_pre_dispatch']);
    await store.admit(f.command); await f.tick();
    expect(f.executePrompt).toHaveBeenCalledTimes(1);
    expect(f.writer).not.toHaveBeenCalled();
    expect((await pool.query('SELECT released_at IS NOT NULL AS released FROM prompt_job_initializations WHERE job_id=$1', [f.jobId])).rows)
      .toEqual([{ released: true }]); // Real Summary retention is covered by the companion suite, not inferred here.
  });

  test.each([false, true])('uncertain publication (physical write applied=%s) never retries', async applied => {
    const f = await fixture();
    const write = f.writer.getMockImplementation();
    f.writer.mockImplementation(async args => { if (applied) await write(args); throw Error('Synthetic lost acknowledgement'); });
    await stages(f, [...generated, 'unknown']);
    const before = f.row();
    await store.admit(f.command); await f.tick(); await f.tick();
    expect(f.row()).toEqual(before);
    expect(f.row().text).toBe(applied ? OUTPUT : null);
    expect((await f.read()).publication.state).toBe('unknown');
    expect(f.writer).toHaveBeenCalledTimes(1);
    expect(f.executePrompt).toHaveBeenCalledTimes(1);
    await reserved(f);
  });

  // Expire only this fixture's held lease; no sleeps or wall-clock races.
  const expireLease = f => pool.query(
    "UPDATE prompt_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [f.jobId]);
  async function hold(f) {
    const claim = await store.claim({ jobId: f.jobId, leaseMs: 60000 });
    expect(claim).not.toBeNull();
    return { claim, fence: { jobId: f.jobId, leaseToken: claim.leaseToken } };
  }

  test.each([
    { definitive: true, applied: false },
    { definitive: false, applied: false },
    { definitive: false, applied: true },
  ])('audit failure %j blocks publication without retry', async ({ definitive, applied }) => {
    const f = await fixture();
    await stages(f, [...prepared, 'validated']);
    const auditRecords = [];
    f.audit.mockImplementation(async ({ runId }) => {
      if (applied) auditRecords.push(runId);
      throw Object.assign(Error('Synthetic audit failure or lost acknowledgement'), { definitive });
    });
    await stages(f, [definitive ? 'audit_failed' : 'audit_unknown']);
    await store.admit(f.command); await f.tick(); await f.tick();
    expect((await f.read()).attempts[0].audit_state).toBe(definitive ? 'failed' : 'unknown');
    expect(auditRecords).toHaveLength(applied ? 1 : 0);
    expect(f.audit).toHaveBeenCalledTimes(1);
    expect(f.generate).toHaveBeenCalledTimes(1);
    expect(f.writer).not.toHaveBeenCalled();
    expect((await f.read()).publication).toBeNull();
    await reserved(f);
  });

  test('saved response resumes validation without another generation', async () => {
    const f = await fixture();
    const execute = f.executePrompt.getMockImplementation();
    f.executePrompt.mockImplementationOnce(async args => {
      await execute(args); // Commit response, then lose the validation result.
      throw Error('Synthetic interruption after response checkpoint');
    });
    await stages(f, [...prepared, 'needs_attention']);
    const saved = await f.read();
    expect(saved.tasks[0].state).toBe('response_saved');
    expect(saved.attempts).toHaveLength(1);
    await stages(f, ['validated', 'audit_delivered', 'published']);
    expect(f.executePrompt).toHaveBeenCalledTimes(2);
    expect(f.generate).toHaveBeenCalledTimes(1);
    expect(f.executePrompt.mock.calls[1][0].responseCheckpoint.response.text).toBe(OUTPUT);
    expect((await f.read()).attempts[0].id).toBe(saved.attempts[0].id);
    expect(f.audit).toHaveBeenCalledTimes(1);
    expect(f.writer).toHaveBeenCalledTimes(1);
  });

  test('expired saved response cannot trigger regeneration', async () => {
    const f = await fixture();
    const execute = f.executePrompt.getMockImplementation();
    f.executePrompt.mockImplementationOnce(async args => { await execute(args); throw Error('After checkpoint'); });
    await stages(f, [...prepared, 'needs_attention']);
    await pool.query("UPDATE prompt_job_content SET expires_at=now()-interval '1 second' WHERE job_id=$1 AND kind='response'", [f.jobId]);
    await stages(f, ['expired']);
    await f.tick();
    expect(f.generate).toHaveBeenCalledTimes(1);
    expect(f.executePrompt).toHaveBeenCalledTimes(1);
    expect(f.writer).not.toHaveBeenCalled();
    expect((await f.read()).tasks[0].state).toBe('expired');
  });

  test.each(['generation', 'audit', 'publication'])('abandoned %s intent becomes unknown on lease recovery; late completion is fenced', async phase => {
    const f = await fixture();
    await stages(f, phase === 'generation' ? prepared : phase === 'audit' ? [...prepared, 'validated'] : generated);
    const { claim, fence } = await hold(f);
    const taskId = claim.tasks[0].id;
    let attempt, publication;
    if (phase === 'generation') attempt = await store.markDispatching({ ...fence, taskId });
    else if (phase === 'audit') {
      attempt = claim.attempts[0];
      expect(await store.markAuditDispatching({ ...fence, taskId, attemptId: attempt.id })).not.toBeNull();
    } else {
      publication = await store.freezePublication(fence);
      expect(await store.markPublicationDispatched({ ...fence, operationId: publication.id })).not.toBeNull();
    }
    // No releaseClaim: simulate a process that vanished with durable intent held.
    await expireLease(f);
    await stages(f, ['needs_attention']);
    const recovered = await f.read();
    if (phase === 'generation') {
      expect(recovered.tasks[0].state).toBe('unknown');
      expect(await store.saveResponse({ ...fence, taskId, attemptId: attempt.id,
        response: { response: { text: 'Late response' } } })).toBeNull();
    } else if (phase === 'audit') {
      expect(recovered.attempts[0].audit_state).toBe('unknown');
      expect(await store.markAudit({ ...fence, taskId, attemptId: attempt.id, outcome: 'delivered' })).toBeNull();
    } else {
      expect(recovered.publication.state).toBe('unknown');
      expect(await store.finishPublication({ ...fence, operationId: publication.id, outcome: 'applied' })).toBeNull();
    }
    expect(await store.releaseClaim(fence)).toBeNull();
    expect(await f.read()).toEqual(recovered);
    await f.tick(); await f.tick();
    expect(f.generate).toHaveBeenCalledTimes(phase === 'generation' ? 0 : 1);
    expect(f.audit).toHaveBeenCalledTimes(phase === 'publication' ? 1 : 0);
    expect(f.writer).not.toHaveBeenCalled();
    await reserved(f);
  });

  test('expired lease before side-effect intent can safely resume', async () => {
    const f = await fixture();
    await stages(f, prepared);
    const { fence } = await hold(f);
    await expireLease(f);
    await stages(f, ['validated', 'audit_delivered', 'published']);
    expect(await store.releaseClaim(fence)).toBeNull();
    expect(f.generate).toHaveBeenCalledTimes(1);
    expect(f.writer).toHaveBeenCalledTimes(1);
  });

  test('old lease cannot release a newer active lease or freeze its publication', async () => {
    const f = await fixture();
    await stages(f, generated);
    const old = await hold(f);
    await expireLease(f);
    const current = await hold(f);
    expect(current.fence.leaseToken).not.toBe(old.fence.leaseToken);
    expect(await store.freezePublication(old.fence)).toBeNull();
    expect(await store.releaseClaim(old.fence)).toBeNull();
    expect((await pool.query('SELECT lease_token FROM prompt_jobs WHERE id=$1', [f.jobId])).rows[0].lease_token)
      .toBe(current.fence.leaseToken);
    expect(await store.freezePublication(current.fence)).toMatchObject({ state: 'ready', expected_etag: 'W/"1"' });
    await store.releaseClaim(current.fence);
    await stages(f, ['published']);
    expect(f.writer).toHaveBeenCalledTimes(1);
  });

  test('still-running old worker cannot checkpoint a late response after replacement recovers its lease', async () => {
    const f = await fixture();
    await stages(f, prepared);
    let signalStarted, releaseGeneration;
    const started = new Promise(resolve => { signalStarted = resolve; });
    const blocked = new Promise(resolve => { releaseGeneration = resolve; });
    f.generate.mockImplementationOnce(async () => { signalStarted(); await blocked; return OUTPUT; });
    const oldTick = f.tick();
    let startupTimer;
    try {
      await Promise.race([
        started,
        oldTick.then(() => { throw Error('Worker exited before generation barrier'); }),
        new Promise((_, reject) => {
          startupTimer = setTimeout(() => reject(Error('Generation barrier startup timeout')), 2000);
        }),
      ]);
      clearTimeout(startupTimer);
      await expireLease(f);
      await stages(f, ['needs_attention']);
      const recovered = await f.read();
      expect(recovered.tasks[0].state).toBe('unknown');
      releaseGeneration();
      expect(await oldTick).toEqual({ stage: 'needs_attention' });
      expect(await f.read()).toEqual(recovered);
      expect((await pool.query("SELECT count(*)::int AS n FROM prompt_job_content WHERE job_id=$1 AND kind='response'", [f.jobId])).rows)
        .toEqual([{ n: 0 }]);
      await f.tick();
      expect(f.generate).toHaveBeenCalledTimes(1);
      expect(f.writer).not.toHaveBeenCalled();
      await reserved(f);
    } finally {
      clearTimeout(startupTimer);
      releaseGeneration();
      await oldTick;
    }
  });

  test('rehearsal does not enable real Summary initialize', async () => {
    const f = await fixture();
    const real = { ...f.command, idempotencyKey: randomUUID(), tasks: [{ taskKey: 'proposal.executive-summary' }] };
    await expect(store.admit(real)).rejects.toMatchObject({ code: 'invalid_prompt_job_admission' });
    await expect(store.admitMachineTitle(real)).rejects.toBeDefined();
  });
});
