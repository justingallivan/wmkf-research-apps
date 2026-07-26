#!/usr/bin/env node

/**
 * Read-only provenance probe for the review-form EICAR fixture's thank-you
 * lifecycle marker.
 *
 * Captures:
 *   - the suggestion's current lifecycle timestamps and audit configuration;
 *   - per-record Dataverse change history for the relevant lifecycle fields;
 *   - Dynamics email activities regarding the linked request around the marker;
 *   - activity parties for those emails, so the recipient can be corroborated.
 *
 * The only POST is the OAuth token request to Microsoft identity. Every
 * Dataverse operation is GET. No email is sent and no row is changed.
 *
 * Usage:
 *   DATAVERSE_ALLOW_PROD_READS=yes \
 *     node scripts/probe-review-thankyou-provenance.mjs \
 *     --output outputs/review-form-multiselect/thankyou-provenance-2026-07-26.json
 */

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client');

loadEnvLocal();

const SUGGESTION_ID = '6ad328b4-f044-f111-88b5-000d3a306d45';
const REQUEST_ID = '54e2b88b-04b9-f011-bbd3-6045bd02b4cc';
const EXPECTED_REVIEWER_EMAIL = 'justingallivan@me.com';
const MARKER_ISO = '2026-05-01T01:11:26Z';
const WINDOW_START = '2026-04-30T00:00:00Z';
const WINDOW_END = '2026-05-02T12:00:00Z';
const RELEVANT_FIELDS = new Set([
  'wmkf_thankyousentat',
  'wmkf_reviewreceivedat',
  'wmkf_reviewstatus',
  'wmkf_completedat',
  'wmkf_reviewfilename',
]);

