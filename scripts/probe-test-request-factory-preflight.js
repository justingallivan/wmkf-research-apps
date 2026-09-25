#!/usr/bin/env node

/**
 * Read-only Stage 0 census for the admin Test Request Factory.
 *
 * This intentionally reads tracked source only. It does not import runtime
 * services, load environment variables, contact Dataverse/Graph/Postgres, or
 * print process environment values. A successful report is a source census,
 * never proof of tenant metadata or platform automation.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const FIELD_ROLES = Object.freeze({
  preallocatedGenerated: [
    ['akoya_requestid', 'server-side run UUID; never copied from source'],
  ],
  serverReadbackOnly: [
    ['akoya_requestnum', 'server autonumber; omitted from create and captured after create'],
  ],
  serverSelectedReplacementLookups: [
    ['akoya_applicantid@odata.bind', 'factory candidate verified by dated relationship receipt; configured test organization, never source account/contact'],
    ['akoya_primarycontactid', 'omitted in Basic V1; test persona only when a recipe requires it'],
    ['wmkf_projectleader', 'omitted in Basic V1; test persona only when a recipe requires it'],
  ],
  recipeSelectedAttributes: [
    ['akoya_title', 'request identity/display; recipe-owned replacement or sanitized copy'],
    ['akoya_fiscalyear', 'cycle identity; recipe-owned value'],
    ['akoya_programid', 'program lookup; recipe-owned configured value'],
    ['wmkf_grantprogram', 'grant-program lookup; recipe-owned configured value'],
    ['wmkf_type', 'request type; recipe-owned configured value'],
    ['wmkf_meetingdate', 'meeting-date eligibility; recipe-owned value'],
    ['akoya_requeststatus', 'only an explicitly supported recipe lifecycle value'],
    ['wmkf_triagestatus', 'only an explicitly supported recipe visibility value'],
  ],
});

const FIELD_CANDIDATES = Object.freeze(Object.values(FIELD_ROLES).flat());

const SOURCES = Object.freeze([
  'lib/dataverse/adapters/grant-request.js',
  'lib/dataverse/adapters/sharepoint-document-location.js',
  'lib/utils/sharepoint-buckets.js',
  'lib/services/cron/drain-submissions-service.js',
  'shared/config/workbenchVisibility.js',
  'lib/services/workbench/request-search-service.js',
  'lib/services/site-visit-materials/collection-service.js',
  'lib/services/site-visit/logistics-service.js',
  'lib/services/initial-assessment/artifact-lineage.js',
  'lib/services/initial-assessment/artifact-service.js',
  'lib/services/initial-assessment/artifact-model.js',
  'lib/services/initial-assessment/controls-service.js',
  'lib/utils/auth.js',
  'docs/REVIEWER_MATERIALS_FOLDER_SPEC.md',
  'docs/atlas/dataverse-akoya-request.md',
]);

const FANOUT = Object.freeze([
  ['OData visibility filter', 'shared/config/workbenchVisibility.js', 'buildVisibilityFilter'],
  ['row-level direct-ID eligibility', 'shared/config/workbenchVisibility.js', 'isVisibleRequestRow'],
  ['FetchXML meeting-date aggregation', 'lib/dataverse/adapters/grant-request.js', 'aggregateMeetingDateCycles'],
  ['Dataverse Search request search', 'lib/services/workbench/request-search-service.js', 'searchRequests'],
  ['direct-ID request lookup', 'lib/services/workbench/request-search-service.js', 'grantRequestAdapter.findByIds'],
  ['materials collection eligibility', 'lib/services/site-visit-materials/collection-service.js', 'isVisibleRequestRow'],
  ['site-visit scheduling eligibility', 'lib/services/site-visit/logistics-service.js', 'isVisibleRequestRow'],
]);

function read(relative) {
  const absolute = path.join(ROOT, relative);
  if (!fs.existsSync(absolute)) return null;
  return fs.readFileSync(absolute, 'utf8');
}

function lineOf(source, needle) {
  const index = source.indexOf(needle);
  return index < 0 ? null : source.slice(0, index).split('\n').length;
}

function evidence(relative, needle) {
  const source = read(relative);
  if (source == null) return { file: relative, line: null, found: false };
  return { file: relative, line: lineOf(source, needle), found: source.includes(needle) };
}

function occurrences(source, needle) {
  let count = 0;
  let cursor = 0;
  while ((cursor = source.indexOf(needle, cursor)) >= 0) {
    count += 1;
    cursor += needle.length;
  }
  return count;
}

function buildReport() {
  const missingSources = SOURCES.filter((relative) => read(relative) == null);
  const fields = FIELD_CANDIDATES.map(([field, rationale]) => {
    const hits = SOURCES
      .map((relative) => evidence(relative, field))
      .filter((hit) => hit.found)
      .map(({ file, line }) => ({ file, line }));
    return { field, rationale, status: hits.length ? 'SOURCE_CANDIDATE' : 'NO_SOURCE_HIT', evidence: hits };
  });

  const grantRequest = read('lib/dataverse/adapters/grant-request.js') || '';
  const locationAdapter = read('lib/dataverse/adapters/sharepoint-document-location.js') || '';
  const bucketResolver = read('lib/utils/sharepoint-buckets.js') || '';
  const auth = read('lib/utils/auth.js') || '';

  return {
    mode: 'READ_ONLY_SOURCE_CENSUS',
    generatedAt: new Date().toISOString(),
    tenantState: 'NOT_VERIFIED_LIVE',
    missingSources,
    sourceFieldCandidates: fields,
    fieldRoles: FIELD_ROLES,
    creationAndNumbering: {
      intakeOnlyBindingPrecedent: evidence('lib/services/cron/drain-submissions-service.js', 'akoya_Account@odata.bind'),
      adapterCreate: evidence('lib/dataverse/adapters/grant-request.js', 'export async function create(data)'),
      suppliedGuid: evidence('lib/services/cron/drain-submissions-service.js', 'akoya_requestid: job.request_id'),
      serverNumberReadback: evidence('lib/services/cron/drain-submissions-service.js', 'const akoyaRequestnum = created?.akoya_requestnum'),
      duplicatePkRecovery: evidence('lib/services/cron/drain-submissions-service.js', 'if (cls.category === \'duplicate_pk\')'),
      numberAuthority: 'SERVER_RESPONSE_THEN_READBACK',
    },
    sharePointLocation: {
      authority: 'UNRESOLVED_PLATFORM_OR_VENDOR_AUTOMATION',
      inspectedAdapterHasCreateSeam: /createRecord\s*\(/.test(locationAdapter),
      resolverRequiresResolvedParents: bucketResolver.includes('requireResolvedParents'),
      sourceEvidence: [
        evidence('lib/dataverse/adapters/sharepoint-document-location.js', 'export async function findByRegardingObject'),
        evidence('lib/utils/sharepoint-buckets.js', 'if (requireResolvedParents && !resolvedLibrary)'),
        evidence('lib/services/initial-assessment/artifact-lineage.js', 'requireResolvedParents: true'),
      ],
      implementationGate: 'BLOCK_BASIC_VERIFICATION_UNTIL_NEW_REQUEST_HAS_EXACTLY_ONE_DYNAMICS_TRACKED_BUCKET',
    },
    visibilityAndSearchFanout: FANOUT.map(([surface, file, symbol]) => ({
      surface,
      symbol,
      evidence: evidence(file, symbol),
    })),
    metadataReadiness: {
      status: 'NOT_VERIFIED_LIVE',
      sourceOnlySchemaEvidence: [
        evidence('docs/atlas/dataverse-akoya-request.md', 'Key fields (live, sample-probed'),
        evidence('lib/dataverse/adapters/grant-request.js', 'export async function create(data)'),
      ],
      requiredLiveChecks: [
        'createable/required fields for akoya_requests in target tenant',
        'server autonumber behavior and representation response',
        'marker field logical name and indexed/searchable metadata',
        'SharePoint document-location auto-provisioner or approved owner',
        'test organization/persona GUIDs and retention policy',
      ],
    },
    auth: {
      guard: 'requireSuperuser',
      evidence: evidence('lib/utils/auth.js', 'export async function requireSuperuser(req, res)'),
      routeInventory: 'NOT_IMPLEMENTED_YET',
    },
    knownOffPlatformConsumers: [
      { name: 'PA narrative/package flow', source: 'docs/REVIEWER_MATERIALS_FOLDER_SPEC.md', evidence: evidence('docs/REVIEWER_MATERIALS_FOLDER_SPEC.md', 'creates or replaces'), liveStatus: 'UNVERIFIED_LIVE' },
      { name: 'AkoyaGO OnCreate defaults', source: 'lib/services/cron/drain-submissions-service.js', evidence: evidence('lib/services/cron/drain-submissions-service.js', 'AkoyaGO OnCreate plugin defaults'), liveStatus: 'UNVERIFIED_LIVE' },
      { name: 'request-status PA/post-create PATCH', source: 'docs/atlas/dataverse-akoya-request.md', evidence: evidence('docs/atlas/dataverse-akoya-request.md', 'status-driven intake-recompute flow'), liveStatus: 'UNVERIFIED_LIVE' },
    ],
    safety: {
      networkCalls: 'NONE',
      writes: 'NONE',
      secretsPrinted: 'NONE',
      importedRuntimeServices: 'NONE',
      adapterCreateCallCount: occurrences(grantRequest, 'export async function create(data)'),
      locationCreateCallCount: occurrences(locationAdapter, 'createRecord('),
      authSourceLoaded: Boolean(auth),
    },
  };
}

function validateReport(report) {
  const errors = [];
  if (report.mode !== 'READ_ONLY_SOURCE_CENSUS') errors.push('mode must remain read-only');
  if (report.tenantState !== 'NOT_VERIFIED_LIVE') errors.push('tenant state must remain unverified');
  if (report.safety.networkCalls !== 'NONE' || report.safety.writes !== 'NONE') errors.push('preflight must not perform I/O');
  if (report.sharePointLocation.authority !== 'UNRESOLVED_PLATFORM_OR_VENDOR_AUTOMATION') errors.push('location authority must remain unresolved');
  if (!report.creationAndNumbering.adapterCreate.found) errors.push('grant-request create seam missing');
  if (!report.creationAndNumbering.serverNumberReadback.found) errors.push('server number readback evidence missing');
  if (!report.creationAndNumbering.duplicatePkRecovery.found) errors.push('duplicate-PK recovery evidence missing');
  if (!report.auth.evidence.found) errors.push('requireSuperuser evidence missing');
  if (report.sharePointLocation.inspectedAdapterHasCreateSeam) errors.push('unexpected SharePoint location create seam found in inspected adapter');
  if (!report.fieldRoles?.preallocatedGenerated?.some(([field]) => field === 'akoya_requestid')) {
    errors.push('preallocated identity role must include akoya_requestid');
  }
  if (!report.fieldRoles?.serverReadbackOnly?.some(([field]) => field === 'akoya_requestnum')) {
    errors.push('server readback role must include akoya_requestnum');
  }
  const anchors = [...Object.values(report.creationAndNumbering).filter(value => value && typeof value === 'object'), ...report.sharePointLocation.sourceEvidence, ...report.metadataReadiness.sourceOnlySchemaEvidence];
  if (anchors.some(anchor => !anchor.found)) errors.push('required source anchor missing');
  const expectedRoles = Object.fromEntries(Object.entries(FIELD_ROLES).flatMap(([role, fields]) => fields.map(([field]) => [field, role])));
  for (const [role, fields] of Object.entries(report.fieldRoles || {})) {
    for (const [field] of fields) if (expectedRoles[field] !== role) errors.push(`incorrect field role: ${field}`);
  }
  for (const [field, role] of Object.entries(expectedRoles)) {
    if (!report.fieldRoles?.[role]?.some(([name]) => name === field)) errors.push(`missing field role: ${field}`);
  }
  if (report.visibilityAndSearchFanout.length !== FANOUT.length || report.knownOffPlatformConsumers.length !== 3) errors.push('required evidence inventory incomplete');
  for (const relative of SOURCES) {
    if (report.missingSources.includes(relative)) errors.push(`required source missing: ${relative}`);
  }
  for (const item of report.visibilityAndSearchFanout) {
    if (!item.evidence.found) errors.push(`required fan-out evidence missing: ${item.surface}`);
  }
  for (const consumer of report.knownOffPlatformConsumers) {
    if (!consumer.evidence.found) errors.push(`required consumer evidence missing: ${consumer.name}`);
  }
  return errors;
}

function runSelfTest() {
  const report = buildReport();
  const errors = validateReport(report);
  if (errors.length) throw new Error(`preflight self-test failed: ${errors.join('; ')}`);
  if (report.safety.secretsPrinted !== 'NONE' || report.safety.networkCalls !== 'NONE') {
    throw new Error('self-test detected changed safety declarations (actual I/O requires code review)');
  }
  const missingSource = { ...report, missingSources: [SOURCES[0]] };
  if (!validateReport(missingSource).some((error) => error.includes('required source missing'))) {
    throw new Error('missing-source fixture was not rejected');
  }
  const missingAnchor = { ...report, visibilityAndSearchFanout: report.visibilityAndSearchFanout.map((item, index) => index === 0 ? { ...item, evidence: { found: false } } : item) };
  if (!validateReport(missingAnchor).some((error) => error.includes('required fan-out evidence missing'))) {
    throw new Error('missing-anchor fixture was not rejected');
  }
  const unexpectedCreator = { ...report, sharePointLocation: { ...report.sharePointLocation, inspectedAdapterHasCreateSeam: true } };
  if (!validateReport(unexpectedCreator).some((error) => error.includes('unexpected SharePoint location create seam'))) {
    throw new Error('unexpected-location-creator fixture was not rejected');
  }
  const wrongRole = { ...report, fieldRoles: { ...report.fieldRoles, preallocatedGenerated: [['akoya_requestnum', 'bad']] } };
  if (!validateReport(wrongRole).some((error) => error.includes('preallocated identity role'))) {
    throw new Error('field-role fixture was not rejected');
  }
  const missingProvisionerAnchor = { ...report, sharePointLocation: { ...report.sharePointLocation, sourceEvidence: [{ found: false }] } };
  if (!validateReport(missingProvisionerAnchor).includes('required source anchor missing')) throw new Error('missing provisioner anchor accepted');
  const copiedIdentity = { ...report, fieldRoles: { ...report.fieldRoles, recipeSelectedAttributes: [...report.fieldRoles.recipeSelectedAttributes, ['akoya_requestid', 'unsafe copy']] } };
  if (!validateReport(copiedIdentity).some(error => error.includes('incorrect field role'))) throw new Error('copied identity accepted');
  console.log('test-request-factory-preflight self-test OK — evidence-loss and field-role negative fixtures passed. Read-only behavior is a code-review property.');
}

if (process.argv.includes('--self-test')) {
  runSelfTest();
} else {
  const report = buildReport();
  const errors = validateReport(report);
  if (errors.length) {
    console.error('test-request-factory-preflight FAILED:');
    errors.forEach((error) => console.error(`  - ${error}`));
    process.exit(1);
  }
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else {
    console.log('test-request-factory-preflight OK — source-only, read-only census.');
    console.log(`  fields with source hits: ${report.sourceFieldCandidates.filter((field) => field.evidence.length).length}/${report.sourceFieldCandidates.length}`);
    console.log(`  location authority: ${report.sharePointLocation.authority}`);
    console.log(`  tenant metadata: ${report.tenantState}`);
    console.log('  no Dataverse, Graph, Postgres, Blob, or environment access performed.');
  }
}

module.exports = { buildReport, validateReport };
