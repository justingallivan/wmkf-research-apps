/**
 * Server-owned, optimistic-concurrency writer for reviewer identity bindings.
 *
 * This module is intentionally inert until a runtime caller is migrated. It
 * performs one fail-closed read and one complete If-Match PATCH, recomputing
 * the transition after a bounded 412 race. Ambiguous legacy, cross-human,
 * revocation, and cross-anchor-equivalence cases never fall through to writes.
 */

import * as researcherAdapter from '../dataverse/adapters/researcher.js';
import {
  IDENTITY_BINDING_SOURCES,
  IDENTITY_BINDING_VERSION_MAX,
  IDENTITY_LINEAGE_FIELDS,
  automatedLineageFields,
  normalizeBindingAnchor,
  normalizeIdentityTimestamp,
  parseIdentityFieldLineage,
  serializeIdentityFieldLineage,
  validateIdentityBindingTuple,
} from './reviewer-identity-binding-contract.js';

const SOURCE_SET = new Set(IDENTITY_BINDING_SOURCES);
const HUMAN_SOURCES = new Set(['staff_confirmed', 'self_reported']);
const DECISION_STATUSES = new Set(['confirmed', 'probable', 'unresolved', 'ambiguous']);
const FIELD_MODES = new Set(['partial', 'replacement']);
const MAX_WRITE_ATTEMPTS = 3;

const BINDING_FIELDS = Object.freeze([
  'wmkf_identitybindingversion',
  'wmkf_identitybindingsource',
  'wmkf_identitybindinganchor',
  'wmkf_identityboundat',
  'wmkf_identityderivedbindingversion',
  'wmkf_identityfieldlineagejson',
]);

const DECISION_FIELDS = Object.freeze([
  'wmkf_identitystatus',
  'wmkf_identityconfidenceband',
  'wmkf_identityresolverversion',
  'wmkf_identityresolvedat',
  'wmkf_identityevidencesummary',
  'wmkf_identityverifiedanchorsjson',
]);

const COMPLETE_PATCH_FIELDS = Object.freeze([
  ...BINDING_FIELDS,
  ...IDENTITY_LINEAGE_FIELDS,
  ...DECISION_FIELDS,
]);

const PAIRS = Object.freeze([
  ['wmkf_orcid', 'wmkf_orcidurl', 'ORCID'],
  ['wmkf_googlescholarid', 'wmkf_googlescholarurl', 'Scholar'],
]);

export class IdentityBindingWriteError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'IdentityBindingWriteError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new IdentityBindingWriteError(code, message, details);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function canonicalTimestamp(value, label) {
  const normalized = normalizeIdentityTimestamp(value);
  if (!normalized) {
    fail('invalid_event', `${label} must be a canonical ISO UTC timestamp`);
  }
  return normalized;
}

function normalizeFields(fields, fieldMode) {
  if (!FIELD_MODES.has(fieldMode)) fail('invalid_event', 'fieldMode must be partial or replacement');
  if (!isPlainObject(fields)) fail('invalid_event', 'fields must be a plain object');
  const unknown = Object.keys(fields).filter((field) => !IDENTITY_LINEAGE_FIELDS.includes(field));
  if (unknown.length > 0) fail('invalid_event', `unsupported identity fields: ${unknown.join(', ')}`);
  for (const [field, value] of Object.entries(fields)) {
    if (value === null || value === undefined) {
      fail('invalid_event', `explicit null is not allowed for '${field}'; use replacement omission`);
    }
  }
  for (const [left, right, label] of PAIRS) {
    const hasLeft = Object.prototype.hasOwnProperty.call(fields, left);
    const hasRight = Object.prototype.hasOwnProperty.call(fields, right);
    if (hasLeft !== hasRight) fail('invalid_event', `${label} pair must be supplied atomically`);
  }
  return { ...fields };
}

function validateIncomingFieldValues(fields, source) {
  const values = Object.fromEntries(IDENTITY_LINEAGE_FIELDS.map((field) => [field, fields[field] ?? null]));
  const lineage = {};
  for (const field of IDENTITY_LINEAGE_FIELDS) {
    if (values[field] !== null) lineage[field] = { source, bindingVersion: 1 };
  }
  serializeIdentityFieldLineage(lineage, { values, currentBindingVersion: 1 });
}

