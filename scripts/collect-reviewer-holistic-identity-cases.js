#!/usr/bin/env node
/**
 * Assemble the proposed M1.1 identity case pool from public scholarly APIs.
 *
 * This collector does not label cases and does not call either reviewer
 * pipeline. It freezes only the candidate input plus minimal OpenAlex/ORCID
 * response fields needed for later independent labeling. It performs no
 * Dataverse, Postgres, Blob, LLM, or other production-system access.
 */

const fs = require('node:fs');
const path = require('node:path');
const { validateIdentityBenchmark } = require('./lib/reviewer-holistic-m1');

const DEFAULT_OUTPUT = path.join(
  __dirname,
  '..',
  'docs/audits/reviewer-holistic-identity-benchmark-v1.json',
);

const SEEDS = [
  // Hazard sampling: known project failure shapes plus deliberately ambiguous inputs.
  { caseId: 'hazard-01-wei-zhang', name: 'Wei Zhang', claimedAffiliation: 'Stanford University', field: 'chemistry', careerStageSamplingBand: 'mixed', hazardTypes: ['namesake'], samplingRationale: 'Common full name with many scholarly identities.' },
  { caseId: 'hazard-02-robert-sang', name: 'Robert Sang', claimedAffiliation: 'Griffith University', field: 'attosecond physics', careerStageSamplingBand: 'senior', hazardTypes: ['namesake', 'merged_cluster'], samplingRationale: 'Historical same-full-name cross-field collision shape.' },
  { caseId: 'hazard-03-olga-smirnova', name: 'Olga Smirnova', claimedAffiliation: 'Max Born Institute', field: 'attosecond physics', careerStageSamplingBand: 'senior', hazardTypes: ['namesake', 'affiliation_drift'], samplingRationale: 'Multiple real scholars plus changing affiliation evidence.' },
  { caseId: 'hazard-04-david-yong', name: 'David Yong', claimedAffiliation: 'Australian National University', field: 'astronomy', careerStageSamplingBand: 'mid', hazardTypes: ['namesake'], samplingRationale: 'Same-full-name publications span unrelated fields.' },
  { caseId: 'hazard-05-li-huei-tsai', name: 'Li-Huei Tsai', claimedAffiliation: 'Massachusetts Institute of Technology', field: 'neuroscience', careerStageSamplingBand: 'senior', hazardTypes: ['merged_cluster'], samplingRationale: 'Historical profile-cluster contamination shape.' },
  { caseId: 'hazard-06-yanjun-chen', name: 'Yanjun Chen', claimedAffiliation: null, field: 'strong-field physics', careerStageSamplingBand: 'mixed', hazardTypes: ['namesake'], samplingRationale: 'Common name with unrelated public identities and sparse context.' },
  { caseId: 'hazard-07-joshua-weitz', name: 'Joshua Weitz', claimedAffiliation: 'University of Maryland', field: 'quantitative biology', careerStageSamplingBand: 'senior', hazardTypes: ['affiliation_drift'], samplingRationale: 'Current-versus-historical affiliation evidence must not split identity.' },
  { caseId: 'hazard-08-taekjip-ha', name: 'Taekjip Ha', claimedAffiliation: 'Johns Hopkins University', field: 'biophysics', careerStageSamplingBand: 'senior', hazardTypes: ['affiliation_drift'], samplingRationale: 'Long publication history across institutional moves.' },
  { caseId: 'hazard-09-j-chen', name: 'J. Chen', claimedAffiliation: 'University of Washington', field: 'bioengineering', careerStageSamplingBand: 'mixed', hazardTypes: ['initials'], samplingRationale: 'Initial-only candidate input is insufficient for safe binding.' },
  { caseId: 'hazard-10-a-patel', name: 'A. Patel', claimedAffiliation: 'Harvard Medical School', field: 'medicine', careerStageSamplingBand: 'mixed', hazardTypes: ['initials'], samplingRationale: 'Initial-only common surname creates a broad candidate set.' },
  { caseId: 'hazard-11-j-kim', name: 'J. Kim', claimedAffiliation: 'Massachusetts Institute of Technology', field: 'engineering', careerStageSamplingBand: 'mixed', hazardTypes: ['initials'], samplingRationale: 'Initial-only high-frequency surname collision.' },
  { caseId: 'hazard-12-zhang-wei', name: 'Zhang Wei', claimedAffiliation: 'Stanford University', field: 'chemistry', careerStageSamplingBand: 'mixed', hazardTypes: ['wrong_forename', 'namesake'], samplingRationale: 'Reversed-name input must not be silently laundered onto Wei Zhang.' },
  { caseId: 'hazard-13-philip-tessier', name: 'Philip Tessier', claimedAffiliation: 'University of Michigan', field: 'chemical engineering', careerStageSamplingBand: 'mid', hazardTypes: ['wrong_forename'], samplingRationale: 'Near-name input tests strict given-name handling.', manualEvidence: [{ url: 'https://che.engin.umich.edu/people/tessier-peter/', sourceType: 'institutional_profile', claim: 'Official Michigan profile for the nearby Peter M. Tessier identity; inclusion does not pre-label the proposed case.' }] },
  { caseId: 'hazard-14-sigal-itzkovitz', name: 'Sigal Itzkovitz', claimedAffiliation: 'Weizmann Institute of Science', field: 'systems biology', careerStageSamplingBand: 'mixed', hazardTypes: ['wrong_forename'], samplingRationale: 'Historical fabricated or wrong-name abstention shape.', manualEvidence: [{ url: 'https://www.weizmann.ac.il/mcb/Le1/prof-shalev-itzkovitz', sourceType: 'institutional_profile', claim: 'Official Weizmann profile for the nearby Shalev Itzkovitz identity; inclusion does not pre-label the proposed case.' }] },
  { caseId: 'hazard-15-alexandria-landsman', name: 'Alexandria Landsman', claimedAffiliation: 'The Ohio State University', field: 'atomic physics', careerStageSamplingBand: 'mixed', hazardTypes: ['wrong_forename'], samplingRationale: 'Historical misspelling or wrong-name abstention shape.', manualEvidence: [{ url: 'https://opticalscience.osu.edu/people/landsman.7', sourceType: 'institutional_profile', claim: 'Official Ohio State profile for the nearby Alexandra Landsman identity; inclusion does not pre-label the proposed case.' }] },
  { caseId: 'hazard-16-andres-bhatt', name: 'Andres Bhatt', claimedAffiliation: null, field: 'physics', careerStageSamplingBand: 'mixed', hazardTypes: ['wrong_forename'], samplingRationale: 'No-evidence candidate input must remain abstention-capable.', manualEvidence: [{ url: 'https://collaborate.princeton.edu/en/publications/sharp-metal-insulator-transition-in-a-random-solid', sourceType: 'publisher_record', claim: 'University-hosted publication record lists K. Andres and R. N. Bhatt as separate authors; inclusion does not pre-label the proposed case.' }] },
  { caseId: 'hazard-17-christina-wayment-steele', name: 'Christina Wayment-Steele', claimedAffiliation: 'University of Washington', field: 'protein design', careerStageSamplingBand: 'early', hazardTypes: ['no_orcid_early_career'], samplingRationale: 'Early-career identity must not be rejected solely for sparse identifiers.' },
  { caseId: 'hazard-18-prineha-narang', name: 'Prineha Narang', claimedAffiliation: 'University of California, Los Angeles', field: 'quantum science', careerStageSamplingBand: 'mid', hazardTypes: ['affiliation_drift', 'no_orcid_early_career'], samplingRationale: 'Career-stage and institutional-move evidence can disagree across sources.' },
  { caseId: 'hazard-19-li-huei-tsai-correction', name: 'Li-Huei Tsai', claimedAffiliation: 'Massachusetts Institute of Technology', field: 'neuroscience', careerStageSamplingBand: 'senior', hazardTypes: ['stale_binding_correction'], samplingRationale: 'Correction fixture: an existing non-authoritative profile binding must be invalidated before re-resolution.', transitionInput: { existingBindingSource: 'automated_profile_match', correctionRequested: true } },
  { caseId: 'hazard-20-olga-smirnova-correction', name: 'Olga Smirnova', claimedAffiliation: 'Max Born Institute', field: 'attosecond physics', careerStageSamplingBand: 'senior', hazardTypes: ['stale_binding_correction'], samplingRationale: 'Correction fixture: stale affiliation-derived state must not survive a rebind.', transitionInput: { existingBindingSource: 'automated_affiliation_match', correctionRequested: true } },

  // Clean-positive sampling: distinctive names spanning fields and sampling bands.
  { caseId: 'clean-01-ram-madabhushi', name: 'Ram Madabhushi', claimedAffiliation: 'UT Southwestern Medical Center', field: 'neuroscience', careerStageSamplingBand: 'mid' },
  { caseId: 'clean-02-ursula-keller', name: 'Ursula Keller', claimedAffiliation: 'ETH Zurich', field: 'ultrafast photonics', careerStageSamplingBand: 'senior' },
  { caseId: 'clean-03-john-c-travers', name: 'John C. Travers', claimedAffiliation: 'Heriot-Watt University', field: 'photonics', careerStageSamplingBand: 'mid' },
  { caseId: 'clean-04-curtis-suttle', name: 'Curtis Suttle', claimedAffiliation: 'University of British Columbia', field: 'marine virology', careerStageSamplingBand: 'senior' },
  { caseId: 'clean-05-forest-rohwer', name: 'Forest Rohwer', claimedAffiliation: 'San Diego State University', field: 'microbial ecology', careerStageSamplingBand: 'senior' },
  { caseId: 'clean-06-mya-breitbart', name: 'Mya Breitbart', claimedAffiliation: 'University of South Florida', field: 'viral ecology', careerStageSamplingBand: 'mid' },
  { caseId: 'clean-07-will-harcombe', name: 'Will Harcombe', claimedAffiliation: 'University of Minnesota', field: 'microbial evolution', careerStageSamplingBand: 'mid', manualEvidence: [{ url: 'https://cbs.umn.edu/directory/william-harcombe', sourceType: 'institutional_profile', claim: 'Official University of Minnesota profile supplied for later independent review.' }] },
  { caseId: 'clean-08-benjamin-kerr', name: 'Benjamin Kerr', claimedAffiliation: 'University of Washington', field: 'evolutionary biology', careerStageSamplingBand: 'mid' },
  { caseId: 'clean-09-jeff-gore', name: 'Jeff Gore', claimedAffiliation: 'Massachusetts Institute of Technology', field: 'systems biology', careerStageSamplingBand: 'mid' },
  { caseId: 'clean-10-olga-zhaxybayeva', name: 'Olga Zhaxybayeva', claimedAffiliation: 'Dartmouth College', field: 'microbial evolution', careerStageSamplingBand: 'mid' },
  { caseId: 'clean-11-sara-seager', name: 'Sara Seager', claimedAffiliation: 'Massachusetts Institute of Technology', field: 'planetary science', careerStageSamplingBand: 'senior' },
  { caseId: 'clean-12-nergis-mavalvala', name: 'Nergis Mavalvala', claimedAffiliation: 'Massachusetts Institute of Technology', field: 'gravitational physics', careerStageSamplingBand: 'senior', manualEvidence: [{ url: 'https://physics.mit.edu/faculty/nergis-mavalvala/', sourceType: 'institutional_profile', claim: 'Official MIT profile supplied for later independent review.' }] },
  { caseId: 'clean-13-fei-fei-li', name: 'Fei-Fei Li', claimedAffiliation: 'Stanford University', field: 'computer vision', careerStageSamplingBand: 'senior' },
  { caseId: 'clean-14-emmanuelle-charpentier', name: 'Emmanuelle Charpentier', claimedAffiliation: 'Max Planck Unit for the Science of Pathogens', field: 'microbiology', careerStageSamplingBand: 'senior' },
  { caseId: 'clean-15-jennifer-doudna', name: 'Jennifer Doudna', claimedAffiliation: 'University of California, Berkeley', field: 'biochemistry', careerStageSamplingBand: 'senior' },
  { caseId: 'clean-16-pardis-sabeti', name: 'Pardis Sabeti', claimedAffiliation: 'Harvard University', field: 'genomics', careerStageSamplingBand: 'senior' },
  { caseId: 'clean-17-katalin-kariko', name: 'Katalin Karikó', claimedAffiliation: 'University of Pennsylvania', field: 'RNA biology', careerStageSamplingBand: 'senior', manualEvidence: [{ url: 'https://www.med.upenn.edu/apps/faculty/index.php/g325/p13418', sourceType: 'institutional_profile', claim: 'Official University of Pennsylvania profile supplied for later independent review.' }] },
  { caseId: 'clean-18-ankur-moitra', name: 'Ankur Moitra', claimedAffiliation: 'Massachusetts Institute of Technology', field: 'theoretical computer science', careerStageSamplingBand: 'mid' },
  { caseId: 'clean-19-carrie-partch', name: 'Carrie Partch', claimedAffiliation: 'University of California, Santa Cruz', field: 'structural biology', careerStageSamplingBand: 'mid' },
  { caseId: 'clean-20-luhan-yang', name: 'Luhan Yang', claimedAffiliation: 'Qihan Biotech', field: 'genome engineering', careerStageSamplingBand: 'early' },
].map((seed) => ({ stratum: 'clean_positive', hazardTypes: [], ...seed }));

