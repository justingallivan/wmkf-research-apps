/**
 * Strict Sandbox-only Foundation rollup verification for one Test Request
 * Factory create. This is intentionally separate from the production
 * foundation-transition contract: Sandbox accepts only a pre-journaled,
 * exact active-Request set transition and the observed Dataverse rollup
 * metadata changes. Unknown schema or row changes fail closed.
 */
import crypto from 'node:crypto';

export const SANDBOX_FOUNDATION_VERIFICATION_KIND = 'sandbox-foundation-rollups/v1';
export const SANDBOX_REQUEST_COUNT_ROLLUP = 'akoya_countofrequests';

const SANDBOX_ORIGIN = 'https://orgd9e66399.crm.dynamics.com';
const ACCOUNT_ENTITY = "EntityDefinitions(LogicalName='account')/Attributes";
const PAGE_CAP = 100;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Live Sandbox metadata probe (2026-10-15): these are all SourceType=2
// account rollups. Formula source membership is pinned separately below.
const EXPECTED_ROLLUPS = Object.freeze([
  ['akoya_countofawards', 'Integer', true],
  ['akoya_countofrequests', 'Integer', true],
  ['akoya_mostrecentgrant', 'DateTime', true],
  ['akoya_totalgrants', 'Money', true],
  ['akoya_totalgrants_base', 'Money', false],
  ['opendeals', 'Integer', false],
  ['openrevenue', 'Money', false],
  ['openrevenue_base', 'Money', false],
  ['wmkf_countofconcepts', 'Integer', false],
  ['wmkf_countofdiscretionarygrant', 'Integer', true],
  ['wmkf_countofprogramgrants', 'Integer', true],
  ['wmkf_sumofdiscretionarygrants', 'Money', true],
  ['wmkf_sumofdiscretionarygrants_base', 'Money', false],
  ['wmkf_sumofprogramgrants', 'Money', true],
  ['wmkf_sumofprogramgrants_base', 'Money', false],
]);

const COMPANION_FIELDS = Object.freeze(EXPECTED_ROLLUPS
  .map(([name]) => name)
  .filter((name) => !name.endsWith('_base'))
  .flatMap((name) => [`${name}_date`, `${name}_state`]));
const EXPECTED_ROLLUP_MAP = new Map(EXPECTED_ROLLUPS.map(([name, type, requestBacked]) => (
  [name, { name, type, requestBacked }]
)));

// SHA-256 pins of all 15 observed FormulaDefinitions in the registered
// Sandbox, read 2026-10-15 by the read-only probe. The Request-count formula
// counts statecode=Active. Every formula must match its reviewed pin and
// the metadata digest captured before this individual operation.
const EXPECTED_FORMULA_DIGESTS = Object.freeze({
  akoya_countofawards: '5b58adbc1a0e5337f32e2ace0628de5084f98b8c12475c76cac09d351b99fae2',
  akoya_countofrequests: 'b1b14003aa079cc30cd21dd5a9354bb61119d09174962547cfb376017f8c549a',
  akoya_mostrecentgrant: '705ebb90f3b7ea92a2acc36bf4d31a7d6fcfc331bff35e1b3db9cdea7eb589c2',
  akoya_totalgrants: '8fd10788b03aeed6c7e0fc1ca0d630963c8b4d59fa9a067067c710a934358f92',
  akoya_totalgrants_base: '12ae32cb1ec02d01eda3581b127c1fee3b0dc53572ed6baf239721a03d82e126',
  opendeals: '7cd1d7067d77a6f2764fef9dc438c3ea744b6f02858f0f1fa9e4056c8a214189',
  openrevenue: '55245ae250f72f9fcffae7d6587e320c2eaacb96d7550ece7e672e16e2ec42f5',
  openrevenue_base: '12ae32cb1ec02d01eda3581b127c1fee3b0dc53572ed6baf239721a03d82e126',
  wmkf_countofconcepts: '64d4f5f4ec9dfc03be8c8d210d5f2759019c4883297d91321d737ec3a5448027',
  wmkf_countofdiscretionarygrant: '46325bd10cf6da33e7138ff6750086403b5122ce49fd98fe839b4c849ee7744e',
  wmkf_countofprogramgrants: 'f34cd7c547f1fe3520133bedde53da2e1e095e7e0483793cf0f6f6079943d47f',
  wmkf_sumofdiscretionarygrants: '33a5c1b7aae70d16d0f3fc4343efe463b586d7f30896bf9587af884c72fff080',
  wmkf_sumofdiscretionarygrants_base: '12ae32cb1ec02d01eda3581b127c1fee3b0dc53572ed6baf239721a03d82e126',
  wmkf_sumofprogramgrants: 'e1c725b8fb804568d65daacc223d39bd665ef789cd34b17f81a18c1f873255f7',
  wmkf_sumofprogramgrants_base: '12ae32cb1ec02d01eda3581b127c1fee3b0dc53572ed6baf239721a03d82e126',
});

