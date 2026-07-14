#!/usr/bin/env node
/**
 * READ-ONLY M1.3 observational baseline for reviewer-sourcing channels.
 *
 * Reads every wmkf_appreviewersuggestion row and reports lifecycle outcomes by
 * each comma-separated wmkf_sources token. Multi-touch attribution and
 * exclusive-token cohorts are deliberately separate. The artifact contains
 * aggregate counts only: no reviewer names, emails, or proposal content.
 *
 * Usage:
 *   node scripts/probe-reviewer-channel-baseline.js --target=sandbox
 *   DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-reviewer-channel-baseline.js \
 *     --target=prod --output path/to/report.json
 */

const fs = require('node:fs');
const path = require('node:path');
const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client.js');
const { aggregateChannelBaseline } = require('./lib/reviewer-holistic-m1');

const ENTITY_SET = 'wmkf_appreviewersuggestions';
const SELECT = [
  'wmkf_appreviewersuggestionid',
  '_wmkf_potentialreviewer_value',
  '_wmkf_request_value',
  'wmkf_sources',
  'wmkf_selected',
  'wmkf_invited',
  'wmkf_accepted',
  'wmkf_declined',
  'wmkf_declinereferral',
  'wmkf_materialssentat',
  'wmkf_reviewreceivedat',
].join(',');

function parseCli(argv) {
  const targetArg = argv.find((arg) => arg.startsWith('--target='));
  if (!targetArg) throw new Error('--target=prod or --target=sandbox is required');
  const target = targetArg.slice('--target='.length);
  if (!['prod', 'sandbox'].includes(target)) {
    throw new Error("--target must be 'prod' or 'sandbox'");
  }
  const outputIndex = argv.indexOf('--output');
  const outputPath = outputIndex === -1 ? null : argv[outputIndex + 1];
  if (outputIndex !== -1 && (!outputPath || outputPath.startsWith('--'))) {
    throw new Error('--output requires a path');
  }
  const knownIndexes = new Set([argv.indexOf(targetArg)]);
  if (outputIndex !== -1) {
    knownIndexes.add(outputIndex);
    knownIndexes.add(outputIndex + 1);
  }
  const unknown = argv.filter((_, index) => !knownIndexes.has(index));
  if (unknown.length > 0) throw new Error(`unknown arguments: ${unknown.join(' ')}`);
  return { outputPath, target };
}

async function queryAll(client) {
  const rows = [];
  let requestPath = `/${ENTITY_SET}?${new URLSearchParams({ '$select': SELECT }).toString()}`;
  while (requestPath) {
    const response = await client.get(requestPath);
    if (!response.ok) {
      throw new Error(`GET ${requestPath} failed (${response.status}): ${response.text}`);
    }
    rows.push(...(response.body?.value || []));
    requestPath = response.body?.['@odata.nextLink'] || null;
  }
  return rows;
}

async function main() {
  const { outputPath, target } = parseCli(process.argv.slice(2));
  loadEnvLocal();
  if (target === 'prod' && process.env.DATAVERSE_ALLOW_PROD_READS !== 'yes') {
    throw new Error('Production reads require DATAVERSE_ALLOW_PROD_READS=yes');
  }
  const resourceUrl = target === 'sandbox'
    ? process.env.DYNAMICS_SANDBOX_URL
    : process.env.DYNAMICS_URL || process.env.DATAVERSE_URL;
  if (!resourceUrl) throw new Error(`Missing Dynamics URL for target=${target}`);
  const targetUrl = new URL(resourceUrl);
  const token = await getAccessToken(resourceUrl);
  const client = createClient({ resourceUrl, token });
  const rows = await queryAll(client);
  const artifact = {
    observedAt: new Date().toISOString(),
    target: target === 'prod' ? 'production' : 'sandbox',
    targetHostname: targetUrl.hostname.toLowerCase(),
    sourceEntitySet: ENTITY_SET,
    ...aggregateChannelBaseline(rows),
  };
  const json = `${JSON.stringify(artifact, null, 2)}\n`;
  if (outputPath) {
    const resolved = path.resolve(outputPath);
    fs.writeFileSync(resolved, json, 'utf8');
    console.error(`Wrote read-only channel baseline: ${resolved}`);
  } else {
    process.stdout.write(json);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Channel baseline probe failed: ${error?.stack || error?.message || error}`);
    process.exit(1);
  });
}

module.exports = { ENTITY_SET, SELECT, parseCli, queryAll };
