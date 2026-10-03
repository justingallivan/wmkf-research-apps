#!/usr/bin/env node

/**
 * Read-only cleanup REPORT for scheduled-email drafts left under an older
 * recipient generation (docs/plans/SCHEDULED_EMAIL_READDRESS_PLAN_2026-09-29.md
 * A5). A PD-handoff rebuild increments `recipient_generation`; a draft a
 * crashed worker created under a previous generation's correlation key
 * (`wmkf-scheduled-recipient:<id>` for generation 0, `…:<id>:g<n>` after) is
 * an unsent Dynamics draft nobody will adopt. This script lists them by
 * correlation key. It never deletes: deleting drafts is a separate,
 * owner-authorized step.
 *
 * Reads the ledger through POSTGRES_URL (SELECT only) and Dynamics through the
 * raw client (GET only). Prints ledger ids, generations, keys, activity ids and
 * status codes; never prints credentials.
 *
 * Usage: DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-scheduled-email-orphan-drafts.js
 */

const { Client } = require('pg');
const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client.js');

const PRODUCTION_URL = 'https://wmkf.crm.dynamics.com';

function correlationKey(id, generation) {
  const base = `wmkf-scheduled-recipient:${id}`;
  return generation > 0 ? `${base}:g${generation}` : base;
}

async function main() {
  loadEnvLocal();
  if (process.argv.length !== 2) throw new Error('This probe takes no arguments.');
  if (!process.env.POSTGRES_URL) throw new Error('POSTGRES_URL is required (ledger read).');
  const dynamicsUrl = process.env.DYNAMICS_URL;
  if (!dynamicsUrl) throw new Error('DYNAMICS_URL is required.');
  if (dynamicsUrl === PRODUCTION_URL && process.env.DATAVERSE_ALLOW_PROD_READS !== 'yes') {
    throw new Error('Production reads require DATAVERSE_ALLOW_PROD_READS=yes.');
  }

  const pg = new Client({ connectionString: process.env.POSTGRES_URL });
  await pg.connect();
  let rows;
  try {
    ({ rows } = await pg.query(
      `SELECT id, recipient_generation, status, dynamics_email_id
         FROM scheduled_email_messages
        WHERE recipient_generation > 0
        ORDER BY updated_at ASC`,
    ));
  } finally {
    await pg.end();
  }
  console.log(`Ledger rows with recipient_generation > 0: ${rows.length}`);
  if (rows.length === 0) return;

  const client = createClient({ resourceUrl: dynamicsUrl, token: await getAccessToken(dynamicsUrl) });
  let orphanDrafts = 0;
  for (const row of rows) {
    for (let generation = 0; generation < row.recipient_generation; generation++) {
      const key = correlationKey(row.id, generation);
      const filter = encodeURIComponent(`subcategory eq '${key.replace(/'/g, "''")}'`);
      const response = await client.get(
        `/emails?$select=activityid,statecode,statuscode,createdon&$filter=${filter}&$top=5`,
      );
      if (!response.ok) throw new Error(`Email query for ${key} returned HTTP ${response.status}.`);
      const drafts = response.body?.value || [];
      for (const draft of drafts) {
        orphanDrafts += 1;
        console.log(
          `  row ${row.id} (status ${row.status}, current generation ${row.recipient_generation}) ` +
          `older key ${key} -> activity ${draft.activityid} statecode=${draft.statecode} statuscode=${draft.statuscode} createdon=${draft.createdon}`,
        );
      }
    }
  }
  console.log(`Older-generation drafts found: ${orphanDrafts}. Nothing was changed; deletion is a separate owner-authorized step.`);
}

main().catch((error) => {
  console.error(`probe failed: ${error.message}`);
  process.exit(1);
});
