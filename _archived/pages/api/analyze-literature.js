import { requireAcceptedLlmResponse } from '../../lib/utils/llm-response';
/**
 * Literature Analyzer API Endpoint
 *
 * Analyzes research papers and synthesizes findings across multiple documents.
 * Uses a two-stage process:
 * 1. Claude Vision API to extract key information from each paper
 * 2. Claude to synthesize findings across all papers
 */

import { BASE_CONFIG } from '../../shared/config/baseConfig';
import {
  LITERATURE_EXTRACT_PAPER_ROW,
  LITERATURE_SYNTHESIZE_ROW,
  LITERATURE_COMPARE_ROW,
  buildLiteratureExtractVariables,
  buildLiteratureSynthesisVariables,
  buildLiteratureCompareVariables,
} from '../../shared/config/prompts/literature-analyzer-dynamics';
import { resolveToolPrompt, toolPromptUnavailable } from '../../lib/services/tool-prompt-resolver';
import { composeToolPromptPair } from '../../lib/services/tool-prompt-composer';
import { requireAppAccess } from '../../lib/utils/auth';
import { LLMClient } from '../../lib/services/llm-client';
import { nextRateLimiter } from '../../shared/api/middleware/rateLimiter';
import { fetchPublicBlob } from '../../lib/utils/public-blob-fetch';

const limiter = nextRateLimiter({ max: 5 });

// Concurrency limit for processing papers
const CONCURRENCY_LIMIT = 2;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Require authentication + app access
  const access = await requireAppAccess(req, res, 'literature-analyzer');
  if (!access) return;

  const allowed = await limiter(req, res);
  if (allowed !== true) return;

  try {
    const { files, options = {} } = req.body;
    const { focusTopic, generateComparison, comparisonType } = options;

    const apiKey = process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Claude API key not configured on server' });
    }

    const userProfileId = access.profileId;

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files provided' });
    }

    // Resolve the prompt rows once per request, before streaming starts, so a
    // missing/ambiguous row is a plain 503 JSON instead of per-paper error results.
    const rows = {
      extract: await resolveToolPrompt(LITERATURE_EXTRACT_PAPER_ROW.promptName, LITERATURE_EXTRACT_PAPER_ROW),
      synthesize: await resolveToolPrompt(LITERATURE_SYNTHESIZE_ROW.promptName, LITERATURE_SYNTHESIZE_ROW),
      compare: generateComparison
        ? await resolveToolPrompt(LITERATURE_COMPARE_ROW.promptName, LITERATURE_COMPARE_ROW)
        : null,
    };

    // Set headers for streaming response
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const extractedPapers = [];
    let processedFiles = 0;
    const totalFiles = files.length;

    sendProgress(res, 0, `Starting analysis of ${totalFiles} paper(s)...`);

    // Stage 1: Extract information from each paper
    for (const file of files) {
      try {
        processedFiles++;
        const progressPercent = Math.round((processedFiles / totalFiles) * 60);

        sendProgress(res, progressPercent, `Analyzing paper ${processedFiles} of ${totalFiles}: ${file.filename}...`);

        // Fetch file from blob URL
        const fileResponse = await fetchPublicBlob(file.url);
        if (!fileResponse.ok) {
          throw new Error(`Failed to fetch file: ${fileResponse.statusText}`);
        }

        const fileBuffer = await fileResponse.arrayBuffer();
        const base64 = Buffer.from(fileBuffer).toString('base64');

        // Extract paper information using Vision API
        const extractedData = await extractPaperInfo(base64, rows.extract, apiKey, userProfileId);

        if (extractedData && !extractedData.error) {
          extractedPapers.push({
            ...extractedData,
            sourceFile: file.filename,
            fileUrl: file.url
          });

          // Send individual paper result
          sendEvent(res, 'paper_extracted', {
            index: processedFiles - 1,
            filename: file.filename,
            title: extractedData.title,
            authors: extractedData.authors,
            year: extractedData.year
          });
        } else {
          // Paper extraction failed
          extractedPapers.push({
            sourceFile: file.filename,
            error: extractedData?.error || 'Failed to extract paper information',
            title: file.filename
          });

          sendEvent(res, 'paper_error', {
            index: processedFiles - 1,
            filename: file.filename,
            error: extractedData?.error || 'Extraction failed'
          });
        }

      } catch (fileError) {
        console.error(`Error processing ${file.filename}:`, fileError);
        extractedPapers.push({
          sourceFile: file.filename,
          error: fileError.message,
          title: file.filename
        });
      }
    }

    // Filter successful extractions for synthesis
    const successfulPapers = extractedPapers.filter(p => !p.error);

    sendProgress(res, 70, `Extracted ${successfulPapers.length} of ${totalFiles} papers successfully`);

    let synthesis = null;
    let comparison = null;

    // Stage 2: Synthesize findings (if we have at least 2 successful papers)
    if (successfulPapers.length >= 2) {
      sendProgress(res, 75, 'Generating synthesis across papers...');

      try {
        synthesis = await generateSynthesis(successfulPapers, focusTopic, rows.synthesize, apiKey, userProfileId);
        sendEvent(res, 'synthesis_complete', { success: true });
      } catch (synthError) {
        console.error('Synthesis error:', synthError);
        synthesis = { error: synthError.message };
      }

      // Optional: Generate comparison
      if (generateComparison && successfulPapers.length >= 2) {
        sendProgress(res, 90, 'Generating comparison...');
        try {
          comparison = await generateComparisonData(successfulPapers, comparisonType || 'findings', rows.compare, apiKey, userProfileId);
        } catch (compError) {
          console.error('Comparison error:', compError);
          comparison = { error: compError.message };
        }
      }
    } else if (successfulPapers.length === 1) {
      // Single paper - no synthesis needed
      synthesis = {
        overview: {
          paperCount: 1,
          briefSummary: 'Single paper analyzed. Upload additional papers for cross-paper synthesis.'
        }
      };
    }

    // Send final results
    const finalData = {
      progress: 100,
      message: 'Analysis complete!',
      results: {
        papers: extractedPapers,
        synthesis,
        comparison,
        summary: {
          totalPapers: totalFiles,
          successfulExtractions: successfulPapers.length,
          errors: extractedPapers.filter(p => p.error).length,
          timestamp: new Date().toISOString()
        }
      }
    };

    res.write(`data: ${JSON.stringify(finalData)}\n\n`);
    res.end();

  } catch (error) {
    console.error('API error:', error);
    // Once progress frames have gone out, a JSON 500 can no longer be sent;
    // end the stream with an error event the page reports.
    const unavailable = toolPromptUnavailable(error);
    if (res.headersSent) {
      sendEvent(res, 'error', unavailable
        ? { message: unavailable.error, code: unavailable.code }
        : { message: BASE_CONFIG.ERROR_MESSAGES.PROCESSING_FAILED });
      res.end();
      return;
    }
    if (unavailable) return res.status(503).json(unavailable);
    res.status(500).json({
      error: BASE_CONFIG.ERROR_MESSAGES.PROCESSING_FAILED,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * Send progress update to client
 */
function sendProgress(res, progress, message) {
  res.write(`data: ${JSON.stringify({ progress, message })}\n\n`);
}

/**
 * Send named event to client
 */
function sendEvent(res, event, data) {
  res.write(`data: ${JSON.stringify({ event, ...data })}\n\n`);
}

/**
 * Compose a resolved row with the variables helper's output (A7 preamble is filled
 * in code). The request shape matches today's: the composed body is the user text;
 * a system prompt is sent only if an /admin edit made one non-empty.
 */
function composeRow(row, { variables, nonces }) {
  return composeToolPromptPair({ systemPrompt: row.systemPrompt, body: row.body }, variables, { nonces });
}

function systemOf(composed) {
  return composed.systemPrompt ? { system: composed.systemPrompt } : {};
}

/**
 * Extract information from a single paper using Vision API
 */
async function extractPaperInfo(base64Pdf, row, apiKey, userProfileId) {
  const composed = composeRow(row, buildLiteratureExtractVariables());

  const claude = new LLMClient({
    apiKey,
    model: row.model,
    appName: 'literature-analyzer',
    userProfileId,
  });
  const { text: responseText } = requireAcceptedLlmResponse(await claude.complete({
    ...systemOf(composed),
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Pdf } },
        { type: 'text', text: composed.body },
      ],
    }],
    maxTokens: row.maxTokens,
  }));

  // Parse JSON response
  try {
    let jsonStr = responseText;
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }
    return JSON.parse(jsonStr);
  } catch (parseError) {
    console.error('Failed to parse paper extraction JSON:', parseError);
    console.error('Response was:', responseText.substring(0, 500));
    return {
      title: 'Unknown Paper',
      abstract: responseText.substring(0, 500),
      error: 'Failed to parse structured response'
    };
  }
}

