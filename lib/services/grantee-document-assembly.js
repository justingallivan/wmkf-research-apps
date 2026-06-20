/**
 * Grantee document assembly — the ONE canonical model for chunk-8 outputs
 * (build-plan chunk 8; spec D8/D9). Reads every field ONCE and returns a
 * structured model that all three outputs consume — portal preview, website
 * HTML, and cycle export — so PI/co-PI/amount/title/markdown can never drift
 * across surfaces.
 *
 * Canonical award structure (owner template, S270):
 *   Oregon State University              institution  (account name)        bold
 *   Corvallis, OR                        location     (account city, state) italic
 *   Kristen Buck and Mya Breitbart       PI + Co-PIs  (join "A and B")      italic
 *   $1,200,000                           amount       (akoya_grant)         plain
 *   To determine whether…                edited title (wmkf_wmkfprojectdescription) italic
 *   In nearly half of the global…        body         (approved abstract)   prose
 *
 * Field identity (NOT a UNION):
 *   - PI    = akoya_request.wmkf_projectleader            (the _formatted name)
 *   - Co-PIs = fetchCoPIs(requestId)  (wmkf_apprequestperson role=Co-PI ONLY;
 *             this is NOT the PI-history UNION — that's a different pattern)
 *   - amount = akoya_grant ?? akoya_originalgrantamount; NEVER akoya_request
 *             (the migration-backfilled requested amount — Atlas).
 *   - body   = wmkf_abstractapproved ?? wmkf_abstractformatted (markdown→HTML)
 *   - title  = wmkf_wmkfprojectdescription (PLAIN text; italicized structurally
 *             by each consumer, never markdown-rendered — keeps the Board Book clean).
 *
 * Structural formatting (bold/italic per field) lives in the HTML renderer
 * (lib/services/grantee-document-html.js), NOT here — this module is data only.
 *
 * Auth boundary: `imageFileRef` (the private SharePoint ref) is returned ONLY
 * when `includeImageRef` is set — that flag is for STAFF-authed, server-side
 * surfaces (website HTML / cycle export under requireAppAccess('reviewers')).
 * The external grantee-token surface must call WITHOUT it and rely on `hasImage`.
 *
 * Caller contract: must already be inside a Dynamics restriction context
 * (bypassDynamicsRestrictions / app restriction) — fetchCoPIs issues a plain read.
 */

import { DynamicsService } from './dynamics-service';
import { fetchCoPIs } from './proposal-participants';
import { renderGranteeBody, renderGranteeCaption } from '../../shared/utils/grantee-markdown';

const REQUEST_SELECT = [
  'akoya_requestid', 'akoya_requestnum', 'akoya_title',
  'wmkf_wmkfprojectdescription',
  'wmkf_abstractapproved', 'wmkf_abstractformatted',
  'wmkf_granteeimagecaption', 'wmkf_granteeimagefileref',
  '_wmkf_projectleader_value',
  'akoya_grant', 'akoya_originalgrantamount',
  '_akoya_applicantid_value',
].join(',');

const ACCOUNT_SELECT = 'name,address1_city,address1_stateorprovince';

/** Join names as "A", "A and B", or "A, B, and C". */
export function joinNames(names) {
  const n = (names || []).map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean);
  if (n.length === 0) return null;
  if (n.length === 1) return n[0];
  if (n.length === 2) return `${n[0]} and ${n[1]}`;
  return `${n.slice(0, -1).join(', ')}, and ${n[n.length - 1]}`;
}

/** Full-number USD, no cents: 1200000 → "$1,200,000". null for non-numeric. */
export function formatAwardAmount(amount) {
  if (amount === null || amount === undefined || amount === '') return null;
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

/** "Corvallis, OR" | "Corvallis" | "OR" | null. */
export function formatLocation(city, state) {
  const c = typeof city === 'string' ? city.trim() : '';
  const s = typeof state === 'string' ? state.trim() : '';
  if (c && s) return `${c}, ${s}`;
  return c || s || null;
}

/**
 * Assemble the canonical document model for one request.
 *
 * @param {string} requestId - akoya_request GUID (caller GUID-validates).
 * @param {{ includeImageRef?: boolean }} [opts] - staff surfaces pass true to
 *        receive the private `imageFileRef`; external surfaces omit it.
 * @returns {Promise<object|null>} the model, or null if the request is missing.
 */
export async function assembleGranteeDocument(requestId, { includeImageRef = false } = {}) {
  if (!requestId) return null;

  let row;
  try {
    row = await DynamicsService.getRecord('akoya_requests', requestId, { select: REQUEST_SELECT });
  } catch {
    return null;
  }
  if (!row?.akoya_requestid) return null;

  // Institution name + location from the applicant account. Name also arrives as
  // the lookup's formatted annotation; the account read adds city/state and
  // re-confirms the name. Fail-soft: a non-account applicant (404) → name from
  // the annotation, no location.
  const applicantId = row._akoya_applicantid_value || null;
  let institution = row['_akoya_applicantid_value_formatted'] || null;
  let location = null;
  if (applicantId) {
    try {
      const acct = await DynamicsService.getRecord('accounts', applicantId, { select: ACCOUNT_SELECT });
      institution = acct?.name || institution;
      location = formatLocation(acct?.address1_city, acct?.address1_stateorprovince);
    } catch {
      // keep the formatted-annotation name; location stays null
    }
  }

  const pi = row['_wmkf_projectleader_value_formatted'] || null;
  const coPIs = await fetchCoPIs(requestId);
  const names = joinNames([pi, ...coPIs]);

  const rawAmount = row.akoya_grant ?? row.akoya_originalgrantamount ?? null;
  const amount = rawAmount === null || rawAmount === '' ? null : Number(rawAmount);

  // body = grantee-approved abstract, else the AI-generated formatted abstract.
  let bodySource = null;
  let bodyMarkdown = null;
  if (typeof row.wmkf_abstractapproved === 'string' && row.wmkf_abstractapproved.trim()) {
    bodySource = 'approved';
    bodyMarkdown = row.wmkf_abstractapproved;
  } else if (typeof row.wmkf_abstractformatted === 'string' && row.wmkf_abstractformatted.trim()) {
    bodySource = 'formatted';
    bodyMarkdown = row.wmkf_abstractformatted;
  }

  const caption = typeof row.wmkf_granteeimagecaption === 'string' && row.wmkf_granteeimagecaption.trim()
    ? row.wmkf_granteeimagecaption
    : null;
  const imageFileRef = row.wmkf_granteeimagefileref || null;

  const model = {
    requestId: row.akoya_requestid,
    requestNumber: row.akoya_requestnum || null,
    institution,
    location,
    pi,
    coPIs,
    names,
    amount: Number.isFinite(amount) ? amount : null,
    amountFormatted: formatAwardAmount(rawAmount),
    editedTitle: (typeof row.wmkf_wmkfprojectdescription === 'string' && row.wmkf_wmkfprojectdescription.trim())
      ? row.wmkf_wmkfprojectdescription.trim()
      : null,
    bodySource,
    bodyHtml: renderGranteeBody(bodyMarkdown),
    caption,
    captionHtml: renderGranteeCaption(caption),
    hasImage: Boolean(imageFileRef),
  };
  // Private SharePoint ref: STAFF surfaces only.
  if (includeImageRef) model.imageFileRef = imageFileRef;
  return model;
}