const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const normalizeGuid = (value, label) => {
  const id = String(value || '').toLowerCase();
  if (!GUID.test(id)) throw new Error(`Sandbox Foundation verifier requires a valid ${label}.`);
  return id;
};
const stableValue = (value) => value === undefined ? null : value;

function normalizeNextLink(link) {
  if (!link) return null;
  const url = new URL(link, SANDBOX_ORIGIN);
  if (url.origin !== SANDBOX_ORIGIN || !url.pathname.startsWith('/api/data/v9.2/')) {
    throw new Error('Sandbox Foundation verifier refused a cross-origin or non-Dataverse continuation link.');
  }
  return url.toString();
}

async function getAllPages(client, initialPath, label) {
  let path = initialPath;
  const rows = [];
  for (let page = 0; path; page += 1) {
    if (page >= PAGE_CAP) throw new Error(`Sandbox Foundation verifier ${label} exceeded ${PAGE_CAP} pages.`);
    const response = await client.get(path);
    if (!response?.ok || !response.body || !Array.isArray(response.body.value)) {
      throw new Error(`Sandbox Foundation verifier could not read ${label} (HTTP ${response?.status ?? 'unknown'}).`);
    }
    rows.push(...response.body.value);
    path = normalizeNextLink(response.body['@odata.nextLink']);
  }
  return rows;
}

async function readRollupMetadata(client, { allowUnpinnedForProbe = false } = {}) {
  const typed = [
    ['Integer', 'IntegerAttributeMetadata'],
    ['Money', 'MoneyAttributeMetadata'],
    ['DateTime', 'DateTimeAttributeMetadata'],
    ['Decimal', 'DecimalAttributeMetadata'],
  ];
  const collected = [];
  for (const [type, cast] of typed) {
    const rows = await getAllPages(
      client,
      `/${ACCOUNT_ENTITY}/Microsoft.Dynamics.CRM.${cast}?$select=LogicalName,SourceType,FormulaDefinition&$top=5000`,
      `${type} attribute metadata`,
    );
    for (const row of rows) {
      if (Number(row.SourceType) !== 2) continue;
      if (!EXPECTED_ROLLUP_MAP.has(row.LogicalName)) {
        throw new Error(`Sandbox account has an unreviewed SourceType=2 rollup: ${row.LogicalName}.`);
      }
      const expected = EXPECTED_ROLLUP_MAP.get(row.LogicalName);
      const formula = String(row.FormulaDefinition || '');
      const formulaDigest = hash(formula);
      const expectedFormulaDigest = EXPECTED_FORMULA_DIGESTS[row.LogicalName];
      if (expected.type !== type
          || (expectedFormulaDigest && formulaDigest !== expectedFormulaDigest)
          || (formula.includes('akoya_request') !== expected.requestBacked)
          || (!expectedFormulaDigest && !allowUnpinnedForProbe)) {
        throw new Error(`Sandbox rollup metadata changed for ${row.LogicalName}.`);
      }
      collected.push({
        name: row.LogicalName,
        type,
        sourceType: Number(row.SourceType),
        formulaDigest,
      });
    }
  }
  collected.sort((a, b) => a.name.localeCompare(b.name));
  if (collected.length !== EXPECTED_ROLLUPS.length
      || collected.some((row, index) => row.name !== [...EXPECTED_ROLLUP_MAP.keys()].sort()[index])) {
    throw new Error('Sandbox account SourceType=2 rollup set differs from the reviewed 15-field contract.');
  }
  return { fields: collected, digest: hash(collected) };
}

