/**
 * Reviewer-candidate Excel export (Find tab → "Export to Excel").
 *
 * Builds a two-sheet workbook with ExcelJS (already a dependency):
 *   - "Request Info" — key/value metadata (request #, institution, PI, …),
 *     fetched server-side from akoya_request and passed in as `meta` (never
 *     trusted from the client).
 *   - "Candidates" — one row per selected reviewer with self-explanatory
 *     headers. Derived columns (Source, Why selected, Potential conflicts,
 *     ORCID iD, Google Scholar) are computed HERE from each candidate's raw
 *     fields so the spreadsheet and the on-screen cards stay in sync from one
 *     place.
 *
 * The client sends a slim per-candidate DTO (the same fields the card resolves);
 * this module owns the formatting. Returns an .xlsx Buffer.
 */

import ExcelJS from 'exceljs';
import { provenanceLabelForCandidate } from '../utils/reviewer-provenance';

// Defensive ceilings so a malformed/oversized payload can't blow up the sheet.
const MAX_CELL_CHARS = 4000;

function clamp(value) {
  if (value == null) return '';
  const s = String(value);
  return s.length > MAX_CELL_CHARS ? `${s.slice(0, MAX_CELL_CHARS)}…` : s;
}

/** Bare ORCID iD (0000-0002-1234-5678) extracted from an orcid.org URL or raw value. */
export function extractOrcidId(orcidUrl) {
  if (!orcidUrl) return '';
  const m = String(orcidUrl).match(/(\d{4}-\d{4}-\d{4}-\d{3}[\dX])/i);
  return m ? m[1] : '';
}

/** "Source" column — origin label (Applicant-recommended, Literature-retrieved, …). */
export function sourceLabel(c) {
  // provenanceLabelForCandidate short-circuits on a pre-built `provenance` object
  // (which displayCandidates always attaches); fall back to the applicant flag.
  try {
    const label = provenanceLabelForCandidate(c);
    if (label) return label;
  } catch { /* fall through */ }
  return c?.isApplicantRecommended ? 'Applicant-suggested' : 'Candidate';
}

/** "Why selected" column — Claude's justification, or the applicant-named note. */
export function whySelected(c) {
  const reason = c?.reasoning || c?.generatedReasoning || null;
  if (reason) return reason;
  return c?.isApplicantRecommended ? 'Named by the applicant' : '—';
}

/** "Potential conflicts" column — composed COI summary, never blank. */
export function formatConflicts(c) {
  const parts = [];
  if (c?.hasInstitutionCOI) {
    const inst = c.institutionCOIDetails?.reviewerInstitution
      || c.institutionCOIDetails?.piInstitution
      || null;
    parts.push(inst ? `Institution COI: ${inst}` : 'Institution COI');
  }
  if (c?.hasCoauthorCOI) {
    const strength = c.coauthorCOIStrength === 'possible' ? 'possible' : 'likely';
    const n = Array.isArray(c.coauthorships) ? c.coauthorships.length : 0;
    const papers = n ? `, ${n} shared paper${n === 1 ? '' : 's'}` : '';
    parts.push(`Co-author overlap (${strength}${papers})`);
  }
  return parts.length ? parts.join('; ') : 'None noted';
}

const CANDIDATE_COLUMNS = [
  { header: 'Reviewer name', key: 'name', width: 26 },
  { header: 'Affiliation', key: 'affiliation', width: 32 },
  { header: 'Email', key: 'email', width: 28 },
  { header: 'Source', key: 'source', width: 20 },
  { header: 'Why selected', key: 'why', width: 60 },
  { header: 'Potential conflicts', key: 'conflicts', width: 30 },
  { header: 'ORCID iD', key: 'orcid', width: 22 },
  { header: 'Google Scholar', key: 'scholar', width: 40 },
  { header: 'h-index', key: 'hIndex', width: 10 },
  { header: '5-yr publications', key: 'pubCount', width: 16 },
  { header: 'Seniority', key: 'seniority', width: 16 },
];

/** Numeric cell value when a finite number is present, else '' (never a stray 0). */
function num(value) {
  return Number.isFinite(value) ? value : '';
}

/**
 * @param {object} meta  request metadata fetched server-side
 * @param {Array<object>} candidates  slim per-candidate DTOs from the client
 * @returns {Promise<Buffer>} .xlsx file buffer
 */
export async function buildReviewerCandidateWorkbook({ meta = {}, candidates = [] }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'WMKF Reviewer Finder';

  // ── Sheet 1: Request Info ─────────────────────────────────────────────
  const info = wb.addWorksheet('Request Info');
  info.columns = [{ width: 22 }, { width: 72 }];
  const kv = (label, value) => {
    const row = info.addRow([label, value == null || value === '' ? '—' : clamp(value)]);
    row.getCell(1).font = { bold: true };
  };
  kv('Request #', meta.requestNumber);
  kv('Institution', meta.institution);
  kv('PI', meta.pi);
  if (meta.applicant && meta.applicant !== meta.pi) kv('Applicant', meta.applicant);
  if (meta.title) kv('Proposal title', meta.title);
  if (meta.program) kv('Program', meta.program);
  if (meta.cycleLabel) kv('Cycle', meta.cycleLabel);
  kv('Exported', meta.exportedDate);
  kv('Candidates', String(candidates.length));

  // ── Sheet 2: Candidates ───────────────────────────────────────────────
  const sheet = wb.addWorksheet('Candidates');
  sheet.columns = CANDIDATE_COLUMNS;
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  for (const c of candidates) {
    const orcidId = extractOrcidId(c.orcidUrl);
    const scholarReal = !!c.hasRealScholar;
    const scholarUrl = c.scholarUrl || null;
    const row = sheet.addRow({
      name: clamp(c.name),
      affiliation: clamp(c.affiliation),
      email: clamp(c.email),
      source: clamp(sourceLabel(c)),
      why: clamp(whySelected(c)),
      conflicts: clamp(formatConflicts(c)),
      orcid: orcidId,
      scholar: scholarUrl ? (scholarReal ? scholarUrl : `${scholarUrl} (search)`) : '',
      hIndex: num(c.hIndex),
      pubCount: num(c.publicationCount5yr),
      seniority: clamp(c.seniorityEstimate),
    });
    row.alignment = { vertical: 'top', wrapText: true };
    if (orcidId && c.orcidUrl) {
      row.getCell('orcid').value = { text: orcidId, hyperlink: String(c.orcidUrl) };
    }
    if (scholarUrl) {
      row.getCell('scholar').value = {
        text: scholarReal ? 'Google Scholar' : 'Scholar search',
        hyperlink: String(scholarUrl),
      };
    }
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
