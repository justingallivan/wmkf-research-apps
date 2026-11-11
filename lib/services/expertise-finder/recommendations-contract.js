/** Pure input and output contract for the future expertise recommendations task. */
import { createHash } from 'node:crypto';
import { buildRosterV2Variables } from '../../../shared/config/prompts/expertise-finder-roster-v2';
import { rosterMatchSchema, validateRosterMatch } from './roster-match-validation';
import roster from './roster-contract.cjs';

export const RECOMMENDATIONS_CONTRACT_VERSION = 'expertise-recommendations-v1';
const fingerprintVersion = 'expertise-roster-fingerprint-v1';
const maxRecordBytes = 64_000;
// The shared compiler still checks the full sealed snapshot including document bytes.
const maxSnapshotBytes = 4_194_304;
const maxResultBytes = 128 * 1024;
const warning = 'An invalid roster profile was excluded from matching.';
const staffCategory = 'Research Program Staff';
const profileFields = ['name', 'role_type', 'is_active', 'lead_pd_eligible',
  'dataverse_user_id', 'dataverse_contact_id', ...roster.TEXT];
const manifestFields = ['contractVersion', 'fingerprintVersion', 'profiles', 'candidateUsers', 'eligibleLeadGuids'];
const hashPattern = /^[a-f0-9]{64}$/;
const collator = new Intl.Collator('en-US');

