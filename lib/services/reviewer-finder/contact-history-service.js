/**
 * Reviewer Finder — contact PI/co-PI history service
 * (Route→Service Consolidation Plan, Stage 3 wave).
 *
 * Holds ALL business logic for GET /api/reviewer-finder/contact-history;
 * the route is a thin shell (method dispatch, auth, GUID validation, DAL
 * context, HTTP mapping).
 *
 * Read strategy is the steady-state UNION described in
 * docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md §5:
 *
 *     wmkf_apprequestperson rows where wmkf_contact = <id>      (pi OR copi)
 *   UNION
 *     akoya_request rows where _wmkf_projectleader_value = <id> (role: pi)
 *
 * Not junction-first / projectleader-fallback. The projectleader lookup field
 * stays authoritative for PI in parallel with the junction because (a) other
 * flows unrelated to reviewers update it, and (b) Connor's PA flows dual-write
 * it alongside the `pi` junction row. Either source is correct for active
 * data; junction is the sole source for historical co-PI participation.
 *
 * Per-row source provenance is returned so the UI can mark "junction-only"
 * rows differently if desired (e.g., during the pre-PA-cutover transition).
 *
 * Contract (plan Decision 3):
 *   - takes a plain argument object, never req/res;
 *   - returns the exact 200 payload { contactId, rows, counts };
 *   - failures propagate untyped — the shell maps them to the historical
 *     500 { error: err.message || 'Internal error' } envelope;
 *   - ASSUMES a trusted DAL context already exists — never establishes one.
 */

import { meetingDateToCycleCode, cycleCodeToLabel } from '../../utils/cycle-code';
import { queryAllRequests, queryRequests } from '../../dataverse/adapters/grant-request';
import { queryAllPersons } from '../../dataverse/adapters/app-request-person';
import * as odata from '../../dataverse/core/odata.js';
import { chunk as chunked } from '../../utils/chunk.js';

const ROLE_PI = 100000000;
const ROLE_COPI = 100000001;

const REQUEST_SELECT = [
  'akoya_requestid',
  'akoya_requestnum',
  'akoya_title',
  'wmkf_meetingdate',
  'akoya_requeststatus',
].join(',');

/**
 * PI / co-PI history for a single contact across all akoya_request rows.
 *
 * @param {Object} args
 * @param {string} args.contactId - GUID (already validated by the shell)
 * @returns {Promise<{ contactId: string, rows: Array, counts: { pi, copi, total } }>}
 */
