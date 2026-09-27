#!/usr/bin/env node

/**
 * Export one production Grant Request as a private Test Request source bundle
 * (design decision 6, option A). Read-only: one Dataverse Request lookup, its
 * SharePoint document-location rows, a Graph listing of its folders, and a
 * byte download of each recognized source document to hash it. Nothing is
 * written anywhere except the new bundle file.
 *
 *   DATAVERSE_ALLOW_PROD_READS=yes node --env-file=/absolute/.env.local \
 *     scripts/export-test-request-source-bundle.mjs \
 *     --source-request-number=<number> --out=/absolute/private/bundle.json
 *
 * The bundle contains source text; it is written with mode 0600 to a new
 * absolute path outside the repository and never printed. Stdout carries only
 * the summary (identities, counts, hash prefixes).
 *
 * Reviewer content (bundle v3, 6c-ii Stage A) is confidential -- answer text
 * and uploaded review files must only leave production when explicitly
 * asked. It is OFF by default (a plain export writes exactly the pre-Stage-A
 * v2 bundle). Pass `--with-reviewers` to include the `reviewers[]` section,
 * and `--source-marker-column=present|absent` (required with
 * `--with-reviewers`; no default) to say whether the PRODUCTION host has
 * wave30's `wmkf_issyntheticreviewer` column applied -- this is deliberately
 * NOT read from the process-wide `SYNTHETIC_REVIEWER_ISOLATION` switch,
 * because that switch governs the app's own reads while this exporter reads
 * PRODUCTION and a later sandbox seeder writes to the SANDBOX from the same
 * operator shell; the two hosts can have different schema state:
 *
 *   DATAVERSE_ALLOW_PROD_READS=yes node --env-file=/absolute/.env.local \
 *     scripts/export-test-request-source-bundle.mjs \
 *     --source-request-number=<number> --out=/absolute/private/bundle.json \
 *     --with-reviewers --source-marker-column=absent
 *
 * The Pre-Site section (bundle v4, slice 4a "Recipe 4") is likewise OFF by
 * default and requires `--with-reviewers` too (v4 extends v3). Pass
 * `--with-pre-site` to include the source's current Pre-Site draft (eight
 * section fields plus the parsed proposal-core envelope) and its abstract:
 *
 *   DATAVERSE_ALLOW_PROD_READS=yes node --env-file=/absolute/.env.local \
 *     scripts/export-test-request-source-bundle.mjs \
 *     --source-request-number=<number> --out=/absolute/private/bundle.json \
 *     --with-reviewers --source-marker-column=absent --with-pre-site
 */

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';
import { withDalContext } from '../lib/dataverse/core/context.js';
import { PRODUCTION_HOSTS } from '../lib/dataverse/core/target-registry.js';
import { requireUniqueSourceRequest } from '../lib/services/test-requests/sandbox-clone.js';
import {
  assertTestRequestSourceReadLimits,
  createStrictTestRequestSourceDependencies,
  discoverTestRequestSourceDocuments,
  hydrateTestRequestSourceDocument,
} from '../lib/services/test-requests/admin-preview-service.js';
import {
  exportTestRequestSourceBundle,
  summarizeSourceBundle,
} from '../lib/services/test-requests/source-bundle.js';
import { createReviewerSourceDependencies } from '../lib/services/test-requests/source-bundle-reviewers.js';
import { readPreSiteVisitDraftForExport } from '../lib/services/test-requests/source-bundle-presite.js';
import { PRE_SITE_SECTION_FIELDS } from '../lib/services/test-requests/source-bundle.js';
import { REQUEST_DOCUMENT_ARTIFACT_TYPE } from '../shared/config/requestDocument.js';

const require = createRequire(import.meta.url);
const { getAccessToken, createClient } = require('../lib/dataverse/client.js');
const SOURCE_BUNDLE_DEPENDENCIES = createStrictTestRequestSourceDependencies();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_SELECT = [
  'akoya_requestid', 'akoya_requestnum', 'akoya_requesttype', 'akoya_purpose',
  'akoya_request', 'akoya_fiscalyear', 'wmkf_meetingdate', 'versionnumber',
].join(',');

