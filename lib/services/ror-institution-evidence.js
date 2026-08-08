'use strict';

/**
 * Local claim parsing and evidence features for ROR institution resolution.
 * Provider rank and `chosen` are exposed as features only; callers must apply
 * the local veto/scoring policy before selecting an institution.
 */

const STATE_NAMES_BY_CODE = Object.freeze({
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
  KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts',
  MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico',
  NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  DC: 'District of Columbia',
});
const ACRONYM_STOP_WORDS = new Set([
  ...Object.keys(STATE_NAMES_BY_CODE), 'UC', 'UK', 'US', 'USA',
]);
const LOCALITY_EVIDENCE = Object.freeze({
  'https://ror.org/0168r3w48': Object.freeze({
    aliases: Object.freeze(['La Jolla']),
    sources: Object.freeze([
      'https://blink.ucsd.edu/technology/help-desk/directory/address.html',
    ]),
  }),
});
const ORG_TERM = /\b(university|college|institute|institution|hospital|laboratory|lab|school|center|centre|system|foundation|academy|health)\b/i;
const COMMA_ORG_TERM = /\b(university|institute|institution|hospital|laboratory|lab|school|center|centre|system|foundation|academy|health)\b|\bcollege\s+of\b|\bcollege$/i;
const GENERIC_ACADEMIC_SUBUNIT = /^(?:school|college|faculty)\s+of\s+(?:arts(?:\s+and\s+sciences)?|business|dentistry|education|engineering|health\s+sciences?|humanities|law|management|medicine|nursing|pharmacy|public\s+health|public\s+policy|sciences?|social\s+work)$/i;
const MAX_ORGANIZATION_SPANS = 5;
const BRAND_NOISE = new Set([
  'academy', 'center', 'centre', 'college', 'foundation', 'health', 'hospital',
  'institute', 'institution', 'lab', 'laboratory', 'of', 'school', 'system', 'the',
  'university',
]);

function localityAliases(candidate) {
  return LOCALITY_EVIDENCE[candidate?.ror_id]?.aliases || [];
}

function collapseDottedInitialisms(value) {
  return String(value || '').replace(/\b(?:[A-Za-z]\.){2,}/g, (match) => match.replace(/\./g, ''));
}

