'use strict';

const {
  collapseDottedInitialisms,
  explicitAcronyms,
  normalizeText,
  STATE_NAMES_BY_CODE,
} = require('./text-evidence');

const ORG_TERM = /\b(university|college|institute|institution|hospital|laboratory|lab|school|center|centre|system|foundation|academy|health)\b/i;
const MAX_ORGANIZATION_SPANS = 5;

function organizationLike(value) {
  return ORG_TERM.test(value) || explicitAcronyms(value).length > 0;
}

function commaOrganizationLike(value) {
  const trimmed = String(value || '').trim();
  return ORG_TERM.test(trimmed)
    || (/^[A-Z][A-Z0-9.]{1,10}$/.test(trimmed) && explicitAcronyms(trimmed).length > 0);
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
    if (commaParts.filter(commaOrganizationLike).length > 1) {
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

function organizationSpans(value) {
  return parseOrganizationSpans(value).spans;
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

module.exports = { ordinaryFallbackQueries, organizationSpans, parseOrganizationSpans };