export function parseArgs(argv) {
  const parsed = {
    sourceRequestNumber: null, out: null, help: false,
    withReviewers: false, sourceMarkerColumn: null, withPreSite: false,
  };
  for (const arg of argv) {
    if (arg.startsWith('--source-request-number=')) parsed.sourceRequestNumber = arg.slice('--source-request-number='.length);
    else if (arg.startsWith('--out=')) parsed.out = arg.slice('--out='.length);
    else if (arg === '--with-reviewers') parsed.withReviewers = true;
    else if (arg.startsWith('--source-marker-column=')) parsed.sourceMarkerColumn = arg.slice('--source-marker-column='.length);
    else if (arg === '--with-pre-site') parsed.withPreSite = true;
    else if (arg === '--help' || arg === '-h') parsed.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (parsed.help) return parsed;
  if (!/^\d{1,10}$/.test(parsed.sourceRequestNumber || '')) {
    throw new Error('--source-request-number must be bounded digits.');
  }
  if (!parsed.out || !path.isAbsolute(parsed.out)) throw new Error('--out must be an absolute path.');
  const relative = path.relative(ROOT, path.resolve(parsed.out));
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
    throw new Error('--out must be outside the repository; the bundle contains source text.');
  }
  if (fs.existsSync(parsed.out)) throw new Error('--out already exists; choose a new path.');
  // Reviewer content (answer text, uploaded review files) is confidential --
  // only exported when explicitly asked. --source-marker-column has no
  // default and is required exactly when --with-reviewers is set (never
  // read from the process-wide SYNTHETIC_REVIEWER_ISOLATION switch; see the
  // module doc header).
  if (!parsed.withReviewers && parsed.sourceMarkerColumn !== null) {
    throw new Error('--source-marker-column is valid only with --with-reviewers.');
  }
  if (parsed.withReviewers && parsed.sourceMarkerColumn !== 'present' && parsed.sourceMarkerColumn !== 'absent') {
    throw new Error('--with-reviewers requires --source-marker-column=present|absent.');
  }
  // Bundle v4 (slice 4a, Recipe 4): the Pre-Site section extends v3, never
  // stands alone (buildSourceBundle enforces this again, defensively).
  if (parsed.withPreSite && !parsed.withReviewers) {
    throw new Error('--with-pre-site requires --with-reviewers (bundle v4 extends v3).');
  }
  return parsed;
}

function productionHost() {
  let hostname = null;
  try {
    hostname = new URL(process.env.DYNAMICS_URL || '').hostname.toLowerCase();
  } catch {
    // handled below
  }
  if (!PRODUCTION_HOSTS.includes(hostname)) {
    throw new Error('DYNAMICS_URL must be the registered production Dataverse host for a source-bundle export.');
  }
  if (process.env.DATAVERSE_ALLOW_PROD_READS !== 'yes') {
    throw new Error('DATAVERSE_ALLOW_PROD_READS=yes is required for this read-only production export.');
  }
  return hostname;
}

function bodyOrThrow(label, response) {
  if (!response?.ok) {
    const detail = String(response?.text || '').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 300);
    throw new Error(`${label} failed (${response?.status ?? 'no status'}): ${detail}`);
  }
  return response.body || {};
}

async function readSourceRow(client, requestNumber) {
  const filter = encodeURIComponent(`akoya_requestnum eq '${requestNumber}'`);
  const body = bodyOrThrow(
    'source Request lookup',
    await client.get(`/akoya_requests?$select=${SOURCE_SELECT}&$filter=${filter}&$top=2`),
  );
  const rows = body.value || [];
  requireUniqueSourceRequest(rows, Boolean(body['@odata.nextLink']));
  return rows[0];
}

async function readSourceRevision(client, requestId) {
  const body = bodyOrThrow(
    'source Request revalidation',
    await client.get(`/akoya_requests(${requestId})?$select=akoya_requestid,versionnumber`),
  );
  return body.versionnumber == null ? null : String(body.versionnumber);
}

/**
 * P2-C: null (no reviewer dependencies at all) unless `--with-reviewers` was
 * passed. Extracted as its own pure function so a test can assert the
 * decision without a live client/Graph or a full `main()` run.
 */
export function buildReviewerDependencies(args, { client, graph }) {
  if (!args.withReviewers) return null;
  return createReviewerSourceDependencies({
    client,
    graph,
    markerColumnPresent: args.sourceMarkerColumn === 'present',
  });
}

// Explicit $select allowlist: the ONLY columns this read-only production
// read ever names, so the input snapshot/fingerprint/generation key/
// lifecycle-history/claim token/AI-run link are never read off the wire in
// the first place (data-minimization boundary #1; source-bundle-presite.js's
// own projection is boundary #2, defense-in-depth).
const PRE_SITE_DOCUMENT_SELECT = [
  'wmkf_requestdocumentid', '_wmkf_request_value', 'wmkf_artifacttype', 'wmkf_contenttype',
  'wmkf_lifecyclestate', 'wmkf_producer', 'wmkf_presiteproposalcorejson',
  ...PRE_SITE_SECTION_FIELDS,
].join(',');

async function getRequestForPreSite(client, requestId) {
  const body = bodyOrThrow(
    'source Request Pre-Site pointer read',
    await client.get(`/akoya_requests(${requestId})?$select=akoya_requestid,_wmkf_currentpresitevisit_value`),
  );
  return body;
}

async function listPreSiteDocuments(client, requestId) {
  const filter = encodeURIComponent(
    `_wmkf_request_value eq ${requestId} and wmkf_artifacttype eq ${REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT}`,
  );
  const body = bodyOrThrow(
    'source Pre-Site request-document read',
    await client.get(`/wmkf_requestdocuments?$select=${PRE_SITE_DOCUMENT_SELECT}&$filter=${filter}&$top=50`),
  );
  return body.value || [];
}

