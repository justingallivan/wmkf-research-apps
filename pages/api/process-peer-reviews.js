// S344: prompt text is sourced from the peer-review-summarizer.analyze/.questions
// wmkf_ai_prompt rows via the shared Executor (executePrompt) so staff /admin
// edits take effect. The legacy generators in shared/config/prompts/peer-reviewer.js
// remain exported for rollback (git revert this route). Per-review A7 wrapping +
// the preamble stay route-owned (Executor receives already-wrapped reviews_block +
// the preamble as a7_preamble). See docs/PEER_REVIEW_EXECUTOR_MIGRATION_PLAN.md.
import pdf from 'pdf-parse';
import mammoth from 'mammoth';
import { BASE_CONFIG, loadModelOverrides } from '../../shared/config';
import { requireAppAccess } from '../../lib/utils/auth';
import { executePrompt } from '../../lib/services/execute-prompt';
import { logUsage } from '../../lib/utils/usage-logger';
import { nextRateLimiter } from '../../shared/api/middleware/rateLimiter';
import { safeFetch } from '../../lib/utils/safe-fetch';
import {
  DATA_CLASSES,
  PEER_REVIEW_TEXT_MAX_CHARS,
  wrapUntrustedContent,
  buildUntrustedContentPreamble,
} from '../../lib/utils/ai-payload-boundary';

