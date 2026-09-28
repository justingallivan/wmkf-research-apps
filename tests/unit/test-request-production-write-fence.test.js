/**
 * Production write fence (production plan, MVP build list item 2, S546).
 *
 * @jest-environment node
 */
import { jest } from '@jest/globals';
import { fenceProductionClient, fenceProductionGraph } from '../../lib/services/test-requests/production-write-fence.js';
import { MANIFEST_V4, PRODUCTION_URL, fenceSource, sha256 } from '../../lib/services/test-requests/basic-clone-steps.js';
import { buildSourceBundle } from '../../lib/services/test-requests/source-bundle.js';
import { SANDBOX_REHEARSAL_COPY_POLICY, copyPolicyDigest } from '../../lib/services/test-requests/bundle-file-copy.js';
import { PRODUCTION_HOSTS } from '../../lib/dataverse/core/target-registry.js';
import { COPY_DESTINATION_LIBRARY } from '../../lib/services/test-requests/bundle-file-copy.js';
import { expectedRequestFolder } from '../../lib/services/test-requests/sandbox-clone.js';

const DEST = '11111111-1111-4111-8111-111111111111';
const LOC = '55555555-5555-4555-8555-555555555555';
const SOURCE = '33333333-3333-4333-8333-333333333333';
const fence = { destinationRequestId: DEST, destinationLocationId: LOC, destinationRequestNumber: '1003300', sourceRequestId: SOURCE };
const FOLDER = `1003300_${DEST.replace(/-/g, '').toUpperCase()}`;

function fakeClient() {
  const calls = [];
  const record = (name) => jest.fn(async (...args) => { calls.push([name, ...args]); return { ok: true, status: 204, body: {} }; });
  return {
    calls,
    client: {
      baseUrl: `${PRODUCTION_URL}/api/data/v9.2`,
      get: record('get'), getWithOptions: record('getWithOptions'), post: record('post'), postWithOptions: record('postWithOptions'),
      patch: record('patch'), patchWithOptions: record('patchWithOptions'), delete_: record('delete_'), raw: record('raw'),
    },
  };
}

