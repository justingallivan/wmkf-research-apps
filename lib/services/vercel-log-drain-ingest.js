/**
 * Vercel Log Drain ingestion — parsing, selection, and mapping.
 *
 * Consumed by pages/api/webhooks/vercel-log-drain.js. The route owns HTTP
 * concerns (method, raw body, HMAC verification, size caps); this module owns
 * WHICH delivered log entries become durable `operational_events` rows and
 * WHAT is stored for each — the metadata allowlist lives here.
 *
 * Selection policy (keep the signal, drop the noise):
 *   * level 'error' or 'fatal'                        → kept
 *   * statusCode >= 500, or -1 (function crashed)     → kept
 *   * proxy.statusCode >= 500                         → kept
 *   * structured JSON log lines (event-named, e.g. `workbench.dependency`)
 *     whose outcome is a failure (timeout / network_error / 5xx)  → kept
 *   * everything else                                 → skipped (counted)
 *
 * Storage allowlist per entry (nothing else is persisted): Vercel log id
 * (dedupe), timestamp, source, type, level, environment, branch, host, path,
 * entrypoint, statusCode, requestId, executionRegion, deploymentId, traceId,
 * proxy {method, path (query string stripped), statusCode, vercelCache,
 * pathType}, plus the redacted, capped message. Explicitly NEVER stored:
 * clientIp, userAgent, referer, JA3/JA4 fingerprints, headers, bodies.
 *
 * Delivery contract per Vercel docs (verified 2026-08-19):
 * https://vercel.com/docs/drains/reference/logs — batched deliveries in JSON
 * or NDJSON, each entry carrying a stable `id`; at-least-once delivery with
 * retries, hence the `vercel:<id>` dedupe key.
 */

const OperationalEventService = require('./operational-event-service');
const { redactLogText } = require('../utils/log-redactor');

const MAX_ENTRIES_CONSIDERED = 1000;
const MAX_ENTRIES_STORED = 200;
const MESSAGE_MAX_CHARS = 2000;

/**
 * Parse a drain delivery body into an array of entry objects.
 * Handles both delivery formats (JSON array and NDJSON) plus the single-object
 * test delivery Vercel sends when the drain is created. Malformed lines are
 * skipped and counted, never thrown.
 */
function parseDrainBody(rawText) {
  const malformed = { count: 0 };
  const text = (rawText || '').trim();
  if (!text) return { entries: [], malformed: 0 };
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return { entries: parsed, malformed: 0 };
    if (parsed && typeof parsed === 'object') return { entries: [parsed], malformed: 0 };
    return { entries: [], malformed: 1 };
  } catch {
    // NDJSON: one JSON object per line.
    const entries = [];
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed);
        if (obj && typeof obj === 'object') entries.push(obj);
        else malformed.count += 1;
      } catch {
        malformed.count += 1;
      }
    }
    return { entries, malformed: malformed.count };
  }
}

/**
 * If the message is a single structured JSON log line (the repo convention:
 * `{"event":"workbench.dependency","v":1,...}`), parse it. Returns null for
 * free-text messages.
 */
function parseStructuredMessage(message) {
  if (typeof message !== 'string') return null;
  const trimmed = message.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  try {
    const obj = JSON.parse(trimmed);
    if (obj && typeof obj === 'object' && typeof obj.event === 'string') return obj;
    return null;
  } catch {
    return null;
  }
}

function structuredEventIsFailure(structured) {
  if (!structured) return false;
  const outcome = structured.outcome;
  if (outcome === 'timeout' || outcome === 'network_error') return true;
  if (outcome === 'http_error' && structured.statusClass === '5xx') return true;
  return false;
}

/**
 * Decide whether one delivered entry is worth durable storage.
 * Returns { keep: boolean, severity, eventType, structured }.
 */
