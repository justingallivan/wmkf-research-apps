#!/usr/bin/env node
/**
 * Aggregate-only historical-exposure assessment. Defaults to a local plan.
 * --execute performs OAuth token issuance and allowlisted production GETs only.
 * Never invokes app routes, providers, imports, refreshes, sends or writes.
 * Current state and audit availability do not establish historical causation.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..');
const ORIGIN = 'https://wmkf.crm.dynamics.com';
const API = `${ORIGIN}/api/data/v9.2/`;
const MAX_PAGES = 40;
const MAX_ROWS = 20000;
const QUERIES = {
  requests: "akoya_requests?$select=akoya_requestid,statecode,_wmkf_projectleader_value,_wmkf_researchleader_value&$filter=_wmkf_projectleader_value eq null and _wmkf_researchleader_value ne null",
  suggestions: 'wmkf_appreviewersuggestions?$select=_wmkf_request_value,_wmkf_potentialreviewer_value,wmkf_selected',
  people: 'wmkf_potentialreviewerses?$select=wmkf_potentialreviewersid,statecode,wmkf_identitystatus,wmkf_identityverifiedanchorsjson,wmkf_identitybindingversion,wmkf_identityfieldlineagejson,wmkf_orcid,wmkf_googlescholarid,wmkf_primaryaffiliation,wmkf_hindex,wmkf_i10index,wmkf_totalcitations',
  model: "wmkf_appsystemsettings?$select=wmkf_settingkey,wmkf_settingvalue&$filter=wmkf_settingkey eq 'model_override:reviewer-finder:model'&$top=2",
  retention: "wmkf_appsystemsettings?$select=wmkf_settingkey,wmkf_settingvalue&$filter=wmkf_settingkey eq 'retention:blob_days'&$top=2",
  excluded: 'wmkf_appreviewersuggestions?$select=wmkf_appreviewersuggestionid&$filter=wmkf_applicantdisposition eq 100000001',
  prompts: 'wmkf_ai_prompts?$select=wmkf_ai_promptname,wmkf_promptversion,wmkf_ai_model,wmkf_ai_promptvariables,wmkf_ai_promptoutputschema&$filter=wmkf_ai_iscurrent eq true',
};
const PAGED_COLLECTIONS = new Set([
  'akoya_requests',
  'wmkf_appreviewersuggestions',
  'wmkf_potentialreviewerses',
  'wmkf_appsystemsettings',
  'wmkf_ai_prompts',
]);
const AUDIT_COLLECTIONS = new Set(['organizations', 'audits']);
const METADATA_ENTITIES = new Set(['akoya_request', 'wmkf_potentialreviewers', 'wmkf_appreviewersuggestion']);
const id = value => typeof value === 'string' ? value.toLowerCase() : '';
function anchorBucket(raw) {
  if (raw == null || raw === '') return 'missing';
  let anchors;
  try { anchors = JSON.parse(raw); } catch { return 'malformed_json'; }
  if (!Array.isArray(anchors)) return 'malformed_shape';
  // This is a conservative exposure inventory, not the runtime authorizer:
  // ORCID syntax is counted separately from checksum validity.
  const typed = anchors.filter(a => typeof a?.canonicalKey === 'string');
  return typed.some(a => /^(?:openalex:A[1-9]\d*|scholar:[A-Za-z0-9_-]{1,100}|orcid:\d{4}-\d{4}-\d{4}-\d{3}[\dX])$/i.test(a.canonicalKey.trim()))
    ? 'person_key_syntax_only' : 'no_base_key_syntax';
}

function validateGetUrl(input, { expectedPath = null, expectedQuery = null, method = 'GET' } = {}) {
  if (method !== 'GET') throw new Error('unsafe_get_method');
  const url = new URL(input, API);
  const prefix = '/api/data/v9.2/';
  const collection = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : '';
  const isPagedCollection = PAGED_COLLECTIONS.has(collection);
  const isAuditCollection = AUDIT_COLLECTIONS.has(collection);
  const metadataMatch = url.pathname.match(/^\/api\/data\/v9\.2\/EntityDefinitions\(LogicalName='([^']+)'\)$/);
  const isAllowedMetadata = Boolean(metadataMatch && METADATA_ENTITIES.has(metadataMatch[1]));
  let isAllowedHistory = false;
  if (collection === 'RetrieveRecordChangeHistory(Target=@target,PagingInfo=@paginginfo)') {
    try {
      const target = JSON.parse(url.searchParams.get('@target'));
      const paging = JSON.parse(url.searchParams.get('@paginginfo'));
      isAllowedHistory = [...url.searchParams.keys()].length === 2
        && Object.keys(target).length === 1
        && /^wmkf_potentialreviewerses\([a-f0-9-]{36}\)$/i.test(target['@odata.id'])
        && [3,4].includes(Object.keys(paging).length)
        && Object.keys(paging).every(key => ['Count','PageNumber','ReturnTotalRecordCount','PagingCookie'].includes(key))
        && (!paging.PagingCookie || (typeof paging.PagingCookie === 'string' && paging.PagingCookie.length <= 20000))
        && paging.Count === 10 && Number.isInteger(paging.PageNumber) && paging.PageNumber >= 1 && paging.PageNumber <= 5 && paging.ReturnTotalRecordCount === false;
    } catch { /* malformed function parameters never authorize a GET */ }
  }
  if (url.origin !== ORIGIN || url.username || url.password || url.hash
    || (!isPagedCollection && !isAuditCollection && !isAllowedMetadata && !isAllowedHistory)) {
    throw new Error('unsafe_get_path');
  }
  if (expectedPath && url.pathname !== expectedPath) throw new Error('unsafe_next_link');
  if (expectedQuery) {
    const allowed = new Set([...expectedQuery.keys(), '$skiptoken', '$skip']);
    for (const key of url.searchParams.keys()) {
      if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) throw new Error('unsafe_next_query');
    }
    for (const [key, value] of expectedQuery) {
      if (url.searchParams.get(key) !== value) throw new Error('unsafe_next_query');
    }
  }
  return url;
}

