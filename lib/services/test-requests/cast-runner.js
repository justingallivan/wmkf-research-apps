/**
 * Synthetic cast runner (docs/plans/TEST_REQUEST_FACTORY_CAST_AND_STATUS_PLAN_2026-09-28.md,
 * Design A, slice A): creates the reused synthetic PI contact, Liaison
 * contact and suggested-reviewer person in one Dataverse environment, once,
 * and reads them back for later clones. Owner-run through the CLI, so no
 * lease: the ledger's unique (environment, role) refuses a second plan.
 *
 * Ownership is by journal, not by lookup. Before a member is created, every
 * existing contact or person that matches its address or its name pair is an
 * ownership collision and the mode stops, adopting nothing. The GUID is
 * preallocated and journaled (`planned` → `dispatched`) before the POST names
 * it; the POST goes through `fenceCastCreateClient`; the row is then read back
 * by that GUID with a strict projection. A lost or failed POST is recovered
 * only by that read, never by re-POSTing. A read that itself fails leaves the
 * member `dispatched` so the same command resumes it.
 *
 * The client is the raw `lib/dataverse/client.js` instance; the person POST
 * carries `wmkf_issyntheticreviewer: true`, so the CLI must build it with
 * `createClient({ allowTestRequestMarkerWrites: true })` (the sanctioned
 * marker writer, see reviews-sandbox-deps.js). Addresses are supplied at run
 * time and never stored: the ledger holds a digest, summaries hold none.
 */
import crypto from 'node:crypto';
import * as odata from '../../dataverse/core/odata.js';
import { PRODUCTION_HOSTS, SANDBOX_HOSTS } from '../../dataverse/core/target-registry.js';
import { SYNTHETIC_NAME_PREFIX, isSyntheticNameDerived } from '../reviewer-engagement/seed-synthetic-review.js';
import { guidEqual } from './basic-clone-steps.js';
import { decideRecipients, isFoundationAddress, normalizeAddress } from './email-allowlist.js';
import { fenceCastCreateClient } from './production-write-fence.js';
import { CAST_ROLES, reviewerAddressSha256 } from './run-ledger.js';

/** Roles in creation order. */
export const CAST_ROLE_ORDER = Object.freeze(['pi', 'liaison', 'suggested_reviewer']);

/** Factory default display names, shown to the owner before any write. */
export const CAST_DEFAULT_NAMES = Object.freeze({
  pi: Object.freeze({ firstName: `${SYNTHETIC_NAME_PREFIX}Factory`, lastName: 'PI' }),
  liaison: Object.freeze({ firstName: `${SYNTHETIC_NAME_PREFIX}Factory`, lastName: 'Liaison' }),
  suggested_reviewer: Object.freeze({ firstName: `${SYNTHETIC_NAME_PREFIX}Factory`, lastName: 'Reviewer' }),
});

const TARGETS = Object.freeze({
  contact: Object.freeze({
    set: '/contacts', id: 'contactid', first: 'firstname', last: 'lastname', email: 'emailaddress1',
    select: ['contactid', 'firstname', 'lastname', 'emailaddress1', 'statecode', '_parentcustomerid_value'],
  }),
  wmkf_potentialreviewers: Object.freeze({
    set: '/wmkf_potentialreviewerses', id: 'wmkf_potentialreviewersid', first: 'wmkf_firstname', last: 'wmkf_lastname', email: 'wmkf_emailaddress',
    select: ['wmkf_potentialreviewersid', 'wmkf_firstname', 'wmkf_lastname', 'wmkf_emailaddress', 'wmkf_issyntheticreviewer',
      'statecode', 'wmkf_name', '_wmkf_contact_value'],
  }),
});

const CAST_NAME = /^[^\u0000-\u001f\u007f]{1,50}$/;
// Refusals raised before any network call: nothing was sent.
const LOCAL_REFUSAL_CODES = new Set(['create_rejected', 'test_request_marker_immutable']);

