const CATEGORIES = new Set([
  'signature_match',
  'blocked_content',
  'invalid_or_protected_file',
  'unspecified',
]);

const BLOCKED_CONTENT_FLAGS = new Set([
  'embedded_executable',
  'embedded_macro',
  'embedded_script',
  'embedded_ole_object',
  'xml_external_entities',
  'insecure_deserialization',
  'unsafe_archive',
  'unwanted_action',
]);
const INVALID_OR_PROTECTED_FLAGS = new Set([
  'password_protected_file',
  'invalid_file',
  'restricted_file_format',
]);
const FLAGS = new Set([...BLOCKED_CONTENT_FLAGS, ...INVALID_OR_PROTECTED_FLAGS]);
const FLAG_LABELS = Object.freeze({
  embedded_executable: 'embedded executable',
  embedded_macro: 'embedded macro',
  embedded_script: 'embedded script',
  embedded_ole_object: 'embedded OLE object',
  xml_external_entities: 'unsafe XML external entity',
  insecure_deserialization: 'insecure serialized content',
  unsafe_archive: 'unsafe archive content',
  unwanted_action: 'automatic action',
  password_protected_file: 'password protection',
  invalid_file: 'an invalid file structure',
  restricted_file_format: 'a restricted file format',
});

/** Strictly project the public scan diagnostic. Provider text is never accepted. */
export function sanitizeSiteVisitMaterialsScanRejection(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((key) => !['category', 'flags'].includes(key))
    || !CATEGORIES.has(value.category)
    || !Array.isArray(value.flags)
    || value.flags.length > FLAGS.size
    || value.flags.some((flag) => typeof flag !== 'string' || !FLAGS.has(flag))
    || new Set(value.flags).size !== value.flags.length) return null;

  const flags = [...value.flags];
  if (value.category === 'blocked_content' && !flags.some((flag) => BLOCKED_CONTENT_FLAGS.has(flag))) return null;
  if (value.category === 'invalid_or_protected_file'
    && (!flags.some((flag) => INVALID_OR_PROTECTED_FLAGS.has(flag))
      || flags.some((flag) => BLOCKED_CONTENT_FLAGS.has(flag)))) return null;
  if (value.category === 'unspecified' && flags.length > 0) return null;
  return { category: value.category, flags };
}

export function siteVisitMaterialsScanRejectionMessage(value) {
  const diagnostic = sanitizeSiteVisitMaterialsScanRejection(value);
  if (!diagnostic) return 'This file did not pass the security check, and the scanner did not provide a specific reason. Please choose a different file.';
  if (diagnostic.category === 'signature_match') {
    return 'The security scan identified a known threat. This file was not accepted. Please choose a different file.';
  }
  if (diagnostic.category === 'blocked_content') {
    const details = diagnostic.flags.map((flag) => FLAG_LABELS[flag]).join(', ');
    return `The security scan rejected this file because it contains ${details}. Remove the blocked content and upload a new copy, or contact the Program Coordinator for help.`;
  }
  if (diagnostic.category === 'invalid_or_protected_file') {
    const details = diagnostic.flags.map((flag) => FLAG_LABELS[flag]).join(', ');
    return `The security scan could not accept this file because it has ${details}. Please provide an unlocked file in an accepted format.`;
  }
  return 'This file did not pass the security check, and the scanner did not provide a specific reason. Please choose a different file.';
}

export function siteVisitMaterialsScanRejectionReason(value) {
  const diagnostic = sanitizeSiteVisitMaterialsScanRejection(value);
  if (!diagnostic) return 'The scanner did not provide a specific reason.';
  if (diagnostic.category === 'signature_match') return 'The security scan identified a known threat.';
  if (diagnostic.category === 'blocked_content') {
    const details = diagnostic.flags.map((flag) => FLAG_LABELS[flag]).join(', ');
    return `The security scan found blocked content: ${details}.`;
  }
  if (diagnostic.category === 'invalid_or_protected_file') {
    const details = diagnostic.flags.map((flag) => FLAG_LABELS[flag]).join(', ');
    return `The security scan could not accept this file because it has ${details}.`;
  }
  return 'The scanner did not provide a specific reason.';
}
