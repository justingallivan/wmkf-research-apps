/**
 * API Route: /api/reviewer-finder/generate-emails
 *
 * Generates .eml files for reviewer invitation emails.
 * Supports optional Claude personalization and file attachments via SSE streaming.
 *
 * POST body:
 * - candidates: Array of candidates with name, email, affiliation, suggestionId (required for multi-proposal)
 * - template: { subject, body } with placeholders
 * - settings: { senderName, senderEmail, signature, grantCycle }
 * - proposalInfo: { title, abstract, authors, institution } - fallback if no suggestionId
 * - options: { useClaudePersonalization, claudeApiKey, markAsSent }
 * - attachments: { summaryBlobUrl, reviewTemplateBlobUrl } - URLs to fetch and attach (fallback)
 *
 * Multi-proposal support:
 * When candidates have suggestionId, their proposal info is looked up from the database,
 * allowing each email to have the correct proposal title, PI, and summary attachment.
 */

import {
  generateEmlContent,
  generateEmlContentWithAttachments,
  replacePlaceholders,
  buildTemplateData,
  createFilename
} from '../../../lib/utils/email-generator';

import { createPersonalizationPrompt } from '../../../shared/config/prompts/email-reviewer';
import { requireAppAccess } from '../../../lib/utils/auth';
import { nextRateLimiter } from '../../../shared/api/middleware/rateLimiter';
import { LLMClient } from '../../../lib/services/llm-client';
import { loadModelOverrides } from '../../../lib/services/model-override-loader';
import { getReviewerTimeBudgetSeconds } from '../../../lib/services/reviewer-time-budget';
import { BASE_CONFIG, getModelForApp } from '../../../shared/config/baseConfig';
import { safeFetch, isAllowedUrl } from '../../../lib/utils/safe-fetch';
import { DynamicsService } from '../../../lib/services/dynamics-service';
import { bypassDynamicsRestrictions } from '../../../lib/services/dynamics-context';
import * as suggestionAdapter from '../../../lib/dataverse/adapters/reviewer-suggestion';

const ROLE_COPI = 100000001;

/**
 * Look up proposal info for candidates from Dataverse.
 *
 * Returns a map of suggestionId (Dataverse GUID, string) → proposalInfo.
 *
 * Reads the suggestion + linked `akoya_request` directly; no per-user
 * scoping (staff-shared per the post-W1 model, gated by `requireAppAccess`
 * at the route). `summaryBlobUrl` comes from `wmkf_summarybloburl`
 * (migrated 2026-05-12). `coInvestigators` is derived from the
 * `wmkf_apprequestperson` junction filtered by request + role=Co-PI.
 */
