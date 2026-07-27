#!/usr/bin/env node

/**
 * READ-ONLY production probe for the automatic grantee-deliverable reminder.
 *
 * Reports:
 * - the exact Dataverse subject/body setting rows consumed by the cron;
 * - whether those values match the tracked seeds and contain unresolved tokens;
 * - the current deliverable status/reminder-date distribution;
 * - rows currently eligible for the day-12 cron;
 * - claim-without-finalize rows (Reminder Sent with no reminded date); and
 * - recent Dynamics email activities regarding the affected requests.
 *
 * The only POST is OAuth token acquisition. Every tenant-data request is GET.
 * No cron endpoint is invoked and no Dataverse row is changed.
 *
 * Usage: node scripts/probe-grantee-reminder-state.mjs
 */

import fs from 'fs';
import { createHash } from 'crypto';
import {
  GRANTEE_REMINDER_SEED_BODY,
  GRANTEE_REMINDER_SEED_SUBJECT,
} from '../lib/seed/email-defaults/grantee-reminder.js';
import {
  GRANTEE_DELIVERABLE_LABEL,
  GRANTEE_DELIVERABLE_STATUS,
} from '../shared/config/granteeDeliverableStatus.js';
import { buildGranteeReminderBodyText } from '../lib/external/grantee-invite-email.js';

const env = fs.readFileSync('.env.local', 'utf8');
for (const line of env.split('\n')) {
  const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (match && !(match[1] in process.env)) {
    process.env[match[1]] = match[2]
      .trim()
      .replace(/^"(.*)"$/, '$1')
      .replace(/^'(.*)'$/, '$1');
  }
}

const {
  DYNAMICS_URL,
  DYNAMICS_TENANT_ID,
  DYNAMICS_CLIENT_ID,
  DYNAMICS_CLIENT_SECRET,
} = process.env;
if (!DYNAMICS_URL || !DYNAMICS_TENANT_ID || !DYNAMICS_CLIENT_ID || !DYNAMICS_CLIENT_SECRET) {
  console.error('Missing production Dynamics credentials in .env.local.');
  process.exit(2);
}

