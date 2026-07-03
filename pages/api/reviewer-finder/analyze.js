/**
 * API Route: /api/reviewer-finder/analyze
 *
 * Stage 1 of Expert Reviewer Finder - Claude Analysis
 *
 * Accepts a proposal (via Vercel Blob URL or direct text) and returns:
 * - Proposal metadata
 * - Reviewer suggestions with reasoning
 * - Summary page extraction (if PDF and summaryPages specified)
 *
 * Uses streaming SSE for real-time progress updates.
 */

import { put } from '@vercel/blob';
import { requireAppAccess } from '../../../lib/utils/auth';
import { nextRateLimiter } from '../../../shared/api/middleware/rateLimiter';
import { BASE_CONFIG } from '../../../shared/config/baseConfig';
import { safeFetch } from '../../../lib/utils/safe-fetch';
import { ClaudeReviewerService } from '../../../lib/services/claude-reviewer-service';
import { loadModelOverrides } from '../../../lib/services/model-override-loader';
import { DEFAULT_REVIEWER_COUNT } from '../../../shared/config/reviewerFinderPreferences';
import { getReviewerTimeBudgetSeconds } from '../../../lib/services/reviewer-time-budget';
import { bypassDynamicsRestrictions } from '../../../lib/services/dynamics-context';
import { loadReviewerRequestContext } from '../../../lib/services/reviewer-request-context';

