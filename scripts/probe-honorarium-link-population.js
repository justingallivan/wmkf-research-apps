#!/usr/bin/env node
/**
 * READ-ONLY production census for reviewer honorarium linkage.
 *
 * Cross-checks the two durable provenance paths:
 *
 *   reviewer suggestion --wmkf_honorariumrequest--> honorarium akoya_request
 *   honorarium akoya_request --wmkf_reviewedproposal--> proposal akoya_request
 *
 * It also checks accepted, non-opt-out responses received since the portal
 * honorarium go-live date. Historical accepts are intentionally excluded from
 * that eligibility check because they were not backfilled by design.
 *
 * Network safety: the only POST is OAuth token acquisition. Every Dataverse
 * request is GET. The script refuses to run against a non-production hostname.
 *
 * Usage:
 *   node scripts/probe-honorarium-link-population.js
 *   HONORARIUM_LINK_ROLLOUT_AT=2026-07-02T00:00:00Z \
 *     node scripts/probe-honorarium-link-population.js
 */

const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2]
      .trim()
      .replace(/^"(.*)"$/, '$1')
      .replace(/^'(.*)'$/, '$1');
  }
}

const PRODUCTION_HOST = 'wmkf.crm.dynamics.com';
const ROLLOUT_AT = process.env.HONORARIUM_LINK_ROLLOUT_AT || '2026-07-02T00:00:00Z';

// Stable production lookup IDs, verified against the reference honorarium and
// recorded in docs/HONORARIUM_PORTAL_CREATION_STRATEGY.md. Environment values
// override them so the same read-only census can be pointed at a copied tenant
// after changing the production-host guard deliberately in source review.
const DISCRIMINATORS = {
  program: process.env.HONORARIUM_PROGRAM_ID || '7e744a42-37eb-f011-8543-6045bd02b4cc',
  grantProgram: process.env.HONORARIUM_GRANTPROGRAM_ID || '60ef7626-38eb-f011-8543-6045bd02b4cc',
  type: process.env.HONORARIUM_TYPE_ID || '4bab15c9-38eb-f011-8543-6045bd02b4cc',
  requestType: 682090001,
  akoyaRequestType: 100000001,
};

function normalizeId(value) {
  return typeof value === 'string' ? value.toLowerCase() : null;
}

function sameId(left, right) {
  return normalizeId(left) !== null && normalizeId(left) === normalizeId(right);
}

function isCompositeHonorarium(row) {
  return sameId(row._akoya_programid_value, DISCRIMINATORS.program)
    && sameId(row._wmkf_grantprogram_value, DISCRIMINATORS.grantProgram)
    && sameId(row._wmkf_type_value, DISCRIMINATORS.type)
    && row.wmkf_request_type === DISCRIMINATORS.requestType
    && row.akoya_requesttype === DISCRIMINATORS.akoyaRequestType;
}

async function getToken() {
  const required = [
    'DYNAMICS_URL',
    'DYNAMICS_TENANT_ID',
    'DYNAMICS_CLIENT_ID',
    'DYNAMICS_CLIENT_SECRET',
  ];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);

  const host = new URL(process.env.DYNAMICS_URL).hostname.toLowerCase();
  if (host !== PRODUCTION_HOST) {
    throw new Error(`Refusing non-production target '${host}'; expected '${PRODUCTION_HOST}'`);
  }

  const response = await fetch(
    `https://login.microsoftonline.com/${process.env.DYNAMICS_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: process.env.DYNAMICS_CLIENT_ID,
        client_secret: process.env.DYNAMICS_CLIENT_SECRET,
        scope: `${process.env.DYNAMICS_URL}/.default`,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`OAuth token request failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  }
  return (await response.json()).access_token;
}

