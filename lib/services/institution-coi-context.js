import { createHash } from 'crypto';
import { DeduplicationService } from './deduplication-service.js';

export const INSTITUTION_COI_CONTEXT_CONTRACT = 'wmkf.identity-institution-coi-context';
export const INSTITUTION_COI_CONTEXT_VERSION = 1;
export const INSTITUTION_COI_RULE_VERSION = 'institution-coi-v1';

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function canonicalInstitution(entry) {
  const input = DeduplicationService.institutionInput(entry?.identity ?? entry);
  const display = DeduplicationService.institutionDisplayName(input);
  const baseName = DeduplicationService.normalizeInstitution(display);
  const expandedName = DeduplicationService.normalizeInstitution(
    DeduplicationService.expandInstitutionAbbreviations(baseName),
  );
  const openAlexId = DeduplicationService.normalizeOpenAlexInstitutionId(input.openAlexId)
    || DeduplicationService.normalizeOpenAlexInstitutionId(input.ror)
    || null;
  const ror = DeduplicationService.normalizeRorId(input.ror)
    || (!DeduplicationService.normalizeOpenAlexInstitutionId(input.openAlexId)
      ? DeduplicationService.normalizeRorId(input.openAlexId)
      : null)
    || null;
  if (!baseName && !openAlexId && !ror) {
    throw new Error('canonicalizeInstitutionCoiContext: institution has no canonical identity');
  }
  return {
    baseName: baseName || null,
    expandedName: expandedName || null,
    openAlexId,
    ror,
  };
}

export function canonicalizeInstitutionCoiContext({
  requestId,
  institutionEntries,
  authority,
  ruleVersion = INSTITUTION_COI_RULE_VERSION,
} = {}) {
  if (authority !== 'server_loaded') {
    throw new Error('canonicalizeInstitutionCoiContext: server_loaded authority is required');
  }
  if (!GUID_RE.test(requestId || '')) {
    throw new Error('canonicalizeInstitutionCoiContext: requestId must be a GUID');
  }
  if (!Array.isArray(institutionEntries) || institutionEntries.length === 0) {
    throw new Error('canonicalizeInstitutionCoiContext: at least one institution is required');
  }
  if (typeof ruleVersion !== 'string' || !ruleVersion.trim() || ruleVersion.length > 100) {
    throw new Error('canonicalizeInstitutionCoiContext: ruleVersion is invalid');
  }

  const byTuple = new Map();
  for (const entry of institutionEntries) {
    const canonical = canonicalInstitution(entry);
    const key = JSON.stringify(canonical);
    if (!byTuple.has(key)) byTuple.set(key, canonical);
  }
  const institutions = [...byTuple.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([, institution]) => institution);

  return {
    contract: INSTITUTION_COI_CONTEXT_CONTRACT,
    version: INSTITUTION_COI_CONTEXT_VERSION,
    ruleVersion: ruleVersion.trim(),
    requestId: requestId.toLowerCase(),
    institutions,
  };
}

export function hashInstitutionCoiContext(input) {
  const canonical = canonicalizeInstitutionCoiContext(input);
  const serialized = JSON.stringify(canonical);
  return {
    canonical,
    serialized,
    hash: createHash('sha256').update(serialized, 'utf8').digest('hex'),
  };
}
