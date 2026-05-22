/**
 * Multi-Perspective Concept Evaluator API Endpoint
 *
 * Evaluates research concepts using three AI perspectives (Optimist, Skeptic, Neutral)
 * with a fan-out/fan-in architecture, then synthesizes them into consensus,
 * disagreements, and a weighted recommendation.
 *
 * Architecture:
 * Stage 1: Initial Analysis (Vision API)
 * Stage 2: Literature Search (shared - runs once)
 * Stage 2.5: Proposal Summary (what they're proposing + potential impact)
 * Stage 3 (Fan-out): Three parallel perspectives
 * Stage 4 (Fan-in): Integrator synthesizes all perspectives
 */

import { BASE_CONFIG, getModelForApp, getFallbackModelForApp } from '../../shared/config/baseConfig';
import { loadModelOverrides } from '../../lib/services/model-override-loader';
import { splitPdfToPages } from '../../lib/utils/pdf-page-splitter';
import {
  createInitialAnalysisPrompt,
  createProposalSummaryPrompt,
  createOptimistPrompt,
  createSkepticPrompt,
  createNeutralPrompt,
  createIntegratorPrompt,
  selectDatabasesForResearchArea,
  EVALUATION_FRAMEWORKS
} from '../../shared/config/prompts/multi-perspective-evaluator';
import { requireAppAccess } from '../../lib/utils/auth';
import { logUsage } from '../../lib/utils/usage-logger';
import { LLMClient } from '../../lib/services/llm-client';
import { nextRateLimiter } from '../../shared/api/middleware/rateLimiter';
import { safeFetch } from '../../lib/utils/safe-fetch';
import { validateAiJson } from '../../lib/utils/ai-output-schema';
import {
  INITIAL_ANALYSIS_SCHEMA,
  PROPOSAL_SUMMARY_SCHEMA,
  PERSPECTIVE_SCHEMAS,
  INTEGRATOR_SCHEMA,
} from '../../shared/config/multi-perspective-output-schema';

// A7 follow-up: validate a parsed stage output against its schema. On success
// returns the cleaned value (undeclared keys dropped — the anti-injection
// property). On a type-level validation failure it logs and returns the raw
// parse: the sentinel-wrapping at each re-feed site is the primary injection
// defense, so this schema pass is best-effort defense-in-depth.
function validateStage(parsed, schema, label) {
  const r = validateAiJson(parsed, schema);
  if (r.ok) return r.value;
  console.warn(`[MultiPerspective] ${label} failed schema validation: ${r.errors.join('; ')}`);
  return parsed;
}

// Import search services
const { PubMedService } = require('../../lib/services/pubmed-service');
const { ArXivService } = require('../../lib/services/arxiv-service');
const { BioRxivService } = require('../../lib/services/biorxiv-service');
const { ChemRxivService } = require('../../lib/services/chemrxiv-service');

const limiter = nextRateLimiter({ max: 5 });

// Concurrency limit for processing pages
const CONCURRENCY_LIMIT = 2;