// The leading 20 rows are hazard cases; the mapping default above is overridden here.
for (let index = 0; index < 20; index += 1) SEEDS[index].stratum = 'hazard';

function parseCli(argv) {
  const allowed = new Set(['--write', '--replace-proposed', '--manual-evidence-only']);
  let outputPath = DEFAULT_OUTPUT;
  let write = false;
  let replaceProposed = false;
  let manualEvidenceOnly = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--write') write = true;
    else if (arg === '--replace-proposed') replaceProposed = true;
    else if (arg === '--manual-evidence-only') manualEvidenceOnly = true;
    else if (arg === '--output') {
      const next = argv[index + 1];
      if (!next || next.startsWith('--')) throw new Error('--output requires a path');
      outputPath = path.resolve(next);
      index += 1;
    } else if (arg.startsWith('--') && !allowed.has(arg)) {
      throw new Error(`unknown argument: ${arg}`);
    } else {
      throw new Error(`unknown positional argument: ${arg}`);
    }
  }
  return { manualEvidenceOnly, outputPath, replaceProposed, write };
}

function splitName(name) {
  const parts = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().split(/\s+/);
  return { family: parts.at(-1), given: parts.slice(0, -1).join(' ') || parts[0] };
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function fetchJson(url, headers = {}) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'WMKF-reviewer-identity-benchmark/1.0', ...headers },
      signal: AbortSignal.timeout(20000),
    });
    if (response.ok) return response.json();
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 4) {
      throw new Error(`GET ${url} failed (${response.status})`);
    }
    const retryAfterSeconds = Number(response.headers.get('retry-after'));
    const delay = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? Math.min(retryAfterSeconds * 1000, 15000)
      : 500 * (2 ** attempt);
    await sleep(delay);
  }
  throw new Error(`GET ${url} exhausted retries`);
}