function aggregateWhenComplete(results) {
  const required = ['requests', 'suggestions', 'people'];
  const incomplete = required.filter(key => (
    !results[key] || results[key].complete !== true || results[key].status !== 200
  ));
  if (incomplete.length) {
    return {
      aggregate: null,
      state: 'unavailable',
      error: 'required_population_query_incomplete',
      incompleteQueries: incomplete,
    };
  }
  return {
    aggregate: aggregate(results.requests.rows, results.suggestions.rows, results.people.rows),
    state: 'complete',
    error: null,
    incompleteQueries: [],
  };
}

function peopleBreakdown(personIds, peopleById, requestCounts) {
  const ids = [...personIds];
  const statuses = {};
  const protectedAnchors = {};
  let protectedPeople = 0;
  let sharedPeople = 0;
  let protectedSharedPeople = 0;
  let protectedWithStoredFields = 0;
  let availablePeopleRows = 0;
  for (const personId of ids) {
    const row = peopleById.get(personId);
    if (!row) continue;
    availablePeopleRows++;
    const status = typeof row.wmkf_identitystatus === 'string' ? row.wmkf_identitystatus.trim().toLowerCase() : '';
    const bucket = ['confirmed', 'probable', 'unresolved', 'ambiguous'].includes(status) ? status : 'missing_or_other';
    statuses[bucket] = (statuses[bucket] || 0) + 1;
    const protectedStatus = bucket === 'confirmed' || bucket === 'probable';
    const shared = (requestCounts.get(personId) || 0) > 1;
    if (shared) sharedPeople++;
    if (protectedStatus) {
      protectedPeople++;
      const anchor = anchorBucket(row.wmkf_identityverifiedanchorsjson);
      protectedAnchors[anchor] = (protectedAnchors[anchor] || 0) + 1;
      if (shared) protectedSharedPeople++;
      if (['wmkf_orcid','wmkf_googlescholarid','wmkf_primaryaffiliation','wmkf_hindex','wmkf_i10index','wmkf_totalcitations'].some(k => row[k] != null && row[k] !== '')) protectedWithStoredFields++;
    }
  }
  return {
    distinctLinkedPeople: ids.length,
    availablePeopleRows,
    missingPeopleRows: ids.length - availablePeopleRows,
    statuses,
    protectedPeople,
    protectedAnchors,
    protectedWithStoredFields,
    sharedPeople,
    protectedSharedPeople,
  };
}

