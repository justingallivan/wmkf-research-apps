/** Operational rehearsal phases. Never mutates public or Dataverse. */
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const target = require('../../lib/services/expertise-finder/roster-rehearsal-target.cjs');
const contract = require('../../lib/services/expertise-finder/roster-contract.cjs');
const {
  createLifecycle, creationKey, assertOperationalSchema, readState, installFreeze, verifyFreeze, removeFreeze, CONTROL_DDL,
} = require('../../lib/services/expertise-finder/roster-lifecycle.cjs');
const { planImport, fingerprint, TEXT_POLICY } = require('./expertise-roster-import-plan.cjs');

const root = path.resolve(__dirname, '../..');
const actions = {
  prepare: { from: null, to: 'prepared' },
  activate: { from: 'prepared', to: 'active' },
  pause: { from: 'active', to: 'paused' },
  resume: { from: 'paused', to: 'active' },
  abort: { from: 'prepared', to: 'legacy' },
  rollback: { from: 'paused', to: 'legacy' },
};
const bridgeFK = 'consultant_feedback_roster_identity_fk';
const oldFK = 'consultant_feedback_consultant_roster_id_fkey';
const maxId = 2147483647;
const managedFields = ['name', 'role_type', 'is_active', 'dataverse_contact_id', ...contract.TEXT];
const legacyWidths = { name: 255, role_type: 50, role: 255, affiliation: 500, orcid: 255,
  keck_affiliation: 255, preferred_email: 320 };
