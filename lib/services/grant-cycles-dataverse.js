/**
 * Dataverse-backed grant-cycle accessors used by the W3 rewrite of
 *   - /api/reviewer-finder/grant-cycles
 *   - /api/review-manager/render-emails (loadCycleConfigs)
 *   - /api/review-manager/send-emails  (loadCycleConfigs)
 *
 * Field mapping: wmkf_appgrantcycle (Dataverse) ←→ grant_cycles (Postgres
 * pre-cutover). All write paths normalize wmkf_shortcode to trimmed-
 * uppercase per Codex S147 step-3 Q3 contract.
 */

const { getAccessToken, createClient } = require('../dataverse/client');

const SOLUTION_UNIQUE_NAME = 'ResearchReviewAppSuite';

// Loud-fail guard per W3 Option B cutover: explicit Postgres routing is no
// longer supported because the legacy code path was removed. Runs at
// module load AND on each getClient() call so a misconfigured deploy
// fails fast (during cold-start / next request) rather than silently
// loading the module and only erroring on the first actual call site.
function assertNotPostgresBackend() {
  const v = process.env.WAVE2_BACKEND_GRANT_CYCLES;
  if (v && v.toLowerCase() === 'postgres') {
    throw new Error(
      'WAVE2_BACKEND_GRANT_CYCLES=postgres is no longer supported. ' +
        'grant_cycles became Dataverse-only at W3 cutover (commit a201372+). ' +
        'Remove the env var or set it to "dataverse" (the default).',
    );
  }
}

// Module-load guard. Throws if the env var is set to postgres at the
// moment this module is first imported — surfaces the misconfiguration
// before any handler is even registered.
assertNotPostgresBackend();

async function getClient() {
  assertNotPostgresBackend();
  const url = process.env.DYNAMICS_URL;
  if (!url) throw new Error('DYNAMICS_URL not set');
  const token = await getAccessToken(url);
  return createClient({ resourceUrl: url, token, solutionUniqueName: SOLUTION_UNIQUE_NAME });
}

