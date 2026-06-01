/**
 * API Route: /api/grant-reporting/lookup-grant
 *
 * POST: Look up a Dynamics request by request number AND list its SharePoint
 *       documents in a single round-trip. The frontend uses the result to
 *       prefill header fields and populate document pickers.
 *
 * Data boundary: staff-shared, scoped by `grant-reporting` or
 * `batch-phase-i-summaries` app access. Any user with that grant can look up
 * any request by its number — grant records are foundation-owned and are not
 * partitioned per program director at this layer. The bypass on Dynamics
 * restrictions is appropriate because the surface only returns whitelisted
 * header fields plus SharePoint file listings — never raw Dynamics rows.
 *
 * Request body: { requestNumber: string }
 *
 * Response shape (status 200):
 * {
 *   found: boolean,
 *   requestId: string | null,
 *   header: { title, pis: [], award_amount, project_period, subject_area, abstract, purpose },
 *   documents: {
 *     libraries: [{ library, folder, count, error }],
 *     files: [{ name, size, mimeType, lastModified, library, folder, subfolder, classification }],
 *     proposalBestGuess: string | null,  // composite key: "library::folder::filename"
 *     reportBestGuess: string | null,    // composite key: "library::folder::filename"
 *   } | null,
 *   errors: { dynamics: string | null, sharepoint: string | null }
 * }
 *
 * Files may live in multiple SharePoint document libraries:
 *   - "akoya_request" (the active grant folder linked via sharepointdocumentlocations)
 *   - "RequestArchive1/2/3" (legacy archives — populated for grants migrated from
 *     a previous grants management system; folder name follows the same
 *     `{requestNumber}_{guidNoHyphensUpper}` convention)
 * Each file carries its own library + folder so downstream callers can
 * route GraphService.downloadFileByPath() to the correct drive.
 *
 * Failure modes are non-fatal — the frontend can fall back to upload-only.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { DynamicsService } from '../../../lib/services/dynamics-service';
import { bypassDynamicsRestrictions } from '../../../lib/services/dynamics-context';
import { GraphService } from '../../../lib/services/graph-service';
import { getRequestSharePointBuckets } from '../../../lib/utils/sharepoint-buckets';

// Lookup is generic (request lookup + SharePoint doc listing) — any app that
// needs to target an akoya_request by request number can reuse this endpoint.
const APP_KEYS = ['grant-reporting', 'batch-phase-i-summaries'];

const HEADER_FIELDS = [
  'akoya_requestid',
  'akoya_requestnum',
  'akoya_title',
  'wmkf_abstract',
  'akoya_grant',
  'akoya_request',
  'akoya_begindate',
  'akoya_enddate',
  '_akoya_programid_value',
  '_wmkf_projectleader_value',
  '_wmkf_copi1_value',
  '_wmkf_copi2_value',
  '_wmkf_copi3_value',
  '_wmkf_copi4_value',
  '_wmkf_copi5_value',
].join(',');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, ...APP_KEYS);
  if (!access) return;

  const { requestNumber } = req.body || {};
  if (!requestNumber || typeof requestNumber !== 'string') {
    return res.status(400).json({ error: 'requestNumber is required' });
  }

  const trimmed = requestNumber.trim();
  const errors = { dynamics: null, sharepoint: null };

  return bypassDynamicsRestrictions('grant-reporting-lookup', async () => {
  // ─── Step 1: Dynamics lookup ─────────────────────────────────────────────
  let record = null;
  try {
    const result = await DynamicsService.queryRecords('akoya_requests', {
      select: HEADER_FIELDS,
      filter: `akoya_requestnum eq '${escapeOData(trimmed)}'`,
      top: 1,
    });
    record = result.records[0] || null;
  } catch (err) {
    console.error('[GrantReporting:lookup] Dynamics query failed:', err.message);
    // Response body exposes a generic category only. Full error (which may
    // contain table/field names, OData syntax, internal GUIDs) stays in server logs.
    errors.dynamics = 'Dynamics query failed';
    return res.status(200).json({
      found: false,
      requestId: null,
      header: emptyHeader(),
      documents: null,
      errors,
    });
  }

  if (!record) {
    return res.status(200).json({
      found: false,
      requestId: null,
      header: emptyHeader(),
      documents: null,
      errors: { dynamics: `No request found with number "${trimmed}"`, sharepoint: null },
    });
  }

  const requestId = record.akoya_requestid;
  const header = buildHeader(record);

  // ─── Step 2: SharePoint document listing ─────────────────────────────────
  let documents = null;
  try {
    documents = await listSharePointDocuments(requestId, trimmed);
  } catch (err) {
    console.error('[GrantReporting:lookup] SharePoint listing failed:', err.message);
    errors.sharepoint = 'SharePoint listing failed';
  }

  return res.status(200).json({
    found: true,
    requestId,
    header,
    documents,
    errors,
  });
  });
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function escapeOData(value) {
  return value.replace(/'/g, "''");
}

function emptyHeader() {
  return {
    title: '',
    pis: [],
    award_amount: '',
    project_period: '',
    subject_area: '',
    abstract: '',
    purpose: '',
  };
}

function buildHeader(record) {
  const pis = [];
  const projectLeader = record._wmkf_projectleader_value_formatted;
  if (projectLeader) pis.push(projectLeader);
  for (let i = 1; i <= 5; i++) {
    const copi = record[`_wmkf_copi${i}_value_formatted`];
    if (copi && !pis.includes(copi)) pis.push(copi);
  }

  // akoya_grant is the awarded amount; akoya_request is the applicant's ask
  // (intake-drain may populate this pre-decision once the intake portal ships,
  // so falling back to it would surface ask-as-award on records without a
  // decision yet). Pre-decision records show no award amount, which is correct.
  const awardAmountRaw = record.akoya_grant ?? null;
  const awardAmount = formatCurrency(awardAmountRaw);

  return {
    title: record.akoya_title || '',
    pis,
    award_amount: awardAmount,
    project_period: formatProjectPeriod(record.akoya_begindate, record.akoya_enddate),
    subject_area: record._akoya_programid_value_formatted || '',
    abstract: record.wmkf_abstract || '',
    purpose: '', // Not stored in Dynamics — staff fill in or Claude extracts from report
  };
}

function formatCurrency(value) {
  if (value === null || value === undefined || value === '') return '';
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  return `$${num.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function formatProjectPeriod(begin, end) {
  const beginStr = formatMonthYear(begin);
  const endStr = formatMonthYear(end);
  if (beginStr && endStr) return `${beginStr} – ${endStr}`;
  if (beginStr) return beginStr;
  if (endStr) return endStr;
  return '';
}

function formatMonthYear(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * List files attached to a request across every SharePoint library that
 * could plausibly hold its documents. Bucket discovery (Dynamics-tracked
 * locations + speculative archive probes) lives in
 * `lib/utils/sharepoint-buckets.js` so the Dynamics Explorer chat tool can
 * share the same logic.
 */