function openAlexUrl(name) {
  const url = new URL('https://api.openalex.org/authors');
  url.searchParams.set('search', name);
  url.searchParams.set('per-page', '3');
  if (process.env.OPENALEX_POLITE_MAILTO) url.searchParams.set('mailto', process.env.OPENALEX_POLITE_MAILTO);
  return url.toString();
}

function orcidSearchUrl(name) {
  const { family, given } = splitName(name);
  const url = new URL('https://pub.orcid.org/v3.0/expanded-search/');
  url.searchParams.set('q', `family-name:${family} AND given-names:${given}`);
  url.searchParams.set('rows', '3');
  return url.toString();
}

function sanitizeOpenAlex(payload) {
  return {
    totalMatches: payload?.meta?.count ?? null,
    results: (payload?.results || []).slice(0, 3).map((row) => ({
      id: row.id || null,
      displayName: row.display_name || null,
      orcid: row.orcid || null,
      worksCount: row.works_count ?? null,
      lastKnownInstitutions: (row.last_known_institutions || []).slice(0, 3).map((institution) => ({
        id: institution.id || null,
        displayName: institution.display_name || null,
        countryCode: institution.country_code || null,
      })),
    })),
  };
}

function sanitizeOrcid(payload) {
  return {
    totalMatches: payload?.['num-found'] ?? null,
    results: (payload?.['expanded-result'] || []).slice(0, 3).map((row) => ({
      orcidId: row['orcid-id'] || null,
      givenNames: row['given-names'] || null,
      familyNames: row['family-names'] || null,
      creditName: row['credit-name'] || null,
      institutionNames: row['institution-name'] || [],
    })),
  };
}

