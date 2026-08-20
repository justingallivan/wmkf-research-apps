/**
 * API: /api/workbench/grantee-deliverables/image
 *
 * Streams the grantee-uploaded award image to the staff Awardee tab (S411
 * increment 2), so the image renders in the app instead of only linking out to
 * SharePoint. The SharePoint link remains in the UI as a fallback.
 *
 *   GET ?requestId=  -> 200 image/png|image/jpeg|image/webp (binary)
 *                       404 no request / no package / no image / unrecognized ref
 *                       502 SharePoint could not produce the bytes
 *
 * Thin route shell (Route→Service Consolidation): method dispatch → auth guard →
 * GUID validation → withDalContext → one service call → error mapping. All path
 * derivation, filename validation, and content-type resolution live in
 * lib/services/workbench/grantee-deliverables/image-service.js.
 *
 * AUTH: requireAppAccess('reviewers'), matching the other grantee-deliverable
 * workbench routes. requestId is GUID-validated off req.query BEFORE it becomes a
 * record selector (check:trust-boundary-guid).
 *
 * THIS IS A PRIVATE-MATERIAL EGRESS PATH. It serves bytes out of the private
 * grantee SharePoint library, so:
 *   - the response is never cached by a shared cache (`private, no-store`);
 *   - `X-Content-Type-Options: nosniff` plus a service-derived, allowlisted
 *     Content-Type means the browser cannot be talked into interpreting these
 *     bytes as anything but one of three image types;
 *   - `Content-Disposition: inline` names the file for a save, and the filename
 *     is the server-controlled one the writer minted, not anything user-supplied;
 *   - the body is bytes only — no error detail from Graph reaches the client.
 */

import { requireAppAccess } from '../../../../lib/utils/auth';
import { withDalContext } from '../../../../lib/dataverse/core/context';
import { isGuid } from '../../../../lib/utils/guid';
import { ServiceHttpError } from '../../../../lib/services/service-http-error';
import { loadGranteeImage } from '../../../../lib/services/workbench/grantee-deliverables/image-service';

export const config = {
  // Binary response; no request body is read on this route. Valid uploads may
  // be exactly 10 MiB, and Next warns at (not above) responseLimit, so leave a
  // small margin while retaining a warning for responses outside the contract.
  api: { bodyParser: false, responseLimit: '11mb' },
};

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;

  // GUID-validate BEFORE requestId becomes a record-id selector.
  const requestId = typeof req.query?.requestId === 'string' ? req.query.requestId.trim() : '';
  if (!isGuid(requestId)) {
    return res.status(400).json({ error: 'requestId must be a GUID' });
  }

  return withDalContext('grantee-image-load', async () => {
    try {
      const { buffer, contentType, filename } = await loadGranteeImage({ requestId });
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', String(buffer.length));
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
      return res.status(200).send(buffer);
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body ?? { error: error.message });
      }
      console.error('[grantee-deliverables/image] load error:', error);
      return res.status(500).json({ error: 'Failed to load the image.' });
    }
  });
}
