#!/usr/bin/env node
/**
 * Owner-run, READ-ONLY diagnostic for Staff Deliberations handoff blocks
 * (site_visit_sharepoint_version_changed, site_visit_automation_word_invalid).
 * For each request number it repeats the transition's SharePoint reads —
 * metadata, download, metadata, then metadata again after a pause — and the
 * governed DOCX hash, printing which metadata fields moved and the hash
 * error's underlying cause. No Dataverse, Postgres, or SharePoint writes.
 *
 *   DATAVERSE_ALLOW_PROD_READS=yes node --import ./scripts/lib/use-extensionless.mjs \
 *     scripts/probe-staff-deliberations-handoff-file.mjs 1002916 1002860
 */
import './lib/use-extensionless.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { loadEnvLocal } = require('../lib/dataverse/client.js');

const FIELDS = ['versionId', 'eTag', 'lastModified', 'size'];
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// Lists internal relationships under word/ that resolve outside word/ or to a
// missing part — the shapes the governed hash's reachability walk rejects.
async function printOffendingRelationships(buffer) {
  const { default: JSZip } = await import('jszip');
  const archive = await JSZip.loadAsync(buffer);
  const names = new Map(Object.keys(archive.files).map((name) => [name.toLowerCase(), name]));
  for (const relsName of [...names.values()].filter((name) => /^word\/(.*\/)?_rels\/[^/]+\.rels$/i.test(name))) {
    const sourceDir = relsName.replace(/_rels\/[^/]+\.rels$/i, '');
    const xml = await archive.file(relsName).async('string');
    for (const match of xml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
      const attr = (key) => (match[1].match(new RegExp(`\\b${key}="([^"]*)"`)) || [])[1] || '';
      const type = attr('Type').split('/').pop();
      if (/^customXml$/i.test(type) || attr('TargetMode').toLowerCase() === 'external') continue;
      const target = attr('Target');
      const resolved = target.startsWith('/') ? target.slice(1)
        : new URL(target, `http://x/${sourceDir}`).pathname.slice(1);
      const inside = resolved.toLowerCase().startsWith('word/');
      const exists = names.has(decodeURIComponent(resolved).toLowerCase());
      if (!inside || !exists) {
        console.log(`  offending: ${relsName} type=${type} target=${JSON.stringify(target)} -> ${resolved} (${inside ? '' : 'outside word/ '}${exists ? '' : 'missing'})`);
      }
    }
  }
}

async function main() {
  const numbers = process.argv.slice(2).filter((value) => /^\d{1,12}$/.test(value));
  if (!numbers.length) throw new Error('Usage: <request number> [...]');
  loadEnvLocal();
  const grantRequestAdapter = await import('../lib/dataverse/adapters/grant-request.js');
  const odata = await import('../lib/dataverse/core/odata.js');
  const { withDalContext } = await import('../lib/dataverse/core/context.js');
  const { getPreSiteVisitArtifactStatus } = await import('../lib/services/pre-site-visit/artifact-reader.js');
  const { GraphService } = await import('../lib/services/graph-service.js');
  const { hashGovernedDocxContent } = await import('../lib/services/documents/governed-docx-hash.js');

  await withDalContext('local-staff-deliberations-handoff-probe', async () => {
    for (const number of numbers) {
      console.log(`\n=== ${number}`);
      const result = await grantRequestAdapter.queryAllRequests({
        select: ['akoya_requestid', 'akoya_requestnum'],
        filter: odata.eq('akoya_requestnum', number),
      });
      const request = result?.records?.[0];
      if (!request) { console.log('request not found'); continue; }
      const status = await getPreSiteVisitArtifactStatus({ requestId: request.akoya_requestid });
      const current = status.currentArtifact;
      const file = current?.file;
      console.log(`lifecycle=${current?.lifecycleState ?? 'none'} recordedVersion=${file?.versionId ?? '?'} name=${file?.name ?? '?'}`);
      if (!file?.driveId || !file?.itemId) { console.log('no SharePoint identity'); continue; }
      const read = () => GraphService.getFileMetadataById(file.driveId, file.itemId, { siteId: file.siteId || null });
      const before = await read();
      const downloaded = await GraphService.downloadFile(file.driveId, file.itemId);
      const after = await read();
      await sleep(5000);
      const later = await read();
      for (const field of FIELDS) {
        const values = [before?.[field], after?.[field], later?.[field]];
        const moved = new Set(values.map(String)).size > 1;
        console.log(`${moved ? 'MOVED' : 'same '} ${field}: ${values.map((value) => JSON.stringify(value)).join(' -> ')}`);
      }
      const buffer = downloaded?.buffer;
      console.log(`download: ${Buffer.isBuffer(buffer) ? `${buffer.length} bytes, starts ${JSON.stringify(buffer.subarray(0, 4).toString('latin1'))}` : typeof buffer}`);
      try {
        await hashGovernedDocxContent(buffer);
        console.log('hash: ok');
      } catch (error) {
        console.log(`hash: FAILED — ${error.message}${error.cause ? ` (cause: ${error.cause.message})` : ''}`);
        await printOffendingRelationships(buffer);
      }
    }
  });
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
