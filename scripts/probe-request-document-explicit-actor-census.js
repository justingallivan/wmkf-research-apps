#!/usr/bin/env node
/**
 * READ-ONLY Wave 24 promotion census.
 *
 * For Request Document business actions at or after an explicit promotion
 * boundary, require either durable explicit attribution or the bounded
 * missing-attribution event authorized for availability-first flows.
 *
 * Usage:
 *   DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-request-document-explicit-actor-census.js \
 *     --since=2026-09-01T12:00:00.000Z
 *   node scripts/probe-request-document-explicit-actor-census.js --self-test
 *
 * This script performs only Dataverse and Postgres reads. It refuses an
 * incomplete Dataverse export and exits non-zero on any unattributed gap.
 */

const ALLOWED_UNATTRIBUTED_ORIGIN_STAGES = new Set([
  'initial-assessment-generation',
  'pre-site-generation',
]);

function normalizedId(value) {
  return String(value || '').trim().toLowerCase();
}

function isAtOrAfter(value, since) {
  if (!value) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && time >= since.getTime();
}

function eventsForDocument(events, documentId) {
  const target = normalizedId(documentId);
  return events.filter((event) => normalizedId(event?.entity_refs?.requestDocumentId) === target);
}

function classifyRows(rows, events, since) {
  const results = [];
  for (const row of rows) {
    const documentId = normalizedId(row.wmkf_requestdocumentid);
    const matchingEvents = eventsForDocument(events, documentId);

    if (isAtOrAfter(row.createdon, since)) {
      const actor = normalizedId(row._wmkf_initiatedby_value);
      const at = row.wmkf_initiatedat || null;
      const allowedEvent = matchingEvents.find((event) => (
        ALLOWED_UNATTRIBUTED_ORIGIN_STAGES.has(event.stage)
        && event?.metadata?.operation === event.stage
      ));
      let status = 'attributed';
      let reason = null;
      if (Boolean(actor) !== Boolean(at)) {
        status = 'violation';
        reason = 'origin actor/time is a partial pair';
      } else if (!actor && !at && allowedEvent) {
        status = 'event-backed-unattributed';
      } else if (!actor && !at) {
        status = 'violation';
        reason = 'origin actor/time is absent without an allowed matching event';
      }
      results.push({ documentId, kind: 'origin', status, reason });
    }

    if (isAtOrAfter(row.wmkf_milestonecreatedat, since)) {
      const actor = normalizedId(row._wmkf_milestonecreatedby_value);
      const allowedEvent = matchingEvents.find((event) => (
        event.stage === 'site-visit-handoff'
        && event?.metadata?.operation === 'site-visit-handoff'
      ));
      let status = 'attributed';
      let reason = null;
      if (!actor && allowedEvent) {
        status = 'event-backed-unattributed';
      } else if (!actor) {
        status = 'violation';
        reason = 'milestone actor is absent without a matching handoff event';
      }
      results.push({ documentId, kind: 'site-visit-milestone', status, reason });
    }
  }
  return results;
}

