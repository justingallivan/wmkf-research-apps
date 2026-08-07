'use strict';

const { collapseDottedInitialisms, explicitAcronyms, normalizeText } = require('./text-evidence');

const ORG_TERM = /\b(university|college|institute|institution|hospital|laboratory|lab|school|center|centre|system|foundation|academy|health)\b/i;
const STATE_UNIVERSITY_EXPANSIONS = new Map([
  ['NC', 'North Carolina'],
]);

function organizationSpans(value) {
  const text = String(value || '').trim();
  if (!text) return [];
  const spans = [];
  for (const semicolonPart of text.split(/\s*;\s*/).filter(Boolean)) {
    const andParts = semicolonPart.split(/\s+and\s+/i);
    if (andParts.length > 1 && andParts.every((part) => ORG_TERM.test(part))) {
      spans.push(...andParts);
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
  return [...unique.values()].slice(0, 5);
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
  if (stateUniversity && STATE_UNIVERSITY_EXPANSIONS.has(stateUniversity[1])) {
    queries.push(`${STATE_UNIVERSITY_EXPANSIONS.get(stateUniversity[1])} State University`);
  }
  for (const query of queries) {
    const key = normalizeText(query);
    if (key && !unique.has(key)) unique.set(key, query.trim());
  }
  return [...unique.values()].slice(0, 3);
}

function supplementalEvidenceQueries(value) {
  const normalized = normalizeText(value);
  const queries = [];
  if (containsWholePhrase(normalized, 'la jolla')) queries.push('UCSD');
  return queries;
}

function containsWholePhrase(haystack, needle) {
  return ` ${haystack} `.includes(` ${needle} `);
}

module.exports = { ordinaryFallbackQueries, organizationSpans, supplementalEvidenceQueries };