/**
 * Generate synthesis across multiple papers
 */
async function generateSynthesis(papers, focusTopic, row, apiKey, userProfileId) {
  const composed = composeRow(row, buildLiteratureSynthesisVariables(papers, focusTopic));

  const claude = new LLMClient({
    apiKey,
    model: row.model,
    appName: 'literature-analyzer',
    userProfileId,
  });
  const { text: responseText } = requireAcceptedLlmResponse(await claude.complete({
    ...systemOf(composed),
    messages: [{ role: 'user', content: composed.body }],
    maxTokens: row.maxTokens,
    temperature: 0.3,
  }));

  // Parse JSON response
  try {
    let jsonStr = responseText;
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }
    return JSON.parse(jsonStr);
  } catch (parseError) {
    console.error('Failed to parse synthesis JSON:', parseError);
    return {
      synthesis: responseText.substring(0, 2000),
      parseError: true
    };
  }
}

/**
 * Generate comparison across papers
 */
async function generateComparisonData(papers, comparisonType, row, apiKey, userProfileId) {
  const composed = composeRow(row, buildLiteratureCompareVariables(papers, comparisonType));

  const claude = new LLMClient({
    apiKey,
    model: row.model,
    appName: 'literature-analyzer',
    userProfileId,
  });
  const { text: responseText } = requireAcceptedLlmResponse(await claude.complete({
    ...systemOf(composed),
    messages: [{ role: 'user', content: composed.body }],
    maxTokens: row.maxTokens,
    temperature: 0.3,
  }));

  // Parse JSON response
  try {
    let jsonStr = responseText;
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }
    return JSON.parse(jsonStr);
  } catch (parseError) {
    console.error('Failed to parse comparison JSON:', parseError);
    return {
      summary: responseText.substring(0, 1000),
      parseError: true
    };
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb', // Only for JSON payload with blob URLs
    },
    responseLimit: false,
    externalResolver: true,
  },
  maxDuration: 600, // 10 minutes timeout for large paper sets
};
