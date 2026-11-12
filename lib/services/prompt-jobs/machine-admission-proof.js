/**
 * Offline admission-only proof facade. Inject only an isolated scratch store.
 * No HTTP route, worker, source reader, provider, audit or result reader calls it.
 * Its synthetic task is executable by a generic worker: never wire this proof to
 * a shared/runtime database or scheduler. Success means queued admission only.
 */
import { isGuid } from '../../utils/guid.js';
import { ServiceHttpError } from '../service-http-error.js';
import { hashProfile } from './profile.js';

const TASK = 'synthetic.executive-summary';
const GRANT_KEYS = ['enabled', 'policyId', 'requestId', 'idempotencyKey', 'principalKey'];
function fail(code, httpStatus) { throw new ServiceHttpError(code, { code, httpStatus, body: { error: code } }); }
function uuid(value) {
  if (typeof value !== 'string' || value !== value.trim() || !isGuid(value)) fail('invalid_proof_request', 400);
  return value.toLowerCase();
}
function exact(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
}
function grant(readGrant) {
  try {
    const g = readGrant();
    if (!exact(g, GRANT_KEYS) || g.enabled !== true
      || typeof g.principalKey !== 'string' || !/^app:entra-v2:[a-f0-9-]{36}:[a-f0-9-]{36}:[a-f0-9-]{36}$/.test(g.principalKey)) throw Error();
    return Object.freeze({ enabled: true, policyId: uuid(g.policyId), requestId: uuid(g.requestId),
      idempotencyKey: uuid(g.idempotencyKey), principalKey: g.principalKey });
  } catch { fail('admission_proof_unavailable', 503); }
}
function task(scope) {
  const profile = { key: 'pa-admission-proof', revision: 1, wrapperVersion: 1, sharedInstructions: 'Offline fixture only.',
    documentRoles: ['proposal'], recordNames: [],
    limits: { maxDocuments: 1, maxDocumentBytes: 3000, maxTotalDocumentBytes: 3000, maxRecordBytes: 1000 } };
  return { taskKey: TASK, configuration: { scope, profile, promptRow: {
    wmkf_ai_promptid: 'ba567c5f-c568-45d2-92d8-a71de223ab31', wmkf_ai_promptname: TASK,
    wmkf_promptversion: 1, wmkf_ai_systemprompt: '', wmkf_ai_promptbody: 'Offline admission fixture; do not execute.',
    wmkf_ai_model: 'claude-sonnet-4-6', wmkf_ai_maxtokens: 1000, wmkf_ai_temperature: 0,
    wmkf_ai_promptvariables: JSON.stringify({ execution: { contractVersion: 1, mode: 'shared-document-task',
      profile: { key: profile.key, revision: 1, sha256: hashProfile(profile) } },
    variables: [{ name: 'proposal_context', source: { kind: 'prepared_context' }, required: true }] }),
    wmkf_ai_promptoutputschema: JSON.stringify({ parseMode: 'raw', outputs: [{ name: 'summary', maxWords: 200, target: { kind: 'none' } }] }),
  } } };
}
export function createMachineAdmissionProof({ authenticate, readGrant, store, now = () => Date.now() }) {
  async function authorize(authorization) {
    const identity = await authenticate(authorization);
    const g = grant(readGrant);
    if (identity.principalKey !== g.principalKey) fail('admission_proof_denied', 403);
    const scope = { environment: 'test', principalKey: identity.principalKey,
      authorizationScope: `pa-admission:${g.policyId}`, requestId: g.requestId };
    const fingerprint = JSON.stringify(g);
    const assertCurrent = () => {
      identity.assertCurrent();
      if (JSON.stringify(grant(readGrant)) !== fingerprint) fail('admission_proof_unavailable', 503);
    };
    assertCurrent();
    return { g, scope, assertCurrent };
  }
  function receipt(view, c) {
    c.assertCurrent();
    if (!view || view.job.principal_key !== c.scope.principalKey || view.job.environment !== c.scope.environment
      || view.job.authorization_scope !== c.scope.authorizationScope || view.job.request_id !== c.g.requestId
      || view.job.idempotency_key !== c.g.idempotencyKey || view.job.operation !== 'generate-draft'
      || view.job.source_event_id !== null) fail('admission_proof_not_found', 404);
    const t = view.tasks;
    if (t.length !== 1 || t[0].task_key !== TASK || t[0].state !== 'queued' || t[0].writeback_state !== 'not_requested'
      || t[0].destination_field !== null || view.job.snapshot_content_id !== null
      || view.attempts.length !== 0 || view.publication !== null) fail('admission_proof_changed', 409);
    const version = Number(view.job.version);
    if (!Number.isSafeInteger(version) || version < 1) fail('admission_proof_changed', 409);
    return { jobId: view.job.id, version, state: 'queued', modelExecutionEnabled: false };
  }
  async function storage(operation) {
    try { return await operation(); }
    catch (error) {
      if (error instanceof ServiceHttpError) throw error;
      fail('admission_proof_unavailable', 503);
    }
  }
  return {
    async admit({ authorization, idempotencyKey, body }) {
      const c = await authorize(authorization);
      if (!exact(body, ['requestId', 'taskKeys', 'operation']) || body.operation !== 'generate-draft'
        || !Array.isArray(body.taskKeys) || body.taskKeys.length !== 1 || body.taskKeys[0] !== TASK) fail('invalid_proof_request', 400);
      if (uuid(body.requestId) !== c.g.requestId || uuid(idempotencyKey) !== c.g.idempotencyKey) fail('admission_proof_denied', 403);
      c.assertCurrent();
      const timestamp = now();
      const view = await storage(() => store.admit({ ...c.scope, operation: 'generate-draft', idempotencyKey: c.g.idempotencyKey,
        sourceEventId: null, sourceExpiresAt: new Date(timestamp + 60_000), resultExpiresAt: new Date(timestamp + 120_000),
        tasks: [task({ environment: c.scope.environment, authorizationScope: c.scope.authorizationScope, requestId: c.scope.requestId })] }));
      return { statusCode: 202, receipt: receipt(view, c) };
    },
    async read({ authorization, jobId }) {
      const c = await authorize(authorization);
      const id = uuid(jobId);
      const view = await storage(() => store.readJob({ environment: c.scope.environment, principalKey: c.scope.principalKey, jobId: id }));
      return { statusCode: 200, receipt: receipt(view, c) };
    },
  };
}