function arg(name) {
  const exact = `--${name}`;
  const index = process.argv.indexOf(exact);
  if (index >= 0) return process.argv[index + 1];
  const prefix = `${exact}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function requireProductionReadApproval(resource) {
  const hostname = new URL(resource).hostname.toLowerCase();
  if (process.env.DATAVERSE_ALLOW_PROD_READS !== 'yes') {
    throw new Error(
      `Production reads against ${hostname} require DATAVERSE_ALLOW_PROD_READS=yes`,
    );
  }
  return hostname;
}

function bodyOrThrow(label, response) {
  if (!response.ok) {
    throw new Error(`${label} failed (${response.status}): ${response.text.slice(0, 500)}`);
  }
  return response.body;
}

function formatted(row, key) {
  return row?.[`${key}@OData.Community.Display.V1.FormattedValue`] ?? null;
}

function plainValue(value) {
  if (value == null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !key.startsWith('@') && !key.includes('@OData.'))
      .map(([key, entry]) => [key, entry]),
  );
}

function relevantDelta(value) {
  const clean = plainValue(value) || {};
  return Object.fromEntries(
    Object.entries(clean).filter(([key]) => {
      const logical = key.startsWith('_') && key.endsWith('_value')
        ? key.slice(1, -6)
        : key;
      return RELEVANT_FIELDS.has(logical);
    }),
  );
}

function summarizeAuditDetail(detail) {
  const record = detail.AuditRecord || {};
  return {
    auditId: record.auditid ?? null,
    createdOn: record.createdon ?? null,
    action: formatted(record, 'action') ?? record.action ?? null,
    operation: formatted(record, 'operation') ?? record.operation ?? null,
    changedBy: formatted(record, '_userid_value') ?? null,
    changedById: record._userid_value ?? null,
    transactionId: record.transactionid ?? null,
    oldValue: relevantDelta(detail.OldValue),
    newValue: relevantDelta(detail.NewValue),
  };
}

function summarizeEmail(row, parties) {
  return {
    activityId: row.activityid,
    subject: row.subject ?? null,
    createdOn: row.createdon ?? null,
    sentOn: row.senton ?? null,
    modifiedOn: row.modifiedon ?? null,
    state: formatted(row, 'statecode') ?? row.statecode ?? null,
    status: formatted(row, 'statuscode') ?? row.statuscode ?? null,
    createdBy: formatted(row, '_createdby_value') ?? null,
    modifiedBy: formatted(row, '_modifiedby_value') ?? null,
    regarding: formatted(row, '_regardingobjectid_value') ?? null,
    parties: parties.map((party) => ({
      roleCode: party.participationtypemask ?? null,
      role: formatted(party, 'participationtypemask') ?? party.participationtypemask ?? null,
      addressUsed: party.addressused ?? null,
      partyName: formatted(party, '_partyid_value') ?? null,
      partyId: party._partyid_value ?? null,
    })),
  };
}

async function main() {
  const resource = process.env.DYNAMICS_URL;
  if (!resource) throw new Error('DYNAMICS_URL not set');
  const hostname = requireProductionReadApproval(resource);
  const token = await getAccessToken(resource);
  const client = createClient({ resourceUrl: resource, token });
  const annotationHeaders = { Prefer: 'odata.include-annotations="*"' };

  const suggestionSelect = [
    'wmkf_appreviewersuggestionid',
    'wmkf_suggestionlabel',
    'createdon',
    'modifiedon',
    '_createdby_value',
    '_modifiedby_value',
    '_wmkf_request_value',
    '_wmkf_potentialreviewer_value',
    'wmkf_selected',
    'wmkf_accepted',
    'wmkf_reviewstatus',
    'wmkf_reviewreceivedat',
    'wmkf_completedat',
    'wmkf_thankyousentat',
    'wmkf_reviewfilename',
  ].join(',');
  const suggestionResponse = await client.get(
    `/wmkf_appreviewersuggestions(${SUGGESTION_ID})?$select=${suggestionSelect}`,
    annotationHeaders,
  );
  const suggestion = bodyOrThrow('suggestion read', suggestionResponse);

  const entityMetadata = bodyOrThrow(
    'suggestion audit metadata read',
    await client.get(
      "/EntityDefinitions(LogicalName='wmkf_appreviewersuggestion')" +
        '?$select=LogicalName,EntitySetName,IsAuditEnabled',
    ),
  );
  const attributeMetadata = bodyOrThrow(
    'thank-you audit metadata read',
    await client.get(
      "/EntityDefinitions(LogicalName='wmkf_appreviewersuggestion')" +
        "/Attributes(LogicalName='wmkf_thankyousentat')" +
        '?$select=LogicalName,IsAuditEnabled',
    ),
  );

  const target = encodeURIComponent(JSON.stringify({
    '@odata.id': `${entityMetadata.EntitySetName}(${SUGGESTION_ID})`,
  }));
  const historyResponse = await client.get(
    `/RetrieveRecordChangeHistory(Target=@target)?@target=${target}`,
    annotationHeaders,
  );
  const historyReadable = historyResponse.ok;
  const historyDetails = historyReadable
    ? historyResponse.body?.AuditDetailCollection?.AuditDetails || []
    : [];
  const relevantHistory = historyDetails
    .map(summarizeAuditDetail)
    .filter((entry) => (
      Object.keys(entry.oldValue).length > 0 || Object.keys(entry.newValue).length > 0
    ));

  const emailFilter = [
    `_regardingobjectid_value eq ${REQUEST_ID}`,
    `createdon ge ${WINDOW_START}`,
    `createdon lt ${WINDOW_END}`,
  ].join(' and ');
  const emailSelect = [
    'activityid',
    'subject',
    'createdon',
    'senton',
    'modifiedon',
    'statecode',
    'statuscode',
    '_createdby_value',
    '_modifiedby_value',
    '_regardingobjectid_value',
  ].join(',');
  const emailResponse = await client.get(
    `/emails?$select=${emailSelect}` +
      `&$filter=${encodeURIComponent(emailFilter)}` +
      '&$orderby=createdon asc&$top=100' +
      '&$expand=email_activity_parties(' +
        '$select=activitypartyid,addressused,participationtypemask,_partyid_value)',
    annotationHeaders,
  );
  const emailRows = bodyOrThrow('email activity read', emailResponse).value || [];
  const emails = emailRows.map((row) => (
    summarizeEmail(row, row.email_activity_parties || [])
  ));

  const markerMs = Date.parse(MARKER_ISO);
  const markerAdjacentEmails = emails
    .map((email) => {
      const emailTime = Date.parse(email.sentOn || email.createdOn || '');
      return {
        ...email,
        secondsFromMarker: Number.isFinite(emailTime)
          ? Math.round((emailTime - markerMs) / 1000)
          : null,
      };
    })
    .sort((left, right) => (
      Math.abs(left.secondsFromMarker ?? Number.MAX_SAFE_INTEGER) -
      Math.abs(right.secondsFromMarker ?? Number.MAX_SAFE_INTEGER)
    ));

  const recipientMatchEmailIds = markerAdjacentEmails
    .filter((email) => email.parties.some((party) => (
      party.roleCode === 2 &&
      String(party.addressUsed || '').toLowerCase() === EXPECTED_REVIEWER_EMAIL
    )))
    .map((email) => email.activityId);

  const evidence = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    target: { hostname },
    fixture: {
      suggestionId: SUGGESTION_ID,
      requestId: REQUEST_ID,
      expectedReviewerEmail: EXPECTED_REVIEWER_EMAIL,
      marker: MARKER_ISO,
      suggestion,
    },
    audit: {
      entityAuditEnabled: entityMetadata.IsAuditEnabled?.Value ?? null,
      thankYouAttributeAuditEnabled: attributeMetadata.IsAuditEnabled?.Value ?? null,
      historyReadable,
      historyStatus: historyResponse.status,
      historyError: historyReadable ? null : historyResponse.text.slice(0, 500),
      totalHistoryEvents: historyDetails.length,
      relevantHistory,
    },
    emailWindow: {
      start: WINDOW_START,
      end: WINDOW_END,
      regardingRequestId: REQUEST_ID,
      count: markerAdjacentEmails.length,
      recipientMatchEmailIds,
      emails: markerAdjacentEmails,
    },
    interpretationInputs: {
      markerPredatesCurrentReviewReceived: (
        Date.parse(suggestion.wmkf_thankyousentat || '') <
        Date.parse(suggestion.wmkf_reviewreceivedat || '')
      ),
      closestEmailSecondsFromMarker: markerAdjacentEmails[0]?.secondsFromMarker ?? null,
      closestEmailRecipientMatches: markerAdjacentEmails[0]
        ? recipientMatchEmailIds.includes(markerAdjacentEmails[0].activityId)
        : false,
    },
  };

  const output = arg('output');
  if (output) {
    const outputPath = path.resolve(process.cwd(), output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(`Wrote ${path.relative(process.cwd(), outputPath)}`);
  } else {
    console.log(JSON.stringify(evidence, null, 2));
  }
}

main().catch((error) => {
  console.error(`probe-review-thankyou-provenance: ${error.message}`);
  process.exit(1);
});