function castError(message, code, extra = {}) {
  return Object.assign(new Error(message), { code }, extra);
}

function assertEnvironmentMatchesClient(client, environment) {
  const hosts = { sandbox: SANDBOX_HOSTS, production: PRODUCTION_HOSTS }[environment];
  if (!hosts) throw castError('Cast environment must be sandbox or production.', 'cast_environment_invalid');
  let host = null;
  try { host = new URL(String(client?.baseUrl)).hostname.toLowerCase(); } catch { /* refused below */ }
  if (!host || !hosts.includes(host)) {
    throw castError(`The Dataverse client is not bound to the ${environment} org.`, 'cast_environment_mismatch');
  }
}

/**
 * Pure: normalize and validate the owner-supplied addresses. Each must be a
 * plain address on the Admin → Test Requests allowlist (a plus-tag on a listed
 * address is on it); a Foundation address is refused, since the allowlist
 * never holds one. No two roles may share an address.
 *
 * @param {{ addresses: Record<string, string>, allowlist: Set<string> }} input
 * @returns {Record<string, { address: string, addressSha256: string }>}
 */
export function planCastAddresses({ addresses, allowlist }) {
  if (!(allowlist instanceof Set)) throw castError('The test-Request email allowlist is not loaded.', 'cast_allowlist_unavailable');
  const out = {};
  const seen = new Map();
  for (const role of CAST_ROLE_ORDER) {
    const address = normalizeAddress(addresses?.[role]);
    if (!address) throw castError(`The ${role} address is missing or not a plain email address.`, 'cast_address_invalid', { role });
    let addressSha256;
    try { ({ addressSha256 } = reviewerAddressSha256(address)); } catch {
      throw castError(`The ${role} address is not a plausible email address.`, 'cast_address_invalid', { role });
    }
    if (isFoundationAddress(address) || !decideRecipients([address], allowlist).allowed) {
      throw castError(`The ${role} address is not on the test-Request email allowlist.`, 'cast_address_not_allowlisted', { role });
    }
    if (seen.has(address)) {
      throw castError(`The ${role} and ${seen.get(address)} addresses are the same.`, 'cast_address_duplicate', { role });
    }
    seen.set(address, role);
    out[role] = { address, addressSha256 };
  }
  return out;
}

function assertCastNames(names) {
  const pairs = new Map();
  for (const role of CAST_ROLE_ORDER) {
    const { firstName, lastName } = names?.[role] || {};
    if (!CAST_NAME.test(String(firstName ?? '')) || !CAST_NAME.test(String(lastName ?? ''))) {
      throw castError(`The ${role} name is empty, too long or has control characters.`, 'cast_name_invalid', { role });
    }
    if (!firstName.startsWith(SYNTHETIC_NAME_PREFIX)) {
      throw castError(`The ${role} first name must start with "${SYNTHETIC_NAME_PREFIX}".`, 'cast_name_invalid', { role });
    }
    const key = `${firstName.toLowerCase()}\u0000${lastName.toLowerCase()}`;
    if (pairs.has(key)) throw castError(`The ${role} and ${pairs.get(key)} names are the same.`, 'cast_name_invalid', { role });
    pairs.set(key, role);
  }
}

/** The closed create body the cast fence admits for one member. */
export function buildCastBody({ role, memberId, firstName, lastName, address }) {
  const entity = CAST_ROLES[role];
  if (entity === 'contact') return { contactid: memberId, firstname: firstName, lastname: lastName, emailaddress1: address };
  if (entity === 'wmkf_potentialreviewers') {
    return {
      wmkf_potentialreviewersid: memberId, wmkf_firstname: firstName, wmkf_lastname: lastName,
      wmkf_emailaddress: address, wmkf_issyntheticreviewer: true,
    };
  }
  throw castError(`Unknown cast role ${role}.`, 'cast_role_invalid');
}