// Retry configuration for Claude API calls
const RETRY_CONFIG = {
  MAX_RETRIES: 3,
  INITIAL_DELAY_MS: 2000,
  MAX_DELAY_MS: 30000,
  BACKOFF_MULTIPLIER: 2
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Require authentication + app access
  const access = await requireAppAccess(req, res, 'multi-perspective-evaluator');
  if (!access) return;

  const allowed = await limiter(req, res);
  if (allowed !== true) return;

  await loadModelOverrides();

  // Set headers for streaming response
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (event, data) => {
    res.write(`data: ${JSON.stringify({ event, ...data })}\n\n`);
  };

  try {
    const { files, framework = 'keck' } = req.body;

    const apiKey = process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      sendEvent('error', { message: 'Claude API key not configured on server' });
      return res.end();
    }

    const userProfileId = access.profileId;

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files provided' });
    }

    // Validate framework
    if (!EVALUATION_FRAMEWORKS[framework]) {
      return res.status(400).json({ error: `Invalid framework: ${framework}. Valid options: ${Object.keys(EVALUATION_FRAMEWORKS).join(', ')}` });
    }

    // Limit to single file
    if (files.length > 1) {
      return res.status(400).json({ error: 'Please upload one file at a time for multi-perspective evaluation.' });
    }

    const allResults = [];
    let totalPages = 0;
    let processedPages = 0;

    // Process each uploaded file
    for (const file of files) {
      try {
        sendProgress(res, 0, `Loading ${file.filename}...`);

        // Fetch file from blob URL
        const fileResponse = await safeFetch(file.url);
        if (!fileResponse.ok) {
          throw new Error(`Failed to fetch file: ${fileResponse.statusText}`);
        }

        const fileBuffer = await fileResponse.arrayBuffer();

        // Split PDF into individual pages
        sendProgress(res, 5, `Splitting ${file.filename} into pages...`);
        const pages = await splitPdfToPages(fileBuffer);
        totalPages += pages.length;

        sendProgress(res, 10, `Found ${pages.length} concept(s) in ${file.filename}`);

        // Process pages with concurrency control
        const fileResults = await processWithConcurrency(
          pages,
          async (page) => {
            const result = await evaluateSingleConceptMultiPerspective(
              page,
              apiKey,
              framework,
              res,
              processedPages,
              totalPages,
              userProfileId
            );
            processedPages++;
            return result;
          },
          CONCURRENCY_LIMIT
        );

        allResults.push(...fileResults);

      } catch (fileError) {
        console.error(`Error processing ${file.filename}:`, fileError);
        allResults.push({
          pageNumber: 0,
          sourceFile: file.filename,
          error: fileError.message,
          title: `Error: ${file.filename}`,
          synthesis: {
            overallNarrative: `Failed to process file: ${fileError.message}`
          }
        });
      }
    }

    // Send final results
    const flaggedConcepts = allResults.filter(r => r.flaggedForReview);
    const fullyEvaluated = allResults.filter(r => !r.error && !r.flaggedForReview);

    const finalData = {
      progress: 100,
      message: 'Multi-perspective evaluation complete!',
      results: {
        concepts: allResults,
        framework: framework,
        frameworkName: EVALUATION_FRAMEWORKS[framework].name,
        summary: {
          totalConcepts: allResults.length,
          successfulEvaluations: fullyEvaluated.length,
          flaggedAsIneligible: flaggedConcepts.length,
          errors: allResults.filter(r => r.error).length,
          timestamp: new Date().toISOString()
        }
      }
    };

    res.write(`data: ${JSON.stringify(finalData)}\n\n`);
    res.end();

  } catch (error) {
    console.error('API error:', error);
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
function sendProgress(res, progress, message, stage = null) {
  const data = { progress, message };
  if (stage) data.stage = stage;
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * Process items with concurrency control
 */
async function processWithConcurrency(items, processorFn, limit) {
  const results = [];

  for (let i = 0; i < items.length; i += limit) {
    const chunk = items.slice(i, i + limit);
    const chunkResults = await Promise.all(chunk.map(processorFn));
    results.push(...chunkResults);
  }

  return results;
}

/**
 * Evaluate a single concept using the multi-perspective approach
 */
async function evaluateSingleConceptMultiPerspective(page, apiKey, framework, res, processedCount, totalCount, userProfileId) {
  const { pageNumber, base64 } = page;
  const progressBase = 10 + Math.round((processedCount / totalCount) * 85);

  try {
    // Stage 1: Initial analysis via Vision API
    sendProgress(res, progressBase, `Analyzing concept ${pageNumber} of ${totalCount}...`, 'initial-analysis');
    const initialAnalysis = await performInitialAnalysis(base64, apiKey, userProfileId);

    if (!initialAnalysis || initialAnalysis.error) {
      throw new Error(initialAnalysis?.error || 'Initial analysis failed');
    }

    // Check eligibility - short-circuit if concept falls into exclusion category
    if (initialAnalysis.eligibility && !initialAnalysis.eligibility.isEligible) {
      sendProgress(res, progressBase + 5, `Concept ${pageNumber} flagged as potentially ineligible`, 'eligibility-flag');

      return {
        pageNumber,
        title: initialAnalysis.title,
        piName: initialAnalysis.piName,
        institution: initialAnalysis.institution,
        summary: initialAnalysis.summary,
        researchArea: initialAnalysis.researchArea,
        framework: framework,
        frameworkName: EVALUATION_FRAMEWORKS[framework].name,

        // Eligibility flag - this is the key output for flagged concepts
        eligibility: {
          isEligible: false,
          flag: initialAnalysis.eligibility.flag,
          flagReason: initialAnalysis.eligibility.flagReason
        },

        // Minimal evaluation - no need for full multi-perspective analysis
        flaggedForReview: true,
        flagCategory: getFlagCategoryName(initialAnalysis.eligibility.flag),

        // Include initial observations for context
        initialObservations: initialAnalysis.initialObservations,

        // No perspectives or synthesis for flagged concepts
        perspectives: null,
        consensus: null,
        disagreements: null,
        synthesis: {
          weightedRecommendation: 'Flagged - Outside Funding Scope',
          overallNarrative: `This concept has been flagged as potentially falling outside the W. M. Keck Foundation's funding scope. ${initialAnalysis.eligibility.flagReason}`,
          keyTakeaways: [
            `Flagged category: ${getFlagCategoryName(initialAnalysis.eligibility.flag)}`,
            initialAnalysis.eligibility.flagReason
          ]
        },
        forDecisionMakers: {
          headline: `Flagged: ${getFlagCategoryName(initialAnalysis.eligibility.flag)}`,
          furtherConsiderIf: 'Reconsider if this assessment is incorrect and the research is actually fundamental/basic science',
          declineIf: initialAnalysis.eligibility.flagReason
        }
      };
    }

    // Stage 2: Literature search based on extracted search queries
    sendProgress(res, progressBase + 5, `Searching literature for concept ${pageNumber}...`, 'literature-search');
    const { results: literatureResults, queriesUsed } = await searchLiterature(initialAnalysis);

    // Stage 2.5: Generate proposal summary
    sendProgress(res, progressBase + 10, `Generating proposal summary for concept ${pageNumber}...`, 'proposal-summary');
    const proposalSummary = await generateProposalSummary(initialAnalysis, literatureResults, apiKey, userProfileId);

    // Stage 3 (Fan-out): Three parallel perspectives
    sendProgress(res, progressBase + 18, `Running multi-perspective analysis (Optimist, Skeptic, Neutral)...`, 'perspectives');

    const perspectiveResults = await runPerspectivesInParallel(
      initialAnalysis,
      literatureResults,
      framework,
      apiKey,
      userProfileId
    );

    // Check if we have enough perspectives to proceed
    const successfulPerspectives = Object.values(perspectiveResults).filter(p => p && !p.error);
    if (successfulPerspectives.length < 2) {
      throw new Error('Not enough perspectives succeeded for synthesis. Need at least 2 of 3.');
    }

    // Stage 4 (Fan-in): Integrator synthesizes all perspectives
    sendProgress(res, progressBase + 35, `Synthesizing perspectives for concept ${pageNumber}...`, 'integration');

    const synthesis = await performIntegration(
      initialAnalysis,
      perspectiveResults.optimist,
      perspectiveResults.skeptic,
      perspectiveResults.neutral,
      framework,
      apiKey,
      userProfileId
    );

    return {
      pageNumber,
      title: initialAnalysis.title,
      piName: initialAnalysis.piName,
      institution: initialAnalysis.institution,
      summary: initialAnalysis.summary,
      researchArea: initialAnalysis.researchArea,
      framework: framework,
      frameworkName: EVALUATION_FRAMEWORKS[framework].name,

      // Eligibility status (passed screening)
      eligibility: {
        isEligible: true,
        flag: null,
        flagReason: null
      },

      // Proposal summary (what they're proposing + potential impact)
      proposalSummary: proposalSummary,

      // Individual perspectives
      perspectives: {
        optimist: perspectiveResults.optimist,
        skeptic: perspectiveResults.skeptic,
        neutral: perspectiveResults.neutral
      },

      // Integrated synthesis
      consensus: synthesis.consensus,
      disagreements: synthesis.disagreements,
      synthesis: synthesis.synthesis,
      forDecisionMakers: synthesis.forDecisionMakers,

      // Literature search info
      literatureSearch: {
        queries: queriesUsed,
        researchArea: initialAnalysis.researchArea,
        totalFound: literatureResults.length,
        sourceBreakdown: summarizeLiteratureSources(literatureResults),
        publications: literatureResults.slice(0, 15).map(formatPublication)
      }
    };

  } catch (error) {
    console.error(`Error evaluating page ${pageNumber}:`, error);
    return {
      pageNumber,
      error: 'An error occurred during evaluation',
      title: `Concept ${pageNumber}`,
      synthesis: {
        overallNarrative: 'An error occurred during evaluation'
      }
    };
  }
}

/**
 * Run all three perspectives in parallel using Promise.allSettled
 */
async function runPerspectivesInParallel(initialAnalysis, literatureResults, framework, apiKey, userProfileId) {
  const perspectivePromises = [
    callPerspective('optimist', createOptimistPrompt, initialAnalysis, literatureResults, framework, apiKey, userProfileId),
    callPerspective('skeptic', createSkepticPrompt, initialAnalysis, literatureResults, framework, apiKey, userProfileId),
    callPerspective('neutral', createNeutralPrompt, initialAnalysis, literatureResults, framework, apiKey, userProfileId)
  ];

  const results = await Promise.allSettled(perspectivePromises);

  return {
    optimist: results[0].status === 'fulfilled' ? results[0].value : { error: results[0].reason?.message || 'Failed' },
    skeptic: results[1].status === 'fulfilled' ? results[1].value : { error: results[1].reason?.message || 'Failed' },
    neutral: results[2].status === 'fulfilled' ? results[2].value : { error: results[2].reason?.message || 'Failed' }
  };
}

/**
 * Call a single perspective
 */
async function callPerspective(name, createPromptFn, initialAnalysis, literatureResults, framework, apiKey, userProfileId) {
  const prompt = createPromptFn(initialAnalysis, literatureResults, framework);

  const requestBody = {
    max_tokens: 2500,
    temperature: 0.3,
    messages: [{
      role: 'user',
      content: prompt
    }]
  };

  const { data } = await callClaudeWithRetry(requestBody, apiKey, 'model', userProfileId);
  const responseText = data.content[0].text;

  // Parse JSON response
  try {
    let jsonStr = responseText;
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }
    const schema = PERSPECTIVE_SCHEMAS[name];
    const parsed = JSON.parse(jsonStr);
    return schema ? validateStage(parsed, schema, `${name} perspective`) : parsed;
  } catch (parseError) {
    console.error(`Failed to parse ${name} perspective JSON:`, parseError);
    return {
      perspective: name,
      error: 'Failed to parse response',
      rawResponse: responseText.substring(0, 500)
    };
  }
}

/**
 * Perform the integration step
 */
async function performIntegration(initialAnalysis, optimistResult, skepticResult, neutralResult, framework, apiKey, userProfileId) {
  const prompt = createIntegratorPrompt(
    initialAnalysis,
    optimistResult,
    skepticResult,
    neutralResult,
    framework
  );

  const requestBody = {
    max_tokens: 3500,
    temperature: 0.3,
    messages: [{
      role: 'user',
      content: prompt
    }]
  };

  const { data } = await callClaudeWithRetry(requestBody, apiKey, 'model', userProfileId);
  const responseText = data.content[0].text;

  // Parse JSON response
  try {
    let jsonStr = responseText;
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }
    return validateStage(JSON.parse(jsonStr), INTEGRATOR_SCHEMA, 'integrator');
  } catch (parseError) {
    console.error('Failed to parse integrator JSON:', parseError);
    return {
      synthesis: {
        weightedRecommendation: 'Unknown',
        overallNarrative: 'Failed to synthesize perspectives. Raw response available.',
        rawResponse: responseText.substring(0, 1000)
      }
    };
  }
}