function buildDecisionPatch(decision, source) {
  if (!isPlainObject(decision) || !DECISION_STATUSES.has(decision.status)) {
    fail('invalid_event', 'decision with a supported status is required');
  }
  const resolvedAt = canonicalTimestamp(decision.resolvedAt, 'decision.resolvedAt');
  if (typeof decision.confidenceBand !== 'string' || !decision.confidenceBand.trim()) {
    fail('invalid_event', 'decision.confidenceBand is required');
  }
  if (typeof decision.resolverVersion !== 'string' || !decision.resolverVersion.trim()) {
    fail('invalid_event', 'decision.resolverVersion is required');
  }
  if (HUMAN_SOURCES.has(source) && decision.status !== 'confirmed') {
    fail('invalid_event', `${source} requires a confirmed decision`);
  }
  if (source === 'automated' && !['confirmed', 'probable'].includes(decision.status)) {
    fail('invalid_event', 'automated binding requires a resolved person decision');
  }
  const expectedBand = decision.status === 'confirmed' ? 'high' : 'medium';
  if (decision.confidenceBand !== expectedBand) {
    fail('invalid_event', `${decision.status} decision requires confidenceBand '${expectedBand}'`);
  }

  let persisted = decision;
  if (source === 'automated' && decision.status === 'confirmed') {
    const detail = String(decision.evidenceSummary || '')
      .replace(/^confirmed\s+[—-]\s*/i, '')
      .trim();
    persisted = {
      ...decision,
      status: 'probable',
      confidenceBand: 'medium',
      evidenceSummary: `probable — automated high-confidence decision capped at persistence boundary${detail ? `; ${detail}` : ''}`,
    };
  }

  if (!Array.isArray(persisted.anchors)) fail('invalid_event', 'decision.anchors must be an array');
  const anchors = persisted.anchors;
  for (const [index, evidence] of anchors.entries()) {
    if (!isPlainObject(evidence)) fail('invalid_event', `decision.anchors[${index}] must be an object`);
    for (const key of ['type', 'canonicalKey', 'verifier']) {
      if (typeof evidence[key] !== 'string' || !evidence[key].trim()) {
        fail('invalid_event', `decision.anchors[${index}].${key} is required`);
      }
    }
    if (evidence.sourceUrl !== null && evidence.sourceUrl !== undefined && typeof evidence.sourceUrl !== 'string') {
      fail('invalid_event', `decision.anchors[${index}].sourceUrl must be a string or null`);
    }
  }
  const anchorsCompact = JSON.stringify(anchors.map((anchor) => ({
    type: anchor?.type,
    canonicalKey: anchor?.canonicalKey,
    sourceUrl: anchor?.sourceUrl || null,
    verifier: anchor?.verifier,
  })));
  if (anchorsCompact.length > 50000) fail('invalid_event', 'decision anchors exceed the Dataverse memo cap');

  return {
    wmkf_identitystatus: persisted.status,
    wmkf_identityconfidenceband: persisted.confidenceBand,
    wmkf_identityresolverversion: persisted.resolverVersion,
    wmkf_identityresolvedat: resolvedAt,
    wmkf_identityevidencesummary: String(persisted.evidenceSummary || '').slice(0, 2000) || null,
    wmkf_identityverifiedanchorsjson: anchorsCompact,
  };
}