function classifyEntry(entry) {
  const structured = parseStructuredMessage(entry.message);
  const level = typeof entry.level === 'string' ? entry.level : null;
  const statusCode = Number.isFinite(entry.statusCode) ? entry.statusCode : null;
  const proxyStatus = Number.isFinite(entry?.proxy?.statusCode) ? entry.proxy.statusCode : null;

  const crashed = statusCode === -1;
  const server5xx = (statusCode != null && statusCode >= 500)
    || (proxyStatus != null && proxyStatus >= 500);
  const levelFailure = level === 'error' || level === 'fatal';
  const structuredFailure = structuredEventIsFailure(structured);

  if (!crashed && !server5xx && !levelFailure && !structuredFailure) {
    return { keep: false };
  }

  let severity;
  if (level === 'fatal' || crashed) severity = 'critical';
  else if (level === 'error' || server5xx) severity = 'error';
  else severity = 'warning';

  let eventType;
  if (structuredFailure) eventType = 'runtime_dependency_failure';
  else if (crashed) eventType = 'runtime_function_crash';
  else if (server5xx) eventType = 'runtime_5xx';
  else eventType = 'runtime_log_error';

  return { keep: true, severity, eventType, structured };
}

function stripQuery(path) {
  if (typeof path !== 'string') return null;
  const idx = path.indexOf('?');
  return idx === -1 ? path : path.slice(0, idx);
}

function shortString(value, max = 200) {
  if (typeof value !== 'string' || !value) return null;
  return value.length > max ? value.slice(0, max) : value;
}

/** Build the allowlisted metadata object for one kept entry. */
function buildMetadata(entry, structured) {
  const metadata = {
    vercelLogId: shortString(entry.id, 100),
    source: shortString(entry.source, 40),
    type: shortString(entry.type, 60),
    level: shortString(entry.level, 20),
    host: shortString(entry.host, 200),
    path: shortString(stripQuery(entry.path), 300),
    entrypoint: shortString(entry.entrypoint, 200),
    statusCode: Number.isFinite(entry.statusCode) ? entry.statusCode : null,
    vercelRequestId: shortString(entry.requestId, 100),
    executionRegion: shortString(entry.executionRegion, 40),
    deploymentId: shortString(entry.deploymentId, 100),
    branch: shortString(entry.branch, 100),
    traceId: shortString(entry.traceId, 100),
  };
  if (entry.proxy && typeof entry.proxy === 'object') {
    metadata.proxy = {
      method: shortString(entry.proxy.method, 10),
      path: shortString(stripQuery(entry.proxy.path), 300),
      statusCode: Number.isFinite(entry.proxy.statusCode) ? entry.proxy.statusCode : null,
      vercelCache: shortString(entry.proxy.vercelCache, 20),
      pathType: shortString(entry.proxy.pathType, 40),
    };
  }
  if (structured) {
    metadata.structuredEvent = {
      event: shortString(structured.event, 100),
      v: Number.isFinite(structured.v) ? structured.v : null,
      dependency: shortString(structured.dependency, 40),
      resourceClass: shortString(structured.resourceClass, 60),
      operation: shortString(structured.operation, 20),
      outcome: shortString(structured.outcome, 40),
      statusClass: shortString(structured.statusClass, 10),
      ms: Number.isFinite(structured.ms) ? structured.ms : null,
      routeName: shortString(structured.routeName, 200),
    };
  }
  for (const key of Object.keys(metadata)) {
    if (metadata[key] == null) delete metadata[key];
  }
  return metadata;
}

function buildSummary(entry, structured) {
  if (structured) {
    const parts = [
      structured.event,
      structured.dependency,
      structured.operation,
      structured.outcome,
      structured.statusClass,
    ].filter((p) => typeof p === 'string' && p);
    if (parts.length) return parts.join(' ');
  }
  if (typeof entry.message === 'string' && entry.message.trim()) {
    const redacted = redactLogText(entry.message.trim());
    return redacted.length > MESSAGE_MAX_CHARS
      ? `${redacted.slice(0, MESSAGE_MAX_CHARS)}…[truncated]`
      : redacted;
  }
  const path = stripQuery(entry.path) || stripQuery(entry?.proxy?.path) || 'unknown path';
  const status = Number.isFinite(entry.statusCode) ? entry.statusCode : entry?.proxy?.statusCode;
  return `${entry.source || 'runtime'} ${path} status ${status ?? 'unknown'}`;
}

// Concurrency width for the insert phase (bounds pool pressure while keeping
// round trips at ~stored/INSERT_CHUNK_SIZE, well inside the 60s route budget).
const INSERT_CHUNK_SIZE = 25;