const SUBJECT_KEY = 'email.grantee_reminder.subject';
const BODY_KEY = 'email.grantee_reminder.body';
const CUTOFF_MS = Date.now() - 12 * 24 * 60 * 60 * 1000;
const DEADLINE_MS = Date.now() - 14 * 24 * 60 * 60 * 1000;
const EMAIL_LOOKBACK = '2026-06-01T00:00:00Z';
const escapeOdata = (value) => String(value).replace(/'/g, "''");
const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');

async function getToken() {
  const response = await fetch(
    `https://login.microsoftonline.com/${DYNAMICS_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: DYNAMICS_CLIENT_ID,
        client_secret: DYNAMICS_CLIENT_SECRET,
        scope: `${DYNAMICS_URL}/.default`,
      }),
    },
  );
  if (!response.ok) throw new Error(`OAuth token request failed: ${response.status}`);
  return (await response.json()).access_token;
}

async function getAll(token, relativePath) {
  let next = `${DYNAMICS_URL}/api/data/v9.2${relativePath}`;
  const rows = [];
  while (next) {
    const response = await fetch(next, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'OData-Version': '4.0',
        Prefer: 'odata.maxpagesize=500,odata.include-annotations="*"',
      },
    });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    if (!response.ok) {
      throw new Error(`GET ${relativePath} failed: ${response.status} ${String(text).slice(0, 300)}`);
    }
    rows.push(...(body.value || []));
    next = body['@odata.nextLink'] || null;
  }
  return rows;
}

function unresolvedTokens(value) {
  return [...String(value || '').matchAll(/\{\{[^}]+\}\}|\[[^\]]+\]/g)].map((m) => m[0]);
}

function printSetting(key, rows, seed) {
  const matching = rows.filter((row) => row.wmkf_settingkey === key);
  console.log(`\n${key}: ${matching.length} row(s)`);
  for (const row of matching) {
    const value = String(row.wmkf_settingvalue ?? '');
    console.log(`  id=${row.wmkf_appsystemsettingid}`);
    console.log(`  modifiedon=${row.modifiedon || '(none)'}`);
    console.log(`  chars=${value.length} sha256=${sha256(value)}`);
    console.log(`  nonblank=${value.trim() !== ''} matchesTrackedSeed=${value === seed}`);
    console.log(`  templateTokens=${JSON.stringify(unresolvedTokens(value))}`);
    console.log('  --- value ---');
    console.log(value);
    console.log('  --- end value ---');
  }
}

const token = await getToken();

const settingFilter = [
  `wmkf_settingkey eq '${escapeOdata(SUBJECT_KEY)}'`,
  `wmkf_settingkey eq '${escapeOdata(BODY_KEY)}'`,
].join(' or ');
const settings = await getAll(
  token,
  `/wmkf_appsystemsettings?$select=wmkf_appsystemsettingid,wmkf_settingkey,wmkf_settingvalue,createdon,modifiedon,_modifiedby_value` +
    `&$filter=${encodeURIComponent(settingFilter)}&$orderby=wmkf_settingkey asc,modifiedon desc`,
);

console.log('=== Grantee reminder Dataverse defaults ===');
printSetting(SUBJECT_KEY, settings, GRANTEE_REMINDER_SEED_SUBJECT);
printSetting(BODY_KEY, settings, GRANTEE_REMINDER_SEED_BODY);
const bodyRows = settings.filter((row) => row.wmkf_settingkey === BODY_KEY);
const currentBody = String(bodyRows[0]?.wmkf_settingvalue || '');
const sampleRenderedBody = buildGranteeReminderBodyText({
  bodyTemplate: currentBody,
  piName: 'Professor Example Grantee',
  title: 'Example Award',
  signatureBlock: { signature: 'Example Program Director\nW. M. Keck Foundation' },
  invitedDate: '2026-07-01T00:00:00Z',
});
console.log('\nRendered-body token check:');
console.log(`  remaining template tokens=${JSON.stringify(unresolvedTokens(sampleRenderedBody))}`);

const deliverables = await getAll(
  token,
  '/wmkf_granteedeliverables?' +
    '$select=wmkf_granteedeliverableid,_wmkf_request_value,wmkf_deliverablestatus,' +
    'wmkf_inviteddate,wmkf_remindeddate,createdon,modifiedon&$orderby=createdon asc',
);

const byStatus = new Map();
for (const row of deliverables) {
  const status = row.wmkf_deliverablestatus ?? null;
  byStatus.set(status, (byStatus.get(status) || 0) + 1);
}
const invitedEligible = deliverables.filter((row) =>
  row.wmkf_deliverablestatus === GRANTEE_DELIVERABLE_STATUS.INVITED &&
  row.wmkf_inviteddate &&
  new Date(row.wmkf_inviteddate).getTime() <= CUTOFF_MS
);
const invitedPastDeadline = deliverables.filter((row) =>
  row.wmkf_deliverablestatus === GRANTEE_DELIVERABLE_STATUS.INVITED &&
  row.wmkf_inviteddate &&
  new Date(row.wmkf_inviteddate).getTime() <= DEADLINE_MS
);
const claimedWithoutFinalize = deliverables.filter((row) =>
  row.wmkf_deliverablestatus === GRANTEE_DELIVERABLE_STATUS.REMINDER_SENT &&
  !row.wmkf_remindeddate
);
const finalizedReminders = deliverables.filter((row) => Boolean(row.wmkf_remindeddate));
const malformedRows = deliverables.filter((row) => {
  const status = row.wmkf_deliverablestatus;
  if (status === GRANTEE_DELIVERABLE_STATUS.INVITED && !row.wmkf_inviteddate) return true;
  if (row.wmkf_remindeddate && !row.wmkf_inviteddate) return true;
  if (row.wmkf_remindeddate && status === GRANTEE_DELIVERABLE_STATUS.DRAFTED) return true;
  if (row.wmkf_remindeddate && status === GRANTEE_DELIVERABLE_STATUS.INVITED) return true;
  return status === GRANTEE_DELIVERABLE_STATUS.DRAFTED &&
    Boolean(row.wmkf_inviteddate || row.wmkf_remindeddate);
});

console.log('\n=== Grantee deliverable reminder state ===');
console.log(`total rows=${deliverables.length}`);
for (const [status, count] of [...byStatus.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) {
  console.log(`  ${status ?? 'null'} (${GRANTEE_DELIVERABLE_LABEL[status] || 'Unknown'}): ${count}`);
}
console.log(`eligible now (Invited + inviteddate at least 12 days old)=${invitedEligible.length}`);
console.log(`past stated deadline (Invited + inviteddate at least 14 days old)=${invitedPastDeadline.length}`);
console.log(`Reminder Sent with remindeddate=${finalizedReminders.filter((r) => r.wmkf_deliverablestatus === GRANTEE_DELIVERABLE_STATUS.REMINDER_SENT).length}`);
console.log(`Reminder Sent without remindeddate=${claimedWithoutFinalize.length}`);
console.log(`any status with remindeddate=${finalizedReminders.length}`);
console.log(`malformed status/date combinations=${malformedRows.length}`);
for (const row of deliverables) {
  console.log(
    `  row=${row.wmkf_granteedeliverableid} status=${row.wmkf_deliverablestatus ?? 'null'}` +
    ` invited=${row.wmkf_inviteddate || '(none)'} reminded=${row.wmkf_remindeddate || '(none)'}`,
  );
}

const requestIds = [...new Set(deliverables.map((row) => row._wmkf_request_value).filter(Boolean))];
let emails = [];
if (requestIds.length) {
  const regardingFilter = requestIds
    .map((id) => `_regardingobjectid_value eq ${id}`)
    .join(' or ');
  const emailFilter = `(${regardingFilter}) and directioncode eq true and createdon ge ${EMAIL_LOOKBACK}`;
  emails = await getAll(
    token,
    '/emails?$select=activityid,subject,createdon,senton,statecode,statuscode,_regardingobjectid_value' +
      `&$filter=${encodeURIComponent(emailFilter)}&$orderby=createdon asc`,
  );
}

const subjectRows = settings.filter((row) => row.wmkf_settingkey === SUBJECT_KEY);
const currentSubject = subjectRows[0]?.wmkf_settingvalue || null;
const matchingSubjectEmails = currentSubject
  ? emails.filter((row) => row.subject === currentSubject)
  : [];
console.log('\n=== Recent Dynamics emails regarding current deliverable requests ===');
console.log(`lookback=${EMAIL_LOOKBACK}`);
console.log(`all outgoing email activities=${emails.length}`);
console.log(`subject exactly matches current reminder subject=${matchingSubjectEmails.length}`);
for (const row of matchingSubjectEmails) {
  console.log(
    `  email=${row.activityid} created=${row.createdon || '(none)'} sent=${row.senton || '(none)'}` +
    ` state=${row.statecode ?? 'null'} status=${row.statuscode ?? 'null'}`,
  );
}

const subjectRowsOk = subjectRows.length === 1 && String(subjectRows[0].wmkf_settingvalue || '').trim() !== '';
const bodyRowsOk = bodyRows.length === 1 && String(bodyRows[0].wmkf_settingvalue || '').trim() !== '';

if (!process.env.POSTGRES_URL && process.env.DATABASE_URL) {
  process.env.POSTGRES_URL = process.env.DATABASE_URL;
}
let defaultAlerts = [];
try {
  const { sql } = await import('@vercel/postgres');
  const alertResult = await sql`
    SELECT id, status, created_at, resolved_at, auto_resolve_key, metadata
    FROM system_alerts
    WHERE alert_type = 'email_default_misconfigured'
      AND (
        auto_resolve_key IN (
          ${`email-default-misconfigured:${SUBJECT_KEY}`},
          ${`email-default-misconfigured:${BODY_KEY}`}
        )
        OR metadata->>'key' IN (${SUBJECT_KEY}, ${BODY_KEY})
      )
    ORDER BY created_at ASC
  `;
  defaultAlerts = alertResult.rows || [];
} catch (error) {
  console.log(`\nAlert history query unavailable: ${error.message}`);
}
console.log('\n=== Reminder-default alert history ===');
console.log(`matching alerts=${defaultAlerts.length}`);
for (const alert of defaultAlerts) {
  console.log(
    `  id=${alert.id} status=${alert.status} created=${alert.created_at}` +
    ` resolved=${alert.resolved_at || '(none)'} key=${alert.metadata?.key || '(none)'}` +
    ` reason=${alert.metadata?.reason || '(none)'}`,
  );
}

console.log('\n=== Probe verdict ===');
console.log(`defaults resolvable=${subjectRowsOk && bodyRowsOk}`);
console.log(`rendered body leaves no supported template tokens=${unresolvedTokens(sampleRenderedBody).length === 0}`);
console.log(`current eligible backlog=${invitedEligible.length}`);
console.log(`claim-without-finalize backlog=${claimedWithoutFinalize.length}`);
console.log('READ-ONLY: OAuth was the only POST; all tenant data calls were GET.');
