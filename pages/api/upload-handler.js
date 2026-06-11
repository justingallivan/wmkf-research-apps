import { handleUpload } from '@vercel/blob/client';
import { requireAuth } from '../../lib/utils/auth';
import { BASE_CONFIG } from '../../shared/config/baseConfig';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Require authentication
  const session = await requireAuth(req, res);
  if (!session) return;

  try {
    // Private uploads must target the DEDICATED private Blob store, not the
    // public shared store bound to BLOB_READ_WRITE_TOKEN — PUT/GET a private
    // blob with the public token fails at the Blob API layer (see
    // docs/CREDENTIALS_RUNBOOK.md "Private Blob store provisioning"). The store
    // token must be the SAME across both handleUpload events (generate-token
    // and upload-completed), so resolve the requested access from whichever
    // field is present: the client sets `clientPayload` on the generate event,
    // and we echo `access` into `tokenPayload` so the completed event resolves
    // to the same token.
    let requestedAccess = 'public';
    try {
      const raw = req.body?.payload?.clientPayload ?? req.body?.payload?.tokenPayload;
      if (raw) requestedAccess = JSON.parse(raw)?.access === 'private' ? 'private' : 'public';
    } catch {
      // Malformed payload → treat as public (the default, safe choice).
    }

    let token; // undefined → SDK default (public BLOB_READ_WRITE_TOKEN)
    if (requestedAccess === 'private') {
      token = process.env.UPLOADS_BLOB_RW_TOKEN;
      if (!token) {
        return res.status(503).json({
          error: 'Private uploads are not configured (UPLOADS_BLOB_RW_TOKEN missing)',
        });
      }
    }

    const jsonResponse = await handleUpload({
      token,
      body: req.body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        // Validate file types and size
        return {
          allowedContentTypes: [
            'application/pdf',
            'text/plain',
            'text/markdown',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'image/png',
            'image/jpg',
            'image/jpeg'
          ],
          addRandomSuffix: true,
          maximumSizeInBytes: 50 * 1024 * 1024, // 50MB limit
          tokenPayload: JSON.stringify({
            uploadedAt: new Date().toISOString(),
            userId: session.user?.email || 'authenticated',
            // Echo access so the upload-completed event (which carries
            // tokenPayload, not clientPayload) resolves to the same store token.
            access: requestedAccess,
          })
        };
      },
    });

    return res.status(200).json(jsonResponse);
  } catch (error) {
    console.error('Blob upload handler error:', error);
    return res.status(400).json({
      error: BASE_CONFIG.ERROR_MESSAGES.UPLOAD_FAILED,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      timestamp: new Date().toISOString()
    });
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb', // Only for the upload token request, not the actual file
    },
  },
};