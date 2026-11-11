/** @jest-environment node */
import { randomUUID } from 'node:crypto';
import { getById as readRequest } from '../../lib/dataverse/adapters/grant-request.js';
import { getByIdWithSelect as readUser } from '../../lib/dataverse/adapters/system-user.js';
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import { readStaffRecommendation } from '../../lib/services/prompt-jobs/staff-recommendations-service.js';
import { createRecommendationsProposalSource } from '../../lib/services/prompt-jobs/proposal-source.js';
import { SANDBOX_RECOMMENDATIONS_SOURCE_VERSION } from '../../lib/services/prompt-jobs/context.js';
import { EXPERTISE_TASK_KEY, isTaskEnabled } from '../../lib/services/prompt-jobs/capabilities.js';
import { readRecommendationsAccessPolicy, RECOMMENDATIONS_SANDBOX_HOST, RECOMMENDATIONS_SANDBOX_ORIGIN } from '../../lib/services/prompt-jobs/recommendations-sandbox-policy.js';

const requestId = randomUUID();
const filename = 'ProposalNarrative_12345.pdf';
const args = { requestId, version: SANDBOX_RECOMMENDATIONS_SOURCE_VERSION };
const target = { environment: 'local-sandbox', targetHost: RECOMMENDATIONS_SANDBOX_HOST };
function fixture() {
  const metadata = { name: filename, siteId: 'appriver3651007194.sharepoint.com,site,web', driveId: 'drive', id: 'item', eTag: 'e1', versionId: 'v1' };
  const deps = { target: jest.fn(() => target), readRequest: jest.fn(async () => ({ akoya_requestid: requestId, akoya_requestnum: '12345' })),
    getBuckets: jest.fn(async () => [{ source: 'dynamics', library: 'akoya_request', folder: 'approved-request' }, { source: 'archive', library: 'RequestArchive1', folder: 'archive' }]),
    getFileMetadataByPath: jest.fn(async (_library, _folder, name) => name === filename ? metadata : null),
    downloadFile: jest.fn(async () => ({ filename, buffer: Buffer.from('%PDF-fabricated') })), readContact: jest.fn(), extractText: jest.fn() };
  return { deps, metadata, source: createRecommendationsProposalSource(deps) };
}

test('binds one exact AI Materials PDF to the Sandbox Request, stable version and actual bytes', async () => {
  const { source, deps } = fixture();
  const result = await source.observe(args);
  expect(result).toEqual({ ...args, complete: true, targetHost: RECOMMENDATIONS_SANDBOX_HOST,
    documents: [{ role: 'proposal', id: expect.stringMatching(/^[a-f0-9]{64}$/), version: '["v1","e1"]',
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/), extractionVersion: 'pdf-parse-text-v1' }] });
  expect(deps.readRequest).toHaveBeenCalledWith(requestId, { select: ['akoya_requestid', 'akoya_requestnum'] });
  expect(deps.readRequest).toHaveBeenCalledTimes(2);
  expect(deps.getBuckets).toHaveBeenCalledWith(requestId, '12345', { requireResolvedParents: true, requireCompleteResults: true });
  expect(deps.getFileMetadataByPath.mock.calls.map(call => call.slice(0, 2))).toEqual(Array(4).fill(['akoya_request', 'approved-request/AI Materials']));
  expect(deps.getFileMetadataByPath.mock.calls.map(call => call[2])).toEqual([filename, 'Project-Narrative_12345.pdf', filename, 'Project-Narrative_12345.pdf']);
  expect(deps.downloadFile).toHaveBeenCalledWith('drive', 'item', { maxBytes: 20 * 1024 * 1024 });
  expect(deps.downloadFile).toHaveBeenCalledTimes(1);
  expect(deps.readContact).not.toHaveBeenCalled();
  expect(deps.extractText).not.toHaveBeenCalled();
});

