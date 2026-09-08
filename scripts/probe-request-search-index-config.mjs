#!/usr/bin/env node
/**
 * READ-ONLY probe for the akoya_request Quick Find view that drives the
 * Dataverse Search index. Reports whether akoya_programid is present as a
 * projected view column, a Quick Find search condition, or a rendered layout
 * column. It never publishes or modifies Dataverse configuration.
 *
 * Production reads require the normal target-interlock acknowledgement:
 *   DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-request-search-index-config.mjs
 */

import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { loadEnvLocal } = require('../lib/dataverse/client');

loadEnvLocal();

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { bypassDynamicsRestrictions } = await import('../lib/services/dynamics-context.js');

const FIELD = 'akoya_programid';
const INCLUDE_XML = process.argv.includes('--xml');

function uniqueMatches(xml, pattern) {
  return [...new Set([...String(xml || '').matchAll(pattern)].map((match) => match[1]))];
}

function describeView(row) {
  const fetchAttributes = uniqueMatches(row.fetchxml, /<attribute\b[^>]*\bname=["']([^"']+)["']/gi);
  const quickFindConditions = uniqueMatches(
    row.fetchxml,
    /<condition\b[^>]*\battribute=["']([^"']+)["'][^>]*\boperator=["']like["'][^>]*\/?\s*>/gi,
  );
  const layoutColumns = uniqueMatches(row.layoutxml, /<cell\b[^>]*\bname=["']([^"']+)["']/gi);

  const description = {
    name: row.name,
    id: row.savedqueryid,
    managed: row.ismanaged === true,
    customizable: row.iscustomizable?.Value ?? row.iscustomizable ?? null,
    field: FIELD,
    projectedInFetch: fetchAttributes.includes(FIELD),
    quickFindSearchCondition: quickFindConditions.includes(FIELD),
    presentInLayout: layoutColumns.includes(FIELD),
    fetchAttributes,
    quickFindConditions,
    layoutColumns,
  };
  if (INCLUDE_XML) {
    description.fetchxml = row.fetchxml;
    description.layoutxml = row.layoutxml;
  }
  return description;
}

async function main() {
  const { records, hasMore } = await bypassDynamicsRestrictions(
    { reason: 'read-only request Search index configuration probe' },
    () => DynamicsService.queryRecords('savedqueries', {
      select: 'savedqueryid,name,fetchxml,layoutxml,isquickfindquery,ismanaged,iscustomizable',
      filter: "returnedtypecode eq 'akoya_request' and isquickfindquery eq true",
      top: 10,
    }),
  );

  if (hasMore || records.length !== 1) {
    throw new Error(`Expected exactly one akoya_request Quick Find view; received ${records.length}${hasMore ? '+' : ''}`);
  }

  console.log(JSON.stringify(describeView(records[0]), null, 2));
}

main().catch((error) => {
  console.error(`probe failed: ${error.message}`);
  process.exit(1);
});
