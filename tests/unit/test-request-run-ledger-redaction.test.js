/** @jest-environment node */
import { jest } from '@jest/globals';
import {
  LEDGER_REASON_CODES,
  LEDGER_RECEIPT_KEYS,
  LEDGER_STEPS,
  assertLedgerReceipt,
  assertReservePlan,
  cliActorId,
  idempotencyKeyDigest,
  createRunLedger,
  describeLedgerError,
  ledgerReasonOrThrow,
  requestNumberOrThrow,
  sanitizeErrorMessage,
} from '../../lib/services/test-requests/run-ledger.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const TOKEN = '22222222-2222-4222-8222-222222222222';

function thrownCode(fn) {
  try { fn(); } catch (error) { return error.code; }
  return 'did-not-throw';
}

function recordingDb(rowsPerCall = []) {
  const calls = [];
  let index = 0;
  const query = async (text, params) => {
    calls.push({ text, params });
    const rows = rowsPerCall[index++] ?? [];
    return { rows };
  };
  return { calls, query, transaction: async (fn) => fn({ query }) };
}

describe('ledger redaction', () => {
  test('sanitizeErrorMessage removes the secret itself, not just its label', () => {
    const text = 'Bearer abc.def; Authorization: Basic dXNlcjpwYXNz; url https://x.sharepoint.com/_layouts/15/download.aspx?a=1&sig=SECRET123&sv=2020';
    const cleaned = sanitizeErrorMessage(text);
    for (const secret of ['abc.def', 'dXNlcjpwYXNz', 'SECRET123', 'download.aspx']) {
      expect(cleaned).not.toContain(secret);
    }
    for (const quoted of [
      'Authorization: "Basic QUOTED1"', "Authorization='Basic QUOTED2'", '{"Authorization":"Bearer QUOTED3"}', 'Authorization=Basic QUOTED4,next',
      'Authorization: Digest username="admin", realm="QUOTED5", nonce="QUOTED6"', '{"Authorization":"Basic \\"QUOTED7\\""}',
    ]) {
      expect(sanitizeErrorMessage(quoted)).not.toMatch(/QUOTED/);
    }
    expect(cleaned.length).toBeLessThanOrEqual(500);
  });

  test('assertLedgerReceipt is an allowlist: unknown keys, nested objects, bodies, links and credentials are rejected, not redacted', () => {
    const ok = {
      requestId: '5d54abc5-7f74-4d23-b4be-39599147e674', requestNumber: '1000340', itemId: '01G4GVMS34H6SGDJZCGNF2NLBTIUMXWRAW',
      contentHash: 'a'.repeat(64), size: 287771, eTag: '"{7B3A1C2D-0000-4000-8000-000000000000},2"', versionId: '1.0', outcome: 'verified',
      folder: '1000340_5D54ABC57F744D23B4BE39599147E674/AI Materials', filename: 'ProposalNarrative_1000340.pdf',
      fiscalYear: 'December 2026', meetingDate: '2026-12-11', valueBefore: '2024-12-13', valueAfter: '2026-12-11',
      dispatchedAt: '2026-09-24T04:40:00.000Z', restoreVerified: true, requestIds: ['5d54abc5-7f74-4d23-b4be-39599147e674'],
    };
    expect(assertLedgerReceipt(ok)).toBe(ok);
    const rejects = [
      { akoya_purpose: 'confidential text' },
      { createBody: { akoya_title: 'x' } },
      { '@microsoft.graph.downloadUrl': 'https://x' },
      { body: 'x' }, { bytes: 'x' }, { narrative: 'x' }, { token: 'x' }, { bodyId: 'x' },
      { reason: 'anything' },
      { workflowName: 'GOverify' },
      { eTag: 'Authorization: Basic zzz' },
      { name: 'https://sharepoint.com/file' },
      { filename: 'x'.repeat(201) },
      { filename: 'Report with a very long name that exceeds the sixty character cap.pdf' },
      { filename: 'The confidential purpose of this proposal' },
      { contentHash: 'not-hex' },
      { requestNumber: 'DROP TABLE' },
      { verifiedAt: 'yesterday' },
      { nested: { a: 1 } },
      { requestIds: [{ id: 1 }] },
      { folder: 'line\nbreak' },
      { workflowName: 'The confidential purpose of this proposal is to study' },
      { expectedValue: 'confidential narrative text here' },
      { relativeUrl: '//attacker/share' },
      { relativeUrl: '../escape' },
      { folder: 'a//b' },
      { itemIds: ['QmFzZSBzaXh0eS1mb3VyIGVuY29kZWQgdGV4dCB0aGF0IGlzIGxvbmcgZW5vdWdoIHRvIGNhcnJ5IGNvbnRlbnQ='] },
      { status: 'creating' },
      { status: 'Confidential proposal purpose' },
      { folder: 'Confidential proposal purpose and narrative' },
      { folder: 'AI Materials/extra' },
      { filename: 'Confidential proposal purpose and narrative.pdf' },
      { filename: 'Proposal_1000340.PDF.exe' },
      { expectedValue: 'Password 2026' },
      { fiscalYear: 'Confidential 2026' },
      { eTag: 'Confidential proposal purpose' },
      { eTag: 'W/"1" extra' },
      { versionId: 'two words' },
      { size: -1 }, { size: 'twelve' }, { restored: 'yes' },
      { eTag: 'W/"1" Bearer x' },
      { createdAt: 'Bearer x' },
      { bodyAt: '2026-01-01T00:00:00Z' },
    ];
    for (const bad of rejects) {
      expect([JSON.stringify(bad).slice(0, 40), thrownCode(() => assertLedgerReceipt(bad))])
        .toEqual([JSON.stringify(bad).slice(0, 40), 'test_request_ledger_unsafe_value']);
    }
    expect(LEDGER_RECEIPT_KEYS).not.toEqual(expect.arrayContaining(['purpose', 'body', 'content', 'token', 'downloadUrl', 'reason', 'workflowName', 'title']));
  });

  test('every JSONB write is validated before binding, so an unsafe receipt never reaches SQL', async () => {
    const runRow = { run_id: RUN_ID, lease_token: TOKEN, lease_generation: 1, lease_live: true, version: 2 };
    const db = recordingDb([[runRow], [{ next_sequence: 1 }], [{ resource_id: 1 }], [runRow], [{ resource_id: 1 }]]);
    const ledger = createRunLedger(db);
    await ledger.journalPlannedResource({
      runId: RUN_ID, leaseToken: TOKEN, leaseGeneration: 1, step: 'copy_file', resourceKind: 'sharepoint_file', system: 'sharepoint',
      plannedIdentity: { filename: 'Proposal_1000340.pdf', folder: '1000340_5D54ABC57F744D23B4BE39599147E674/Reviewer Materials' },
      sourceProvenance: { graphItemId: 'x', contentHash: 'b'.repeat(64) },
    });
    await ledger.recordResourceReadback({
      resourceId: 1, runId: RUN_ID, leaseToken: TOKEN, leaseGeneration: 1, responseStatus: 201,
      readback: { itemId: 'x', eTag: 'W/"98622844"' }, outcome: 'verified',
    });
    const before = db.calls.length;
    await expect(ledger.journalPlannedResource({
      runId: RUN_ID, leaseToken: TOKEN, leaseGeneration: 1, step: 'copy_file', resourceKind: 'sharepoint_file', system: 'sharepoint',
      plannedIdentity: { filename: 'Proposal_1000340.pdf', downloadUrl: 'https://leak' },
    })).rejects.toMatchObject({ code: 'test_request_ledger_unsafe_value' });
    await expect(ledger.recordResourceReadback({
      resourceId: 1, runId: RUN_ID, leaseToken: TOKEN, leaseGeneration: 1, responseStatus: 201,
      readback: { itemId: 'x', body: 'huge' }, outcome: 'verified',
    })).rejects.toMatchObject({ code: 'test_request_ledger_unsafe_value' });
    // Validation happens before any SQL for the rejected calls.
    expect(db.calls.length).toBe(before);
    const inserted = db.calls.find((c) => c.text.includes('INSERT INTO test_request_run_resources'));
    expect(inserted.params[5]).toBe(JSON.stringify({ filename: 'Proposal_1000340.pdf', folder: '1000340_5D54ABC57F744D23B4BE39599147E674/Reviewer Materials' }));
  });

  test('requestNumberOrThrow is shared by advanceStep and markReady, and markReady requires a number atomically', async () => {
    expect(requestNumberOrThrow(1000340)).toBe('1000340');
    expect(requestNumberOrThrow(null)).toBeNull();
    expect(thrownCode(() => requestNumberOrThrow('12x'))).toBe('test_request_run_invalid_request_number');
    const db = recordingDb([[{ run_id: RUN_ID, status: 'ready' }]]);
    const ledger = createRunLedger(db);
    await expect(ledger.markReady({ runId: RUN_ID, leaseToken: TOKEN, leaseGeneration: 1, expectedVersion: 2, destinationRequestNumber: 'abc' }))
      .rejects.toMatchObject({ code: 'test_request_run_invalid_request_number' });
    expect(db.calls).toHaveLength(0);
    await ledger.markReady({ runId: RUN_ID, leaseToken: TOKEN, leaseGeneration: 1, expectedVersion: 2, destinationRequestNumber: '1000340' });
    expect(db.calls[0].text).toContain("AND COALESCE($5::text, destination_request_number) ~ '^[0-9]{1,10}$'");
    expect(db.calls[0].params[4]).toBe('1000340');
  });
});

