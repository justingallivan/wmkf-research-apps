'use strict';

const { createHash } = require('crypto');
const { ContactParser } = require('../../lib/utils/contact-parser');
const { SerpContactService } = require('../../lib/services/serp-contact-service');
const { hostWithinDomain } = require('../../lib/utils/safe-fetch');

const PRIMARY_SUBJECT_KEYS = Object.freeze([
  '447c3e850f38a5ed',
  'ff7cf17f75549975',
  'af89e2798f36c1d5',
  'cc0934436ded625e',
  '4c78e4ac2e1ecce2',
  'e34c103f67d73eed',
  'f7a9e2139dca4961',
  '5438881790cc27bb',
  '5aa9e04ab2486f4b',
  '6b6b78e191fd91b7',
  '76f132fb756f39f4',
  '99c6c4c1d927e2d3',
  'ddc0f8e4413de19c',
]);

const CONTROL_VIEWS = Object.freeze([
  { name: 'David Liu', affiliation: 'Harvard University', personSeed: 'david-liu', viewSeed: 'harvard' },
  { name: 'David Liu', affiliation: 'Broad Institute', personSeed: 'david-liu', viewSeed: 'broad' },
  { name: 'Feng Zhang', affiliation: 'Massachusetts Institute of Technology', personSeed: 'feng-zhang', viewSeed: 'mit' },
  { name: 'Feng Zhang', affiliation: 'Broad Institute', personSeed: 'feng-zhang', viewSeed: 'broad' },
]);

function stableHash(value, length = 16) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, length);
}