export async function getContactHistory({ contactId }) {
  // ── Pull both sources in parallel ──────────────────────────────────
  // contactId sits in a RAW (unquoted) lookup-value position, so it is built
  // with odata.eqGuid — which rejects a non-GUID BEFORE interpolation (OData
  // Escape Consolidation Plan D2, owner ruling S331). This adds a service-level
  // fail-closed guard ON TOP of the route shell's existing GUID validation;
  // byte-identical to the prior `_wmkf_… eq <guid>` filters for a valid GUID.

  // Both source queries use queryAllRecords (paginates via @odata.nextLink,
  // capped at 5000). queryRecords' top:100 silently truncated high-volume
  // historian PIs/co-PIs; the cap flag below surfaces the boundary if we
  // ever brush against it (no live contact comes anywhere near).
  const [junctionResp, projectLeaderResp] = await Promise.all([
    // Junction rows for this contact, restricted to PI/Co-PI.
    // The wmkf_role enum was expanded 2026-05-14 to include Senior Personnel /
    // Key Personnel / Other for the intake portal roster; reviewer-finder
    // history must stay scoped to PI + Co-PI, so filter at source rather
    // than relying on the PI-or-else-Co-PI mapping below.
    queryAllPersons({
      select: '_wmkf_request_value,wmkf_role,wmkf_authorposition',
      filter: `${odata.eqGuid('_wmkf_contact_value', contactId)} and (wmkf_role eq ${ROLE_PI} or wmkf_role eq ${ROLE_COPI})`,
    }),
    // akoya_request rows where this contact is the project leader.
    // Role inferred = pi, position = 0 (matches backfill convention).
    queryAllRequests({
      select: 'akoya_requestid',
      filter: odata.eqGuid('_wmkf_projectleader_value', contactId),
    }),
  ]);

  if (junctionResp.capped || projectLeaderResp.capped) {
    console.warn(
      `[contact-history] source-query cap hit for contact ${contactId}: ` +
      `junction=${junctionResp.capped ? 'capped' : 'ok'} ` +
      `projectleader=${projectLeaderResp.capped ? 'capped' : 'ok'}`
    );
  }

  // ── Merge into a dedupe-keyed map ──────────────────────────────────
  // Key = `${requestId}|${role}`. Same contact + same request can hold
  // both 'pi' and 'copi' rows (rare but legal); they remain distinct.
  const rowMap = new Map();

  function ensureRow(requestId, role, position) {
    const key = `${requestId}|${role}`;
    if (!rowMap.has(key)) {
      rowMap.set(key, {
        requestId,
        role,
        position,
        sources: new Set(),
      });
    }
    return rowMap.get(key);
  }

  for (const r of junctionResp.records || []) {
    if (r.wmkf_role !== ROLE_PI && r.wmkf_role !== ROLE_COPI) continue;
    const role = r.wmkf_role === ROLE_PI ? 'pi' : 'copi';
    const row = ensureRow(r._wmkf_request_value, role, r.wmkf_authorposition ?? null);
    row.sources.add('junction');
  }

  for (const r of projectLeaderResp.records || []) {
    // Projectleader is always the PI; position 0 by convention.
    const row = ensureRow(r.akoya_requestid, 'pi', 0);
    row.sources.add('projectleader');
  }

  const rows = Array.from(rowMap.values());

  // ── Fetch request metadata once per distinct requestId ─────────────
  // Chunk into batches of CHUNK_SIZE per OData `or`-filter request to keep
  // URL length and per-query top within bounds. queryAllRecords would not
  // help here — each batch needs its own filter, not pagination of one.
  const distinctRequestIds = [...new Set(rows.map(r => r.requestId))];
  const requestMetaById = new Map();
  const CHUNK_SIZE = 50;

  for (const chunk of chunked(distinctRequestIds, CHUNK_SIZE)) {
    const orFilter = chunk.map(id => `akoya_requestid eq ${id}`).join(' or ');
    const meta = await queryRequests({
      select: REQUEST_SELECT,
      filter: orFilter,
      top: CHUNK_SIZE,
    });
    for (const r of meta.records || []) {
      requestMetaById.set(r.akoya_requestid, r);
    }
  }

  const unresolvedMeta = distinctRequestIds.filter(id => !requestMetaById.has(id));
  if (unresolvedMeta.length > 0) {
    // Should be unreachable — every source row's request id should resolve.
    // Surface as a warning so the response's null-meta rows are diagnosable.
    console.warn(
      `[contact-history] ${unresolvedMeta.length}/${distinctRequestIds.length} ` +
      `request ids unresolved for contact ${contactId}`
    );
  }

  // ── Project + sort ──────────────────────────────────────────────────
  const projected = rows.map(r => {
    const meta = requestMetaById.get(r.requestId) || {};
    const cycleCode = meta.wmkf_meetingdate ? meetingDateToCycleCode(meta.wmkf_meetingdate) : null;
    return {
      requestId: r.requestId,
      requestNumber: meta.akoya_requestnum || null,
      title: meta.akoya_title || null,
      meetingDate: meta.wmkf_meetingdate || null,
      cycleCode,
      cycleLabel: cycleCode ? cycleCodeToLabel(cycleCode) : null,
      requestStatus: meta.akoya_requeststatus || null,
      role: r.role,
      position: r.position,
      sources: Array.from(r.sources).sort(),
    };
  });

  // Sort newest first by meeting date; nulls (missing meta) last.
  projected.sort((a, b) => {
    if (!a.meetingDate && !b.meetingDate) return 0;
    if (!a.meetingDate) return 1;
    if (!b.meetingDate) return -1;
    return b.meetingDate.localeCompare(a.meetingDate);
  });

  const counts = {
    pi: projected.filter(r => r.role === 'pi').length,
    copi: projected.filter(r => r.role === 'copi').length,
    total: projected.length,
  };

  return { contactId, rows: projected, counts };
}
