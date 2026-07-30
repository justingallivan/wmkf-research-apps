#!/usr/bin/env node

/**
 * READ-ONLY probe for applicant-recommended reviewer identity reuse.
 *
 * For one request number, reports:
 * - the five legacy applicant-recommended Potential Reviewer lookups;
 * - active/inactive Potential Reviewer rows with the same first + last name;
 * - request-scoped suggestion rows; and
 * - prior suggestion history for each slot record.
 *
 * Usage:
 *   DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-applicant-reviewer-known-state.mjs 1002959
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  loadEnvLocal,
  getAccessToken,
  createClient,
} = require('../lib/dataverse/client.js');

const requestNumber = String(process.argv[2] || '').trim();
if (!/^\d+$/.test(requestNumber)) {
  console.error('Usage: probe-applicant-reviewer-known-state.mjs <request-number>');
  process.exit(1);
}

function escapeOdataString(value) {
  return String(value || '').replaceAll("'", "''");
}

function queryPath(entitySet, params) {
  return `/${entitySet}?${new URLSearchParams(params).toString()}`;
}

async function getValue(client, entitySet, params) {
  const response = await client.get(queryPath(entitySet, params));
  if (!response.ok) {
    throw new Error(`GET ${entitySet} failed (${response.status}): ${response.text}`);
  }
  return response.body?.value || [];
}

function summarizePerson(row) {
  return {
    id: row.wmkf_potentialreviewersid,
    name: row.wmkf_name || null,
    email: row.wmkf_emailaddress || null,
    emailSource: row.wmkf_emailsource || null,
    orcid: row.wmkf_orcid || null,
    affiliation: row.wmkf_primaryaffiliation || row.wmkf_organizationname || null,
    contactId: row._wmkf_contact_value || null,
    statecode: row.statecode,
    statuscode: row.statuscode,
  };
}

function summarizeSuggestion(row) {
  return {
    id: row.wmkf_appreviewersuggestionid,
    requestId: row._wmkf_request_value || null,
    potentialReviewerId: row._wmkf_potentialreviewer_value || null,
    selected: row.wmkf_selected === true,
    applicantDisposition: row.wmkf_applicantdisposition ?? null,
    sources: row.wmkf_sources || null,
    invited: row.wmkf_invited === true,
    accepted: row.wmkf_accepted === true,
    declined: row.wmkf_declined === true,
    createdOn: row.createdon || null,
  };
}

async function main() {
  loadEnvLocal();
  const resourceUrl = process.env.DYNAMICS_URL || process.env.DATAVERSE_URL;
  if (!resourceUrl) throw new Error('Missing DYNAMICS_URL or DATAVERSE_URL');

  const token = await getAccessToken(resourceUrl);
  const client = createClient({ resourceUrl, token });
  const requestRows = await getValue(client, 'akoya_requests', {
    $filter: `akoya_requestnum eq '${escapeOdataString(requestNumber)}'`,
    $select: [
      'akoya_requestid',
      'akoya_requestnum',
      'akoya_title',
      '_wmkf_potentialreviewer1_value',
      '_wmkf_potentialreviewer2_value',
      '_wmkf_potentialreviewer3_value',
      '_wmkf_potentialreviewer4_value',
      '_wmkf_potentialreviewer5_value',
    ].join(','),
    $top: '2',
  });
  if (requestRows.length !== 1) {
    throw new Error(`Expected one request ${requestNumber}; found ${requestRows.length}`);
  }

  const request = requestRows[0];
  const suggestionSelect = [
    'wmkf_appreviewersuggestionid',
    '_wmkf_request_value',
    '_wmkf_potentialreviewer_value',
    'wmkf_selected',
    'wmkf_applicantdisposition',
    'wmkf_sources',
    'wmkf_invited',
    'wmkf_accepted',
    'wmkf_declined',
    'createdon',
  ].join(',');
  const requestSuggestions = await getValue(client, 'wmkf_appreviewersuggestions', {
    $filter: `_wmkf_request_value eq ${request.akoya_requestid}`,
    $select: suggestionSelect,
    $top: '100',
  });

  const slots = [];
  for (let slot = 1; slot <= 5; slot += 1) {
    const personId = request[`_wmkf_potentialreviewer${slot}_value`];
    if (!personId) continue;

    const personResponse = await client.get(`/wmkf_potentialreviewerses(${personId})`);
    if (!personResponse.ok) {
      slots.push({ slot, personId, personReadStatus: personResponse.status });
      continue;
    }
    const person = personResponse.body;
    const sameNameRows = await getValue(client, 'wmkf_potentialreviewerses', {
      $filter: [
        `wmkf_firstname eq '${escapeOdataString(person.wmkf_firstname)}'`,
        `wmkf_lastname eq '${escapeOdataString(person.wmkf_lastname)}'`,
      ].join(' and '),
      $select: [
        'wmkf_potentialreviewersid',
        'wmkf_name',
        'wmkf_firstname',
        'wmkf_lastname',
        'wmkf_emailaddress',
        'wmkf_emailsource',
        'wmkf_orcid',
        'wmkf_primaryaffiliation',
        'wmkf_organizationname',
        '_wmkf_contact_value',
        'statecode',
        'statuscode',
      ].join(','),
      $top: '20',
    });
    const historyRows = await getValue(client, 'wmkf_appreviewersuggestions', {
      $filter: `_wmkf_potentialreviewer_value eq ${personId}`,
      $select: suggestionSelect,
      $orderby: 'createdon desc',
      $top: '100',
    });

    slots.push({
      slot,
      slotRecord: summarizePerson(person),
      sameNameRecords: sameNameRows.map(summarizePerson),
      suggestionHistory: historyRows.map(summarizeSuggestion),
    });
  }

  console.log(JSON.stringify({
    artifactType: 'applicant_reviewer_known_state_probe_v1',
    observedAt: new Date().toISOString(),
    request: {
      id: request.akoya_requestid,
      number: request.akoya_requestnum,
      title: request.akoya_title || null,
    },
    slots,
    requestSuggestions: requestSuggestions.map(summarizeSuggestion),
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
