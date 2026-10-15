import { gunzipSync } from 'node:zlib';
import {
  captureSandboxFoundationBaseline,
  SANDBOX_FOUNDATION_ROLLUP_CONTRACT,
  verifySandboxFoundationTransition,
} from '../../lib/services/test-requests/sandbox-foundation-verification.js';
import { verifyClone } from '../../lib/services/test-requests/basic-clone-steps.js';

const FOUNDATION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REQUEST = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const EXISTING_REQUEST = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const START = '2026-10-15T22:30:00.000Z';
const END = '2026-10-15T22:31:00.000Z';
const MODIFIED = '2026-05-19T18:33:57Z';
const ACTOR = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const SANDBOX_FORMULAS_GZIP = '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';

function verifyCloneArgs() {
  return [
    {
      kind: 'test-request-sandbox-manifest/v3',
      target: 'https://orgd9e66399.crm.dynamics.com',
      values: { requestId: REQUEST, runId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', meetingDate: '2026-12-01', locationId: '99999999-9999-4999-8999-999999999999' },
      createBody: { akoya_title: 'TEST: fixture', akoya_purpose: 'Synthetic purpose', akoya_request: 5000, akoya_requesttype: 100000000 },
      expectedOrganization: { accountid: FOUNDATION },
      expectedAppUserId: ACTOR,
      invariants: { expectedSharePointFiles: 0 },
    },
    { foundation: { accountid: FOUNDATION, versionnumber: '1', modifiedon: MODIFIED }, contacts: [], requestLibraryParent: { sharepointdocumentlocationid: '88888888-8888-4888-8888-888888888888' } },
    {
      request: {
        akoya_requestid: REQUEST, akoya_title: 'TEST: fixture', akoya_fiscalyear: undefined,
        akoya_purpose: 'Synthetic purpose', akoya_request: 5000, akoya_requesttype: 100000000,
        wmkf_meetingdate: '2026-12-01', _akoya_applicantid_value: FOUNDATION,
        _createdby_value: ACTOR, _ownerid_value: ACTOR, wmkf_istestrequest: true,
        wmkf_testcreationrunid: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        wmkf_respondreminderenabled: false, wmkf_reviewduereminderenabled: false,
        akoya_requestnum: '9000001', akoya_submissionaccepted: false,
      },
      payments: [], emails: [], locations: [], locationParents: [],
    },
    [],
    { accountid: FOUNDATION, versionnumber: '2', modifiedon: MODIFIED },
    [],
    null,
  ];
}

function account(overrides = {}) {
  const row = {
    accountid: FOUNDATION,
    name: 'W. M. Keck Foundation',
    statecode: 0,
    versionnumber: '10',
    modifiedon: MODIFIED,
  };
  for (const [field, type] of SANDBOX_FOUNDATION_ROLLUP_CONTRACT) {
    row[field] = type === 'DateTime' ? null : 0;
    if (!field.endsWith('_base')) {
      row[`${field}_date`] = START;
      row[`${field}_state`] = 1;
    }
  }
  row.akoya_countofrequests = 1;
  Object.assign(row, overrides);
  return row;
}

function metadataRows() {
  const fixture = JSON.parse(gunzipSync(Buffer.from(SANDBOX_FORMULAS_GZIP, 'base64')).toString('utf8'));
  const types = new Map(SANDBOX_FOUNDATION_ROLLUP_CONTRACT.map(([name, type]) => [name, type]));
  return fixture.map((row) => ({ ...row, type: types.get(row.LogicalName) }));
}

function clientFor({ accountRow = account(), requestIds = [EXISTING_REQUEST], metadata = metadataRows(), pages = {} } = {}) {
  return {
    async get(path) {
      if (path.startsWith('/accounts(')) return { ok: true, status: 200, body: accountRow };
      if (path.startsWith('/contacts?')) return { ok: true, status: 200, body: { value: [] } };
      if (path.startsWith('/akoya_requests?')) {
        const page = pages[path] || pages.request;
        return page || {
          ok: true, status: 200,
          body: { value: requestIds.map((akoya_requestid) => ({ akoya_requestid, statecode: 0 })) },
        };
      }
      const cast = path.match(/CRM\.(\w+)AttributeMetadata/)[1];
      const wantedType = cast === 'Integer' ? 'Integer'
        : cast === 'Money' ? 'Money'
          : cast === 'DateTime' ? 'DateTime' : 'Decimal';
      return {
        ok: true, status: 200,
        body: { value: metadata.filter((row) => row.type === wantedType).map(({ type: _type, ...row }) => row) },
      };
    },
  };
}

async function capture(overrides = {}) {
  return captureSandboxFoundationBaseline(overrides.client || clientFor(overrides), {
    foundationId: FOUNDATION,
    applicantId: FOUNDATION,
    reservedRequestId: REQUEST,
    capturedAt: START,
  });
}

function changedAccount(base, overrides = {}) {
  return account({
    ...base,
    versionnumber: '11',
    akoya_countofrequests: 2,
    akoya_countofrequests_date: END,
    akoya_countofawards_date: END,
    akoya_mostrecentgrant_date: END,
    akoya_totalgrants_date: END,
    opendeals_date: END,
    openrevenue_date: END,
    wmkf_countofconcepts_date: END,
    wmkf_countofdiscretionarygrant_date: END,
    wmkf_countofprogramgrants_date: END,
    wmkf_sumofdiscretionarygrants_date: END,
    wmkf_sumofprogramgrants_date: END,
    ...overrides,
  });
}

describe('Sandbox Foundation rollup verification', () => {
  test('journals only digests/counts and permits the exact reserved Request plus calculated rollup refresh', async () => {
    const baseline = await capture();
    expect(baseline.activeRequestCount).toBe(1);
    expect(baseline.expectedAfterActiveRequestCount).toBe(2);
    expect(baseline).not.toHaveProperty('activeRequestIds');
    expect(baseline).not.toHaveProperty('rollupValues');

    const result = await verifySandboxFoundationTransition(clientFor({
      accountRow: changedAccount(account()),
      requestIds: [EXISTING_REQUEST, REQUEST],
    }), baseline, { startedAt: START, verifiedAt: END });
    expect(result.ok).toBe(true);
    expect(result.changedRollups).toContain('akoya_countofrequests');
  });

  test('fails when Foundation count does not match complete active census at baseline', async () => {
    await expect(capture({ accountRow: account({ akoya_countofrequests: 2 }) }))
      .rejects.toThrow('does not equal the complete active Request census');
  });

  test('fails closed on SourceType=2 metadata drift', async () => {
    const metadata = metadataRows().filter((row) => row.LogicalName !== 'opendeals');
    await expect(capture({ metadata })).rejects.toThrow('differs from the reviewed 15-field contract');
  });

  test('fails if another active Request appears or the reserved Request is absent', async () => {
    const baseline = await capture();
    const result = await verifySandboxFoundationTransition(clientFor({
      accountRow: changedAccount(account()),
      requestIds: [EXISTING_REQUEST, REQUEST, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'],
    }), baseline, { startedAt: START, verifiedAt: END });
    expect(result.ok).toBe(false);
    expect(result.failures).toContain('Active applicant Request census is not exactly the baseline set plus the reserved Request.');
  });

  test('fails a version-only change with no validated rollup movement', async () => {
    const baseline = await capture();
    // Model an otherwise exact observation with no active Request transition;
    // this isolates the version-only rule from the independently required
    // reserved-Request census assertion.
    baseline.expectedAfterActiveRequestCount = baseline.activeRequestCount;
    baseline.expectedAfterActiveRequestIdsDigest = baseline.activeRequestIdsDigest;
    const result = await verifySandboxFoundationTransition(clientFor({
      accountRow: account({ versionnumber: '11', akoya_countofrequests: 1 }),
      requestIds: [EXISTING_REQUEST],
    }), baseline, { startedAt: START, verifiedAt: END });
    expect(result.failures).toContain('Foundation versionnumber changed without a validated rollup field change.');
  });

  test('fails when a non-request rollup or a rollup state changes', async () => {
    const baseline = await capture();
    const result = await verifySandboxFoundationTransition(clientFor({
      accountRow: changedAccount(account(), {
        akoya_countofawards: 1,
        wmkf_countofprogramgrants_state: 2,
      }),
      requestIds: [EXISTING_REQUEST, REQUEST],
    }), baseline, { startedAt: START, verifiedAt: END });
    expect(result.failures).toContain('Protected Foundation rollup akoya_countofawards changed.');
    expect(result.failures).toContain('Foundation wmkf_countofprogramgrants_state is not Calculated after create.');
  });

  test('fails if a paged active-Request census would escape its reviewed origin', async () => {
    const initial = '/akoya_requests?$select=akoya_requestid,statecode&$filter=_akoya_applicantid_value%20eq%20aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa%20and%20statecode%20eq%200&$orderby=akoya_requestid%20asc&$top=5000';
    const client = clientFor({ pages: { request: {
      ok: true, status: 200,
      body: { value: [{ akoya_requestid: EXISTING_REQUEST, statecode: 0 }], '@odata.nextLink': 'https://example.com/api/data/v9.2/akoya_requests?$skiptoken=x' },
    } } });
    await expect(capture({ client })).rejects.toThrow('cross-origin or non-Dataverse continuation link');
  });

  test('follows the complete Sandbox active-Request continuation census', async () => {
    const client = clientFor({ accountRow: account({ akoya_countofrequests: 2 }) });
    const originalGet = client.get.bind(client);
    let requestPages = 0;
    client.get = async (path) => {
      if (path.startsWith('/akoya_requests?')) {
        requestPages += 1;
        return {
          ok: true, status: 200,
          body: {
            value: [{ akoya_requestid: EXISTING_REQUEST, statecode: 0 }],
            '@odata.nextLink': 'https://orgd9e66399.crm.dynamics.com/api/data/v9.2/akoya_requests?$skiptoken=next',
          },
        };
      }
      if (path.startsWith('https://orgd9e66399.crm.dynamics.com/api/data/v9.2/akoya_requests?')) {
        requestPages += 1;
        return { ok: true, status: 200, body: { value: [{ akoya_requestid: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', statecode: 0 }] } };
      }
      return originalGet(path);
    };
    const baseline = await capture({ client });
    expect(requestPages).toBe(2);
    expect(baseline.activeRequestCount).toBe(2);
  });

  test('carries a fail-closed Sandbox result through the Factory verifier', async () => {
    const sandboxResult = await verifySandboxFoundationTransition(clientFor(), null);
    expect(sandboxResult.kind).toBeDefined();
    const factoryResult = verifyClone(...verifyCloneArgs(), sandboxResult);
    expect(factoryResult.failures).toContain('Sandbox Foundation baseline is missing or has an unsupported version.');
  });

  test('fails closed when a nominally versioned result has ok false but no diagnostics', () => {
    const factoryResult = verifyClone(...verifyCloneArgs(), { kind: 'sandbox-foundation-rollups/v1', ok: false, failures: [] });
    expect(factoryResult.failures).toContain('Sandbox Foundation rollup transition failed.');
  });
});