/** Row by GUID; null when absent (404); throws when the read itself fails. */
async function readById(client, entity, memberId) {
  const target = TARGETS[entity];
  let response;
  try {
    response = await client.get(`${target.set}(${memberId})?$select=${odata.select(target.select)}`);
  } catch (error) {
    throw castError(`The ${entity} read by GUID failed (${error.message}); run the same command again.`, 'cast_read_failed');
  }
  if (response?.status === 404) return null;
  if (!response?.ok) throw castError(`The ${entity} read by GUID failed (${response?.status ?? 'no status'}); run the same command again.`, 'cast_read_failed');
  const row = response.body || {};
  if (!guidEqual(row[target.id], memberId)) throw castError(`The ${entity} read returned a different row.`, 'cast_read_failed');
  return row;
}

function digestOf(raw) {
  const address = normalizeAddress(raw);
  if (!address) return null;
  try { return reviewerAddressSha256(address).addressSha256; } catch { return null; }
}

/**
 * Field names (never values) where the live row departs from the journaled
 * identity: names, address digest, active, no parent account (contact), or
 * marker-true, Contact-less and prefix-derived name (person).
 */
function mismatchedFields(entity, row, { firstName, lastName, addressSha256 }) {
  const target = TARGETS[entity];
  const out = [];
  if (row[target.first] !== firstName) out.push(target.first);
  if (row[target.last] !== lastName) out.push(target.last);
  if (digestOf(row[target.email]) !== addressSha256) out.push(target.email);
  if (row.statecode !== 0) out.push('statecode');
  if (entity === 'contact') {
    if (row._parentcustomerid_value != null) out.push('_parentcustomerid_value');
  } else {
    if (row.wmkf_issyntheticreviewer !== true) out.push('wmkf_issyntheticreviewer');
    if (row._wmkf_contact_value != null) out.push('_wmkf_contact_value');
    if (!isSyntheticNameDerived(row)) out.push('wmkf_name');
  }
  return out;
}

async function listMatches(client, entity, filter) {
  const target = TARGETS[entity];
  let response;
  try {
    response = await client.get(`${target.set}?$select=${target.id}&$filter=${encodeURIComponent(filter)}&$top=5`);
  } catch (error) {
    throw castError(`The ${entity} collision lookup failed (${error.message}).`, 'cast_lookup_failed');
  }
  if (!response?.ok) throw castError(`The ${entity} collision lookup failed (${response?.status ?? 'no status'}).`, 'cast_lookup_failed');
  const rows = response.body?.value;
  if (!Array.isArray(rows)) throw castError(`The ${entity} collision lookup returned no list.`, 'cast_lookup_failed');
  return rows.map((r) => r[target.id]);
}

/**
 * Ownership-collision check for a member about to be created: any contact or
 * person, in any state, with its address or its exact name pair. Rows the
 * ledger itself journaled in this environment are not collisions.
 */
async function assertNoCollision(client, { role, firstName, lastName, address }, journaledIds) {
  for (const entity of Object.keys(TARGETS)) {
    const target = TARGETS[entity];
    const lookups = [
      ['address', odata.eq(target.email, address)],
      ['name', odata.and([odata.eq(target.first, firstName), odata.eq(target.last, lastName)])],
    ];
    for (const [kind, filter] of lookups) {
      const ids = await listMatches(client, entity, filter);
      if (ids.some((id) => !journaledIds.some((own) => guidEqual(own, id)))) {
        throw castError(`An existing ${entity} matches the ${role} ${kind}; the cast adopts nothing it did not create.`,
          'cast_ownership_collision', { role });
      }
    }
  }
}

function receipt({ exists, matched, recovered }) {
  return { exists, matched, recovered, readAt: new Date().toISOString() };
}

function summaryOf(member, outcome) {
  return { role: member.role, memberId: member.memberId, entity: member.entity, status: member.status, outcome };
}