test.each(['missing', 'ambiguous', 'wrong name', 'wrong site'])('rejects %s source without fallback or download', async problem => {
  const { source, deps, metadata } = fixture();
  deps.getFileMetadataByPath.mockImplementation(async (_library, _folder, name) => {
    if (problem === 'missing') return null;
    if (problem === 'ambiguous') return { ...metadata, name };
    if (name !== filename) return null;
    return problem === 'wrong name' ? { ...metadata, name: filename.toLowerCase() } : { ...metadata, siteId: 'other.invalid,site,web' };
  });
  await expect(source.observe(args)).rejects.toMatchObject({ code: expect.stringMatching(/^proposal_source_/) });
  expect(deps.downloadFile).not.toHaveBeenCalled();
});

test('rejects a changed item version during byte observation and an invalid PDF', async () => {
  const { source, deps, metadata } = fixture();
  deps.downloadFile.mockImplementationOnce(async () => { metadata.versionId = 'v2'; return { filename, buffer: Buffer.from('%PDF-old') }; });
  await expect(source.observe(args)).rejects.toMatchObject({ code: 'proposal_source_changed' });
  deps.downloadFile.mockResolvedValueOnce({ filename, buffer: Buffer.from('not PDF') });
  await expect(source.observe(args)).rejects.toMatchObject({ code: 'proposal_source_invalid_file' });
});

test('target change prevents additional reads and a timed-out observation cannot continue to download', async () => {
  const first = fixture();
  first.deps.readRequest.mockImplementationOnce(async () => {
    first.deps.target.mockReturnValue(null);
    return { akoya_requestid: requestId, akoya_requestnum: '12345' };
  });
  await expect(first.source.observe(args)).rejects.toMatchObject({ code: 'proposal_source_unavailable' });
  expect(first.deps.getBuckets).not.toHaveBeenCalled();
  const second = fixture();
  let resolveRequest;
  second.deps.readRequest.mockImplementationOnce(() => new Promise(resolve => { resolveRequest = resolve; }));
  const source = createRecommendationsProposalSource({ ...second.deps, budgetMs: 5 });
  await expect(source.observe(args)).rejects.toMatchObject({ code: 'proposal_source_unavailable' });
  resolveRequest({ akoya_requestid: requestId, akoya_requestnum: '12345' });
  await Promise.resolve();
  expect(second.deps.getBuckets).not.toHaveBeenCalled();
  expect(second.deps.downloadFile).not.toHaveBeenCalled();
});

test('grant requires exact registered Sandbox and still leaves real admission disabled', () => {
  const grant = { requestId, jobId: randomUUID(), systemUserId: randomUUID(), applicationId: randomUUID(), scopeId: randomUUID(), profileId: 7 };
  const env = { DYNAMICS_URL: RECOMMENDATIONS_SANDBOX_ORIGIN, DATAVERSE_DAL_ENFORCEMENT: 'on', DATAVERSE_TARGET_INTERLOCK: 'on',
    EXPERTISE_RECOMMENDATIONS_READ_ACCESS: JSON.stringify(grant) };
  const policy = readRecommendationsAccessPolicy(env, 'local');
  expect(policy).toMatchObject({ ...grant, ...target, principalKey: `app:${grant.applicationId}`, authorizationScope: `expertise-recommendations:${grant.scopeId}` });
  expect(isTaskEnabled(EXPERTISE_TASK_KEY, policy)).toBe(false);
  for (const patch of [{ DYNAMICS_URL: 'https://wmkf.crm.dynamics.com' }, { DYNAMICS_URL: `${RECOMMENDATIONS_SANDBOX_ORIGIN}/api` },
    { DYNAMICS_URL: `${RECOMMENDATIONS_SANDBOX_ORIGIN}?q=1` }, { DYNAMICS_URL: `${RECOMMENDATIONS_SANDBOX_ORIGIN}/` },
    { DYNAMICS_SANDBOX_URL: 'https://wmkf.crm.dynamics.com' }, { DYNAMICS_SANDBOX_URL: `${RECOMMENDATIONS_SANDBOX_ORIGIN}/` },
    { VERCEL_ENV: 'unrecognized' },
    { SHAREPOINT_SITE_URL: 'https://appriver3651007194.sharepoint.com/sites/Unregistered' }, { DATAVERSE_TARGET_INTERLOCK: 'off' },
    { DATAVERSE_DAL_ENFORCEMENT: 'warn' }, { EXPERTISE_RECOMMENDATIONS_READ_ACCESS: undefined },
    { EXPERTISE_RECOMMENDATIONS_READ_ACCESS: JSON.stringify({ ...grant, owner: 'forged' }) }]) {
    expect(readRecommendationsAccessPolicy({ ...env, ...patch }, 'local')).toBeNull();
  }
  expect(readRecommendationsAccessPolicy(env, 'production')).toBeNull();
});


