#!/usr/bin/env node

/**
 * Read-only inventory for source-aware institution-affiliation shadow cases.
 *
 * Loads active roster rows currently carrying an institution mismatch and emits
 * only the bounded, non-person evidence needed to decide whether a case can be
 * reconstructed for the Stage 1 shadow benchmark. Names, emails, request ids,
 * candidate keys, and provider tokens are never printed.
 */

'use strict';

const crypto = require('node:crypto');
const { sql } = require('@vercel/postgres');

function caseId(candidate = {}) {
  const payload = JSON.stringify({
    affiliation: candidate.affiliation || null,
    suggestedInstitution: candidate.suggestedInstitution || null,
    updatedSource: candidate.affiliationSource || null,
  });
  return `shadow-source-${crypto.createHash('sha256').update(payload).digest('hex').slice(0, 12)}`;
}

function text(value, max = 1000) {
  return typeof value === 'string' ? value.slice(0, max) : null;
}

function institutionText(value) {
  const bounded = text(value);
  return bounded
    ? bounded.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email removed]')
    : null;
}

function publication(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return {
    title: text(value.title, 500),
    year: Number.isFinite(Number(value.year)) ? Number(value.year) : null,
    url: text(value.url, 500),
  };
}

function project(candidate = {}, updatedAt) {
  const enrichment = candidate.contactEnrichment || {};
  const identity = enrichment.identity || {};
  const anchors = Array.isArray(identity.anchors) ? identity.anchors : [];
  return {
    caseId: caseId(candidate),
    updatedAt,
    evidenceInstitution: institutionText(candidate.affiliation),
    recordedInstitution: institutionText(candidate.suggestedInstitution),
    affiliationSource: text(candidate.affiliationSource || enrichment.affiliationSource, 100),
    identityStatus: text(candidate.identityStatus || identity.status, 100),
    nonAffiliationAnchorTypes: anchors
      .map((anchor) => text(anchor?.type, 100))
      .filter((type) => type && type !== 'affiliation_match'),
    publications: (Array.isArray(candidate.publications) ? candidate.publications : [])
      .map(publication)
      .filter(Boolean),
    orcidPresent: Boolean(candidate.orcid || enrichment.orcid || enrichment.orcidId),
    provenanceKind: text(candidate.provenance?.kind || candidate.source, 100),
  };
}

async function main() {
  const result = await sql`
    SELECT candidate, updated_at
      FROM reviewer_find_roster
     WHERE status = 'active'
       AND COALESCE((candidate->>'institutionMismatch')::boolean, false) = true
     ORDER BY updated_at DESC
  `;
  const rows = result.rows.map((row) => project(row.candidate || {}, row.updated_at));
  const sourceReadyRows = rows.filter((row) => (
    row.evidenceInstitution
      && row.recordedInstitution
      && row.affiliationSource
      && (row.publications.length > 0 || row.orcidPresent)
  ));
  const summary = {
    activeInstitutionMismatchRows: rows.length,
    withBothOperands: rows.filter((row) => row.evidenceInstitution && row.recordedInstitution).length,
    withPublicationReferences: rows.filter((row) => row.publications.length > 0).length,
    withNonAffiliationAnchors: rows.filter((row) => row.nonAffiliationAnchorTypes.length > 0).length,
    sourceReady: sourceReadyRows.length,
  };
  const selectedRows = process.argv.includes('--source-ready') ? sourceReadyRows : rows;
  process.stdout.write(`${JSON.stringify({ summary, rows: selectedRows }, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