/**
 * Stage 2.5: Generate proposal summary
 */
async function generateProposalSummary(initialAnalysis, literatureResults, apiKey, userProfileId) {
  const prompt = createProposalSummaryPrompt(initialAnalysis, literatureResults);

  const requestBody = {
    max_tokens: 1500,
    temperature: 0.3,
    messages: [{
      role: 'user',
      content: prompt
    }]
  };

  try {
    const { data } = await callClaudeWithRetry(requestBody, apiKey, 'model', userProfileId);
    const responseText = data.content[0].text;

    // Parse JSON response
    let jsonStr = responseText;
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }
    return validateStage(JSON.parse(jsonStr), PROPOSAL_SUMMARY_SCHEMA, 'proposal summary');
  } catch (error) {
    console.error('Failed to generate proposal summary:', error);
    return {
      proposalSummary: {
        whatTheyreProposing: initialAnalysis.summary || 'Summary not available',
        potentialImpact: 'Impact assessment not available'
      },
      keyInnovation: 'Not available',
      fieldContext: 'Not available',
      error: 'An error occurred generating proposal summary'
    };
  }
}

/**
 * Check if an error is retryable (rate limit or overload)
 */
function isRetryableError(status, errorText) {
  if (status === 429 || status === 529 || status === 503) return true;
  const lowerError = (errorText || '').toLowerCase();
  return lowerError.includes('overloaded') ||
         lowerError.includes('rate limit') ||
         lowerError.includes('too many requests');
}