async function listSharePointDocuments(requestId, requestNumber) {
  // ── Step A+B: discover all plausible buckets ───────────────────────────
  const allBuckets = await getRequestSharePointBuckets(requestId, requestNumber);

  // ── Step C: list every bucket in parallel; tolerate 404 / permission errors
  // Recursive listing handles migrated grants where files live in subfolders
  // like `Final Report/`, `Year 1/`, etc. Each returned file carries its actual
  // folder path, so the download still resolves correctly.
  const bucketResults = await Promise.all(
    allBuckets.map(async bucket => {
      try {
        const rawFiles = await GraphService.listFiles(bucket.library, bucket.folder, {
          recursive: true,
        });
        return { ...bucket, files: rawFiles, error: null };
      } catch (err) {
        return { ...bucket, files: [], error: err.message };
      }
    }),
  );

  // ── Step D: flatten + de-duplicate ─────────────────────────────────────
  // Each file carries its actual folder (which may be a subfolder of the
  // bucket root). `subfolder` is the bit relative to the bucket root — empty
  // string for top-level files, `"Final Report"` etc. for nested ones — and
  // is exposed so the picker UI can show users where each file lives.
  const seen = new Set();
  const files = [];
  for (const bucket of bucketResults) {
    for (const f of bucket.files) {
      const fileFolder = f.folder || bucket.folder;
      const subfolder = fileFolder.startsWith(bucket.folder + '/')
        ? fileFolder.slice(bucket.folder.length + 1)
        : '';
      const k = `${bucket.library}::${fileFolder}::${f.name}`;
      if (seen.has(k)) continue;
      seen.add(k);
      files.push({
        name: f.name,
        size: f.size,
        mimeType: f.mimeType,
        lastModified: f.lastModified,
        library: bucket.library,
        folder: fileFolder,
        subfolder,
        classification: classifyFile(f.name),
      });
    }
  }

  const libraries = bucketResults.map(b => ({
    library: b.library,
    folder: b.folder,
    count: b.files.length,
    error: b.error,
  }));

  if (files.length === 0) {
    return {
      libraries,
      files: [],
      proposalBestGuess: null,
      reportBestGuess: null,
      message: 'No files found in any document library for this request.',
    };
  }

  return {
    libraries,
    files,
    proposalBestGuess: pickProposalBestGuess(files),
    reportBestGuess: pickReportBestGuess(files),
  };
}

/** Composite picker key: "library::folder::filename" — used by the frontend
 *  dropdown. Includes the folder so files with the same name in different
 *  subfolders (e.g. `Year 1/Report.docx` vs `Year 2/Report.docx`) don't collide. */
function fileKey(file) {
  return `${file.library}::${file.folder}::${file.name}`;
}