async function readAccount(client, accountId) {
  const response = await client.get(`/accounts(${accountId})`);
  if (!response?.ok || !response.body || String(response.body.accountid || '').toLowerCase() !== accountId) {
    throw new Error('Sandbox Foundation account readback failed or returned a different account.');
  }
  const required = [
    'accountid', 'versionnumber', 'modifiedon',
    ...EXPECTED_ROLLUPS.map(([field]) => field), ...COMPANION_FIELDS,
  ];
  const missing = required.filter((field) => !Object.prototype.hasOwnProperty.call(response.body, field));
  if (missing.length) throw new Error(`Sandbox Foundation account read lacks required rollup field(s): ${missing.join(', ')}.`);
  if (!String(response.body.versionnumber || '') || !Number.isFinite(Date.parse(response.body.modifiedon))) {
    throw new Error('Sandbox Foundation account row metadata is invalid.');
  }
  return response.body;
}

async function readActiveApplicantRequestIds(client, applicantId) {
  const filter = encodeURIComponent(`_akoya_applicantid_value eq ${applicantId} and statecode eq 0`);
  const rows = await getAllPages(
    client,
    `/akoya_requests?$select=akoya_requestid,statecode&$filter=${filter}&$orderby=akoya_requestid asc&$top=5000`,
    'active applicant Request census',
  );
  const ids = rows.map((row) => normalizeGuid(row.akoya_requestid, 'active Request ID'));
  if (rows.some((row) => Number(row.statecode) !== 0) || new Set(ids).size !== ids.length) {
    throw new Error('Sandbox active applicant Request census contains a non-active or duplicate row.');
  }
  return ids.sort();
}

async function readContactDigest(client, foundationId) {
  const filter = encodeURIComponent(`_parentcustomerid_value eq ${foundationId}`);
  const rows = await getAllPages(
    client,
    `/contacts?$select=contactid,versionnumber,modifiedon&$filter=${filter}&$orderby=contactid asc&$top=5000`,
    'Foundation Contact census',
  );
  const contacts = rows.map((row) => ({
    contactid: normalizeGuid(row.contactid, 'Foundation Contact ID'),
    versionnumber: String(row.versionnumber || ''),
    modifiedon: String(row.modifiedon || ''),
  })).sort((a, b) => a.contactid.localeCompare(b.contactid));
  if (new Set(contacts.map((row) => row.contactid)).size !== contacts.length
      || contacts.some((row) => !row.versionnumber || !Number.isFinite(Date.parse(row.modifiedon)))) {
    throw new Error('Sandbox Foundation Contact census is incomplete or contains duplicate rows.');
  }
  return { count: contacts.length, digest: hash(contacts) };
}

function accountDigests(account) {
  const rollupNames = new Set([
    ...EXPECTED_ROLLUP_MAP.keys(), ...COMPANION_FIELDS,
    'accountid', 'versionnumber', 'modifiedon',
  ]);
  const nonRollup = Object.fromEntries(Object.entries(account)
    .filter(([key]) => !key.startsWith('@') && !key.includes('@') && !rollupNames.has(key))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => [key, hash(stableValue(value))]));
  const rollups = Object.fromEntries([...EXPECTED_ROLLUP_MAP.keys()].map((field) => [field, hash(stableValue(account[field]))]));
  const companions = Object.fromEntries(COMPANION_FIELDS.map((field) => [field, hash(stableValue(account[field]))]));
  return { nonRollupDigest: hash(nonRollup), rollups, companions };
}

