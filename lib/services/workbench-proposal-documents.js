/**
 * Workbench Proposal-tab document listing (server-only).
 *
 * Lists a request's SharePoint files for the Proposal tab. Historical files in
 * the per-cycle `Phase I` subfolder are mapped to configured labeled slots;
 * the exact external-reviewer PDF and the canonical files in `AI Materials`
 * are surfaced separately (two governed inputs for every cycle, plus the
 * other individual files for single-submission cycles, J27 onward).
 * Returns the library/folder/name each consumer needs to build a scoped
 * download URL; the download proxy re-validates request membership.
 *
 * Interim D26 bridge — see docs/WORKBENCH_PROPOSAL_TAB_BUILD_PLAN.md.
 */

import { GraphService } from './graph-service.js';
import { getRequestSharePointBuckets } from '../utils/sharepoint-buckets.js';
import { createSiteVisitMaterialsRecursiveReaderFilter } from './site-visit-materials/recursive-reader-filter.js';
import { extractTextFromBuffer } from '../utils/file-loader.js';
import { isReviewerProposalFile } from '../external/reviewer-materials.js';
import { getProposalDocumentConfig } from '../../shared/config/workbenchProposalDocuments.js';
import { createHash } from 'crypto';
import {
  acceptedProposalBibliographyFilenames,
  acceptedProposalNarrativeFilenames,
} from '../utils/proposal-document-names.js';

export {
  expectedProposalBibliographyFilename,
  expectedProposalNarrativeFilename,
} from '../utils/proposal-document-names.js';

const norm = (s) => String(s || '').trim().toLowerCase();
const AI_MATERIALS_FOLDER = 'AI Materials';
// Where single-submission cycles keep the applicant's individual files
// (Connor, 2026-11-10; seen on test request 1003384).
const SUBMISSION_DOCUMENTS_FOLDER = 'Submission-Documents';
const PHASE_II_FOLDER = 'Phase II';
// Matches SINGLE_SUBMISSION_LAYOUT in shared/config/workbenchProposalDocuments.js.
const SINGLE_SUBMISSION_LAYOUT = 'single-submission';

/** True when `folderPath`'s segments include the configured phase folder. */
function isInPhaseFolder(folderPath, phaseFolder) {
  const target = norm(phaseFolder);
  return String(folderPath || '')
    .split('/')
    .some((seg) => norm(seg) === target);
}

function isExpectedMissingArchiveFolder(bucket, error) {
  return bucket?.source === 'archive'
    && /\(\s*404\s*\)/.test(String(error?.message || ''));
}

function exactNames(filenames) {
  return (name) => filenames.includes(name);
}

/**
 * The individual files the Proposal tab lists. Through D26 these are the two
 * governed inputs in `AI Materials` (either accepted name). Single-submission
 * cycles list six files from `Submission-Documents` instead (alignment log
 * D20, D58): all PDFs except the graphical abstract, an image (a .jpg on the
 * test request) matched on its stem with any one extension. Other files in
 * that folder are not listed.
 */
function aiMaterialSpecs(requestNumber, layout) {
  const narrative = acceptedProposalNarrativeFilenames(requestNumber);
  const bibliography = acceptedProposalBibliographyFilenames(requestNumber);
  if (layout !== SINGLE_SUBMISSION_LAYOUT) {
    return [
      { key: 'proposalNarrative', label: 'Proposal Narrative', filename: narrative[0] || null, matches: exactNames(narrative) },
      { key: 'proposalBibliography', label: 'Proposal Bibliography', filename: bibliography[0] || null, matches: exactNames(bibliography) },
    ];
  }
  const number = String(requestNumber ?? '').trim();
  const pdf = (key, label, type) => {
    const filename = number ? `${type}_${number}.pdf` : null;
    return { key, label, filename, matches: (name) => !!filename && name === filename };
  };
  const graphicalStem = number ? `Graphical-Abstract_${number}.` : null;
  return [
    { key: 'proposalNarrative', label: 'Project Narrative', filename: narrative[1] || null, matches: exactNames(narrative) },
    { key: 'proposalBibliography', label: 'Bibliography', filename: bibliography[1] || null, matches: exactNames(bibliography) },
    pdf('biosketches', 'Biosketches', 'Biosketches'),
    pdf('otherSupport', 'Other Support', 'Other-Support'),
    pdf('collaborationLetters', 'Collaboration Letters', 'Collaboration-Letters'),
    {
      key: 'graphicalAbstract',
      label: 'Graphical Abstract',
      filename: null,
      matches: (name) => !!graphicalStem
        && name.startsWith(graphicalStem)
        && name.length > graphicalStem.length
        && !name.slice(graphicalStem.length).includes('.'),
    },
  ];
}

