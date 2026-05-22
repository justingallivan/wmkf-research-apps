/**
 * Virtual Review Panel API Endpoint
 *
 * Orchestrates multi-LLM review of a grant proposal:
 * - Stage 1 (optional): Claim verification across all selected LLMs
 * - Stage 2: Structured review (WMKF reviewer form) across all selected LLMs
 * - Synthesis: Claude panel summary with consensus, disagreements, questions
 *
 * Streams progress via SSE. Results persisted to panel_reviews/panel_review_items.
 */

import { loadModelOverrides } from '../../lib/services/model-override-loader';
import { requireAppAccess } from '../../lib/utils/auth';
import { nextRateLimiter } from '../../shared/api/middleware/rateLimiter';
import { safeFetch } from '../../lib/utils/safe-fetch';
import { MultiLLMService } from '../../lib/services/multi-llm-service';
import { PanelReviewService } from '../../lib/services/panel-review-service';
import { resolveAllowedProviders } from '../../lib/utils/vrp-providers';
import {
  DATA_CLASSES,
  VIRTUAL_REVIEW_PANEL_PROPOSAL_MAX_CHARS,
  wrapUntrustedContent,
} from '../../lib/utils/ai-payload-boundary';
import pdf from 'pdf-parse';

const limiter = nextRateLimiter({ max: 3 });

export const config = {
  api: {
    bodyParser: { sizeLimit: '1mb' },
    responseLimit: false,
    externalResolver: true,
  },
  maxDuration: 600,
};