/**
 * Make a Claude API request with retry logic and fallback model
 */
async function callClaudeWithRetry(requestBody, apiKey, modelType = 'model', userProfileId = null) {
  const startTime = Date.now();
  const primaryModel = getModelForApp('multi-perspective-evaluator', modelType);
  const fallbackModel = getFallbackModelForApp('multi-perspective-evaluator');

  let lastError = null;
  let delay = RETRY_CONFIG.INITIAL_DELAY_MS;

  // Try primary model with retries
  for (let attempt = 0; attempt <= RETRY_CONFIG.MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      console.log(`[MultiPerspective] Retry attempt ${attempt}/${RETRY_CONFIG.MAX_RETRIES} after ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(delay * RETRY_CONFIG.BACKOFF_MULTIPLIER, RETRY_CONFIG.MAX_DELAY_MS);
    }

    try {
      // Use LLMClient with retries disabled — this route owns its own retry
      // loop with custom isRetryableError() semantics. The wrapper still
      // gives us safeFetch + abort + redaction.
      const claude = new LLMClient({ apiKey, model: primaryModel, maxRetries: 0 });
      let r;
      try {
        r = await claude.complete(toCompleteOpts(requestBody));
      } catch (err) {
        // Wrapper throws on non-2xx; treat as Claude API error for retry logic.
        const status = err.status || 0;
        const isRetryable = isRetryableError(status, err.message || '');
        if (!isRetryable) throw err;
        lastError = err;
        continue;
      }
      logUsage({
        userProfileId,
        appName: 'multi-perspective-evaluator',
        model: r.model,
        inputTokens: r.usage.inputTokens,
        outputTokens: r.usage.outputTokens,
        latencyMs: Date.now() - startTime,
      });
      // Match legacy return shape: { data: <raw API response> }
      return {
        data: { content: r.content, model: r.model, usage: { input_tokens: r.usage.inputTokens, output_tokens: r.usage.outputTokens } },
        usedFallback: false,
        model: primaryModel,
      };
    } catch (error) {
      if (error.message && !error.message.includes('Claude API error')) {
        throw error;
      }
      lastError = error;
    }
  }

  // All retries failed, try fallback model
  console.log(`[MultiPerspective] Primary model (${primaryModel}) failed, trying fallback (${fallbackModel})...`);

  const fallback = new LLMClient({ apiKey, model: fallbackModel, maxRetries: 0 });
  let r;
  try {
    r = await fallback.complete(toCompleteOpts(requestBody));
  } catch (err) {
    console.error('[MultiPerspective] Fallback model also failed:', err.message?.substring(0, 200));
    throw lastError || err;
  }
  logUsage({
    userProfileId,
    appName: 'multi-perspective-evaluator',
    model: r.model,
    inputTokens: r.usage.inputTokens,
    outputTokens: r.usage.outputTokens,
    latencyMs: Date.now() - startTime,
  });
  console.log(`[MultiPerspective] Fallback model succeeded`);
  return {
    data: { content: r.content, model: r.model, usage: { input_tokens: r.usage.inputTokens, output_tokens: r.usage.outputTokens } },
    usedFallback: true,
    model: fallbackModel,
  };
}

// Translate a legacy Anthropic body into LLMClient.complete() opts.
function toCompleteOpts(body) {
  const opts = { messages: body.messages };
  if (body.max_tokens != null) opts.maxTokens = body.max_tokens;
  if (body.temperature != null) opts.temperature = body.temperature;
  if (body.system != null) opts.system = body.system;
  if (body.tools) opts.tools = body.tools;
  return opts;
}

/**
 * Stage 1: Initial analysis using Claude Vision API
 */
async function performInitialAnalysis(base64Pdf, apiKey, userProfileId) {
  const prompt = createInitialAnalysisPrompt();

  const requestBody = {
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: base64Pdf
          }
        },
        {
          type: 'text',
          text: prompt
        }
      ]
    }]
  };

  const { data, usedFallback, model } = await callClaudeWithRetry(requestBody, apiKey, 'visionModel', userProfileId);

  if (usedFallback) {
    console.log(`[MultiPerspective] Initial analysis used fallback model: ${model}`);
  }

  const responseText = data.content[0].text;

  // Parse JSON response
  try {
    let jsonStr = responseText;
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }
    return validateStage(JSON.parse(jsonStr), INITIAL_ANALYSIS_SCHEMA, 'initial analysis');
  } catch (parseError) {
    console.error('Failed to parse initial analysis JSON:', parseError);
    return {
      title: 'Unknown Concept',
      summary: responseText.substring(0, 500),
      researchArea: 'general',
      keywords: [],
      error: 'Failed to parse structured response'
    };
  }
}

/**
 * Stage 2: Search literature databases
 */
async function searchLiterature(initialAnalysis) {
  const { searchQueries = [], researchArea = 'general' } = initialAnalysis;

  if (searchQueries.length === 0) {
    console.log('No search queries extracted, skipping literature search');
    return { results: [], queriesUsed: [] };
  }

  const databases = selectDatabasesForResearchArea(researchArea);
  console.log(`Literature search for "${researchArea}": databases =`, databases);

  const allResults = [];
  const queriesUsed = [];

  try {
    for (const query of searchQueries.slice(0, 3)) {
      queriesUsed.push(query);
      const searchPromises = [];

      if (databases.pubmed) {
        searchPromises.push(
          PubMedService.search(query, 15).then(results =>
            results.map(r => ({ ...r, source: 'PubMed', query }))
          ).catch(err => {
            console.error(`PubMed search error for "${query}":`, err.message);
            return [];
          })
        );
      }

      if (databases.arxiv) {
        searchPromises.push(
          ArXivService.search(query, 15).then(results =>
            results.map(r => ({ ...r, source: 'ArXiv', query }))
          ).catch(err => {
            console.error(`ArXiv search error for "${query}":`, err.message);
            return [];
          })
        );
      }

      if (databases.biorxiv) {
        searchPromises.push(
          BioRxivService.search(query, 15).then(results =>
            results.map(r => ({ ...r, source: 'BioRxiv', query }))
          ).catch(err => {
            console.error(`BioRxiv search error for "${query}":`, err.message);
            return [];
          })
        );
      }

      if (databases.chemrxiv) {
        searchPromises.push(
          ChemRxivService.search(query, 15).then(results =>
            results.map(r => ({ ...r, source: 'ChemRxiv', query }))
          ).catch(err => {
            console.error(`ChemRxiv search error for "${query}":`, err.message);
            return [];
          })
        );
      }

      const searchResults = await Promise.all(searchPromises);
      searchResults.forEach(results => allResults.push(...results));
    }

    // Deduplicate by title
    const seen = new Set();
    const deduped = allResults.filter(pub => {
      const key = (pub.title || '').toLowerCase().substring(0, 50);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Filter to recent publications (last 3 years)
    const threeYearsAgo = new Date().getFullYear() - 3;
    const recentResults = deduped.filter(pub => {
      const year = pub.year || parseInt(pub.publicationDate?.substring(0, 4));
      return year && year >= threeYearsAgo;
    });

    console.log(`Literature search: ${allResults.length} total, ${deduped.length} unique, ${recentResults.length} from last 3 years`);
    return {
      results: recentResults.slice(0, 30),
      queriesUsed
    };

  } catch (error) {
    console.error('Literature search error:', error);
    return { results: [], queriesUsed };
  }
}

/**
 * Format a publication for output
 */
function formatPublication(pub) {
  const authorNames = (pub.authors || []).slice(0, 4).map(a =>
    typeof a === 'string' ? a : (a?.name || 'Unknown')
  );

  let url = null;
  if (pub.doi) {
    url = `https://doi.org/${pub.doi}`;
  } else if (pub.pmid) {
    url = `https://pubmed.ncbi.nlm.nih.gov/${pub.pmid}`;
  } else if (pub.arxivId) {
    url = `https://arxiv.org/abs/${pub.arxivId}`;
  }

  return {
    title: pub.title,
    authors: authorNames,
    year: pub.year || pub.publicationDate?.substring(0, 4),
    source: pub.source,
    journal: pub.journal || pub.venue || null,
    doi: pub.doi || null,
    url
  };
}

/**
 * Summarize literature sources
 */
function summarizeLiteratureSources(results) {
  const sources = {};
  results.forEach(r => {
    const source = r.source || 'Unknown';
    sources[source] = (sources[source] || 0) + 1;
  });
  return sources;
}

/**
 * Get human-readable name for eligibility flag
 */
function getFlagCategoryName(flag) {
  const flagNames = {
    'MEDICAL_DEVICE_TRANSLATIONAL': 'Medical Devices / Translational Research',
    'ENGINEERING_ONLY': 'Engineering-Only Projects',
    'CLINICAL_TRIALS': 'Clinical Trials / Therapies / Procedures',
    'DRUG_DEVELOPMENT': 'Drug Discovery / Development / Delivery',
    'BIOMARKER_SCREENING': 'Disease Biomarker Screening',
    'DIGITAL_TWIN': 'Digital Twin Implementations',
    'USER_FACILITIES': 'User / Shared Facilities',
    'SUPPLEMENT_RENEWAL': 'Supplements / Renewals / Follow-on Funding',
    'CONFERENCE_POLICY': 'Conferences / Science Policy'
  };
  return flagNames[flag] || flag || 'Unknown Category';
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
    responseLimit: false,
    externalResolver: true,
  },
  maxDuration: 600, // 10 minutes timeout for multi-perspective analysis
};
