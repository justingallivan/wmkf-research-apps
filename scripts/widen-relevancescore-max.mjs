#!/usr/bin/env node
/**
 * Deploy artifact for the reviewer relevance-score range bug.
 *
 * Widens wmkf_appreviewersuggestion.wmkf_relevancescore from MaxValue=1 to
 * MaxValue=100 in Dataverse metadata, then publishes the entity.
 *
 * Dataverse attribute metadata is updated with a full-definition PUT (PATCH is
 * NOT supported — returns 405), `MSCRM.MergeLabels: true`, followed by
 * PublishXml. We send back the complete GET'd definition (only MaxValue changed)
 * so no other property resets to a default; a malformed PUT 400s WITHOUT
 * partially applying, so this is fail-safe. Idempotent: exits cleanly when
 * MaxValue is already >= 100.
 *
 * Admin runbook: run once after the code change is deployed:
 *   node scripts/widen-relevancescore-max.mjs
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client.js');

const ENTITY = 'wmkf_appreviewersuggestion';
const ATTR = 'wmkf_relevancescore';
const TARGET_MAX = 100;
const CAST = 'Microsoft.Dynamics.CRM.DoubleAttributeMetadata';
const ATTR_PATH = `/EntityDefinitions(LogicalName='${ENTITY}')/Attributes(LogicalName='${ATTR}')`;
const CAST_PATH = `${ATTR_PATH}/${CAST}`;
// Never strip these from the PUT body — they identify/define the update.
const ESSENTIAL = new Set(['MaxValue', 'MinValue', 'Precision', 'MetadataId', 'SchemaName', 'LogicalName', 'AttributeType', '@odata.type']);

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function main() {
  loadEnvLocal();
  const resourceUrl = process.env.DYNAMICS_URL || process.env.DATAVERSE_URL;
  if (!resourceUrl) fail('Missing DYNAMICS_URL or DATAVERSE_URL');

  const token = await getAccessToken(resourceUrl);
  const client = createClient({ resourceUrl, token });

  // 1. GET the full attribute definition (non-cast path returns @odata.type +
  // the Double-specific MaxValue/MinValue/Precision).
  const cur = await client.get(ATTR_PATH);
  if (!cur.ok) fail(`GET metadata failed (${cur.status}): ${cur.text}`);
  const attr = cur.body;
  console.log(`current: type=${attr['@odata.type']} Min=${attr.MinValue} Max=${attr.MaxValue} Precision=${attr.Precision}`);
  if (!/DoubleAttributeMetadata/i.test(String(attr['@odata.type'] || '')))
    fail(`Refusing: expected Double metadata, got ${attr['@odata.type']}`);
  if (Number.isFinite(Number(attr.MaxValue)) && Number(attr.MaxValue) >= TARGET_MAX) {
    console.log(`No change needed: MaxValue is already ${attr.MaxValue}.`);
    return;
  }

  // 2. Full definition back, only MaxValue changed (so nothing else resets).
  const body = {};
  for (const [k, v] of Object.entries(attr)) {
    if (k.startsWith('@odata.')) continue;
    body[k] = v;
  }
  body['@odata.type'] = CAST;
  body.MaxValue = TARGET_MAX;

  // 3. PUT with MergeLabels; strip any read-only property the API rejects and retry.
  const headers = { 'MSCRM.MergeLabels': 'true' };
  for (let attempt = 0; ; attempt++) {
    const put = await client.raw('PUT', ATTR_PATH, body, headers);
    if (put.ok) { console.log(`PUT ok (${put.status})`); break; }
    const named = (put.text || '').match(/'([A-Za-z0-9_]+)'/);
    const prop = named && named[1];
    if (put.status === 400 && prop && prop in body && !ESSENTIAL.has(prop) && attempt < 20) {
      console.log(`  PUT 400 on read-only '${prop}' — stripping and retrying`);
      delete body[prop];
      continue;
    }
    fail(`PUT metadata failed (${put.status}): ${put.text}`);
  }

  // 4. Publish so the change is fully live (forms/validation).
  const pub = await client.post('/PublishXml', {
    ParameterXml: `<importexportxml><entities><entity>${ENTITY}</entity></entities></importexportxml>`,
  });
  if (!pub.ok) console.warn(`  PublishXml warning (${pub.status}): ${pub.text}`);
  else console.log('published');

  // 5. Verify read-back.
  const after = await client.get(ATTR_PATH);
  const newMax = Number(after.body?.MaxValue);
  if (after.ok && Number.isFinite(newMax) && newMax >= TARGET_MAX) {
    console.log(`VERIFIED: ${ATTR} MaxValue is now ${after.body.MaxValue}.`);
  } else {
    fail(`Verify FAILED: read back MaxValue=${after.body?.MaxValue} (status ${after.status})`);
  }
}

main().catch((err) => fail(err?.stack || err?.message || String(err)));
