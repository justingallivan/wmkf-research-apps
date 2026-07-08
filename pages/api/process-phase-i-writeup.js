// SUNSET S344 (2026-07-08): backs the sunset-candidate app `phase-i-writeup`
// (PDF-upload, no longer used in current format). Route is intentionally LEFT
// ROUTABLE; code retained as the direct reference for the planned Dataverse-native
// Phase I writeup feature in the Request Workbench (unbuilt). Do not add new
// callers. See APP_LIFECYCLE_REGISTRY + docs/PROMPT_LEGACY_AUDIT.md.
import pdf from 'pdf-parse';
import { BASE_CONFIG, getModelForApp, loadModelOverrides } from '../../shared/config';
import { createPhaseIWriteupPrompt } from '../../shared/config/prompts/phase-i-writeup';
import { createStructuredDataExtractionPrompt } from '../../shared/config/prompts/proposal-summarizer';
import { requireAppAccess } from '../../lib/utils/auth';
import { LLMClient } from '../../lib/services/llm-client';
import { nextRateLimiter } from '../../shared/api/middleware/rateLimiter';
import { safeFetch } from '../../lib/utils/safe-fetch';
import {
  DATA_CLASSES,
  PHASE_I_WRITEUP_PROPOSAL_MAX_CHARS,
  wrapUntrustedContent,
} from '../../lib/utils/ai-payload-boundary';
import { validateAiJson } from '../../lib/utils/ai-output-schema';
import { PROPOSAL_EXTRACTION_SCHEMA } from '../../shared/config/proposal-extraction-output-schema';

const limiter = nextRateLimiter({ max: 10 });

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Require authentication + app access
  const access = await requireAppAccess(req, res, 'phase-i-writeup');
  if (!access) return;

  const allowed = await limiter(req, res);
  if (allowed !== true) return;

  await loadModelOverrides();

  try {
    const { files } = req.body;
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

        // Extract institution name from filename (optional)
        const institution = extractInstitutionFromFilename(file.filename);

        // Generate Phase I writeup using Claude API
        console.log(`Sending to Claude API with text length: ${text.length}`);
        const sendUpdate = (data) => {
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        };
        const writeup = await generatePhaseIWriteup(text, file.filename, institution, apiKey, userProfileId, sendUpdate);
        console.log(`Received writeup:`, writeup ? 'Success' : 'Failed');
        results[file.filename] = writeup;

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

async function generatePhaseIWriteup(text, filename, institution, apiKey, userProfileId, sendUpdate = () => {}) {
  try {
    const writeupPayload = wrapUntrustedContent({
      text,
      source: 'phase-i-writeup.writeup.proposalText',
      dataClass: DATA_CLASSES.PROPOSAL_TEXT,
      maxChars: PHASE_I_WRITEUP_PROPOSAL_MAX_CHARS,
      label: 'research proposal',
    });
    sendUpdate({
      type: 'payload_boundary',
      filename,
      message: writeupPayload.metadata.truncated
        ? `Proposal text truncated to ${writeupPayload.metadata.transmittedChars.toLocaleString()} characters before AI writeup`
        : `Proposal text bounded at ${writeupPayload.metadata.transmittedChars.toLocaleString()} characters before AI writeup`,
      aiPayloadBoundary: writeupPayload.metadata,
    });
    const prompt = createPhaseIWriteupPrompt(writeupPayload.text, institution, [writeupPayload.nonce]);

    const claude = new LLMClient({
      apiKey,
      model: getModelForApp('phase-i-writeup'),
      appName: 'phase-i-writeup',
      userProfileId,
    });
    const { text: writeupText } = await claude.complete({
      messages: [{ role: 'user', content: prompt }],
      maxTokens: BASE_CONFIG.MODEL_PARAMS.DEFAULT_MAX_TOKENS,
      temperature: BASE_CONFIG.MODEL_PARAMS.SUMMARIZATION_TEMPERATURE,
    });

    // Create formatted markdown version
    const formatted = enhanceFormatting(writeupText, filename);

    // Extract structured data (basic info only)
    const structured = await extractStructuredData(text, filename, writeupText, apiKey, userProfileId);

    return {
      formatted,
      structured
    };

  } catch (error) {
    console.error('Writeup generation error:', error);
    throw new Error('Failed to generate writeup');
  }
}

async function extractStructuredData(text, filename, writeup, apiKey, userProfileId) {
  try {
    const extractionPayload = wrapUntrustedContent({
      text,
      source: 'phase-i-writeup.extraction.proposalText',
      dataClass: DATA_CLASSES.PROPOSAL_TEXT,
      maxChars: PHASE_I_WRITEUP_PROPOSAL_MAX_CHARS,
      label: 'research proposal',
    });
    const extractionPrompt = createStructuredDataExtractionPrompt(
      extractionPayload.text,
      filename,
      [extractionPayload.nonce],
    );

    const claude = new LLMClient({
      apiKey,
      model: getModelForApp('phase-i-writeup'),
      appName: 'phase-i-writeup',
      userProfileId,
    });
    const { text: jsonText } = await claude.complete({
      messages: [{ role: 'user', content: extractionPrompt }],
      maxTokens: 1000,
      temperature: 0.2,
    });

    // Parse + validate against the per-app schema (A7 Part 5). Undeclared keys
    // an injected model might add are dropped; bad types fail validation. A
    // failure here is non-fatal — structured data is supplementary, so fall
    // back to an empty object rather than failing the whole writeup.
    try {
      const parsed = JSON.parse(jsonText);
      const validated = validateAiJson(parsed, PROPOSAL_EXTRACTION_SCHEMA);
      if (!validated.ok) {
        console.error(
          'Structured data failed schema validation:',
          validated.errors.join('; '),
        );
        return {};
      }
      return validated.value;
    } catch (parseError) {
      console.error('Failed to parse structured data JSON');
      return {};
    }

  } catch (error) {
    console.error('Structured data extraction error:', error);
    return {};
  }
}

function enhanceFormatting(text, filename) {
  const date = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  let formatted = '';
  formatted += `# Phase I Writeup: ${filename.replace('.pdf', '')}\n\n`;
  formatted += `Generated: ${date}\n\n`;
  formatted += `---\n\n`;
  formatted += text;

  return formatted;
}

function extractInstitutionFromFilename(filename) {
  // Try to extract institution name from filename
  // Common patterns: "Institution_PI_Project.pdf" or "PI_Institution.pdf"

  // Remove .pdf extension
  const nameWithoutExt = filename.replace('.pdf', '');
  // Common university/institution patterns
  const institutionPatterns = [
    /\b(University of [A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/i,  // University of X (Y Z...)
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+University)\b/i,  // X (Y Z...) University
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+Institute of Technology)\b/i,  // X (Y...) Institute of Technology
    /\b(MIT|Caltech|Stanford|Harvard|Yale|Princeton)\b/i,  // Known abbreviations
    /\b([A-Z]{2,})\b/i // Generic acronyms like UCLA, UCSF, etc.
  ];

  for (let i = 0; i < institutionPatterns.length; i++) {
    const pattern = institutionPatterns[i];
    const match = nameWithoutExt.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return ''; // Return empty string if no institution found
}

function createErrorResult(filename, errorMessage) {
  return {
    formatted: `# Error Processing ${filename}\n\n${errorMessage}`,
    structured: {
      error: errorMessage,
      filename
    }
  };
}
