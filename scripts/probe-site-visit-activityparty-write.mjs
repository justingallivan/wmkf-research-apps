#!/usr/bin/env node

/**
 * Reversible sandbox-only proof for custom Site Visit ActivityParty writes.
 *
 * Creates one clearly marked Site Visit sentinel, verifies nested organizer
 * creation, confirms direct ActivityParty create is unsupported, then proves
 * the runtime's ETag-fenced atomic same-ID replacement with nested parties.
 * Finally it deletes and confirms absence of the exact sentinel. Cleanup runs
 * in finally and the script never accepts production.
 *
 * Usage:
 *   node scripts/probe-site-visit-activityparty-write.mjs --target=sandbox --execute
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SANDBOX_HOSTS } from '../lib/dataverse/core/target-registry.js';

if (!process.argv.includes('--execute')
  || !process.argv.includes('--target=sandbox')) {
  throw new Error('This reversible write proof requires --target=sandbox --execute.');
}

for (const envFile of ['.env', '.env.local']) {
  try {
    for (const line of readFileSync(resolve(process.cwd(), envFile), 'utf8').split('\n')) {
      const text = line.trim();
      if (!text || text.startsWith('#')) continue;
      const index = text.indexOf('=');
      if (index < 1) continue;
      const key = text.slice(0, index).trim();
      const value = text.slice(index + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {}
}

const sandboxUrl = process.env.DYNAMICS_SANDBOX_URL
  || (SANDBOX_HOSTS[0] ? `https://${SANDBOX_HOSTS[0]}` : null);
const sandboxHost = (() => {
  try { return new URL(sandboxUrl).hostname.toLowerCase(); } catch { return null; }
})();
if (!sandboxUrl || !SANDBOX_HOSTS.includes(sandboxHost)) {
  throw new Error('DYNAMICS_SANDBOX_URL must resolve to a tracked sandbox host.');
}

const { DYNAMICS_TENANT_ID, DYNAMICS_CLIENT_ID, DYNAMICS_CLIENT_SECRET } = process.env;
if (!DYNAMICS_TENANT_ID || !DYNAMICS_CLIENT_ID || !DYNAMICS_CLIENT_SECRET) {
  throw new Error('Missing Dataverse client credentials.');
}

const tokenResponse = await fetch(
  `https://login.microsoftonline.com/${DYNAMICS_TENANT_ID}/oauth2/v2.0/token`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: DYNAMICS_CLIENT_ID,
      client_secret: DYNAMICS_CLIENT_SECRET,
      scope: `${sandboxUrl}/.default`,
    }),
  },
);
const tokenBody = await tokenResponse.json().catch(() => ({}));
if (!tokenResponse.ok || !tokenBody.access_token) {
  throw new Error(`Sandbox token request failed (${tokenResponse.status}).`);
}

const baseUrl = `${sandboxUrl}/api/data/v9.2`;
const headers = {
  Authorization: `Bearer ${tokenBody.access_token}`,
  Accept: 'application/json',
  'Content-Type': 'application/json',
  'OData-Version': '4.0',
  'OData-MaxVersion': '4.0',
};

async function request(path, init = {}, expected = [200, 201, 204]) {
  const response = await fetch(`${baseUrl}/${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers || {}) },
  });
  const text = await response.text();
  if (!expected.includes(response.status)) {
    throw new Error(`${init.method || 'GET'} ${path} failed (${response.status}): ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : null;
}

const activityId = randomUUID();
const requiredPartyId = randomUUID();
let activityCreated = false;
let requiredPartyCreated = false;

async function replaceActivityInChangeset({ etag, body }) {
  const batchBoundary = `batch_${randomUUID()}`;
  const changesetBoundary = `changeset_${randomUUID()}`;
  const lines = [
    `--${batchBoundary}`,
    `Content-Type: multipart/mixed; boundary=${changesetBoundary}`,
    '',
    `--${changesetBoundary}`,
    'Content-Type: application/http',
    'Content-Transfer-Encoding: binary',
    'Content-ID: 1',
    '',
    `DELETE ${baseUrl}/wmkf_sitevisits(${activityId}) HTTP/1.1`,
    `If-Match: ${etag}`,
    '',
    `--${changesetBoundary}`,
    'Content-Type: application/http',
    'Content-Transfer-Encoding: binary',
    'Content-ID: 2',
    '',
    `POST ${baseUrl}/wmkf_sitevisits HTTP/1.1`,
    'Content-Type: application/json',
    '',
    JSON.stringify(body),
    `--${changesetBoundary}--`,
    `--${batchBoundary}--`,
    '',
  ];
  const response = await fetch(`${baseUrl}/$batch`, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': `multipart/mixed; boundary=${batchBoundary}`,
    },
    body: lines.join('\r\n'),
  });
  const text = await response.text();
  const statuses = [...text.matchAll(/HTTP\/1\.1\s+(\d{3})/g)].map((match) => Number(match[1]));
  if (!response.ok || statuses.length !== 2 || statuses.some((status) => status < 200 || status >= 300)) {
    throw new Error(`Atomic Site Visit replacement failed (${response.status}; ${statuses.join(',')}): ${text.slice(0, 800)}`);
  }
}

try {
  const who = await request('WhoAmI');
  const user = await request(
    `systemusers(${who.UserId})?$select=systemuserid,fullname,internalemailaddress`,
  );
  if (!user.internalemailaddress) throw new Error('Sandbox app user has no organizer email.');

  const start = new Date(Date.now() + 60 * 60 * 1000);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  await request('wmkf_sitevisits', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      activityid: activityId,
      subject: `[WMKF INTERNAL PROBE] Site Visit ActivityParty ${activityId}`,
      description: 'Reversible sandbox capability proof; delete immediately.',
      scheduledstart: start.toISOString(),
      scheduledend: end.toISOString(),
      wmkf_visitformat: 100000002,
      wmkf_ianatimezone: 'America/Chicago',
      wmkf_locationorlink: 'WMKF sandbox probe / no external meeting',
      wmkf_attendeerefsjson: JSON.stringify({
        version: 1,
        organizer: { kind: 'staff', profileId: 1 },
        requiredAttendees: [],
        optionalAttendees: [],
      }),
      wmkf_SiteVisit_activity_parties: [{
        participationtypemask: 7,
        addressused: user.internalemailaddress,
        'partyid_systemuser@odata.bind': `/systemusers(${user.systemuserid})`,
      }],
    }),
  });
  activityCreated = true;

  const created = await request(
    `wmkf_sitevisits(${activityId})?`
      + '$select=activityid,subject,wmkf_visitformat,wmkf_ianatimezone,'
      + 'wmkf_locationorlink,wmkf_attendeerefsjson&'
      + '$expand=wmkf_SiteVisit_activity_parties('
      + '$select=activitypartyid,participationtypemask,addressused)',
  );
  const organizers = created.wmkf_SiteVisit_activity_parties
    .filter((party) => Number(party.participationtypemask) === 7);
  if (organizers.length !== 1) throw new Error('Nested organizer ActivityParty proof failed.');
  if (created.wmkf_visitformat !== 100000002
    || created.wmkf_ianatimezone !== 'America/Chicago'
    || !created.wmkf_attendeerefsjson) {
    throw new Error('Wave 21 Site Visit field create/read proof failed.');
  }

  let directCreateUnsupported = false;
  try {
    await request('activityparties', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        activitypartyid: requiredPartyId,
        participationtypemask: 5,
        addressused: 'site-visit-probe@invalid.wmkf.local',
        unresolvedpartyname: 'WMKF internal sandbox probe',
        'activityid_wmkf_sitevisit_activityparty@odata.bind': `/wmkf_sitevisits(${activityId})`,
      }),
    });
    requiredPartyCreated = true;
  } catch (error) {
    if (!String(error.message).includes("does not support entities of type 'activityparty'")) throw error;
    directCreateUnsupported = true;
  }
  if (!directCreateUnsupported) {
    throw new Error('Direct ActivityParty create unexpectedly succeeded; update the runtime contract and probe expectations.');
  }

  await replaceActivityInChangeset({
    etag: created['@odata.etag'],
    body: {
      activityid: activityId,
      subject: `[WMKF INTERNAL PROBE] Replaced Site Visit ${activityId}`,
      description: 'Atomic same-ID sandbox replacement proof; delete immediately.',
      scheduledstart: start.toISOString(),
      scheduledend: end.toISOString(),
      wmkf_visitformat: 100000001,
      wmkf_ianatimezone: 'America/Los_Angeles',
      wmkf_locationorlink: 'https://example.invalid/wmkf-sandbox-probe',
      wmkf_attendeerefsjson: JSON.stringify({
        version: 1,
        organizer: { kind: 'staff', profileId: 1 },
        requiredAttendees: [{ kind: 'manual', name: 'Probe', email: 'site-visit-probe@invalid.wmkf.local' }],
        optionalAttendees: [],
      }),
      wmkf_SiteVisit_activity_parties: [
        {
          participationtypemask: 7,
          addressused: user.internalemailaddress,
          'partyid_systemuser@odata.bind': `/systemusers(${user.systemuserid})`,
        },
        {
          participationtypemask: 5,
          addressused: 'site-visit-probe@invalid.wmkf.local',
          unresolvedpartyname: 'WMKF internal sandbox probe',
        },
      ],
    },
  });

  const withRequired = await request(
    `wmkf_sitevisits(${activityId})?`
      + '$select=activityid,wmkf_visitformat,wmkf_ianatimezone,'
      + 'wmkf_locationorlink,wmkf_attendeerefsjson&'
      + '$expand=wmkf_SiteVisit_activity_parties('
      + '$select=activitypartyid,participationtypemask,addressused)',
  );
  if (!withRequired.wmkf_SiteVisit_activity_parties.some((party) => (
    Number(party.participationtypemask) === 5
    && party.addressused === 'site-visit-probe@invalid.wmkf.local'
  ))) {
    throw new Error('Atomic replacement required ActivityParty was not visible on the Site Visit.');
  }
  if (withRequired.wmkf_visitformat !== 100000001
    || withRequired.wmkf_ianatimezone !== 'America/Los_Angeles'
    || !String(withRequired.wmkf_attendeerefsjson).includes('site-visit-probe@invalid.wmkf.local')) {
    throw new Error('Wave 21 fields did not survive atomic same-ID replacement.');
  }

  console.log(JSON.stringify({
    target: 'sandbox',
    host: sandboxHost,
    nestedOrganizerCreate: 'PASS',
    directActivityPartyCreate: 'CONFIRMED UNSUPPORTED',
    etagFencedAtomicSameIdReplacement: 'PASS',
    wave21FieldCreateReadAndReplacement: 'PASS',
    sentinelActivityId: activityId,
  }, null, 2));
} finally {
  const cleanupErrors = [];
  if (requiredPartyCreated) {
    await request(`activityparties(${requiredPartyId})`, { method: 'DELETE' }, [204, 404])
      .catch((error) => cleanupErrors.push(error.message));
  }
  if (activityCreated) {
    await request(`wmkf_sitevisits(${activityId})`, { method: 'DELETE' }, [204, 404])
      .catch((error) => cleanupErrors.push(error.message));
    await request(`wmkf_sitevisits(${activityId})?$select=activityid`, {}, [404])
      .catch((error) => cleanupErrors.push(error.message));
  }
  if (cleanupErrors.length) {
    throw new Error(`Sandbox sentinel cleanup was not confirmed: ${cleanupErrors.join(' | ')}`);
  }
}