async function needsAttention(ledger, member, { code, detail, exists }, summary) {
  const marked = await ledger.markCastMemberNeedsAttention({
    memberId: member.memberId, error: `${code}: ${detail}`, readback: receipt({ exists, matched: false, recovered: false }),
  });
  const current = marked || { ...member, status: 'needs_attention' };
  summary.push(summaryOf(current, 'needs_attention'));
  return castError(`The ${member.role} cast member needs attention: ${detail}`, code, { role: member.role, members: summary });
}

/**
 * Settle a dispatched member by reading its journaled GUID. `postFailed`
 * marks a recovery (the POST threw or was refused, or a prior invocation was
 * interrupted). Never POSTs.
 */
async function settleByReadback({ client, ledger, member, expected, recovered, summary }) {
  const row = await readById(client, member.entity, member.memberId);
  if (!row) {
    throw await needsAttention(ledger, member, {
      code: 'cast_create_unverified', exists: false,
      detail: 'the journaled GUID is absent after a create attempt; resolve manually, never re-POST.',
    }, summary);
  }
  const fields = mismatchedFields(member.entity, row, expected);
  if (fields.length) {
    throw await needsAttention(ledger, member, {
      code: 'cast_readback_mismatch', exists: true, detail: `the row at the journaled GUID differs in ${fields.join(', ')}.`,
    }, summary);
  }
  const verified = await ledger.markCastMemberVerified({ memberId: member.memberId, readback: receipt({ exists: true, matched: true, recovered }) });
  if (!verified) throw castError(`The ${member.role} cast member changed state in the ledger.`, 'cast_ledger_conflict', { role: member.role, members: summary });
  summary.push(summaryOf(verified, recovered ? 'recovered' : 'created'));
}

async function createMember({ client, ledger, environment, role, name, planned, summary }) {
  const entity = CAST_ROLES[role];
  const memberId = crypto.randomUUID();
  const member = await ledger.planCastMember({
    memberId, environment, role, firstName: name.firstName, lastName: name.lastName, addressSha256: planned.addressSha256,
  });
  if (!member) throw castError(`The ${role} cast member could not be journaled.`, 'cast_ledger_conflict', { role, members: summary });
  const dispatched = await ledger.markCastMemberDispatched({ memberId });
  if (!dispatched) throw castError(`The ${role} cast member changed state in the ledger.`, 'cast_ledger_conflict', { role, members: summary });

  const fenced = fenceCastCreateClient(client, { members: [{ memberId, entity }] });
  const body = buildCastBody({ role, memberId, firstName: name.firstName, lastName: name.lastName, address: planned.address });
  let failed = false;
  try {
    const response = await fenced.post(TARGETS[entity].set, body);
    failed = !response?.ok;
  } catch (error) {
    if (LOCAL_REFUSAL_CODES.has(error?.code)) {
      throw await needsAttention(ledger, dispatched, {
        code: 'cast_create_refused_locally', exists: false,
        detail: `the create was refused before it was sent (${error.code}); fix the caller, then clear this member.`,
      }, summary);
    }
    failed = true;
  }
  // A 204 is not proof and a failure is not proof of absence: the readback
  // by the journaled GUID decides both.
  await settleByReadback({
    client, ledger, member: dispatched, recovered: failed, summary,
    expected: { firstName: name.firstName, lastName: name.lastName, addressSha256: planned.addressSha256 },
  });
}

async function resolveExisting({ client, ledger, member, summary }) {
  const expected = { firstName: member.firstName, lastName: member.lastName, addressSha256: member.addressSha256 };
  if (member.status === 'verified') {
    const row = await readById(client, member.entity, member.memberId);
    const fields = row ? mismatchedFields(member.entity, row, expected) : ['(absent)'];
    if (fields.length) {
      throw castError(`The verified ${member.role} cast member no longer matches (${fields.join(', ')}); resolve manually.`,
        'cast_member_drifted', { role: member.role, members: summary });
    }
    summary.push(summaryOf(member, 'reused'));
    return;
  }
  // planned or dispatched: a prior invocation stopped before verifying.
  // Recover strictly by the journaled GUID, never by re-POSTing.
  let current = member;
  if (member.status === 'planned') {
    current = await ledger.markCastMemberDispatched({ memberId: member.memberId });
    if (!current) throw castError(`The ${member.role} cast member changed state in the ledger.`, 'cast_ledger_conflict', { role: member.role, members: summary });
  }
  await settleByReadback({ client, ledger, member: current, expected, recovered: true, summary });
}