function runSelfTest() {
  const since = new Date('2026-09-01T00:00:00.000Z');
  const base = {
    createdon: '2026-09-01T00:00:01.000Z',
    wmkf_initiatedat: '2026-09-01T00:00:01.000Z',
    _wmkf_initiatedby_value: '11111111-1111-4111-8111-111111111111',
  };
  const rows = [
    { ...base, wmkf_requestdocumentid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    {
      ...base,
      wmkf_requestdocumentid: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      wmkf_initiatedat: null,
      _wmkf_initiatedby_value: null,
    },
    {
      ...base,
      wmkf_requestdocumentid: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      wmkf_initiatedat: null,
      _wmkf_initiatedby_value: null,
    },
    {
      ...base,
      wmkf_requestdocumentid: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      wmkf_milestonecreatedat: '2026-09-01T00:01:00.000Z',
      _wmkf_milestonecreatedby_value: null,
    },
  ];
  const events = [
    {
      stage: 'pre-site-generation',
      entity_refs: { requestDocumentId: rows[1].wmkf_requestdocumentid },
      metadata: { operation: 'pre-site-generation' },
    },
    {
      stage: 'site-visit-handoff',
      entity_refs: { requestDocumentId: rows[3].wmkf_requestdocumentid },
      metadata: { operation: 'site-visit-handoff' },
    },
  ];
  const results = classifyRows(rows, events, since);
  const counts = results.reduce((out, result) => {
    out[result.status] = (out[result.status] || 0) + 1;
    return out;
  }, {});
  if (counts.attributed !== 2 || counts['event-backed-unattributed'] !== 2 || counts.violation !== 1) {
    throw new Error(`Unexpected self-test classification: ${JSON.stringify(counts)}`);
  }
  console.log('PASS: Wave 24 attribution census classifier distinguishes attributed, event-backed, and missing evidence.');
}

function parseSince(argv) {
  const arg = argv.find((value) => value.startsWith('--since='));
  if (!arg) throw new Error('--since=<ISO timestamp> is required and must be the exact Wave 24 promotion boundary.');
  const raw = arg.slice('--since='.length);
  const date = new Date(raw);
  if (!raw || Number.isNaN(date.getTime()) || date.toISOString() !== raw) {
    throw new Error('--since must be a canonical UTC ISO timestamp such as 2026-09-01T12:00:00.000Z.');
  }
  if (date.getTime() > Date.now()) throw new Error('--since cannot be in the future.');
  return date;
}

async function main() {
  if (process.argv.includes('--self-test')) {
    runSelfTest();
    return;
  }
  const since = parseSince(process.argv.slice(2));
  require('../lib/dataverse/client').loadEnvLocal();
  const { sql } = require('@vercel/postgres');
  const { DynamicsService } = await import('../lib/services/dynamics-service.js');
  const { bypassDynamicsRestrictions } = await import('../lib/services/dynamics-context.js');

  const dataverse = await bypassDynamicsRestrictions(
    'probe-request-document-explicit-actor-census',
    () => DynamicsService.queryAllRecords('wmkf_requestdocuments', {
      select: [
        'wmkf_requestdocumentid',
        'createdon',
        'wmkf_initiatedat',
        '_wmkf_initiatedby_value',
        'wmkf_milestonecreatedat',
        '_wmkf_milestonecreatedby_value',
      ].join(','),
      filter: `(createdon ge ${since.toISOString()} or wmkf_milestonecreatedat ge ${since.toISOString()})`,
    }),
  );
  if (dataverse.capped || (dataverse.totalCount && dataverse.records.length < dataverse.totalCount)) {
    throw new Error('Request Document export is incomplete; refusing to report a partial census.');
  }

  const eventResult = await sql`
    SELECT stage, entity_refs, metadata
    FROM operational_events
    WHERE event_type = 'request_document_actor_not_captured'
      AND last_occurred_at >= ${since.toISOString()}
    ORDER BY last_occurred_at ASC
  `;
  const results = classifyRows(dataverse.records, eventResult.rows, since);
  const counts = results.reduce((out, result) => {
    out[result.status] = (out[result.status] || 0) + 1;
    return out;
  }, {});

  console.log(`Wave 24 Request Document attribution census since ${since.toISOString()}`);
  console.log(`  attributed: ${counts.attributed || 0}`);
  console.log(`  event-backed unattributed: ${counts['event-backed-unattributed'] || 0}`);
  console.log(`  violations: ${counts.violation || 0}`);
  for (const result of results.filter((entry) => entry.status === 'violation')) {
    console.log(`  VIOLATION ${result.documentId} ${result.kind}: ${result.reason}`);
  }
  if (counts.violation) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`Census failed: ${error.message}`);
  process.exitCode = 1;
});

module.exports = { classifyRows, parseSince };