const quoted = value => '"' + value.replaceAll('"', '""') + '"';
function check(ok, message) {
  if (!ok) throw Object.assign(new Error(message), { code: 'roster_cutover_refused' });
}
function same(actual, expected, message) {
  check(fingerprint(actual) === fingerprint(expected), message);
}
function privatePath(value) {
  check(typeof value === 'string' && path.isAbsolute(value), 'An absolute private artifact path is required.');
  const resolved = path.join(fs.realpathSync(path.dirname(value)), path.basename(value));
  const worktree = fs.realpathSync(root);
  check(resolved !== worktree && !resolved.startsWith(worktree + path.sep), 'Artifacts must be outside the worktree.');
  return resolved;
}
function readManifest(filename) {
  let fd;
  try {
    fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  try {
    const stat = fs.fstatSync(fd);
    check(stat.isFile() && (stat.mode & 0o077) === 0, 'Manifest must be a private regular file.');
    const manifest = JSON.parse(fs.readFileSync(fd, 'utf8'));
    check(manifest?.version === 1 && contract.guid(manifest.generation), 'Invalid cutover manifest.');
    return manifest;
  } finally {
    fs.closeSync(fd);
  }
}
function save(fd, value) {
  fs.ftruncateSync(fd, 0);
  fs.writeSync(fd, JSON.stringify(value, null, 2) + '\n', 0, 'utf8');
  fs.fsyncSync(fd);
}
function syncParent(filename) {
  const parent = fs.openSync(path.dirname(filename), 'r');
  try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
}
function writeManifest(filename, manifest) {
  const fd = fs.openSync(filename, 'wx', 0o600);
  try {
    save(fd, manifest);
    syncParent(filename);
  } finally {
    fs.closeSync(fd);
  }
}
function outcome(error) {
  return error.code === 'roster_cutover_refused' ? error.message : 'Cutover operation failed; inspect the target and retry with the same manifest.';
}

async function catalog(client, schema, identityFK) {
  const { rows: foreignKeys } = await client.query(`
    SELECT sn.nspname AS source_schema, sc.relname AS source, c.conname AS name,
           tn.nspname AS target_schema, tc.relname AS target,
           ARRAY(SELECT sa.attname::text FROM unnest(c.conkey) WITH ORDINALITY AS k(num, ord)
                 JOIN pg_attribute sa ON sa.attrelid=sc.oid AND sa.attnum=k.num ORDER BY k.ord) AS columns,
           ARRAY(SELECT ta.attname::text FROM unnest(c.confkey) WITH ORDINALITY AS k(num, ord)
                 JOIN pg_attribute ta ON ta.attrelid=tc.oid AND ta.attnum=k.num ORDER BY k.ord) AS target_columns,
           c.convalidated AS validated, c.condeferrable AS deferrable, c.condeferred AS deferred,
           c.confupdtype AS on_update, c.confdeltype AS on_delete, c.confmatchtype AS match,
           pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c
      JOIN pg_class sc ON sc.oid=c.conrelid JOIN pg_namespace sn ON sn.oid=sc.relnamespace
      JOIN pg_class tc ON tc.oid=c.confrelid JOIN pg_namespace tn ON tn.oid=tc.relnamespace
     WHERE c.contype='f' AND (
       (sn.nspname=$1 AND sc.relname=ANY($2::text[])) OR
       (tn.nspname=$1 AND tc.relname=ANY($3::text[])))
     ORDER BY sn.nspname, sc.relname, c.conname`,
  [schema, ['expertise_roster', 'expertise_roster_identity', 'expertise_roster_binding', 'consultant_feedback'],
    ['expertise_roster', 'expertise_roster_identity']]);
  const expected = [
    ['expertise_roster', 'created_by', 'user_profiles', 'a', 'expertise_roster_created_by_fkey'],
    ['expertise_roster', 'updated_by', 'user_profiles', 'a', 'expertise_roster_updated_by_fkey'],
    ['consultant_feedback', 'created_by', 'user_profiles', 'a', 'consultant_feedback_created_by_fkey'],
    ['consultant_feedback', 'updated_by', 'user_profiles', 'a', 'consultant_feedback_updated_by_fkey'],
    ['expertise_roster_binding', 'roster_id', 'expertise_roster_identity', 'r', 'expertise_roster_binding_roster_id_fkey'],
    ['consultant_feedback', 'consultant_roster_id', identityFK ? 'expertise_roster_identity' : 'expertise_roster',
      'a', identityFK ? bridgeFK : oldFK],
  ];
  check(foreignKeys.length === expected.length && expected.every(([source, column, to, onDelete, name]) =>
    foreignKeys.some(fk => fk.source_schema === schema && fk.target_schema === schema && fk.source === source &&
      fk.name === name && fk.target === to && fk.validated && !fk.deferrable && !fk.deferred &&
      fk.on_update === 'a' && fk.on_delete === onDelete && fk.match === 's' &&
      fk.columns.length === 1 && fk.columns[0] === column &&
      fk.target_columns.length === 1 && fk.target_columns[0] === 'id')), 'Unexpected or cross-schema roster foreign key.');
  const { rows: constraints } = await client.query(`
    SELECT c.conrelid::regclass::text || ':' || pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c
     WHERE c.conrelid IN ('expertise_roster'::regclass,'consultant_feedback'::regclass,
                          'expertise_roster_identity'::regclass,'expertise_roster_binding'::regclass)
       AND c.contype IN ('p','u','c','x')`);
  same(constraints.map(row => row.definition).sort(), [
    'expertise_roster:PRIMARY KEY (id)',
    'consultant_feedback:PRIMARY KEY (id)',
    'consultant_feedback:UNIQUE (requestdocument_id)',
    "consultant_feedback:CHECK ((status = ANY (ARRAY['active'::text, 'deleting'::text])))",
    'consultant_feedback:CHECK (((body_html IS NOT NULL) OR (requestdocument_id IS NOT NULL)))',
    'consultant_feedback:CHECK ((((consultant_roster_id IS NOT NULL) AND (one_off_name IS NULL)) OR ((consultant_roster_id IS NULL) AND (one_off_name IS NOT NULL))))',
    'expertise_roster_binding:PRIMARY KEY (roster_id, target_host)',
    'expertise_roster_binding:UNIQUE (target_host, dataverse_profile_guid)',
    "expertise_roster_binding:CHECK (((target_host = lower(target_host)) AND (target_host !~ '[/ :]'::text) AND (length(target_host) <= 253)))",
    'expertise_roster_identity:CHECK ((id > 0))',
    'expertise_roster_identity:PRIMARY KEY (id)',
  ].sort(), 'Unexpected roster, bridge or feedback constraints.');
  const { rows: defaults } = await client.query(`
    SELECT d.adrelid::regclass::text || '.' || a.attname || ':' || pg_get_expr(d.adbin,d.adrelid) AS definition
      FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
     WHERE d.adrelid IN ('expertise_roster'::regclass,'consultant_feedback'::regclass,
                         'expertise_roster_identity'::regclass,'expertise_roster_binding'::regclass)`);
  same(defaults.map(row => row.definition).sort(), [
    "expertise_roster.id:nextval('expertise_roster_id_seq'::regclass)",
    'expertise_roster.is_active:true',
    'expertise_roster.created_at:CURRENT_TIMESTAMP',
    'expertise_roster.updated_at:CURRENT_TIMESTAMP',
    "consultant_feedback.id:nextval('consultant_feedback_id_seq'::regclass)",
    'consultant_feedback.shared:true',
    "consultant_feedback.status:'active'::text",
    'consultant_feedback.created_at:now()',
    'consultant_feedback.updated_at:now()',
  ].sort(), 'Unexpected roster, bridge or feedback defaults.');
  const { rows: unexpectedTriggers } = await client.query(`
    SELECT 1 FROM pg_trigger
     WHERE NOT tgisinternal AND tgrelid IN (
       'expertise_roster_identity'::regclass,'expertise_roster_binding'::regclass,'consultant_feedback'::regclass)`);
  check(!unexpectedTriggers.length, 'Unexpected bridge or feedback trigger.');
  const { rows: [sequence] } = await client.query(`
    SELECT s.seqtypid::regtype::text AS type, s.seqstart::text AS start,
           s.seqincrement::text AS increment, s.seqmin::text AS minimum, s.seqmax::text AS maximum,
           s.seqcache::text AS cache, s.seqcycle AS cycle, n.nspname AS schema,
           pg_get_expr(d.adbin,d.adrelid) AS id_default,
           to_regclass(pg_get_serial_sequence('expertise_roster','id'))=s.seqrelid AS owned
      FROM pg_sequence s JOIN pg_class c ON c.oid=s.seqrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_attribute a ON a.attrelid='expertise_roster'::regclass AND a.attname='id'
      LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
     WHERE s.seqrelid='expertise_roster_id_seq'::regclass`);
  same(sequence, {
    type: 'integer', start: '1', increment: '1', minimum: '1', maximum: String(maxId),
    cache: '1', cycle: false, schema, id_default: "nextval('expertise_roster_id_seq'::regclass)", owned: true,
  }, 'Unexpected legacy roster sequence or default.');
  return { feedbackFK: foreignKeys.find(fk => fk.source === 'consultant_feedback' && fk.columns[0] === 'consultant_roster_id'), sequence };
}
async function localSnapshot(client) {
  const { rows: sourceRows } = await client.query('SELECT * FROM expertise_roster ORDER BY id');
  const { rows: identities } = await client.query('SELECT id FROM expertise_roster_identity ORDER BY id');
  const { rows: bindings } = await client.query('SELECT roster_id,target_host,dataverse_profile_guid FROM expertise_roster_binding ORDER BY roster_id,target_host');
  const { rows: [sequence] } = await client.query('SELECT last_value,is_called FROM expertise_roster_id_seq');
  const { rows: [refs] } = await client.query(`
    SELECT count(*) FILTER (WHERE r.id IS NULL)::int AS missing_source,
           count(*) FILTER (WHERE i.id IS NULL)::int AS missing_identity
      FROM consultant_feedback f LEFT JOIN expertise_roster r ON r.id=f.consultant_roster_id
      LEFT JOIN expertise_roster_identity i ON i.id=f.consultant_roster_id
     WHERE f.consultant_roster_id IS NOT NULL`);
  return {
    source: JSON.parse(JSON.stringify(sourceRows)), ids: identities.map(row => row.id),
    bindings, sequence: { last_value: Number(sequence.last_value), is_called: sequence.is_called }, refs,
  };
}
function census(snapshot, host) {
  check(snapshot?.version === 1 && snapshot.complete === true && snapshot.targetHost === host &&
    Array.isArray(snapshot.profiles), 'A complete sandbox profile census is required.');
  const ids = new Set(), keys = new Set();
  for (const { profileGuid, values } of snapshot.profiles) {
    const key = values?.wmkf_creationkey;
    check(contract.guid(profileGuid) && !ids.has(profileGuid) && typeof key === 'string' && key.length > 0 &&
      !keys.has(key) && /^W\/"\d+"$/.test(values['@odata.etag']), 'Invalid or duplicate sandbox profile identity.');
    ids.add(profileGuid);
    keys.add(key);
  }
  return { ...snapshot, profiles: [...snapshot.profiles].sort((a, b) => a.profileGuid.localeCompare(b.profileGuid)) };
}
function reviewImport(review, snapshot, local, host) {
  const { source, mapping, reviewedPlan, importReceipt } = review ?? {};
  check(reviewedPlan?.blocked === false && reviewedPlan.textPolicy === TEXT_POLICY &&
    importReceipt?.version === 2 && importReceipt.success === true && importReceipt.bridgeCommitted === true &&
    importReceipt.textPolicy === TEXT_POLICY && source?.datasetId === importReceipt.datasetId &&
    reviewedPlan.datasetId === source.datasetId && reviewedPlan.targetHost === host && importReceipt.targetHost === host, 'Reviewed import and committed receipt required.');
  check(Number.isSafeInteger(source.sequenceHighWater) && source.sequenceHighWater >= 0 &&
    source.sequenceHighWater < maxId && source.sequenceHighWater >= Math.max(0, ...source.rows.map(row => row.id)) &&
    importReceipt.sourceHash === fingerprint(source) && reviewedPlan.sourceHash === importReceipt.sourceHash &&
    importReceipt.mappingHash === fingerprint(mapping) && reviewedPlan.mappingHash === importReceipt.mappingHash,
  'Reviewed import evidence hashes differ.');
  same(local.source, [...source.rows].sort((a, b) => a.id - b.id), 'Legacy source rows differ from reviewed export.');
  const fresh = planImport(source, snapshot, mapping, [host]);
  check(!fresh.blocked && fresh.summary.create === 0, 'Current Dataverse roster differs from reviewed import.');
  const projection = rows => rows.map(row => ({
    legacyId: row.legacyId, creationKey: row.creationKey, values: row.values,
    normalizedEmptyFields: row.normalizedEmptyFields, excluded: row.action === 'exclude',
  }));
  same(projection(fresh.rows), projection(reviewedPlan.rows), 'Reviewed import payload differs.');
  check(Array.isArray(importReceipt.rows) && importReceipt.rows.length === fresh.rows.length, 'Import receipt census differs.');
  const ids = new Set(), bindings = [];
  for (const row of fresh.rows) {
    const receipts = importReceipt.rows.filter(entry => entry.creationKey === row.creationKey);
    const receipt = receipts[0];
    check(receipts.length === 1 && receipt.legacyId === row.legacyId &&
      Number.isInteger(receipt.rosterId) && receipt.rosterId > 0 && receipt.rosterId <= maxId &&
      !ids.has(receipt.rosterId) && (row.legacyId === null || row.legacyId === receipt.rosterId), 'Invalid import receipt identity.');
    ids.add(receipt.rosterId);
    if (row.action === 'exclude') {
      check(receipt.status === 'identity-only' && !receipt.profileGuid, 'Excluded identity is not identity-only.');
    } else {
      check(receipt.status === 'bound' && receipt.profileGuid === row.profileGuid, 'Import receipt profile differs.');
      bindings.push({ roster_id: receipt.rosterId, target_host: host, dataverse_profile_guid: receipt.profileGuid });
    }
  }
  same(local.ids, [...ids].sort((a, b) => a - b), 'Identity census differs from import receipt.');
  same(local.bindings, bindings.sort((a, b) => a.roster_id - b.roster_id), 'Binding census differs from import receipt.');
  check(local.sequence.is_called && local.sequence.last_value >= Math.max(source.sequenceHighWater, ...local.ids), 'Legacy sequence is behind reviewed import.');
}
function baseline({ generation, host, schema, local, metadata, snapshot, review }) {
  const bound = new Set(local.bindings.map(row => row.dataverse_profile_guid));
  return {
    version: 1, generation, targetHost: host, schema, source: local.source, identities: local.ids, bindings: local.bindings,
    sequence: local.sequence, sequenceMetadata: metadata.sequence, originalFeedbackFK: metadata.feedbackFK,
    sourceHash: review.importReceipt.sourceHash, mappingHash: review.importReceipt.mappingHash,
    boundProfiles: snapshot.profiles.filter(row => bound.has(row.profileGuid)),
    unboundProfiles: snapshot.profiles.filter(row => !bound.has(row.profileGuid)).map(({ profileGuid, values }) => ({
      profileGuid, creationKey: values.wmkf_creationkey, etag: values['@odata.etag'],
    })),
  };
}
function assertNoFreeze(client) {
  return client.query(`SELECT 1 FROM pg_trigger WHERE tgrelid='expertise_roster'::regclass AND NOT tgisinternal
    UNION ALL SELECT 1 FROM pg_proc WHERE pronamespace=current_schema()::regnamespace AND proname='roster_rehearsal_frozen'`)
    .then(result => check(!result.rowCount, 'Unexpected legacy roster freeze or trigger.'));
}
function verifyManifest(manifest, state, host, schema) {
  check(manifest && manifest.targetHost === host && manifest.schema === schema &&
    manifest.generation === state.generation && fingerprint(manifest) === state.baseline_hash,
  'Private manifest differs from the committed generation.');
}
function verifyFrozenSource(local, metadata, manifest, exactBridge) {
  same(local.source, manifest.source, 'Frozen legacy source changed.');
  same(local.sequence, manifest.sequence, 'Frozen legacy sequence changed.');
  same(metadata.sequence, manifest.sequenceMetadata, 'Frozen legacy sequence metadata changed.');
  check(local.refs.missing_identity === 0 && (!exactBridge || local.refs.missing_source === 0), 'Feedback references are incomplete.');
  if (exactBridge) {
    same(local.ids, manifest.identities, 'Prepared identity census changed.');
    same(local.bindings, manifest.bindings, 'Prepared binding census changed.');
  } else {
    check(manifest.identities.every(id => local.ids.includes(id)) &&
      manifest.bindings.every(row => local.bindings.some(actual => fingerprint(actual) === fingerprint(row))),
    'Prepared bindings or identities are missing.');
  }
}

async function verifyLegacyProjection(client) {
  const { rows: columns } = await client.query(`
    SELECT a.attname AS name, format_type(a.atttypid,a.atttypmod) AS type, a.attnotnull AS required
      FROM pg_attribute a
     WHERE a.attrelid='expertise_roster'::regclass AND a.attnum>0 AND NOT a.attisdropped
     ORDER BY a.attname`);
  const types = {
    id: 'integer', is_active: 'boolean', dataverse_contact_id: 'uuid',
    created_at: 'timestamp without time zone', updated_at: 'timestamp without time zone',
    created_by: 'integer', updated_by: 'integer',
  };
  const expected = [...managedFields, 'id', 'created_at', 'updated_at', 'created_by', 'updated_by']
    .map(name => ({ name, required: ['id', 'name', 'role_type'].includes(name),
      type: types[name] ?? (legacyWidths[name] ? `character varying(${legacyWidths[name]})` : 'text') }));
  same(Object.fromEntries(columns.map(row => [row.name, row])), Object.fromEntries(expected.map(row => [row.name, row])),
    'Unexpected legacy column layout.');
  const { rows: indexes } = await client.query(`
    SELECT c.relname AS name, i.indisvalid AND i.indisready AS usable,
           i.indnkeyatts AS keys, i.indnatts AS columns, pg_get_indexdef(i.indexrelid,1,false) AS key,
           pg_get_expr(i.indpred,i.indrelid) AS predicate
      FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
     WHERE i.indrelid='expertise_roster'::regclass AND i.indisunique AND NOT i.indisprimary`);
  same(indexes, [{ name: 'idx_expertise_roster_active_contact', usable: true, keys: 1, columns: 1,
    key: 'dataverse_contact_id', predicate: '((dataverse_contact_id IS NOT NULL) AND (is_active = true))' }],
  'Unexpected legacy active Contact index.');
}

function boundProfile(profile) {
  const values = profile?.values;
  check(values && creationKey(values.wmkf_creationkey) && [0, 1].includes(values.statecode) &&
    typeof values.wmkf_leadpdeligible === 'boolean' &&
    ['wmkf_staffuser', 'wmkf_contactguid'].every(key => values[key] === null || contract.guid(values[key])) &&
    contract.TEXT.every(field => {
      const value = values[contract.column(field)];
      return value === null || typeof value === 'string';
    }), 'Invalid or missing bound Dataverse profile.');
  const { id, profile_guid, etag, updated_at, ...fields } = contract.decode({
    ...values, wmkf_expertiseprofileid: profile.profileGuid, _wmkf_staffuser_value: values.wmkf_staffuser,
  });
  try {
    return contract.normalize(fields, fields);
  } catch {
    check(false, 'Invalid bound Dataverse profile fields.');
  }
}
function auditTimestamp(value) {
  const parts = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/.exec(value);
  check(parts, 'Invalid Dataverse audit timestamp.');
  const [, y, m, d, h, min, sec, fraction = ''] = parts;
  const year = Number(y), month = Number(m);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  check(year > 0 && month >= 1 && month <= 12 && Number(d) >= 1 && Number(d) <= days[month - 1] &&
    Number(h) <= 23 && Number(min) <= 59 && Number(sec) <= 59 && !/[1-9]/.test(fraction.slice(6)),
  'Invalid Dataverse audit timestamp.');
  return `${y}-${m}-${d}T${h}:${min}:${sec}.${fraction.slice(0, 6).padEnd(6, '0')}Z`;
}
const projectionOf = row => Object.fromEntries(managedFields.map(field => [field, row[field]]));
const activeContact = row => row?.is_active ? row.dataverse_contact_id : null;
function reconcile({ local, manifest, snapshot, host, highWater }) {
  const current = new Map(snapshot.profiles.map(row => [row.profileGuid, row]));
  const baselineBound = new Map(manifest.boundProfiles.map(row => [row.profileGuid, row]));
  const quarantine = new Map(manifest.unboundProfiles.map(row => [row.profileGuid, row.creationKey]));
  const bound = new Set(local.bindings.map(row => row.dataverse_profile_guid));
  const originals = new Map(local.source.map(row => [row.id, row]));
  const final = new Map(originals);
  const changes = [];
  for (const profile of current.values()) {
    check(bound.has(profile.profileGuid) || quarantine.get(profile.profileGuid) === profile.values.wmkf_creationkey,
      'New unbound Dataverse profile requires reconciliation before rollback.');
  }
  for (const binding of local.bindings) {
    const { roster_id: id, target_host: targetHost, dataverse_profile_guid: guid } = binding;
    const prior = baselineBound.get(guid), profile = current.get(guid), original = originals.get(id);
    check(targetHost === host && profile && (!original || prior) &&
      (!prior || prior.values.wmkf_creationkey === profile.values.wmkf_creationkey), 'Missing or changed Dataverse profile binding.');
    const next = boundProfile(profile);
    let merged = { id, ...projectionOf(next) };
    if (original) {
      const before = boundProfile(prior);
      check(before.dataverse_user_id === next.dataverse_user_id, 'Changed Dataverse User link cannot be restored to legacy.');
      check(before.lead_pd_eligible === next.lead_pd_eligible ||
        (before.lead_pd_eligible && !next.lead_pd_eligible && !next.is_active), 'Changed lead eligibility cannot be restored to legacy.');
      merged = { id, ...projectionOf(original) };
      for (const field of managedFields) {
        if (next[field] !== before[field]) merged[field] = next[field];
      }
    } else {
      check(!next.dataverse_user_id && !next.lead_pd_eligible, 'New legacy row has unsupported User or lead eligibility values.');
    }
    final.set(id, merged);
    const fields = original ? managedFields.filter(field => merged[field] !== original[field]) : managedFields;
    if (!fields.length) continue;
    if (!original || fields.includes('preferred_email')) {
      const email = merged.preferred_email;
      check(email === null || email === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'Preferred email is invalid for legacy.');
      check(!merged.dataverse_contact_id || !email, 'Preferred email conflicts with a retained legacy Contact link.');
    }
    const modified = auditTimestamp(profile.values.modifiedon);
    const created = original ? null : auditTimestamp(profile.values.createdon);
    check(!created || created <= modified, 'Invalid Dataverse audit timestamp order.');
    changes.push({ original, merged, fields, created, modified });
  }
  const contacts = new Set();
  for (const row of final.values()) {
    check(typeof row.name === 'string' && row.name.trim() && Object.hasOwn(contract.CATEGORIES, row.role_type) &&
      typeof row.is_active === 'boolean' && (row.dataverse_contact_id === null || contract.guid(row.dataverse_contact_id)),
    'Invalid legacy column value.');
    for (const field of ['name', 'role_type', ...contract.TEXT]) {
      const value = row[field];
      check(value === null || (typeof value === 'string' && !value.includes('\0') &&
        (!legacyWidths[field] || Array.from(value).length <= legacyWidths[field])), 'Value exceeds its legacy column limit.');
    }
    const contact = activeContact(row);
    if (contact) {
      check(!contacts.has(contact), 'Duplicate active Contact link in restored legacy roster.');
      contacts.add(contact);
    }
  }
  const nextLegacyId = Math.max(local.sequence.last_value, manifest.sequence.last_value, highWater, 0,
    ...local.ids, ...final.keys()) + 1;
  check(Number.isSafeInteger(nextLegacyId) && nextLegacyId > 0 && nextLegacyId <= maxId, 'Legacy sequence exhausted.');
  const insertedRows = changes.filter(change => !change.original).length;
  return { changes, final, result: { changedRows: changes.length - insertedRows, insertedRows, nextLegacyId } };
}
async function readLegacyAudit(client) {
  return (await client.query(`SELECT id, created_by, updated_by,
    created_at::text AS created_at, updated_at::text AS updated_at FROM expertise_roster ORDER BY id`)).rows;
}
async function applyRollback(client, schema, manifest, plan) {
  const { changes, final, result: { nextLegacyId } } = plan;
  const originalAudit = await readLegacyAudit(client);
  const audit = new Map(originalAudit.map(row => [row.id, row]));
  await removeFreeze(client);
  const released = new Set(changes.filter(({ original, merged }) =>
    activeContact(original) && activeContact(original) !== activeContact(merged)).map(({ merged }) => merged.id));
  if (released.size) await client.query('UPDATE expertise_roster SET dataverse_contact_id=NULL WHERE id=ANY($1::int[])', [[...released]]);
  for (const { original, merged, fields, created, modified } of changes) {
    const id = merged.id;
    const modifiedSql = `$${fields.length + 2}::timestamptz AT TIME ZONE 'UTC'`;
    let saved;
    if (original) {
      const updates = released.has(id) && !fields.includes('dataverse_contact_id') ? [...fields, 'dataverse_contact_id'] : fields;
      saved = await client.query(`UPDATE expertise_roster SET
        ${updates.map((field, i) => `${field}=$${i + 2}`).join(',')},
        updated_by=NULL, updated_at=$${updates.length + 2}::timestamptz AT TIME ZONE 'UTC'
        WHERE id=$1`, [id, ...updates.map(field => merged[field]), modified]);
    } else {
      saved = await client.query(`INSERT INTO expertise_roster
        (id,${fields.join(',')},created_at,updated_at,created_by,updated_by)
        VALUES ($1,${fields.map((field, i) => `$${i + 2}`).join(',')},
          $${fields.length + 3}::timestamptz AT TIME ZONE 'UTC',${modifiedSql},NULL,NULL)`,
      [id, ...fields.map(field => merged[field]), modified, created]);
    }
    check(saved.rowCount === 1, 'Legacy reconciliation write count changed.');
    const { rows: [stamps] } = await client.query(`SELECT
      ($1::timestamptz AT TIME ZONE 'UTC')::text AS modified,
      ($2::timestamptz AT TIME ZONE 'UTC')::text AS created`, [modified, created]);
    audit.set(id, { id, created_by: original ? audit.get(id).created_by : null, updated_by: null,
      created_at: original ? audit.get(id).created_at : stamps.created, updated_at: stamps.modified });
  }
  await client.query(`ALTER TABLE consultant_feedback DROP CONSTRAINT ${quoted(bridgeFK)}`);
  await client.query(`ALTER TABLE consultant_feedback ADD CONSTRAINT ${quoted(oldFK)}
    FOREIGN KEY (consultant_roster_id) REFERENCES expertise_roster(id)`);
  const restored = await catalog(client, schema, false);
  same(restored.feedbackFK, manifest.originalFeedbackFK, 'Restored feedback foreign key differs.');
  await assertNoFreeze(client);
  await client.query(`ALTER SEQUENCE expertise_roster_id_seq RESTART WITH ${nextLegacyId}`);
  const local = await localSnapshot(client);
  same(local.sequence, { last_value: nextLegacyId, is_called: false }, 'Legacy sequence restart differs.');
  const expected = [...final].sort(([a], [b]) => a - b).map(([id, row]) => ({ id, ...projectionOf(row) }));
  same(local.source.map(row => ({ id: row.id, ...projectionOf(row) })), expected, 'Restored legacy roster differs.');
  same(await readLegacyAudit(client), [...audit.values()].sort((a, b) => a.id - b.id), 'Restored legacy audit differs.');
}

async function runCutover({ env, schema, phase, acknowledge, manifestPath, receiptPath, readTarget, review, connect, execute = false }) {
  assertOperationalSchema(schema);
  check(Object.hasOwn(actions, phase), 'An explicit rehearsal phase is required.');
  const { host } = target.assertTarget(env);
  check(!env.VERCEL_ENV && env.NODE_ENV !== 'production', 'Operational phases are local rehearsal only.');
  check(!execute || acknowledge === host, 'Exact registered sandbox acknowledgement required.');
  const manifestFile = privatePath(manifestPath);
  const receiptFile = execute ? privatePath(receiptPath) : null;
  check(!execute || receiptFile !== manifestFile, 'Manifest and receipt paths must be different.');
  const evidence = review && structuredClone(review);
  const fd = execute ? fs.openSync(receiptFile, 'wx', 0o600) : null;
  const record = result => { if (fd !== null) save(fd, result); };
  let session, transaction = false, committing = false, committed = false;
  try {
    record({ phase, schema, status: 'started' });
    if (receiptFile) syncParent(receiptFile);
    const lifecycle = createLifecycle({ env, schema, connect });
    session = await lifecycle.open({ operational: true, exclusive: true });
    const { client } = session;
    const initial = await readState(client, host);
    const action = actions[phase];
    const observed = initial?.phase === action.to;
    if (observed && action.to === 'legacy') {
      check(initial.terminal_action === phase, 'Requested terminal action differs from the committed action.');
    }
    check(observed || (initial?.phase ?? null) === action.from, 'Requested phase is incompatible with current state.');
    check(!initial || !Object.keys(initial.pending).length, 'Unsettled roster write intents prevent phase transition.');
    const original = readManifest(manifestFile);
    if (initial) verifyManifest(original, initial, host, schema);
    const rollingBack = phase === 'rollback' && !observed;
    const needsCensus = phase === 'prepare' || (phase === 'activate' && !observed) || rollingBack;
    const readCensus = async () => census(await (rollingBack ? readTarget({ includeAuditTimestamps: true }) : readTarget()), host);
    const first = needsCensus ? await readCensus() : null;
    await client.query('BEGIN');
    transaction = true;
    await client.query('LOCK TABLE expertise_roster, expertise_roster_identity, expertise_roster_binding, consultant_feedback IN ACCESS EXCLUSIVE MODE');
    const state = await readState(client, host, { lock: true });
    same(state, initial, 'Lifecycle state changed during phase admission.');
    const identityFK = state?.phase === 'active' || state?.phase === 'paused';
    const metadata = await catalog(client, schema, identityFK);
    const local = await localSnapshot(client);
    if (!state || state.phase === 'legacy') await assertNoFreeze(client);
    else await verifyFreeze(client);
    if (state) {
      if (state.phase !== 'legacy') verifyFrozenSource(local, metadata, original, !identityFK);
      if (!identityFK) same(metadata.feedbackFK, original.originalFeedbackFK, 'Legacy feedback foreign key changed.');
      check(!identityFK || state.high_water >= Math.max(local.sequence.last_value, 0, ...local.ids), 'Allocator high-water is behind reserved identities.');
    }
    let manifest = original;
    if (phase === 'prepare') {
      check(local.refs.missing_source === 0 && local.refs.missing_identity === 0, 'Feedback references are incomplete.');
      reviewImport(evidence, first, local, host);
      manifest = baseline({ generation: original?.generation ?? randomUUID(), host, schema, local, metadata, snapshot: first, review: evidence });
      if (original) same(manifest, original, 'Existing private manifest differs from verified preparation.');
    }
    if (phase === 'activate' && !observed) {
      const current = baseline({ generation: original.generation, host, schema, local, metadata, snapshot: first,
        review: { importReceipt: { sourceHash: original.sourceHash, mappingHash: original.mappingHash } } });
      same(current, original, 'Prepared Dataverse census or bridge changed.');
    }
    const highWater = phase === 'activate' && !observed
      ? Math.max(local.sequence.last_value, 0, ...local.source.map(row => row.id), ...local.ids)
      : state?.high_water ?? 0;
    check(highWater >= 0 && highWater <= maxId && (phase !== 'activate' || observed || highWater < maxId), 'Invalid or exhausted allocator high-water.');
    let rollbackPlan;
    if (rollingBack) {
      await verifyLegacyProjection(client);
      rollbackPlan = reconcile({ local, manifest: original, snapshot: first, host, highWater });
      const { rowCount } = await client.query(`SELECT 1 FROM consultant_feedback
        WHERE consultant_roster_id IS NOT NULL AND NOT (consultant_roster_id=ANY($1::int[])) LIMIT 1`,
      [[...rollbackPlan.final.keys()]]);
      check(rowCount === 0, 'Feedback references cannot be restored to legacy.');
    }
    if (execute && !observed) {
      if (phase === 'prepare') {
        if (!original) writeManifest(manifestFile, manifest);
        await installFreeze(client);
        await client.query(CONTROL_DDL);
        await client.query(`INSERT INTO expertise_roster_cutover
          (target_host,phase,generation,baseline_hash,high_water) VALUES($1,'prepared',$2,$3,0)`,
        [host, manifest.generation, fingerprint(manifest)]);
      } else {
        if (phase === 'activate') {
          await client.query(`ALTER TABLE consultant_feedback DROP CONSTRAINT ${quoted(oldFK)}`);
          await client.query(`ALTER TABLE consultant_feedback ADD CONSTRAINT ${quoted(bridgeFK)}
            FOREIGN KEY (consultant_roster_id) REFERENCES expertise_roster_identity(id)`);
          await catalog(client, schema, true);
        }
        if (phase === 'abort') await removeFreeze(client);
        if (rollingBack) await applyRollback(client, schema, original, rollbackPlan);
        const result = await client.query(`UPDATE expertise_roster_cutover SET phase=$1,high_water=$2,terminal_action=$6
          WHERE target_host=$3 AND generation=$4 AND phase=$5 AND pending='{}'::jsonb`,
        [action.to, highWater, host, state.generation, action.from, action.to === 'legacy' ? phase : null]);
        check(result.rowCount === 1, 'Lifecycle transition lost its expected state.');
      }
    }
    if (needsCensus) same(await readCensus(), first, 'Dataverse census changed during the phase.');
    session.alive();
    if (execute && !observed) {
      committing = true;
      await client.query('COMMIT');
      committed = true;
    } else await client.query('ROLLBACK');
    transaction = false;
    const result = { phase, schema, status: observed ? 'observed' : execute ? 'committed' : 'dry-run',
      currentPhase: execute || observed ? action.to : state?.phase ?? null,
      intendedPhase: action.to, generation: manifest?.generation ?? null, highWater, ...rollbackPlan?.result };
    record(result);
    return result;
  } catch (error) {
    if (transaction) await session.client.query('ROLLBACK').catch(() => {});
    record({ phase, schema, status: committed ? 'committed' : committing ? 'commit-unknown' : 'refused', message: outcome(error) });
    throw error;
  } finally {
    try { if (session) await session.close().catch(() => {}); } finally { if (fd !== null) fs.closeSync(fd); }
  }
}

module.exports = { runCutover };