function sortedIdDigest(ids) {
  return hash([...ids].sort());
}

export async function captureSandboxFoundationBaseline(client, {
  foundationId, applicantId, reservedRequestId, capturedAt = new Date().toISOString(),
}) {
  const accountId = normalizeGuid(foundationId, 'Foundation account ID');
  const applicant = normalizeGuid(applicantId, 'applicant account ID');
  const reservedId = normalizeGuid(reservedRequestId, 'reserved Request ID');
  if (accountId !== applicant) throw new Error('Sandbox rollup verifier requires the Foundation account to be the cloned Request applicant.');
  const [metadata, account, activeIds, contacts] = await Promise.all([
    readRollupMetadata(client), readAccount(client, accountId), readActiveApplicantRequestIds(client, applicant),
    readContactDigest(client, accountId),
  ]);
  if (String(account.name || '') !== 'W. M. Keck Foundation') throw new Error('Sandbox Foundation baseline resolved an unexpected account.');
  if (activeIds.includes(reservedId)) throw new Error('Reserved Request ID already exists in the active applicant census.');
  const digests = accountDigests(account);
  const activeCount = Number(account[SANDBOX_REQUEST_COUNT_ROLLUP]);
  if (!Number.isInteger(activeCount) || activeCount !== activeIds.length) {
    throw new Error(`Sandbox Foundation active Request rollup (${activeCount}) does not equal the complete active Request census (${activeIds.length}).`);
  }
  for (const field of COMPANION_FIELDS) {
    if (field.endsWith('_state')) {
      if (Number(account[field]) !== 1) throw new Error(`Sandbox Foundation ${field} is not Calculated before create.`);
    } else if (!Number.isFinite(Date.parse(account[field]))) {
      throw new Error(`Sandbox Foundation ${field} is not a valid rollup timestamp before create.`);
    }
  }
  const expectedIds = [...activeIds, reservedId].sort();
  return {
    kind: SANDBOX_FOUNDATION_VERIFICATION_KIND,
    capturedAt: new Date(capturedAt).toISOString(),
    foundationId: accountId,
    applicantId: applicant,
    expectedRequestId: reservedId,
    metadataDigest: metadata.digest,
    metadataFields: metadata.fields.map(({ name, type }) => ({ name, type })),
    accountVersion: String(account.versionnumber),
    accountModifiedOn: String(account.modifiedon),
    nonRollupDigest: digests.nonRollupDigest,
    rollups: digests.rollups,
    companions: digests.companions,
    foundationContactCount: contacts.count,
    foundationContactsDigest: contacts.digest,
    activeRequestCount: activeIds.length,
    activeRequestIdsDigest: sortedIdDigest(activeIds),
    expectedAfterActiveRequestCount: expectedIds.length,
    expectedAfterActiveRequestIdsDigest: sortedIdDigest(expectedIds),
  };
}

function validTimestampInWindow(value, start, end) {
  const time = Date.parse(value);
  return Number.isFinite(time) && time >= Date.parse(start) && time <= Date.parse(end);
}

