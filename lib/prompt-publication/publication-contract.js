/** Pure versioned wire schemas. Shape validation is NOT actor authorization,
 * receipt authenticity, committed state, policy freshness or Dataverse proof.
 * Completed replay must precede installed-policy and live-state validation.
 */
const { owns, isObject, inspectJson, utf8Length } = require('./json-contract');
const { shape, text, key, positive } = require('./definition-schema');
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const guid = v => typeof v === 'string' && GUID.exec(v)?.[0] === v && v !== '00000000-0000-0000-0000-000000000000';
const hash = v => typeof v === 'string' && HASH.exec(v)?.[0] === v;
const revision = v => typeof v === 'string' && /^(?:0|[1-9][0-9]{0,18})$/.exec(v)?.[0] === v && (v.length < 19 || v <= '9223372036854775807');
const etag = v => typeof v === 'string' && /^W\/"[1-9][0-9]{0,18}"$/.exec(v)?.[0] === v;
const error = (errors, path, code) => errors.push({ path, code });
function guarded(value, check) {
  try { inspectJson(value); } catch (e) { return { valid: false, errors: [{ path: '$', code: e.code || 'invalid_json_value' }] }; }
  const errors = []; check(value, errors);
  return { valid: errors.length === 0, errors };
}
function catalog(value, errors, path = 'catalog') {
  if (!shape(value, ['title', 'description', 'groupKey', 'sectionKey', 'usedBy', 'usageCategory'], [], errors, path)) return;
  for (const [k, cap] of [['title', 200], ['description', 4000], ['groupKey', 80], ['sectionKey', 80], ['usedBy', 4000], ['usageCategory', 40]]) {
    if (value[k] !== null && !text(value[k], cap, true)) error(errors, path + '.' + k, 'invalid_catalog_text');
  }
  for (const k of ['groupKey', 'sectionKey']) if (value[k] !== null && (typeof value[k] !== 'string' || /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.exec(value[k])?.[0] !== value[k])) error(errors, path + '.' + k, 'invalid_catalog_key');
  if (value.sectionKey !== null && value.groupKey === null) error(errors, path, 'section_requires_group');
}
function current(value, errors, path) {
  if (value === null) return;
  if (!shape(value, ['id', 'version', 'etag'], [], errors, path)) return;
  if (!guid(value.id) || !positive(value.version) || !etag(value.etag)) error(errors, path, 'invalid_current');
}
function baseline(value, errors) {
  const path = 'metadataBaseline';
  if (!shape(value, ['schemaVersion', 'current', 'catalog', 'headRevision'], [], errors, path)) return;
  if (value.schemaVersion !== 1 || !revision(value.headRevision)) error(errors, path, 'invalid_baseline');
  catalog(value.catalog, errors, path + '.catalog');
  if (value.current !== null) {
    if (shape(value.current, ['id', 'etag'], [], errors, path + '.current') && (!guid(value.current.id) || !etag(value.current.etag))) error(errors, path, 'invalid_baseline_current');
  }
  if (utf8Length(JSON.stringify(value)) > 16000 || JSON.stringify(value).length > 16000) error(errors, path, 'baseline_too_large');
}
const REQUEST_FIELDS = ['contractVersion', 'definitionFormatVersion', 'policyRevision', 'policyArtifactHash', 'requestId', 'operation', 'promptKey', 'draftId', 'draftEtag', 'expectedHeadRevision', 'expectedCurrent', 'metadataBaseline', 'snapshotHash'];
function request(value, errors) {
  if (!shape(value, REQUEST_FIELDS, [], errors, '$')) return;
  if (value.contractVersion !== 1 || value.definitionFormatVersion !== 1) error(errors, '$', 'unsupported_contract_version');
  // Positive submitted historical revision/hash, NOT equality to installed policy.
  if (!positive(value.policyRevision) || !hash(value.policyArtifactHash)) error(errors, '$', 'invalid_policy_identity');
  if (!guid(value.requestId) || !guid(value.draftId) || !etag(value.draftEtag)) error(errors, '$', 'invalid_request_identity');
  if (value.operation !== 'publish') error(errors, 'operation', 'unsupported_operation');
  if (!key(value.promptKey)) error(errors, 'promptKey', 'invalid_canonical_key');
  if (!revision(value.expectedHeadRevision) || value.expectedHeadRevision === '9223372036854775807') error(errors, 'expectedHeadRevision', 'invalid_head_revision');
  if (!hash(value.snapshotHash)) error(errors, 'snapshotHash', 'invalid_hash');
  current(value.expectedCurrent, errors, 'expectedCurrent');
  baseline(value.metadataBaseline, errors);
  if (isObject(value.metadataBaseline)) {
    const b = value.metadataBaseline;
    if (b.headRevision !== value.expectedHeadRevision) error(errors, 'metadataBaseline', 'baseline_head_mismatch');
    if (value.expectedCurrent === null ? b.current !== null : (!isObject(b.current) || b.current.id !== value.expectedCurrent?.id || b.current.etag !== value.expectedCurrent?.etag)) error(errors, 'metadataBaseline', 'baseline_current_mismatch');
    if (b.current === null && isObject(b.catalog) && Object.values(b.catalog).some(v => v !== null)) error(errors, 'metadataBaseline', 'new_name_baseline_not_empty');
  }
  if (value.expectedCurrent?.id === value.draftId) error(errors, 'draftId', 'draft_equals_current');
}
function actor(value, errors) {
  if (!shape(value, ['organizationId', 'initiatingUserId', 'effectiveUserId'], [], errors, 'actor')) return;
  if (Object.values(value).some(v => !guid(v))) error(errors, 'actor', 'invalid_actor_context');
}
function incrementRevision(value) {
  if (!revision(value) || value === '9223372036854775807') return null;
  const chars = value.split('');
  for (let i = chars.length - 1; i >= 0; i--) {
    if (chars[i] !== '9') { chars[i] = String(Number(chars[i]) + 1); return chars.join(''); }
    chars[i] = '0';
  }
  return '1' + chars.join('');
}
function validateRequest(value) { return guarded(value, request); }
function validateActor(value) { return guarded(value, actor); }
function validateSnapshot(value) {
  return guarded(value, (v, errors) => {
    if (!shape(v, ['definitionFormatVersion', 'definition', 'catalog'], [], errors, '$')) return;
    if (v.definitionFormatVersion !== 1) error(errors, '$', 'unsupported_definition_version');
    // Stable shape only: hashing old snapshots must not consult current policy.
    shape(v.definition, ['name', 'systemPrompt', 'body', 'variables', 'outputSchema', 'model', 'temperature', 'maxTokens'], [], errors, 'definition');
    catalog(v.catalog, errors);
  });
}
function validateReceipt(value) {
  return guarded(value, (v, errors) => {
    if (!shape(v, ['receiptVersion', 'fingerprintVersion', 'request', 'actor', 'requestFingerprint', 'published', 'headRevision', 'publishedAt'], [], errors, '$')) return;
    if (v.receiptVersion !== 1 || v.fingerprintVersion !== 1) error(errors, '$', 'unsupported_receipt_version');
    request(v.request, errors); actor(v.actor, errors);
    if (!hash(v.requestFingerprint)) error(errors, 'requestFingerprint', 'invalid_hash');
    current(v.published, errors, 'published');
    if (!isObject(v.published) || v.published.id !== v.request?.draftId || (positive(v.published.version) && positive(v.request?.expectedCurrent?.version) && v.published.version <= v.request.expectedCurrent.version)) error(errors, 'published', 'invalid_published_result');
    if (!revision(v.headRevision) || v.headRevision !== incrementRevision(v.request?.expectedHeadRevision)) error(errors, 'headRevision', 'invalid_committed_revision');
    if (typeof v.publishedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v.publishedAt) || !Number.isFinite(Date.parse(v.publishedAt)) || new Date(v.publishedAt).toISOString() !== v.publishedAt) error(errors, 'publishedAt', 'invalid_timestamp');
  });
}
module.exports = { guid, etag, revision, validateRequest, validateActor, validateSnapshot, validateReceipt, incrementRevision, catalog, guarded };
