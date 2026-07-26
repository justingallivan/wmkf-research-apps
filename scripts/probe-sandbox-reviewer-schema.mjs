#!/usr/bin/env node
/**
 * READ-ONLY probe — does the Dataverse SANDBOX carry the reviewer schema chain?
 *
 * The multiselect build plan (docs/REVIEW_FORM_MULTISELECT_BUILD_PLAN.md §7) wants
 * to rehearse the whole external-review flow in the sandbox before exposing it in
 * production. That is only feasible if the sandbox actually hosts the reviewer
 * entities. `docs/atlas/dataverse-wmkf-appreviewanswer.md:50` claims it does not —
 * that `wmkf_appreviewersuggestion` 404s there — but that is a doc note from an
 * earlier session, not a live measurement. This probe measures it.
 *
 * Metadata reads only (EntityDefinitions), no records, no writes.
 *
 *   node scripts/probe-sandbox-reviewer-schema.mjs
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { loadEnvLocal } = require('../lib/dataverse/client');

loadEnvLocal();

const TENANT = process.env.DYNAMICS_TENANT_ID;
const CLIENT_ID = process.env.DYNAMICS_CLIENT_ID;
const CLIENT_SECRET = process.env.DYNAMICS_CLIENT_SECRET;

// The sandbox host from the tracked target registry (lib/dataverse/core/target-registry.js).
const SANDBOX_URL = process.env.DYNAMICS_SANDBOX_URL || 'https://orgd9e66399.crm.dynamics.com';

// The reviewer schema chain the rehearsal would need, parent first.
const ENTITIES = [
  'wmkf_appreviewersuggestion',
  'wmkf_appreviewanswer',
  'wmkf_reviewquestion',
  'wmkf_potentialreviewer',
  'akoya_request',
];

async function token(resource) {
  const resp = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      scope: `${resource}/.default`,
    }),
  });
  if (!resp.ok) throw new Error(`token failed (${resp.status}): ${await resp.text()}`);
  return (await resp.json()).access_token;
}

async function main() {
  console.log(`Sandbox: ${SANDBOX_URL}\n`);
  const t = await token(SANDBOX_URL);

  let present = 0;
  for (const logical of ENTITIES) {
    const url = `${SANDBOX_URL}/api/data/v9.2/EntityDefinitions(LogicalName='${logical}')?$select=LogicalName,EntitySetName`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${t}`, Accept: 'application/json' },
    });
    if (resp.ok) {
      const body = await resp.json();
      console.log(`  PRESENT  ${logical}  (entitySet: ${body.EntitySetName})`);
      present += 1;
    } else if (resp.status === 404) {
      console.log(`  ABSENT   ${logical}  (404)`);
    } else {
      console.log(`  ERROR    ${logical}  (${resp.status}) ${(await resp.text()).slice(0, 160)}`);
    }
  }

  console.log(`\nPresent: ${present} of ${ENTITIES.length} probed entities.`);
  console.log(present === ENTITIES.length
    ? 'Sandbox carries the probed reviewer chain — a sandbox rehearsal is feasible.'
    : 'Sandbox is MISSING part of the reviewer chain — a sandbox rehearsal needs a schema build-out first.');
}

main().catch((e) => {
  console.error('probe failed:', e.message);
  process.exit(1);
});
