'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCHEMA_VERSION = 1;
const MAX_EVENTS = 500;
const MAX_SESSIONS = 100;
const MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;
const PENDING_STALE_MS = 10 * 60 * 1000;
const SHAPES = Object.freeze(['call-path', 'universal', 'count']);
const EVENT_KEYS = Object.freeze([
  'claimCount',
  'documentPath',
  'eventId',
  'occurredAt',
  'schemaVersion',
  'sessionKey',
  'shapeCounts',
  'toolName',
]);
const SESSION_KEYS = Object.freeze([
  'lastEligibleAt',
  'schemaVersion',
  'sessionKey',
]);

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function defaultStateRoot() {
  return process.env.WMKF_CLAIM_EVIDENCE_STATE_ROOT ||
    path.join(os.tmpdir(), 'wmkf-claude-hook-state');
}

function observationDirectory(root, { stateRoot = defaultStateRoot() } = {}) {
  const repoKey = hash(path.resolve(root)).slice(0, 16);
  return path.join(path.resolve(stateRoot), repoKey, 'claim-evidence-observations');
}

function sessionKey(input) {
  const session = input?.session_id || input?.sessionId || 'unknown-session';
  return hash(session).slice(0, 16);
}

function normalizedDocumentPath(relativePath) {
  return String(relativePath || '').replace(/\\/g, '/').replace(/^\.\//, '').slice(0, 512);
}

function buildObservationEvent({
  input,
  relativePath,
  missingClaims,
  now = new Date(),
  eventId = crypto.randomUUID(),
}) {
  const shapeCounts = Object.fromEntries(SHAPES.map((shape) => [shape, 0]));
  const claims = Array.isArray(missingClaims) ? missingClaims : [];
  for (const claim of claims) {
    const claimShapes = new Set(Array.isArray(claim?.shapes) ? claim.shapes : []);
    for (const shape of SHAPES) {
      if (claimShapes.has(shape)) shapeCounts[shape] += 1;
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    eventId: String(eventId),
    occurredAt: now.toISOString(),
    sessionKey: sessionKey(input),
    documentPath: normalizedDocumentPath(relativePath),
    toolName: input?.tool_name === 'Edit' ? 'Edit' : 'Write',
    claimCount: claims.length,
    shapeCounts,
  };
}

function buildObservationSession({ input, now = new Date() }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    sessionKey: sessionKey(input),
    lastEligibleAt: now.toISOString(),
  };
}

function hasExactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function isObservationEvent(value) {
  if (!hasExactKeys(value, EVENT_KEYS)) return false;
  if (value.schemaVersion !== SCHEMA_VERSION) return false;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.eventId)) return false;
  if (
    !Number.isFinite(Date.parse(value.occurredAt)) ||
    new Date(value.occurredAt).toISOString() !== value.occurredAt
  ) return false;
  if (!/^[0-9a-f]{16}$/.test(value.sessionKey)) return false;
  if (
    !/^docs\/.+\.md$/i.test(value.documentPath) ||
    value.documentPath.length > 512 ||
    value.documentPath !== normalizedDocumentPath(value.documentPath) ||
    value.documentPath.split('/').includes('..') ||
    /[\u0000-\u001f\u007f]/.test(value.documentPath)
  ) return false;
  if (!['Write', 'Edit'].includes(value.toolName)) return false;
  if (!Number.isInteger(value.claimCount) || value.claimCount < 1) return false;
  if (!hasExactKeys(value.shapeCounts, SHAPES)) return false;
  return SHAPES.every((shape) =>
    Number.isInteger(value.shapeCounts[shape]) &&
    value.shapeCounts[shape] >= 0 &&
    value.shapeCounts[shape] <= value.claimCount
  );
}

function isObservationSession(value) {
  if (!hasExactKeys(value, SESSION_KEYS)) return false;
  if (value.schemaVersion !== SCHEMA_VERSION) return false;
  if (!/^[0-9a-f]{16}$/.test(value.sessionKey)) return false;
  return Number.isFinite(Date.parse(value.lastEligibleAt)) &&
    new Date(value.lastEligibleAt).toISOString() === value.lastEligibleAt;
}

function eventFileName(event) {
  const epoch = String(Date.parse(event.occurredAt)).padStart(13, '0');
  return `event-${epoch}-${event.eventId}.json`;
}

