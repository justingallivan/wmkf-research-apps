#!/usr/bin/env node

/**
 * Read-only June–August 2026 retained-roster source recovery.
 *
 * Fetches only PubMed records and ORCID profiles already referenced by the
 * retained mismatch rows. Writes a local, gitignored adjudication packet with
 * no request IDs, candidate keys, emails, abstracts, or provider credentials.
 * A public byline/profile match is a source candidate, never a person bind or
 * an automatic institution-clear label. Run with:
 *   node --env-file=.env.local scripts/collect-institution-affiliation-source-packet.js
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { projectCase } = require('./audit-institution-affiliation-retrospective');
const { nameMatchEvidence } = require('../lib/services/discovery/name-matching');

const FROM = '2026-06-01';
const TO = '2026-09-01';
const OUTPUT = path.resolve(__dirname, '../outputs/institution-affiliation-source-packet-2026-09-14.json');
const PMID_URL = /^https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)\/?(?:\?.*)?$/i;
const ORCID_ID = /^\d{4}-\d{4}-\d{4}-[\dX]{4}$/i;

function scrub(value, limit = 500) {
  if (typeof value !== 'string') return null;
  const text = value.trim()
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email removed]')
    .replace(/(?:\+?\d[\d\s().-]{8,}\d)/g, '[phone removed]');
  return text ? text.slice(0, limit) : null;
}

function pmidsFor(candidate) {
  return [...new Set((Array.isArray(candidate?.publications) ? candidate.publications : [])
    .map((publication) => PMID_URL.exec(publication?.url || '')?.[1])
    .filter(Boolean))];
}

function orcidFor(candidate) {
  const value = candidate?.orcid || candidate?.contactEnrichment?.orcidId || null;
  if (typeof value !== 'string') return null;
  const id = value.replace(/^https:\/\/orcid\.org\//i, '').trim();
  return ORCID_ID.test(id) ? id : null;
}

function profileUrlFor(candidate) {
  if (typeof candidate?.website !== 'string') return null;
  try {
    const url = new URL(candidate.website);
    if (url.protocol !== 'https:' || url.username || url.password
      || !url.hostname.includes('.') || /^(?:localhost|\d+(?:\.\d+){3})$/i.test(url.hostname)
      || /\.local$/i.test(url.hostname)) return null;
    url.search = '';
    url.hash = '';
    return url.toString().slice(0, 1000);
  } catch { return null; }
}

function pubmedEvidence(candidate, article) {
  const matches = (article?.authors || [])
    .map((author) => ({ author, match: nameMatchEvidence(candidate?.name, author.name) }))
    .filter(({ match }) => match.matches);
  const full = matches.filter(({ match }) => match.fullForenameMatch);
  let bylineMatch = 'none';
  let author = null;
  if (full.length === 1) {
    bylineMatch = 'unique_full_forename_surname';
    author = full[0].author;
  } else if (full.length > 1) {
    bylineMatch = 'multiple_full_name_bylines';
  } else if (matches.length > 0) {
    bylineMatch = 'initial_only';
  }
  return {
    kind: 'pubmed_author_affiliation',
    url: `https://pubmed.ncbi.nlm.nih.gov/${article.pmid}/`,
    publicationDate: article.publicationDate instanceof Date
      ? article.publicationDate.toISOString().slice(0, 10) : null,
    bylineMatch,
    matchedAuthor: author ? scrub(author.name, 160) : null,
    authorAffiliations: author
      ? (author.allAffiliations || []).map((value) => scrub(value)).filter(Boolean).slice(0, 10)
      : [],
  };
}

function orcidEvidence(candidate, profile) {
  const profileName = [profile?.givenNames, profile?.familyName].filter(Boolean).join(' ');
  const match = nameMatchEvidence(candidate?.name, profileName);
  return {
    kind: 'orcid_employment_snapshot',
    url: profile?.orcidUrl || null,
    retrievedProfileName: scrub(profileName, 160),
    profileNameMatch: match.fullForenameMatch ? 'full_forename_surname'
      : match.initialOnly ? 'initial_only' : 'none',
    employments: (profile?.affiliations || []).map((affiliation) => ({
      organization: scrub(affiliation.organization),
      department: scrub(affiliation.department),
      startYear: Number(affiliation.startYear) || null,
      endYear: Number(affiliation.endYear) || null,
      noEndDateInCurrentProfile: affiliation.current === true,
    })).filter((affiliation) => affiliation.organization).slice(0, 30),
  };
}

function triage(sourceRecords, retainedPmids, retainedOrcid, retainedProfileUrl, fetchFailures) {
  const pubmed = sourceRecords.some((source) => source.kind === 'pubmed_author_affiliation'
    && source.bylineMatch === 'unique_full_forename_surname'
    && source.authorAffiliations.length > 0);
  const orcid = sourceRecords.some((source) => source.kind === 'orcid_employment_snapshot'
    && source.profileNameMatch === 'full_forename_surname'
    && source.employments.length > 0);
  if (pubmed || orcid) return 'source_candidate_for_adjudication';
  if (!retainedPmids.length && !retainedOrcid && retainedProfileUrl) return 'profile_url_requires_verification';
  if (!retainedPmids.length && !retainedOrcid) return 'no_retained_pubmed_orcid_or_website';
  if (fetchFailures.length && sourceRecords.length === 0) return 'source_fetch_unavailable';
  return 'referenced_but_no_unambiguous_author_affiliation';
}

function countBy(rows, key) {
  const counts = {};
  for (const row of rows) {
    const value = key(row) || 'unknown';
    counts[value] = (counts[value] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

async function fetchPubmed(pmids) {
  const { PubMedService } = require('../lib/services/pubmed-service');
  const articles = new Map();
  const failed = new Set();
  for (let i = 0; i < pmids.length; i += 50) {
    const batch = pmids.slice(i, i + 50);
    try {
      const returned = await PubMedService.fetchArticleChunk(batch);
      for (const article of returned) articles.set(String(article.pmid), article);
    } catch (error) {
      for (const pmid of batch) failed.add(pmid);
      console.warn(`PubMed source batch unavailable (${error?.status || error?.code || 'error'})`);
    }
  }
  return { articles, failed };
}

async function fetchOrcid(ids) {
  const { ORCIDService } = require('../lib/services/orcid-service');
  const profiles = new Map();
  const failed = new Set();
  if (!process.env.ORCID_CLIENT_ID || !process.env.ORCID_CLIENT_SECRET) {
    for (const id of ids) failed.add(id);
    return { profiles, failed };
  }
  for (const id of ids) {
    try {
      const profile = await ORCIDService.getProfile(id, process.env.ORCID_CLIENT_ID, process.env.ORCID_CLIENT_SECRET);
      if (profile) profiles.set(id, profile);
    } catch (error) {
      failed.add(id);
      console.warn(`ORCID source unavailable (${error?.status || error?.code || 'error'})`);
    }
  }
  return { profiles, failed };
}

async function main() {
  if (process.argv.length > 2) throw new Error('this cohort collector takes no arguments');
  const { sql } = require('@vercel/postgres');
  const rows = (await sql`
    SELECT request_id, candidate_key, status, source_kind, candidate,
           first_seen_at, updated_at
      FROM reviewer_find_roster
     WHERE first_seen_at >= ${FROM}
       AND first_seen_at < ${TO}
       AND candidate->>'institutionMismatch' = 'true'
     ORDER BY first_seen_at, id
  `).rows;
  const allPmids = [...new Set(rows.flatMap((row) => pmidsFor(row.candidate)))];
  const allOrcids = [...new Set(rows.map((row) => orcidFor(row.candidate)).filter(Boolean))];
  const [pubmed, orcid] = await Promise.all([fetchPubmed(allPmids), fetchOrcid(allOrcids)]);
  const cases = rows.map((row) => {
    const candidate = row.candidate || {};
    const base = projectCase(row);
    const retainedPmids = pmidsFor(candidate);
    const retainedOrcid = orcidFor(candidate);
    const retainedProfileUrl = profileUrlFor(candidate);
    const sourceRecords = retainedPmids
      .map((pmid) => pubmed.articles.get(pmid))
      .filter(Boolean)
      .map((article) => pubmedEvidence(candidate, article));
    if (retainedOrcid && orcid.profiles.has(retainedOrcid)) {
      sourceRecords.push(orcidEvidence(candidate, orcid.profiles.get(retainedOrcid)));
    }
    const fetchFailures = [
      ...retainedPmids.filter((pmid) => pubmed.failed.has(pmid)).map(() => 'pubmed'),
      ...(retainedOrcid && orcid.failed.has(retainedOrcid) ? ['orcid'] : []),
    ];
    return {
      caseId: base.caseId,
      status: base.status,
      sourceKind: base.sourceKind,
      firstSeenAt: base.firstSeenAt,
      candidateName: scrub(candidate.name, 160),
      storedCandidateAffiliation: scrub(base.candidateAffiliation),
      storedSuggestedInstitution: scrub(base.suggestedInstitution),
      storedAffiliationSource: base.affiliationSource,
      retainedPubmedReferences: retainedPmids.length,
      retainedOrcidReference: Boolean(retainedOrcid),
      retainedProfileUrl,
      sourceRecords,
      fetchFailures: [...new Set(fetchFailures)],
      triage: triage(sourceRecords, retainedPmids, retainedOrcid, retainedProfileUrl, fetchFailures),
      labels: {
        exactOriginalDecisionSourceRecovered: null,
        authorAttribution: null,
        sourceCurrentnessAtDecision: null,
        affiliationSegments: null,
        organizationRelationship: null,
        institutionOnlyClearance: null,
        independentPersonIdentity: null,
        additionalAffiliationCoi: null,
        otherHoldReasons: null,
        finalConsumerAction: null,
      },
    };
  });
  const packet = {
    cohort: { fromInclusive: FROM, toExclusive: TO },
    fetchedAt: new Date().toISOString(),
    limits: [
      'Retained publication links are not proven to be the exact evidence used at the original decision.',
      'PubMed byline matching is name matching only, not independent person-identity proof.',
      'An ORCID employment without an end date in the current profile does not prove it was current in June–August 2026.',
      'Stored affiliation text may differ from the verifier/recorded pair at the original decision.',
      'No historical staff-action events or avoided-action counts can be reconstructed from this packet.',
      'All adjudication labels remain unset; no case is an approved automatic clear.',
    ],
    summary: {
      retainedMismatchCases: cases.length,
      distinctRetainedPubmedIds: allPmids.length,
      distinctRetainedOrcidIds: allOrcids.length,
      fetchedPubmedRecords: pubmed.articles.size,
      fetchedOrcidProfiles: orcid.profiles.size,
      byTriage: countBy(cases, (row) => row.triage),
      bySourceKind: countBy(cases, (row) => row.sourceKind),
      casesWithUniqueFullNamePubmedAffiliation: cases.filter((row) => row.sourceRecords.some((source) =>
        source.kind === 'pubmed_author_affiliation'
        && source.bylineMatch === 'unique_full_forename_surname'
        && source.authorAffiliations.length > 0)).length,
      casesWithMatchedOrcidEmployment: cases.filter((row) => row.sourceRecords.some((source) =>
        source.kind === 'orcid_employment_snapshot'
        && source.profileNameMatch === 'full_forename_surname'
        && source.employments.length > 0)).length,
      casesWithRetainedProfileUrl: cases.filter((row) => row.retainedProfileUrl).length,
    },
    cases,
  };
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(packet, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(OUTPUT, 0o600);
  console.log(JSON.stringify({ output: OUTPUT, ...packet.summary }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.code || error?.name || 'source packet failed');
    process.exitCode = 1;
  });
}

module.exports = { scrub, pmidsFor, orcidFor, profileUrlFor, pubmedEvidence, orcidEvidence, triage };