/**
 * `null` (no Pre-Site dependencies) unless `--with-pre-site` was passed;
 * parseArgs already refused `--with-pre-site` without `--with-reviewers`.
 * `readAbstract` is a separate, equally narrow $select read (never through
 * `SOURCE_SELECT`, which the Basic create body/plan digest already bind to
 * -- P4 owner decision: `wmkf_abstract` must never enter that projection).
 */
export function buildPreSiteDependencies(args, { client }) {
  if (!args.withPreSite) return null;
  return {
    readPreSiteVisitDraft: (source) => readPreSiteVisitDraftForExport(
      { requestId: source.akoya_requestid },
      {
        getRequest: (requestId) => getRequestForPreSite(client, requestId),
        listPreSiteDocuments: (requestId) => listPreSiteDocuments(client, requestId),
      },
    ),
    readAbstract: async (source) => {
      const body = bodyOrThrow(
        'source Request abstract read',
        await client.get(`/akoya_requests(${source.akoya_requestid})?$select=akoya_requestid,wmkf_abstract`),
      );
      return body.wmkf_abstract ?? null;
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: DATAVERSE_ALLOW_PROD_READS=yes node --env-file=/abs/.env.local '
      + 'scripts/export-test-request-source-bundle.mjs --source-request-number=<n> --out=/abs/bundle.json '
      + '[--with-reviewers --source-marker-column=present|absent]');
    console.log('  --with-reviewers: include the confidential reviewers[] section (bundle v3). Off by default (writes the plain v2 bundle).');
    console.log('  --source-marker-column=present|absent: required with --with-reviewers, no default. Whether the PRODUCTION host has wave30\'s wmkf_issyntheticreviewer column -- NOT read from SYNTHETIC_REVIEWER_ISOLATION (that switch governs the app\'s own reads on whatever host this process points at; the exporter reads production while a later sandbox seeder may run against a sandbox with different schema state).');
    console.log('  --with-pre-site: include the preSiteVisit section and abstract (bundle v4). Requires --with-reviewers (v4 extends v3). Off by default.');
    return;
  }
  const hostname = productionHost();
  const resourceUrl = `https://${hostname}`;
  const client = createClient({ resourceUrl, token: await getAccessToken(resourceUrl) });

  // P2-C (Opus round 2, reversing round 1's "always wire the triad"):
  // reviewer content is confidential and is only read/exported when
  // --with-reviewers is explicitly passed. Without it, no reviewer
  // dependencies are given to the exporter at all, so it writes exactly the
  // pre-Stage-A v2 bundle (golden-digest-identical).
  const reviewerDeps = buildReviewerDependencies(args, { client, graph: SOURCE_BUNDLE_DEPENDENCIES });
  // Slice 4a: same posture for the Pre-Site section -- no dependencies at
  // all unless --with-pre-site was explicitly passed, so a plain or
  // --with-reviewers-only export stays exactly v2/v3 (golden-digest-identical).
  const preSiteDeps = buildPreSiteDependencies(args, { client });

  const bundle = await withDalContext('export-test-request-source-bundle', () => (
    exportTestRequestSourceBundle({
      sourceRequestNumber: args.sourceRequestNumber,
      dataverseHost: hostname,
      exportedAt: new Date(),
    }, {
      readSourceRow: (requestNumber) => readSourceRow(client, requestNumber),
      discoverDocuments: (source) => discoverTestRequestSourceDocuments(source, SOURCE_BUNDLE_DEPENDENCIES),
      assertReadLimits: assertTestRequestSourceReadLimits,
      hydrateDocument: (document) => hydrateTestRequestSourceDocument(document, SOURCE_BUNDLE_DEPENDENCIES),
      getDriveId: SOURCE_BUNDLE_DEPENDENCIES.getDriveId,
      getFileMetadataById: SOURCE_BUNDLE_DEPENDENCIES.getFileMetadataById,
      readSourceRevision: (requestId) => readSourceRevision(client, requestId),
      ...(reviewerDeps ? {
        discoverReviewers: reviewerDeps.discoverReviewers,
        hydrateReviewer: reviewerDeps.hydrateReviewer,
        readCurrentReviewerIdentity: reviewerDeps.readCurrentReviewerIdentity,
      } : {}),
      ...(preSiteDeps ? {
        readPreSiteVisitDraft: preSiteDeps.readPreSiteVisitDraft,
        readAbstract: preSiteDeps.readAbstract,
      } : {}),
    })
  ));
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, `${JSON.stringify(bundle, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ written: args.out, ...summarizeSourceBundle(bundle) }, null, 2));
}

// Guarded so a test can import this module's exported pure helpers
// (parseArgs, buildReviewerDependencies) without triggering a live run.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`[export-test-request-source-bundle] ${error.message}`);
    process.exit(1);
  });
}
