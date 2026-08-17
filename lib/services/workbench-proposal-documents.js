/**
 * Workbench Proposal-tab document listing (server-only).
 *
 * Lists a request's SharePoint files for the Proposal tab. Historical files in
 * the per-cycle `Phase I` subfolder are mapped to configured labeled slots;
 * the two exact canonical files in `AI Materials` are surfaced separately.
 * Returns the library/folder/name each consumer needs to build a scoped
 * download URL; the download proxy re-validates request membership.
 *
 * Interim D26 bridge — see docs/WORKBENCH_PROPOSAL_TAB_BUILD_PLAN.md.
 */

import { GraphService } from './graph-service';
import { getRequestSharePointBuckets } from '../utils/sharepoint-buckets';
import { extractTextFromBuffer } from '../utils/file-loader';
import { getProposalDocumentConfig } from '../../shared/config/workbenchProposalDocuments';
import { createHash } from 'crypto';

const norm = (s) => String(s || '').trim().toLowerCase();
const AI_MATERIALS_FOLDER = 'AI Materials';

export function expectedProposalNarrativeFilename(requestNumber) {
  const normalized = String(requestNumber ?? '').trim();
  return normalized ? `ProposalNarrative_${normalized}.pdf` : null;
}

export function expectedProposalBibliographyFilename(requestNumber) {
  const normalized = String(requestNumber ?? '').trim();
  return normalized ? `ProposalBibliography_${normalized}.pdf` : null;
}

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

function aiMaterialSpecs(requestNumber) {
  return [
    {
      key: 'proposalNarrative',
      label: 'Proposal Narrative',
      filename: expectedProposalNarrativeFilename(requestNumber),
    },
    {
      key: 'proposalBibliography',
      label: 'Proposal Bibliography',
      filename: expectedProposalBibliographyFilename(requestNumber),
    },
  ];
}

/**
 * @returns {Promise<{ slots: Array, aiMaterials: Array, otherDocuments: Array, libraries: Array, errors: Array }>}
 *   slots: [{ key, label, filename, found, library?, folder?, name?, size?, mimeType? }]
 *   aiMaterials: same shape; exact canonical files from the active request only
 *   otherDocuments: [{ name, library, folder, size, mimeType }]
 */
export async function listProposalDocuments(requestId, requestNumber, cycleCode) {
  const config = getProposalDocumentConfig(cycleCode);
  const buckets = await getRequestSharePointBuckets(requestId, requestNumber);

  const errors = [];
  const seen = new Set();
  const availableFiles = [];
  const phaseFiles = [];
  for (const b of buckets) {
    let files = [];
    try {
      files = await GraphService.listFiles(b.library, b.folder, { recursive: true });
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
  const aiFolder = activeRoot ? `${activeRoot}/${AI_MATERIALS_FOLDER}` : null;
  const aiMaterials = aiMaterialSpecs(requestNumber).map((slot) => {
    const file = aiFolder && slot.filename
      ? availableFiles.find((candidate) => (
        candidate.library === activeBucket.library
        && candidate.folder === aiFolder
        && candidate.name === slot.filename
      ))
      : null;
    return file
      ? { ...slot, found: true, ...file }
      : { ...slot, found: false };
  });

  return {
    slots,
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
 *   AI Materials/ProposalNarrative_{requestNumber}.pdf
 *
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
async function resolveActiveAiMaterialsFolder(requestId, requestNumber) {
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
  return { library, folder: `${requestRoot}/${AI_MATERIALS_FOLDER}` };
}

async function getExactAiMaterialText({ library, folder, expectedFilename }) {
  const metadataBefore = await GraphService.getFileMetadataByPath(
    library,
    folder,
    expectedFilename,
  );
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
  const expectedFilename = expectedProposalNarrativeFilename(requestNumber);
  if (!expectedFilename) return null;
  const location = await resolveActiveAiMaterialsFolder(requestId, requestNumber);
  if (!location) return null;
  return getExactAiMaterialText({ ...location, expectedFilename });
}

/**
 * Fetch the two canonical proposal-analysis inputs from the same positively
 * resolved active request folder. This is fail-closed: a missing, renamed, or
 * differently cased component returns null rather than substituting another
 * PDF or sending Claude an incomplete source set.
 */
export async function getAiProposalMaterialsText(requestId, requestNumber) {
  const narrativeFilename = expectedProposalNarrativeFilename(requestNumber);
  const bibliographyFilename = expectedProposalBibliographyFilename(requestNumber);
  if (!narrativeFilename || !bibliographyFilename) return null;

  const location = await resolveActiveAiMaterialsFolder(requestId, requestNumber);
  if (!location) return null;
  const [narrative, bibliography] = await Promise.all([
    getExactAiMaterialText({ ...location, expectedFilename: narrativeFilename }),
    getExactAiMaterialText({ ...location, expectedFilename: bibliographyFilename }),
  ]);
  return { narrative, bibliography };
}
