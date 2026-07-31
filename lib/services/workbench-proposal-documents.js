/**
 * Workbench Proposal-tab document listing (server-only).
 *
 * Lists a request's SharePoint files for the D26 Proposal tab, keeps only those
 * in the per-cycle `Phase I` subfolder, maps them to the configured labeled
 * slots, and surfaces anything unmatched as "other documents"
 * (surface-don't-drop). Returns the library/folder/name each consumer needs to
 * build a scoped download URL; the download proxy re-validates the folder
 * belongs to the request.
 *
 * Interim D26 bridge — see docs/WORKBENCH_PROPOSAL_TAB_BUILD_PLAN.md.
 */

import { GraphService } from './graph-service';
import { getRequestSharePointBuckets } from '../utils/sharepoint-buckets';
import { extractTextFromBuffer } from '../utils/file-loader';
import { listReviewerMaterials } from '../external/reviewer-materials';
import { getProposalDocumentConfig } from '../../shared/config/workbenchProposalDocuments';

const norm = (s) => String(s || '').trim().toLowerCase();

/** True when `folderPath`'s segments include the configured phase folder. */
function isInPhaseFolder(folderPath, phaseFolder) {
  const target = norm(phaseFolder);
  return String(folderPath || '')
    .split('/')
    .some((seg) => norm(seg) === target);
}

/**
 * @returns {Promise<{ slots: Array, otherDocuments: Array, libraries: Array, errors: Array }>}
 *   slots: [{ key, label, filename, found, library?, folder?, name?, size?, mimeType? }]
 *   otherDocuments: [{ name, library, folder, size, mimeType }]
 */
export async function listProposalDocuments(requestId, requestNumber, cycleCode) {
  const config = getProposalDocumentConfig(cycleCode);
  const buckets = await getRequestSharePointBuckets(requestId, requestNumber);

  const errors = [];
  const seen = new Set();
  const phaseFiles = [];
  for (const b of buckets) {
    let files = [];
    try {
      files = await GraphService.listFiles(b.library, b.folder, { recursive: true });
    } catch (e) {
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
      if (!isInPhaseFolder(folder, config.phaseFolder)) continue;
      if (config.excludeFilenames.some((ex) => norm(ex) === norm(f.name))) continue;
      phaseFiles.push({ name: f.name, library: b.library, folder, size: f.size ?? null, mimeType: f.mimeType ?? null });
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

  return {
    slots,
    otherDocuments,
    libraries: buckets.map((b) => ({ library: b.library, folder: b.folder, source: b.source })),
    errors,
  };
}

/**
 * Fetch + extract the canonical reviewer proposal for automated proposal
 * analysis. The source is fail-closed to the one active request-library file
 * allowed by the reviewer-materials contract:
 *
 *   Reviewer Materials/Proposal_{requestNumber}.pdf
 *
 * The D26 Proposal tab may still display the historical Phase I slots above,
 * but automated analysis must not silently substitute ProjectDescription.pdf
 * when the canonical Phase II proposal is absent.
 *
 * @returns {Promise<{ text: string, filename: string } | null>}
 */
export async function getProposalText(requestId, requestNumber) {
  const materials = await listReviewerMaterials(requestId, requestNumber);
  const active = materials.filter((item) => (
    item.source === 'dynamics'
    && String(item.library || '').toLowerCase() === 'akoya_request'
  ));
  if (active.length !== 1) return null;

  const proposal = active[0];
  const dl = await GraphService.downloadFileByPath(
    proposal.library,
    proposal.folder,
    proposal.name,
  );
  const text = await extractTextFromBuffer(dl.buffer, proposal.name, dl.mimeType);
  return { text: text || '', filename: proposal.name };
}