async function lookupProposalInfoForCandidates(suggestionIds) {
  if (!suggestionIds || suggestionIds.length === 0) {
    return new Map();
  }

  const proposalInfoMap = new Map();

  return bypassDynamicsRestrictions('generate-emails-lookup', async () => {
    // Fetch each suggestion in parallel; each carries _wmkf_request_value
    // plus the summary blob URL.
    const sugs = await Promise.all(
      suggestionIds.map(id => suggestionAdapter.findById(id).catch(err => {
        console.error(`Suggestion lookup failed for ${id}:`, err.message);
        return null;
      })),
    );

    // Distinct request GUIDs across all suggestions; fetch each once.
    const distinctRequestIds = [...new Set(
      sugs.filter(Boolean).map(s => s._wmkf_request_value).filter(Boolean),
    )];
    const requestById = new Map();
    const coPiNamesByRequestId = new Map();
    await Promise.all(distinctRequestIds.map(async (rid) => {
      try {
        const req = await DynamicsService.getRecord('akoya_requests', rid, {
          select: 'akoya_requestid,akoya_title,wmkf_abstract,wmkf_organizationname,_akoya_applicantid_value,_wmkf_projectleader_value',
        });
        requestById.set(rid, req);
      } catch (err) {
        console.error(`akoya_request lookup failed for ${rid}:`, err.message);
      }
      try {
        const { records: copiRows } = await DynamicsService.queryRecords('wmkf_apprequestpersons', {
          select: '_wmkf_contact_value,wmkf_authorposition',
          filter: `_wmkf_request_value eq ${rid} and wmkf_role eq ${ROLE_COPI}`,
          orderby: 'wmkf_authorposition asc,createdon asc',
          top: 50,
        });
        const names = copiRows
          .map(r => r._wmkf_contact_value_formatted)
          .filter(Boolean);
        coPiNamesByRequestId.set(rid, names);
      } catch (err) {
        console.error(`wmkf_apprequestpersons lookup failed for ${rid}:`, err.message);
        coPiNamesByRequestId.set(rid, []);
      }
    }));

    // Build the response map. Frontend serializes suggestionId as a string;
    // Dataverse GUIDs are already strings, so direct assignment is fine.
    for (let i = 0; i < suggestionIds.length; i++) {
      const id = suggestionIds[i];
      const sug = sugs[i];
      if (!sug) continue;

      const req = sug._wmkf_request_value ? requestById.get(sug._wmkf_request_value) : null;
      const coPiNames = sug._wmkf_request_value
        ? (coPiNamesByRequestId.get(sug._wmkf_request_value) || [])
        : [];

      proposalInfoMap.set(String(id), {
        title: req?.akoya_title || '',
        abstract: req?.wmkf_abstract || '',
        authors: req?._wmkf_projectleader_value_formatted
          || req?._akoya_applicantid_value_formatted
          || '',
        institution: req?.wmkf_organizationname || '',
        summaryBlobUrl: sug.wmkf_summarybloburl || '',
        coInvestigators: coPiNames.join(', '),
        coInvestigatorCount: coPiNames.length,
      });
    }

    return proposalInfoMap;
  });
}

/**
 * Fetch attachment from URL and cache by URL to avoid re-fetching.
 * Uses safeFetch for SSRF protection (host allowlist).
 */
async function fetchAttachment(url, attachmentCache, filename, contentType) {
  if (!url) return null;

  // Check cache first
  if (attachmentCache.has(url)) {
    return attachmentCache.get(url);
  }

  if (!isAllowedUrl(url)) {
    console.warn('fetchAttachment blocked non-allowed URL:', url);
    return null;
  }

  try {
    const response = await safeFetch(url);
    if (response.ok) {
      const buffer = Buffer.from(await response.arrayBuffer());
      const attachment = {
        filename,
        contentType,
        content: buffer
      };
      attachmentCache.set(url, attachment);
      return attachment;
    } else {
      console.warn(`Failed to fetch attachment from ${url}:`, response.status);
      return null;
    }
  } catch (err) {
    console.error(`Error fetching attachment from ${url}:`, err.message);
    return null;
  }
}

