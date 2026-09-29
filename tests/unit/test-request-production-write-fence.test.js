/**
 * Production write fence (production plan, MVP build list item 2, S546).
 *
 * @jest-environment node
 */
import { jest } from '@jest/globals';
import {
  fenceCastBindingClient, fenceCastCreateClient, fenceProductionClient, fenceProductionGraph, fenceStatusChangeClient,
} from '../../lib/services/test-requests/production-write-fence.js';
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

describe('fenceStatusChangeClient (status setter)', () => {
  const DEST = '83162701-82da-4669-94f7-6648bc9abbd3';
  const SRC = 'e43ae6ea-698f-f111-8076-6045bd018a07';
  const fence = { destinationRequestId: DEST, sourceRequestId: SRC, field: 'wmkf_phaseiistatus', optionValue: 100000002 };
  const make = () => {
    const calls = [];
    const record = (name) => (...args) => { calls.push([name, ...args]); return { ok: true, status: 204 }; };
    const client = { baseUrl: 'https://wmkf.crm.dynamics.com/api/data/v9.2', get: record('get'), getWithOptions: record('getWithOptions'),
      post: record('post'), postWithOptions: record('postWithOptions'), patch: record('patch'), patchWithOptions: record('patchWithOptions'),
      delete_: record('delete_'), raw: record('raw') };
    return { fenced: fenceStatusChangeClient(client, fence), calls };
  };
  const good = () => [`/akoya_requests(${DEST})`, { wmkf_phaseiistatus: 100000002 }, { 'If-Match': 'W/"98622844"' }];

  test('admits exactly the one status PATCH with a concrete If-Match, and reads', async () => {
    const { fenced, calls } = make();
    await fenced.patchWithOptions(...good());
    await fenced.get('/akoya_requests');
    expect(calls.map((c) => c[0])).toEqual(['patchWithOptions', 'get']);
  });

  test.each([
    ['another Request', [`/akoya_requests(${SRC.replace('e4', 'f4')})`, { wmkf_phaseiistatus: 100000002 }, { 'If-Match': 'W/"1"' }], /not the destination/],
    ['the source Request', [`/akoya_requests(${SRC})`, { wmkf_phaseiistatus: 100000002 }, { 'If-Match': 'W/"1"' }], /names the source/],
    ['a second field', [`/akoya_requests(${DEST})`, { wmkf_phaseiistatus: 100000002, akoya_title: 'x' }, { 'If-Match': 'W/"1"' }], /exactly wmkf_phaseiistatus/],
    ['the other status field', [`/akoya_requests(${DEST})`, { wmkf_phaseistatus: 100000002 }, { 'If-Match': 'W/"1"' }], /exactly wmkf_phaseiistatus/],
    ['a different option', [`/akoya_requests(${DEST})`, { wmkf_phaseiistatus: 100000004 }, { 'If-Match': 'W/"1"' }], /option 100000002/],
    ['no If-Match (an upsert)', [`/akoya_requests(${DEST})`, { wmkf_phaseiistatus: 100000002 }, {}], /concrete If-Match/],
    ['a wildcard If-Match', [`/akoya_requests(${DEST})`, { wmkf_phaseiistatus: 100000002 }, { 'If-Match': '*' }], /concrete If-Match/],
  ])('refuses a PATCH of %s before the transport', (_label, args, message) => {
    const { fenced, calls } = make();
    expect(() => fenced.patchWithOptions(...args)).toThrow(message);
    expect(calls).toHaveLength(0);
  });

  test.each(['post', 'postWithOptions', 'patch', 'delete_', 'raw'])('refuses %s outright', (name) => {
    const { fenced, calls } = make();
    expect(() => fenced[name](`/akoya_requests(${DEST})`, {})).toThrow(/not allowed in a status change/);
    expect(calls).toHaveLength(0);
  });

  test('the basic-run fence still refuses every PATCH', () => {
    const { calls } = make();
    const basic = fenceProductionClient({ patchWithOptions: () => calls.push('x') }, { destinationRequestId: DEST, destinationLocationId: DEST, sourceRequestId: SRC });
    expect(() => basic.patchWithOptions(...good())).toThrow(/not allowed in a production run/);
  });
});