function normalizeText(value) {
  return collapseDottedInitialisms(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsPhrase(haystack, needle) {
  const left = normalizeText(haystack);
  const right = normalizeText(needle);
  return !!right && ` ${left} `.includes(` ${right} `);
}

function normalizedClaimVariants(value) {
  const normalized = normalizeText(value);
  const variants = new Set([normalized]);
  const stateUniversity = normalized.match(/^([a-z]{2}) state university$/);
  const stateName = stateUniversity && STATE_NAMES_BY_CODE[stateUniversity[1].toUpperCase()];
  if (stateName) variants.add(`${normalizeText(stateName)} state university`);
  return [...variants].filter(Boolean);
}

function explicitAcronyms(value) {
  const raw = collapseDottedInitialisms(value);
  const found = new Set();
  for (const match of raw.matchAll(/(?:^|[^A-Za-z0-9])([A-Z][A-Z0-9]{1,9})(?=$|[^A-Za-z0-9])/g)) {
    if (!ACRONYM_STOP_WORDS.has(match[1])) found.add(match[1]);
  }
  return [...found];
}

function candidateSignals(candidate, evidence = {}) {
  const text = String(evidence.affiliation_string || '');
  const normalized = normalizeText(text);
  const claimVariants = normalizedClaimVariants(text);
  const names = candidate.names || [];
  let exactName = false;
  let phraseName = false;
  let matchedNameTokens = 0;
  let acronym = false;
  let namePrefix = false;
  let namePrefixExtraTokens = 0;
  let genericSuffixCompletion = false;
  const acronyms = new Set(explicitAcronyms(text));

  for (const name of names) {
    const normalizedName = normalizeText(name.value);
    if (!normalizedName) continue;
    const tokenCount = normalizedName.split(' ').length;
    if (claimVariants.includes(normalizedName)) {
      exactName = true;
      matchedNameTokens = Math.max(matchedNameTokens, tokenCount);
    } else if (tokenCount >= 2 && containsPhrase(text, name.value)) {
      phraseName = true;
      matchedNameTokens = Math.max(matchedNameTokens, tokenCount);
    }
    const claimTokens = normalized.split(' ');
    const nameTokens = normalizedName.split(' ');
    if (claimTokens.length >= 2 && nameTokens.length > claimTokens.length
      && nameTokens.slice(0, claimTokens.length).join(' ') === normalized) {
      namePrefix = true;
      const suffix = nameTokens.slice(claimTokens.length);
      const extra = suffix.length;
      namePrefixExtraTokens = namePrefixExtraTokens === 0
        ? extra
        : Math.min(namePrefixExtraTokens, extra);
      if (suffix.every((token) => [
        'academy', 'center', 'college', 'foundation', 'hospital', 'institute', 'laboratory',
        'school', 'university',
      ].includes(token))) genericSuffixCompletion = true;
    }
    if (name.types?.includes('acronym')) {
      const compact = String(name.value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      if (compact && acronyms.has(compact)) acronym = true;
    }
  }

  const domains = evidence.domain_evidence == null
    ? []
    : Array.isArray(evidence.domain_evidence) ? evidence.domain_evidence : [evidence.domain_evidence];
  const normalizedDomains = domains.map((domain) => String(domain).trim().toLowerCase());
  const domainMatch = normalizedDomains.length > 0
    && normalizedDomains.some((domain) => candidate.domains?.some((value) => value.toLowerCase() === domain));
  const cities = [
    ...(candidate.locations || []).map((location) => location.city).filter(Boolean),
    ...localityAliases(candidate),
  ];
  const cityMatch = cities.some((city) => containsPhrase(text, city));
  const country = String(evidence.country_code || '').trim().toUpperCase();
  const countryMatch = !!country
    && candidate.locations?.some((location) => location.country_code === country);

  return {
    acronym,
    city_match: cityMatch,
    country_match: countryMatch,
    domain_match: domainMatch,
    exact_name: exactName,
    generic_suffix_completion: genericSuffixCompletion,
    matched_name_tokens: matchedNameTokens,
    name_prefix: namePrefix,
    name_prefix_extra_tokens: namePrefixExtraTokens,
    name_phrase: phraseName,
    provider_chosen: candidate.retrieval?.some((source) => source.provider_chosen) || false,
  };
}

function parentAcronymScope(candidate, evidence = {}) {
  const acronyms = explicitAcronyms(evidence.affiliation_string);
  if (!acronyms.length) return false;
  return (candidate.relationships || []).some((relationship) => {
    if (relationship.type !== 'parent' || !relationship.label) return false;
    const initials = normalizeText(relationship.label)
      .split(' ')
      .filter((token) => !['of', 'the', 'system'].includes(token))
      .map((token) => token[0])
      .join('')
      .toUpperCase();
    return initials.length >= 2 && acronyms.some((acronym) => acronym.startsWith(initials));
  });
}

function hasStrongLexicalMatch(candidate, evidence) {
  const signals = candidateSignals(candidate, evidence);
  return signals.exact_name || signals.name_phrase || signals.acronym;
}

function organizationLike(value) {
  return ORG_TERM.test(value) || explicitAcronyms(value).length > 0;
}

function commaOrganizationLike(value) {
  const trimmed = String(value || '').trim();
  if (GENERIC_ACADEMIC_SUBUNIT.test(trimmed)) return false;
  return COMMA_ORG_TERM.test(trimmed)
    || (/^[A-Z][A-Z0-9.]{1,10}$/.test(trimmed) && explicitAcronyms(trimmed).length > 0);
}

function sharesDepartmentBrand(parts) {
  const brandSets = parts.map((part) => new Set(
    normalizeText(part).split(' ').filter((token) => token && !BRAND_NOISE.has(token)),
  ));
  return brandSets.length > 1 && [...brandSets[0]].some((token) => (
    brandSets.slice(1).every((tokens) => tokens.has(token))
  ));
}

function brandedConjunction(value) {
  return /\b(department|dept|division|faculty|program)\b[^,]*\band\b[^,]*(?:,|$)/i.test(value)
    || /\b(institute|center|centre|school)\s+of\s+.+\s+and\s+.+/i.test(value);
}

function parseOrganizationSpans(value) {
  const text = String(value || '').trim();
  if (!text) return { spans: [], issue: null };
  const spans = [];
  for (const semicolonPart of text.split(/\s*;\s*/).filter(Boolean)) {
    const commaParts = semicolonPart.split(/\s*,\s*/).filter(Boolean);
    const commaOrganizations = commaParts.filter(commaOrganizationLike);
    const departmentHierarchy = /^(department|dept|division|faculty|program)\b/i.test(semicolonPart)
      && sharesDepartmentBrand(commaOrganizations);
    if (commaOrganizations.length > 1 && !departmentHierarchy) {
      return { spans: [], issue: 'unparsed_multi_organization_delimiter' };
    }
    const andParts = semicolonPart.split(/\s+and\s+/i);
    if (andParts.length > 1) {
      if (andParts.every(organizationLike)) {
        spans.push(...andParts.map((part) => part.trim()));
      } else if (brandedConjunction(semicolonPart)) {
        spans.push(semicolonPart);
      } else {
        return { spans: [], issue: 'unparsed_organization_conjunction' };
      }
    } else {
      spans.push(semicolonPart);
    }
  }
  const unique = new Map();
  for (const span of spans) {
    const trimmed = span.trim();
    const key = normalizeText(trimmed);
    if (key && !unique.has(key)) unique.set(key, trimmed);
  }
  if (unique.size > MAX_ORGANIZATION_SPANS) {
    return { spans: [], issue: 'organization_span_overflow' };
  }
  return { spans: [...unique.values()], issue: null };
}

function ordinaryFallbackQueries(value) {
  const text = collapseDottedInitialisms(value).trim();
  if (!text) return [];
  const queries = [];
  const normalized = normalizeText(text);
  const acronyms = explicitAcronyms(text);
  if (/^[A-Za-z0-9.\s]+$/.test(text) && normalized.split(' ').length <= 2 && acronyms.length) {
    queries.push(...acronyms);
  } else {
    queries.push(text);
    const commaParts = text.split(/\s*,\s*/).filter(Boolean);
    for (let index = 0; index < commaParts.length; index += 1) {
      if (!ORG_TERM.test(commaParts[index])) continue;
      queries.push(commaParts[index]);
      if (index + 1 < commaParts.length && ORG_TERM.test(commaParts[index])) {
        queries.push(`${commaParts[index]}, ${commaParts[index + 1]}`);
      }
      break;
    }
  }
  const unique = new Map();
  const stateUniversity = text.match(/^([A-Z]{2})\s+State University$/);
  if (stateUniversity && STATE_NAMES_BY_CODE[stateUniversity[1]]) {
    queries.push(`${STATE_NAMES_BY_CODE[stateUniversity[1]]} State University`);
  }
  for (const query of queries) {
    const key = normalizeText(query);
    if (key && !unique.has(key)) unique.set(key, query.trim());
  }
  return [...unique.values()].slice(0, 3);
}

module.exports = {
  LOCALITY_EVIDENCE,
  STATE_NAMES_BY_CODE,
  candidateSignals,
  collapseDottedInitialisms,
  containsPhrase,
  explicitAcronyms,
  hasStrongLexicalMatch,
  localityAliases,
  normalizeText,
  ordinaryFallbackQueries,
  parentAcronymScope,
  parseOrganizationSpans,
};