export async function verifySandboxFoundationTransition(client, baseline, {
  foundationId = baseline?.foundationId,
  applicantId = baseline?.applicantId,
  reservedRequestId = baseline?.expectedRequestId,
  startedAt,
  verifiedAt = new Date().toISOString(),
} = {}) {
  const failures = [];
  if (baseline?.kind !== SANDBOX_FOUNDATION_VERIFICATION_KIND) {
    return {
      kind: SANDBOX_FOUNDATION_VERIFICATION_KIND,
      ok: false,
      failures: ['Sandbox Foundation baseline is missing or has an unsupported version.'],
    };
  }
  const ids = [
    ['Foundation account ID', foundationId, baseline.foundationId],
    ['applicant account ID', applicantId, baseline.applicantId],
    ['reserved Request ID', reservedRequestId, baseline.expectedRequestId],
  ];
  for (const [label, actual, expected] of ids) {
    try {
      if (normalizeGuid(actual, label) !== normalizeGuid(expected, label)) failures.push(`Sandbox ${label} differs from the journaled baseline.`);
    } catch (error) { failures.push(error.message); }
  }
  if (failures.length) return { kind: SANDBOX_FOUNDATION_VERIFICATION_KIND, ok: false, failures };
  const [metadata, account, activeIds, contacts] = await Promise.all([
    readRollupMetadata(client), readAccount(client, baseline.foundationId), readActiveApplicantRequestIds(client, baseline.applicantId),
    readContactDigest(client, baseline.foundationId),
  ]);
  if (metadata.digest !== baseline.metadataDigest) failures.push('Sandbox SourceType=2 rollup metadata changed during create.');
  if (activeIds.length !== baseline.expectedAfterActiveRequestCount
      || sortedIdDigest(activeIds) !== baseline.expectedAfterActiveRequestIdsDigest
      || !activeIds.includes(baseline.expectedRequestId)) {
    failures.push('Active applicant Request census is not exactly the baseline set plus the reserved Request.');
  }
  if (accountDigests(account).nonRollupDigest !== baseline.nonRollupDigest) failures.push('Protected non-rollup Foundation account fields changed.');
  if (String(account.modifiedon) !== baseline.accountModifiedOn) failures.push('Foundation modifiedon changed during Sandbox create.');
  if (contacts.count !== baseline.foundationContactCount || contacts.digest !== baseline.foundationContactsDigest) {
    failures.push('Foundation Contact census changed during Sandbox create.');
  }

  const changedRollups = [];
  const liveRequestCount = Number(account[SANDBOX_REQUEST_COUNT_ROLLUP]);
  if (!Number.isInteger(liveRequestCount) || liveRequestCount !== activeIds.length) {
    failures.push('Foundation active Request count rollup does not equal the complete active Request census.');
  }
  for (const [field] of EXPECTED_ROLLUPS) {
    if (field === SANDBOX_REQUEST_COUNT_ROLLUP) {
      if (hash(stableValue(account[field])) !== baseline.rollups[field]) changedRollups.push(field);
      continue;
    }
    if (hash(stableValue(account[field])) !== baseline.rollups[field]) failures.push(`Protected Foundation rollup ${field} changed.`);
  }
  const end = new Date(verifiedAt).toISOString();
  const start = new Date(startedAt || baseline.capturedAt).toISOString();
  for (const field of COMPANION_FIELDS) {
    if (field.endsWith('_state')) {
      if (Number(account[field]) !== 1) failures.push(`Foundation ${field} is not Calculated after create.`);
      if (hash(stableValue(account[field])) !== baseline.companions[field]) failures.push(`Foundation rollup state ${field} changed.`);
      continue;
    }
    if (hash(stableValue(account[field])) !== baseline.companions[field]) {
      changedRollups.push(field);
      if (!Number.isFinite(Date.parse(account[field])) || !validTimestampInWindow(account[field], start, end)) {
        failures.push(`Foundation rollup timestamp ${field} moved outside the create window.`);
      }
    }
  }
  const versionChanged = String(account.versionnumber) !== baseline.accountVersion;
  if (versionChanged && changedRollups.length === 0) failures.push('Foundation versionnumber changed without a validated rollup field change.');
  return {
    kind: SANDBOX_FOUNDATION_VERIFICATION_KIND,
    ok: failures.length === 0,
    failures,
    changedRollups,
    versionChanged,
    activeRequestCount: activeIds.length,
    activeRequestIdsDigest: sortedIdDigest(activeIds),
    accountVersion: String(account.versionnumber),
  };
}

export const SANDBOX_FOUNDATION_ROLLUP_CONTRACT = EXPECTED_ROLLUPS;
export async function readSandboxRollupMetadata(client) {
  return readRollupMetadata(client, { allowUnpinnedForProbe: true });
}