function evidenceFor({ accessedAt, openAlexQueryUrl, openAlex, orcidQueryUrl, orcid, manualEvidence = [] }) {
  const evidence = [
    {
      url: openAlexQueryUrl,
      sourceType: 'discovery',
      claim: 'Frozen OpenAlex candidate search used only to assemble the independent-review evidence set.',
      accessedAt,
    },
    {
      url: orcidQueryUrl,
      sourceType: 'discovery',
      claim: 'Frozen ORCID expanded-search query used only to locate candidate public identity records.',
      accessedAt,
    },
  ];
  for (const result of openAlex.results) {
    if (!result.id) continue;
    evidence.push({
      url: result.id,
      sourceType: 'discovery',
      claim: 'Candidate OpenAlex author record; inclusion is not a benchmark label.',
      accessedAt,
    });
  }
  for (const result of orcid.results) {
    if (!result.orcidId) continue;
    evidence.push({
      url: `https://orcid.org/${result.orcidId}`,
      sourceType: 'orcid_record',
      claim: 'Candidate public ORCID record for independent identity review; inclusion is not acceptance.',
      accessedAt,
    });
  }
  for (const entry of manualEvidence) {
    evidence.push({ ...entry, accessedAt });
  }
  return evidence.filter((entry, index, all) => all.findIndex((other) => other.url === entry.url) === index);
}

