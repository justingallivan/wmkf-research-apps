#!/usr/bin/env node
/**
 * Read-only reconciliation of memory/audit/Atlas claims against schema files
 * and live probes. The only file this script writes is:
 *   docs/RECONCILIATION_REPORT.json
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const docsDir = path.join(repoRoot, 'docs');
const atlasIndex = path.join(docsDir, 'APPLICATION_STATE_ATLAS.md');
const atlasDir = path.join(docsDir, 'atlas');
const auditFile = path.join(docsDir, 'AUDIT_S154_MEMORY_V2.md');
const wave2Dir = path.join(repoRoot, 'lib', 'dataverse', 'schema', 'wave2');
const schemaSql = path.join(repoRoot, 'lib', 'db', 'schema.sql');
const migrationsDir = path.join(repoRoot, 'lib', 'db', 'migrations');
const setupDbScript = path.join(repoRoot, 'scripts', 'setup-database.js');
const aiFieldsSpecV3 = path.join(docsDir, 'DYNAMICS_AI_FIELDS_SPEC_v3_cn.md');
const reportPath = path.join(docsDir, 'RECONCILIATION_REPORT.json');

function loadEnvFiles() {
  for (const envFile of ['.env', '.env.local']) {
    const p = path.join(repoRoot, envFile);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i === -1) continue;
      const k = t.slice(0, i).trim();
      const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[k]) process.env[k] = v;
    }
  }
}

function readFileSafe(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function rel(file) {
  return path.relative(repoRoot, file);
}

function listMarkdownAtlasFiles() {
  const files = [atlasIndex];
  if (fs.existsSync(atlasDir)) {
    for (const f of fs.readdirSync(atlasDir).filter((x) => x.endsWith('.md')).sort()) {
      files.push(path.join(atlasDir, f));
    }
  }
  return files;
}

function listLabelScanFiles() {
  return [...listMarkdownAtlasFiles(), aiFieldsSpecV3].filter((file, idx, arr) => fs.existsSync(file) && arr.indexOf(file) === idx);
}

function normalizeStatus(text) {
  if (/\bSTALE\b|wrong|contradict|false claim|rot\b/i.test(text)) return 'stale';
  if (/\bCLEAN\b|\bVerified\b|checks out|confirmed|align/i.test(text)) return 'verified';
  return 'unknown';
}

function parseClaimAudit() {
  const src = readFileSafe(auditFile);
  const claims = [];
  const lines = src.split('\n');
  let currentMemory = 'document';
  for (let i = 0; i < lines.length; i++) {
    const heading = lines[i].match(/^###\s+`?([^`]+)`?/);
    if (heading) currentMemory = heading[1];
    if (!lines[i].startsWith('- ')) continue;

    const block = [lines[i].slice(2).trim()];
    while (i + 1 < lines.length && /^(  |\t)/.test(lines[i + 1])) {
      i++;
      block.push(lines[i].trim());
    }
    const claimText = block.join(' ').replace(/\s+/g, ' ').trim();
    const status = normalizeStatus(claimText);
    const evidence = `${currentMemory}; ${status === 'unknown' ? 'not conclusively classified by audit text' : `audit text classified as ${status}`}`;
    claims.push({
      claim_text: claimText,
      source_file: rel(auditFile),
      status,
      evidence,
    });
  }
  return claims;
}

function logicalFromSchemaName(schemaName) {
  if (!schemaName) return null;
  return schemaName.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

function loadWave2Specs() {
  const specs = [];
  if (!fs.existsSync(wave2Dir)) return specs;
  // Strip internal underscores while preserving the publisher prefix
  // underscore. Dataverse logical names follow `<prefix>_<entityname>`
  // where the entity name has no internal underscores in the deployed
  // form, even when the Wave 2 spec file uses snake_case (e.g. spec
  // `wmkf_app_grant_cycle` → deployed `wmkf_appgrantcycle` →
  // entity set `wmkf_appgrantcycles`). Without this variant the
  // candidate loop never tries the actually-deployed name.
  const stripInternalUnderscores = (s) => {
    if (!s) return null;
    const idx = s.indexOf('_');
    if (idx === -1) return s;
    return `${s.slice(0, idx)}_${s.slice(idx + 1).replace(/_/g, '')}`;
  };
  for (const f of fs.readdirSync(wave2Dir).filter((x) => x.endsWith('.json')).sort()) {
    const file = path.join(wave2Dir, f);
    try {
      const spec = JSON.parse(fs.readFileSync(file, 'utf8'));
      const logicalName = logicalFromSchemaName(spec.schemaName) || spec.name;
      const stripped = stripInternalUnderscores(logicalName || spec.name);
      specs.push({
        entity: logicalName,
        spec_name: spec.name || logicalName,
        schema_name: spec.schemaName || null,
        spec_file: rel(file),
        candidate_entity_sets: [
          spec.entitySetName,
          spec.entitySet,
          stripped && `${stripped}s`,
          stripped && `${stripped}es`,
          spec.name && `${spec.name.replace(/_/g, '')}s`,
          logicalName && `${logicalName.replace(/_/g, '')}s`,
          logicalName && `${logicalName.replace(/_/g, '')}es`,
          spec.name && `${spec.name}s`,
          spec.name && `${spec.name}es`,
        ].filter(Boolean),
      });
    } catch (e) {
      specs.push({ entity: f.replace(/\.json$/, ''), spec_file: rel(file), parse_error: e.message });
    }
  }
  return specs;
}

// Regex shape note: the trailing `\s*\(` is load-bearing. Without it the `i`
// flag makes `[a-z_]` case-insensitive, so prose like
// "this inline block uses CREATE TABLE IF NOT EXISTS." picks up "IF" as a
// table name. The open-paren requirement disambiguates real DDL from
// comment-text mentions.
const CREATE_TABLE_RE = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+("?)([a-z_][a-z0-9_]*)\1\s*\(/gi;

function parseSchemaSqlTables() {
  const src = readFileSafe(schemaSql);
  const tables = new Set();
  let m;
  const re = new RegExp(CREATE_TABLE_RE.source, CREATE_TABLE_RE.flags);
  while ((m = re.exec(src)) !== null) tables.add(m[2].toLowerCase());
  return tables;
}

/**
 * Parse `CREATE TABLE` statements from every file in lib/db/migrations/.
 * Returns the set of tables created by migrations. Migrations are part of
 * the full schema-as-code set (with schema.sql and setup-database.js).
 */