const limiter = nextRateLimiter({ max: 5 });

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Require authentication + app access
  const access = await requireAppAccess(req, res, 'peer-review-summarizer');
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
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');


    const reviewTexts = [];
    
    // Process each file and extract text
    for (let i = 0; i < files.length; i++) {
      const fileInfo = files[i];
      const progress = Math.round((i / files.length) * 50); // First 50% for file processing
      
      // Send progress update
      res.write(`data: ${JSON.stringify({
        progress,
        message: `Extracting text from ${fileInfo.filename}...`
      })}\n\n`);

      try {
        let buffer;
        
        // Handle both base64 content and URLs
        if (fileInfo.content) {
          // File content is provided as base64
          buffer = Buffer.from(fileInfo.content, 'base64');
        } else if (fileInfo.url) {
          // File is provided as URL (Vercel Blob)
          const response = await safeFetch(fileInfo.url);
          if (!response.ok) {
            throw new Error(`Failed to fetch file: ${response.status}`);
          }
          const arrayBuffer = await response.arrayBuffer();
          buffer = Buffer.from(arrayBuffer);
        } else {
          throw new Error('No file content or URL provided');
        }
        
        let text = '';

        // Extract text based on file type
        if (fileInfo.filename.toLowerCase().endsWith('.pdf')) {
          try {
            const pdfData = await pdf(buffer);
            text = pdfData.text;
            console.log(`Extracted ${text.length} characters from PDF: ${fileInfo.filename}`);
          } catch (pdfError) {
            console.error(`PDF parsing error for ${fileInfo.filename}:`, pdfError);
            throw new Error(`Failed to parse PDF: ${pdfError.message}`);
          }
        } else if (fileInfo.filename.toLowerCase().endsWith('.docx')) {
          try {
            const result = await mammoth.extractRawText({ buffer });
            text = result.value;
            console.log(`Extracted ${text.length} characters from DOCX: ${fileInfo.filename}`);
          } catch (docxError) {
            console.error(`DOCX parsing error for ${fileInfo.filename}:`, docxError);
            throw new Error(`Failed to parse DOCX: ${docxError.message}`);
          }
        } else if (fileInfo.filename.toLowerCase().endsWith('.doc')) {
          // For older .doc files, mammoth might work but with limitations
          try {
            const result = await mammoth.extractRawText({ buffer });
            text = result.value;
            console.log(`Extracted ${text.length} characters from DOC: ${fileInfo.filename}`);
          } catch (docError) {
            throw new Error('Unable to process .doc file - please convert to .docx or PDF format');
          }
        } else {
          throw new Error(`Unsupported file type. Please use PDF, DOCX, or DOC files.`);
        }

        // More lenient text validation
        if (!text || text.trim().length < 10) {
          console.warn(`File ${fileInfo.filename} has very little text (${text.trim().length} chars)`);
          throw new Error('Document appears to be empty or contains insufficient text');
        }

        reviewTexts.push({
          filename: fileInfo.filename,
          text: text.trim()
        });
        
        console.log(`Successfully processed ${fileInfo.filename}: ${text.trim().length} characters`);

      } catch (fileError) {
        console.error(`Error processing ${fileInfo.filename}:`, fileError);
        // Continue processing other files even if one fails
        reviewTexts.push({
          filename: fileInfo.filename,
          text: `Error processing ${fileInfo.filename}: ${fileError.message}`,
          error: true
        });
      }
    }

    // Send progress update for analysis phase
    res.write(`data: ${JSON.stringify({
      progress: 60,
      message: 'Analyzing peer reviews with Claude AI...'
    })}\n\n`);

    // Generate comprehensive analysis
    const analysisResult = await analyzePeerReviews(reviewTexts, userProfileId);

    // Log the results for debugging
    console.log('Analysis completed, summary length:', analysisResult?.summary?.length || 0);
    console.log('Questions length:', analysisResult?.questions?.length || 0);

    // Send final results
    res.write(`data: ${JSON.stringify({
      progress: 100,
      message: 'Peer review analysis complete!',
      results: analysisResult
    })}\n\n`);

    res.end();

  } catch (error) {
    console.error('API error:', error);
    // Try to send error via SSE if headers were already sent
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({
        progress: 100,
        message: 'An error occurred during processing',
        results: {
          formatted: `### Processing Error\n\n${BASE_CONFIG.ERROR_MESSAGES.PROCESSING_FAILED}`,
          structured: {
            questions: ''
          },
          metadata: {
            error: true,
            errorMessage: process.env.NODE_ENV === 'development' ? error.message : BASE_CONFIG.ERROR_MESSAGES.PROCESSING_FAILED
          }
        }
      })}\n\n`);
      res.end();
    } else {
      res.status(500).json({
        error: BASE_CONFIG.ERROR_MESSAGES.PROCESSING_FAILED,
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
        timestamp: new Date().toISOString()
      });
    }
  }
}

// Fail-closed A7 guard: the Executor does NOT auto-wrap reviews_block (it's
// passed already-wrapped), so the route MUST supply a preamble covering every
// per-review nonce. Throw rather than send review content with no hardening.
function assertPreambleCoversNonces(preamble, nonces) {
  if (!preamble || !preamble.trim()) {
    throw new Error('A7 preamble empty — refusing to send unwrapped review content to the model');
  }
  for (const nonce of nonces) {
    if (!preamble.includes(nonce)) {
      throw new Error(`A7 preamble is missing review nonce ${nonce} — refusing to send`);
    }
  }
}

// Mirror the appName-based usage logging the route got for free from LLMClient
// before the Executor migration; executePrompt's internal client passes no
// appName, so api_usage_log would otherwise lose this app. (Executor also writes
// a wmkf_ai_run row per call.)
function logPeerReviewUsage(result, userProfileId) {
  logUsage({
    userProfileId,
    appName: 'peer-review-summarizer',
    model: result?.meta?.modelUsed,
    inputTokens: result?.usage?.input_tokens || 0,
    outputTokens: result?.usage?.output_tokens || 0,
    cacheCreationTokens: result?.usage?.cache_creation_input_tokens || 0,
    cacheReadTokens: result?.usage?.cache_read_input_tokens || 0,
    latencyMs: 0,
    status: 'success',
  });
}

async function analyzePeerReviews(reviewTexts, userProfileId) {
  try {
    console.log('Starting analysis with', reviewTexts.length, 'review texts');
    
    // Filter out error entries and extract just the text
    const validTexts = reviewTexts
      .filter(review => !review.error && review.text && review.text.length > 10)
      .map(review => review.text);

    console.log('Valid texts after filtering:', validTexts.length);
    
    if (validTexts.length === 0) {
      // Provide detailed error information
      const errorDetails = reviewTexts.map(r => 
        `${r.filename}: ${r.error ? 'Error - ' + r.text : 'Text length: ' + (r.text ? r.text.length : 0)}`
      ).join('\n');
      
      console.error('No valid texts found. Details:', errorDetails);
      throw new Error(`No valid review texts to analyze. All files either failed to process or contained no extractable text.\n\nFile details:\n${errorDetails}`);
    }

    // A7 Part 4: each review is reviewer-submitted (untrusted) and was not
    // length-bounded before. Wrap every review in nonce sentinels and prepend
    // the hardening preamble so injection text in a review body cannot hijack
    // the analysis. The wrapped blocks (not raw text) go to the builders.
    const wrappedReviews = validTexts.map((text, i) =>
      wrapUntrustedContent({
        text,
        source: `peer-reviews.analyze.review-${i + 1}`,
        dataClass: DATA_CLASSES.REVIEW_TEXT,
        maxChars: PEER_REVIEW_TEXT_MAX_CHARS,
        label: `peer review ${i + 1}`,
      }),
    );
    const wrappedTexts = wrappedReviews.map((w) => w.text);
    const reviewNonces = wrappedReviews.map((w) => w.nonce);
    const preamble = buildUntrustedContentPreamble(reviewNonces);

    // Route owns A7: the reviews are wrapped per-review above; the Executor
    // receives the already-wrapped block verbatim (reviews_block) plus the
    // preamble (a7_preamble → interpolated into the row's system prompt).
    const reviewsBlock = wrappedTexts
      .map((t, i) => `**Review ${i + 1}:**\n${t}\n\n---\n`)
      .join('');
    assertPreambleCoversNonces(preamble, reviewNonces);

    // Generate comprehensive analysis via the Executor. Prompt text lives in the
    // peer-review-summarizer.analyze row (staff-editable); parseMode:raw → the
    // model text is returned as parsed.response_text.
    const analyzeResult = await executePrompt({
      promptName: 'peer-review-summarizer.analyze',
      overrideVariables: {
        review_count: String(validTexts.length),
        review_count_suffix: validTexts.length > 1 ? 's' : '',
        reviews_block: reviewsBlock,
        a7_preamble: preamble,
      },
      runSource: 'Vercel Interactive',
      forceOverwrite: true, // outputs are kind:none — no guarded targets, so no-op
      // Fail closed if the row's system prompt no longer interpolates the A7
      // preamble (the nonces live in the preamble): a stale/edited row that
      // dropped {{a7_preamble}} must abort, not send review content unprotected.
      assertSystemIncludes: reviewNonces,
    });
    logPeerReviewUsage(analyzeResult, userProfileId);
    const analysisText = analyzeResult.parsed?.response_text || '';
    console.log('Raw Claude response length:', analysisText.length);
    console.log('First 500 chars:', analysisText.substring(0, 500));

    // More flexible parsing of the analysis
    let summary = analysisText;
    let questions = '';

    // Try to split by various possible markers
    const possibleMarkers = [
      '**OUTPUT 2 - QUESTIONS:**',
      '**OUTPUT 2:**',
      '**QUESTIONS:**',
      '## Questions',
      '# Questions',
      '**Questions:**'
    ];

    for (const marker of possibleMarkers) {
      if (analysisText.includes(marker)) {
        const parts = analysisText.split(marker);
        summary = parts[0]
          .replace('**OUTPUT 1 - SUMMARY:**', '')
          .replace('**OUTPUT 1:**', '')
          .replace('**SUMMARY:**', '')
          .trim();
        
        // Preserve the questions content and add a proper header
        let questionsContent = parts[1]?.trim() || '';
        if (questionsContent) {
          // Clean up any partial headers that might be at the beginning
          const headerFragments = [
            ', Concerns, and Issues Raised by Reviewers',
            'Concerns, and Issues Raised by Reviewers',
            'and Issues Raised by Reviewers',
            'Issues Raised by Reviewers',
            'Raised by Reviewers',
            'by Reviewers',
            'Reviewers',
            'Questions, Concerns',
            'Concerns and Issues',
            '---'
          ];
          
          // Remove any partial headers from the beginning
          for (const fragment of headerFragments) {
            if (questionsContent.startsWith(fragment)) {
              questionsContent = questionsContent.substring(fragment.length).trim();
            }
          }
          
          // Also remove if it starts with a line containing these fragments
          const lines = questionsContent.split('\n');
          if (lines[0] && headerFragments.some(fragment => lines[0].includes(fragment))) {
            questionsContent = lines.slice(1).join('\n').trim();
          }
          
          // Add a proper header to the questions section
          questions = `## Questions and Concerns Raised by Reviewers\n\n${questionsContent}`;
        }
        
        console.log(`Found marker: ${marker}, Questions length: ${questions.length}`);
        break;
      }
    }

    // If we didn't find questions in the main response, or they're too short
    if (!questions || questions.length < 50) {
      console.log('Questions not found or too short, making separate request...');
      try {
        const questionsResult = await executePrompt({
          promptName: 'peer-review-summarizer.questions',
          overrideVariables: {
            review_count: String(validTexts.length),
            reviews_block: reviewsBlock,
            a7_preamble: preamble,
          },
          runSource: 'Vercel Interactive',
          forceOverwrite: true,
          assertSystemIncludes: reviewNonces, // fail closed if row dropped {{a7_preamble}}
        });
        logPeerReviewUsage(questionsResult, userProfileId);
        let questionsContent = (questionsResult.parsed?.response_text || '').trim();
        {

          // Clean up any partial headers that might be at the beginning
          const headerFragments = [
            ', Concerns, and Issues Raised by Reviewers',
            'Concerns, and Issues Raised by Reviewers',
            'and Issues Raised by Reviewers',
            'Issues Raised by Reviewers',
            'Raised by Reviewers',
            'by Reviewers',
            'Reviewers',
            'Questions, Concerns',
            'Concerns and Issues',
            '### Questions',
            '## Questions',
            '# Questions',
            '---'
          ];
          
          // Remove any partial headers from the beginning
          for (const fragment of headerFragments) {
            if (questionsContent.startsWith(fragment)) {
              questionsContent = questionsContent.substring(fragment.length).trim();
            }
          }
          
          // Also remove if it starts with a line containing these fragments
          const lines = questionsContent.split('\n');
          if (lines[0] && headerFragments.some(fragment => lines[0].includes(fragment))) {
            questionsContent = lines.slice(1).join('\n').trim();
          }
          
          // Add proper header to separately fetched questions
          questions = `## Questions and Concerns Raised by Reviewers\n\n${questionsContent}`;
          console.log('Got questions from separate request, length:', questions.length);
        }
      } catch (questionsError) {
        console.warn('Failed to extract questions separately:', questionsError);
        questions = '## Questions and Concerns Raised by Reviewers\n\nNo specific questions could be extracted from the peer reviews. Please review the summary above for the main points raised by reviewers.';
      }
    }

    // Ensure we have some content for both outputs
    if (!summary || summary.trim().length === 0) {
      summary = analysisText; // Fallback to full response
    }
    
    console.log('Final summary length:', summary.length);
    console.log('Final questions length:', questions.length);

    return {
      formatted: summary,
      structured: {
        questions: questions
      },
      metadata: {
        reviewCount: validTexts.length,
        processedFiles: reviewTexts.map(r => r.filename),
        timestamp: new Date().toISOString()
      }
    };

  } catch (error) {
    console.error('Peer review analysis error:', error);
    // Return a fallback result instead of throwing
    return {
      formatted: `### Error During Analysis\n\n${BASE_CONFIG.ERROR_MESSAGES.PROCESSING_FAILED}\n\n### Files Processed\n\n${reviewTexts.map(r => `- ${r.filename}`).join('\n')}\n\nPlease try again or contact support if the issue persists.`,
      structured: {
        questions: '### Unable to Extract Questions\n\nDue to the processing error, questions could not be extracted from the peer reviews.'
      },
      metadata: {
        reviewCount: reviewTexts.length,
        processedFiles: reviewTexts.map(r => r.filename),
        timestamp: new Date().toISOString(),
        error: true,
        errorMessage: process.env.NODE_ENV === 'development' ? error.message : BASE_CONFIG.ERROR_MESSAGES.PROCESSING_FAILED
      }
    };
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '100mb',
    },
    responseLimit: false,
    externalResolver: true,
  },
  maxDuration: 300, // 5 minutes timeout for processing
};