async function getAll(token, pathOrUrl) {
  const rows = [];
  let url = pathOrUrl.startsWith('http')
    ? pathOrUrl
    : `${process.env.DYNAMICS_URL}/api/data/v9.2${pathOrUrl}`;

  while (url) {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'OData-MaxVersion': '4.0',
        'OData-Version': '4.0',
      },
    });
    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = {};
    }
    if (!response.ok) {
      throw new Error(`Dataverse GET failed (${response.status}): ${text.slice(0, 500)}`);
    }
    rows.push(...(body.value || []));
    url = body['@odata.nextLink'] || null;
  }
  return rows;
}

function anomalyIds(rows, idField) {
  return rows.map((row) => row[idField]).filter(Boolean).sort();
}

function suggestionContext(row) {
  return {
    suggestionId: row.wmkf_appreviewersuggestionid,
    requestId: row._wmkf_request_value || null,
    createdOn: row.createdon || null,
    modifiedOn: row.modifiedon || null,
    responseReceivedAt: row.wmkf_responsereceivedat || null,
    accepted: row.wmkf_accepted ?? null,
    declined: row.wmkf_declined ?? null,
    selected: row.wmkf_selected ?? null,
    honorariumOptOut: row.wmkf_honorariumoptout ?? null,
  };
}