function normalizeEvent(event) {
  if (!isPlainObject(event)) fail('invalid_event', 'identity binding event is required');
  const { source, anchor, boundAt, fieldMode = 'partial' } = event;
  if (!SOURCE_SET.has(source)) fail('invalid_event', `unsupported binding source '${source}'`);
  const normalizedAnchor = normalizeBindingAnchor(anchor);
  if (!normalizedAnchor.ok) fail('invalid_event', normalizedAnchor.error);
  if (normalizedAnchor.value !== anchor) fail('invalid_event', 'binding anchor must be canonical');
  const normalizedBoundAt = canonicalTimestamp(boundAt, 'boundAt');
  const fields = normalizeFields(event.fields || {}, fieldMode);
  validateIncomingFieldValues(fields, source);

  const tuple = validateIdentityBindingTuple({
    bindingVersion: 1,
    bindingSource: source,
    bindingAnchor: anchor,
    boundAt: normalizedBoundAt,
    derivedBindingVersion: source === 'automated' ? 1 : null,
  });
  if (!tuple.ok) fail('invalid_event', tuple.errors.join('; '));
  if (source === 'staff_confirmed' && normalizedAnchor.namespace !== 'staff-attestation') {
    fail('invalid_event', 'staff_confirmed requires a server-created staff-attestation anchor');
  }
  if (source === 'self_reported') {
    const keys = Object.keys(fields).sort();
    if (keys.join(',') !== 'wmkf_orcid,wmkf_orcidurl') {
      fail('invalid_event', 'self_reported may write only the complete ORCID pair');
    }
    if (anchor !== `orcid:${fields.wmkf_orcid}`) {
      fail('invalid_event', 'self_reported ORCID fields must match the binding anchor');
    }
  }
  if (
    normalizedAnchor.namespace === 'orcid'
    && Object.prototype.hasOwnProperty.call(fields, 'wmkf_orcid')
    && anchor !== `orcid:${fields.wmkf_orcid}`
  ) {
    fail('invalid_event', 'ORCID fields must match the binding anchor');
  }
  if (
    source === 'automated'
    && fieldMode === 'replacement'
    && normalizedAnchor.namespace === 'orcid'
    && !Object.prototype.hasOwnProperty.call(fields, 'wmkf_orcid')
  ) {
    fail('invalid_event', 'automated ORCID replacement requires the canonical ORCID pair');
  }
  return {
    source,
    anchor,
    boundAt: normalizedBoundAt,
    fieldMode,
    fields,
    decisionPatch: buildDecisionPatch(event.decision, source),
  };
}

function valueMap(row) {
  return Object.fromEntries(IDENTITY_LINEAGE_FIELDS.map((field) => [field, row?.[field] ?? null]));
}

function decisionMap(row) {
  const decision = Object.fromEntries(DECISION_FIELDS.map((field) => [field, row?.[field] ?? null]));
  const normalizedResolvedAt = normalizeIdentityTimestamp(decision.wmkf_identityresolvedat);
  if (normalizedResolvedAt) decision.wmkf_identityresolvedat = normalizedResolvedAt;
  return decision;
}

function bindingMap(row) {
  const rawBoundAt = row?.wmkf_identityboundat ?? null;
  return {
    bindingVersion: row?.wmkf_identitybindingversion ?? null,
    bindingSource: row?.wmkf_identitybindingsource ?? null,
    bindingAnchor: row?.wmkf_identitybindinganchor ?? null,
    boundAt: normalizeIdentityTimestamp(rawBoundAt) || rawBoundAt,
    derivedBindingVersion: row?.wmkf_identityderivedbindingversion ?? null,
  };
}

function loadCurrentState(row) {
  if (!row || typeof row !== 'object') fail('invalid_current_state', 'identity binding row is missing');
  if (typeof row._etag !== 'string' || !row._etag.trim()) {
    fail('missing_etag', 'identity binding read did not return an ETag');
  }
  const binding = bindingMap(row);
  const tuple = validateIdentityBindingTuple(binding);
  if (!tuple.ok) fail('invalid_current_state', tuple.errors.join('; '));
  const values = valueMap(row);

  if (tuple.state === 'unbound') {
    const populated = IDENTITY_LINEAGE_FIELDS.filter((field) => values[field] !== null);
    if (row.wmkf_identityfieldlineagejson !== null && row.wmkf_identityfieldlineagejson !== undefined) {
      fail('legacy_classification_required', 'unbound row has lineage without a binding');
    }
    if (populated.length > 0) {
      fail('legacy_classification_required', 'legacy identity fields require explicit classification before first binding', {
        populatedFields: populated,
      });
    }
    return {
      etag: row._etag,
      binding,
      state: 'unbound',
      values,
      lineage: { schemaVersion: 1, fields: {} },
      lineageJson: null,
      decision: decisionMap(row),
    };
  }

  const parsed = parseIdentityFieldLineage(row.wmkf_identityfieldlineagejson, {
    values,
    currentBindingVersion: binding.bindingVersion,
  });
  if (!parsed.ok) fail('invalid_current_state', `identity lineage is invalid: ${parsed.errors.join('; ')}`);
  const lineageJson = serializeIdentityFieldLineage(parsed.value.fields, {
    values,
    currentBindingVersion: binding.bindingVersion,
  });
  return {
    etag: row._etag,
    binding,
    state: 'bound',
    values,
    lineage: parsed.value,
    lineageJson,
    decision: decisionMap(row),
  };
}