/**
 * Create (or reuse, or recover) the three cast members in role order.
 * Refusals before any write: environment/client mismatch, an address that is
 * missing, malformed, not allowlisted or shared; an invalid name; a journaled
 * member whose address or names differ from this run's; a member already
 * `needs_attention`; any ownership collision for a member still to create.
 *
 * @returns {Promise<{ members: Array<{ role: string, memberId: string, entity: string, status: string, outcome: string }> }>}
 *   Throws a coded error (with `members`, the summary so far) on any stop.
 */
export async function runCastCreate({ client, ledger, environment, addresses, allowlist, names = CAST_DEFAULT_NAMES }) {
  assertEnvironmentMatchesClient(client, environment);
  const planned = planCastAddresses({ addresses, allowlist });
  assertCastNames(names);

  const existing = await ledger.listCastMembers({ environment });
  const byRole = new Map(existing.map((m) => [m.role, m]));
  for (const role of CAST_ROLE_ORDER) {
    const member = byRole.get(role);
    if (!member) continue;
    if (member.status === 'needs_attention') {
      throw castError(`The ${role} cast member needs attention (${member.error || 'no detail'}); resolve it first.`, 'cast_member_needs_attention', { role });
    }
    if (member.addressSha256 !== planned[role].addressSha256) {
      throw castError(`The ${role} address differs from the journaled cast member's.`, 'cast_address_changed', { role });
    }
    if (member.firstName !== names[role].firstName || member.lastName !== names[role].lastName) {
      throw castError(`The ${role} names differ from the journaled cast member's.`, 'cast_names_changed', { role });
    }
  }
  const journaledIds = existing.map((m) => m.memberId);
  for (const role of CAST_ROLE_ORDER) {
    if (byRole.has(role)) continue;
    await assertNoCollision(client, { role, ...names[role], address: planned[role].address }, journaledIds);
  }

  const summary = [];
  for (const role of CAST_ROLE_ORDER) {
    const member = byRole.get(role);
    if (member) await resolveExisting({ client, ledger, member, summary });
    else await createMember({ client, ledger, environment, role, name: names[role], planned: planned[role], summary });
  }
  return { members: summary };
}

/**
 * The verified cast, each member confirmed live by GUID (active, journaled
 * names, address digest equal to the ledger's, no parent account / marker-
 * true and Contact-less). Refuses when any role is missing, not verified, or
 * drifted. Read-only.
 *
 * @returns {Promise<Record<string, { memberId: string, entity: string, firstName: string, lastName: string }>>}
 */
export async function readCast({ client, ledger, environment }) {
  assertEnvironmentMatchesClient(client, environment);
  const members = await ledger.listCastMembers({ environment });
  const out = {};
  for (const role of CAST_ROLE_ORDER) {
    const member = members.find((m) => m.role === role);
    if (!member) throw castError(`The ${environment} cast has no ${role}; run the cast mode first.`, 'cast_member_missing', { role });
    if (member.status !== 'verified') {
      throw castError(`The ${role} cast member is ${member.status}, not verified.`, 'cast_member_unverified', { role });
    }
    const row = await readById(client, member.entity, member.memberId);
    const fields = row
      ? mismatchedFields(member.entity, row, { firstName: member.firstName, lastName: member.lastName, addressSha256: member.addressSha256 })
      : ['(absent)'];
    if (fields.length) {
      throw castError(`The ${role} cast member no longer matches (${fields.join(', ')}).`, 'cast_member_drifted', { role });
    }
    out[role] = { memberId: member.memberId, entity: member.entity, firstName: member.firstName, lastName: member.lastName };
  }
  return out;
}
