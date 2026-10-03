/**
 * Admin Test Request Factory form: derived actor and run identities, target
 * selection, and the optional ids argument to buildCloneManifest.
 *
 * @jest-environment node
 */
import {
  FACTORY_ID_NAMESPACE, deriveActorId, deriveRunIds, targetFromDeployment,
} from '../../lib/services/test-requests/admin-run-identity.js';
import { buildCloneManifest } from '../../lib/services/test-requests/basic-clone-steps.js';
import { sha256 } from '../../lib/services/test-requests/basic-clone-steps.js';
import { TEST_REQUEST_FIXED_FIELDS } from '../../lib/services/test-requests/policy.js';
import { buildSourceBundle } from '../../lib/services/test-requests/source-bundle.js';
import { PRODUCTION_HOSTS } from '../../lib/dataverse/core/target-registry.js';
import { factoryFormEnabled } from '../../lib/services/test-requests/isolation.js';

describe('deriveActorId', () => {
  test('is a stable admin: UUIDv5 that the ledger actor grammar accepts', () => {
    expect(FACTORY_ID_NAMESPACE).toBe('717824eb-02d6-4f1e-8c95-891f6ffad959');
    const actor = deriveActorId(42);
    expect(actor).toMatch(/^admin:[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(deriveActorId(42)).toBe(actor);
    expect(deriveActorId(43)).not.toBe(actor);
  });

  test.each([null, undefined, 0, -1, 1.5, '42', NaN, {}])('refuses profileId %p', (value) => {
    expect(() => deriveActorId(value)).toThrow(/positive integer profile id/);
  });
});

describe('deriveRunIds', () => {
  const actor = deriveActorId(7);

  test('the three ids are distinct GUIDs and stable across calls', () => {
    const a = deriveRunIds(actor, 'key-1');
    expect(new Set(Object.values(a)).size).toBe(3);
    Object.values(a).forEach((id) => expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/));
    expect(deriveRunIds(actor, 'key-1')).toEqual(a);
  });

  test('a different key or a different actor changes all three', () => {
    const base = deriveRunIds(actor, 'key-1');
    for (const other of [deriveRunIds(actor, 'key-2'), deriveRunIds(deriveActorId(8), 'key-1')]) {
      expect(other.runId).not.toBe(base.runId);
      expect(other.requestId).not.toBe(base.requestId);
      expect(other.locationId).not.toBe(base.locationId);
    }
  });

  test.each(['', 'has space', 'tab\tkey', 'x'.repeat(201), 'unit\u001fsep'])('refuses key %p (ledger grammar)', (key) => {
    expect(() => deriveRunIds(actor, key)).toThrow(/idempotency key/);
  });
});

describe('targetFromDeployment', () => {
  test('production only on a production deployment', () => {
    expect(targetFromDeployment('production')).toBe('production');
    for (const deployment of ['preview', 'test', 'local']) expect(targetFromDeployment(deployment)).toBe('sandbox');
  });

  test('anything else throws', () => {
    for (const deployment of ['staging', '', null, 'Production']) {
      expect(() => targetFromDeployment(deployment)).toThrow(/Unrecognized deployment/);
    }
  });
});

describe('factoryFormEnabled', () => {
  test('only the literal on enables it; unset fails closed', () => {
    expect(factoryFormEnabled({ TEST_REQUEST_FACTORY_FORM: 'on' })).toBe(true);
    for (const value of [undefined, '', 'ON', 'yes', 'true', '1']) {
      expect(factoryFormEnabled({ TEST_REQUEST_FACTORY_FORM: value })).toBe(false);
    }
    expect(factoryFormEnabled({})).toBe(false);
  });
});

// A minimal sandbox/production preflight through the real buildCloneManifest + compiler.
const ORG_ID = '33333333-3333-4333-8333-333333333333';
const APP_USER_ID = '44444444-4444-4444-8444-444444444444';
const PD_ID = '66666666-6666-4666-8666-666666666666';
const PROGRAM_ID = '77777777-7777-4777-8777-777777777777';
const PI_ID = '88888888-8888-4888-8888-888888888888';
const LIAISON_ID = '99999999-9999-4999-8999-999999999999';
const RL_ID = '15151515-1515-4151-8151-151515151515';
const SOURCE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BASE_FIELDS = [
  'akoya_requestid', 'akoya_title', 'akoya_purpose', 'wmkf_abstract', 'akoya_request', 'akoya_fiscalyear',
  TEST_REQUEST_FIXED_FIELDS.requestType, 'wmkf_meetingdate', TEST_REQUEST_FIXED_FIELDS.marker,
  TEST_REQUEST_FIXED_FIELDS.runId, TEST_REQUEST_FIXED_FIELDS.responseReminder, TEST_REQUEST_FIXED_FIELDS.reviewReminder,
];

function typeOf(field) {
  if (field === 'akoya_request') return 'Money';
  if (field === 'akoya_purpose' || field === 'wmkf_abstract') return 'Memo';
  if (field === 'akoya_requestid' || field === TEST_REQUEST_FIXED_FIELDS.runId) return 'Uniqueidentifier';
  if (field === TEST_REQUEST_FIXED_FIELDS.requestType) return 'Picklist';
  if (field.includes('reminder') || field === TEST_REQUEST_FIXED_FIELDS.marker) return 'Boolean';
  if (field === 'wmkf_meetingdate') return 'DateOnly';
  return 'String';
}

function metadata(production) {
  const fields = Object.fromEntries(BASE_FIELDS.map((field) => [field, {
    createable: true, requiredLevel: 'None', type: typeOf(field),
    ...(field === 'akoya_request' ? { minValue: 0, maxValue: 1e9 } : {}),
    ...(['akoya_title', 'akoya_fiscalyear'].includes(field) ? { maxLength: 120 } : {}),
    ...(field === 'akoya_purpose' ? { maxLength: 100000 } : {}),
    ...(field === 'wmkf_abstract' ? { maxLength: production ? 5000 : 2000 } : {}),
  }]));
  fields.akoya_applicantid = { createable: true, requiredLevel: 'None', type: 'Lookup', lookupTarget: 'accounts' };
  if (production) {
    fields.akoya_requeststatus = { createable: true, requiredLevel: 'None', type: 'String', maxLength: 100 };
    const lookup = (lookupEntity, navigationProperty) => ({
      createable: true, requiredLevel: 'None', type: 'Lookup', lookupEntity, navigationProperty,
    });
    fields.wmkf_programdirector = lookup('systemuser', 'wmkf_ProgramDirector');
    fields.wmkf_grantprogram = lookup('wmkf_grantprogram', 'wmkf_GrantProgram');
    fields.wmkf_projectleader = lookup('contact', 'wmkf_ProjectLeader');
    fields.akoya_primarycontactid = lookup('contact', 'akoya_primarycontactid');
    fields.wmkf_researchleader = lookup('contact', 'wmkf_ResearchLeader');
  }
  return { entity: 'akoya_request', fields };
}

function preflight(targetEnvironment) {
  const production = targetEnvironment === 'production';
  return {
    targetEnvironment,
    metadata: metadata(production),
    grantOption: { value: 100000000, label: 'Grant' },
    foundation: { accountid: ORG_ID, name: 'W. M. Keck Foundation' },
    contacts: [],
    sharePointSites: [],
    requestLibraryParent: null,
    appUser: { systemuserid: APP_USER_ID, fullname: 'App' },
    siteId: 'site', driveId: 'drive',
    ...(production ? { grantProgram: { grantprogramid: PROGRAM_ID } } : {}),
  };
}

const SOURCE = {
  akoya_requestid: SOURCE_ID, akoya_requestnum: '9000001', akoya_requesttype: 100000000, akoya_purpose: 'Synthetic purpose',
  akoya_request: 5000, akoya_fiscalyear: 'December 2026', wmkf_meetingdate: '2026-12-01', revision: 'rev-1',
};

function bundleFor(abstract) {
  const sourceRow = {
    akoya_requestid: SOURCE_ID, akoya_requestnum: '9000001', akoya_requesttype: 100000000, akoya_purpose: 'Synthetic purpose',
    akoya_request: 5000, akoya_fiscalyear: 'December 2026', wmkf_meetingdate: '2026-12-01', versionnumber: 1,
  };
  if (abstract !== undefined) sourceRow.wmkf_abstract = abstract;
  return buildSourceBundle({
    sourceRow,
    documents: [],
    dataverseHost: PRODUCTION_HOSTS[0],
    exportedAt: new Date(Date.now() - 60_000),
    ...(abstract === undefined ? {} : { applicantAbstract: abstract }),
  });
}

describe('buildCloneManifest ids', () => {
  const actor = deriveActorId(9);
  const ids = (() => {
    const { runId, requestId, locationId } = deriveRunIds(actor, 'ids-key');
    return { runId, requestId, locationId };
  })();
  const base = { source: SOURCE, bundle: bundleFor(), fiscalYear: 'December 2026', meetingDate: '2026-12-01', testLabel: 'Factory proof' };

  test('supplied ids flow into values and the compiled create body (sandbox)', () => {
    const manifest = buildCloneManifest(preflight('sandbox'), { ...base, ids });
    expect(manifest.values).toMatchObject(ids);
    expect(manifest.createBody.akoya_requestid).toBe(ids.requestId);
    expect(manifest.createBody[TEST_REQUEST_FIXED_FIELDS.runId]).toBe(ids.runId);
  });

  test('the production create body carries the supplied ids', () => {
    const manifest = buildCloneManifest(preflight('production'), {
      ...base,
      programDirector: { systemuserid: PD_ID },
      cast: { piContactId: PI_ID, liaisonContactId: LIAISON_ID, researchLeaderContactId: RL_ID },
      ids,
    });
    expect(manifest.createBody.akoya_requestid).toBe(ids.requestId);
    expect(manifest.createBody[TEST_REQUEST_FIXED_FIELDS.runId]).toBe(ids.runId);
  });

  test('v5 applicant abstract reaches production create body and its digest', () => {
    const abstract = '  Applicant text exactly\n';
    const manifest = buildCloneManifest(preflight('production'), {
      ...base, bundle: bundleFor(abstract),
      programDirector: { systemuserid: PD_ID },
      cast: { piContactId: PI_ID, liaisonContactId: LIAISON_ID, researchLeaderContactId: RL_ID }, ids,
    });
    expect(manifest.bundle.version).toBe(5);
    expect(manifest.bundle.abstract).toBe(abstract);
    expect(manifest.createBody.wmkf_abstract).toBe(abstract);
    expect(manifest.createBodySha256).toBe(sha256(manifest.createBody));
  });

  test('without ids the builder still mints three distinct random GUIDs (CLI unchanged)', () => {
    const { values } = buildCloneManifest(preflight('sandbox'), base);
    expect(new Set([values.requestId, values.runId, values.locationId]).size).toBe(3);
    expect(values.requestId).not.toBe(ids.requestId);
  });

  test('refuses ids that are not GUIDs or not distinct', () => {
    expect(() => buildCloneManifest(preflight('sandbox'), { ...base, ids: { ...ids, locationId: 'nope' } })).toThrow(/must each be a GUID/);
    expect(() => buildCloneManifest(preflight('sandbox'), { ...base, ids: { ...ids, locationId: ids.runId.toUpperCase() } })).toThrow(/must be distinct/);
    expect(() => buildCloneManifest(preflight('sandbox'), { ...base, ids: { runId: ids.runId } })).toThrow(/must each be a GUID/);
  });
});