function aggregate(requests, suggestions, people) {
  const cohort = new Set(requests.map(r => id(r.akoya_requestid)));
  const links = new Map();
  let cohortLinks = 0, selectedCohortLinks = 0;
  const cohortPeople = new Set(), linkedCohortRequests = new Set();
  const activeLinkedPeople = new Set(), activeLinkedRequests = new Set(), activeRequests = new Set();
  const requestStates = new Map(requests.map(r => [id(r.akoya_requestid), r.statecode]));
  for (const row of suggestions) {
    const request = id(row._wmkf_request_value), person = id(row._wmkf_potentialreviewer_value);
    if (person && request) {
      if (!links.has(person)) links.set(person, new Set());
      links.get(person).add(request);
    }
    if (cohort.has(request)) {
      cohortLinks++; linkedCohortRequests.add(request);
      if (requestStates.get(request) === 0) activeRequests.add(request);
      if (row.wmkf_selected === true) selectedCohortLinks++;
      if (person) {
        cohortPeople.add(person);
        if (requestStates.get(request) === 0) {
          activeLinkedPeople.add(person);
          activeLinkedRequests.add(request);
        }
      }
    }
  }
  const statuses = {}, protectedAnchors = {}, crossRequest = { zero: 0, one: 0, multiple: 0 };
  let protectedPeople = 0, protectedShared = 0, lineagePresent = 0, protectedWithStoredFields = 0;
  const peopleById = new Map();
  for (const row of people) {
    const person = id(row.wmkf_potentialreviewersid);
    if (person) peopleById.set(person, row);
    const status = typeof row.wmkf_identitystatus === 'string' ? row.wmkf_identitystatus.trim().toLowerCase() : '';
    const bucket = ['confirmed', 'probable', 'unresolved', 'ambiguous'].includes(status) ? status : 'missing_or_other';
    statuses[bucket] = (statuses[bucket] || 0) + 1;
    const requestCount = links.get(person)?.size || 0;
    crossRequest[requestCount === 0 ? 'zero' : requestCount === 1 ? 'one' : 'multiple']++;
    if (row.wmkf_identitybindingversion != null || row.wmkf_identityfieldlineagejson) lineagePresent++;
    if (bucket !== 'confirmed' && bucket !== 'probable') continue;
    protectedPeople++;
    if (requestCount > 1) protectedShared++;
    const anchors = anchorBucket(row.wmkf_identityverifiedanchorsjson);
    protectedAnchors[anchors] = (protectedAnchors[anchors] || 0) + 1;
    if (['wmkf_orcid','wmkf_googlescholarid','wmkf_primaryaffiliation','wmkf_hindex','wmkf_i10index','wmkf_totalcitations'].some(k => row[k] != null && row[k] !== '')) protectedWithStoredFields++;
  }
  return {
    piCurrentShape: { allStates: requests.length, active: requests.filter(r => r.statecode === 0).length, linkedSuggestions: cohortLinks, selectedLinkedSuggestions: selectedCohortLinks, linkedRequests: linkedCohortRequests.size, distinctLinkedPeople: cohortPeople.size },
    people: { rows: people.length, statuses, protectedPeople, protectedAnchors, protectedWithStoredFields, crossRequest, protectedShared, currentBindingOrLineagePresent: lineagePresent },
    missingProjectLeaderWithResearchLeader: {
      requests: requests.length,
      linkedSuggestions: cohortLinks,
      selectedLinkedSuggestions: selectedCohortLinks,
      linkedRequests: linkedCohortRequests.size,
      linkedPeople: peopleBreakdown(cohortPeople, peopleById, new Map([...links].map(([person, requestIds]) => [person, requestIds.size]))),
      activeRequestLinked: {
        activeRequests: requests.filter(r => r.statecode === 0).length,
        linkedRequests: activeRequests.size,
        requestsWithLinkedPeople: activeLinkedRequests.size,
        people: peopleBreakdown(activeLinkedPeople, peopleById, new Map([...links].map(([person, requestIds]) => [person, requestIds.size]))),
      },
    },
  };
}
async function run() {
  if (!process.argv.includes('--execute')) {
    console.log(JSON.stringify({ mode: 'plan_only', target: ORIGIN, maxPages: MAX_PAGES, maxRows: MAX_ROWS, queries: QUERIES, output: 'aggregate counts, model allowlist value, prompt JSON shapes/hashes and audit availability only' }, null, 2));
    return;
  }
  const env = { ...process.env };
  const local = path.join(ROOT, '.env.local');
  if (fs.existsSync(local)) for (const line of fs.readFileSync(local, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !env[m[1]]) env[m[1]] = m[2].trim().replace(/^['"](.*)['"]$/, '$1');
  }
  if (new URL(env.DYNAMICS_URL || 'https://invalid').origin !== ORIGIN) throw new Error('registered_target_mismatch');
  if (!/^[a-f\d-]{36}$/i.test(env.DYNAMICS_TENANT_ID || '')) throw new Error('invalid_tenant');
  const auth = await fetch(`https://login.microsoftonline.com/${env.DYNAMICS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env.DYNAMICS_CLIENT_ID || '', client_secret: env.DYNAMICS_CLIENT_SECRET || '', scope: `${ORIGIN}/.default` }),
  });
  if (!auth.ok) throw new Error(`oauth_http_${auth.status}`);
  const token = (await auth.json()).access_token;
  async function get(relative, expectedPath = null, expectedQuery = null) {
    const url = validateGetUrl(relative, { expectedPath, expectedQuery });
    try {
      const response = await fetch(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(20000), headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', Prefer: 'odata.maxpagesize=500' } });
      if (!response.ok) return { status: response.status, body: null };
      return { status: response.status, body: await response.json() };
    } catch (error) {
      if (error.message === 'unsafe_next_link' || error.message === 'unsafe_get_path' || error.message === 'unsafe_get_method') throw error;
      return { status: 'request_failed', body: null };
    }
  }
  async function paged(query) {
    const initialUrl = validateGetUrl(query);
    const expectedPath = initialUrl.pathname;
    const expectedQuery = initialUrl.searchParams;
    const rows = []; let next = query; let status = 200;
    for (let page = 0; next && page < MAX_PAGES; page++) {
      let result;
      try {
        result = await get(next, expectedPath, expectedQuery);
      } catch (error) {
        if (error.message !== 'unsafe_next_link' && error.message !== 'unsafe_get_path' && error.message !== 'unsafe_next_query') throw error;
        return { status: error.message, complete: false, rows };
      }
      status = result.status;
      if (!result.body) return { status: result.status, complete: false, rows };
      if (!Array.isArray(result.body.value)) return { status: result.status, complete: false, rows };
      const incoming = result.body.value;
      if (rows.length + incoming.length > MAX_ROWS) return { status: result.status, complete: false, rows };
      rows.push(...incoming); next = result.body['@odata.nextLink'];
    }
    return { status, complete: !next, rows };
  }
  if (process.argv.includes('--history-only')) {
    const people = await paged(QUERIES.people);
    const suggestions = await paged(QUERIES.suggestions);
    const result = { observedAt: new Date().toISOString(), target: ORIGIN, mode: 'bounded per-record history GET; OAuth token POST only', inputsComplete: people.complete && suggestions.complete && people.status === 200 && suggestions.status === 200, maxPeople: 7, maxDetailsPerPerson: 50, maxPagesPerPerson: 5, samples: [], limitation: 'Current shared protected-person cohort; bounded history pages only. No identifiers, values, actors, dates or full audit details retained; history itself need not establish writer or historical protected status.' };
    if (result.inputsComplete) {
      const links = new Map();
      for (const row of suggestions.rows) {
        const person = id(row._wmkf_potentialreviewer_value), request = id(row._wmkf_request_value);
        if (!person || !request) continue;
        if (!links.has(person)) links.set(person, new Set());
        links.get(person).add(request);
      }
      const cohort = people.rows.filter(row => ['confirmed','probable'].includes(row.wmkf_identitystatus) && (links.get(id(row.wmkf_potentialreviewersid))?.size || 0) > 1).sort((a,b) => id(a.wmkf_potentialreviewersid).localeCompare(id(b.wmkf_potentialreviewersid)));
      result.cohortCount = cohort.length;
      for (const row of cohort.slice(0,7)) {
        const target = encodeURIComponent(JSON.stringify({ '@odata.id': `wmkf_potentialreviewerses(${row.wmkf_potentialreviewersid})` }));
        const fields = new Set(['wmkf_identitystatus','wmkf_identityverifiedanchorsjson','wmkf_orcid','wmkf_googlescholarid','wmkf_primaryaffiliation','wmkf_hindex','wmkf_i10index','wmkf_totalcitations']);
        const sample = { sample: result.samples.length + 1, status: null, detailCount: 0, moreRecords: true, detailsTouchingIdentityFields: 0, nonblankOrcidReplacementEvents: 0, pages: 0, complete: false };
        let cookie = null;
        for (let page = 1; page <= 5; page++) {
          const paging = encodeURIComponent(JSON.stringify({ Count: 10, PageNumber: page, ReturnTotalRecordCount: false, ...(cookie ? { PagingCookie: cookie } : {}) }));
          const response = await get(`RetrieveRecordChangeHistory(Target=@target,PagingInfo=@paginginfo)?@target=${target}&@paginginfo=${paging}`);
          sample.status = response.status; sample.pages++;
          const collection = response.body?.AuditDetailCollection;
          if (!Array.isArray(collection?.AuditDetails) || collection.AuditDetails.length > 10) break;
          const details = collection.AuditDetails;
          sample.detailCount += details.length;
          sample.detailsTouchingIdentityFields += details.filter(detail => Object.keys(detail.NewValue || {}).some(key => fields.has(key))).length;
          const normalized = value => typeof value === 'string' ? value.trim().toLowerCase().replace(/^https?:\/\/(?:www\.)?orcid\.org\//, '') : '';
          sample.nonblankOrcidReplacementEvents += details.filter(detail => {
            const oldValue = normalized(detail.OldValue?.wmkf_orcid), newValue = normalized(detail.NewValue?.wmkf_orcid);
            return oldValue && newValue && oldValue !== newValue;
          }).length;
          sample.moreRecords = collection.MoreRecords === true;
          if (!sample.moreRecords) { sample.complete = true; break; }
          if (typeof collection.PagingCookie !== 'string' || !collection.PagingCookie || collection.PagingCookie === cookie) break;
          cookie = collection.PagingCookie;
        }
        result.samples.push(sample);
      }
    }
    const output = path.join(ROOT, 'docs/audits/memory-audit-history-access-evidence-2026-10-22.json');
    fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const result = { observedAt: new Date().toISOString(), target: ORIGIN, mode: 'GET-only application reads; OAuth token POST only', limits: { maxPagesPerQuery: MAX_PAGES, maxRowsPerQuery: MAX_ROWS, redirects: 'error', timeoutMs: 20000 }, queries: {}, limitations: ['Current rows are not historical invocation or causation evidence.', 'Independent query pages are not one atomic database snapshot.', 'Anchor buckets validate syntax only, not checksum, identity or historical continuity.', 'No raw identifiers, names, email, ORCID, affiliation, anchors, prompt bodies or credentials retained.'] };
  const data = {};
  for (const [key, query] of Object.entries(QUERIES)) {
    data[key] = await paged(query);
    result.queries[key] = { status: data[key].status, complete: data[key].complete, rows: data[key].rows.length };
  }
  const aggregateResult = aggregateWhenComplete(data);
  result.aggregate = aggregateResult.aggregate;
  result.aggregateState = aggregateResult.state;
  result.aggregateError = aggregateResult.error;
  result.incompletePopulationQueries = aggregateResult.incompleteQueries;
  result.modelOverride = data.model.rows.map(r => ({ key: 'model_override:reviewer-finder:model', value: /^(?:fable|opus|sonnet|haiku|claude-[a-z0-9-]+)$/.test(r.wmkf_settingvalue || '') ? r.wmkf_settingvalue : 'unrecognized_not_retained' }));
  const retentionRows = data.retention.rows;
  const parsedDays = retentionRows.length === 1 ? parseInt(retentionRows[0].wmkf_settingvalue, 10) : NaN;
  result.retention = { complete: data.retention.complete && data.retention.status === 200 && retentionRows.length <= 1, found: retentionRows.length === 1, configuredPositiveDays: Number.isFinite(parsedDays) && parsedDays > 0 ? parsedDays : null, effectiveDaysUnderCurrentSource: Number.isFinite(parsedDays) && parsedDays > 0 ? parsedDays : 90, limit: 'Source parseInt/default rule; no proof of hosted settings cache or completed cleanup' };
  if (!result.retention.complete) result.retention.effectiveDaysUnderCurrentSource = null;
  result.structuredExcluded = { complete: data.excluded.complete && data.excluded.status === 200, rows: data.excluded.complete && data.excluded.status === 200 ? data.excluded.rows.length : null, limit: 'Current junction rows do not establish producer or exclusion policy.' };
  result.promptShapes = data.prompts.rows.map(row => {
    const summarize = raw => {
      if (typeof raw !== 'string') return { state: raw == null ? 'missing' : 'nonstring' };
      try {
        const json = JSON.parse(raw);
        return { state: 'valid_json', sha256: crypto.createHash('sha256').update(raw).digest('hex'), outputCount: Array.isArray(json?.outputs) ? json.outputs.length : null, allTargetsNone: Array.isArray(json?.outputs) ? json.outputs.every(o => o?.target?.kind === 'none') : null, generationMode: ['native-json-schema'].includes(json?.generationMode) ? json.generationMode : null, rawRetention: ['none','hash','full'].includes(json?.rawOutputRetention) ? json.rawOutputRetention : null };
      } catch { return { state: 'invalid_json' }; }
    };
    return { name: /^[a-z0-9.-]+$/.test(row.wmkf_ai_promptname || '') ? row.wmkf_ai_promptname : 'unrecognized_name', version: row.wmkf_promptversion, variables: summarize(row.wmkf_ai_promptvariables), schema: summarize(row.wmkf_ai_promptoutputschema) };
  });
  result.audit = {};
  const org = await get('organizations?$select=isauditenabled&$top=2');
  result.audit.organization = { status: org.status, enabled: org.body?.value?.[0]?.isauditenabled ?? null };
  for (const entity of ['akoya_request','wmkf_potentialreviewers','wmkf_appreviewersuggestion']) {
    const meta = await get(`EntityDefinitions(LogicalName='${entity}')?$select=IsAuditEnabled`);
    const sample = await get(`audits?$top=1&$orderby=createdon desc&$filter=objecttypecode eq '${entity}'&$select=action,operation,createdon`);
    result.audit[entity] = { metadataStatus: meta.status, enabled: meta.body?.IsAuditEnabled?.Value ?? null, sampleStatus: sample.status, sampleRows: sample.body?.value?.length ?? null, newestVisibleAuditAt: sample.body?.value?.[0]?.createdon ?? null };
  }
  const out = path.join(ROOT, 'docs/audits/memory-historical-impact-evidence-2026-10-22.json');
  fs.writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ output: path.relative(ROOT, out), aggregateState: result.aggregateState, aggregateError: result.aggregateError, queries: result.queries, aggregate: result.aggregate, audit: result.audit }, null, 2));
}
module.exports = { aggregate, aggregateWhenComplete, anchorBucket, validateGetUrl };
if (require.main === module) run().catch(error => { console.error(`Assessment failed (${error.name}): ${/^([a-z_]+|oauth_http_\d+)$/.test(error.message) ? error.message : 'details_redacted'}`); process.exitCode = 1; });