/**
 * @returns {Promise<{ slots: Array, reviewerMaterials: Array, phaseIIDocuments: Array, aiMaterials: Array, otherDocuments: Array, libraries: Array, errors: Array }>}
 *   slots: [{ key, label, filename, found, library?, folder?, name?, size?, mimeType? }]
 *   reviewerMaterials: exact `Reviewer Materials/Proposal_{requestNumber}.pdf` files
 *   phaseIIDocuments: every file under the request's Phase II folder
 *   layout: 'single-submission' for J27 and later cycles, otherwise absent
 *   staffVersion: single-submission only; { key, label, found, ...file }
 *   aiMaterials: same shape; exact canonical files from the active request only
 *     (`AI Materials`, or `Submission-Documents` for single-submission cycles)
 *   otherDocuments: [{ name, library, folder, size, mimeType }]
 */
export async function listProposalDocuments(requestId, requestNumber, cycleCode) {
  const config = getProposalDocumentConfig(cycleCode);
  const buckets = await getRequestSharePointBuckets(requestId, requestNumber);

  const errors = [];
  const seen = new Set();
  const filterSiteVisitMaterials = createSiteVisitMaterialsRecursiveReaderFilter(requestId, requestNumber);
  const availableFiles = [];
  const phaseFiles = [];
  const reviewerMaterials = [];
  const phaseIIDocuments = [];
  for (const b of buckets) {
    let files = [];
    try {
      const listed = await GraphService.listFiles(b.library, b.folder, { recursive: true, excludeApplicantMaterialsBackgroundUploads: true });
      const filtered = await filterSiteVisitMaterials(b.library, b.folder, listed);
      files = filtered.files;
      if (filtered.error) errors.push({ library: b.library, folder: b.folder });
    } catch (e) {
      // Archive buckets are speculative. A clean 404 means this request was
      // never stored in that archive, not that document discovery is degraded.
      if (isExpectedMissingArchiveFolder(b, e)) continue;
      // Log the raw Graph error server-side; surface only sanitized metadata to
      // the client (raw messages can leak internal library/folder diagnostics).
      console.error(`proposal-documents listFiles failed for ${b.library}/${b.folder}:`, e.message);
      errors.push({ library: b.library, folder: b.folder });
      continue;
    }
    for (const f of files) {
      const folder = f.folder || b.folder;
      const key = `${b.library}::${folder}::${f.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const listed = {
        name: f.name,
        library: b.library,
        folder,
        size: f.size ?? null,
        mimeType: f.mimeType ?? null,
      };
      availableFiles.push(listed);
      if (isReviewerProposalFile(folder, f.name, requestNumber)) reviewerMaterials.push(listed);
      if (isInPhaseFolder(folder, PHASE_II_FOLDER)) phaseIIDocuments.push(listed);
      // Single-submission cycles have no phase folder to map.
      if (!config.phaseFolder) continue;
      if (!isInPhaseFolder(folder, config.phaseFolder)) continue;
      if (config.excludeFilenames.some((ex) => norm(ex) === norm(f.name))) continue;
      phaseFiles.push(listed);
    }
  }

  // Map configured slots to files by exact (case-insensitive) filename.
  const used = new Set();
  const slots = config.slots.map((slot) => {
    const file = phaseFiles.find((f) => !used.has(f) && norm(f.name) === norm(slot.filename));
    if (!file) return { key: slot.key, label: slot.label, filename: slot.filename, found: false };
    used.add(file);
    return {
      key: slot.key,
      label: slot.label,
      filename: slot.filename,
      found: true,
      library: file.library,
      folder: file.folder,
      name: file.name,
      size: file.size,
      mimeType: file.mimeType,
    };
  });

  // Anything in Phase I not claimed by a slot — surfaced, never silently dropped.
  const otherDocuments = phaseFiles.filter((f) => !used.has(f));

  // Mirror the governed AI-input resolver: only one positively resolved active
  // akoya_request bucket can supply these display/download entries. Folder and
  // filenames are deliberately case-sensitive and exact.
  const activeBuckets = buckets.filter((bucket) => (
    bucket.source === 'dynamics' && norm(bucket.library) === 'akoya_request'
  ));
  const activeBucket = activeBuckets.length === 1 ? activeBuckets[0] : null;
  const activeRoot = String(activeBucket?.folder || '').replace(/\/+$/, '');
  const individualFilesFolder = config.layout === SINGLE_SUBMISSION_LAYOUT
    ? SUBMISSION_DOCUMENTS_FOLDER
    : AI_MATERIALS_FOLDER;
  const aiFolder = activeRoot ? `${activeRoot}/${individualFilesFolder}` : null;
  const aiMaterials = aiMaterialSpecs(requestNumber, config.layout).map(({ matches: matchesName, filename, ...slot }) => {
    const matches = aiFolder
      ? availableFiles.filter((candidate) => (
        candidate.library === activeBucket.library
        && candidate.folder === aiFolder
        && matchesName(candidate.name)
      ))
      : [];
    // Exactly one accepted name must be present, mirroring the governed reader.
    const file = matches.length === 1 ? matches[0] : null;
    return file
      ? { ...slot, filename: file.name, found: true, ...file }
      : { ...slot, filename, found: false };
  });

  // Single-submission cycles: the combined staff version sits at the root of
  // the active request folder, named `{AKA}_Staff-Version_{Request#}.pdf`
  // (Connor, 2026-11-10). The institution's AKA is not checked: the file is
  // matched on the rest of the name, and exactly one match is required.
  let staffVersion;
  if (config.layout === SINGLE_SUBMISSION_LAYOUT) {
    const number = String(requestNumber ?? '').trim();
    const suffix = `_staff-version_${number}.pdf`;
    const matches = activeRoot && number
      ? availableFiles.filter((candidate) => (
        candidate.library === activeBucket.library
        && candidate.folder === activeRoot
        && candidate.name.length > suffix.length
        && candidate.name.toLowerCase().endsWith(suffix)
      ))
      : [];
    staffVersion = matches.length === 1
      ? { key: 'staffVersion', label: 'Staff version', found: true, ...matches[0] }
      : { key: 'staffVersion', label: 'Staff version', found: false };
  }

  return {
    // 'single-submission' when the request's cycle lists individual files
    // instead of Phase I slots; absent otherwise.
    ...(config.layout ? { layout: config.layout } : {}),
    ...(staffVersion ? { staffVersion } : {}),
    slots,
    reviewerMaterials,
    phaseIIDocuments,
    aiMaterials,
    otherDocuments,
    libraries: buckets.map((b) => ({ library: b.library, folder: b.folder, source: b.source })),
    errors,
  };
}

/**
 * Fetch + extract the canonical AI proposal narrative for governed proposal
 * analysis. The source is fail-closed to the one exact file in the positively
 * resolved active request library:
 *
 *   AI Materials/ProposalNarrative_{requestNumber}.pdf   (D26 flows)
 *   AI Materials/Project-Narrative_{requestNumber}.pdf   (J27 name, as first planned)
 *   Submission-Documents/Project-Narrative_{requestNumber}.pdf   (J27 flows)
 *
 * Exactly one accepted copy must be present; more than one fails closed.
 * The D26 Proposal tab may still display the historical Phase I slots above,
 * but governed analysis through this helper (Field Primer and Initial
 * Assessment) must not silently substitute the complete reviewer package,
 * ProjectDescription.pdf, or an archive copy when the narrative is absent.
 * Reviewer Finder owns its separate current-cycle loader; its planned
 * single-submission-cycle cutover is documented but is not implemented here.
 *
 * @returns {Promise<{
 *   text: string,
 *   filename: string,
 *   siteId: string,
 *   driveId: string,
 *   itemId: string,
 *   versionId: string,
 *   contentHash: string,
 * } | null>}
 */
async function resolveActiveRequestRoot(requestId, requestNumber) {
  const buckets = await getRequestSharePointBuckets(requestId, requestNumber, {
    requireResolvedParents: true,
  });
  const active = buckets.filter((bucket) => (
    bucket.source === 'dynamics'
    && String(bucket.library || '').toLowerCase() === 'akoya_request'
  ));
  if (active.length !== 1) return null;

  const library = active[0].library;
  const requestRoot = String(active[0].folder || '').replace(/\/+$/, '');
  if (!requestRoot) return null;
  return { library, requestRoot };
}

export async function resolveActiveAiMaterialsFolder(requestId, requestNumber) {
  const location = await resolveActiveRequestRoot(requestId, requestNumber);
  return location
    ? { library: location.library, folder: `${location.requestRoot}/${AI_MATERIALS_FOLDER}` }
    : null;
}

/**
 * The exact places a governed input may be: `AI Materials` under either
 * accepted name (D26 flows, and the J27 names first planned there), or
 * `Submission-Documents` under the J27 name, where single-submission cycles
 * keep the applicant's files (owner with Connor, 2026-11-10).
 */
function governedInputCandidates(requestRoot, acceptedFilenames) {
  const j27Name = acceptedFilenames[1];
  return [
    ...acceptedFilenames.map((filename) => ({ folder: `${requestRoot}/${AI_MATERIALS_FOLDER}`, filename })),
    ...(j27Name ? [{ folder: `${requestRoot}/${SUBMISSION_DOCUMENTS_FOLDER}`, filename: j27Name }] : []),
  ];
}

async function getExactAiMaterialText({ library, candidates }) {
  if (!candidates?.length) return null;
  const lookups = await Promise.all(candidates.map(async ({ folder, filename }) => ({
    folder,
    filename,
    metadata: await GraphService.getFileMetadataByPath(library, folder, filename),
  })));
  const present = lookups.filter(({ metadata }) => metadata);
  // Zero or more than one accepted copy present: fail closed rather than pick.
  if (present.length !== 1) return null;
  const { folder, filename: expectedFilename, metadata: metadataBefore } = present[0];
  const versionBefore = metadataBefore?.versionId || metadataBefore?.eTag || null;
  if (
    !metadataBefore
    || metadataBefore.name !== expectedFilename
    || !metadataBefore.driveId
    || !metadataBefore.id
    || !versionBefore
  ) return null;

  const dl = await GraphService.downloadFile(
    metadataBefore.driveId,
    metadataBefore.id,
  );
  if (dl.filename !== expectedFilename) return null;

  // Re-resolve the governed path after downloading. If the path, item, or
  // version changed while the bytes were in flight, discard the result rather
  // than recording provenance for a different SharePoint version.
  const metadataAfter = await GraphService.getFileMetadataByPath(
    library,
    folder,
    expectedFilename,
  );
  const versionAfter = metadataAfter?.versionId || metadataAfter?.eTag || null;
  if (
    !metadataAfter
    || metadataAfter.name !== expectedFilename
    || metadataAfter.siteId !== metadataBefore.siteId
    || metadataAfter.driveId !== metadataBefore.driveId
    || metadataAfter.id !== metadataBefore.id
    || metadataAfter.eTag !== metadataBefore.eTag
    || metadataAfter.versionId !== metadataBefore.versionId
    || versionAfter !== versionBefore
  ) return null;

  const text = await extractTextFromBuffer(dl.buffer, expectedFilename, dl.mimeType);
  return {
    text: text || '',
    filename: expectedFilename,
    siteId: metadataAfter.siteId,
    driveId: metadataAfter.driveId,
    itemId: metadataAfter.id,
    versionId: versionAfter,
    contentHash: createHash('sha256').update(dl.buffer).digest('hex'),
  };
}

export async function getAiProposalNarrativeText(requestId, requestNumber) {
  const acceptedFilenames = acceptedProposalNarrativeFilenames(requestNumber);
  if (!acceptedFilenames.length) return null;
  const location = await resolveActiveRequestRoot(requestId, requestNumber);
  if (!location) return null;
  return getExactAiMaterialText({
    library: location.library,
    candidates: governedInputCandidates(location.requestRoot, acceptedFilenames),
  });
}

/**
 * Fetch the two canonical proposal-analysis inputs from the same positively
 * resolved active request folder. This is fail-closed: a missing, renamed, or
 * differently cased component returns null rather than substituting another
 * PDF or sending Claude an incomplete source set.
 */
export async function getAiProposalMaterialsText(requestId, requestNumber) {
  const narrativeFilenames = acceptedProposalNarrativeFilenames(requestNumber);
  const bibliographyFilenames = acceptedProposalBibliographyFilenames(requestNumber);
  if (!narrativeFilenames.length || !bibliographyFilenames.length) return null;

  const location = await resolveActiveRequestRoot(requestId, requestNumber);
  if (!location) return null;
  const { library, requestRoot } = location;
  const [narrative, bibliography] = await Promise.all([
    getExactAiMaterialText({ library, candidates: governedInputCandidates(requestRoot, narrativeFilenames) }),
    getExactAiMaterialText({ library, candidates: governedInputCandidates(requestRoot, bibliographyFilenames) }),
  ]);
  return { narrative, bibliography };
}
