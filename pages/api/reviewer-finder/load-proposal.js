/**
 * API: /api/reviewer-finder/load-proposal
 *
 * Used by the new Dataverse-native entry path (replacing PDF upload). Given
 * an akoya_request GUID, finds the proposal document on SharePoint, downloads
 * it, uploads to Vercel Blob, and returns the blob URL — which the existing
 * /api/reviewer-finder/analyze pipeline already accepts.
 *
 * POST body:
 *   - requestId   (required) — akoya_request GUID
 *   - fileKey     (optional) — explicit "library::folder::filename" override.
 *                              When omitted, picks the proposal best-guess via
 *                              classifyFile + pickProposalBestGuess.
 *
 * Response: { success, blobUrl, filename, contentType, size, picked,
 *             requestNumber, allFiles[] }
 */

import { put } from '@vercel/blob';
import { requireAppAccess } from '../../../lib/utils/auth';
import { DynamicsService } from '../../../lib/services/dynamics-service';
import { bypassDynamicsRestrictions } from '../../../lib/services/dynamics-context';
import { GraphService } from '../../../lib/services/graph-service';
import { getRequestSharePointBuckets } from '../../../lib/utils/sharepoint-buckets';
import { classifyFile } from '../grant-reporting/lookup-grant';

export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } },
  maxDuration: 120,
};

function fileKeyOf(file) {
  return `${file.library}::${file.folder}::${file.name}`;
}

function pickProposalBestGuess(files) {
  const proposals = files.filter((f) => f.classification === 'proposal');
  if (proposals.length === 0) return null;

  const tier1 = proposals.filter((f) => /project[\s_\-]*narrative/i.test(f.name));
  const phaseIIRe = /(?:^|[\s_\-])phase[\s_]?ii(?:[\s_\-]|$)/i;
  const tier2 = proposals.filter((f) => phaseIIRe.test(f.name));

  const extScore = (n) => {
    const s = n.toLowerCase();
    if (s.endsWith('.pdf')) return 0; // pdf preferred for analyze pipeline
    if (s.endsWith('.docx')) return 1;
    return 2;
  };
  const sortByExt = (arr) => arr.slice().sort((a, b) => extScore(a.name) - extScore(b.name));

  if (tier1.length > 0) return sortByExt(tier1)[0];
  if (tier2.length > 0) return sortByExt(tier2)[0];
  return sortByExt(proposals)[0];
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewer-finder', 'reviewers');
  if (!access) return;

  const { requestId, fileKey } = req.body || {};
  if (!requestId) {
    return res.status(400).json({ error: 'requestId is required' });
  }

  return bypassDynamicsRestrictions('reviewer-finder-load-proposal', async () => {
  try {
    // 1. Resolve request_number for SharePoint folder lookup.
    const request = await DynamicsService.getRecord('akoya_requests', requestId, {
      select: 'akoya_requestid,akoya_requestnum',
    });
    if (!request || !request.akoya_requestnum) {
      return res.status(404).json({ error: `Request ${requestId} not found or missing request number.` });
    }
    const requestNumber = request.akoya_requestnum;

    // 2. List SharePoint files across all plausible buckets (active + archives).
    const buckets = await getRequestSharePointBuckets(requestId, requestNumber);
    const bucketResults = await Promise.all(
      buckets.map(async (b) => {
        try {
          const raw = await GraphService.listFiles(b.library, b.folder, { recursive: true });
          return { ...b, files: raw, error: null };
        } catch (err) {
          return { ...b, files: [], error: err.message };
        }
      }),
    );

    const seen = new Set();
    const allFiles = [];
    for (const bucket of bucketResults) {
      for (const f of bucket.files) {
        const folder = f.folder || bucket.folder;
        const key = `${bucket.library}::${folder}::${f.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        allFiles.push({
          name: f.name,
          size: f.size,
          mimeType: f.mimeType,
          lastModified: f.lastModified,
          library: bucket.library,
          folder,
          classification: classifyFile(f.name),
        });
      }
    }

    if (allFiles.length === 0) {
      return res.status(404).json({
        error: 'No SharePoint files found for this request.',
        requestNumber,
        libraries: bucketResults.map((b) => ({ library: b.library, folder: b.folder, error: b.error })),
      });
    }

    // 3. Pick the file: explicit override, else proposal best-guess.
    let picked = null;
    if (fileKey) {
      picked = allFiles.find((f) => fileKeyOf(f) === fileKey) || null;
      if (!picked) {
        return res.status(400).json({ error: `fileKey not found in this request's libraries: ${fileKey}`, allFiles });
      }
    } else {
      picked = pickProposalBestGuess(allFiles);
      if (!picked) {
        return res.status(404).json({
          error: 'No proposal-classified file found. Pass fileKey to override.',
          allFiles,
        });
      }
    }

    // 4. Download and upload to Blob.
    const downloaded = await GraphService.downloadFileByPath(picked.library, picked.folder, picked.name);
    const blob = await put(`reviewer-finder/${requestNumber}/${picked.name}`, downloaded.buffer, {
      access: 'public',
      contentType: downloaded.mimeType || 'application/pdf',
      addRandomSuffix: true,
    });

    return res.status(200).json({
      success: true,
      blobUrl: blob.url,
      filename: downloaded.filename,
      contentType: downloaded.mimeType,
      size: downloaded.size,
      picked: fileKeyOf(picked),
      requestNumber,
      allFiles,
    });
  } catch (err) {
    console.error('load-proposal error:', err);
    return res.status(500).json({
      error: 'Failed to load proposal from SharePoint',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
  });
}