function plain(value) {
  return value !== null && typeof value === 'object' &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function exact(value, keys) {
  return plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (plain(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function encode(value) { return JSON.stringify(canonical(value)); }
function hash(value) { return createHash('sha256').update(encode(value)).digest('hex'); }
function byteSize(value) { return Buffer.byteLength(encode(value)); }
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function assertInput(ok, message) {
  if (!ok) throw Object.assign(new Error(message), { code: 'expertise_roster_snapshot_invalid' });
}
function assertOutput(ok, message) {
  if (!ok) throw Object.assign(new Error(message), { code: 'profile_output_invalid' });
}
function validEtag(value) { return typeof value === 'string' && /^W\/"\d+"$/.test(value) && value.length <= 100; }
function byGuid(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
function byRosterOrder(a, b) {
  return collator.compare(a.role_type, b.role_type) || collator.compare(a.name, b.name) ||
    byGuid(a.profile_guid, b.profile_guid);
}
function leadCandidate(fields) {
  return fields.role_type === staffCategory && fields.is_active === true &&
    fields.lead_pd_eligible === true && roster.guid(fields.dataverse_user_id);
}

function profileProjection(profile) {
  assertInput(plain(profile) && roster.guid(profile.profile_guid) && validEtag(profile.etag),
    'Roster profile identity or ETag is missing or invalid.');
  assertInput(profileFields.every(key => Object.hasOwn(profile, key) && profile[key] !== undefined),
    'Roster profile projection is incomplete.');
  const fields = Object.fromEntries(profileFields.map(key => [key, profile[key]]));
  let normalized;
  try {
    normalized = roster.normalize(fields, fields);
  } catch {
    // Invalid rows still have a stable manifest identity and conservative ETag.
    // Keep unsupported private value types out of the serializable manifest.
    const hashFields = Object.fromEntries(Object.entries(fields).map(([key, value]) => [
      key, value === null || ['string', 'boolean'].includes(typeof value) || Number.isFinite(value)
        ? value : { invalidType: typeof value },
    ]));
    return {
      row: null,
      entry: {
        profileGuid: profile.profile_guid,
        etag: profile.etag,
        category: typeof fields.role_type === 'string' && Object.hasOwn(roster.CATEGORIES, fields.role_type)
          ? fields.role_type : null,
        active: typeof fields.is_active === 'boolean' ? fields.is_active : null,
        leadEligible: typeof fields.lead_pd_eligible === 'boolean' ? fields.lead_pd_eligible : null,
        userGuid: roster.guid(fields.dataverse_user_id) ? fields.dataverse_user_id : null,
        valid: false,
        fieldHash: hash(hashFields),
      },
    };
  }
  const row = { profile_guid: profile.profile_guid, etag: profile.etag, ...normalized };
  return {
    row,
    entry: {
      profileGuid: row.profile_guid, etag: row.etag, category: row.role_type, active: row.is_active,
      leadEligible: row.lead_pd_eligible, userGuid: row.dataverse_user_id, valid: true, fieldHash: hash(normalized),
    },
  };
}

function candidateStates(rows, users) {
  const candidates = rows.filter(leadCandidate);
  const ids = new Set(candidates.map(row => row.dataverse_user_id));
  assertInput(ids.size === candidates.length, 'Duplicate roster candidate User link.');
  const states = new Map();
  for (const user of users) {
    assertInput(exact(user, ['userGuid', 'disabled']) && ids.has(user.userGuid) &&
      typeof user.disabled === 'boolean' && !states.has(user.userGuid),
    'A candidate User state is invalid, duplicated, or unexpected.');
    states.set(user.userGuid, user.disabled);
  }
  assertInput(states.size === ids.size, 'Candidate User states are incomplete.');
  const candidateUsers = [...states].sort(([a], [b]) => byGuid(a, b)).map(([userGuid, disabled]) => ({ userGuid, disabled }));
  const eligibleLeadGuids = rows.filter(row => leadCandidate(row) && states.get(row.dataverse_user_id) === false)
    .map(row => row.profile_guid);
  return { candidateUsers, eligibleLeadGuids };
}

function rosterRecord(snapshot) {
  const { roster_block: value } = buildRosterV2Variables({ rosterMembers: snapshot.rows, leadGuids: snapshot.leadGuids });
  const record = { name: 'roster_block', present: true, value,
    provenance: `${RECOMMENDATIONS_CONTRACT_VERSION}:${snapshot.manifest.rosterHash}` };
  assertInput(byteSize(record) <= maxRecordBytes, 'Encoded roster record exceeds its byte limit.');
  return record;
}

/**
 * The future trusted adapter asserts completeness after paging. This builder
 * expects an exact User read set for valid active lead candidates, including
 * disabled Users. It does not fetch data or establish read completeness.
 */
export function buildRecommendationsSnapshot({ complete, profiles, users } = {}) {
  assertInput(complete === true && Array.isArray(profiles) && Array.isArray(users),
    'A complete roster and candidate User projection is required.');
  const rows = [], entries = [], warnings = [], seen = new Set();
  for (const profile of profiles) {
    const { row, entry } = profileProjection(profile);
    assertInput(!seen.has(entry.profileGuid), 'Duplicate roster profile identity.');
    seen.add(entry.profileGuid);
    entries.push(entry);
    if (!row) warnings.push(warning);
    else if (row.is_active) rows.push(row);
  }
  rows.sort(byRosterOrder);
  entries.sort((a, b) => byGuid(a.profileGuid, b.profileGuid));
  const { candidateUsers, eligibleLeadGuids } = candidateStates(rows, users);
  const contractVersion = RECOMMENDATIONS_CONTRACT_VERSION;
  const manifest = { contractVersion, fingerprintVersion, profiles: entries, candidateUsers, eligibleLeadGuids };
  const snapshot = {
    contractVersion, rows, leadGuids: eligibleLeadGuids, warnings,
    manifest: { ...manifest, rosterHash: hash(manifest) },
  };
  assertInput(byteSize(snapshot) <= maxSnapshotBytes, 'Private roster snapshot exceeds its byte limit.');
  const record = rosterRecord(snapshot);
  return freeze({ snapshot, rosterBlock: record.value, rosterRecord: record });
}

/**
 * The caller owns authorization, contract version, expiry and complete fresh reads.
 * Compare only the retained hash and current projection, without a clock or I/O.
 */
export function compareRecommendationsRosterFreshness({ expectedRosterHash, current } = {}) {
  if (typeof expectedRosterHash !== 'string' || expectedRosterHash.length !== 64 || !hashPattern.test(expectedRosterHash)) {
    return { freshness: 'unknown' };
  }
  try {
    const { snapshot } = buildRecommendationsSnapshot(current);
    return { freshness: snapshot.manifest.rosterHash === expectedRosterHash ? 'current' : 'stale' };
  } catch {
    return { freshness: 'unknown' };
  }
}

/** Revalidate a deserialized extension against its typed roster and manifest. */
export function rebuildRecommendationsRosterBlock(snapshot) {
  assertInput(exact(snapshot, ['contractVersion', 'rows', 'leadGuids', 'warnings', 'manifest']) &&
    snapshot.contractVersion === RECOMMENDATIONS_CONTRACT_VERSION && Array.isArray(snapshot.rows) &&
    Array.isArray(snapshot.leadGuids) && Array.isArray(snapshot.warnings), 'Unsupported or invalid roster snapshot.');
  const manifest = snapshot.manifest;
  assertInput(exact(manifest, [...manifestFields, 'rosterHash']) &&
    manifest.contractVersion === RECOMMENDATIONS_CONTRACT_VERSION && manifest.fingerprintVersion === fingerprintVersion &&
    Array.isArray(manifest.profiles) && Array.isArray(manifest.candidateUsers) && Array.isArray(manifest.eligibleLeadGuids),
  'Unsupported or invalid roster manifest.');
  const profiles = new Map();
  let previous = '';
  let invalid = 0;
  for (const entry of manifest.profiles) {
    assertInput(exact(entry, ['profileGuid', 'etag', 'category', 'active', 'leadEligible', 'userGuid', 'valid', 'fieldHash']) &&
      roster.guid(entry.profileGuid) && entry.profileGuid > previous && validEtag(entry.etag) &&
      typeof entry.valid === 'boolean' && typeof entry.fieldHash === 'string' && hashPattern.test(entry.fieldHash) &&
      (entry.category === null || (typeof entry.category === 'string' && Object.hasOwn(roster.CATEGORIES, entry.category))) &&
      (entry.active === null || typeof entry.active === 'boolean') &&
      (entry.leadEligible === null || typeof entry.leadEligible === 'boolean') &&
      (entry.userGuid === null || roster.guid(entry.userGuid)), 'Invalid or duplicate roster manifest profile.');
    if (entry.valid) {
      assertInput(entry.category !== null && entry.active !== null && entry.leadEligible !== null &&
        (entry.category === staffCategory || entry.userGuid === null) &&
        (!entry.leadEligible || (entry.category === staffCategory && entry.active && entry.userGuid)),
      'Invalid roster manifest eligibility.');
      if (entry.active) profiles.set(entry.profileGuid, entry);
    } else invalid++;
    previous = entry.profileGuid;
  }
  assertInput(snapshot.rows.length === profiles.size && encode(snapshot.warnings) === encode(Array(invalid).fill(warning)), 'Roster snapshot and manifest membership differ.');
  let previousRow;
  for (const input of snapshot.rows) {
    const { row, entry } = profileProjection(input);
    const saved = profiles.get(entry.profileGuid);
    assertInput(row && exact(input, ['profile_guid', 'etag', ...profileFields]) && encode(input) === encode(row) &&
      saved && encode(saved) === encode(entry) && (!previousRow || byRosterOrder(previousRow, row) < 0),
    'Roster snapshot row differs from its manifest.');
    profiles.delete(entry.profileGuid);
    previousRow = row;
  }
  const { candidateUsers, eligibleLeadGuids } = candidateStates(snapshot.rows, manifest.candidateUsers);
  assertInput(encode(candidateUsers) === encode(manifest.candidateUsers) &&
    encode(eligibleLeadGuids) === encode(manifest.eligibleLeadGuids) &&
    encode(eligibleLeadGuids) === encode(snapshot.leadGuids), 'Roster snapshot lead eligibility differs.');
  const { rosterHash, ...hashed } = manifest;
  assertInput(hash(hashed) === rosterHash && byteSize(snapshot) <= maxSnapshotBytes,
    'Roster snapshot fingerprint or byte limit differs.');
  return rosterRecord(snapshot).value;
}

function validateClosed(value, schema) {
  if (value === null) return schema.nullable === true;
  switch (schema.type) {
    case 'object':
      return plain(value) &&
        Object.keys(value).every(key => Object.hasOwn(schema.fields, key) && validateClosed(value[key], schema.fields[key])) &&
        Object.entries(schema.fields).every(([key, child]) => child.required === false || Object.hasOwn(value, key));
    case 'array':
      if (!Array.isArray(value) || (schema.maxItems != null && value.length > schema.maxItems) || Object.keys(value).length !== value.length) return false;
      for (let index = 0; index < value.length; index++) {
        if (!Object.hasOwn(value, index) || !validateClosed(value[index], schema.of)) return false;
      }
      return true;
    case 'string':
      return typeof value === 'string' && (schema.maxLength == null || value.length <= schema.maxLength) &&
        (!schema.enum || schema.enum.includes(value));
    case 'boolean':
      return typeof value === 'boolean';
    default:
      return false;
  }
}

export function validateRecommendationsOutput(value, { snapshot, rosterBlock } = {}) {
  let rebuilt;
  try {
    rebuilt = rebuildRecommendationsRosterBlock(snapshot);
  } catch {
    assertOutput(false, 'The frozen roster snapshot is invalid.');
  }
  assertOutput(typeof rosterBlock === 'string' && rosterBlock === rebuilt, 'The visible roster differs from the frozen roster.');
  assertOutput(validateClosed(value, rosterMatchSchema), 'Recommendations output does not match the closed schema.');
  assertOutput(byteSize(value) <= maxResultBytes, 'Recommendations output exceeds its byte limit.');
  const { primary, secondary } = value.staff_assignment;
  assertOutput(!primary || !secondary || primary.profile_guid !== secondary.profile_guid,
    'Recommendations output repeats the same lead identity.');
  let result;
  try {
    result = validateRosterMatch(value, snapshot);
  } catch {
    assertOutput(false, 'Recommendations contain an unavailable or ineligible profile identity.');
  }
  const encoded = encode(result);
  assertOutput(Buffer.byteLength(encoded) <= maxResultBytes, 'Canonical recommendations exceed their byte limit.');
  return JSON.parse(encoded);
}