/** Build the recordEvent input for one kept entry. */
function toRecordInput(entry, classified) {
  const structured = classified.structured;
  return {
    source: 'vercel-drain',
    eventType: classified.eventType,
    severity: classified.severity,
    summary: buildSummary(entry, structured),
    subsystem: shortString(stripQuery(entry.path), 200)
      || shortString(entry.entrypoint, 200)
      || shortString(entry.source, 40),
    requestNumber: null,
    correlationId: structured ? shortString(structured.correlationId, 100) : null,
    dedupeKey: `vercel:${entry.id}`,
    metadata: buildMetadata(entry, structured),
    // Everything the selection policy keeps IS a failure (error/fatal
    // levels, 5xx, crashes, failed dependency events), so every stored row
    // starts 'open' — deriving status from severity here hid warning-graded
    // dependency timeouts from the default open-events view (Codex
    // adversarial finding, cycle 1, 2026-08-19). 'info' is reserved for
    // genuine non-failures, which this ingester never stores.
    status: 'open',
    occurredAt: Number.isFinite(entry.timestamp) ? entry.timestamp : undefined,
    environment: shortString(entry.environment, 20),
  };
}

/**
 * Ingest one parsed drain delivery. Never throws.
 *
 * `storageFailures` counts kept entries whose insert FAILED (recordEvent
 * returned null) as opposed to true duplicates ({duplicate:true}); the route
 * refuses to acknowledge deliveries with storage failures so Vercel
 * redelivers — acking a lost write as success would silently destroy exactly
 * the failure evidence an outage produces (Codex adversarial finding,
 * cycle 3, 2026-08-19).
 *
 * @param {Array<Object>} entries - parsed delivery entries
 * @returns {Promise<{considered:number, stored:number, duplicates:number,
 *   skipped:number, invalid:number, droppedByCap:number, storageFailures:number}>}
 */
async function ingestDrainEntries(entries) {
  const counts = {
    considered: 0, stored: 0, duplicates: 0, skipped: 0, invalid: 0,
    droppedByCap: 0, storageFailures: 0,
  };
  if (!Array.isArray(entries)) return counts;

  const considered = entries.slice(0, MAX_ENTRIES_CONSIDERED);
  counts.droppedByCap += Math.max(0, entries.length - considered.length);

  // Phase 1: classify and collect kept entries up to the storage cap.
  const toStore = [];
  for (const entry of considered) {
    counts.considered += 1;
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || !entry.id) {
      counts.invalid += 1;
      continue;
    }
    const classified = classifyEntry(entry);
    if (!classified.keep) {
      counts.skipped += 1;
      continue;
    }
    if (toStore.length >= MAX_ENTRIES_STORED) {
      counts.droppedByCap += 1;
      continue;
    }
    toStore.push(toRecordInput(entry, classified));
  }

  // Phase 2: chunked parallel inserts — 200 serial awaited inserts could
  // exceed the route's 60s budget on a cold pool (Codex adversarial finding,
  // cycle 3, 2026-08-19). recordEvent never throws, so plain Promise.all is
  // safe: null = storage FAILURE, {duplicate:true} = redelivery of a stored row.
  for (let i = 0; i < toStore.length; i += INSERT_CHUNK_SIZE) {
    const chunk = toStore.slice(i, i + INSERT_CHUNK_SIZE);
    const results = await Promise.all(
      chunk.map((input) => OperationalEventService.recordEvent(input)),
    );
    for (const recorded of results) {
      if (recorded && recorded.duplicate === true) counts.duplicates += 1;
      else if (recorded) counts.stored += 1;
      else counts.storageFailures += 1;
    }
  }

  if (counts.droppedByCap > 0) {
    console.warn(`[vercel-log-drain] delivery exceeded storage caps: dropped ${counts.droppedByCap} entr(ies) (considered cap ${MAX_ENTRIES_CONSIDERED}, stored cap ${MAX_ENTRIES_STORED})`);
  }
  if (counts.storageFailures > 0) {
    console.error(`[vercel-log-drain] ${counts.storageFailures} entr(ies) failed to store; delivery will not be acknowledged so Vercel redelivers`);
  }
  return counts;
}

module.exports = {
  parseDrainBody,
  parseStructuredMessage,
  classifyEntry,
  buildMetadata,
  buildSummary,
  ingestDrainEntries,
  MAX_ENTRIES_CONSIDERED,
  MAX_ENTRIES_STORED,
};