const limiter = nextRateLimiter({ max: 10 });

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
  // Pinned at the Vercel Pro/Enterprise Fluid-Compute cap (800s). This is the
  // platform hard wall; the live, admin-editable budget that actually governs a
  // search is `reviewer.time_budget_seconds` (default 600), enforced below via
  // an AbortSignal deadline. maxDuration is build-time-static and CANNOT be
  // runtime-configurable. See docs/REVIEWER_TIMEOUT_BUDGET_PLAN.md.
  maxDuration: 800,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Require authentication + app access (before setting up SSE)
  const access = await requireAppAccess(req, res, 'reviewer-finder', 'reviewers');
  if (!access) return;

  const allowed = await limiter(req, res);
  if (allowed !== true) return;

  await loadModelOverrides();

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Keepalive: Claude analysis can run ~tens of seconds with no body bytes
  // flowing. Stream an SSE comment line periodically so an intermediary proxy
  // can't treat the connection as idle and close it before the result frame.
  // Comment lines (": ...") are ignored by the parser (shared/components/
  // reviewers/sse.js), so they never surface as events. Cleared in `finally`.
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) {
      try { res.write(': ping\n\n'); } catch { /* connection already gone */ }
    }
  }, 20000);

  // Track extracted summary info
  let summaryBlobUrl = null;
  let summaryFilename = null;

  // Admin-configurable wall-clock budget for the whole search (default 600s,
  // clamped [120,800]). A fired deadline aborts the Claude call gracefully so we
  // surface a clear timeout instead of the platform 504-ing at maxDuration.
  const deadlineController = new AbortController();
  let deadlineTimer = null;
  let budgetSeconds = null;

  try {
    const { proposalText, blobUrl, additionalNotes, excludedNames, reviewerCount, summaryPages, requestId } = req.body;
    const trimmedRequestId = String(requestId || '').trim();

    const apiKey = process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      sendEvent('error', { message: 'Claude API key not configured on server' });
      return res.end();
    }

    if (!trimmedRequestId) {
      sendEvent('error', { message: 'requestId is required for reviewer analysis' });
      return res.end();
    }

    const userProfileId = access.profileId;

    // Get proposal text
    let text = proposalText;
    let pdfBuffer = null;

    if (!text && blobUrl) {
      sendEvent('progress', { stage: 'upload', message: 'Fetching uploaded file...' });

      // Fetch from Vercel Blob
      const blobResponse = await safeFetch(blobUrl);
      if (!blobResponse.ok) {
        throw new Error('Failed to fetch uploaded file');
      }

      const contentType = blobResponse.headers.get('content-type');

      if (contentType?.includes('application/pdf')) {
        // Parse PDF
        sendEvent('progress', { stage: 'processing', message: 'Extracting text from PDF...' });
        const pdfParse = (await import('pdf-parse')).default;
        pdfBuffer = Buffer.from(await blobResponse.arrayBuffer());
        const pdfData = await pdfParse(pdfBuffer);
        text = pdfData.text;

        // Extract summary pages if specified and we have a PDF buffer
        if (summaryPages && pdfBuffer) {
          try {
            sendEvent('progress', { stage: 'extraction', message: `Extracting summary page(s): ${summaryPages}...` });
            const { extractPages } = require('../../../lib/utils/pdf-extractor');
            const extraction = await extractPages(pdfBuffer, summaryPages);

            // Upload extracted pages to Vercel Blob
            const timestamp = Date.now();
            summaryFilename = `summary_${timestamp}.pdf`;
            // Public access: the generate-emails flow fetches the URL via raw
            // HTTP to attach the summary PDF to outreach emails, and W5 step 3
            // (2026-05-12) wired save-candidates to persist `summaryBlobUrl` to
            // Dataverse `wmkf_summarybloburl` so generate-emails can read it
            // per-candidate. Private blobs would 401 against the unauthenticated
            // fetch path used there.
            const blob = await put(summaryFilename, extraction.buffer, {
              access: 'public',
              contentType: 'application/pdf'
            });
            summaryBlobUrl = blob.url;

            sendEvent('progress', {
              stage: 'extraction',
              message: `Extracted ${extraction.pageCount} page(s) from ${extraction.totalSourcePages}-page document`,
              summaryBlobUrl
            });
          } catch (extractError) {
            console.error('Summary extraction error:', extractError);
            sendEvent('progress', {
              stage: 'extraction',
              message: `Warning: Could not extract summary pages: ${extractError.message}`,
              error: true
            });
            // Continue with analysis even if extraction fails
          }
        }
      } else {
        // Plain text
        text = await blobResponse.text();
      }
    }

    if (!text || text.trim().length < 100) {
      sendEvent('error', { message: 'Proposal text is too short or empty' });
      return res.end();
    }

    let requestContext = null;
    sendEvent('progress', {
      stage: 'metadata',
      message: 'Loading request metadata from Dataverse...',
    });
    try {
      requestContext = await bypassDynamicsRestrictions('reviewer-finder-analyze-request-context', () =>
        loadReviewerRequestContext(trimmedRequestId));
      sendEvent('progress', {
        stage: 'metadata',
        message: 'Using Dataverse request metadata for proposal identity fields.',
      });
    } catch (err) {
      if (err?.statusCode === 400 || err?.statusCode === 404) {
        sendEvent('error', { message: err.message });
        return res.end();
      }
      throw err;
    }

    // Start the search time-budget clock now (after the upload/PDF prep, which
    // is bounded by maxDuration but not the LLM budget).
    budgetSeconds = await getReviewerTimeBudgetSeconds();
    const deadlineAt = Date.now() + budgetSeconds * 1000;
    deadlineTimer = setTimeout(() => {
      const e = new Error('reviewer_time_budget_exceeded');
      e.code = 'reviewer_time_budget_exceeded';
      deadlineController.abort(e);
    }, budgetSeconds * 1000);

    sendEvent('progress', {
      stage: 'analysis',
      message: 'Analyzing proposal with Claude...',
      textLength: text.length
    });

    const result = await ClaudeReviewerService.analyzeProposal(text, apiKey, {
      additionalNotes: additionalNotes || '',
      excludedNames: excludedNames || [],
      reviewerCount: reviewerCount || DEFAULT_REVIEWER_COUNT,
      userProfileId,
      signal: deadlineController.signal,
      deadlineAt,
      requestContext,
      onProgress: (progress) => {
        sendEvent('progress', progress);
      }
    });

    // Close the boundary race: if the deadline fired while the LLM call was
    // resolving, surface the timeout instead of a success result.
    if (deadlineController.signal.aborted) {
      throw deadlineController.signal.reason || new Error('reviewer_time_budget_exceeded');
    }

    if (!result.success) {
      if (result.status === 'analysis_invalid') {
        sendEvent('error', {
          status: 'analysis_invalid',
          retryable: true,
          message: 'The proposal analysis response was incomplete or unreliable. Please retry the analysis.',
          details: result,
        });
      } else {
        sendEvent('error', { message: 'Analysis failed', details: result });
      }
      return res.end();
    }

    // Send results (include summary blob URL if extraction succeeded)
    sendEvent('result', {
      proposalInfo: result.proposalInfo,
      reviewerSuggestions: result.reviewerSuggestions,
      validation: result.validation,
      summaryBlobUrl: summaryBlobUrl,
      summaryFilename: summaryFilename
    });

    sendEvent('complete', {
      message: 'Analysis complete',
      suggestionCount: result.reviewerSuggestions?.length || 0,
      summaryExtracted: !!summaryBlobUrl
    });

  } catch (error) {
    console.error('Analyze API error:', error);
    if (deadlineController.signal.aborted) {
      const mins = budgetSeconds ? Math.round(budgetSeconds / 60) : null;
      sendEvent('error', {
        message: `Analysis stopped after exceeding the configured ${mins ? `${mins}-minute ` : ''}time budget. An admin can raise it (up to 13 minutes) under Settings at /admin.`,
        timeout: true,
      });
    } else {
      sendEvent('error', {
        message: BASE_CONFIG.ERROR_MESSAGES.PROCESSING_FAILED,
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  } finally {
    clearTimeout(deadlineTimer);
    clearInterval(heartbeat);
  }

  res.end();
}
