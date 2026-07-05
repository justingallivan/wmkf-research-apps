/**
 * Idempotent ensure functions for Dataverse security roles.
 *
 * Mirrors the pattern in schema-apply.js: declarative JSON → ensure functions
 * that create on first run and no-op on subsequent runs.
 *
 * Depth values use Dataverse's PrivilegeDepth enum (string form, which is what
 * the Web API accepts in action payloads):
 *   Basic  = user-level
 *   Local  = business-unit-level
 *   Deep   = parent:child BU
 *   Global = organization-level
 */

const odata = require('./core/odata.js');

async function getRootBusinessUnit(client) {
  const r = await client.get(
    '/businessunits?$filter=parentbusinessunitid eq null&$select=name,businessunitid',
  );
  if (!r.ok) throw new Error(`businessunits query failed: ${r.status} ${r.text}`);
  const bu = r.body?.value?.[0];
  if (!bu) throw new Error('No root business unit found');
  return bu;
}

async function findRoleByName(client, name, businessUnitId) {
  const filter = `name eq '${odata.escape(name)}' and _businessunitid_value eq ${businessUnitId}`;
  const r = await client.get(
    `/roles?$filter=${encodeURIComponent(filter)}&$select=roleid,name,ismanaged`,
  );
  if (!r.ok) throw new Error(`role lookup failed: ${r.status} ${r.text}`);
  return r.body?.value?.[0] || null;
}

async function ensureRole(client, { name, description, businessUnitId, resourceUrl }) {
  const existing = await findRoleByName(client, name, businessUnitId);
  if (existing) return { ...existing, created: false };

  const body = {
    name,
    'businessunitid@odata.bind': `${resourceUrl}/api/data/v9.2/businessunits(${businessUnitId})`,
  };
  if (description) body.description = description;

  const r = await client.post('/roles', body, {
    Prefer: 'return=representation',
  });
  if (!r.ok) throw new Error(`role create failed: ${r.status} ${r.text}`);
  return { ...r.body, created: true };
}

const PRIV_OPS = ['Create', 'Read', 'Write', 'Delete', 'Append', 'AppendTo', 'Assign', 'Share'];

function buildPrivilegeName(op, table) {
  if (!PRIV_OPS.includes(op)) throw new Error(`Unknown op: ${op}`);
  // Privilege names use the table's SchemaName (PascalCase) in the suffix.
  // We accept a logical name in the JSON and look up the actual privilege by
  // case-insensitive match below.
  return `prv${op}${table}`;
}

async function resolvePrivilegeIds(client, table, ops) {
  const names = ops.map((op) => buildPrivilegeName(op, table));
  // Dataverse OData `eq` on string fields is case-insensitive, and tolower()
  // is not supported in this API surface. Plain `eq` is the correct approach.
  const filter = names.map((n) => `name eq '${odata.escape(n)}'`).join(' or ');
  const r = await client.get(
    `/privileges?$filter=${encodeURIComponent(filter)}&$select=privilegeid,name`,
  );
  if (!r.ok) throw new Error(`privilege lookup failed for ${table}: ${r.status} ${r.text}`);
  const byLower = new Map();
  for (const p of r.body?.value || []) byLower.set(p.name.toLowerCase(), p);
  const resolved = [];
  const missing = [];
  for (let i = 0; i < ops.length; i += 1) {
    const want = names[i].toLowerCase();
    const hit = byLower.get(want);
    if (hit) resolved.push({ op: ops[i], privilegeId: hit.privilegeid, name: hit.name });
    else missing.push(names[i]);
  }
  return { resolved, missing };
}

async function applyPrivileges(client, roleId, privilegesPayload) {
  const r = await client.post(
    `/roles(${roleId})/Microsoft.Dynamics.CRM.AddPrivilegesRole`,
    { Privileges: privilegesPayload },
  );
  if (!r.ok) throw new Error(`AddPrivilegesRole failed: ${r.status} ${r.text}`);
  return { count: privilegesPayload.length };
}

async function findSolutionId(client, uniqueName) {
  const r = await client.get(
    `/solutions?$filter=uniquename eq '${uniqueName}'&$select=solutionid,uniquename`,
  );
  if (!r.ok) throw new Error(`solution lookup failed: ${r.status} ${r.text}`);
  return r.body?.value?.[0] || null;
}

async function addRoleToSolution(client, roleId, solutionUniqueName) {
  // AddSolutionComponent is a global action. ComponentType 20 = Role.
  // Calling it when the component is already in the solution returns an error
  // we can safely swallow.
  const r = await client.post('/AddSolutionComponent', {
    ComponentId: roleId,
    ComponentType: 20,
    SolutionUniqueName: solutionUniqueName,
    AddRequiredComponents: false,
    IncludedComponentSettingsValues: null,
  }, {
    // Suppress automatic solution header — AddSolutionComponent carries the
    // solution name in the payload and conflicts with the header.
    'MSCRM.SolutionUniqueName': '',
  });
  if (r.ok) return { added: true };
  const msg = r.body?.error?.message || r.text || '';
  if (/already\s+exists|duplicate|0x80060890/i.test(msg)) {
    return { added: false, alreadyPresent: true };
  }
  throw new Error(`AddSolutionComponent failed: ${r.status} ${msg}`);
}

async function assignRoleToUser(client, roleId, userId, resourceUrl) {
  const r = await client.post(
    `/systemusers(${userId})/systemuserroles_association/$ref`,
    { '@odata.id': `${resourceUrl}/api/data/v9.2/roles(${roleId})` },
  );
  if (r.ok) return { assigned: true };
  const msg = r.body?.error?.message || r.text || '';
  if (/duplicate|already/i.test(msg) || r.status === 412) {
    return { assigned: false, alreadyAssigned: true };
  }
  throw new Error(`role assignment failed: ${r.status} ${msg}`);
}

module.exports = {
  getRootBusinessUnit,
  findRoleByName,
  ensureRole,
  resolvePrivilegeIds,
  applyPrivileges,
  findSolutionId,
  addRoleToSolution,
  assignRoleToUser,
};