describe('cast contact binds on the Request create (slice B)', () => {
  const PI = '66666666-6666-4666-8666-666666666666';
  const LIAISON = '77777777-7777-4777-8777-777777777777';
  const OTHER = '88888888-8888-4888-8888-888888888888';
  const castBinds = { wmkf_projectleader: PI, akoya_primarycontactid: LIAISON };
  const body = (pi, liaison) => ({
    akoya_requestid: DEST, 'wmkf_ProjectLeader@odata.bind': `/contacts(${pi})`, 'akoya_primarycontactid@odata.bind': `/contacts(${liaison})`,
  });

  test('admits the PI and Liaison binds, each to its own journaled cast contact', async () => {
    const { client } = fakeClient();
    const fenced = fenceProductionClient(client, { ...fence, castBinds });
    await expect(fenced.post('/akoya_requests', body(PI.toUpperCase(), LIAISON))).resolves.toBeTruthy();
  });

  test.each([
    ['swapped PI and Liaison', body(LIAISON, PI), /is not approved/],
    ['an unjournaled contact', body(OTHER, LIAISON), /is not approved/],
    ['a contact bound through another lookup', { ...body(PI, LIAISON), 'wmkf_otherperson@odata.bind': `/contacts(${PI})` }, /is not approved/],
    ['a missing Liaison bind', (({ 'akoya_primarycontactid@odata.bind': _l, ...rest }) => rest)(body(PI, LIAISON)), /akoya_primarycontactid .* exactly once/],
  ])('refuses %s', (_label, requestBody, message) => {
    const { client } = fakeClient();
    expect(() => fenceProductionClient(client, { ...fence, castBinds }).post('/akoya_requests', requestBody)).toThrow(message);
  });

  test('without cast IDs no contact bind is admitted', () => {
    const { client } = fakeClient();
    expect(() => fenceProductionClient(client, fence).post('/akoya_requests', body(PI, LIAISON))).toThrow(/is not approved/);
  });
});

describe('fenceCastCreateClient (slice A)', () => {
  const CONTACT = '66666666-6666-4666-8666-666666666666';
  const PERSON = '99999999-9999-4999-8999-999999999999';
  const castFence = { members: [
    { memberId: CONTACT, entity: 'contact', firstName: 'TEST · Factory', lastName: 'PI', address: 'pi@example.test' },
    { memberId: PERSON, entity: 'wmkf_potentialreviewers', firstName: 'TEST · Factory', lastName: 'Reviewer', address: 'reviewer@example.test' },
  ] };
  const contact = { contactid: CONTACT, firstname: 'TEST · Factory', lastname: 'PI', emailaddress1: 'pi@example.test' };
  const person = {
    wmkf_potentialreviewersid: PERSON, wmkf_firstname: 'TEST · Factory', wmkf_lastname: 'Reviewer',
    wmkf_emailaddress: 'reviewer@example.test', wmkf_issyntheticreviewer: true,
  };

  test('admits each journaled member\'s closed create, and reads', async () => {
    const { client, calls } = fakeClient();
    const fenced = fenceCastCreateClient(client, castFence);
    await fenced.get('/contacts(x)');
    await fenced.post('/contacts', contact);
    await fenced.postWithOptions('/wmkf_potentialreviewerses', person, {}, {});
    expect(calls.map((c) => c[0])).toEqual(['get', 'post', 'postWithOptions']);
  });

  test.each([
    ['an unjournaled GUID', '/contacts', { ...contact, contactid: DEST }],
    ['a person GUID on the contact set', '/contacts', { ...contact, contactid: PERSON }],
    ['a parent account bind', '/contacts', { ...contact, 'parentcustomerid_account@odata.bind': `/accounts(${DEST})` }],
    ['an extra column', '/contacts', { ...contact, telephone1: '555' }],
    ['a person without the marker', '/wmkf_potentialreviewerses', { ...person, wmkf_issyntheticreviewer: false }],
    ['another entity set', '/accounts', { accountid: CONTACT }],
    ['a wrong name', '/contacts', { ...contact, lastname: 'Liaison' }],
    ['a wrong address', '/contacts', { ...contact, emailaddress1: 'someone@example.test' }],
    ['an omitted column', '/contacts', (({ emailaddress1: _e, ...rest }) => rest)(contact)],
  ])('refuses %s', (_label, path, body) => {
    const { client } = fakeClient();
    expect(() => fenceCastCreateClient(client, castFence).post(path, body)).toThrow(/Production write fence/);
  });

  test.each(['patch', 'patchWithOptions', 'delete_', 'raw'])('refuses %s outright', (name) => {
    const { client } = fakeClient();
    expect(() => fenceCastCreateClient(client, castFence)[name]('/contacts(x)', {})).toThrow(/not allowed in a cast create/);
  });

  test('refuses to build without journaled members', () => {
    const { client } = fakeClient();
    expect(() => fenceCastCreateClient(client, { members: [] })).toThrow(/journaled members/);
  });
});

