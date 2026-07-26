#!/usr/bin/env node

/**
 * Read-only verification for the wave-15 review-answer multiselect property.
 *
 * Usage:
 *   DATAVERSE_ALLOW_PROD_READS=yes \
 *     node scripts/probe-review-answer-multiselect-field.mjs --target=prod
 *
 * Verifies both the exact metadata contract and that the property is selectable
 * through the normal entity-set endpoint. No records or metadata are written.
 */

import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client');

loadEnvLocal();

function targetFromArgs(argv) {
  const raw = argv.find((arg) => arg.startsWith('--target='));
  const target = raw ? raw.slice('--target='.length) : 'prod';
  if (target !== 'prod' && target !== 'sandbox') {
    throw new Error('--target must be prod or sandbox');
  }
  return target;
}

function resourceUrl(target) {
  const key = target === 'prod' ? 'DYNAMICS_URL' : 'DYNAMICS_SANDBOX_URL';
  const value = process.env[key];
  if (!value) throw new Error(`${key} not set`);
  return value;
}

function assertEqual(label, actual, expected) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function main() {
  const target = targetFromArgs(process.argv.slice(2));
  const resource = resourceUrl(target);
  const token = await getAccessToken(resource);
  const client = createClient({ resourceUrl: resource, token });
  const metadataPath =
    "/EntityDefinitions(LogicalName='wmkf_appreviewanswer')" +
    "/Attributes(LogicalName='wmkf_answervalues')" +
    '/Microsoft.Dynamics.CRM.MemoAttributeMetadata' +
    '?$select=LogicalName,SchemaName,AttributeType,MaxLength,RequiredLevel,IsCustomAttribute';

  const metadata = await client.get(metadataPath);
  if (!metadata.ok) {
    throw new Error(`metadata read failed: ${metadata.status} ${metadata.text.slice(0, 500)}`);
  }

  const field = metadata.body;
  assertEqual('LogicalName', field.LogicalName, 'wmkf_answervalues');
  assertEqual('SchemaName', field.SchemaName, 'wmkf_AnswerValues');
  assertEqual('AttributeType', field.AttributeType, 'Memo');
  assertEqual('MaxLength', field.MaxLength, 150000);
  assertEqual('RequiredLevel', field.RequiredLevel?.Value, 'None');
  assertEqual('IsCustomAttribute', field.IsCustomAttribute, true);

  const selectable = await client.get(
    '/wmkf_appreviewanswers?$select=wmkf_appreviewanswerid,wmkf_answervalues&$top=1',
  );
  if (!selectable.ok) {
    throw new Error(`entity-set select failed: ${selectable.status} ${selectable.text.slice(0, 500)}`);
  }

  console.log(JSON.stringify({
    ok: true,
    target,
    hostname: new URL(resource).hostname,
    field: {
      logicalName: field.LogicalName,
      schemaName: field.SchemaName,
      attributeType: field.AttributeType,
      maxLength: field.MaxLength,
      requiredLevel: field.RequiredLevel.Value,
      isCustomAttribute: field.IsCustomAttribute,
    },
    entitySetSelectable: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(`probe-review-answer-multiselect-field: ${error.message}`);
  process.exit(1);
});
