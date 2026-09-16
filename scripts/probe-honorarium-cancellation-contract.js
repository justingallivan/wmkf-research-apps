#!/usr/bin/env node
/**
 * Read-only Dataverse probe for the reviewer-honorarium cancellation contract.
 *
 * Verifies three facts before the application treats an open honorarium as
 * cancelled instead of deleting it:
 *   1. the live akoya_request state/status option labels,
 *   2. cancellation-shaped fields that already exist on akoya_request, and
 *   3. the current honorarium cohort's request-status/payment-state buckets.
 *
 * The only POST obtains an OAuth token. Every Dataverse operation is a GET and
 * output is aggregate/metadata-only (no reviewer names, emails, or record ids).
 */

const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    let [, key, value] = match;
    value = value.trim().replace(/^"(.*)"$/, '$1');
    if (!process.env[key]) process.env[key] = value;
  }
}

const baseUrl = `${String(process.env.DYNAMICS_URL || '').replace(/\/$/, '')}/api/data/v9.2`;
const formattedValue = '@OData.Community.Display.V1.FormattedValue';

async function getToken() {
  const response = await fetch(
    `https://login.microsoftonline.com/${process.env.DYNAMICS_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: process.env.DYNAMICS_CLIENT_ID,
        client_secret: process.env.DYNAMICS_CLIENT_SECRET,
        scope: `${String(process.env.DYNAMICS_URL || '').replace(/\/$/, '')}/.default`,
      }),
    },
  );
  if (!response.ok) throw new Error(`OAuth token request failed (${response.status})`);
  return (await response.json()).access_token;
}

async function get(token, pathname) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'OData-Version': '4.0',
      Prefer: 'odata.include-annotations="*",odata.maxpagesize=5000',
    },
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!response.ok) throw new Error(`Dataverse GET failed (${response.status})`);
  return body;
}

function optionRows(metadata) {
  return (metadata?.OptionSet?.Options || []).map((option) => ({
    value: option.Value,
    label: option.Label?.UserLocalizedLabel?.Label || '(unlabeled)',
    state: option.State == null ? null : option.State,
  }));
}

async function allRecords(token, pathname) {
  const rows = [];
  let next = `${baseUrl}${pathname}`;
  while (next) {
    const response = await fetch(next, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'OData-Version': '4.0',
        Prefer: 'odata.include-annotations="*",odata.maxpagesize=5000',
      },
    });
    if (!response.ok) throw new Error(`Dataverse cohort GET failed (${response.status})`);
    const body = await response.json();
    rows.push(...(body.value || []));
    next = body['@odata.nextLink'] || null;
  }
  return rows;
}

(async () => {
  const token = await getToken();

  const [stateMetadata, statusMetadata, attributes, programs] = await Promise.all([
    get(token, "/EntityDefinitions(LogicalName='akoya_request')/Attributes(LogicalName='statecode')/Microsoft.Dynamics.CRM.StateAttributeMetadata?$select=LogicalName&$expand=OptionSet"),
    get(token, "/EntityDefinitions(LogicalName='akoya_request')/Attributes(LogicalName='statuscode')/Microsoft.Dynamics.CRM.StatusAttributeMetadata?$select=LogicalName&$expand=OptionSet"),
    get(token, "/EntityDefinitions(LogicalName='akoya_request')/Attributes?$select=LogicalName,AttributeType,DisplayName"),
    get(token, "/akoya_programs?$select=akoya_programid&$filter=akoya_program eq 'Research Reviewer'"),
  ]);

  const programId = programs.value?.[0]?.akoya_programid;
  if (!programId) throw new Error('Research Reviewer program was not found');

  console.log('akoya_request statecode options:');
  console.table(optionRows(stateMetadata));
  console.log('akoya_request statuscode options:');
  console.table(optionRows(statusMetadata));

  const cancellationFields = (attributes.value || [])
    .map((attribute) => ({
      logicalName: attribute.LogicalName,
      type: attribute.AttributeType,
      label: attribute.DisplayName?.UserLocalizedLabel?.Label || '',
    }))
    .filter((attribute) => /cancel|void|withdraw|close/i.test(`${attribute.logicalName} ${attribute.label}`))
    .sort((left, right) => left.logicalName.localeCompare(right.logicalName));
  console.log('Cancellation-shaped akoya_request fields:');
  console.table(cancellationFields);

  const cohort = await allRecords(
    token,
    `/akoya_requests?$select=akoya_requeststatus,statecode,statuscode,wmkf_authorizationtoremitpaymentflag,akoya_paid&$filter=_akoya_programid_value eq ${programId}`,
  );
  const buckets = new Map();
  for (const row of cohort) {
    const key = JSON.stringify({
      requestStatus: row.akoya_requeststatus || '(null)',
      state: row[`statecode${formattedValue}`] || String(row.statecode),
      statusReason: row[`statuscode${formattedValue}`] || String(row.statuscode),
      authorizedToRemit: row.wmkf_authorizationtoremitpaymentflag === true,
      hasPaidAmount: Number(row.akoya_paid || 0) > 0,
    });
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  console.log(`Honorarium cohort rows: ${cohort.length}`);
  console.table([...buckets.entries()]
    .map(([key, count]) => ({ ...JSON.parse(key), count }))
    .sort((left, right) => right.count - left.count));

  const withdrawnRows = await allRecords(
    token,
    "/akoya_requests?$select=statecode,statuscode,wmkf_datewithdrawalreceived&$filter=akoya_requeststatus eq 'Withdrawn'",
  );
  const withdrawnBuckets = new Map();
  for (const row of withdrawnRows) {
    const key = JSON.stringify({
      state: row[`statecode${formattedValue}`] || String(row.statecode),
      statusReason: row[`statuscode${formattedValue}`] || String(row.statuscode),
      hasWithdrawalDate: Boolean(row.wmkf_datewithdrawalreceived),
    });
    withdrawnBuckets.set(key, (withdrawnBuckets.get(key) || 0) + 1);
  }
  console.log(`All akoya_request rows whose Request Status is Withdrawn: ${withdrawnRows.length}`);
  console.table([...withdrawnBuckets.entries()]
    .map(([key, count]) => ({ ...JSON.parse(key), count }))
    .sort((left, right) => right.count - left.count));
})().catch((error) => {
  console.error(`PROBE ERROR: ${error.message}`);
  process.exitCode = 1;
});