test('default source Request read reaches the strict transport and fails closed when missing', async () => {
  const previous = process.env;
  process.env = { ...previous, VERCEL_ENV: 'preview', DYNAMICS_URL: RECOMMENDATIONS_SANDBOX_ORIGIN,
    DATAVERSE_TARGET_INTERLOCK: 'on', DATAVERSE_DAL_ENFORCEMENT: 'on' };
  delete process.env.DYNAMICS_SANDBOX_URL;
  delete process.env.SHAREPOINT_SITE_URL;
  const transport = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue(null);
  try {
    await expect(createRecommendationsProposalSource().observe(args)).rejects.toMatchObject({ code: 'proposal_source_missing' });
    expect(transport).toHaveBeenCalledWith('akoya_requests', requestId, { select: 'akoya_requestid,akoya_requestnum',
      strictRead: true, expectedOrigin: RECOMMENDATIONS_SANDBOX_ORIGIN });
  } finally { process.env = previous; transport.mockRestore(); }
});

test('default staff User read reaches strict transport and strict adapters reject incomplete options', async () => {
  const jobId = randomUUID(), systemUserId = randomUUID(), azureId = randomUUID(), profileId = 7;
  const policy = readRecommendationsAccessPolicy({ DYNAMICS_URL: RECOMMENDATIONS_SANDBOX_ORIGIN,
    DATAVERSE_TARGET_INTERLOCK: 'on', DATAVERSE_DAL_ENFORCEMENT: 'on', EXPERTISE_RECOMMENDATIONS_READ_ACCESS: JSON.stringify({
      requestId, jobId, systemUserId, profileId, applicationId: randomUUID(), scopeId: randomUUID(),
    }) }, 'local');
  const transport = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue(null);
  const hasGrant = jest.fn();
  try {
    await expect(readRequest(requestId, { strictRead: true, expectedOrigin: RECOMMENDATIONS_SANDBOX_ORIGIN })).rejects.toThrow('requires select');
    await expect(readRequest(requestId, { select: 'akoya_requestid', strictRead: true })).rejects.toThrow('expectedOrigin');
    await expect(readUser(systemUserId, 'systemuserid', { strictRead: true })).rejects.toThrow('expectedOrigin');
    expect(transport).not.toHaveBeenCalled();
    const access = { profileId, session: { user: { userType: 'staff', profileId, azureId, dynamicsSystemuserId: systemUserId } } };
    expect(await readStaffRecommendation({ access, requestId, jobId }, {
      policy: () => policy, profile: async () => ({ id: profileId, is_active: true, needs_linking: false, azure_id: azureId, dynamics_systemuser_id: systemUserId }), hasGrant,
    })).toBeNull();
    expect(transport).toHaveBeenCalledWith('systemusers', systemUserId, { select: 'systemuserid,azureactivedirectoryobjectid,internalemailaddress,isdisabled',
      strictRead: true, expectedOrigin: RECOMMENDATIONS_SANDBOX_ORIGIN });
    expect(hasGrant).not.toHaveBeenCalled();
  } finally { transport.mockRestore(); }
});