// OData v4 string-literal escape (apostrophe doubling) + URL encoding.
function escapeODataString(s) {
  return encodeURIComponent(String(s).replace(/'/g, "''"));
}

function normalizeShortCode(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim().toUpperCase();
  return s || null;
}

function parseJsonOrNull(s) {
  if (s === null || s === undefined || s === '') return null;
  try {
    return JSON.parse(s);
  } catch (_) {
    return null;
  }
}

function stringifyOrNull(v) {
  if (v === null || v === undefined) return null;
  return JSON.stringify(v);
}

// Dataverse row → API cycle shape (mirrors the Postgres handler output).
function rowToCycle(dv) {
  return {
    id: dv.wmkf_appgrantcycleid,
    name: dv.wmkf_displayname,
    shortCode: dv.wmkf_shortcode,
    programName: dv.wmkf_programname,
    reviewDeadline: dv.wmkf_reviewreturndeadline,
    summaryPages: dv.wmkf_summarypages,
    reviewTemplateBlobUrl: dv.wmkf_reviewtemplateurl,
    reviewTemplateFilename: dv.wmkf_reviewtemplatefilename,
    additionalAttachments: parseJsonOrNull(dv.wmkf_additionalattachments),
    customFields: parseJsonOrNull(dv.wmkf_customfields),
    isActive: dv.wmkf_isactive,
    createdAt: dv.createdon,
    updatedAt: dv.modifiedon,
  };
}

const SELECT_FIELDS = [
  'wmkf_appgrantcycleid',
  'wmkf_displayname',
  'wmkf_shortcode',
  'wmkf_programname',
  'wmkf_reviewreturndeadline',
  'wmkf_summarypages',
  'wmkf_reviewtemplateurl',
  'wmkf_reviewtemplatefilename',
  'wmkf_additionalattachments',
  'wmkf_customfields',
  'wmkf_isactive',
  'wmkf_fiscalyearcode',
  'createdon',
  'modifiedon',
].join(',');

async function listCycles({ includeArchived }) {
  const client = await getClient();
  const filter = includeArchived ? '' : `&$filter=${encodeURIComponent('wmkf_isactive eq true')}`;
  const r = await client.get(
    `/wmkf_appgrantcycles?$select=${SELECT_FIELDS}${filter}&$orderby=createdon desc`,
  );
  if (!r.ok) throw new Error(`listCycles: ${r.status} ${r.text}`);
  // Also expose raw fiscalyearcode so callers can build the per-cycle
  // request-count lookup without re-deriving from displayname.
  return r.body.value.map(dv => ({ ...rowToCycle(dv), fiscalYearCode: dv.wmkf_fiscalyearcode }));
}

// Retry on 429 / 5xx with a Retry-After-aware backoff. Used by the alt-key
// lookup which sits behind loadCycleConfigs in render-emails/send-emails;
// when those handlers call this N times in parallel, a single transient
// throttle would otherwise reject the whole Promise.all batch and bubble
// to the SSE client as a 500 (Codex S147 step-5 review Q4 parity claim).
const TRANSIENT_RETRY_STATUSES = new Set([429, 502, 503, 504]);

async function findByShortCode(shortCodeRaw) {
  const sc = normalizeShortCode(shortCodeRaw);
  if (!sc) return null;
  const client = await getClient();
  const url = `/wmkf_appgrantcycles(wmkf_shortcode='${escapeODataString(sc)}')?$select=${SELECT_FIELDS}`;

  let attempt = 0;
  const maxAttempts = 3;
  while (true) {
    const r = await client.get(url);
    if (r.status === 404) return null;
    if (r.ok) return { ...rowToCycle(r.body), fiscalYearCode: r.body.wmkf_fiscalyearcode };

    attempt++;
    if (attempt >= maxAttempts || !TRANSIENT_RETRY_STATUSES.has(r.status)) {
      throw new Error(`findByShortCode(${sc}): ${r.status} ${r.text}`);
    }
    // Sleep: prefer Retry-After header (seconds) if Dataverse supplied one,
    // else exponential backoff capped at 4s.
    let waitMs = Math.min(2 ** attempt * 500, 4000);
    // The createClient helper doesn't surface response headers; the 429
    // path is rare enough that fixed exponential is acceptable.
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }
}

async function findById(id) {
  if (!id) return null;
  const client = await getClient();
  const r = await client.get(`/wmkf_appgrantcycles(${encodeURIComponent(id)})?$select=${SELECT_FIELDS}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`findById(${id}): ${r.status} ${r.text}`);
  return { ...rowToCycle(r.body), fiscalYearCode: r.body.wmkf_fiscalyearcode };
}

// Aggregate counts in 2 OData queries (one per source entity) using
// $apply/groupby. Returns:
//   {
//     proposalCountsByFiscalYear: Map<fiscalYearCode|name, number>,
//     candidateCountsByShortCode: Map<shortCode, number>,
//     unassignedCandidateCount: number,
//   }
async function fetchCounts() {
  const client = await getClient();

  // Per-cycle proposal counts: group akoya_request by akoya_fiscalyear.
  // akoya_fiscalyear is a string ("June 2026") matching grant_cycle.name.
  const reqAgg = await client.get(
    `/akoya_requests?$apply=${encodeURIComponent('groupby((akoya_fiscalyear),aggregate($count as count))')}`,
  );
  if (!reqAgg.ok) throw new Error(`request counts: ${reqAgg.status} ${reqAgg.text}`);
  const proposalCountsByFiscalYear = new Map();
  for (const row of reqAgg.body.value || []) {
    const k = row.akoya_fiscalyear || null;
    if (k !== null) proposalCountsByFiscalYear.set(k, Number(row.count) || 0);
  }

  // Per-cycle candidate counts: selected suggestions grouped by grantcyclecode.
  // The null bucket = unassigned.
  //
  // Belt-and-suspenders disposition guard (Phase 0.7): exclude applicant-
  // "excluded" rows (wmkf_applicantdisposition = 100000001) so they never
  // inflate cycle candidate counts. The `eq null or` is load-bearing — a bare
  // `ne` drops null-disposition rows (the normal case) because Dataverse omits
  // rows whose filter evaluates to null. Mirrors notExcludedFilter() in
  // lib/dataverse/adapters/reviewer-suggestion.js (kept inline here to avoid a
  // CJS→ESM import across the module boundary).
  const EXCLUDED_DISPOSITION = 100000001;
  const notExcluded = `(wmkf_applicantdisposition eq null or wmkf_applicantdisposition ne ${EXCLUDED_DISPOSITION})`;
  const sugAgg = await client.get(
    `/wmkf_appreviewersuggestions?$apply=${encodeURIComponent(`filter(wmkf_selected eq true and ${notExcluded})/groupby((wmkf_grantcyclecode),aggregate($count as count))`)}`,
  );
  if (!sugAgg.ok) throw new Error(`candidate counts: ${sugAgg.status} ${sugAgg.text}`);
  const candidateCountsByShortCode = new Map();
  let unassignedCandidateCount = 0;
  for (const row of sugAgg.body.value || []) {
    const code = row.wmkf_grantcyclecode;
    const n = Number(row.count) || 0;
    if (code === null || code === undefined || code === '') {
      unassignedCandidateCount += n;
    } else {
      candidateCountsByShortCode.set(String(code).toUpperCase(), n);
    }
  }

  return { proposalCountsByFiscalYear, candidateCountsByShortCode, unassignedCandidateCount };
}

// Build the Dataverse payload for a create/update from an API-shape input.
// `wmkf_fiscalyearcode` mirrors `name` per the schema (matches
// akoya_request.akoya_fiscalyear "June 2026"-format string).
function inputToDataverse(input, { isCreate }) {
  const out = {};
  const set = (k, v) => { if (v !== undefined) out[k] = v; };

  set('wmkf_displayname', input.name ?? undefined);
  set('wmkf_shortcode', input.shortCode !== undefined ? normalizeShortCode(input.shortCode) : undefined);
  set('wmkf_programname', input.programName ?? undefined);
  set('wmkf_reviewreturndeadline', input.reviewDeadline === '' ? null : input.reviewDeadline);
  set('wmkf_summarypages', input.summaryPages ?? undefined);
  set('wmkf_reviewtemplateurl', input.reviewTemplateBlobUrl === '' ? null : input.reviewTemplateBlobUrl);
  set('wmkf_reviewtemplatefilename', input.reviewTemplateFilename === '' ? null : input.reviewTemplateFilename);
  set('wmkf_additionalattachments', input.additionalAttachments !== undefined ? stringifyOrNull(input.additionalAttachments) : undefined);
  set('wmkf_customfields', input.customFields !== undefined ? stringifyOrNull(input.customFields) : undefined);
  set('wmkf_isactive', input.isActive ?? undefined);

  // Mirror displayname → fiscalyearcode at create-time (the Postgres source
  // has both columns; both equal "June 2026"). On update, mirror only when
  // name is being changed.
  if (isCreate && input.name !== undefined) {
    out.wmkf_fiscalyearcode = input.name;
    out.wmkf_summarypages = out.wmkf_summarypages || '2';
  } else if (!isCreate && input.name !== undefined) {
    out.wmkf_fiscalyearcode = input.name;
  }

  return out;
}

async function createCycle(input) {
  const client = await getClient();
  const body = inputToDataverse(input, { isCreate: true });
  const r = await client.post('/wmkf_appgrantcycles?$select=' + SELECT_FIELDS, body, {
    Prefer: 'return=representation',
  });
  if (!r.ok) throw new Error(`createCycle: ${r.status} ${r.text}`);
  return rowToCycle(r.body);
}

async function updateCycleById(id, input) {
  const client = await getClient();
  const body = inputToDataverse(input, { isCreate: false });
  if (Object.keys(body).length === 0) return null;
  const r = await client.patch(`/wmkf_appgrantcycles(${encodeURIComponent(id)})`, body);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`updateCycleById(${id}): ${r.status} ${r.text}`);
  // PATCH returns no body by default; re-fetch.
  return findById(id);
}

async function archiveCycleById(id) {
  // Soft-delete = PATCH wmkf_isactive=false. Plan §"Acceptance tests"
  // explicitly requires PATCH, NOT DELETE — row stays queryable.
  return updateCycleById(id, { isActive: false });
}

module.exports = {
  // env guard
  assertNotPostgresBackend,
  // readers
  listCycles,
  findByShortCode,
  findById,
  fetchCounts,
  // writers
  createCycle,
  updateCycleById,
  archiveCycleById,
  // utils (exposed for tests + tightly-coupled callers)
  normalizeShortCode,
  rowToCycle,
};