describe('remaining text columns are finite or grammar-bound', () => {
  const validPlan = () => ({
    runId: RUN_ID, sourceRequestId: RUN_ID, destinationRequestId: '33333333-3333-4333-8333-333333333333',
    destinationLocationId: '44444444-4444-4444-8444-444444444444', expectedAppUserId: RUN_ID, expectedOrganizationId: RUN_ID,
    recipe: 'basic', destinationEnvironment: 'sandbox', sourceDataverseHost: 'wmkf.crm.dynamics.com',
    destinationDataverseHost: 'orgd9e66399.crm.dynamics.com', sourceRequestNumber: '1003222', sourceRevision: 'W/"98622844"',
    bundleSha256: 'a'.repeat(64), copyPolicyDigest: 'b'.repeat(64), planDigest: 'c'.repeat(64), createBodySha256: 'd'.repeat(64),
    copyPolicyVersion: 'sandbox-rehearsal-2026-09-23', bundleExportedAt: '2026-09-24T03:58:33.103Z',
    expectedGraphSiteId: 'appriver3651007194.sharepoint.com,48930e19-0000-4000-8000-000000000000,1', expectedGraphDriveId: 'b!GQ6TSC-650adweD3-K',
    fiscalYear: 'December 2026', meetingDate: '2026-12-11', testLabel: 'Codex sandbox request factory rehearsal 2026-09-24 05d56f5d',
  });

  test('step names come from LEDGER_STEPS; prose, secrets and URLs never reach SQL', async () => {
    const db = recordingDb([]);
    const ledger = createRunLedger(db);
    for (const bad of ['https://secret.example/download?token=hunter2', 'Confidential proposal purpose', 'supersecret123', 'deadbeefcafe', '']) {
      await expect(ledger.advanceStep({ runId: RUN_ID, leaseToken: TOKEN, leaseGeneration: 1, expectedVersion: 2, nextStep: bad, nextStepIndex: 1 }))
        .rejects.toMatchObject({ code: 'test_request_ledger_unsafe_value' });
      await expect(ledger.journalPlannedResource({ runId: RUN_ID, leaseToken: TOKEN, leaseGeneration: 1, step: bad, resourceKind: 'sharepoint_file', system: 'sharepoint', plannedIdentity: {} }))
        .rejects.toMatchObject({ code: 'test_request_ledger_unsafe_value' });
    }
    await expect(ledger.journalPlannedResource({ runId: RUN_ID, leaseToken: TOKEN, leaseGeneration: 1, step: 'copy_file', resourceKind: 'purpose_dump', system: 'sharepoint', plannedIdentity: {} }))
      .rejects.toMatchObject({ code: 'test_request_ledger_unsafe_value' });
    await expect(ledger.recordResourceReadback({ resourceId: 1, runId: RUN_ID, leaseToken: TOKEN, leaseGeneration: 1, readback: {}, outcome: 'Confidential' }))
      .rejects.toMatchObject({ code: 'test_request_ledger_unsafe_value' });
    expect(db.calls).toHaveLength(0);
    expect(LEDGER_STEPS).toEqual(['fence_source', 'create_request', 'correct_meeting_date', 'provision_location', 'copy_file', 'observe', 'verify', 'ready']);
  });

  test('reserveRun validates every text column before SQL', async () => {
    expect(assertReservePlan({ actorId: cliActorId('gallivan'), idempotencyKey: 'run-2026-09-24-a', plan: validPlan() })).toBeTruthy();
    expect(assertReservePlan({ actorId: `user:${RUN_ID}`, idempotencyKey: 'any-printable-key!', plan: validPlan() })).toBeTruthy();
    expect(cliActorId('Gallivan')).toMatch(/^cli:[0-9a-f]{16}$/);
    expect(cliActorId('Gallivan')).not.toContain('allivan');
    expect(idempotencyKeyDigest('password-hunter2')).toMatch(/^[0-9a-f]{64}$/);
    const db = recordingDb([]);
    const ledger = createRunLedger(db);
    const cases = [
      { actorId: 'cli:gallivan', idempotencyKey: 'k', plan: validPlan() },
      { actorId: 'cli:hunter2', idempotencyKey: 'k', plan: validPlan() },
      { actorId: 'user:jane-doe@example.org', idempotencyKey: 'k', plan: validPlan() },
      { actorId: 'eyJhbGciOiJIUzI1NiJ9.secret.signature', idempotencyKey: 'k', plan: validPlan() },
      { actorId: 'bot:' + RUN_ID, idempotencyKey: 'k', plan: validPlan() },
      { actorId: cliActorId('x'), idempotencyKey: '', plan: validPlan() },
      { actorId: cliActorId('x'), idempotencyKey: 'has space', plan: validPlan() },
      { actorId: cliActorId('x'), idempotencyKey: 'k'.repeat(201), plan: validPlan() },
      { actorId: cliActorId('x'), idempotencyKey: 'k', plan: { ...validPlan(), recipe: 'confidential' } },
      { actorId: cliActorId('x'), idempotencyKey: 'k', plan: { ...validPlan(), fiscalYear: 'Confidential 2026' } },
      { actorId: cliActorId('x'), idempotencyKey: 'k', plan: { ...validPlan(), sourceRevision: 'purpose text here' } },
      { actorId: cliActorId('x'), idempotencyKey: 'k', plan: { ...validPlan(), destinationEnvironment: 'prod' } },
      { actorId: cliActorId('x'), idempotencyKey: 'k', plan: { ...validPlan(), bundleSha256: 'nothex' } },
      { actorId: cliActorId('x'), idempotencyKey: 'k', plan: { ...validPlan(), sourceDataverseHost: 'https://wmkf.crm.dynamics.com' } },
    ];

    for (const bad of cases) {
      await expect(ledger.reserveRun(bad)).rejects.toMatchObject({ code: 'test_request_ledger_unsafe_value' });
    }
    expect(db.calls).toHaveLength(0);
  });

  test('caller text never reaches SQL: label derived, key hashed, cli actor digested', async () => {
    const runRow = { run_id: RUN_ID, plan_digest: 'c'.repeat(64), destination_request_id: '33333333-3333-4333-8333-333333333333' };
    for (const leaky of ['Confidential acquisition of Acme', 'Bearer eyJhbGciOiJIUzI1NiJ9.secret.signature', 'https:example.com', 'purpose text']) {
      const db = recordingDb([[{ run_id: RUN_ID }], [runRow]]);
      await createRunLedger(db).reserveRun({ actorId: cliActorId('hunter2'), idempotencyKey: 'password-hunter2', plan: { ...validPlan(), testLabel: leaky } });
      expect(JSON.stringify(db.calls.map((c) => c.params))).not.toContain('hunter2');
      expect(db.calls[0].params[2]).toBe(idempotencyKeyDigest('password-hunter2'));
      const bound = JSON.stringify(db.calls.map((c) => c.params));
      expect(bound).not.toContain('Confidential');
      expect(bound).not.toContain('eyJhbGci');
      expect(bound).not.toContain('example.com');
      expect(bound).not.toContain('purpose text');
      expect(db.calls[0].params).toContain(`TEST basic clone of 1003222 run ${RUN_ID.slice(0, 8)}`);
    }
  });
});