async function collectCase(seed, accessedAt) {
  const openAlexQueryUrl = openAlexUrl(seed.name);
  const orcidQueryUrl = orcidSearchUrl(seed.name);
  const [openAlexPayload, orcidPayload] = await Promise.all([
    fetchJson(openAlexQueryUrl),
    fetchJson(orcidQueryUrl, { Accept: 'application/json' }),
  ]);
  const openAlex = sanitizeOpenAlex(openAlexPayload);
  const orcid = sanitizeOrcid(orcidPayload);
  return {
    caseId: seed.caseId,
    caseStatus: 'proposed',
    stratum: seed.stratum,
    hazardTypes: seed.hazardTypes,
    frozenInput: {
      candidate: {
        name: seed.name,
        claimedAffiliation: seed.claimedAffiliation,
        fieldSamplingHint: seed.field,
        careerStageSamplingBand: seed.careerStageSamplingBand,
        ...(seed.transitionInput ? { transitionInput: seed.transitionInput } : {}),
      },
      upstreamResponses: {
        retrievedAt: accessedAt,
        openAlexSearch: { queryUrl: openAlexQueryUrl, ...openAlex },
        orcidExpandedSearch: { queryUrl: orcidQueryUrl, ...orcid },
      },
    },
    expected: null,
    evidence: evidenceFor({
      accessedAt,
      openAlexQueryUrl,
      openAlex,
      orcidQueryUrl,
      orcid,
      manualEvidence: seed.manualEvidence,
    }),
    labeler: null,
    adjudication: { status: 'pending', adjudicator: null },
  };
}

