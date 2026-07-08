// SUNSET S344 (2026-07-08): backs the sunset-candidate apps `phase-ii-writeup`
// and `batch-proposal-summaries` (both PDF-upload, no longer used in current
// format). Route is intentionally LEFT ROUTABLE; code retained as the reference
// for a planned Dataverse-native migration. Do not add new callers or extend the
// PDF-extraction path. See APP_LIFECYCLE_REGISTRY + docs/PROMPT_LEGACY_AUDIT.md.
import pdf from 'pdf-parse';
import { BASE_CONFIG, getModelForApp } from '../../shared/config/baseConfig';
import { loadModelOverrides } from '../../lib/services/model-override-loader';
import { createSummarizationPrompt, createStructuredDataExtractionPrompt, enhanceFormatting as enhanceFormattingPrompt } from '../../shared/config/prompts/proposal-summarizer';
import { requireAppAccess } from '../../lib/utils/auth';
import { LLMClient } from '../../lib/services/llm-client';
import { nextRateLimiter } from '../../shared/api/middleware/rateLimiter';
import { safeFetch } from '../../lib/utils/safe-fetch';
import {
  DATA_CLASSES,
  BATCH_PHASE_II_PROPOSAL_MAX_CHARS,
  wrapUntrustedContent,
} from '../../lib/utils/ai-payload-boundary';
import { validateAiJson } from '../../lib/utils/ai-output-schema';
import { PROPOSAL_EXTRACTION_SCHEMA } from '../../shared/config/proposal-extraction-output-schema';

