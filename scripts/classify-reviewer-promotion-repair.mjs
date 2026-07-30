#!/usr/bin/env node
/**
 * READ-ONLY historical reviewer-promotion classifier.
 *
 * Finds selected suggestions whose canonical person is email-empty, re-derives
 * the current promotion contact projection, inventories exact-email owners and
 * references, and emits a redacted hash-stable manifest. It has no execute mode
 * and performs no Dataverse/Postgres writes (the OAuth token exchange is the
 * only POST).
 *
 * Usage:
 *   DATAVERSE_ALLOW_PROD_READS=yes node --import ./scripts/lib/use-extensionless.mjs \
 *     scripts/classify-reviewer-promotion-repair.mjs --days 90
 *   ... --request 1002912 --out /secure/path/reviewer-promotion-manifest.json
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function fail(message) {
  console.error(`CLASSIFIER ERROR: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { days: 90, requestNumber: null, outputPath: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--days') out.days = Number(argv[++i]);
    else if (arg === '--request') out.requestNumber = argv[++i];
    else if (arg === '--out') out.outputPath = resolve(argv[++i]);
    else if (arg === '--execute' || arg.startsWith('--execute=')) {
      fail('This classifier is dry-run-only and has no execute mode.');
    } else fail(`Unknown argument: ${arg}`);
  }
  if (!Number.isFinite(out.days) || out.days < 1 || out.days > 3650) {
    fail('--days must be between 1 and 3650');
  }
  return out;
}

try {
  const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  for (const line of env.split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || match[1] in process.env) continue;
    process.env[match[1]] = match[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
} catch {}
if (!process.env.POSTGRES_URL && process.env.DATABASE_URL) {
  process.env.POSTGRES_URL = process.env.DATABASE_URL;
}

const args = parseArgs(process.argv.slice(2));
const sinceIso = new Date(Date.now() - args.days * 86400_000).toISOString();
const { sql } = await import('@vercel/postgres');
const { projectReviewerContact } = await import('../lib/utils/reviewer-vetted-email.js');
const { verifyAutomatedIdentityAttestation } = await import('../lib/services/reviewer-candidate-attestation.js');
const {
  buildReviewerPromotionRepairManifest,
  classifyReviewerPromotionRepair,
  hasReceiptBoundOrcidMatch,
  summarizeReviewerMergePlan,
} = await import('../lib/services/reviewer-promotion-repair-classifier.js');

function normalizedEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizedOrcid(value) {
  const match = String(value || '').toUpperCase().match(/\d{4}-\d{4}-\d{4}-[\dX]{4}/);
  return match ? match[0] : null;
}

function odataString(value) {
  return String(value).replace(/'/g, "''");
}

async function getToken() {
  const response = await fetch(
    `https://login.microsoftonline.com/${process.env.DYNAMICS_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: process.env.DYNAMICS_CLIENT_ID,
        client_secret: process.env.DYNAMICS_CLIENT_SECRET,
        scope: `${process.env.DYNAMICS_URL}/.default`,
      }),
    },
  );
  if (!response.ok) throw new Error(`OAuth token exchange failed (${response.status})`);
  return (await response.json()).access_token;
}

async function getAll(token, path) {
  const rows = [];
  let next = `${process.env.DYNAMICS_URL}/api/data/v9.2${path}`;
  while (next) {
    const response = await fetch(next, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'OData-Version': '4.0',
        Prefer: 'odata.maxpagesize=500',
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Dataverse GET failed (${response.status})`);
    rows.push(...(body.value || []));
    next = body['@odata.nextLink'] || null;
  }
  return rows;
}

function chunks(items, size = 20) {
  const result = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

const ENGAGEMENT_FIELDS = [
  'wmkf_invited',
  'wmkf_accepted',
  'wmkf_declined',
  'wmkf_emailsentat',
  'wmkf_responsereceivedat',
  'wmkf_materialssentat',
  'wmkf_reviewreceivedat',
  'wmkf_completedat',
  'wmkf_externaltokenissued',
  '_wmkf_honorariumrequest_value',
];
const SLOT_FIELDS = [1, 2, 3, 4, 5].map((slot) => `_wmkf_potentialreviewer${slot}_value`);

function isEngaged(suggestion) {
  return ENGAGEMENT_FIELDS.some((field) => {
    const value = suggestion?.[field];
    return value !== null && value !== undefined && value !== false && String(value).trim() !== '';
  });
}

async function currentProjection(requestId, candidate) {
  const receipt = await verifyAutomatedIdentityAttestation(
    candidate?.automatedIdentityAttestation,
    { requestId, candidate },
  );
  const staffConfirmed = candidate?.pdIdentityConfirmed === true
    && candidate?.staffIdentityConfirmation?.source === 'staff_confirmed';
  const projection = projectReviewerContact(candidate || {}, {
    staffConfirmed,
    identityConfirmed: receipt.identityDecisionBound === true,
  });
  if (
    !staffConfirmed
    && typeof candidate?.automatedIdentityAttestation === 'string'
    && receipt.contactAuthorityBound !== true
    && projection.decision === 'ready'
  ) {
    return {
      projection: {
        ...projection,
        decision: 'needs_identity_confirmation',
        reason: `contact_attestation_${receipt.reason || `v${receipt.projectionVersion || 'unknown'}`}`,
      },
      receipt,
    };
  }
  return { projection, receipt };
}

async function run() {
  if (!process.env.DYNAMICS_URL || !process.env.DYNAMICS_TENANT_ID) {
    throw new Error('DYNAMICS_URL and OAuth credentials are required');
  }
  const token = await getToken();
  let requestFilter = '';
  let scopedRequestId = null;
  if (args.requestNumber) {
    const requests = await getAll(
      token,
      `/akoya_requests?$select=akoya_requestid,akoya_requestnum&$filter=${encodeURIComponent(`akoya_requestnum eq '${odataString(args.requestNumber)}'`)}`,
    );
    if (requests.length !== 1) throw new Error(`Expected one request for ${args.requestNumber}; found ${requests.length}`);
    scopedRequestId = requests[0].akoya_requestid;
    requestFilter = ` and _wmkf_request_value eq ${scopedRequestId}`;
  }

  const suggestionSelect = [
    'wmkf_appreviewersuggestionid',
    '_wmkf_potentialreviewer_value',
    '_wmkf_request_value',
    'wmkf_selected',
    'createdon',
    ...ENGAGEMENT_FIELDS,
  ].join(',');
  const selectedSuggestions = await getAll(
    token,
    `/wmkf_appreviewersuggestions?$select=${suggestionSelect}&$filter=${encodeURIComponent(`wmkf_selected eq true and createdon ge ${sinceIso}${requestFilter}`)}`,
  );
  const personIds = [...new Set(selectedSuggestions
    .map((row) => row._wmkf_potentialreviewer_value)
    .filter(Boolean))];
  const peopleById = new Map();
  for (const group of chunks(personIds)) {
    const filter = group.map((id) => `wmkf_potentialreviewersid eq ${id}`).join(' or ');
    const people = await getAll(
      token,
      `/wmkf_potentialreviewerses?$select=wmkf_potentialreviewersid,wmkf_emailaddress,wmkf_emailsource,wmkf_orcid,_wmkf_contact_value,statecode&$filter=${encodeURIComponent(filter)}`,
    );
    people.forEach((person) => peopleById.set(String(person.wmkf_potentialreviewersid).toLowerCase(), person));
  }
  const affected = selectedSuggestions.filter((suggestion) => {
    const person = peopleById.get(String(suggestion._wmkf_potentialreviewer_value || '').toLowerCase());
    return person && !normalizedEmail(person.wmkf_emailaddress);
  });
  const requestIds = [...new Set(affected.map((row) => row._wmkf_request_value).filter(Boolean))];
  const rosterResult = requestIds.length > 0
    ? await sql.query(
        'SELECT request_id, candidate_key, status, candidate, updated_at::text AS updated_at FROM reviewer_find_roster WHERE request_id = ANY($1)',
        [requestIds],
      )
    : { rows: [] };
  const rosterBySuggestion = new Map();
  for (const row of rosterResult.rows) {
    const suggestionId = row.candidate?.suggestionId;
    if (suggestionId) {
      rosterBySuggestion.set(`${row.request_id}::${String(suggestionId).toLowerCase()}`, row);
    }
  }
  const requestNumbers = new Map();
  for (const group of chunks(requestIds)) {
    const filter = group.map((id) => `akoya_requestid eq ${id}`).join(' or ');
    const requests = await getAll(
      token,
      `/akoya_requests?$select=akoya_requestid,akoya_requestnum&$filter=${encodeURIComponent(filter)}`,
    );
    requests.forEach((request) => requestNumbers.set(request.akoya_requestid, request.akoya_requestnum));
  }

  const rows = [];
  for (const suggestion of affected) {
    const personId = suggestion._wmkf_potentialreviewer_value;
    const person = peopleById.get(String(personId).toLowerCase());
    const roster = rosterBySuggestion.get(
      `${suggestion._wmkf_request_value}::${String(suggestion.wmkf_appreviewersuggestionid).toLowerCase()}`,
    ) || null;
    const candidate = roster?.candidate || {};
    const projectionContext = await currentProjection(suggestion._wmkf_request_value, candidate);
    const projection = projectionContext.projection;
    let exactEmailOwners = [];
    if (projection.email) {
      exactEmailOwners = await getAll(
        token,
        `/wmkf_potentialreviewerses?$select=wmkf_potentialreviewersid,wmkf_orcid,statecode&$filter=${encodeURIComponent(`wmkf_emailaddress eq '${odataString(normalizedEmail(projection.email))}'`)}`,
      );
    }
    const personSuggestions = await getAll(
      token,
      `/wmkf_appreviewersuggestions?$select=${suggestionSelect}&$filter=${encodeURIComponent(`_wmkf_potentialreviewer_value eq ${personId}`)}`,
    );
    const slotFilter = SLOT_FIELDS.map((field) => `${field} eq ${personId}`).join(' or ');
    const slotRefs = await getAll(
      token,
      `/akoya_requests?$select=akoya_requestid,${SLOT_FIELDS.join(',')}&$filter=${encodeURIComponent(slotFilter)}`,
    );
    const rosterOrcid = normalizedOrcid(candidate.orcid || candidate.contactEnrichment?.orcidId);
    const activeOwners = exactEmailOwners.filter((owner) => owner.statecode === 0);
    const independentlyConfirmedSamePerson = activeOwners.length === 1
      && hasReceiptBoundOrcidMatch({
        candidateOrcid: rosterOrcid,
        ownerOrcid: activeOwners[0].wmkf_orcid,
        attestation: projectionContext.receipt,
      });

    let mergePlan = { blocked: true, etagComplete: false };
    let mergePlanSummary = null;
    const uniqueDifferentOwner = activeOwners.length === 1
      && String(activeOwners[0].wmkf_potentialreviewersid || '').toLowerCase()
        !== String(personId || '').toLowerCase();
    if (uniqueDifferentOwner) {
      try {
        const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
        enterDynamicsBypassForScript('classify-reviewer-promotion-repair');
        const { planMerge } = await import('../lib/services/reviewer-merge.js');
        const plan = await planMerge({
          keeperId: activeOwners[0].wmkf_potentialreviewersid,
          loserId: personId,
        });
        mergePlanSummary = summarizeReviewerMergePlan(plan);
        mergePlan = {
          blocked: mergePlanSummary.blocked,
          etagComplete: mergePlanSummary.etagComplete,
        };
      } catch (error) {
        mergePlan = { blocked: true, etagComplete: false, reason: error?.code || 'plan_failed' };
      }
    }
    // The supported relationship inventory mirrors reviewer-merge: paginated
    // suggestion rows (including engagement/honorarium), the person's contact
    // link, and paginated applicant slots. A duplicate candidate additionally
    // requires planMerge to return its complete reference collections.
    const baseReferenceScanComplete = Boolean(
      person
      && Array.isArray(personSuggestions)
      && Array.isArray(slotRefs),
    );
    const referenceScanComplete = baseReferenceScanComplete
      && (!uniqueDifferentOwner || mergePlanSummary?.referenceScanComplete === true);
    const otherReferenceCount = mergePlanSummary?.otherReferenceCount || 0;

    rows.push(classifyReviewerPromotionRepair({
      requestId: suggestion._wmkf_request_value,
      requestNumber: requestNumbers.get(suggestion._wmkf_request_value),
      suggestion: {
        suggestionId: suggestion.wmkf_appreviewersuggestionid,
        etag: suggestion['@odata.etag'],
        selected: suggestion.wmkf_selected,
      },
      person: {
        personId,
        etag: person['@odata.etag'],
        email: person.wmkf_emailaddress,
      },
      roster: {
        candidateKey: roster?.candidate_key || null,
        updatedAt: roster?.updated_at || null,
      },
      contactProjection: projection,
      exactEmailOwners: exactEmailOwners.map((owner) => ({
        personId: owner.wmkf_potentialreviewersid,
        etag: owner['@odata.etag'],
        statecode: owner.statecode,
      })),
      references: {
        suggestionCount: personSuggestions.length,
        engagedSuggestionCount: personSuggestions.filter(isEngaged).length,
        contactLinked: Boolean(person._wmkf_contact_value),
        applicantSlotCount: slotRefs.length,
        otherReferenceCount,
        scanComplete: referenceScanComplete,
      },
      independentlyConfirmedSamePerson,
      mergePlan,
    }));
  }

  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const manifest = buildReviewerPromotionRepairManifest(rows, {
    sourceCommit,
    observedAt: new Date().toISOString(),
  });
  const json = `${JSON.stringify(manifest, null, 2)}\n`;
  if (args.outputPath) writeFileSync(args.outputPath, json, { flag: 'wx' });
  process.stdout.write(json);
}

run().catch((error) => fail(error?.stack || error?.message || String(error)));