async function main() {
  const token = await getToken();
  const requestSelect = [
    'akoya_requestid',
    'akoya_requestnum',
    'createdon',
    'modifiedon',
    'statecode',
    '_akoya_programid_value',
    '_wmkf_grantprogram_value',
    '_wmkf_type_value',
    'wmkf_request_type',
    'akoya_requesttype',
    '_akoya_goapplyapplication_value',
    '_wmkf_reviewedproposal_value',
  ].join(',');
  const programFilter = encodeURIComponent(
    `_akoya_programid_value eq ${DISCRIMINATORS.program}`,
  );
  const programRows = await getAll(
    token,
    `/akoya_requests?$select=${requestSelect}&$filter=${programFilter}`,
  );
  const honoraria = programRows.filter(isCompositeHonorarium);
  const honorariumById = new Map(
    honoraria.map((row) => [normalizeId(row.akoya_requestid), row]),
  );

  const suggestionSelect = [
    'wmkf_appreviewersuggestionid',
    'createdon',
    'modifiedon',
    'wmkf_responsereceivedat',
    'wmkf_accepted',
    'wmkf_declined',
    'wmkf_honorariumoptout',
    'wmkf_selected',
    'statecode',
    '_wmkf_request_value',
    '_wmkf_honorariumrequest_value',
  ].join(',');
  const linkedSuggestions = await getAll(
    token,
    `/wmkf_appreviewersuggestions?$select=${suggestionSelect}`
      + `&$filter=${encodeURIComponent('_wmkf_honorariumrequest_value ne null')}`,
  );
  const recentEligibleFilter = [
    `wmkf_responsereceivedat ge ${ROLLOUT_AT}`,
    'wmkf_accepted eq true',
    '(wmkf_honorariumoptout eq null or wmkf_honorariumoptout ne true)',
  ].join(' and ');
  const recentEligible = await getAll(
    token,
    `/wmkf_appreviewersuggestions?$select=${suggestionSelect}`
      + `&$filter=${encodeURIComponent(recentEligibleFilter)}`,
  );

  const linkedHonorariumIds = new Set(
    linkedSuggestions.map((row) => normalizeId(row._wmkf_honorariumrequest_value)),
  );
  const linkedOutsideComposite = linkedSuggestions.filter(
    (row) => !honorariumById.has(normalizeId(row._wmkf_honorariumrequest_value)),
  );
  const linkedMissingProposal = [];
  const linkedProposalMismatch = [];
  const linkedProposalMatch = [];

  for (const suggestion of linkedSuggestions) {
    const honorarium = honorariumById.get(normalizeId(suggestion._wmkf_honorariumrequest_value));
    if (!honorarium) continue;
    if (!honorarium._wmkf_reviewedproposal_value) {
      linkedMissingProposal.push(suggestion);
    } else if (!sameId(honorarium._wmkf_reviewedproposal_value, suggestion._wmkf_request_value)) {
      linkedProposalMismatch.push(suggestion);
    } else {
      linkedProposalMatch.push(suggestion);
    }
  }

  const portalEraHonoraria = honoraria.filter((row) => row.createdon >= ROLLOUT_AT);
  const directLinkedHonoraria = honoraria.filter((row) => row._wmkf_reviewedproposal_value);
  const goApplyHonoraria = honoraria.filter((row) => row._akoya_goapplyapplication_value);
  const nonGoApplyHonoraria = honoraria.filter((row) => !row._akoya_goapplyapplication_value);
  const orphanPortalEraHonoraria = portalEraHonoraria.filter(
    (row) => !linkedHonorariumIds.has(normalizeId(row.akoya_requestid)),
  );
  const recentEligibleWithJunction = recentEligible.filter(
    (row) => row._wmkf_honorariumrequest_value,
  );
  const recentEligibleWithoutJunction = recentEligible.filter(
    (row) => !row._wmkf_honorariumrequest_value,
  );
  const recentEligibleFullyLinked = recentEligible.filter((suggestion) => {
    const honorarium = honorariumById.get(normalizeId(suggestion._wmkf_honorariumrequest_value));
    return honorarium
      && sameId(honorarium._wmkf_reviewedproposal_value, suggestion._wmkf_request_value);
  });

  const report = {
    probedAt: new Date().toISOString(),
    targetHost: PRODUCTION_HOST,
    rolloutCutoff: ROLLOUT_AT,
    rowPopulations: {
      researchReviewerProgramRows: programRows.length,
      compositeHonorariumRows: honoraria.length,
      goApplyOriginHonoraria: goApplyHonoraria.length,
      nonGoApplyOriginHonoraria: nonGoApplyHonoraria.length,
      portalEraHonoraria: portalEraHonoraria.length,
      honorariaWithDirectProposalLink: directLinkedHonoraria.length,
      portalEraHonorariaWithDirectProposalLink: portalEraHonoraria.filter(
        (row) => row._wmkf_reviewedproposal_value,
      ).length,
      suggestionRowsWithHonorariumJunction: linkedSuggestions.length,
      recentAcceptedNonOptOutSuggestions: recentEligible.length,
      recentAcceptedWithHonorariumJunction: recentEligibleWithJunction.length,
      recentAcceptedFullyLinked: recentEligibleFullyLinked.length,
    },
    crossChecks: {
      suggestionJunctionTargetsCompositeHonorarium: linkedSuggestions.length
        - linkedOutsideComposite.length,
      junctionAndDirectProposalAgree: linkedProposalMatch.length,
      junctionTargetMissingDirectProposal: linkedMissingProposal.length,
      junctionAndDirectProposalDisagree: linkedProposalMismatch.length,
      portalEraHonorariumWithoutSuggestionJunction: orphanPortalEraHonoraria.length,
      recentAcceptedWithoutHonorariumJunction: recentEligibleWithoutJunction.length,
    },
    anomalyIds: {
      linkedOutsideComposite: anomalyIds(linkedOutsideComposite, 'wmkf_appreviewersuggestionid'),
      linkedMissingProposal: anomalyIds(linkedMissingProposal, 'wmkf_appreviewersuggestionid'),
      linkedProposalMismatch: anomalyIds(linkedProposalMismatch, 'wmkf_appreviewersuggestionid'),
      orphanPortalEraHonoraria: anomalyIds(orphanPortalEraHonoraria, 'akoya_requestid'),
      recentAcceptedWithoutJunction: anomalyIds(
        recentEligibleWithoutJunction,
        'wmkf_appreviewersuggestionid',
      ),
    },
    anomalyContext: {
      recentAcceptedWithoutJunction: recentEligibleWithoutJunction.map(suggestionContext),
    },
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(`HONORARIUM LINK PROBE ERROR: ${error.message}`);
  process.exit(1);
});