const limiter = nextRateLimiter({ max: 5 });

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Require authentication + app access
  const access = await requireAppAccess(req, res, 'batch-proposal-summaries', 'phase-ii-writeup');
  if (!access) return;

  const allowed = await limiter(req, res);
  if (allowed !== true) return;

  await loadModelOverrides();

  try {
    const { files, summaryLength = 2 } = req.body;
    const apiKey = process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Claude API key not configured on server' });
    }
    const userProfileId = access.profileId;

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files provided' });
    }

    // Set headers for streaming response
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const results = {};
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const progress = Math.round((i / files.length) * 90); // Leave 10% for final processing
      
      // Send progress update
      res.write(`data: ${JSON.stringify({
        progress,
        message: `Processing ${file.filename}...`
      })}\n\n`);

      try {
        console.log(`Processing file: ${file.filename}, URL: ${file.url}`);
        
        // Fetch file from blob URL
        const fileResponse = await safeFetch(file.url);
        if (!fileResponse.ok) {
          throw new Error(`Failed to fetch file from blob storage: ${fileResponse.statusText}`);
        }
        
        const fileBuffer = await fileResponse.arrayBuffer();
        console.log(`File buffer size: ${fileBuffer.byteLength} bytes`);
        
        // Extract text from PDF
        const pdfData = await pdf(Buffer.from(fileBuffer));
        const text = pdfData.text;
        console.log(`Extracted text length: ${text ? text.length : 0} characters`);

        if (!text || text.trim().length < 100) {
          throw new Error('PDF appears to be empty or contains insufficient text');
        }

        // Generate summary using Claude API
        console.log(`Sending to Claude API with text length: ${text.length}`);
        const sendUpdate = (data) => {
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        };
        const summary = await generateSummary(text, file.filename, apiKey, summaryLength, userProfileId, sendUpdate);
        console.log(`Received summary:`, summary ? 'Success' : 'Failed');
        results[file.filename] = { ...summary, extractedText: text };

      } catch (fileError) {
        console.error(`Error processing ${file.filename}:`, fileError);
        results[file.filename] = createErrorResult(file.filename, fileError.message);
      }
    }

    // Send final results
    const finalData = {
      progress: 100,
      message: 'Complete!',
      results
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

async function generateSummary(text, filename, apiKey, summaryLength, userProfileId, sendUpdate = () => {}) {
  try {
    const summaryPayload = wrapUntrustedContent({
      text,
      source: 'batch-phase-ii.summary.proposalText',
      dataClass: DATA_CLASSES.PROPOSAL_TEXT,
      maxChars: BATCH_PHASE_II_PROPOSAL_MAX_CHARS,
      label: 'research proposal',
    });
    sendUpdate({
      type: 'payload_boundary',
      filename,
      message: summaryPayload.metadata.truncated
        ? `Proposal text truncated to ${summaryPayload.metadata.transmittedChars.toLocaleString()} characters before AI summarization`
        : `Proposal text bounded at ${summaryPayload.metadata.transmittedChars.toLocaleString()} characters before AI summarization`,
      aiPayloadBoundary: summaryPayload.metadata,
    });
    const prompt = createSummarizationPrompt(summaryPayload.text, summaryLength, [summaryPayload.nonce]);

    const claude = new LLMClient({
      apiKey,
      model: getModelForApp('batch-phase-ii'),
      appName: 'batch-phase-ii',
      userProfileId,
    });
    let summaryText;
    try {
      ({ text: summaryText } = await claude.complete({
        messages: [{ role: 'user', content: prompt }],
        maxTokens: BASE_CONFIG.MODEL_PARAMS.DEFAULT_MAX_TOKENS,
        temperature: BASE_CONFIG.MODEL_PARAMS.SUMMARIZATION_TEMPERATURE,
      }));
    } catch (err) {
      throw new Error(getApiErrorMessage(err.status || 500, err.message));
    }

    // Create formatted markdown version
    const formatted = enhanceFormatting(summaryText, filename);

    // Extract structured data, then cross-reference with summary
    const structured = await extractStructuredData(text, filename, summaryText, apiKey, userProfileId);
    crossReferenceWithSummary(structured, summaryText);

    return {
      formatted,
      structured
    };

  } catch (error) {
    console.error('Summary generation error:', error);
    throw error;
  }
}

async function extractStructuredData(text, filename, summary, apiKey, userProfileId) {
  try {
    const extractionPayload = wrapUntrustedContent({
      text,
      source: 'batch-phase-ii.extraction.proposalText',
      dataClass: DATA_CLASSES.PROPOSAL_TEXT,
      maxChars: BATCH_PHASE_II_PROPOSAL_MAX_CHARS,
      label: 'research proposal',
    });
    const extractionPrompt = createStructuredDataExtractionPrompt(
      extractionPayload.text,
      filename,
      [extractionPayload.nonce],
    );

    const claude = new LLMClient({
      apiKey,
      model: getModelForApp('batch-phase-ii'),
      appName: 'batch-phase-ii',
      userProfileId,
    });
    const { text: jsonTextRaw } = await claude.complete({
      messages: [{ role: 'user', content: extractionPrompt }],
      maxTokens: 1000,
      temperature: 0.1,
    });
    let jsonText = jsonTextRaw;
    if (jsonText) {
      try {
        // Strip markdown code fences if present (```json ... ``` or ``` ... ```)
        jsonText = jsonText.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
        const parsed = JSON.parse(jsonText);
        // Validate against the per-app schema (A7 Part 5) — drop any keys an
        // injected model added; bad types fall through to the basic fallback.
        const validated = validateAiJson(parsed, PROPOSAL_EXTRACTION_SCHEMA);
        if (validated.ok) {
          return {
            ...validated.value,
            timestamp: new Date().toISOString(),
            wordCount: text.split(' ').length
          };
        }
        console.warn(
          'Structured data failed schema validation, using fallback:',
          validated.errors.join('; '),
        );
      } catch (parseError) {
        console.warn('Failed to parse structured data, using fallback. Raw text:', jsonText.substring(0, 200));
      }
    }
  } catch (error) {
    console.warn('Structured data extraction failed, using fallback:', error.message);
  }

  // Fallback to basic extraction if AI fails
  return createStructuredDataFallback(text, filename);
}

function enhanceFormatting(summary, filename) {
  return enhanceFormattingPrompt(summary, filename);
}

/**
 * Cross-reference structured extraction with the generated summary text.
 * The summary reliably tags PI/co-PI names with <u> tags, so use those
 * to fix the principal_investigator field when the extraction is wrong.
 */
function crossReferenceWithSummary(structured, summaryText) {
  // Extract all <u>-tagged names from the summary
  const underlinedNames = [];
  const uRegex = /<u>(.*?)<\/u>/g;
  let match;
  while ((match = uRegex.exec(summaryText)) !== null) {
    const name = match[1].trim();
    if (name) underlinedNames.push(name);
  }

  if (underlinedNames.length === 0) return;

  // Fix PI name: if the extracted value doesn't match any underlined name,
  // use the first underlined name (which is typically the PI)
  const currentPI = structured.principal_investigator || '';
  const piMatchesAnyName = underlinedNames.some(name =>
    name.toLowerCase() === currentPI.toLowerCase() ||
    currentPI.toLowerCase().includes(name.toLowerCase()) ||
    name.toLowerCase().includes(currentPI.toLowerCase())
  );

  if (!piMatchesAnyName && underlinedNames.length > 0) {
    console.log(`Cross-reference fix: PI "${currentPI}" → "${underlinedNames[0]}" (from summary <u> tags)`);
    structured.principal_investigator = underlinedNames[0];
  }

  // Also populate investigators list from <u> tags if the extraction missed them
  if (!structured.investigators || structured.investigators.length === 0 ||
      (structured.investigators.length === 1 && structured.investigators[0] === 'Not specified')) {
    structured.investigators = underlinedNames;
  }
}

function getApiErrorMessage(status, responseText) {
  switch (status) {
    case 429:
      return 'Claude API rate limit exceeded. Please wait a moment and try again.';
    case 529:
    case 503:
      return 'Claude API is temporarily overloaded. Please try again in a minute or two.';
    case 401:
      return 'Claude API authentication failed. Please contact an administrator.';
    case 400: {
      // Check for specific 400 errors
      if (responseText.includes('context_length_exceeded') || responseText.includes('too many tokens')) {
        return 'This document is too large for the AI model to process. Try a shorter document.';
      }
      return `Claude API request error: ${responseText.substring(0, 200)}`;
    }
    default:
      return `Claude API error (${status}). Please try again.`;
  }
}

function createErrorResult(filename, errorMessage) {
  return {
    formatted: `# Error Processing ${filename}\n\n**Error:** ${errorMessage}\n\n**Timestamp:** ${new Date().toISOString()}`,
    structured: {
      filename,
      institution: 'Error',
      investigators: ['Error processing'],
      methods: ['N/A'],
      error: errorMessage,
      timestamp: new Date().toISOString(),
      wordCount: 0
    }
  };
}

function createStructuredDataFallback(text, filename) {
  return {
    filename,
    institution: extractInstitutionFromFilename(filename) || 'Not specified',
    principal_investigator: extractPrincipalInvestigator(text),
    investigators: extractInvestigators(text),
    research_area: extractResearchArea(text),
    methods: extractMethods(text),
    funding_amount: extractFundingAmount(text),
    duration: extractDuration(text),
    keywords: extractKeywords(text),
    timestamp: new Date().toISOString(),
    wordCount: text.split(' ').length
  };
}

// Utility functions (unchanged from original)
function extractInstitutionFromFilename(filename) {
  if (!filename) return 'Not specified';
  
  const cleanName = filename
    .replace(/\.(pdf|PDF)$/, '')
    .replace(/_SE_Phase_II_Staff_Version$/, '')
    .replace(/_Phase_II.*$/, '')
    .replace(/_Staff_Version$/, '')
    .replace(/_Final$/, '')
    .replace(/_Draft$/, '');
  
  const patterns = [
    /California Institute of Technology/i,
    /Massachusetts Institute of Technology/i,
    /University of California[^_]*/i,
    /University of [A-Za-z\s]+/i,
    /[A-Za-z\s]+ University/i,
    /[A-Za-z\s]+ Institute of Technology/i,
    /[A-Za-z\s]+ College/i,
    /[A-Za-z\s]+ State University/i,
    /[A-Za-z\s]+ Medical Center/i,
    /[A-Za-z\s]+ Research Institute/i
  ];
  
  for (const pattern of patterns) {
    const match = cleanName.match(pattern);
    if (match) return match[0].trim();
  }
  
  const parts = cleanName.split('_');
  if (parts.length > 1) {
    const firstPart = parts[0].replace(/([a-z])([A-Z])/g, '$1 $2');
    if (firstPart.includes(' ') || firstPart.length > 15) {
      return firstPart;
    }
  }
  
  return 'Not specified';
}

function extractPrincipalInvestigator(text) {
  const piMatch = text.match(/(?:Principal Investigator|PI)[:]\s*([A-Z][a-z]+ [A-Z][a-z]+)/i);
  if (piMatch) return piMatch[1];
  
  const nameMatch = text.match(/(?:Dr\.?\s+)?([A-Z][a-z]+ [A-Z][a-z]+)/);
  return nameMatch ? nameMatch[1] : 'Not specified';
}

function extractInvestigators(text) {
  const matches = text.match(/(?:Dr\.?\s+)?([A-Z][a-z]+ [A-Z][a-z]+)/g);
  return matches ? [...new Set(matches.slice(0, 5))] : ['Not specified'];
}

function extractResearchArea(text) {
  const areas = ['biochemistry', 'chemistry', 'biology', 'physics', 'medicine', 'engineering'];
  for (const area of areas) {
    if (new RegExp(area, 'i').test(text)) {
      return area.charAt(0).toUpperCase() + area.slice(1);
    }
  }
  return 'General Science';
}

function extractMethods(text) {
  const methods = [];
  const methodsMap = {
    'NMR': /NMR|nuclear magnetic resonance/i,
    'Spectroscopy': /spectroscopy/i,
    'Kinetics': /kinetics/i,
    'Mass Spectrometry': /mass spectrometry|MS/i,
    'X-ray': /x-ray|XRD/i,
    'Cell Culture': /cell culture|tissue culture/i,
    'PCR': /PCR|polymerase chain reaction/i,
    'Microscopy': /microscopy/i
  };
  
  for (const [method, pattern] of Object.entries(methodsMap)) {
    if (pattern.test(text)) methods.push(method);
  }
  
  return methods.length ? methods : ['Not specified'];
}

function extractFundingAmount(text) {
  const amountMatch = text.match(/\$[\d,]+/);
  return amountMatch ? amountMatch[0] : 'Not specified';
}

function extractDuration(text) {
  const durationMatch = text.match(/(\d+)\s*(year|month)s?/i);
  return durationMatch ? `${durationMatch[1]} ${durationMatch[2]}s` : 'Not specified';
}

function extractKeywords(text) {
  const commonWords = [
    'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
    'this', 'that', 'these', 'those', 'from', 'will', 'would', 'could', 'should',
    'have', 'been', 'were', 'also', 'more', 'most', 'some', 'such', 'than', 'them',
    'then', 'they', 'their', 'there', 'what', 'when', 'which', 'while', 'each',
    'into', 'other', 'about', 'over', 'after', 'between', 'through', 'both', 'same',
    'only', 'used', 'using', 'based', 'can', 'may', 'our', 'all', 'are', 'was',
    'not', 'has', 'its', 'does', 'how', 'who', 'any', 'well', 'very', 'many',
    'much', 'just', 'like', 'make', 'made', 'being', 'here', 'where', 'under',
  ];
  const words = text.toLowerCase().match(/\b[a-z]{4,}\b/g) || [];
  const wordCount = {};
  
  words.forEach(word => {
    if (!commonWords.includes(word)) {
      wordCount[word] = (wordCount[word] || 0) + 1;
    }
  });
  
  return Object.entries(wordCount)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 10)
    .map(([word]) => word);
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb', // Only for JSON payload with blob URLs
    },
    responseLimit: false,
    externalResolver: true,
  },
  maxDuration: 300, // 5 minutes timeout for large files
};
