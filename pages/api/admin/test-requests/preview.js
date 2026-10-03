/**
 * Admin Test Request preview (read-only).
 *
 * GET resolves a sandbox Request and its allowlisted SharePoint inventory.
 * POST re-resolves all trusted state and compiles a non-authoritative preview.
 * Neither method creates or changes a Dataverse record or SharePoint file.
 */

import { withDalContext } from '../../../../lib/dataverse/core/context';
import {
  buildTestRequestAdminPreview,
  loadTestRequestPreviewSource,
  TEST_REQUEST_PREVIEW_READ_LIMITS,
} from '../../../../lib/services/test-requests/admin-preview-service';
import { ServiceHttpError } from '../../../../lib/services/service-http-error';
import { requireSuperuser } from '../../../../lib/utils/auth';
import { isGuid } from '../../../../lib/utils/guid';

const REQUEST_NUMBER = /^[A-Za-z0-9-]{1,80}$/;
const REQUIRED_POST_KEYS = Object.freeze([
  'selectedDocumentIds',
  'sourceRequestId',
  'testLabel',
]);
const OPTIONAL_POST_KEYS = Object.freeze([
  'fiscalYear',
  'meetingDate',
]);

export const config = { api: { bodyParser: { sizeLimit: '32kb' } } };

function sendError(res, error) {
  if (error instanceof ServiceHttpError) {
    return res.status(error.httpStatus).json(error.body ?? { error: error.message, code: error.code });
  }
  console.error('admin test-request preview error:', error);
  return res.status(500).json({ error: 'The Test Request preview could not be prepared.' });
}

function hasAllowedKeys(value, requiredKeys, optionalKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  return requiredKeys.every((key) => Object.hasOwn(value, key))
    && actual.every((key) => allowed.has(key));
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const gate = await requireSuperuser(req, res);
  if (!gate) return;

  if (req.method === 'GET') {
    const queryKeys = Object.keys(req.query || {});
    const requestNumber = typeof req.query?.sourceRequestNumber === 'string'
      ? req.query.sourceRequestNumber.trim()
      : '';
    if (queryKeys.length !== 1 || queryKeys[0] !== 'sourceRequestNumber' || !REQUEST_NUMBER.test(requestNumber)) {
      return res.status(400).json({ error: 'sourceRequestNumber must be the only query parameter and use a supported Request number.' });
    }
    return withDalContext('admin-test-request-preview-load', async () => {
      try {
        const body = await loadTestRequestPreviewSource({ requestNumber });
        return res.status(200).json(body);
      } catch (error) {
        return sendError(res, error);
      }
    });
  }

  if (Array.isArray(req.body?.selectedDocumentIds)
      && req.body.selectedDocumentIds.length > TEST_REQUEST_PREVIEW_READ_LIMITS.maxFiles) {
    return res.status(413).json({
      error: `Select no more than ${TEST_REQUEST_PREVIEW_READ_LIMITS.maxFiles} documents for one preview.`,
      code: 'test_request_preview_file_count_exceeded',
    });
  }

  if (!hasAllowedKeys(req.body, REQUIRED_POST_KEYS, OPTIONAL_POST_KEYS)
      || !isGuid(req.body.sourceRequestId)
      || !Array.isArray(req.body.selectedDocumentIds)
      || req.body.selectedDocumentIds.some((id) => typeof id !== 'string' || !id || id.length > 200)
      || typeof req.body.testLabel !== 'string'
      || (req.body.fiscalYear !== undefined && typeof req.body.fiscalYear !== 'string')
      || (req.body.meetingDate !== undefined && typeof req.body.meetingDate !== 'string')) {
    return res.status(400).json({
      error: 'The preview body must contain sourceRequestId, selectedDocumentIds, and testLabel; fiscalYear and meetingDate are optional string overrides.',
    });
  }

  return withDalContext('admin-test-request-preview-build', async () => {
    try {
      const body = await buildTestRequestAdminPreview({
        sourceRequestId: req.body.sourceRequestId,
        selectedDocumentIds: req.body.selectedDocumentIds,
        testLabel: req.body.testLabel,
        fiscalYear: req.body.fiscalYear,
        meetingDate: req.body.meetingDate,
      });
      return res.status(200).json(body);
    } catch (error) {
      return sendError(res, error);
    }
  });
}