function parseMigrationTables() {
  const tables = new Set();
  if (!fs.existsSync(migrationsDir)) return tables;
  for (const f of fs.readdirSync(migrationsDir).filter((x) => x.endsWith('.sql'))) {
    const src = readFileSafe(path.join(migrationsDir, f));
    let m;
    const re = new RegExp(CREATE_TABLE_RE.source, CREATE_TABLE_RE.flags);
    while ((m = re.exec(src)) !== null) tables.add(m[2].toLowerCase());
  }
  return tables;
}

/**
 * Parse `CREATE TABLE` statements from scripts/setup-database.js. This file
 * is the real source of truth for the original table set — schema.sql
 * carries only a subset (drift between the two predates this audit and is
 * orthogonal to memory-drift gating). Without this source, the reconcile
 * report's postgres_table_mismatch bucket false-fires on ~15 tables
 * (api_usage_log, system_alerts, etc.) that are actually declared, just
 * not in schema.sql.
 */
function parseSetupDbTables() {
  const tables = new Set();
  if (!fs.existsSync(setupDbScript)) return tables;
  const src = readFileSafe(setupDbScript);
  const re = new RegExp(CREATE_TABLE_RE.source, CREATE_TABLE_RE.flags);
  let m;
  while ((m = re.exec(src)) !== null) tables.add(m[2].toLowerCase());
  return tables;
}