function sessionFileName(session) {
  return `session-${session.sessionKey}.json`;
}

function matchingFiles(directory, pattern) {
  try {
    return fs.readdirSync(directory)
      .filter((name) => pattern.test(name))
      .sort();
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

function eventFiles(directory) {
  return matchingFiles(
    directory,
    /^event-\d{13}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/i,
  );
}

function sessionFiles(directory) {
  return matchingFiles(directory, /^session-[0-9a-f]{16}\.json$/);
}

function pendingFiles(directory) {
  return matchingFiles(
    directory,
    /^\.pending-\d+-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/i,
  );
}

function ensureObservationDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
}

function writeAll(fd, body, offset, length, writeSync) {
  let written = 0;
  while (written < length) {
    const count = writeSync(fd, body, offset + written, length - written, null);
    if (!Number.isInteger(count) || count <= 0 || count > length - written) {
      throw new Error('claim-evidence observation short write');
    }
    written += count;
  }
}

function publishJsonAtomically(directory, finalName, value, {
  onPartialWrite,
  writeSync = fs.writeSync,
} = {}) {
  ensureObservationDirectory(directory);
  const finalFile = path.join(directory, finalName);
  const temporaryFile = path.join(
    directory,
    `.pending-${process.pid}-${crypto.randomUUID()}.tmp`,
  );
  const body = Buffer.from(`${JSON.stringify(value)}\n`);
  let fd = null;
  try {
    fd = fs.openSync(temporaryFile, 'wx', 0o600);
    const midpoint = Math.max(1, Math.floor(body.length / 2));
    writeAll(fd, body, 0, midpoint, writeSync);
    if (typeof onPartialWrite === 'function') {
      onPartialWrite({ directory, temporaryFile, finalFile });
    }
    writeAll(fd, body, midpoint, body.length - midpoint, writeSync);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(temporaryFile, finalFile);
    fs.chmodSync(finalFile, 0o600);
    return finalFile;
  } catch (error) {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* best effort */ }
    }
    try { fs.unlinkSync(temporaryFile); } catch { /* best effort */ }
    throw error;
  }
}

function readEventRecords(directory) {
  const records = [];
  let invalidFiles = 0;
  for (const name of eventFiles(directory)) {
    try {
      const value = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
      if (!isObservationEvent(value) || name !== eventFileName(value)) {
        invalidFiles += 1;
        continue;
      }
      records.push({ name, value });
    } catch {
      invalidFiles += 1;
    }
  }
  records.sort((a, b) =>
    a.value.occurredAt.localeCompare(b.value.occurredAt) || a.name.localeCompare(b.name)
  );
  return { records, invalidFiles };
}

function retainedEventRecords(records, {
  nowMs = Date.now(),
  maxEvents = MAX_EVENTS,
  maxAgeMs = MAX_AGE_MS,
} = {}) {
  const cutoff = nowMs - maxAgeMs;
  return records
    .filter((record) => Date.parse(record.value.occurredAt) >= cutoff)
    .slice(-maxEvents);
}

function cleanupFile(fullPath) {
  try {
    fs.unlinkSync(fullPath);
    return 0;
  } catch (error) {
    return error?.code === 'ENOENT' ? 0 : 1;
  }
}

function pruneObservationEvents(directory, options = {}) {
  const { records } = readEventRecords(directory);
  const keep = new Set(retainedEventRecords(records, options).map((record) => record.name));
  let cleanupErrors = 0;
  for (const record of records) {
    if (!keep.has(record.name)) {
      cleanupErrors += cleanupFile(path.join(directory, record.name));
    }
  }
  return { cleanupErrors };
}

function prunePendingFiles(directory, {
  nowMs = Date.now(),
  staleMs = PENDING_STALE_MS,
} = {}) {
  let cleanupErrors = 0;
  let stalePendingFiles = 0;
  for (const name of pendingFiles(directory)) {
    try {
      const full = path.join(directory, name);
      if (fs.statSync(full).mtimeMs > nowMs - staleMs) continue;
      stalePendingFiles += 1;
      cleanupErrors += cleanupFile(full);
    } catch (error) {
      if (error?.code !== 'ENOENT') cleanupErrors += 1;
    }
  }
  return { cleanupErrors, stalePendingFiles };
}