function blocked(reason, current, event) {
  return {
    outcome: 'blocked',
    reason,
    expectedEtag: current.etag,
    eventIdentity: { source: event.source, anchor: event.anchor, boundAt: event.boundAt },
    previousBinding: current.binding,
    committedBinding: null,
    personPatch: null,
    clearedFields: [],
    lineageJson: current.lineageJson,
    invalidateSuggestionCoi: false,
    downstreamEligible: false,
  };
}

function determineTransition(current, event) {
  if (current.state === 'unbound') {
    if (event.source === 'automated' && event.fieldMode !== 'replacement') {
      return { blocked: 'automated_init_requires_replacement_bundle' };
    }
    return { outcome: 'init', version: 1, keepBinding: false, exactHumanReplay: false };
  }

  const cur = current.binding;
  const currentHuman = HUMAN_SOURCES.has(cur.bindingSource);
  const incomingHuman = HUMAN_SOURCES.has(event.source);
  const sameSource = cur.bindingSource === event.source;
  const sameAnchor = cur.bindingAnchor === event.anchor;
  const exactHumanReplay = incomingHuman && sameSource && sameAnchor && cur.boundAt === event.boundAt;

  if (cur.bindingSource === 'self_reported' && event.source === 'staff_confirmed') {
    return { blocked: 'staff_correction_requires_authorized_self_report_override' };
  }
  if (cur.bindingSource === 'staff_confirmed' && event.source === 'self_reported') {
    if (cur.bindingVersion >= IDENTITY_BINDING_VERSION_MAX) fail('version_exhausted', 'identity binding version cannot advance');
    return {
      outcome: 'rebind',
      version: cur.bindingVersion + 1,
      keepBinding: false,
      exactHumanReplay: false,
      clearAllExisting: false,
    };
  }
  if (currentHuman && event.source === 'automated') {
    return {
      blocked: sameAnchor
        ? 'automated_refresh_of_human_binding_requires_durable_refresh_ordering'
        : 'automated_cannot_prove_equivalence_to_human_binding',
    };
  }
  if (cur.bindingSource === 'automated' && incomingHuman) {
    if (cur.bindingVersion >= IDENTITY_BINDING_VERSION_MAX) fail('version_exhausted', 'identity binding version cannot advance');
    return { outcome: 'rebind', version: cur.bindingVersion + 1, keepBinding: false, exactHumanReplay: false, clearAllExisting: false };
  }
  if (sameSource && incomingHuman) {
    if (exactHumanReplay) {
      return { outcome: 'noop', version: cur.bindingVersion, keepBinding: true, exactHumanReplay: true };
    }
    if (Date.parse(event.boundAt) < Date.parse(cur.boundAt)) {
      return { blocked: 'out_of_order_human_event' };
    }
    if (event.boundAt === cur.boundAt) {
      return { blocked: 'human_event_identity_collision' };
    }
    if (cur.bindingVersion >= IDENTITY_BINDING_VERSION_MAX) fail('version_exhausted', 'identity binding version cannot advance');
    return { outcome: 'rebind', version: cur.bindingVersion + 1, keepBinding: false, exactHumanReplay: false, clearAllExisting: !sameAnchor };
  }
  if (sameSource && event.source === 'automated') {
    const currentResolvedAt = normalizeIdentityTimestamp(current.decision.wmkf_identityresolvedat);
    const currentResolvedMs = currentResolvedAt ? Date.parse(currentResolvedAt) : NaN;
    if (!Number.isFinite(currentResolvedMs)) {
      fail('invalid_current_state', 'automated binding has a non-canonical decision timestamp');
    }
    const incomingResolvedMs = Date.parse(event.decisionPatch.wmkf_identityresolvedat);
    if (incomingResolvedMs < currentResolvedMs) return { blocked: 'out_of_order_automated_event' };
    if (incomingResolvedMs === currentResolvedMs) {
      if (!sameAnchor) return { blocked: 'automated_event_identity_collision' };
      return {
        outcome: 'refresh',
        version: cur.bindingVersion,
        keepBinding: true,
        exactHumanReplay: false,
        exactAutomatedReplayTime: true,
      };
    }
  }
  if (sameSource && event.source === 'automated' && sameAnchor) {
    return { outcome: 'refresh', version: cur.bindingVersion, keepBinding: true, exactHumanReplay: false };
  }
  if (sameSource && event.source === 'automated' && !sameAnchor) {
    if (event.fieldMode !== 'replacement') return { blocked: 'automated_rebind_requires_replacement_bundle' };
    const nonAutomatedFields = IDENTITY_LINEAGE_FIELDS.filter(
      (field) => current.lineage.fields?.[field]?.source !== 'automated'
        && current.lineage.fields?.[field],
    );
    if (nonAutomatedFields.length > 0) {
      return { blocked: `automated_rebind_has_nonautomated_lineage:${nonAutomatedFields.join(',')}` };
    }
    if (cur.bindingVersion >= IDENTITY_BINDING_VERSION_MAX) fail('version_exhausted', 'identity binding version cannot advance');
    return { outcome: 'rebind', version: cur.bindingVersion + 1, keepBinding: false, exactHumanReplay: false, clearAllExisting: false };
  }
  return { blocked: 'unsupported_binding_transition' };
}

