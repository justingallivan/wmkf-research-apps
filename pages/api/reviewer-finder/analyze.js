/**
 * API Route: /api/reviewer-finder/analyze
 *
 * Stage 1 of Expert Reviewer Finder - Claude Analysis
 *
 * Accepts a proposal (via Vercel Blob URL or direct text) and returns:
 * - Proposal metadata
 * - Reviewer suggestions with reasoning
 *
 * (Summary-page extraction + public Blob upload was removed 2026-09-06: the
 * Workbench client never requested it and its only consumer, generate-emails,
 * was retired the same day. Historical `wmkf_summarybloburl` rows/blobs stay.)
 *
 * Uses streaming SSE for real-time progress updates.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { nextRateLimiter } from '../../../shared/api/middleware/rateLimiter';
import { BASE_CONFIG } from '../../../shared/config/baseConfig';
import { fetchPublicBlob } from '../../../lib/utils/public-blob-fetch';
import { ClaudeReviewerService } from '../../../lib/services/claude-reviewer-service';
import { loadModelOverrides } from '../../../lib/services/model-override-loader';
import { DEFAULT_REVIEWER_COUNT } from '../../../shared/config/reviewerFinderPreferences';
import { getReviewerTimeBudgetSeconds } from '../../../lib/services/reviewer-time-budget';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { loadReviewerRequestContext, mergeRequestContextIntoAnalysisResult } from '../../../lib/services/reviewer-request-context';

import { readPanelExpertise, collectExpertisePage } from '../../../lib/services/reviewer-discovery-brief';
import { authorizeReviewerRequestMutation } from '../../../lib/services/reviewer-request-authorization';
import { openFindHandoff } from '../../../lib/services/reviewer-find-handoff';

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

  // Admin-configurable wall-clock budget for the whole search (default 600s,
  // clamped [120,800]). A fired deadline aborts the Claude call gracefully so we
  // surface a clear timeout instead of the platform 504-ing at maxDuration.
  const deadlineController = new AbortController();
  let deadlineTimer = null;
  let budgetSeconds = null;

  try {
    const { proposalText, blobUrl, additionalNotes, excludedNames, reviewerCount, requestId } = req.body;
    const trimmedRequestId = String(requestId || '').trim();

    const mode = req.body.analysisMode ?? 'standard';
    if (!['standard', 'fallback', 'expertise', 'staff'].includes(mode)
      || (mode === 'fallback' && (!ClaudeReviewerService.FALLBACK_MODEL || ClaudeReviewerService.FALLBACK_MODEL === ClaudeReviewerService.MODEL))) {
      sendEvent('error', { message: 'Choose a configured reviewer analysis model.' });
      return res.end();
    }
    const pages = [];
    let sourceLabel = 'section';
    const apiKey = process.env.CLAUDE_API_KEY;
    if (!apiKey && mode !== 'staff') {
      sendEvent('error', { message: 'Claude API key not configured on server' });
      return res.end();
    }

    if (!trimmedRequestId) {
      sendEvent('error', { message: 'requestId is required for reviewer analysis' });
      return res.end();
    }

    const userProfileId = access.profileId;
    sendEvent('progress', { status: 'model_resolved', data: {
      model: mode === 'fallback' ? ClaudeReviewerService.FALLBACK_MODEL : ClaudeReviewerService.MODEL,
      fallbackModel: ClaudeReviewerService.FALLBACK_MODEL,
    } });

    const assignStaff = async () => {
      await withDalContext('workbench-find-handoff-open', () => authorizeReviewerRequestMutation({
        profileId: userProfileId, callerSystemId: access.session?.user?.dynamicsSystemuserId, requestIds: [trimmedRequestId],
      }));
      const settings = {
        reviewerCount: Math.max(1, Math.min(25, Number(reviewerCount) || DEFAULT_REVIEWER_COUNT)),
        additionalNotes: String(additionalNotes || '').slice(0, 5000),
        excludeText: String(req.body.excludeText || '').slice(0, 12000),
        referredSeedsText: String(req.body.referredSeedsText || '').slice(0, 5000),
        referredBy: String(req.body.referredBy || '').slice(0, 400),
        searchSources: Object.fromEntries(['pubmed', 'arxiv', 'biorxiv', 'chemrxiv'].map(key => [key, req.body.searchSources?.[key] === true])),
      };
      const handoff = await openFindHandoff(trimmedRequestId, userProfileId, settings);
      sendEvent('error', { status: 'discovery_handoff', caseId: handoff.caseId, message: `Discovery remains open. ${handoff.owner} owns the staff search for this proposal.` });
    };
    if (mode === 'staff') {
      await assignStaff();
      return res.end();
    }

    // Get proposal text
    let text = proposalText;

    if (!text && blobUrl) {
      sendEvent('progress', { stage: 'upload', message: 'Fetching uploaded file...' });

      // Fetch from Vercel Blob
      const blobResponse = await fetchPublicBlob(blobUrl);
      if (!blobResponse.ok) {
        throw new Error('Failed to fetch uploaded file');
      }

      const contentType = blobResponse.headers.get('content-type');

      if (contentType?.includes('application/pdf')) {
        // Parse PDF
        sendEvent('progress', { stage: 'processing', message: 'Extracting text from PDF...' });
        const pdfParse = (await import('pdf-parse')).default;
        const pdfBuffer = Buffer.from(await blobResponse.arrayBuffer());
        const pdfData = await pdfParse(pdfBuffer, mode === 'expertise' ? {
          pagerender: collectExpertisePage(pages),
        } : undefined);
        sourceLabel = 'page';
        text = pdfData.text;

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
      requestContext = await withDalContext('reviewer-finder-analyze-request-context', () =>
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

    let brief;
    let result;
    if (mode === 'expertise') {
      sendEvent('progress', { message: 'Reading the proposal for panel expertise and checking source references…' });
      brief = await readPanelExpertise({
        pages: pages.length ? pages : [text],
        complete: prompt => ClaudeReviewerService._callLLM({
          prompt, apiKey, maxTokens: 1200, temperature: 0, userProfileId,
          signal: deadlineController.signal, deadlineAt,
        }),
      });
      if (!brief.topics) result = { success: false, status: brief.status };
      else {
        const terms = brief.topics.map(topic => topic.specialty);
        result = mergeRequestContextIntoAnalysisResult({
          success: true, reviewerSuggestions: [],
          proposalInfo: { keywords: terms.join(', '), primaryResearchArea: terms[0] },
        }, requestContext);
        // Ranking needs expertise and trusted identities, not the narrative.
        result.proposalInfo.abstract = terms.join(', ');
      }
    }
    if (!result) result = await ClaudeReviewerService.analyzeProposal(text, apiKey, {
      useFallback: mode === 'fallback',
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
      if (mode === 'expertise' && result.status === 'analysis_refused') {
        await assignStaff();
      } else if (result.status === 'analysis_invalid') {
        sendEvent('error', {
          status: 'analysis_invalid',
          retryable: true,
          message: 'The proposal analysis response was incomplete or unreliable. Please retry the analysis.',
          details: result,
        });
      } else if (result.status === 'analysis_refused') {
        sendEvent('error', {
          status: 'analysis_refused',
          retryable: false,
          message: 'The analysis model declined this request.',
          details: result,
        });
      } else {
        sendEvent('error', { message: 'Analysis failed', details: result });
      }
      return res.end();
    }

    sendEvent('result', {
      proposalInfo: result.proposalInfo,
      ...(brief?.topics ? { panelExpertise: brief.topics, sourceLabel, reviewerCount: Math.max(1, Math.min(25, Number(reviewerCount) || DEFAULT_REVIEWER_COUNT)) } : {}),
      reviewerSuggestions: result.reviewerSuggestions,
      validation: result.validation,
    });

    sendEvent('complete', {
      message: 'Analysis complete',
      suggestionCount: result.reviewerSuggestions?.length || 0,
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