async function collectCases() {
  const accessedAt = new Date().toISOString();
  const cases = [];
  for (const seed of SEEDS) {
    cases.push(await collectCase(seed, accessedAt));
    await sleep(250);
  }
  return cases;
}

function addManualEvidence(cases, accessedAt) {
  const seedsByCaseId = new Map(SEEDS.map((seed) => [seed.caseId, seed]));
  if (cases.length !== SEEDS.length) {
    throw new Error(`manual-evidence-only requires all ${SEEDS.length} proposed cases`);
  }
  const existingIds = new Set(cases.map((item) => item.caseId));
  const missingIds = SEEDS.filter((seed) => !existingIds.has(seed.caseId)).map((seed) => seed.caseId);
  if (missingIds.length > 0) {
    throw new Error(`manual-evidence-only is missing collector cases: ${missingIds.join(', ')}`);
  }
  return cases.map((item) => {
    const seed = seedsByCaseId.get(item.caseId);
    if (!seed) throw new Error(`existing case has no collector seed: ${item.caseId}`);
    const additions = (seed.manualEvidence || []).map((entry) => ({ ...entry, accessedAt }));
    const candidate = { ...item.frozenInput.candidate };
    delete candidate.samplingRationale;
    return {
      ...item,
      frozenInput: { ...item.frozenInput, candidate },
      evidence: [...item.evidence, ...additions].filter(
        (entry, index, all) => all.findIndex((other) => other.url === entry.url) === index,
      ),
    };
  });
}

async function main() {
  const options = parseCli(process.argv.slice(2));
  const existing = JSON.parse(fs.readFileSync(options.outputPath, 'utf8'));
  if (existing.status !== 'draft') throw new Error('refusing to replace a non-draft benchmark');
  if ((existing.cases || []).some((item) => item.caseStatus === 'labeled')) {
    throw new Error('refusing to replace a benchmark containing labeled cases');
  }
  if ((existing.cases || []).length > 0 && !options.replaceProposed) {
    throw new Error('benchmark already contains proposed cases; pass --replace-proposed to refresh them');
  }

  const cases = options.manualEvidenceOnly
    ? addManualEvidence(existing.cases || [], new Date().toISOString())
    : await collectCases();
  const next = { ...existing, cases };
  const validation = validateIdentityBenchmark(next);
  if (!validation.ok) {
    throw new Error(`assembled benchmark is invalid: ${JSON.stringify(validation.errors)}`);
  }
  const hazards = cases.filter((item) => item.stratum === 'hazard').length;
  const clean = cases.filter((item) => item.stratum === 'clean_positive').length;
  if (!options.write) {
    console.log(`dry run OK: ${cases.length} proposed cases (${hazards} hazard; ${clean} clean-positive)`);
    return;
  }
  const tempPath = `${options.outputPath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, options.outputPath);
  console.log(`wrote ${cases.length} proposed cases (${hazards} hazard; ${clean} clean-positive)`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Identity case collection failed: ${error?.stack || error}`);
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_OUTPUT,
  SEEDS,
  addManualEvidence,
  collectCase,
  evidenceFor,
  parseCli,
  sanitizeOpenAlex,
  sanitizeOrcid,
  splitName,
};
