/**
 * API Route: /api/integrity-screener/screen
 *
 * Main screening endpoint for Applicant Integrity Screener.
 * Accepts a list of applicants and screens them against:
 * - Retraction Watch database
 * - PubPeer (via SERP API)
 * - News sources (via SERP API)
 *
 * Uses streaming SSE for real-time progress updates.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { nextRateLimiter } from '../../../shared/api/middleware/rateLimiter';
import { BASE_CONFIG } from '../../../shared/config/baseConfig';
import { loadModelOverrides } from '../../../lib/services/model-override-loader';

const limiter = nextRateLimiter({ max: 5 });

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
  },
  maxDuration: 300, // Allow up to 5 minutes for full screening
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Require authentication + app access (before setting up SSE)
  const access = await requireAppAccess(req, res, 'integrity-screener');
  if (!access) return;

  const allowed = await limiter(req, res);
  if (allowed !== true) return;

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const {
      applicants,
    } = req.body;

    const claudeApiKey = process.env.CLAUDE_API_KEY;
    const serpApiKey = process.env.SERP_API_KEY || null;

    // Validate required fields
    if (!applicants || !Array.isArray(applicants) || applicants.length === 0) {
      sendEvent('error', { message: 'At least one applicant is required' });
      return res.end();
    }

    if (!claudeApiKey) {
      sendEvent('error', { message: 'Claude API key not configured on server' });
      return res.end();
    }

    // Validate applicant data
    for (let i = 0; i < applicants.length; i++) {
      const applicant = applicants[i];
      if (!applicant.name || applicant.name.trim().length === 0) {
        sendEvent('error', { message: `Applicant ${i + 1} is missing a name` });
        return res.end();
      }
    }

    // Warm the model-override cache BEFORE screening: screenApplicants resolves
    // its model via the synchronous getModelForApp('integrity-screener'), which
    // returns the raw tier alias (Anthropic 404s on it) until overrides load.
    await loadModelOverrides();

    // Import service dynamically to avoid issues with server-side imports
    const { IntegrityService } = await import('../../../lib/services/integrity-service');

    sendEvent('started', {
      message: `Starting integrity screening for ${applicants.length} applicant(s)`,
      applicantCount: applicants.length,
    });

    // Run screening with generator for streaming updates
    const screeningGenerator = IntegrityService.screenApplicants(
      applicants,
      claudeApiKey,
      serpApiKey,
      access.profileId || null
    );

    for await (const update of screeningGenerator) {
      switch (update.type) {
        case 'progress':
          sendEvent('progress', {
            message: update.message,
            applicantIndex: update.applicantIndex,
            source: update.source,
          });
          break;

        case 'applicant_complete':
          sendEvent('applicant_complete', {
            applicantIndex: update.applicantIndex,
            result: update.result,
          });
          break;

        case 'complete':
          sendEvent('complete', {
            results: update.results,
            screeningId: update.screeningId,
            totalMatches: update.totalMatches,
            applicantsWithConcerns: update.applicantsWithConcerns,
          });
          break;

        default:
          // Send any other updates as-is
          sendEvent(update.type, update);
      }
    }

  } catch (error) {
    console.error('Integrity screening error:', error);
    sendEvent('error', {
      message: BASE_CONFIG.ERROR_MESSAGES.SCREENING_FAILED,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  } finally {
    res.end();
  }
}