describe('ledger lifecycle additions', () => {
  test('error columns hold an allowlisted code and status only, never upstream text', async () => {
    const leaky = Object.assign(new Error('Authentication failed: Basic dXNlcjpwYXNz at https://x.sharepoint.com/sites/akoyaGO/_layouts/download.aspx?id=1; purpose: confidential proposal purpose'), { status: 401 });
    expect(describeLedgerError(leaky)).toBe('upstream_http (http 401)');
    expect(describeLedgerError(Object.assign(new Error('x'), { code: 'test_request_run_fenced', httpStatus: 409 }))).toBe('test_request_run_fenced (http 409)');
    expect(describeLedgerError(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe('timeout');
    expect(describeLedgerError(Object.assign(new Error('x'), { code: 'ECONNRESET' }))).toBe('network');
    expect(describeLedgerError(new Error('purpose text'))).toBe('unknown_error');
    expect(ledgerReasonOrThrow('ambiguous_create_outcome')).toBe('ambiguous_create_outcome');
    for (const prose of ['second stall', 'Bearer secret stalled', 'https://leak', 'Confidential proposal purpose', '',
      'supersecret123', 'deadbeefcafe0123456789abcdef0123', 'hunter2', 'not_a_registered_code', 'upstream_http (http 99)']) {
      expect(thrownCode(() => ledgerReasonOrThrow(prose))).toBe('test_request_ledger_unsafe_value');
    }
    // A foreign error's own token-shaped code is never copied; only registered codes pass through.
    expect(describeLedgerError(Object.assign(new Error('x'), { code: 'supersecret123' }))).toBe('unknown_error');
    expect(describeLedgerError(Object.assign(new Error('x'), { code: 'deadbeef', status: 500 }))).toBe('upstream_http (http 500)');
    expect(LEDGER_REASON_CODES).toContain('ambiguous_create_outcome');
    expect(new Set(LEDGER_REASON_CODES).size).toBe(LEDGER_REASON_CODES.length);
    for (const code of LEDGER_REASON_CODES) expect(code).toMatch(/^[a-z][a-z0-9_]{0,63}$/);
    const fenceRow = { run_id: RUN_ID, lease_token: TOKEN, lease_generation: 1, lease_live: true, version: 4 };
    const db = recordingDb([[{ run_id: RUN_ID }], [{ run_id: RUN_ID }], [fenceRow], [{ resource_id: 1 }]]);
    const ledger = createRunLedger(db);
    await ledger.recordError({ runId: RUN_ID, leaseToken: TOKEN, leaseGeneration: 1, expectedVersion: 2, error: leaky });
    await ledger.markNeedsAttention({ runId: RUN_ID, leaseToken: TOKEN, leaseGeneration: 1, expectedVersion: 3, reason: leaky });
    await ledger.recordResourceFailure({ resourceId: 1, runId: RUN_ID, leaseToken: TOKEN, leaseGeneration: 1, outcome: 'failed', error: leaky });
    const bound = JSON.stringify(db.calls.map((c) => c.params));
    for (const fragment of ['dXNlcjpwYXNz', 'sharepoint.com', 'download.aspx', 'confidential', 'Authentication failed']) {
      expect(bound).not.toContain(fragment);
    }
    expect(db.calls[0].params[4]).toBe('upstream_http (http 401)');
    for (const secret of ['ambiguous create outcome', 'supersecret123', 'deadbeefcafe0123456789abcdef0123']) {
      await expect(ledger.markNeedsAttention({ runId: RUN_ID, leaseToken: TOKEN, leaseGeneration: 1, expectedVersion: 4, reason: secret }))
        .rejects.toMatchObject({ code: 'test_request_ledger_unsafe_value' });
      await expect(ledger.recordError({ runId: RUN_ID, leaseToken: TOKEN, leaseGeneration: 1, expectedVersion: 4, error: secret }))
        .rejects.toMatchObject({ code: 'test_request_ledger_unsafe_value' });
      await expect(ledger.recordResourceFailure({ resourceId: 1, runId: RUN_ID, leaseToken: TOKEN, leaseGeneration: 1, outcome: 'failed', error: secret }))
        .rejects.toMatchObject({ code: 'test_request_ledger_unsafe_value' });
    }
    expect(JSON.stringify(db.calls.map((c) => c.params))).not.toMatch(/supersecret|deadbeef/);
  });

  test('markNeedsAttention releases the lease in the same statement', async () => {
    const db = recordingDb([[{ run_id: RUN_ID, status: 'needs_attention' }]]);
    await createRunLedger(db).markNeedsAttention({
      runId: RUN_ID, leaseToken: TOKEN, leaseGeneration: 1, expectedVersion: 3, reason: 'ambiguous_create_outcome',
    });
    const { text, params } = db.calls[0];
    expect(text).toMatch(/lease_token = NULL/);
    expect(text).toMatch(/locked_until = NULL/);
    expect(text).toMatch(/lease_token = \$2::uuid/);
    expect(text).toMatch(/lease_generation = \$3::integer/);
    expect(text).toMatch(/version = \$4::integer/);
    expect(params[4]).toBe('ambiguous_create_outcome');
  });

  test('advanceStep records the server-assigned request number with COALESCE and validates its shape', async () => {
    const db = recordingDb([[{ run_id: RUN_ID }]]);
    const ledger = createRunLedger(db);
    await ledger.advanceStep({
      runId: RUN_ID, leaseToken: TOKEN, leaseGeneration: 1, expectedVersion: 2,
      nextStep: 'correct_meeting_date', nextStepIndex: 2, status: 'creating', destinationRequestNumber: 1000340,
    });
    expect(db.calls[0].text).toMatch(/destination_request_number = COALESCE\(\$8::text, destination_request_number\)/);
    expect(db.calls[0].params[7]).toBe('1000340');
    await ledger.advanceStep({
      runId: RUN_ID, leaseToken: TOKEN, leaseGeneration: 1, expectedVersion: 3, nextStep: 'verify', nextStepIndex: 3,
    });
    expect(db.calls[1].params[7]).toBeNull();
    await expect(ledger.advanceStep({
      runId: RUN_ID, leaseToken: TOKEN, leaseGeneration: 1, expectedVersion: 3, nextStep: 'verify', nextStepIndex: 3,
      destinationRequestNumber: 'DROP TABLE',
    })).rejects.toMatchObject({ code: 'test_request_run_invalid_request_number' });
    expect(db.calls).toHaveLength(2);
  });
});