function prepareTarget(current, event, transition) {
  const targetValues = { ...current.values };
  const targetLineage = { ...(current.lineage?.fields || {}) };
  const realTransition = transition.outcome === 'init' || transition.outcome === 'rebind';

  if (realTransition) {
    const fieldsToClear = transition.clearAllExisting
      ? IDENTITY_LINEAGE_FIELDS
      : automatedLineageFields(current.lineage);
    for (const field of fieldsToClear) {
      targetValues[field] = null;
      delete targetLineage[field];
    }
  } else if (event.source === 'automated' && event.fieldMode === 'replacement') {
    for (const field of automatedLineageFields(current.lineage)) {
      if (!Object.prototype.hasOwnProperty.call(event.fields, field)) {
        targetValues[field] = null;
        delete targetLineage[field];
      }
    }
  }

  for (const [field, value] of Object.entries(event.fields)) {
    const existingLineage = targetLineage[field];
    if (event.source === 'automated' && existingLineage && existingLineage.source !== 'automated') {
      if (targetValues[field] !== value) {
        return { blocked: `automated_field_conflicts_with_human_lineage:${field}` };
      }
      continue;
    }
    targetValues[field] = value;
    targetLineage[field] = { source: event.source, bindingVersion: transition.version };
  }

  let lineageJson;
  try {
    lineageJson = serializeIdentityFieldLineage(targetLineage, {
      values: targetValues,
      currentBindingVersion: transition.version,
    });
  } catch (error) {
    fail('invalid_transition', error.message);
  }

  const committedBinding = transition.keepBinding
    ? {
        ...current.binding,
        derivedBindingVersion: event.source === 'automated' && event.fieldMode === 'replacement'
          ? transition.version
          : current.binding.derivedBindingVersion,
      }
    : {
        bindingVersion: transition.version,
        bindingSource: event.source,
        bindingAnchor: event.anchor,
        boundAt: event.boundAt,
        derivedBindingVersion: event.source === 'automated' ? transition.version : null,
      };
  const tuple = validateIdentityBindingTuple(committedBinding);
  if (!tuple.ok) fail('invalid_transition', tuple.errors.join('; '));

  const patch = {
    wmkf_identitybindingversion: committedBinding.bindingVersion,
    wmkf_identitybindingsource: committedBinding.bindingSource,
    wmkf_identitybindinganchor: committedBinding.bindingAnchor,
    wmkf_identityboundat: committedBinding.boundAt,
    wmkf_identityderivedbindingversion: committedBinding.derivedBindingVersion,
    wmkf_identityfieldlineagejson: lineageJson,
    ...targetValues,
    ...event.decisionPatch,
  };
  return { patch, committedBinding, lineageJson, targetValues };
}