export default async function handler(req, res) {
  // GET: return available providers and their models
  if (req.method === 'GET') {
    const access = await requireAppAccess(req, res, 'virtual-review-panel');
    if (!access) return;

    const available = MultiLLMService.getAvailableProviders();
    const allowed = resolveAllowedProviders(available);
    const providers = allowed.map(key => ({
      key,
      name: MultiLLMService.getProviderName(key),
      model: MultiLLMService.getDefaultModel(key),
    }));
    return res.json({ providers });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'virtual-review-panel');
  if (!access) return;

  const allowed = await limiter(req, res);
  if (allowed !== true) return;

  await loadModelOverrides();

  // SSE streaming headers. Must be set AFTER requireAppAccess returns — that
  // call runs validateOrigin (CSRF) synchronously and sends 403 before any
  // handler code reaches this point. Moving these headers earlier would let an
  // off-origin request begin streaming before origin validation completed.
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (event, data) => {
    try {
      res.write(`data: ${JSON.stringify({ event, ...data })}\n\n`);
    } catch {
      // Client disconnected
    }
  };

  try {
    const {
      files,
      providers: requestedProviders = ['claude', 'openai'],
      includeClaimVerification = true,
      includeIntelligencePass = false,
      includeDevilsAdvocate = false,
    } = req.body;

    const userProfileId = access.profileId;

    // Validate files
    if (!files || files.length === 0) {
      sendEvent('error', { message: 'No files provided' });
      return res.end();
    }

    if (files.length > 1) {
      sendEvent('error', { message: 'Please upload one file at a time' });
      return res.end();
    }

    // Validate providers — intersect (requested ∩ allowlist ∩ configured-with-key).
    // Allowlist is VRP_ALLOWED_PROVIDERS env var; defends against config drift
    // where adding an API key elsewhere silently broadens VRP vendor exposure.
    const availableProviders = MultiLLMService.getAvailableProviders();
    const allowedProviders = resolveAllowedProviders(availableProviders);
    const providers = requestedProviders.filter(p => allowedProviders.includes(p));

    // Synthesis (always) and intelligence-pass stages 0a/0c (when enabled)
    // call Claude unconditionally inside PanelReviewService. If `claude` is
    // not allowed, the run would still transmit proposal-derived content to
    // Anthropic — block it here rather than silently leak past the gate.
    if (!allowedProviders.includes('claude')) {
      sendEvent('error', {
        message: `Virtual Review Panel requires "claude" in VRP_ALLOWED_PROVIDERS — synthesis and intelligence-pass stages call Anthropic Claude unconditionally. ` +
                 `Allowed: ${allowedProviders.join(', ') || '(none)'}.`
      });
      return res.end();
    }

    if (providers.length < 2) {
      sendEvent('error', {
        message: `Need at least 2 allowed LLM providers. Allowed: ${allowedProviders.join(', ') || '(none)'}. ` +
                 `Requested: ${requestedProviders.join(', ')}. Check API keys and VRP_ALLOWED_PROVIDERS.`
      });
      return res.end();
    }

    sendEvent('progress', {
      message: `Starting virtual review panel with ${providers.length} reviewers: ${providers.map(p => MultiLLMService.getProviderName(p)).join(', ')}`,
      providers: providers.map(p => ({ key: p, name: MultiLLMService.getProviderName(p) })),
    });

    // Extract text from PDF
    const file = files[0];
    sendEvent('progress', { message: `Extracting text from ${file.filename}...` });

    const fileResponse = await safeFetch(file.url);
    if (!fileResponse.ok) {
      throw new Error(`Failed to fetch file: ${fileResponse.statusText}`);
    }

    const fileBuffer = Buffer.from(await fileResponse.arrayBuffer());
    const pdfData = await pdf(fileBuffer);
    const proposalText = pdfData.text;

    if (!proposalText || proposalText.trim().length < 100) {
      sendEvent('error', { message: 'PDF appears to be empty or contains insufficient text for review' });
      return res.end();
    }

    sendEvent('progress', {
      message: `Extracted ${proposalText.length.toLocaleString()} characters from ${pdfData.numpages} pages`,
    });

    // Create panel review in DB
    const panelReviewId = await PanelReviewService.createPanelReview(userProfileId, {
      proposalTitle: file.filename.replace(/\.pdf$/i, ''),
      proposalFilename: file.filename,
      proposalText,
      config: {
        providers,
        includeClaimVerification,
        includeIntelligencePass,
        includeDevilsAdvocate,
        availableProviders,
        allowedProviders,
      },
    });

    sendEvent('progress', { message: 'Panel review created, starting LLM evaluations...', panelReviewId });

    // Bound proposal text once at the route boundary. The same bounded text
    // propagates to every downstream stage (intelligence, claim verification,
    // structured review, devil's advocate) across every configured provider —
    // a single application covers all downstream prompt builders. The DB hash
    // above was taken over the original (full) text so the audit trail of
    // what was uploaded stays intact; the model context never sees the tail.
    const proposalPayload = wrapUntrustedContent({
      text: proposalText,
      source: 'virtual-review-panel.run.proposalText',
      dataClass: DATA_CLASSES.PROPOSAL_TEXT,
      maxChars: VIRTUAL_REVIEW_PANEL_PROPOSAL_MAX_CHARS,
      label: 'research proposal',
    });
    sendEvent('payload_boundary', {
      filename: file.filename,
      message: proposalPayload.metadata.truncated
        ? `Proposal text truncated to ${proposalPayload.metadata.transmittedChars.toLocaleString()} characters before AI panel review`
        : `Proposal text bounded at ${proposalPayload.metadata.transmittedChars.toLocaleString()} characters before AI panel review`,
      aiPayloadBoundary: proposalPayload.metadata,
    });

    // Run the full pipeline
    const loggingContext = { userProfileId, appName: 'virtual-review-panel' };

    await PanelReviewService.runFullPanel(panelReviewId, proposalPayload.text, providers, {
      includeClaimVerification,
      includeIntelligencePass,
      includeDevilsAdvocate,
      allowedProviders,
      loggingContext,
      sendEvent,
    });

    res.end();

  } catch (error) {
    console.error('[VirtualReviewPanel] Error:', error);
    sendEvent('error', { message: error.message || 'An unexpected error occurred' });
    res.end();
  }
}