describe('fenceProductionClient', () => {
  test('allows the destination Request create and its preallocated location, and passes reads through', async () => {
    const { client, calls } = fakeClient();
    const fenced = fenceProductionClient(client, fence);
    await fenced.get('/akoya_requests(x)');
    await fenced.postWithOptions('/akoya_requests', { akoya_requestid: DEST.toUpperCase(), akoya_title: 'TEST: x' }, {}, {});
    await fenced.post('/sharepointdocumentlocations', {
      sharepointdocumentlocationid: LOC, 'regardingobjectid_akoya_request@odata.bind': `/akoya_requests(${DEST})`,
    }, {});
    expect(calls.map((c) => c[0])).toEqual(['get', 'postWithOptions', 'post']);
    expect(fenced.baseUrl).toBe(client.baseUrl);
  });

  test.each([
    ['a Request create with another GUID', '/akoya_requests', { akoya_requestid: SOURCE }],
    ['a body naming the source Request', '/akoya_requests', { akoya_requestid: DEST, note: `copied from ${SOURCE}` }],
    ['a location bound to another Request', '/sharepointdocumentlocations', { sharepointdocumentlocationid: LOC, 'regardingobjectid_akoya_request@odata.bind': `/akoya_requests(${SOURCE})` }],
    ['a location with another GUID', '/sharepointdocumentlocations', { sharepointdocumentlocationid: DEST, 'regardingobjectid_akoya_request@odata.bind': `/akoya_requests(${DEST})` }],
    ['any other entity set', '/accounts', { name: 'x' }],
  ])('refuses %s', async (_label, path, body) => {
    const { client, calls } = fakeClient();
    expect(() => fenceProductionClient(client, fence).post(path, body)).toThrow(/Production write fence/);
    expect(calls).toEqual([]);
  });

  test.each([
    ['a nested related record', '/akoya_requests', { akoya_requestid: DEST, akoya_request_emails: [{ subject: 'x' }] }],
    ['an unapproved column', '/akoya_requests', { akoya_requestid: DEST, akoya_payee: 'x' }],
    ['a bind to an unapproved entity set', '/akoya_requests', { akoya_requestid: DEST, 'akoya_payee@odata.bind': `/contacts(${LOC})` }],
    ['a bind that is not a GUID reference', '/akoya_requests', { akoya_requestid: DEST, 'wmkf_ProgramDirector@odata.bind': '/systemusers?$filter=x' }],
    ['a location with an extra bind', '/sharepointdocumentlocations', {
      sharepointdocumentlocationid: LOC, 'regardingobjectid_akoya_request@odata.bind': `/akoya_requests(${DEST})`,
      'ownerid@odata.bind': `/systemusers(${LOC})`,
    }],
    ['a location with a nested object', '/sharepointdocumentlocations', {
      sharepointdocumentlocationid: LOC, 'regardingobjectid_akoya_request@odata.bind': `/akoya_requests(${DEST})`, name: { x: 1 },
    }],
  ])('refuses a closed-shape violation: %s', (_label, path, body) => {
    const { client, calls } = fakeClient();
    expect(() => fenceProductionClient(client, fence).post(path, body)).toThrow(/Production write fence/);
    expect(calls).toEqual([]);
  });

  test('admits the real compiled shapes: Request with its three binds, location with its parent bind', async () => {
    const { client, calls } = fakeClient();
    const fenced = fenceProductionClient(client, fence);
    await fenced.postWithOptions('/akoya_requests', {
      akoya_requestid: DEST, 'akoya_applicantid@odata.bind': `/accounts(${LOC})`, akoya_title: 'TEST: x', akoya_purpose: 'p',
      akoya_request: 5, akoya_fiscalyear: 'F', akoya_requesttype: 1, wmkf_meetingdate: '2026-12-01', wmkf_istestrequest: true,
      wmkf_testcreationrunid: LOC, wmkf_respondreminderenabled: false, wmkf_reviewduereminderenabled: false,
      akoya_requeststatus: 'Phase II Pending', 'wmkf_ProgramDirector@odata.bind': `/systemusers(${LOC})`,
      'wmkf_GrantProgram@odata.bind': `/wmkf_grantprograms(${LOC})`,
    }, {}, {});
    await fenced.post('/sharepointdocumentlocations', {
      sharepointdocumentlocationid: LOC, name: 'Documents on Default Site 1', relativeurl: FOLDER, servicetype: 0, locationtype: 0,
      'regardingobjectid_akoya_request@odata.bind': `/akoya_requests(${DEST})`,
      'parentsiteorlocation_sharepointdocumentlocation@odata.bind': `/sharepointdocumentlocations(${LOC})`,
    }, {});
    expect(calls.map((c) => c[0])).toEqual(['postWithOptions', 'post']);
  });

  test.each(['patch', 'patchWithOptions', 'delete_', 'raw'])('refuses %s outright', (method) => {
    const { client, calls } = fakeClient();
    expect(() => fenceProductionClient(client, fence)[method](`/akoya_requests(${DEST})`, {})).toThrow(/not allowed in a production run/);
    expect(calls).toEqual([]);
  });

  test('refuses a method it does not know (deny by default)', () => {
    const { client } = fakeClient();
    client.executeChangeset = jest.fn();
    expect(() => fenceProductionClient(client, fence).executeChangeset([])).toThrow(/not allowed/);
    expect(client.executeChangeset).not.toHaveBeenCalled();
  });
});

describe('fenceProductionGraph', () => {
  const graph = () => ({
    getSiteId: jest.fn(async () => 'site'), ensureFolderPath: jest.fn(async () => ({})), uploadFile: jest.fn(async () => ({})),
    deleteFile: jest.fn(), someNewWrite: jest.fn(),
  });

  test('allows folder and upload writes under the destination folder only', async () => {
    const g = graph();
    const fenced = fenceProductionGraph(g, fence);
    await fenced.getSiteId();
    await fenced.ensureFolderPath('akoya_request', FOLDER);
    await fenced.uploadFile('akoya_request', `${FOLDER}/Reviewer Materials`, 'Proposal_1003300.pdf', Buffer.from('x'), 'application/pdf');
    expect(g.ensureFolderPath).toHaveBeenCalledTimes(1);
    expect(g.uploadFile).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['another folder', 'akoya_request', '1003222_ABC'],
    ['a sibling that shares the prefix', 'akoya_request', `${FOLDER}X`],
    ['another library', 'Shared Documents', FOLDER],
  ])('refuses %s', (_label, library, folder) => {
    const g = graph();
    expect(() => fenceProductionGraph(g, fence).uploadFile(library, folder, 'f', Buffer.from('x'), 'text/plain')).toThrow(/Production write fence/);
    expect(g.uploadFile).not.toHaveBeenCalled();
  });

  test('refuses deletes, unknown methods, and any write before the Request has its number', () => {
    const g = graph();
    const fenced = fenceProductionGraph(g, fence);
    expect(() => fenced.deleteFile('d', 'i')).toThrow(/not allowed/);
    expect(() => fenced.someNewWrite()).toThrow(/not allowed/);
    expect(() => fenceProductionGraph(g, { ...fence, destinationRequestNumber: null }).ensureFolderPath('akoya_request', FOLDER))
      .toThrow(/before the Request has its number/);
    expect(g.deleteFile).not.toHaveBeenCalled();
    expect(g.ensureFolderPath).not.toHaveBeenCalled();
  });
});