/**
 * Classify a SharePoint filename as a Phase II proposal, a grant report, or other.
 *
 * Heuristic notes:
 * - The Phase II application is often named with "project narrative" or "Project_Narrative".
 * - A "Phase I" file is the WRONG document for goals assessment — exclude with a separator
 *   class that treats `-`, `_`, and whitespace as boundaries (since `\b` fails on `_`).
 * - "final" alone is a poor report signal — many Phase II proposal files are versioned as
 *   "... Phase II - FINAL.docx". Only treat "final report" / "final narrative" as a report.
 * - Underscores are word characters, so `\binterim\b` fails on `_Interim_`. We use a custom
 *   separator class `[\s_\-]` instead.
 */
const SEP = '(?:^|[\\s_\\-])';
const SEP_END = '(?:[\\s_\\-]|$)';
const wordRe = (w) => new RegExp(`${SEP}${w}${SEP_END}`, 'i');

export function classifyFile(name) {
  const n = (name || '').toLowerCase();

  // Phase I (not Phase II) is the wrong document for a Phase II goals assessment.
  const isPhaseI = wordRe('phase[\\s_]?i').test(n) && !wordRe('phase[\\s_]?ii').test(n);
  if (isPhaseI) return 'other';

  // Front-matter / package boilerplate is NEVER the substantive proposal
  // narrative, even though such filenames often contain "Application" (e.g.
  // "Application Cover Page.docx") — which would otherwise trip the broad
  // `application` proposal signal below and get auto-picked over the real
  // narrative (reported bug: Reviewer Finder loaded the cover page). A project
  // narrative wins regardless (the most specific positive signal), so the
  // exclusion is gated on NOT being a narrative.
  // "project narrative" and "project description" are the two common names for
  // the substantive proposal body (the latter often written solid, e.g.
  // "ProjectDescription.pdf" — `[\s_\-]*` matches zero separators too).
  const hasNarrative = /project[\s_\-]*(narrative|description)/i.test(n);
  const isFrontMatter =
    /cover[\s_\-]*(page|sheet|letter)/i.test(n) ||
    /face[\s_\-]*page/i.test(n) ||
    /title[\s_\-]*page/i.test(n) ||
    /signature[\s_\-]*page/i.test(n) ||
    /application[\s_\-]*form/i.test(n);
  if (isFrontMatter && !hasNarrative) return 'other';

  // Strong proposal signals.
  const isProposal =
    hasNarrative ||
    wordRe('phase[\\s_]?ii').test(n) ||
    wordRe('proposal').test(n) ||
    wordRe('application').test(n);

  // Report signals. Note: "final" alone is excluded because proposals are often versioned
  // as "...Phase II - FINAL.docx"; require "final report" / "final narrative" instead.
  const isReport =
    wordRe('report').test(n) ||
    wordRe('annual').test(n) ||
    wordRe('interim').test(n) ||
    wordRe('progress').test(n) ||
    /final[\s_\-]+(report|narrative|summary)/i.test(n);

  // When both fire, proposal-specific signals win — "Project Narrative ... FINAL" is a
  // versioned proposal, not a report. Without this, the picker drops the actual narrative
  // and falls back to a cover page.
  if (isProposal) return 'proposal';
  if (isReport) return 'report';
  return 'other';
}

function pickProposalBestGuess(files) {
  const proposals = files.filter(f => f.classification === 'proposal');
  if (proposals.length === 0) return null;

  // Tier 1: the proposal body — "Project Narrative", "Project_Narrative", or
  // "Project Description" / "ProjectDescription".
  const tier1 = proposals.filter(f => /project[\s_\-]*(narrative|description)/i.test(f.name));
  // Tier 2: phase ii (handles "Phase II", "Phase_II", "Phase-II")
  const phaseIIRe = /(?:^|[\s_\-])phase[\s_]?ii(?:[\s_\-]|$)/i;
  const tier2 = proposals.filter(f => phaseIIRe.test(f.name));

  // Within a tier, prefer .docx (the original format we typically have for
  // proposals) then .pdf, then anything else.
  const extScore = name => {
    const n = name.toLowerCase();
    if (n.endsWith('.docx')) return 0;
    if (n.endsWith('.pdf')) return 1;
    return 2;
  };
  const sortByExt = arr =>
    arr.slice().sort((a, b) => extScore(a.name) - extScore(b.name));

  if (tier1.length > 0) return fileKey(sortByExt(tier1)[0]);
  if (tier2.length > 0) return fileKey(sortByExt(tier2)[0]);
  return fileKey(sortByExt(proposals)[0]);
}

function pickReportBestGuess(files) {
  const reports = files.filter(f => f.classification === 'report');
  if (reports.length === 0) return null;
  // Newest first
  const sorted = reports.slice().sort((a, b) => {
    const at = a.lastModified ? new Date(a.lastModified).getTime() : 0;
    const bt = b.lastModified ? new Date(b.lastModified).getTime() : 0;
    return bt - at;
  });
  return fileKey(sorted[0]);
}
