/**
 * Grant Reporting — request lookup + SharePoint document listing service
 * (Route→Service Consolidation Plan, Stage 5).
 *
 * Holds the business logic for POST /api/grant-reporting/lookup-grant; the
 * route is a thin shell (method dispatch, app-access guard, input validation,
 * DAL context, HTTP mapping). See the route header for the caller-facing
 * response contract.
 *
 * Contract (plan Decision 3):
 *   - plain argument object, never req/res;
 *   - EVERY outcome (found, not-found, Dynamics failure, SharePoint failure)
 *     is a 200 in the historical route, so this service never throws domain
 *     errors — it returns the exact 200 body;
 *   - ASSUMES a trusted DAL context already exists — never establishes one.
 */

import { GraphService } from '../graph-service';
import { getRequestSharePointBuckets } from '../../utils/sharepoint-buckets';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import { classifyFile } from './classify-file';

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

/**
 * Look up a request by number and list its SharePoint documents.
 *
 * @param {Object} args
 * @param {string} args.requestNumber - already presence/type-validated by the shell
 * @returns {Promise<Object>} the historical 200 body:
 *   { found, requestId, header, documents, errors }
 */
export async function lookupGrant({ requestNumber }) {
  const trimmed = requestNumber.trim();
  const errors = { dynamics: null, sharepoint: null };

  // ─── Step 1: Dynamics lookup ─────────────────────────────────────────────
  let record = null;
  try {
    const result = await grantRequestAdapter.findByRequestNumber(trimmed, {
      select: HEADER_FIELDS,
      top: 1,
    });
    record = result.records[0] || null;
  } catch (err) {
    console.error('[GrantReporting:lookup] Dynamics query failed:', err.message);
    // Response body exposes a generic category only. Full error (which may
    // contain table/field names, OData syntax, internal GUIDs) stays in server logs.
    errors.dynamics = 'Dynamics query failed';
    return {
      found: false,
      requestId: null,
      header: emptyHeader(),
      documents: null,
      errors,
    };
  }

  if (!record) {
    return {
      found: false,
      requestId: null,
      header: emptyHeader(),
      documents: null,
      errors: { dynamics: `No request found with number "${trimmed}"`, sharepoint: null },
    };
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

  return {
    found: true,
    requestId,
    header,
    documents,
    errors,
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

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
