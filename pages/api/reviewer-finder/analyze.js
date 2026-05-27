/**
 * API Route: /api/reviewer-finder/analyze
 *
 * Stage 1 of Expert Reviewer Finder - Claude Analysis
 *
 * Accepts a proposal (via Vercel Blob URL or direct text) and returns:
 * - Proposal metadata
 * - Reviewer suggestions with reasoning
 * - Optimized search queries for databases
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

const limiter = nextRateLimiter({ max: 10 });

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
  maxDuration: 90, // Allow up to 90 seconds for Claude analysis + PDF extraction
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Require authentication + app access (before setting up SSE)
  const access = await requireAppAccess(req, res, 'reviewer-finder');
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

  // Track extracted summary info
  let summaryBlobUrl = null;
  let summaryFilename = null;

  try {
    const { proposalText, blobUrl, additionalNotes, excludedNames, temperature, reviewerCount, summaryPages } = req.body;

    const apiKey = process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      sendEvent('error', { message: 'Claude API key not configured on server' });
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

    sendEvent('progress', {
      stage: 'analysis',
      message: 'Analyzing proposal with Claude...',
      textLength: text.length
    });

    const result = await ClaudeReviewerService.analyzeProposal(text, apiKey, {
      additionalNotes: additionalNotes || '',
      excludedNames: excludedNames || [],
      temperature: temperature !== undefined ? temperature : 0.3,
      reviewerCount: reviewerCount || 12,
      userProfileId,
      onProgress: (progress) => {
        sendEvent('progress', progress);
      }
    });

    if (!result.success) {
      sendEvent('error', { message: 'Analysis failed', details: result });
      return res.end();
    }

    // Send results (include summary blob URL if extraction succeeded)
    sendEvent('result', {
      proposalInfo: result.proposalInfo,
      reviewerSuggestions: result.reviewerSuggestions,
      searchQueries: result.searchQueries,
      validation: result.validation,
      summaryBlobUrl: summaryBlobUrl,
      summaryFilename: summaryFilename
    });

    sendEvent('complete', {
      message: 'Analysis complete',
      suggestionCount: result.reviewerSuggestions?.length || 0,
      queryCount: Object.values(result.searchQueries || {}).flat().length,
      summaryExtracted: !!summaryBlobUrl
    });

  } catch (error) {
    console.error('Analyze API error:', error);
    sendEvent('error', {
      message: BASE_CONFIG.ERROR_MESSAGES.PROCESSING_FAILED,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }

  res.end();
}
