/**
 * Provider-independent Tier-0 institution sameness.
 *
 * This classifier has deliberately one-sided authority: it may prove that two
 * affiliation strings are the SAME after narrow structural normalization, but
 * it never declares them distinct. Anything it cannot prove returns
 * `insufficient` and stays in the existing human-review path.
 *
 * It is not wired into production authority yet. The unresolved-case smoke
 * harness and unit tests exercise it in shadow so its false-clear boundary can
 * be reviewed before promotion.
 */

'use strict';

const ORGANIZATION_TERM = /\b(university|college|institute|institution|hospital|laboratory|lab|school|center|centre|system|foundation|academy|health|observatory)\b/i;
const ACADEMIC_DECORATION = /\b(department|dept\.?|division|faculty|program|programme|unit)\b/i;
const COUNTRY = /^(?:usa|u\.?s\.?a\.?|united states(?: of america)?|canada|uk|u\.?k\.?|united kingdom|england|scotland|wales|france|germany|india|china|australia)\.?$/i;
const REGION_OR_POSTAL = /^(?:(?:[A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?|(?:[A-Z]{2})\s+[A-Z]\d[A-Z]\s*\d[A-Z]\d|\d{5}(?:-\d{4})?|[A-Z]\d[A-Z]\s*\d[A-Z]\d)\.?$/i;
const STREET_OR_POSTAL = /\d/;
const EMAIL_DECORATION = /(?:\[email removed\]|electronic address|\S+@\S+)/i;
const ORGANIZATION_ACRONYM = /^[A-Z][A-Z0-9.&-]{2,11}$/;

function normalizeStructuralTokens(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[\u2010-\u2015-]+/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^the\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function commaParts(value) {
  return String(value || '').split(',').map((part) => part.trim()).filter(Boolean);
}

function hasMultipleRuns(value) {
  return String(value || '').split(';').map((run) => run.trim()).filter(Boolean).length > 1;
}

function prefixIsAcademicDecoration(parts) {
  return parts.length === 0 || (
    parts.some((part) => ACADEMIC_DECORATION.test(part))
      && parts.every((part) => !ORGANIZATION_TERM.test(part))
  );
}

function suffixIsLocationDecoration(parts) {
  if (parts.length === 0) return true;
  if (parts.some((part) => (
    ORGANIZATION_TERM.test(part)
      || (
        ORGANIZATION_ACRONYM.test(part)
          && !REGION_OR_POSTAL.test(part)
          && !COUNTRY.test(part)
      )
  ))) return false;
  const hasLocationAnchor = parts.some((part) => (
    COUNTRY.test(part)
      || REGION_OR_POSTAL.test(part)
      || STREET_OR_POSTAL.test(part)
      || EMAIL_DECORATION.test(part)
  ));
  const freeTextParts = parts.filter((part) => !(
    COUNTRY.test(part)
      || REGION_OR_POSTAL.test(part)
      || STREET_OR_POSTAL.test(part)
      || EMAIL_DECORATION.test(part)
  ));
  return hasLocationAnchor && freeTextParts.length <= 1;
}

// A bare "University of X" followed by a locality can name either a standalone
// university or a system/campus parent (for example University of California).
// Without registry evidence Tier 0 is not allowed to guess which, so it abstains.
function isAmbiguousBareUniversityOf(normalizedCore) {
  return /^university of [a-z0-9]+$/.test(normalizedCore);
}

function structuralMatchWithin(decoratedValue, recordedValue) {
  if (!decoratedValue || !recordedValue || hasMultipleRuns(decoratedValue)) return null;
  const parts = commaParts(decoratedValue);
  const recorded = normalizeStructuralTokens(recordedValue);
  if (!recorded || parts.length === 0) return null;

  for (let start = 0; start < parts.length; start += 1) {
    for (let end = start; end < parts.length; end += 1) {
      const candidateText = parts.slice(start, end + 1).join(', ');
      const candidate = normalizeStructuralTokens(candidateText);
      if (!candidate || candidate !== recorded || !ORGANIZATION_TERM.test(candidateText)) continue;

      const prefix = parts.slice(0, start);
      const suffix = parts.slice(end + 1);
      if (!prefixIsAcademicDecoration(prefix) || !suffixIsLocationDecoration(suffix)) continue;
      if (suffix.length > 0 && isAmbiguousBareUniversityOf(candidate)) continue;

      return {
        matchedCore: candidateText,
        ignoredPrefix: prefix,
        ignoredSuffix: suffix,
      };
    }
  }
  return null;
}

function classifyStructuralInstitutionSameness(left, right) {
  const normalizedLeft = normalizeStructuralTokens(left);
  const normalizedRight = normalizeStructuralTokens(right);
  if (!normalizedLeft || !normalizedRight) {
    return {
      verdict: 'insufficient',
      disposition: 'surface',
      reasonCode: 'missing_institution_operand',
      remedyId: 'confirm_identity',
    };
  }

  if (normalizedLeft === normalizedRight) {
    return {
      verdict: 'same',
      disposition: 'auto_clear',
      reasonCode: 'identical_organization_tokens',
      remedyId: null,
      matchedCore: left,
    };
  }

  const match = structuralMatchWithin(left, right) || structuralMatchWithin(right, left);
  if (match) {
    return {
      verdict: 'same',
      disposition: 'auto_clear',
      reasonCode: 'same_organization_with_safe_decoration',
      remedyId: null,
      ...match,
    };
  }

  return {
    verdict: 'insufficient',
    disposition: 'surface',
    reasonCode: 'insufficient_structural_evidence',
    remedyId: 'confirm_identity',
  };
}

module.exports = {
  classifyStructuralInstitutionSameness,
  normalizeStructuralTokens,
};
