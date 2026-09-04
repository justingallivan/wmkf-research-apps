/**
 * API: /api/workbench/search-requests
 *
 * Read-only, org-open request discovery for Workbench users.
 *
 *   GET ?mode=options
 *     → live historical cycle and request-status options
 *
 *   GET ?q=<text>&cycle=<fiscal-year>&status=<request-status>&offset=<0..75>
 *     → bounded active/historical request results
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import {
  loadRequestSearchOptions,
  searchWorkbenchRequests,
  REQUEST_SEARCH_MAX_RESULTS,
  REQUEST_SEARCH_PAGE_SIZE,
} from '../../../lib/services/workbench/request-search-service';

const MAX_QUERY_LENGTH = 100;
const MAX_FILTER_LENGTH = 100;
const ALLOWED_QUERY_KEYS = new Set(['mode', 'q', 'cycle', 'status', 'offset']);

function singleQueryValue(value) {
  return Array.isArray(value) ? null : String(value ?? '').trim();
}

function parseOffset(raw) {
  if (raw === undefined) return 0;
  const value = singleQueryValue(raw);
  if (!/^\d+$/.test(value)) return null;
  const offset = Number(value);
  const maxOffset = REQUEST_SEARCH_MAX_RESULTS - REQUEST_SEARCH_PAGE_SIZE;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > maxOffset
    || offset % REQUEST_SEARCH_PAGE_SIZE !== 0) return null;
  return offset;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;

  if (Object.keys(req.query).some((key) => !ALLOWED_QUERY_KEYS.has(key))) {
    return res.status(400).json({ error: 'Invalid request search parameters' });
  }

  const mode = singleQueryValue(req.query.mode);
  if (mode === null || (mode && mode !== 'options')) {
    return res.status(400).json({ error: 'Invalid mode' });
  }
  if (mode === 'options'
    && Object.keys(req.query).some((key) => key !== 'mode')) {
    return res.status(400).json({ error: 'Invalid request search parameters' });
  }

  const query = singleQueryValue(req.query.q);
  const cycle = singleQueryValue(req.query.cycle);
  const status = singleQueryValue(req.query.status);
  const offset = parseOffset(req.query.offset);
  if (query === null || cycle === null || status === null || offset === null) {
    return res.status(400).json({ error: 'Invalid request search parameters' });
  }
  if (query.length > MAX_QUERY_LENGTH || cycle.length > MAX_FILTER_LENGTH
    || status.length > MAX_FILTER_LENGTH) {
    return res.status(400).json({ error: 'Request search parameters are too long' });
  }
  if (query && query.length < 2) {
    return res.status(400).json({ error: 'Search terms must contain at least 2 characters' });
  }

  return withDalContext('workbench-search-requests', async () => {
    try {
      const body = mode === 'options'
        ? await loadRequestSearchOptions()
        : await searchWorkbenchRequests({ query, cycle, status, offset });
      return res.status(200).json(body);
    } catch (err) {
      if (err instanceof ServiceHttpError) {
        return res.status(err.httpStatus).json(err.body ?? { error: err.message });
      }
      console.error('workbench request search error:', err);
      return res.status(500).json({
        error: mode === 'options'
          ? 'Failed to load request search options'
          : 'Failed to search requests',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined,
      });
    }
  });
}
