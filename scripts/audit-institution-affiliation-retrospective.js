#!/usr/bin/env node

/**
 * Read-only inventory of retained Find-roster institution decisions.
 *
 * Default output is aggregate-only. --cases adds bounded stored text operands
 * and hashed local correlation ids for adjudication; redirect that output to
 * a gitignored local artifact. This snapshot cannot measure historical staff
 * clicks or reconstruct source assertions that were never persisted.
 *
 * Usage: node --env-file=.env.local scripts/audit-institution-affiliation-retrospective.js
 *        [--from=YYYY-MM-DD] [--to=YYYY-MM-DD] [--cases]
 */

'use strict';

const crypto = require('node:crypto');

function dateArg(arg, name) {
  if (!arg) return null;
  const value = arg.slice(name.length + 1);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)
    || Number.isNaN(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${name} requires YYYY-MM-DD`);
  }
  return value;
}

function parseArgs(argv) {
  const opts = { from: null, to: null, cases: false };
  for (const arg of argv) {
    if (arg.startsWith('--from=')) opts.from = dateArg(arg, '--from');
    else if (arg.startsWith('--to=')) opts.to = dateArg(arg, '--to');
    else if (arg === '--cases') opts.cases = true;
    else throw new Error(`unsupported argument: ${arg}`);
  }
  if (opts.from && opts.to && opts.from >= opts.to) throw new Error('--from must precede --to');
  return opts;
}

function asDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function bounded(value, limit = 1000) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : null;
}

function institutionText(value) {
  const text = bounded(value);
  return text ? text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email removed]') : null;
}

function caseId(row) {
  const key = `${row.request_id || ''}|${row.candidate_key || ''}`;
  return `roster-${crypto.createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
}

function projectCase(row) {
  const candidate = row.candidate || {};
  const enrichment = candidate.contactEnrichment || {};
  const identity = enrichment.identity || {};
  const publications = Array.isArray(candidate.publications) ? candidate.publications : [];
  return {
    caseId: caseId(row),
    status: row.status,
    sourceKind: bounded(row.source_kind || candidate.provenance?.kind, 80),
    firstSeenAt: asDate(row.first_seen_at),
    updatedAt: asDate(row.updated_at),
    institutionMismatch: candidate.institutionMismatch === true,
    candidateAffiliation: institutionText(candidate.affiliation),
    suggestedInstitution: institutionText(candidate.suggestedInstitution),
    affiliationSource: bounded(candidate.affiliationSource || enrichment.affiliationSource, 100),
    verificationSource: bounded(candidate.verificationSource, 80),
    verifierAffiliationRetained: Boolean(enrichment.priorAffiliation
      || (Array.isArray(candidate.affiliationHistory) && candidate.affiliationHistory.length > 0)),
    publicationReferences: publications.filter((value) => value && (value.url || value.title)).length,
    publicationYears: [...new Set(publications.map((value) => Number(value?.year))
      .filter((year) => Number.isInteger(year) && year >= 1900 && year <= 2100))].sort(),
    orcidPresent: Boolean(candidate.orcid || enrichment.orcid || enrichment.orcidId),
    identityStatus: bounded(candidate.identityStatus || identity.status, 80),
    retainedAnchorTypes: (Array.isArray(identity.anchors) ? identity.anchors : [])
      .map((anchor) => bounded(anchor?.type, 80)).filter(Boolean),
    staffIdentityConfirmationPresent: Boolean(candidate.staffIdentityConfirmation),
    hasInstitutionCOI: candidate.hasInstitutionCOI === true,
    stage2PresentationKind: bounded(candidate.institutionPresentation?.kind, 80),
    typedAssessmentPresent: Boolean(candidate.institutionAssessment),
  };
}

function countBy(rows, key) {
  const counts = {};
  for (const row of rows) {
    const value = String(key(row) ?? 'unknown');
    counts[value] = (counts[value] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function summarize(rows, cases, opts) {
  const mismatches = cases.filter((row) => row.institutionMismatch);
  return {
    window: { fromInclusive: opts.from, toExclusive: opts.to },
    retainedRows: rows.length,
    distinctRequests: new Set(rows.map((row) => String(row.request_id))).size,
    byFirstSeenMonth: countBy(cases, (row) => row.firstSeenAt?.slice(0, 7)),
    byStatus: countBy(cases, (row) => row.status),
    institutionMismatchRows: mismatches.length,
    mismatchByStatus: countBy(mismatches, (row) => row.status),
    mismatchWithBothOperands: mismatches.filter((row) => row.candidateAffiliation && row.suggestedInstitution).length,
    mismatchWithAffiliationSource: mismatches.filter((row) => row.affiliationSource).length,
    mismatchWithVerifierAffiliation: mismatches.filter((row) => row.verifierAffiliationRetained).length,
    mismatchWithPublicationReference: mismatches.filter((row) => row.publicationReferences > 0).length,
    mismatchWithRetainedAnchorTypes: mismatches.filter((row) => row.retainedAnchorTypes.length > 0).length,
    mismatchWithStage2Presentation: mismatches.filter((row) => row.stage2PresentationKind).length,
    mismatchWithTypedAssessment: mismatches.filter((row) => row.typedAssessmentPresent).length,
    mismatchWithStaffIdentityConfirmation: mismatches.filter((row) => row.staffIdentityConfirmationPresent).length,
    note: 'A roster snapshot records current row state, not historical staff actions or a verified non-affiliation identity decision. Candidate affiliation and suggested institution are stored fields, not a source-complete pair.',
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { sql } = require('@vercel/postgres');
  // Entire query is read-only. Calendar-window filtering occurs after the
  // retained roster read so no dynamic SQL or caller-provided SQL is needed.
  const result = await sql`
    SELECT request_id, candidate_key, status, source_kind, candidate,
           first_seen_at, updated_at
      FROM reviewer_find_roster
     ORDER BY first_seen_at, id
  `;
  const rows = result.rows.filter((row) => {
    const day = asDate(row.first_seen_at)?.slice(0, 10);
    return day && (!opts.from || day >= opts.from) && (!opts.to || day < opts.to);
  });
  const cases = rows.map(projectCase);
  process.stdout.write(`${JSON.stringify({
    summary: summarize(rows, cases, opts),
    ...(opts.cases ? { cases: cases.filter((row) => row.institutionMismatch) } : {}),
  }, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, projectCase, summarize };
