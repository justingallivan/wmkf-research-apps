#!/usr/bin/env node

/**
 * Backfill `wmkf_requestdocument.wmkf_sharepointversionid` rows that hold a
 * Graph content tag (`"c:{GUID},N"`) instead of a SharePoint publication
 * version (`1.0`). Cause: GraphService.uploadFile fell back to `cTag` when the
 * upload response lacked a `publication` facet (fixed 2026-09-09 by reading
 * the item back by stable id). Producers that ran before the fix wrote the
 * tag; the distribution flow later self-heals a row it touches, but untouched
 * drafts keep the tag.
 *
 * Rule: a row is repaired only when the item's CURRENT eTag equals the eTag
 * the row recorded at creation — proof the file has not changed since, so
 * the current publication version IS the version at creation. A row whose
 * file has changed since is reported, never guessed.
 *
 * Read-only by default. --execute PATCHes only wmkf_sharepointversionid.
 *
 * Usage:
 *   DATAVERSE_ALLOW_PROD_READS=yes node scripts/backfill-request-document-versions.mjs
 *   DATAVERSE_ALLOW_PROD_READS=yes DATAVERSE_PROD_WRITE_ACK="registry version backfill YYYY-MM-DD" \
 *     node scripts/backfill-request-document-versions.mjs --execute
 */

import fs from 'fs';
import './lib/use-extensionless.mjs';

for (const file of ['.env', '.env.local']) {
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m && !(m[1] in process.env)) {
        process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
      }
    }
  } catch {}
}

const EXECUTE = process.argv.includes('--execute');
if (process.env.DATAVERSE_ALLOW_PROD_READS !== 'yes') throw new Error('Requires DATAVERSE_ALLOW_PROD_READS=yes (owner-run).');
if (EXECUTE && !process.env.DATAVERSE_PROD_WRITE_ACK) throw new Error('--execute requires DATAVERSE_PROD_WRITE_ACK="<purpose> <YYYY-MM-DD>".');

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
const { withDalContext } = await import('../lib/dataverse/core/context.js');
const { GraphService } = await import('../lib/services/graph-service.js');
const requestDocumentAdapter = await import('../lib/dataverse/adapters/request-document.js');
const { REQUEST_DOCUMENT_ARTIFACT_LABEL } = await import('../shared/config/requestDocument.js');

enterDynamicsBypassForScript('backfill-request-document-versions');

const CTAG_RE = /^"?c:\{/i;

async function main() {
  const { records } = await DynamicsService.queryAllRecords(requestDocumentAdapter.ENTITY_SET_NAME, {
    select: 'wmkf_requestdocumentid,wmkf_artifacttype,wmkf_cyclecode,wmkf_sharepointsiteid,wmkf_sharepointdriveid,wmkf_sharepointitemid,wmkf_sharepointversionid,wmkf_sharepointetag,wmkf_sharepointlastmodified,createdon',
    filter: 'wmkf_sharepointitemid ne null',
    orderby: 'createdon asc',
  });
  const candidates = records.filter((r) => !r.wmkf_sharepointversionid || CTAG_RE.test(String(r.wmkf_sharepointversionid)));
  const ledger = [];
  for (const row of candidates) {
    const entry = {
      documentId: row.wmkf_requestdocumentid,
      artifact: REQUEST_DOCUMENT_ARTIFACT_LABEL[row.wmkf_artifacttype] || row.wmkf_artifacttype,
      cycle: row.wmkf_cyclecode || null,
      created: String(row.createdon || '').slice(0, 10),
      storedVersion: row.wmkf_sharepointversionid || null,
    };
    try {
      const current = await GraphService.getFileMetadataById(row.wmkf_sharepointdriveid, row.wmkf_sharepointitemid, { siteId: row.wmkf_sharepointsiteid || null });
      if (!current) { entry.outcome = 'item-missing'; ledger.push(entry); continue; }
      entry.currentVersion = current.versionId || null;
      entry.eTagMatches = Boolean(row.wmkf_sharepointetag) && current.eTag === row.wmkf_sharepointetag;
      if (!current.versionId) entry.outcome = 'no-publication-version';
      else if (!entry.eTagMatches) entry.outcome = 'changed-since-creation (report only)';
      else if (!EXECUTE) entry.outcome = `would-set ${current.versionId}`;
      else {
        await requestDocumentAdapter.update(row.wmkf_requestdocumentid, { wmkf_sharepointversionid: current.versionId });
        entry.outcome = `set ${current.versionId}`;
      }
    } catch (error) {
      entry.outcome = `error: ${String(error.message || error).slice(0, 200)}`;
    }
    ledger.push(entry);
  }
  const tally = {};
  for (const e of ledger) { const k = e.outcome.split(' ')[0]; tally[k] = (tally[k] || 0) + 1; }
  console.log(JSON.stringify({ mode: EXECUTE ? 'execute' : 'dry-run', rowsWithItem: records.length, candidates: candidates.length, tally, ledger }, null, 2));
}

await withDalContext('backfill-request-document-versions', main).catch((error) => { console.error(error.message); process.exit(1); });