function rowComparable(current) {
  return {
    wmkf_identitybindingversion: current.binding.bindingVersion,
    wmkf_identitybindingsource: current.binding.bindingSource,
    wmkf_identitybindinganchor: current.binding.bindingAnchor,
    wmkf_identityboundat: current.binding.boundAt,
    wmkf_identityderivedbindingversion: current.binding.derivedBindingVersion,
    wmkf_identityfieldlineagejson: current.lineageJson,
    ...current.values,
    ...current.decision,
  };
}

function patchesEqual(left, right) {
  return COMPLETE_PATCH_FIELDS.every((field) => (left[field] ?? null) === (right[field] ?? null));
}

export function planIdentityBindingTransition(row, rawEvent) {
  const event = normalizeEvent(rawEvent);
  const current = loadCurrentState(row);
  const transition = determineTransition(current, event);
  if (transition.blocked) return blocked(transition.blocked, current, event);

  const prepared = prepareTarget(current, event, transition);
  if (prepared.blocked) return blocked(prepared.blocked, current, event);
  const currentComparable = rowComparable(current);
  const equal = patchesEqual(currentComparable, prepared.patch);

  if (transition.exactHumanReplay && !equal) {
    return blocked('event_replay_payload_mismatch', current, event);
  }
  if (transition.exactAutomatedReplayTime && !equal) {
    return blocked('automated_replay_payload_mismatch', current, event);
  }
  if (equal) transition.outcome = 'noop';

  const clearedFields = IDENTITY_LINEAGE_FIELDS.filter(
    (field) => current.values[field] !== null && prepared.targetValues[field] === null,
  );
  return {
    outcome: transition.outcome,
    reason: transition.outcome === 'noop' ? 'materially_identical' : null,
    expectedEtag: current.etag,
    eventIdentity: { source: event.source, anchor: event.anchor, boundAt: event.boundAt },
    previousBinding: current.binding,
    committedBinding: prepared.committedBinding,
    personPatch: transition.outcome === 'noop' ? null : prepared.patch,
    clearedFields,
    lineageJson: prepared.lineageJson,
    invalidateSuggestionCoi: transition.outcome === 'init' || transition.outcome === 'rebind',
    downstreamEligible: false,
  };
}

export async function writeReviewerIdentityBinding(
  { potentialReviewerId, event, actingUserSystemId } = {},
  deps = {},
) {
  if (!potentialReviewerId) fail('invalid_event', 'potentialReviewerId is required');
  const researcher = deps.researcher || researcherAdapter;

  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const row = await researcher.getIdentityBindingForUpdate(potentialReviewerId);
    const plan = planIdentityBindingTransition(row, event);
    if (!plan.personPatch) return plan;
    try {
      await researcher.patchIdentityBinding(potentialReviewerId, plan.personPatch, {
        ifMatch: plan.expectedEtag,
        actingUserSystemId,
      });
      return plan;
    } catch (error) {
      if (error?.status !== 412) throw error;
      if (attempt === MAX_WRITE_ATTEMPTS - 1) {
        const conflict = new IdentityBindingWriteError(
          'concurrent_update_exhausted',
          `identity binding changed during all ${MAX_WRITE_ATTEMPTS} write attempts`,
        );
        conflict.status = 409;
        throw conflict;
      }
    }
  }
  fail('concurrent_update_exhausted', 'identity binding retry loop exhausted');
}
