// SUNSET S344 (2026-07-08): backs the sunset-candidate app `batch-phase-i-summaries`
// (PDF-upload, no longer used in current format). Route is intentionally LEFT
// ROUTABLE; code retained as the reference for a planned Dataverse-native
// migration. Do not add new callers. See APP_LIFECYCLE_REGISTRY + docs/PROMPT_LEGACY_AUDIT.md.
import pdf from 'pdf-parse';
import { BASE_CONFIG, KECK_GUIDELINES, getModelForApp, loadModelOverrides } from '../../shared/config';
import { createPhaseISummarizationPrompt } from '../../shared/config/prompts/phase-i-summaries';
import { createStructuredDataExtractionPrompt } from '../../shared/config/prompts/proposal-summarizer';
import { requireAppAccess } from '../../lib/utils/auth';
import { LLMClient } from '../../lib/services/llm-client';
import { nextRateLimiter } from '../../shared/api/middleware/rateLimiter';
import { safeFetch } from '../../lib/utils/safe-fetch';
import {
  DATA_CLASSES,
  BATCH_PHASE_I_PROPOSAL_MAX_CHARS,
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
  const access = await requireAppAccess(req, res, 'batch-phase-i-summaries');
  if (!access) return;

  const allowed = await limiter(req, res);
  if (allowed !== true) return;

  await loadModelOverrides();

  try {
    const { files, summaryLength = 2, summaryLevel = 'technical-non-expert' } = req.body;
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

        // Parse cover page metadata
        const coverData = parseCoverPage(text);
        console.log(`Cover page: institution=${coverData.institution}, PI=${coverData.projectLeader}, title=${coverData.projectTitle?.substring(0, 50)}`);

        // Generate summary using Claude API with Phase I prompt
        console.log(`Sending to Claude API with text length: ${text.length}`);
        const sendUpdate = (data) => {
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        };
        const summary = await generatePhaseISummary(text, file.filename, apiKey, summaryLength, summaryLevel, userProfileId, coverData, sendUpdate);
        console.log(`Received summary:`, summary ? 'Success' : 'Failed');
        results[file.filename] = summary;

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

async function generatePhaseISummary(text, filename, apiKey, summaryLength, summaryLevel, userProfileId, coverData, sendUpdate = () => {}) {
  try {
    const summaryPayload = wrapUntrustedContent({
      text,
      source: 'batch-phase-i.summary.proposalText',
      dataClass: DATA_CLASSES.PROPOSAL_TEXT,
      maxChars: BATCH_PHASE_I_PROPOSAL_MAX_CHARS,
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
    // Use Phase I specific prompt
    const prompt = createPhaseISummarizationPrompt(
      summaryPayload.text,
      summaryLength,
      summaryLevel,
      KECK_GUIDELINES,
      [summaryPayload.nonce],
    );

    const claude = new LLMClient({
      apiKey,
      model: getModelForApp('batch-phase-i'),
      appName: 'batch-phase-i',
      userProfileId,
    });
    const { text: summaryText } = await claude.complete({
      messages: [{ role: 'user', content: prompt }],
      maxTokens: BASE_CONFIG.MODEL_PARAMS.DEFAULT_MAX_TOKENS,
      temperature: BASE_CONFIG.MODEL_PARAMS.SUMMARIZATION_TEMPERATURE,
    });

    // Create formatted markdown version for Phase I
    const formatted = enhancePhaseIFormatting(summaryText, filename, coverData);

    // Extract structured data — supplement with cover page data
    const structured = await extractStructuredData(text, filename, summaryText, apiKey, userProfileId);
    if (coverData.institution) structured.institution = coverData.institution;
    if (coverData.projectLeader) structured.principal_investigator = coverData.projectLeader;
    if (coverData.projectTitle) structured.project_title = coverData.projectTitle;
    if (coverData.amountRequested) structured.funding_amount = coverData.amountRequested;
    if (coverData.projectPeriod) structured.duration = coverData.projectPeriod;

    return {
      formatted,
      structured
    };

  } catch (error) {
    console.error('Summary generation error:', error);
    throw new Error('Failed to generate summary');
  }
}

async function extractStructuredData(text, filename, summary, apiKey, userProfileId) {
  try {
    const extractionPayload = wrapUntrustedContent({
      text,
      source: 'batch-phase-i.extraction.proposalText',
      dataClass: DATA_CLASSES.PROPOSAL_TEXT,
      maxChars: BATCH_PHASE_I_PROPOSAL_MAX_CHARS,
      label: 'research proposal',
    });
    const extractionPrompt = createStructuredDataExtractionPrompt(
      extractionPayload.text,
      filename,
      [extractionPayload.nonce],
    );

    const claude = new LLMClient({
      apiKey,
      model: getModelForApp('batch-phase-i'),
      appName: 'batch-phase-i',
      userProfileId,
    });
    const { text: jsonText } = await claude.complete({
      messages: [{ role: 'user', content: extractionPrompt }],
      maxTokens: 1000,
      temperature: 0.1,
    });

    if (jsonText) {
      try {
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
        console.warn('Failed to parse structured data, using fallback');
      }
    }
  } catch (error) {
    console.warn('Structured data extraction failed, using fallback:', error.message);
  }

  // Fallback to basic extraction if AI fails
  return createStructuredDataFallback(text, filename);
}

function enhancePhaseIFormatting(summary, filename, coverData = {}) {
  const institution = coverData.institution || extractInstitutionFromFilename(filename) || 'Research Institution';
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long' });

  let formatted = `# ${institution}\n`;
  formatted += `Phase I Review: ${date}\n\n`;
  formatted += `**Filename:** ${filename}\n`;
  formatted += `**Date Processed:** ${new Date().toLocaleDateString()}\n\n`;

  // Project title and metadata line (mirrors Phase II format)
  if (coverData.projectTitle) {
    formatted += `## ${coverData.projectTitle}\n`;
    const metaParts = [institution];
    if (coverData.amountRequested) metaParts.push(`Requested Amount: ${coverData.amountRequested}`);
    if (coverData.projectPeriod) metaParts.push(`Project Period: ${coverData.projectPeriod}`);
    formatted += `**${metaParts.join(' | ')}**\n\n`;
  }

  if (coverData.projectLeader) {
    formatted += `**Project Leader:** ${coverData.projectLeader}\n`;
  }
  if (coverData.coPIs && coverData.coPIs.length > 0) {
    formatted += `**Co-PIs:** ${coverData.coPIs.join(', ')}\n`;
  }
  formatted += '\n';

  // Process the summary — Phase I doesn't use Part markers or --- separators
  let processedSummary = summary
    .replace(/\*\*Executive Summary\*\*/g, '## Executive Summary')
    .replace(/\*\*Background & Impact\*\*/g, '## Background & Impact')
    .replace(/\*\*Methodology\*\*/g, '## Methodology')
    .replace(/\*\*Personnel\*\*/g, '## Personnel')
    .replace(/\*\*Justification for Keck Funding\*\*/g, '## Justification for Keck Funding')
    // Downgrade any H1s in the summary to H2
    .replace(/^# (.+)$/gm, '## $1')
    .replace(/\n{3,}/g, '\n\n');

  return formatted + processedSummary;
}

/**
 * Parse structured metadata from the Phase I cover page.
 * Cover pages follow a consistent "Key  Value" format.
 */
function parseCoverPage(text) {
  const result = {
    institution: null,
    projectTitle: null,
    projectLeader: null,
    amountRequested: null,
    projectPeriod: null,
    coPIs: [],
  };

  // Institution
  const instMatch = text.match(/Applicant Institution\s+(.+?)(?:\s{2,}|\n)/);
  if (instMatch) result.institution = instMatch[1].trim();

  // Project title (may span multiple lines before the next field)
  const titleMatch = text.match(/Project Title\s+(.+?)(?=\nProject Time Period|\nAmount Requested)/s);
  if (titleMatch) result.projectTitle = titleMatch[1].replace(/\s+/g, ' ').trim();

  // Amount
  const amountMatch = text.match(/Amount Requested\s+(\$[\d,]+)/);
  if (amountMatch) result.amountRequested = amountMatch[1].trim();

  // Project period
  const periodMatch = text.match(/Project Time Period\s+(?:from\s+)?(\d{4}[-/]\d{2}[-/]\d{2})\s+to\s+(\d{4}[-/]\d{2}[-/]\d{2})/);
  if (periodMatch) {
    const startYear = periodMatch[1].substring(0, 4);
    const endYear = periodMatch[2].substring(0, 4);
    result.projectPeriod = `${startYear}–${endYear}`;
  }

  // Project Leader — look for "Project Leader" section, then grab the name on the next line
  const leaderMatch = text.match(/Project Leader\s*\n\s*(?:Dr\.?\s+)?([A-Z][a-zA-Z'-]+\s[A-Z][a-zA-Z'-]+)/);
  if (leaderMatch) result.projectLeader = leaderMatch[1].trim();

  // Co-PIs — listed as "Dr. Firstname Lastname email" lines after the header.
  // Stop at the next section (e.g., "Project Summary", "PROJECT SUMMARY", blank-line runs).
  const copiSection = text.match(/Co-Principal Investigators\s*\n([\s\S]*?)(?=\n\s*(?:Project Summary|PROJECT SUMMARY|PART\s|Budget|Key Personnel)\b|\n\n\n)/);
  if (copiSection) {
    // Only match "Dr. Name Name" patterns (the standard cover page format)
    const nameMatches = copiSection[1].matchAll(/Dr\.?\s+([A-Z][a-zA-Z'-]+)\s+([A-Z][a-zA-Z'-]+)/g);
    for (const m of nameMatches) {
      const name = `${m[1].trim()} ${m[2].trim()}`;
      if (name !== result.projectLeader) {
        result.coPIs.push(name);
      }
    }
  }

  return result;
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
    },
    metadata: {
      error: true,
      errorMessage
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
    .replace(/_SE_Phase_I_Staff_Version$/, '')
    .replace(/_Phase_I.*$/, '')
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
  const commonWords = ['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by'];
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
