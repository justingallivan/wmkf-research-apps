#!/usr/bin/env node
/**
 * Deploy artifact for the reviewer relevance-score range bug.
 *
 * Admin runbook:
 *   Run this once after the code change is deployed to widen
 *   wmkf_appreviewersuggestion.wmkf_relevancescore from MaxValue=1 to
 *   MaxValue=100 in Dataverse metadata. The script is idempotent: it first
 *   reads the live attribute metadata and exits cleanly when MaxValue is
 *   already at least 100.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client.js');

const ENTITY_LOGICAL_NAME = 'wmkf_appreviewersuggestion';
const ATTRIBUTE_LOGICAL_NAME = 'wmkf_relevancescore';
const TARGET_MAX_VALUE = 100;
const METADATA_PATH = `/EntityDefinitions(LogicalName='${ENTITY_LOGICAL_NAME}')/Attributes(LogicalName='${ATTRIBUTE_LOGICAL_NAME}')`;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function metadataTypeName(attribute) {
  return String(attribute?.['@odata.type'] || attribute?.AttributeTypeName?.Value || '');
}

function patchBodyFor(attribute) {
  const typeName = metadataTypeName(attribute);
  if (/DoubleAttributeMetadata/i.test(typeName)) {
    return {
      '@odata.type': 'Microsoft.Dynamics.CRM.DoubleAttributeMetadata',
      MaxValue: TARGET_MAX_VALUE,
      MinValue: attribute.MinValue ?? 0,
      Precision: attribute.Precision ?? 4,
    };
  }
  if (/DecimalAttributeMetadata/i.test(typeName)) {
    return {
      '@odata.type': 'Microsoft.Dynamics.CRM.DecimalAttributeMetadata',
      MaxValue: TARGET_MAX_VALUE,
      MinValue: attribute.MinValue ?? 0,
      Precision: attribute.Precision ?? 4,
    };
  }
  fail(`Refusing to patch ${ATTRIBUTE_LOGICAL_NAME}: expected Double or Decimal metadata, got ${typeName || '(unknown)'}`);
}

async function main() {
  loadEnvLocal();
  const resourceUrl = process.env.DYNAMICS_URL || process.env.DATAVERSE_URL;
  if (!resourceUrl) fail('Missing DYNAMICS_URL or DATAVERSE_URL');

  const token = await getAccessToken(resourceUrl);
  const client = createClient({ resourceUrl, token });

  const current = await client.get(METADATA_PATH);
  if (!current.ok) {
    fail(`GET metadata failed (${current.status}): ${current.text}`);
  }

  const attribute = current.body;
  const typeName = metadataTypeName(attribute);
  const currentMax = Number(attribute.MaxValue);
  console.log(`${ATTRIBUTE_LOGICAL_NAME}: type=${typeName || '(unknown)'} MinValue=${attribute.MinValue} MaxValue=${attribute.MaxValue} Precision=${attribute.Precision}`);

  if (Number.isFinite(currentMax) && currentMax >= TARGET_MAX_VALUE) {
    console.log(`No change needed: MaxValue is already ${attribute.MaxValue}.`);
    return;
  }

  const body = patchBodyFor(attribute);
  const patched = await client.patch(METADATA_PATH, body);
  if (!patched.ok) {
    fail(`PATCH metadata failed (${patched.status}): ${patched.text}`);
  }

  console.log(`Updated ${ATTRIBUTE_LOGICAL_NAME} MaxValue to ${TARGET_MAX_VALUE}.`);
}

main().catch((err) => fail(err?.stack || err?.message || String(err)));