function readSessionRecords(directory) {
  const sessions = [];
  let invalidFiles = 0;
  for (const name of sessionFiles(directory)) {
    try {
      const value = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
      if (!isObservationSession(value) || name !== sessionFileName(value)) {
        invalidFiles += 1;
        continue;
      }
      sessions.push(value);
    } catch {
      invalidFiles += 1;
    }
  }
  sessions.sort((a, b) =>
    a.lastEligibleAt.localeCompare(b.lastEligibleAt) || a.sessionKey.localeCompare(b.sessionKey)
  );
  return { sessions, invalidFiles };
}

function pruneObservationSessions(directory, {
  nowMs = Date.now(),
  maxSessions = MAX_SESSIONS,
  maxAgeMs = MAX_AGE_MS,
} = {}) {
  const { sessions } = readSessionRecords(directory);
  const cutoff = nowMs - maxAgeMs;
  const keep = new Set(sessions
    .filter((session) => Date.parse(session.lastEligibleAt) >= cutoff)
    .slice(-maxSessions)
    .map((session) => session.sessionKey));
  let cleanupErrors = 0;
  for (const session of sessions) {
    if (!keep.has(session.sessionKey)) {
      cleanupErrors += cleanupFile(path.join(directory, sessionFileName(session)));
    }
  }
  return { cleanupErrors };
}

function recordObservationSession({
  root,
  input,
  stateRoot,
  now = new Date(),
  maxSessions = MAX_SESSIONS,
  maxAgeMs = MAX_AGE_MS,
}) {
  const session = buildObservationSession({ input, now });
  if (!isObservationSession(session)) throw new Error('invalid claim-evidence observation session');
  const directory = observationDirectory(root, { stateRoot });
  const file = publishJsonAtomically(directory, sessionFileName(session), session);
  const cleanup = pruneObservationSessions(directory, {
    nowMs: now.getTime(),
    maxSessions,
    maxAgeMs,
  });
  cleanup.cleanupErrors += prunePendingFiles(directory, { nowMs: now.getTime() }).cleanupErrors;
  if (cleanup.cleanupErrors) throw new Error('claim-evidence session retention cleanup failed');
  return { session, file };
}

function recordAdvisoryObservation({
  root,
  input,
  relativePath,
  missingClaims,
  stateRoot,
  now = new Date(),
  eventId,
  maxEvents = MAX_EVENTS,
  maxAgeMs = MAX_AGE_MS,
  onPartialWrite,
  writeSync,
}) {
  const event = buildObservationEvent({ input, relativePath, missingClaims, now, eventId });
  if (!isObservationEvent(event)) throw new Error('invalid claim-evidence observation event');

  const directory = observationDirectory(root, { stateRoot });
  const file = publishJsonAtomically(directory, eventFileName(event), event, {
    onPartialWrite,
    writeSync,
  });
  const cleanup = pruneObservationEvents(directory, {
    nowMs: now.getTime(),
    maxEvents,
    maxAgeMs,
  });
  cleanup.cleanupErrors += prunePendingFiles(directory, { nowMs: now.getTime() }).cleanupErrors;
  if (cleanup.cleanupErrors) throw new Error('claim-evidence event retention cleanup failed');
  return { event, file };
}

function readObservationEvents(root, {
  stateRoot,
  enforceRetention = false,
  nowMs = Date.now(),
  maxEvents = MAX_EVENTS,
  maxSessions = MAX_SESSIONS,
  maxAgeMs = MAX_AGE_MS,
} = {}) {
  const directory = observationDirectory(root, { stateRoot });
  let cleanupErrors = 0;
  let stalePendingFiles = 0;
  if (enforceRetention) {
    cleanupErrors += pruneObservationEvents(directory, {
      nowMs,
      maxEvents,
      maxAgeMs,
    }).cleanupErrors;
    cleanupErrors += pruneObservationSessions(directory, {
      nowMs,
      maxSessions,
      maxAgeMs,
    }).cleanupErrors;
    const pendingCleanup = prunePendingFiles(directory, { nowMs });
    cleanupErrors += pendingCleanup.cleanupErrors;
    stalePendingFiles = pendingCleanup.stalePendingFiles;
  }
  const eventResult = readEventRecords(directory);
  const selectedRecords = enforceRetention
    ? retainedEventRecords(eventResult.records, { nowMs, maxEvents, maxAgeMs })
    : eventResult.records;
  const events = selectedRecords.map((record) => record.value);
  const sessionResult = readSessionRecords(directory);
  const cutoff = nowMs - maxAgeMs;
  const sessions = enforceRetention
    ? sessionResult.sessions
      .filter((session) => Date.parse(session.lastEligibleAt) >= cutoff)
      .slice(-maxSessions)
    : sessionResult.sessions;
  return {
    directory,
    events,
    sessions,
    invalidFiles: eventResult.invalidFiles + sessionResult.invalidFiles,
    cleanupErrors,
    stalePendingFiles,
  };
}