function normalizedUrl(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function fingerprintSubjects(subjects) {
  return createHash('sha256')
    .update(JSON.stringify(subjects.map((subject) => ({
      subjectKey: subject.subjectKey,
      subjectViewKey: subject.subjectViewKey || null,
      personKey: subject.personKey || subject.subjectKey,
      name: subject.name,
      affiliation: subject.affiliation,
      control: subject.control === true,
    }))))
    .digest('hex');
}

function selectFrozenPrimarySubjects(artifact, expectedKeys = PRIMARY_SUBJECT_KEYS) {
  const byKey = new Map((artifact?.results || []).map((row) => [row.subjectKey, row]));
  return expectedKeys.map((subjectKey) => {
    const source = byKey.get(subjectKey);
    if (!source) throw new Error(`Frozen primary subject missing from source artifact: ${subjectKey}`);
    if (!source.name || !source.affiliation) {
      throw new Error(`Frozen primary subject lacks name/affiliation: ${subjectKey}`);
    }
    if (!Array.isArray(source.references) || source.references.length !== 0) {
      throw new Error(`Frozen primary subject is no longer a no-reference hard case: ${subjectKey}`);
    }
    return {
      subjectKey,
      subjectViewKey: subjectKey,
      personKey: subjectKey,
      name: source.name,
      affiliation: source.affiliation,
      control: false,
    };
  });
}

function buildControlViews() {
  return CONTROL_VIEWS.map((view) => ({
    subjectKey: `control-${stableHash(`${view.personSeed}|${view.viewSeed}`)}`,
    subjectViewKey: `control-view-${stableHash(`${view.personSeed}|${view.viewSeed}`)}`,
    personKey: `control-person-${stableHash(view.personSeed)}`,
    name: view.name,
    affiliation: view.affiliation,
    control: true,
  }));
}

function cleanInstitution(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function buildQueries(subject, prepass) {
  const cleanName = ContactParser.stripHonorifics(subject.name);
  const claimedInstitution = cleanInstitution(subject.affiliation);
  const resolvedInstitution = cleanInstitution(
    prepass?.effectiveInstitution
      || prepass?.openAlexAffiliation
      || prepass?.affiliation
      || subject.affiliation
  );
  const topEvaluationDomain = (
    prepass?.evaluationDomains
    || prepass?.anchoredDomains
    || prepass?.plausibleDomains
    || []
  )[0] || null;
  return {
    current: claimedInstitution
      ? `"${cleanName}" ${claimedInstitution} email`
      : `"${cleanName}" email`,
    pageFirst: [
      resolvedInstitution ? `"${cleanName}" ${resolvedInstitution}` : `"${cleanName}"`,
      topEvaluationDomain ? `"${cleanName}" site:${topEvaluationDomain}` : null,
    ].filter(Boolean),
  };
}

function experimentDomainEvidence(prepass = {}) {
  const anchored = Array.isArray(prepass.anchoredDomains) ? prepass.anchoredDomains : [];
  if (anchored.length) return { basis: 'identity_anchored', domains: anchored };
  const plausible = Array.isArray(prepass.plausibleDomains) ? prepass.plausibleDomains : [];
  if (plausible.length) return { basis: 'claimed_institution_strong_match', domains: plausible };
  return { basis: 'none', domains: [] };
}

function prepassOptions() {
  return {
    persist: false,
    usePubmed: false,
    useOrcid: false,
    useClaudeSearch: false,
    useSerpSearch: false,
  };
}

function pageSignals(item, subject) {
  const link = String(item?.link || '');
  const title = String(item?.title || '');
  const snippet = String(item?.snippet || '');
  const haystack = `${link} ${title} ${snippet}`.toLowerCase();
  const cleanName = ContactParser.stripHonorifics(subject.name || '');
  const nameTokens = ContactParser.nameTokensForUrlMatch(cleanName);
  const surname = nameTokens[nameTokens.length - 1] || '';
  return {
    nameHit: nameTokens.some((token) => token.length >= 3 && haystack.includes(token)),
    surnameHit: surname.length >= 3 && haystack.includes(surname),
    profileHit: /\b(faculty|profile|bio|person|people|investigator|researcher|scientist)\b/i.test(haystack),
    labHit: /\b(lab|laborator(?:y|ies)|research group)\b/i.test(haystack),
    genericDirectory: /\/(?:people|directory|faculty|staff|members|team)\/?(?:[?#].*)?$/i.test(link),
    publicationLike: /\/(?:publications?|papers?|news|articles?|events?)\b/i.test(link),
  };
}

function assessOrganicUrl(item, subject, anchoredDomains) {
  const record = {
    position: Number.isFinite(item?.position) ? item.position : null,
    title: typeof item?.title === 'string' ? item.title.slice(0, 500) : null,
    url: typeof item?.link === 'string' ? item.link : null,
    host: null,
    snippet: typeof item?.snippet === 'string' ? item.snippet.slice(0, 1000) : null,
    eligible: false,
    reason: null,
    score: null,
  };
  let parsed;
  try {
    parsed = new URL(record.url);
  } catch {
    return { ...record, reason: 'invalid_url' };
  }
  record.host = parsed.hostname.toLowerCase();
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { ...record, reason: 'unsupported_protocol' };
  }
  if (ContactParser.isDocumentUrl(record.url)) {
    return { ...record, reason: 'document_url' };
  }
  const anchoredDomain = (anchoredDomains || []).find((domain) =>
    hostWithinDomain(record.host, domain)
  );
  if (!anchoredDomain) {
    return { ...record, reason: 'host_not_anchored' };
  }

  const signals = pageSignals(item, subject);
  const positionPenalty = Number.isFinite(record.position) ? Math.min(record.position, 20) : 20;
  record.eligible = true;
  record.reason = 'anchored_first_party_page';
  record.anchoredDomain = anchoredDomain;
  record.signals = signals;
  record.score =
    (signals.surnameHit ? 45 : 0)
    + (signals.nameHit ? 20 : 0)
    + (signals.profileHit ? 20 : 0)
    + (signals.labHit ? 12 : 0)
    - (signals.genericDirectory ? 35 : 0)
    - (signals.publicationLike ? 25 : 0)
    - positionPenalty;
  return record;
}

function rankCandidatePageUrls(organicResults, subject, anchoredDomains, limit = 2) {
  const decisions = (organicResults || []).map((item) =>
    assessOrganicUrl(item, subject, anchoredDomains)
  );
  const seen = new Set();
  const selected = decisions
    .filter((decision) => decision.eligible)
    .sort((a, b) => b.score - a.score || (a.position || 999) - (b.position || 999))
    .filter((decision) => {
      const normalized = normalizedUrl(decision.url);
      if (!normalized || seen.has(normalized)) return false;
      seen.add(normalized);
      decision.normalizedUrl = normalized;
      return true;
    })
    .slice(0, limit);
  return { decisions, selected };
}

function manualOutcomeId({ personKey, email, sourceUrl }) {
  return stableHash(`${personKey}|${String(email || '').toLowerCase()}|${normalizedUrl(sourceUrl) || sourceUrl}`, 24);
}

function buildManualReviewRows(results, cap = 25) {
  const byId = new Map();
  for (const result of results || []) {
    for (const armName of ['current', 'pageFirst']) {
      const arm = result?.arms?.[armName];
      if (!arm || arm.emailAction !== 'ready' || arm.emailSource !== 'institution_page') continue;
      const sourceUrl = arm.emailEvidence?.sourceUrl || null;
      const outcomeId = manualOutcomeId({
        personKey: result.personKey,
        email: arm.email,
        sourceUrl,
      });
      if (!byId.has(outcomeId)) {
        byId.set(outcomeId, {
          outcomeId,
          candidate: result.name,
          claimedAffiliation: result.affiliation,
          email: arm.email,
          sourcePage: sourceUrl,
          identityStatus: result.prepass?.identityStatus || null,
          control: result.control === true,
          adjudication: null,
        });
      }
    }
  }
  const rows = [...byId.values()].sort((a, b) => a.outcomeId.localeCompare(b.outcomeId));
  if (rows.length > cap) {
    throw new Error(`Manual-review cap exceeded: ${rows.length} rows (cap ${cap})`);
  }
  return rows;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function summarizeResults(results, callsAttempted) {
  const primary = (results || []).filter((row) => row.control !== true);
  const controls = (results || []).filter((row) => row.control === true);
  const armSummary = (rows, armName) => {
    const arms = rows.map((row) => row.arms?.[armName]).filter(Boolean);
    return {
      attemptedSubjects: rows.length,
      completed: arms.filter((arm) => arm.status === 'completed').length,
      readySubjects: arms.filter((arm) => arm.emailAction === 'ready').length,
      abstained: arms.filter((arm) => arm.status === 'abstained').length,
      errors: arms.filter((arm) => arm.status === 'error').length,
      medianSearchLatencyMs: median(arms.flatMap((arm) =>
        (arm.searches || []).map((search) => search.latencyMs)
      )),
      medianEndToEndLatencyMs: median(arms.map((arm) => arm.latencyMs)),
    };
  };
  return {
    subjects: results.length,
    primarySubjects: primary.length,
    controlViews: controls.length,
    callsAttempted,
    primary: {
      current: armSummary(primary, 'current'),
      pageFirst: armSummary(primary, 'pageFirst'),
    },
    controls: {
      current: armSummary(controls, 'current'),
      pageFirst: armSummary(controls, 'pageFirst'),
    },
  };
}

async function mapWithConcurrency(items, concurrency, worker, onComplete = null) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next++;
      const value = await worker(items[index], index);
      results[index] = value;
      if (onComplete) await onComplete(value, index, results);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

module.exports = {
  PRIMARY_SUBJECT_KEYS,
  assessOrganicUrl,
  buildControlViews,
  buildManualReviewRows,
  buildQueries,
  experimentDomainEvidence,
  fingerprintSubjects,
  mapWithConcurrency,
  manualOutcomeId,
  prepassOptions,
  rankCandidatePageUrls,
  selectFrozenPrimarySubjects,
  summarizeResults,
};