const limiter = nextRateLimiter({ max: 10 });

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb', // Increased for attachments
    },
  },
  // Pinned at the Vercel Pro/Enterprise Fluid-Compute cap (800s). The live
  // search budget (`reviewer.time_budget_seconds`, default 600) is enforced
  // below via an AbortSignal deadline. See docs/REVIEWER_TIMEOUT_BUDGET_PLAN.md.
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

  const userProfileId = access.profileId;

  await loadModelOverrides();

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Admin-configurable wall-clock budget (default 600s, clamped [120,800]),
  // enforced via an AbortSignal deadline on the per-candidate Claude
  // personalization calls. See docs/REVIEWER_TIMEOUT_BUDGET_PLAN.md.
  const deadlineController = new AbortController();
  let deadlineTimer = null;
  let budgetSeconds = null;

  try {
    const {
      candidates,
      template,
      settings,
      proposalInfo,
      options = {},
      attachments: attachmentConfig = {}
    } = req.body;

    // Validate inputs
    if (!candidates || !Array.isArray(candidates) || candidates.length === 0) {
      sendEvent('error', { message: 'No candidates provided' });
      return res.end();
    }

    if (!template || !template.subject || !template.body) {
      sendEvent('error', { message: 'Email template is required' });
      return res.end();
    }

    if (!settings || !settings.senderEmail) {
      sendEvent('error', { message: 'Sender email is required' });
      return res.end();
    }

    const { useClaudePersonalization, markAsSent } = options;
    const claudeApiKey = process.env.CLAUDE_API_KEY || null;

    // Filter candidates with email addresses
    const validCandidates = candidates.filter(c => c.email);
    const skippedCount = candidates.length - validCandidates.length;

    if (validCandidates.length === 0) {
      sendEvent('error', { message: 'No candidates have email addresses' });
      return res.end();
    }

    // Look up proposal info for candidates with suggestionIds (multi-proposal support)
    const suggestionIds = validCandidates
      .map(c => c.suggestionId)
      .filter(id => id != null);

    let proposalInfoMap = new Map();
    if (suggestionIds.length > 0) {
      sendEvent('progress', {
        stage: 'lookup',
        message: 'Looking up proposal info for candidates...'
      });
      proposalInfoMap = await lookupProposalInfoForCandidates(suggestionIds);
    }

    // Attachment cache to avoid re-fetching the same files
    const attachmentCache = new Map();

    // Fetch shared attachments (review template, additional attachments)
    const { summaryBlobUrl: fallbackSummaryUrl, reviewTemplateBlobUrl, additionalAttachments = [] } = attachmentConfig;
    const sharedAttachments = [];

    if (reviewTemplateBlobUrl || additionalAttachments.length > 0) {
      sendEvent('progress', {
        stage: 'fetching_attachments',
        message: 'Fetching shared attachment files...'
      });

      // Fetch review template (shared across all emails)
      if (reviewTemplateBlobUrl && isAllowedUrl(reviewTemplateBlobUrl)) {
        try {
          const templateResponse = await safeFetch(reviewTemplateBlobUrl);
          if (templateResponse.ok) {
            const buffer = Buffer.from(await templateResponse.arrayBuffer());
            const urlPath = new URL(reviewTemplateBlobUrl).pathname;
            const ext = urlPath.split('.').pop()?.toLowerCase() || 'pdf';
            const contentType = ext === 'docx'
              ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
              : ext === 'doc'
              ? 'application/msword'
              : 'application/pdf';
            sharedAttachments.push({
              filename: `Review_Template.${ext}`,
              contentType,
              content: buffer
            });
            sendEvent('progress', {
              stage: 'fetching_attachments',
              message: 'Fetched review template'
            });
          } else {
            console.warn('Failed to fetch review template:', templateResponse.status);
          }
        } catch (err) {
          console.error('Error fetching review template:', err.message);
        }
      }

      // Fetch additional attachments (shared across all emails)
      for (const attachment of additionalAttachments) {
        if (!attachment.blobUrl || !isAllowedUrl(attachment.blobUrl)) continue;
        try {
          const response = await safeFetch(attachment.blobUrl);
          if (response.ok) {
            const buffer = Buffer.from(await response.arrayBuffer());
            sharedAttachments.push({
              filename: attachment.filename || 'Attachment.pdf',
              contentType: attachment.contentType || 'application/octet-stream',
              content: buffer
            });
            sendEvent('progress', {
              stage: 'fetching_attachments',
              message: `Fetched ${attachment.filename}`
            });
          } else {
            console.warn(`Failed to fetch additional attachment ${attachment.filename}:`, response.status);
          }
        } catch (err) {
          console.error(`Error fetching additional attachment ${attachment.filename}:`, err.message);
        }
      }
    }

    // Count unique summary URLs for progress reporting
    const uniqueSummaryUrls = new Set();
    for (const candidate of validCandidates) {
      const candidateProposalInfo = proposalInfoMap.get(candidate.suggestionId);
      const summaryUrl = candidateProposalInfo?.summaryBlobUrl || fallbackSummaryUrl;
      if (summaryUrl) uniqueSummaryUrls.add(summaryUrl);
    }

    sendEvent('progress', {
      stage: 'starting',
      message: `Generating ${validCandidates.length} emails (${uniqueSummaryUrls.size} unique proposal${uniqueSummaryUrls.size !== 1 ? 's' : ''})...`,
      total: validCandidates.length,
      skipped: skippedCount,
      uniqueProposals: uniqueSummaryUrls.size
    });

    const generatedEmails = [];
    const errors = [];

    // Start the time-budget clock (covers the per-candidate generation loop).
    budgetSeconds = await getReviewerTimeBudgetSeconds();
    const deadlineAt = Date.now() + budgetSeconds * 1000;
    deadlineTimer = setTimeout(() => {
      const e = new Error('reviewer_time_budget_exceeded');
      e.code = 'reviewer_time_budget_exceeded';
      deadlineController.abort(e);
    }, budgetSeconds * 1000);

    // Process each candidate
    for (let i = 0; i < validCandidates.length; i++) {
      // Stop scheduling more candidates once the deadline fires. Throw rather
      // than break so the loop does NOT fall through to mark-as-sent + the
      // success result/complete frames — the top-level catch surfaces the
      // timeout (a budget abort must be terminal, not a partial success).
      if (deadlineController.signal.aborted) {
        const e = new Error('reviewer_time_budget_exceeded');
        e.code = 'reviewer_time_budget_exceeded';
        throw e;
      }
      const candidate = validCandidates[i];

      sendEvent('progress', {
        stage: 'generating',
        current: i + 1,
        total: validCandidates.length,
        candidate: candidate.name,
        message: useClaudePersonalization
          ? `Personalizing email for ${candidate.name}...`
          : `Generating email for ${candidate.name}...`
      });

      try {
        // Get this candidate's specific proposal info (from DB lookup or fallback)
        // Convert suggestionId to string to match Map keys
        const candidateProposalInfo = proposalInfoMap.get(String(candidate.suggestionId)) || proposalInfo || {};

        // Build template data for this candidate with their specific proposal
        const templateData = buildTemplateData(candidate, candidateProposalInfo, settings);

        // Replace placeholders in template
        let subject = replacePlaceholders(template.subject, templateData);
        let body = replacePlaceholders(template.body, templateData);

        // Optionally personalize with Claude
        if (useClaudePersonalization && claudeApiKey) {
          try {
            const personalizedBody = await personalizeWithClaude(
              candidate,
              candidateProposalInfo,
              body,
              claudeApiKey,
              userProfileId,
              { signal: deadlineController.signal, deadlineAt }
            );
            if (personalizedBody) {
              body = personalizedBody;
            }
          } catch (claudeError) {
            // A deadline abort must bubble to the loop-top break, not be
            // swallowed as a per-candidate personalization failure.
            if (deadlineController.signal.aborted) throw claudeError;
            console.error(`Claude personalization failed for ${candidate.name}:`, claudeError.message);
            // Continue with non-personalized email
          }
        }

        // Build per-candidate attachments (shared + candidate-specific summary)
        const candidateAttachments = [...sharedAttachments];

        // Fetch this candidate's summary PDF (cached to avoid re-fetching same URL)
        const summaryUrl = candidateProposalInfo.summaryBlobUrl || fallbackSummaryUrl;
        if (summaryUrl) {
          const summaryAttachment = await fetchAttachment(
            summaryUrl,
            attachmentCache,
            'Project_Summary.pdf',
            'application/pdf'
          );
          if (summaryAttachment) {
            candidateAttachments.unshift(summaryAttachment); // Add at beginning
          }
        }

        const hasAttachments = candidateAttachments.length > 0;

        // Build sender string
        const from = settings.senderName
          ? `${settings.senderName} <${settings.senderEmail}>`
          : settings.senderEmail;

        // Generate EML content (with or without attachments)
        const emlContent = hasAttachments
          ? generateEmlContentWithAttachments({
              from,
              to: candidate.email,
              subject,
              body,
              attachments: candidateAttachments
            })
          : generateEmlContent({
              from,
              to: candidate.email,
              subject,
              body
            });

        const filename = createFilename(candidate.name);

        generatedEmails.push({
          candidateName: candidate.name,
          candidateEmail: candidate.email,
          suggestionId: candidate.suggestionId,
          filename,
          content: emlContent,
          subject
        });

        sendEvent('email_generated', {
          index: i,
          candidateName: candidate.name,
          candidateEmail: candidate.email,
          suggestionId: candidate.suggestionId,
          filename,
          subject
        });

      } catch (error) {
        // A budget abort (rethrown from the inner personalization catch) must
        // bubble to the top-level catch, not be swallowed as a per-candidate
        // failure — otherwise the loop continues to success frames.
        if (deadlineController.signal.aborted) throw error;
        console.error(`Error generating email for ${candidate.name}:`, error.message);
        errors.push({
          candidateName: candidate.name,
          error: BASE_CONFIG.ERROR_MESSAGES.EMAIL_GENERATION_FAILED
        });
      }
    }

    // Update database to mark emails as sent (if option enabled and suggestionIds provided)
    let markedAsSentCount = 0;
    if (markAsSent) {
      const suggestionIdsToUpdate = generatedEmails
        .filter(e => e.suggestionId)
        .map(e => e.suggestionId);

      if (suggestionIdsToUpdate.length > 0) {
        sendEvent('progress', {
          stage: 'updating_database',
          message: `Marking ${suggestionIdsToUpdate.length} candidates as sent...`
        });

        const now = new Date().toISOString();
        await bypassDynamicsRestrictions('generate-emails-mark-sent', async () => {
          for (const suggestionId of suggestionIdsToUpdate) {
            try {
              await DynamicsService.updateRecord(
                'wmkf_appreviewersuggestions',
                suggestionId,
                { wmkf_emailsentat: now, wmkf_invited: true },
              );
              markedAsSentCount++;
            } catch (dvError) {
              console.error(`Failed to update email_sent_at for suggestion ${suggestionId}:`, dvError.message);
            }
          }
        });
      }
    }

    // Send final result with all email contents
    sendEvent('result', {
      emails: generatedEmails,
      stats: {
        total: candidates.length,
        generated: generatedEmails.length,
        skipped: skippedCount,
        errors: errors.length,
        markedAsSent: markedAsSentCount
      },
      errors: errors.length > 0 ? errors : undefined
    });

    sendEvent('complete', {
      message: `Generated ${generatedEmails.length} emails${markedAsSentCount > 0 ? `, marked ${markedAsSentCount} as sent` : ''}`,
      generated: generatedEmails.length,
      skipped: skippedCount,
      markedAsSent: markedAsSentCount
    });

  } catch (error) {
    console.error('Generate emails error:', error);
    if (deadlineController.signal.aborted) {
      const mins = budgetSeconds ? Math.round(budgetSeconds / 60) : null;
      sendEvent('error', {
        message: `Email generation stopped after exceeding the configured ${mins ? `${mins}-minute ` : ''}time budget. An admin can raise it (up to 13 minutes) under Settings at /admin.`,
        timeout: true,
      });
    } else {
      sendEvent('error', {
        message: BASE_CONFIG.ERROR_MESSAGES.EMAIL_GENERATION_FAILED,
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  } finally {
    clearTimeout(deadlineTimer);
  }

  res.end();
}

/**
 * Use Claude to personalize an email body
 */
async function personalizeWithClaude(candidate, proposalInfo, baseBody, apiKey, userProfileId, { signal, deadlineAt } = {}) {
  const prompt = createPersonalizationPrompt(candidate, proposalInfo, baseBody);

  const clientOpts = {
    apiKey,
    model: getModelForApp('email-personalization'),
    appName: 'reviewer-finder-emails',
    userProfileId,
  };
  // Under a deadline, bound this attempt by min(remaining budget, 180s).
  if (deadlineAt != null) {
    const remainingMs = deadlineAt - Date.now();
    clientOpts.timeoutMs = Math.max(1, Math.min(remainingMs, 180_000));
  }
  const claude = new LLMClient(clientOpts);
  const r = await claude.complete({
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 512,
    temperature: 0.3, // Low temperature for consistent, professional output
    signal,
  });

  return r.text ? r.text.trim() : null;
}