describe('fence folder rule matches the real copy destinations', () => {
  test('the copy step\'s library and request-folder builder are exactly what the fence admits', async () => {
    const g = { ensureFolderPath: jest.fn(async () => ({})), uploadFile: jest.fn(async () => ({})) };
    const fenced = fenceProductionGraph(g, fence);
    // run-runner.js stepCopyFile: requestFolder = expectedRequestFolder(number, id) from the readback
    // (lowercase GUID); bundle-file-copy.js requireResolvedDestination: `${requestFolder}/${sub}` in COPY_DESTINATION_LIBRARY.
    const requestFolder = expectedRequestFolder('1003300', DEST.toLowerCase());
    await fenced.ensureFolderPath(COPY_DESTINATION_LIBRARY, `${requestFolder}/AI Materials`);
    await fenced.uploadFile(COPY_DESTINATION_LIBRARY, `${requestFolder}/Reviewer Materials`, 'Proposal_1003300.pdf', Buffer.from('x'), 'application/pdf');
    expect(g.ensureFolderPath).toHaveBeenCalledTimes(1);
    expect(g.uploadFile).toHaveBeenCalledTimes(1);
  });
});

describe('fenceSource on a production target', () => {
  function productionBundleManifest() {
    const bundle = buildSourceBundle({
      sourceRow: {
        akoya_requestid: SOURCE, akoya_requestnum: '1003222', akoya_requesttype: 100000000,
        akoya_purpose: 'Synthetic purpose', akoya_request: 5000, akoya_fiscalyear: 'December 2026',
        wmkf_meetingdate: '2026-12-01', versionnumber: 42,
      },
      documents: [], dataverseHost: PRODUCTION_HOSTS[0], exportedAt: new Date(), reviewers: [],
    });
    return {
      kind: MANIFEST_V4, recipe: 'basic', targetEnvironment: 'production', target: PRODUCTION_URL,
      source: {
        requestId: SOURCE, requestNumber: '1003222', requestType: 100000000, revision: bundle.source.request.revision,
        dataverseHost: bundle.source.dataverseHost, exportedAt: bundle.exportedAt, bundleSha256: sha256(bundle),
      },
      bundle,
      createBody: { akoya_purpose: 'Synthetic purpose', akoya_request: 5000 },
      copyPolicy: { version: SANDBOX_REHEARSAL_COPY_POLICY.version, digest: copyPolicyDigest() },
    };
  }

  test.each([
    ['a bare versionnumber', { versionnumber: 42 }],
    ['an ETag', { '@odata.etag': 'W/"42"' }],
  ])('passes when the live source is still at the exported revision (%s)', async (_label, live) => {
    const client = { get: jest.fn(async () => ({ ok: true, status: 200, body: { akoya_requestid: SOURCE, ...live } })) };
    await expect(fenceSource(client, productionBundleManifest(), 100000000)).resolves.toBeDefined();
    expect(client.get).toHaveBeenCalledTimes(1);
  });

  test('refuses when the live source moved since the export', async () => {
    const client = { get: jest.fn(async () => ({ ok: true, status: 200, body: { akoya_requestid: SOURCE, '@odata.etag': 'W/"43"' } })) };
    await expect(fenceSource(client, productionBundleManifest(), 100000000)).rejects.toThrow(/changed since the bundle export/);
  });

  test('a sandbox bundle manifest never reads the live source', async () => {
    const manifest = productionBundleManifest();
    delete manifest.targetEnvironment;
    const client = { get: jest.fn() };
    await expect(fenceSource(client, manifest, 100000000)).resolves.toBeDefined();
    expect(client.get).not.toHaveBeenCalled();
  });
});
