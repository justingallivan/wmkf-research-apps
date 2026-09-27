/**
 * Pre-Site proposal-core diagnostic-entry validator, split out of
 * artifact-model.js (2026-09-27 fix) so it can be imported by a plain-Node
 * script without dragging that file's transitive graph (Dataverse adapters,
 * executePrompt, docx-renderer/JSZip, and extensionless ESM specifiers those
 * pull in that only Jest/Next resolve) along with it.
 *
 * Dependency-light on purpose: only `ServiceHttpError` (itself
 * dependency-free), with an explicit `.js` specifier so `node
 * scripts/*.mjs` (the Test Request Factory CLIs) can load it directly.
 * `artifact-model.js` imports and re-exports `validateDiagnostics` from here
 * unchanged, so every existing app caller is unaffected.
 */
import { ServiceHttpError } from '../service-http-error.js';

export function validateDiagnostics(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 100) {
    throw new ServiceHttpError('Pre-Site proposal-core diagnostics require reconciliation.', {
      httpStatus: 500,
      code: 'pre_site_visit_diagnostics_invalid',
    });
  }
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || typeof entry.code !== 'string' || !/^[a-z0-9_]{1,80}$/.test(entry.code)) {
      throw new ServiceHttpError('Pre-Site proposal-core diagnostics require reconciliation.', {
        httpStatus: 500,
        code: 'pre_site_visit_diagnostics_invalid',
      });
    }
    const diagnostic = { code: entry.code };
    for (const key of [
      'section', 'rosterDisplayName', 'path',
      'observedWords', 'observedChars', 'targetWords', 'targetChars',
      'observed', 'target', 'originalChars', 'transmittedChars',
      // Slice 4 (plan §4.5): referee_blocker_unnamed carries `reason`;
      // referee_name_not_matched and referee_expertise_missing carry `name`.
      'reason', 'name',
    ]) {
      if (typeof entry[key] === 'string') diagnostic[key] = entry[key].slice(0, 200);
      if (Number.isFinite(entry[key])) diagnostic[key] = Number(entry[key]);
      if (entry[key] === null) diagnostic[key] = null;
    }
    return diagnostic;
  });
}