function summarizeObservationEvents(events, {
  sessions: sessionMarkers = [],
  invalidFiles = 0,
  cleanupErrors = 0,
  stalePendingFiles = 0,
  latestOnly = false,
  onlySessionKey = null,
} = {}) {
  const bySession = new Map();
  for (const marker of sessionMarkers) {
    bySession.set(marker.sessionKey, {
      sessionKey: marker.sessionKey,
      firstSeen: marker.lastEligibleAt,
      lastSeen: marker.lastEligibleAt,
      eventCount: 0,
      claimCount: 0,
      documents: new Set(),
      shapeCounts: Object.fromEntries(SHAPES.map((shape) => [shape, 0])),
    });
  }
  for (const event of events) {
    if (!bySession.has(event.sessionKey)) {
      bySession.set(event.sessionKey, {
        sessionKey: event.sessionKey,
        firstSeen: event.occurredAt,
        lastSeen: event.occurredAt,
        eventCount: 0,
        claimCount: 0,
        documents: new Set(),
        shapeCounts: Object.fromEntries(SHAPES.map((shape) => [shape, 0])),
      });
    }
    const session = bySession.get(event.sessionKey);
    session.firstSeen = session.firstSeen < event.occurredAt ? session.firstSeen : event.occurredAt;
    session.lastSeen = session.lastSeen > event.occurredAt ? session.lastSeen : event.occurredAt;
    session.eventCount += 1;
    session.claimCount += event.claimCount;
    session.documents.add(event.documentPath);
    for (const shape of SHAPES) session.shapeCounts[shape] += event.shapeCounts[shape];
  }

  let sessions = [...bySession.values()].sort((a, b) =>
    a.firstSeen.localeCompare(b.firstSeen) || a.sessionKey.localeCompare(b.sessionKey)
  );
  if (onlySessionKey) sessions = sessions.filter((session) => session.sessionKey === onlySessionKey);
  if (latestOnly && sessions.length) {
    const latest = [...sessions].sort((a, b) =>
      b.lastSeen.localeCompare(a.lastSeen) || b.sessionKey.localeCompare(a.sessionKey)
    )[0];
    sessions = [latest];
  }
  const normalized = sessions.map((session) => ({
    ...session,
    documents: [...session.documents].sort(),
  }));
  const shapeCounts = Object.fromEntries(SHAPES.map((shape) => [
    shape,
    normalized.reduce((sum, session) => sum + session.shapeCounts[shape], 0),
  ]));

  return {
    schemaVersion: SCHEMA_VERSION,
    sessionCount: normalized.length,
    eventCount: normalized.reduce((sum, session) => sum + session.eventCount, 0),
    claimCount: normalized.reduce((sum, session) => sum + session.claimCount, 0),
    shapeCounts,
    invalidFiles,
    cleanupErrors,
    stalePendingFiles,
    sessions: normalized,
  };
}

module.exports = {
  MAX_AGE_MS,
  MAX_EVENTS,
  MAX_SESSIONS,
  PENDING_STALE_MS,
  SCHEMA_VERSION,
  SHAPES,
  buildObservationEvent,
  buildObservationSession,
  isObservationEvent,
  isObservationSession,
  observationDirectory,
  publishJsonAtomically,
  pruneObservationEvents,
  pruneObservationSessions,
  prunePendingFiles,
  readObservationEvents,
  recordAdvisoryObservation,
  recordObservationSession,
  sessionKey,
  summarizeObservationEvents,
};
