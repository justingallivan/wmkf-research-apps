/**
 * Dataverse Power Tools — Track B — live taxonomy + operational resolver.
 *
 * Single source for "read the taxonomy live at request time, never hardcode"
 * (design doc §"Living taxonomy", build plan §5/§9). Shared by:
 *   - /metadata        (builder taxonomy lists)
 *   - /preview         (unknown-filter-literal warnings — §2.1 point 4)
 *   - /preview + /run  (the operational-exclusion resolver — §3b/§9: a
 *                        DEFERRED exclusion that silently lets operational
 *                        rows through is a fail-loud violation)
 *
 * FAIL-LOUD: any fetch failure throws — callers surface it (502 / terminal
 * error), never a stale/partial taxonomy and never a silently-unapplied
 * exclusion.
 */

import { DynamicsService } from '../dynamics-service.js';
import { fetchXmlAll, FetchXmlError } from './fetch-client.js';
import { assertDataverseOperationAllowed } from '../../dataverse/core/interlock.js';

const API = '/api/data/v9.2';
const ENTITY_SET = 'akoya_requests';

function base() {
  const u = process.env.DYNAMICS_URL;
  if (!u) throw new FetchXmlError('Missing DYNAMICS_URL', { stage: 'config' });
  return u;
}

async function odataList(entitySet, select, orderby) {
  const token = await DynamicsService.getAccessToken();
  const qs = new URLSearchParams({ $select: select });
  if (orderby) qs.set('$orderby', orderby);
  const url = `${base()}${API}/${entitySet}?${qs}`;
  // Interlock (docs/DATAVERSE_TARGET_WRITE_INTERLOCK_PLAN.md §3.5.3), GET-only
  // read-side coverage.
  assertDataverseOperationAllowed({ url, method: 'GET', callerLabel: 'dataverse-export/live-taxonomy' });
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      Prefer: 'odata.include-annotations="*"',
    },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`taxonomy fetch failed for ${entitySet} (HTTP ${resp.status}): `
      + `${body.slice(0, 200)}`);
  }
  return ((await resp.json()).value || []).map(r => DynamicsService.processAnnotations(r));
}

// wmkf_request_type is a Picklist — resolve label→optionvalue from attribute
// metadata (the operational predicate references it by label).
async function picklistOptions(entityLogical, attributeLogical) {
  const token = await DynamicsService.getAccessToken();
  const url = `${base()}${API}/EntityDefinitions(LogicalName='${entityLogical}')`
    + `/Attributes(LogicalName='${attributeLogical}')`
    + `/Microsoft.Dynamics.CRM.PicklistAttributeMetadata`
    + `?$select=LogicalName&$expand=OptionSet($select=Options)`;
  // Interlock (docs/DATAVERSE_TARGET_WRITE_INTERLOCK_PLAN.md §3.5.3), GET-only
  // read-side coverage.
  assertDataverseOperationAllowed({ url, method: 'GET', callerLabel: 'dataverse-export/live-taxonomy' });
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`picklist metadata fetch failed for ${attributeLogical} `
      + `(HTTP ${resp.status}): ${body.slice(0, 200)}`);
  }
  const data = await resp.json();
  const opts = (data.OptionSet && data.OptionSet.Options) || [];
  return opts.map(o => ({
    value: o.Value,
    label: (o.Label && o.Label.UserLocalizedLabel && o.Label.UserLocalizedLabel.Label) || '',
  }));
}

/**
 * Fetch the full live taxonomy. Throws on any failure (fail-loud).
 * Distinct statuses use fetchXmlAll — NOT a single page (Codex S160 P2:
 * one page can under-enumerate a Living taxonomy).
 */
async function fetchLiveTaxonomy() {
  const [programs, types, fundingCategories, requestTypeOptions] = await Promise.all([
    // akoya_program's PrimaryNameAttribute is `akoya_program` (same as the
    // logical entity name) — NOT `akoya_name` (verified live against the
    // EntityDefinition; wmkf_types/wmkf_grantprograms do use wmkf_name).
    odataList('akoya_programs', 'akoya_programid,akoya_program', 'akoya_program asc'),
    odataList('wmkf_types', 'wmkf_typeid,wmkf_name', 'wmkf_name asc'),
    odataList('wmkf_grantprograms', 'wmkf_grantprogramid,wmkf_name', 'wmkf_name asc'),
    picklistOptions('akoya_request', 'wmkf_request_type'),
  ]);

  const distinctFx =
    '<fetch distinct="true"><entity name="akoya_request">'
    + '<attribute name="akoya_requeststatus" /></entity></fetch>';
  const statusRes = await fetchXmlAll(ENTITY_SET, distinctFx, { hardCapRows: 5000 });
  const statuses = [...new Set(
    statusRes.rows.map(r => r.akoya_requeststatus).filter(Boolean),
  )].sort();

  return {
    entity: 'akoya_request',
    enumeratedAt: new Date().toISOString(),
    programs: programs.map(p => ({ id: p.akoya_programid, name: p.akoya_program ?? '(unnamed)' })),
    types: types.map(t => ({ id: t.wmkf_typeid, name: t.wmkf_name ?? '(unnamed)' })),
    fundingCategories: fundingCategories.map(g => ({
      id: g.wmkf_grantprogramid, name: g.wmkf_name ?? '(unnamed)',
    })),
    statuses,
    requestTypeOptions,
  };
}

/**
 * Build the operational-exclusion resolver from a live taxonomy.
 * `resolve(field, label)` → GUID/optionvalue, or null if the label is not in
 * the live taxonomy. A null on a required operational label is FAIL-LOUD at
 * the caller (never a silently-unapplied exclusion — build plan §3b/§9).
 *
 * Field mapping (the operational predicate's `field`s):
 *   akoya_programid     → akoya_program GUID by name
 *   wmkf_type           → wmkf_type GUID by name
 *   wmkf_grantprogram   → wmkf_grantprogram GUID by name
 *   wmkf_request_type   → picklist option value by label
 */
function buildResolver(taxonomy) {
  const byName = (list) => {
    const m = new Map();
    for (const x of list) m.set(String(x.name).trim().toLowerCase(), x.id);
    return m;
  };
  const programs = byName(taxonomy.programs);
  const types = byName(taxonomy.types);
  const funding = byName(taxonomy.fundingCategories);
  const reqType = new Map(
    (taxonomy.requestTypeOptions || []).map(o => [String(o.label).trim().toLowerCase(), o.value]),
  );

  return {
    resolve(field, label) {
      const key = String(label).trim().toLowerCase();
      switch (field) {
        case 'akoya_programid': return programs.get(key) ?? null;
        case 'wmkf_type': return types.get(key) ?? null;
        case 'wmkf_grantprogram': return funding.get(key) ?? null;
        case 'wmkf_request_type': {
          const v = reqType.get(key);
          return v === undefined ? null : v;
        }
        default: return null;
      }
    },
  };
}

export { fetchLiveTaxonomy, buildResolver };
