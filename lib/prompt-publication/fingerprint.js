/** SERVER ONLY: hashes and fresh definition/budget checks. No authorization or persistence.
 * The trusted actor argument MUST come from authenticated Dataverse context.
 * Caller-supplied actor fields are rejected by the wire schema, not trusted here.
 */
const { createHash } = require('node:crypto');
const { validateDefinition } = require('./definition-schema');
const { validatePromptBudget } = require('./budget-coordination');
const { matchesPolicy } = require('./template-policy');
const { canonicalPreimage } = require('./json-contract');
const { validateRequest, validateActor, validateSnapshot, validateReceipt } = require('./publication-contract');
function requireValid(result) {
  if (!result.valid) { const error = new Error('invalid_publication_contract'); error.code = 'invalid_publication_contract'; error.errors = result.errors; throw error; }
}
function digest(domain, value) {
  const preimage = domain + '\n' + canonicalPreimage(value);
  return { hash: createHash('sha256').update(preimage, 'utf8').digest('hex'), preimage };
}
function hashSnapshot(snapshot) {
  requireValid(validateSnapshot(snapshot));
  return digest('wmkf.prompt.snapshot.v1', snapshot);
}
function publicationFingerprint(request, trustedActor) {
  requireValid(validateRequest(request)); requireValid(validateActor(trustedActor));
  return digest('wmkf.prompt.publication.v1', { fingerprintVersion: 1, request, actor: trustedActor, canonicalKey: request.promptKey });
}
/** Historical binding only. Authorization, durable receipt lookup and fresh
 * current-state reads remain mandatory in the future operation. */
function verifyReceiptBinding(receipt, request, trustedActor) {
  if (!validateReceipt(receipt).valid) return false;
  try {
    const stored = publicationFingerprint(receipt.request, receipt.actor).hash;
    const replay = publicationFingerprint(request, trustedActor).hash;
    return receipt.requestFingerprint === stored && stored === replay;
  } catch { return false; }
}
function validateFreshPublication(request, snapshot, serverBudgetSnapshot = null) {
  const errors = [...validateRequest(request).errors, ...validateSnapshot(snapshot).errors];
  if (errors.length) return { valid: false, errors };
  errors.push(...validateDefinition(snapshot.definition).errors);
  if (!matchesPolicy({ policyVersion: request.policyRevision, policyArtifactHash: request.policyArtifactHash })) errors.push({ path: '$', code: 'policy_changed' });
  if (snapshot.definition.name !== request.promptKey || snapshot.definitionFormatVersion !== request.definitionFormatVersion) errors.push({ path: '$', code: 'snapshot_identity_mismatch' });
  if (request.expectedCurrent === null && ['title', 'description', 'groupKey', 'usedBy', 'usageCategory'].some(k => typeof snapshot.catalog[k] !== 'string' || !snapshot.catalog[k].trim())) errors.push({ path: 'catalog', code: 'new_catalog_incomplete' });
  if (request.expectedCurrent === null && snapshot.definition.temperature === null) errors.push({ path: 'temperature', code: 'temperature_required' });
  const budget = validatePromptBudget(snapshot.definition.name, snapshot.definition.model, serverBudgetSnapshot?.state, serverBudgetSnapshot?.control);
  errors.push(...budget.errors);
  if (hashSnapshot(snapshot).hash !== request.snapshotHash) errors.push({ path: '$', code: 'snapshot_hash_mismatch' });
  return { valid: errors.length === 0, errors, budgetFence: errors.length ? null : budget.budgetFence };
}
module.exports = { hashSnapshot, publicationFingerprint, verifyReceiptBinding, validateFreshPublication };