describe('fenceCastBindingClient (slice B)', () => {
  const BINDING = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const PERSON = '99999999-9999-4999-8999-999999999999';
  const bindingFence = { bindingId: BINDING, personId: PERSON, destinationRequestId: DEST, sourceRequestId: SOURCE, label: 'Applicant recommendation (Factory cast)' };
  const suggestion = {
    wmkf_appreviewersuggestionid: BINDING, wmkf_suggestionlabel: 'Applicant recommendation (Factory cast)', wmkf_sources: 'applicant',
    wmkf_selected: false, wmkf_applicantdisposition: 100000000,
    'wmkf_PotentialReviewer@odata.bind': `/wmkf_potentialreviewerses(${PERSON})`, 'wmkf_Request@odata.bind': `/akoya_requests(${DEST})`,
  };

  test('admits the one applicant-recommended suggestion', async () => {
    const { client, calls } = fakeClient();
    await fenceCastBindingClient(client, bindingFence).post('/wmkf_appreviewersuggestions', suggestion);
    expect(calls).toHaveLength(1);
  });

  test.each([
    ['another suggestion GUID', { ...suggestion, wmkf_appreviewersuggestionid: DEST }],
    ['another person', { ...suggestion, 'wmkf_PotentialReviewer@odata.bind': `/wmkf_potentialreviewerses(${DEST})` }],
    ['the source Request', { ...suggestion, 'wmkf_Request@odata.bind': `/akoya_requests(${SOURCE})` }],
    ['an excluded disposition', { ...suggestion, wmkf_applicantdisposition: 100000001 }],
    ['a missing Request bind', (({ 'wmkf_Request@odata.bind': _r, ...rest }) => rest)(suggestion)],
    ['an engagement column', { ...suggestion, wmkf_invited: true }],
    ['a selected suggestion', { ...suggestion, wmkf_selected: true }],
    ['another source', { ...suggestion, wmkf_sources: 'applicant,staff' }],
    ['another label', { ...suggestion, wmkf_suggestionlabel: 'Real recommendation' }],
    ['a missing label', (({ wmkf_suggestionlabel: _l, ...rest }) => rest)(suggestion)],
    ['a malformed cycle code', { ...suggestion, wmkf_grantcyclecode: 'December' }],
  ])('refuses %s', (_label, body) => {
    const { client } = fakeClient();
    expect(() => fenceCastBindingClient(client, bindingFence).post('/wmkf_appreviewersuggestions', body)).toThrow(/Production write fence/);
  });

  test.each(['patch', 'patchWithOptions', 'delete_', 'raw'])('refuses %s outright', (name) => {
    const { client } = fakeClient();
    expect(() => fenceCastBindingClient(client, bindingFence)[name]('/x', {})).toThrow(/not allowed in a cast binding/);
  });
});