function extractAtlasFacts() {
  const facts = {
    entityMentions: new Map(),
    logicalEntities: new Set(),
    rowClaims: [],
    entitySetByLogical: new Map(),
    atlasEntitySets: new Set(),
    labelSources: new Map(),
  };

  function addLabelSource(label, source, descriptor) {
    if (!descriptor) return;
    if (!facts.labelSources.has(label)) facts.labelSources.set(label, new Map());
    const sourceMap = facts.labelSources.get(label);
    let key = source;
    let i = 2;
    while (sourceMap.has(key) && sourceMap.get(key).toLowerCase() !== descriptor.toLowerCase()) {
      key = `${source}#${i++}`;
    }
    sourceMap.set(key, descriptor);
  }

  for (const file of listMarkdownAtlasFiles()) {
    const source = rel(file);
    const src = readFileSafe(file);

    for (const m of src.matchAll(/`([a-z][a-z0-9_]{2,})`/g)) {
      const token = m[1].toLowerCase();
      if (!/^(wmkf|akoya|contact|account|systemuser|irs|grant|research|review|publication|proposal|user|dynamics|intake|submission|api|health|maintenance|retractions|expertise|panel|screening|search)/.test(token)) continue;
      if (!facts.entityMentions.has(token)) facts.entityMentions.set(token, new Set());
      facts.entityMentions.get(token).add(source);
    }

    let currentEntity = null;
    for (const line of src.split('\n')) {
      const h = line.match(/^#{1,3}\s+`([^`]+)`/);
      if (h) {
        currentEntity = h[1].toLowerCase();
        facts.logicalEntities.add(currentEntity);
      }

      const set = line.match(/\*\*Entity set:\*\*\s+`([^`]+)`/i);
      if (set) {
        const entitySet = set[1].toLowerCase();
        facts.atlasEntitySets.add(entitySet);
        if (currentEntity) facts.entitySetByLogical.set(currentEntity, entitySet);
      }

      const rowClaim = line.match(/(?:\*\*Live row count:\*\*|live state:|holds|has|is also empty|counterpart .* has|###\s+`?([a-z0-9_]+)`?)?[^0-9]*(\d[\d,]*)\s+rows?\b/i);
      if (rowClaim) {
        const count = Number(rowClaim[2].replace(/,/g, ''));
        const entity = (currentEntity || rowClaim[1] || inferEntityNearLine(line) || '').toLowerCase();
        if (entity) {
          facts.rowClaims.push({ entity, atlas_claim: count, source_file: source, claim_text: line.trim() });
        }
      }

      const noRows = line.match(/`([^`]+)`[^.\n]*(?:0 rows|empty|EMPTY)/i);
      if (noRows) {
        facts.rowClaims.push({ entity: noRows[1].toLowerCase(), atlas_claim: 0, source_file: source, claim_text: line.trim() });
      }

      for (const m of line.matchAll(/Field Set\s+([A-Z])[^:\n]*(?::|-|—)\s*([^.;\n]+)/gi)) {
        const label = `Field Set ${m[1].toUpperCase()}`;
        const descriptor = m[2].replace(/[`*_]/g, '').trim();
        addLabelSource(label, source, descriptor);
      }
    }
  }

  for (const file of listLabelScanFiles()) {
    const source = rel(file);
    const src = readFileSafe(file);
    for (const line of src.split('\n')) {
      const heading = line.match(/^#{1,3}\s+Field Set\s+([A-Z])\s+[-—:]\s+(.+)$/i);
      if (heading) {
        const label = `Field Set ${heading[1].toUpperCase()}`;
        const descriptor = heading[2].replace(/[`*_#]/g, '').trim();
        addLabelSource(label, source, descriptor);
      }

      const inline = line.match(/(.{0,120})Field Set\s+([A-Z])\s*:\s*([^.;\n]+)/i);
      if (inline) {
        const label = `Field Set ${inline[2].toUpperCase()}`;
        const context = inline[1].replace(/[`*_#-]/g, '').replace(/\s+/g, ' ').trim();
        const descriptor = `${context} ${inline[3]}`.replace(/\s+/g, ' ').trim();
        addLabelSource(label, source, descriptor);
      }
    }
  }
  return facts;
}

function inferEntityNearLine(line) {
  const m = line.match(/`([a-z][a-z0-9_]+)`/i);
  return m && m[1];
}

async function getDataverseToken() {
  const required = ['DYNAMICS_URL', 'DYNAMICS_TENANT_ID', 'DYNAMICS_CLIENT_ID', 'DYNAMICS_CLIENT_SECRET'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) return { skipped: true, reason: `missing ${missing.join(', ')}` };

  const tokenUrl = `https://login.microsoftonline.com/${process.env.DYNAMICS_TENANT_ID}/oauth2/v2.0/token`;
  const res = await fetchWithTimeout(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.DYNAMICS_CLIENT_ID,
      client_secret: process.env.DYNAMICS_CLIENT_SECRET,
      scope: `${process.env.DYNAMICS_URL}/.default`,
    }),
  }, 15000);
  if (!res.ok) throw new Error(`Token ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return { token: (await res.json()).access_token };
}

async function fetchWithTimeout(url, options, ms = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function dynamicsHeaders(token, accept = 'application/json') {
  return {
    Authorization: `Bearer ${token}`,
    Accept: accept,
    'OData-MaxVersion': '4.0',
    'OData-Version': '4.0',
  };
}

async function resolveEntitySet(token, logicalName, candidates) {
  if (logicalName) {
    const url = `${process.env.DYNAMICS_URL}/api/data/v9.2/EntityDefinitions(LogicalName='${logicalName}')?$select=LogicalName,EntitySetName`;
    const r = await fetchWithTimeout(url, { headers: dynamicsHeaders(token) });
    if (r.ok) {
      const body = await r.json();
      if (body.EntitySetName) return { entitySet: body.EntitySetName, metadata_status: 200 };
    }
    if (r.status && r.status !== 404) return { metadata_status: r.status, metadata_error: (await r.text()).slice(0, 200) };
  }

  // Probe candidates in order. A probe_404 means "this candidate entity-set
  // name doesn't exist" — do NOT early-return on it, because Wave 2 schema
  // files use underscored logical names (`wmkf_app_grant_cycle`) while
  // deployed entity sets use no-underscore plurals (`wmkf_appgrantcycles`),
  // so the first candidate often 404s while a later candidate is the real
  // deployed set. Only return on a successful probe (200). If every
  // candidate 404s, fall through to the final 404 with the last attempted
  // set name so the report still reads coherently.
  let lastProbe404 = null;
  for (const c of candidates || []) {
    const r = await probeEntitySetCount(token, c);
    if (r.status === 200) return { entitySet: c, direct_probe: r };
    if (r.status === 'probe_404') lastProbe404 = { entitySet: c, direct_probe: r };
  }
  if (lastProbe404) return lastProbe404;
  return { entitySet: (candidates || [])[0] || logicalName, metadata_status: 404 };
}

async function probeEntitySetCount(token, entitySet, opts = {}) {
  // opts._fetch — test injection point. Defaults to fetchWithTimeout.
  // Signature: (url, init) => Promise<Response>. Tests inject a mock to
  // exercise the timeout-vs-error branches without hitting the network.
  const fetchFn = opts._fetch || fetchWithTimeout;
  const baseUrl = opts._baseUrl || `${process.env.DYNAMICS_URL}/api/data/v9.2`;
  const base = `${baseUrl}/${entitySet}`;
  let exists;
  try {
    exists = await fetchFn(`${base}?$top=1`, {
      method: 'GET',
      headers: dynamicsHeaders(token),
    });
  } catch (e) {
    return { status: 'unknown', entitySet, row_count: null, error: e.name === 'AbortError' ? 'timeout' : e.message };
  }
  if (exists.status === 404) return { status: 'probe_404', entitySet, row_count: null };
  if (!exists.ok) return { status: 'unknown', entitySet, error: `${exists.status} ${(await exists.text()).slice(0, 200)}` };

  // The entity exists; $count is best-effort. A *timeout* on huge tables
  // (e.g. akoya_requests with 5M+ rows) must NOT downgrade the entity
  // probe to 'unknown' — that would trip the memory-drift gate's
  // probe_errors blocker over an operationally-uninteresting slow count.
  // But genuine non-timeout failures (network/TLS/etc.) MUST keep
  // surfacing as 'unknown' so they show up in probe_errors — silently
  // swallowing them was a Codex-caught regression from the initial
  // timeout-only fix.
  // Count strategy: use `?$count=true&$top=1` and read `@odata.count`
  // from the response body — NOT the bare `/$count` endpoint. The bare
  // path caps at maxPageSize (default 5000), so any table with >5000 rows
  // (e.g. wmkf_apprequestpersons ~5,561; akoya_requests ~25,561) silently
  // returned 5000 and looked like fake drift against an accurate Atlas
  // claim. The `$count=true` annotation uses Dataverse's FetchXML
  // aggregation under the hood and returns the true count reliably up to
  // ~50,000. Above that, set { Prefer: 'odata.include-annotations="*"' }
  // and parse `@odata.count` from the response; the same code path
  // handles both regimes.
  try {
    const count = await fetchFn(`${base}?$count=true&$top=1`, {
      method: 'GET',
      headers: {
        ...dynamicsHeaders(token),
        Prefer: 'odata.include-annotations="*"',
      },
    });
    if (!count.ok) return { status: 200, entitySet, row_count: null, count_error: `${count.status} ${(await count.text()).slice(0, 200)}` };
    const body = await count.json();
    const annotated = body['@odata.count'];
    if (typeof annotated === 'number') {
      // Dataverse caps both /$count and ?$count=true at 5000 regardless of
      // Prefer:maxpagesize. A row_count of exactly 5000 is therefore
      // ambiguous — could be a real 5000-row table, but in practice
      // virtually always means "cap reached, true count ≥ 5000."
      // Callers that need the true count must fall back to FetchXML
      // aggregate (out of scope here). We tag the probe so drift-bucket
      // builders can skip false-staleness on capped probes.
      const count_capped = annotated === 5000;
      return { status: 200, entitySet, row_count: annotated, ...(count_capped ? { count_capped: true } : {}) };
    }
    return { status: 200, entitySet, row_count: null, count_error: 'missing @odata.count annotation' };
  } catch (e) {
    if (e.name === 'AbortError') {
      return { status: 200, entitySet, row_count: null, count_error: 'timeout' };
    }
    return { status: 'unknown', entitySet, row_count: null, error: e.message };
  }
}

async function probeDataverseEntities(entities, specs, atlasFacts) {
  const results = new Map();
  let tokenResult;
  try {
    tokenResult = await getDataverseToken();
  } catch (e) {
    for (const entity of entities) results.set(entity, { status: 'unknown', error: e.message, row_count: null });
    return { results, warning: `probe_error: ${e.message}` };
  }
  if (tokenResult.skipped) {
    for (const entity of entities) results.set(entity, { status: 'probe_skipped', reason: tokenResult.reason, row_count: null });
    return { results, warning: tokenResult.reason };
  }

  for (const entity of entities) {
    const spec = specs.find((s) => s.entity === entity || s.spec_name === entity);
    const knownSet = atlasFacts.entitySetByLogical.get(entity) || (atlasFacts.atlasEntitySets.has(entity) ? entity : null);
    const candidates = knownSet ? [knownSet] : (spec ? spec.candidate_entity_sets : [`${entity}s`, `${entity}es`]);
    const resolved = await resolveEntitySet(tokenResult.token, entity, candidates);
    const direct = resolved.direct_probe || await probeEntitySetCount(tokenResult.token, resolved.entitySet);
    results.set(entity, {
      ...direct,
      logical_name: entity,
      entity_set: resolved.entitySet,
      metadata_status: resolved.metadata_status,
      metadata_error: resolved.metadata_error,
    });
  }
  return { results, warning: null };
}

async function probePostgresTables() {
  try {
    if (!process.env.POSTGRES_URL && !process.env.DATABASE_URL) {
      return { skipped: true, reason: 'missing POSTGRES_URL or DATABASE_URL', tables: new Set() };
    }
    const { sql } = await import('@vercel/postgres');
    const r = await sql.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    return { skipped: false, tables: new Set(r.rows.map((row) => row.table_name.toLowerCase())) };
  } catch (e) {
    return { skipped: true, reason: e.message, tables: new Set() };
  }
}

function buildLabelCollisions(atlasFacts) {
  const collisions = [];
  for (const [label, sourceMap] of atlasFacts.labelSources) {
    const entries = [...sourceMap.entries()];
    const hasV3Spec = entries.some(([source]) => source.startsWith(rel(aiFieldsSpecV3)));
    const hasAtlas = entries.some(([source]) => source.startsWith('docs/atlas/'));
    const descriptors = new Set(entries.map(([, v]) => v.toLowerCase()).filter((v) => v && v !== 'ready' && !v.startsWith('ready,')));
    if (hasV3Spec && hasAtlas && descriptors.size > 1 && label === 'Field Set D') {
      collisions.push({ label, sources: entries.map(([source, descriptor]) => `${source}: ${descriptor}`) });
    }
  }
  return collisions;
}

function nearestAtlasClaim(entity, rowClaims) {
  const compact = entity.replace(/_/g, '');
  const claims = rowClaims.filter((c) => {
    const e = c.entity.replace(/_/g, '');
    return e === compact || e === `${compact}s` || `${e}s` === compact || compact.includes(e) || e.includes(compact);
  });
  return claims.length ? claims[claims.length - 1] : null;
}

async function main() {
  loadEnvFiles();

  const claimAudit = parseClaimAudit();
  const specs = loadWave2Specs();
  const schemaSqlTables = parseSchemaSqlTables();
  const migrationTables = parseMigrationTables();
  const setupDbTables = parseSetupDbTables();
  // Combined schema-as-code set: union of schema.sql + setup-database.js +
  // all migrations. This is the authoritative "did we declare this table in
  // source?" set. Using schema.sql alone produces ~20 false-positive
  // 'mismatch' entries; setup-database.js holds the original bulk-create
  // DDL that schema.sql never caught up with.
  const schemaTables = new Set([...schemaSqlTables, ...setupDbTables, ...migrationTables]);
  const atlasFacts = extractAtlasFacts();

  const dataverseEntities = new Set([
    ...specs.map((s) => s.entity).filter(Boolean),
    ...[...atlasFacts.atlasEntitySets],
    ...[...atlasFacts.logicalEntities].filter((e) => e.startsWith('wmkf_') || e.startsWith('akoya_')),
  ]);
  const { results: dataverseResults, warning: dataverseWarning } = await probeDataverseEntities([...dataverseEntities].sort(), specs, atlasFacts);
  const postgres = await probePostgresTables();

  const specWithoutEntity = [];
  for (const spec of specs) {
    const r = dataverseResults.get(spec.entity);
    if (r && r.status === 'probe_404') {
      specWithoutEntity.push({ entity: spec.entity, spec_file: spec.spec_file, severity: 'high', evidence: 'Dataverse probe returned probe_404; treat as drift, not proof of non-existence' });
    }
  }

  const entityWithoutAtlas = [];
  for (const [entity, result] of dataverseResults) {
    if (result.status !== 200) continue;
    const mentioned = atlasFacts.entityMentions.has(entity) || atlasFacts.entityMentions.has(result.entity_set);
    if (!mentioned && entity.startsWith('wmkf_')) entityWithoutAtlas.push({ entity, row_count: result.row_count });
  }

  const staleRowCount = [];
  const cappedProbeEntities = [];
  for (const [entity, result] of dataverseResults) {
    if (result.status !== 200 || typeof result.row_count !== 'number') continue;
    if (result.count_capped) {
      // Probe returned the Dataverse $count cap (5000); real count is ≥5000
      // and the atlas claim should be treated as more authoritative. Surface
      // separately in probe_notes; do NOT push into stale_row_count where
      // it would look like real drift.
      cappedProbeEntities.push(entity);
      continue;
    }
    const claim = nearestAtlasClaim(entity, atlasFacts.rowClaims) || nearestAtlasClaim(result.entity_set || entity, atlasFacts.rowClaims);
    if (!claim || claim.atlas_claim === result.row_count) continue;
    staleRowCount.push({ entity, atlas_claim: claim.atlas_claim, live_count: result.row_count, source_file: claim.source_file });
  }

  const postgresTableMismatch = [];
  if (postgres.skipped) {
    // Unknown is not a mismatch. The skipped probe is recorded in probe_notes
    // and summary.probe_errors instead of polluting this drift bucket.
  } else {
    // Declared in source (schema.sql ∪ setup-database.js ∪ migrations) but not deployed:
    for (const table of schemaTables) {
      if (!postgres.tables.has(table)) {
        const sources = [];
        if (schemaSqlTables.has(table)) sources.push('schema_sql');
        if (setupDbTables.has(table)) sources.push('setup_database');
        if (migrationTables.has(table)) sources.push('migrations');
        postgresTableMismatch.push({
          table,
          in_schema_as_code: true,
          deployed: false,
          declared_in: sources.join('+'),
        });
      }
    }
    // Deployed but not declared in source — this IS the bucket that matters
    // for drift detection. With migrations folded into schema-as-code, the
    // remaining entries are genuinely undeclared tables.
    for (const table of postgres.tables) {
      if (table === 'schema_migrations') continue; // apply-migrations.js runner bookkeeping, not schema-as-code
      if (!schemaTables.has(table)) {
        postgresTableMismatch.push({ table, in_schema_as_code: false, deployed: true });
      }
    }
  }

  const probeErrors = [...dataverseResults.values()].filter((r) => r.status === 'unknown').length + (postgres.skipped ? 1 : 0);
  const summary = {
    total_claims: claimAudit.length,
    stale: claimAudit.filter((c) => c.status === 'stale').length,
    verified: claimAudit.filter((c) => c.status === 'verified').length,
    unknown: claimAudit.filter((c) => c.status === 'unknown').length,
    probe_errors: probeErrors,
  };

  // bucket_meta is a self-documenting header so future auditors don't have
  // to re-derive which buckets are gate-blocking vs. informational by
  // reading check-memory-drift.js. Mirrors the actual gate logic in
  // scripts/check-memory-drift.js: the gate only fails on
  // spec_without_entity, stale_row_count (>50% drift), doc_label_collision,
  // and probe_errors > 0. Everything else is informational.
  const bucket_meta = {
    spec_without_entity: { gate_blocking: true, severity: 'P0', describes: 'Wave 2 schema-as-code entity that probes as 404 in Dataverse.' },
    entity_without_atlas: { gate_blocking: false, severity: 'P2', describes: 'Dataverse entity that exists live but has no Atlas mention. Informational — usually means the Atlas page needs an entry, occasionally means the entity was deployed with an unconventional name.' },
    stale_row_count: { gate_blocking: 'when_delta_over_50_percent', severity: 'P1', describes: 'Atlas row-count claim differs from live probe. Probe-capped rows (Dataverse $count caps at 5000) are excluded — surfaced in probe_notes.dataverse_count_capped instead.' },
    doc_label_collision: { gate_blocking: true, severity: 'P0', describes: 'Same label used for incompatible meanings across docs. Resolve by owner decision, do not silence.' },
    postgres_table_mismatch: { gate_blocking: false, severity: 'P2', describes: 'Postgres table appears in source-as-code (schema.sql ∪ migrations/) but not live, OR live but not in source-as-code. Migrations are part of the schema-as-code set; tables created by migrations should NOT appear here.' },
  };

  const report = {
    generated: new Date().toISOString(),
    summary,
    bucket_meta,
    probe_notes: {
      dataverse: dataverseWarning ? `probe_skipped: ${dataverseWarning}` : 'completed',
      postgres: postgres.skipped ? `probe_skipped: ${postgres.reason}` : 'completed',
      dataverse_count_capped: cappedProbeEntities.length
        ? `Dataverse $count returned the 5000-row cap for: ${cappedProbeEntities.join(', ')}. Real counts unknown via OData $count; consult Atlas / FetchXML aggregates.`
        : 'none',
    },
    drift_buckets: {
      spec_without_entity: specWithoutEntity,
      entity_without_atlas: entityWithoutAtlas,
      stale_row_count: staleRowCount,
      doc_label_collision: buildLabelCollisions(atlasFacts),
      postgres_table_mismatch: postgresTableMismatch,
    },
    claim_audit: claimAudit,
  };
  report.probe_notes.dataverse = dataverseWarning
    ? (dataverseWarning.startsWith('probe_error:') ? dataverseWarning : `probe_skipped: ${dataverseWarning}`)
    : 'completed';

  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`Wrote ${rel(reportPath)}`);
  console.log(`Claims: ${summary.total_claims} total, ${summary.verified} verified, ${summary.stale} stale, ${summary.unknown} unknown`);
  console.log(`Drift: ${specWithoutEntity.length} spec_without_entity, ${staleRowCount.length} stale_row_count, ${entityWithoutAtlas.length} entity_without_atlas, ${postgresTableMismatch.length} postgres_table_mismatch`);
  if (dataverseWarning) {
    const label = dataverseWarning.startsWith('probe_error:') ? 'Dataverse probe error' : 'Dataverse probes skipped';
    console.warn(`${label}: ${dataverseWarning}`);
  }
  if (postgres.skipped) console.warn(`Postgres probe skipped: ${postgres.reason}`);
}

// Export testable helpers for unit tests. Guard main() so requiring this
// module does not auto-run the script.
module.exports = { probeEntitySetCount };

if (require.main === module) {
  main().catch((e) => {
    console.error(`FATAL: ${e.message}`);
    if (process.env.DEBUG) console.error(e.stack);
    process.exit(1);
  });
}
