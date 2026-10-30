/** SERVER ONLY offline preparation, not a migration runner or permission token.
 * Accepts an explicitly supplied snapshot, never reads/writes a tenant. Only the
 * exact historical maxLength-only schema delta is recognized. No generic schema
 * stripping, inferred row identity, lifecycle repair or model defaulting.
 */
const { canonicalPreimage, parseJson, inspectJson } = require('./json-contract');
const { validateDefinition } = require('./definition-schema');
const { validateSnapshot } = require('./publication-contract');
const { hashSnapshot } = require('./fingerprint');
const { POLICY_ARTIFACT } = require('./template-policy');
const NAME = 'pre-site-visit.proposal-core.generate';
const fail = code => { const e = new Error(code); e.code = code; throw e; };
const clone = v => JSON.parse(JSON.stringify(v));
function freeze(v) { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
function preparePreSiteTransition(snapshotValue) {
  inspectJson(snapshotValue);
  const snapshot = clone(snapshotValue);
  if (!validateSnapshot(snapshot).valid || snapshot.definition.name !== NAME) fail('invalid_pre_site_transition_snapshot');
  const contract = POLICY_ARTIFACT.policy.consumerContracts[NAME];
  const next = parseJson(contract.outputJson);
  const legacy = clone(next);
  // The reviewed old config derived native string limits from these SAME local
  // validation nodes. Never trust arbitrary submitted bounds or new key shapes.
  for (const [name, node] of Object.entries(legacy.jsonSchema.properties.proposalCore.properties)) {
    node.maxLength = legacy.validationSchema.fields.proposalCore.fields[name].maxLength;
  }
  const supplied = parseJson(snapshot.definition.outputSchema);
  const same = (a,b) => canonicalPreimage(a) === canonicalPreimage(b);
  const alreadyCompatible = same(supplied, next);
  if (!alreadyCompatible && !same(supplied, legacy)) fail('unreviewed_pre_site_schema_delta');
  const proposed = clone(snapshot);
  // Preserve exact memo bytes on an already-compatible row; preparation is a
  // no-op, not a fresh version or a reason to reformat/re-stamp anything.
  if (!alreadyCompatible) proposed.definition.outputSchema = contract.outputJson;
  const validation = validateDefinition(proposed.definition);
  if (!validation.valid) fail('incompatible_pre_site_transition_definition');
  const currentHash = hashSnapshot(snapshot).hash, proposedHash = hashSnapshot(proposed).hash;
  return freeze({
    planVersion:1, promptKey:NAME, action:alreadyCompatible ? 'verify-only' : 'stage-new-draft',
    currentSnapshotHash:currentHash, proposedSnapshotHash:proposedHash, proposedSnapshot:proposed,
    policyRevision:POLICY_ARTIFACT.policy.policyVersion, policyArtifactHash:POLICY_ARTIFACT.hash,
    changedFields:alreadyCompatible ? [] : ['outputSchema'],
    deploymentAuthorized:false,
    requiredEvidence:['sole-current-published-identity-and-etag','complete-version-inventory-and-head','writer-and-generation-pause-and-drain','compatible-sandbox-rehearsal','shared-operation-and-role-proof','same-request-uuid-publication-receipt','sole-current-readback-and-reader-preflight','explicit-resume-approval'],
  });
}
module.exports = { preparePreSiteTransition };
