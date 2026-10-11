#!/usr/bin/env node
/**
 * Owner-run, READ-ONLY census for Zoom video copy ruling 7 (unversioned winner).
 * Reads every Request Document of artifact type Recording and reports how many
 * lack a positive wmkf_slotversion, and — the case ruling 7 refuses — how many
 * requests' current Recording winner is a SharePoint file with no slot version.
 * Winners use the production projection (projectPostPresentationMaterials), so
 * only Ready, non-superseded rows count. No Dataverse, Postgres, or SharePoint writes.
 *
 *   DATAVERSE_ALLOW_PROD_READS=yes node --import ./scripts/lib/use-extensionless.mjs \
 *     scripts/probe-recording-slot-versions.mjs
 */
import './lib/use-extensionless.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { loadEnvLocal } = require('../lib/dataverse/client.js');

const versioned = (row) => {
  const value = Number(row?.wmkf_slotversion);
  return Number.isInteger(value) && value > 0;
};

async function main() {
  loadEnvLocal();
  const { DynamicsService } = await import('../lib/services/dynamics-service.js');
  const odata = await import('../lib/dataverse/core/odata.js');
  const { withDalContext } = await import('../lib/dataverse/core/context.js');
  const { REQUEST_DOCUMENT_ARTIFACT_TYPE } = await import('../shared/config/requestDocument.js');
  const { projectPostPresentationMaterials, materialBacking, _internal } =
    await import('../lib/services/post-presentation-materials/material-model.js');

  const select = [...new Set([
    'wmkf_requestdocumentid', 'wmkf_artifacttype', 'wmkf_operationstatus', 'wmkf_lifecyclestate',
    '_wmkf_request_value', 'createdon', 'wmkf_filesize', 'wmkf_slotversion', 'wmkf_externalurl',
    ..._internal.SHAREPOINT_BACKING_FIELDS,
  ])].join(',');

  await withDalContext('local-recording-slot-version-probe', async () => {
    console.log(`Dataverse host: ${new URL(process.env.DYNAMICS_URL || 'http://unset').hostname}`);
    const result = await DynamicsService.queryAllRecords('wmkf_requestdocuments', {
      select,
      filter: odata.eqRaw('wmkf_artifacttype', REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING),
      orderby: 'createdon desc',
    });
    const rows = result?.records || [];
    if (result?.capped) console.log('WARNING: result was capped; counts below are incomplete.');

    const byKind = {};
    for (const row of rows) {
      const key = `${materialBacking(row).kind}/${versioned(row) ? 'versioned' : 'unversioned'}`;
      byKind[key] = (byKind[key] || 0) + 1;
    }
    console.log(`\nRecording rows (all states): ${rows.length}`);
    for (const [key, count] of Object.entries(byKind).sort()) console.log(`  ${key}: ${count}`);

    const byRequest = new Map();
    for (const row of rows) {
      const id = String(row._wmkf_request_value || '').toLowerCase();
      if (!byRequest.has(id)) byRequest.set(id, []);
      byRequest.get(id).push(row);
    }
    const affected = [];
    let fileWinners = 0;
    for (const [requestId, requestRows] of byRequest) {
      const winner = projectPostPresentationMaterials(requestRows, requestId).winners
        .find((row) => Number(row.wmkf_artifacttype) === REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING);
      if (!winner || materialBacking(winner).kind !== 'file') continue;
      fileWinners += 1;
      if (!versioned(winner)) affected.push(winner);
    }
    console.log(`\nRequests with any Recording row: ${byRequest.size}`);
    console.log(`Requests whose current Recording is a SharePoint file: ${fileWinners}`);
    console.log(`  ...of which have no slot version (ruling 7 refuses Copy video): ${affected.length}`);
    for (const row of affected) {
      console.log(`  request=${row._wmkf_request_value} document=${row.wmkf_requestdocumentid} created=${row.createdon} slotversion=${JSON.stringify(row.wmkf_slotversion ?? null)}`);
    }
  });
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
