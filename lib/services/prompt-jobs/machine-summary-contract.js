/** Closed Summary machine contract. Staff draft capability and Short Title grants stay separate. */
import { isGuid } from '../../utils/guid.js';
import { canonical, sha256, validateProfile } from './profile.js';
export const MACHINE_SUMMARY_TASK = 'proposal.executive-summary';
export const MACHINE_SUMMARY_FIELD = 'wmkf_layabstract';
export const SUMMARY_SOURCE_ERRORS = Object.freeze(['summary_source_missing', 'summary_source_pi_missing',
  'summary_source_ambiguous', 'summary_source_invalid_metadata', 'summary_source_changed', 'summary_source_too_large',
  'summary_source_invalid_file', 'summary_source_extraction_failed', 'summary_source_invalid_snapshot',
  'summary_source_invalid_manifest', 'summary_source_invalid_profile', 'summary_source_invalid_scope', 'summary_source_invalid_request']);
export function machineSummaryScope(scope) {
  const value = scope?.authorizationScope;
  if (!['local-sandbox', 'preview-sandbox', 'test-sandbox'].includes(scope?.environment)
    || typeof value !== 'string' || !value.startsWith('pa-executive-summary:')) return false;
  const id = value.slice('pa-executive-summary:'.length);
  return id.length === 36 && id === id.toLowerCase() && isGuid(id);
}
export function validateMachineSummaryProfile(profile) {
  validateProfile(profile);
  if (canonical(profile.documentRoles) !== canonical(['proposal']) || canonical(profile.recordNames) !== canonical(['pi_name'])) {
    throw new Error('Summary requires one narrative and the stored PI name');
  }
  return profile;
}
export function validateMachineSummarySpec(spec) {
  if (spec.contractVersion !== 1 || spec.outputSchema.parseMode !== 'raw'
    || canonical(spec.outputSchema.outputs[0]?.target) !== canonical({kind:'none'})
    || spec.variables.length !== 2
    || !spec.variables.some(v => v.name === 'proposal_context' && v.source.kind === 'prepared_context' && v.required === true)
    || !spec.variables.some(v => v.name === 'pi_name' && v.source.kind === 'frozen_record' && v.required === true)) {
    throw new Error('Summary machine task requires the destination-free narrative/PI contract');
  }
}
export function summarySnapshotMatches(snapshot, manifest) {
  const doc = snapshot?.documents?.[0], pi = snapshot?.records?.[0];
  return Array.isArray(snapshot?.documents) && Array.isArray(snapshot?.records) && snapshot?.version === 1 && !Object.hasOwn(snapshot, 'rosterSnapshot')
    && snapshot.documents.length === 1 && snapshot.records.length === 1
    && doc?.role === 'proposal' && doc.id === canonical([manifest.siteId, manifest.driveId, manifest.itemId])
    && doc.version === canonical([manifest.versionId, manifest.eTag]) && doc.extractionVersion === 'pdf-parse-text-v1'
    && !doc.components && pi?.name === 'pi_name' && pi.present === true
    && pi.provenance === `contact:${manifest.piContactId}:fullname` && sha256(pi.value) === manifest.piNameHash;
}
