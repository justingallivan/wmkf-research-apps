import { LLMClient } from '../../lib/services/llm-client';
import { createFileProcessor } from '../../shared/api/handlers/fileProcessor';
import { nextRateLimiter } from '../../shared/api/middleware/rateLimiter';
import { BASE_CONFIG } from '../../shared/config/baseConfig';
import { requireAppAccess } from '../../lib/utils/auth';
import { readUploadedBlobBuffer } from '../../lib/utils/uploaded-blob';
import { DATA_CLASSES, wrapUntrustedContent } from '../../lib/utils/ai-payload-boundary';
import { validateAiJson } from '../../lib/utils/ai-output-schema';
import { EXPENSE_EXTRACTION_SCHEMA } from '../../shared/config/expense-extraction-output-schema';
import {
  EXPENSE_EXTRACT_DOCUMENT_ROW,
  EXPENSE_EXTRACT_IMAGE_ROW,
  buildExpenseDocumentVariables,
  buildExpenseImageVariables,
} from '../../shared/config/prompts/expense-reporter-dynamics';
import { resolveToolPrompt, toolPromptUnavailable } from '../../lib/services/tool-prompt-resolver';
import { composeToolPromptPair } from '../../lib/services/tool-prompt-composer';

// Cap for the PDF-path document text wrapped before the model call.
const EXPENSE_DOC_MAX_CHARS = 60_000;

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb', // For JSON payload with blob URLs
    },
  },
};

// Create rate limiter for this endpoint
const rateLimiter = nextRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
});

export default async function handler(req, res) {
  console.log('Process Expenses API called:', new Date().toISOString());

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Require authentication + app access.
  //
  // Access scope for uploaded receipts (Phase 1 private blobs): STAFF-SHARED,
  // app-scoped. Any user with `expense-reporter` access can submit a private
  // blob `pathname` here and have it read, including one uploaded by another
  // staff member — this route does NOT bind a pathname to its uploader. This
  // matches the shared-staff model documented in
  // `pages/api/review-manager/download-review.js` and is a strict improvement
  // over the previous public-blob posture (which required no auth at all). If a
  // future policy needs per-uploader isolation for receipts, prefix the upload
  // pathname with the uploader's profile id and verify it against
  // `access.profileId` here before reading.
  const access = await requireAppAccess(req, res, 'expense-reporter');
  if (!access) return;

  // Apply rate limiting
  const rateLimitResult = await rateLimiter(req, res);
  if (!rateLimitResult) {
    console.log('Rate limit exceeded');
    return;
  }

  // Declared outside the try so the catch can report an error after headers are sent.
  const sendError = (error, code) => {
    res.write(`data: ${JSON.stringify({
      type: 'error',
      error,
      ...(code ? { code } : {}),
      timestamp: new Date().toISOString()
    })}\n\n`);
  };

  try {
    const { files } = req.body;

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files provided' });
    }

    console.log(`Processing ${files.length} files`);

    // Use server-side API key
    const apiKey = process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Server API key not configured' });
    }

    const userProfileId = access.profileId;

    // Resolve both prompt rows once per request, before streaming starts, so a
    // missing/ambiguous row is a plain 503 JSON instead of per-file error results.
    const documentRow = await resolveToolPrompt(EXPENSE_EXTRACT_DOCUMENT_ROW.promptName, EXPENSE_EXTRACT_DOCUMENT_ROW);
    const imageRow = await resolveToolPrompt(EXPENSE_EXTRACT_IMAGE_ROW.promptName, EXPENSE_EXTRACT_IMAGE_ROW);

    // Request shape matches today's: the composed body is the user text; a system
    // prompt is sent only if an /admin edit made one non-empty.
    const compose = (row, { variables, nonces }) =>
      composeToolPromptPair({ systemPrompt: row.systemPrompt, body: row.body }, variables, { nonces });
    const systemOf = (composed) => (composed.systemPrompt ? { system: composed.systemPrompt } : {});

    // Set up streaming response
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    });

    // Helper functions for streaming
    const sendProgress = (message) => {
      res.write(`data: ${JSON.stringify({
        type: 'progress',
        message,
        timestamp: new Date().toISOString()
      })}\n\n`);
    };

    const sendData = (data) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // LLMClient binds the model at construction; the two rows may name different models.
    const clientFor = (row) => new LLMClient({
      apiKey,
      model: row.model,
      appName: 'expense-reporter',
      userProfileId,
    });
    const documentClient = clientFor(documentRow);
    const imageClient = clientFor(imageRow);
    const fileProcessor = createFileProcessor();

    const inputFiles = [...files];
    const expenses = new Array(inputFiles.length);
    // Keep PDF parsing serial; downloads and model calls may overlap.
    let parseTail = Promise.resolve();

    const processReceipt = async (file, index) => {
      const progressMessage = `Processing file ${index + 1}/${files.length}: ${file.filename}`;
      sendProgress(progressMessage);

      try {
        const fileExt = file.filename.toLowerCase().split('.').pop();
        const isImage = ['png', 'jpg', 'jpeg'].includes(fileExt);

        if (isImage) {
          // For images, we'll send them directly to Claude's vision API
          sendProgress(`Analyzing image: ${file.filename}`);

          // Read the receipt image server-side: private blob by pathname (no
          // auth-free URL) or legacy public URL. See lib/utils/uploaded-blob.js.
          const imageBuffer = await readUploadedBlobBuffer(file);
          const base64Image = imageBuffer.toString('base64');

          const composed = compose(imageRow, buildExpenseImageVariables({ fileName: file.filename }));

          // Create a message with image for Claude's vision API
          const messages = [{
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: `image/${fileExt === 'jpg' ? 'jpeg' : fileExt}`,
                  data: base64Image
                }
              },
              {
                type: 'text',
                text: composed.body
              }
            ]
          }];

          // Send to Claude with vision capabilities
          const { text: response } = await imageClient.complete({
            ...systemOf(composed),
            messages,
            maxTokens: imageRow.maxTokens,
            temperature: 0.2,
          });

          // Parse the JSON response
          try {
            // Clean up the response to handle markdown code blocks
            let cleanResponse = response.trim();

            // Remove markdown code block markers if present
            if (cleanResponse.startsWith('```json') || cleanResponse.startsWith('```')) {
              cleanResponse = cleanResponse.replace(/^```(?:json)?\s*/, '');
              cleanResponse = cleanResponse.replace(/```\s*$/, '');
            }

            // Try to extract JSON from the response
            const jsonMatch = cleanResponse.match(/\{[\s\S]*?\}/);
            if (jsonMatch) {
              cleanResponse = jsonMatch[0];
            }

            const parsed = JSON.parse(cleanResponse);
            // Validate against the per-app schema (A7 Part 5) — drop any keys
            // an injected model added. On a type mismatch, fall back to the
            // raw parse (staff-facing display; validation is best-effort here).
            const validated = validateAiJson(parsed, EXPENSE_EXTRACTION_SCHEMA);
            if (!validated.ok) {
              console.warn('Expense data failed schema validation:', validated.errors.join('; '));
            }
            const expenseData = validated.ok ? validated.value : parsed;
            expenses[index] = {
              ...expenseData,
              sourceFile: file.filename
            };
          } catch (parseError) {
            console.error('Failed to parse expense data:', parseError);
            console.error('Raw response:', response);
            expenses[index] = {
              date: null,
              vendor: 'Parse Error',
              description: `Failed to extract data from ${file.filename}`,
              amount: null,
              category: 'Error',
              sourceFile: file.filename,
              confidence: 'low',
              notes: `Parse error: ${parseError.message}`
            };
          }

        } else {
          // For PDFs, use existing file processor
          sendProgress(`Extracting text from PDF: ${file.filename}`);

          const fileBuffer = await readUploadedBlobBuffer(file);
          const parsing = parseTail.then(() => fileProcessor.processFile(fileBuffer, file.filename));
          parseTail = parsing.catch(() => {});
          const { text } = await parsing;

          if (!text || text.trim().length < 5) {
            expenses[index] = {
              date: null,
              vendor: 'Extraction Error',
              description: `No text found in ${file.filename}`,
              amount: null,
              category: 'Error',
              sourceFile: file.filename,
              confidence: 'low',
              notes: 'Could not extract text from PDF'
            };
            return;
          }

          // Send to Claude for analysis
          const docPayload = wrapUntrustedContent({
            text,
            source: 'process-expenses.documentText',
            dataClass: DATA_CLASSES.STAFF_PROVIDED_CONTEXT,
            maxChars: EXPENSE_DOC_MAX_CHARS,
            label: 'receipt or invoice',
          });
          const composed = compose(documentRow, buildExpenseDocumentVariables({
            wrappedDocumentText: docPayload.text,
            fileName: file.filename,
          }));
          const { text: response } = await documentClient.complete({
            ...systemOf(composed),
            messages: [{ role: 'user', content: composed.body }],
            maxTokens: documentRow.maxTokens,
            temperature: 0.2,
          });

          // Parse the JSON response
          try {
            // Clean up the response to handle markdown code blocks
            let cleanResponse = response.trim();

            // Remove markdown code block markers if present
            if (cleanResponse.startsWith('```json') || cleanResponse.startsWith('```')) {
              cleanResponse = cleanResponse.replace(/^```(?:json)?\s*/, '');
              cleanResponse = cleanResponse.replace(/```\s*$/, '');
            }

            // Try to extract JSON from the response
            const jsonMatch = cleanResponse.match(/\{[\s\S]*?\}/);
            if (jsonMatch) {
              cleanResponse = jsonMatch[0];
            }

            const parsed = JSON.parse(cleanResponse);
            // Validate against the per-app schema (A7 Part 5) — drop any keys
            // an injected model added. On a type mismatch, fall back to the
            // raw parse (staff-facing display; validation is best-effort here).
            const validated = validateAiJson(parsed, EXPENSE_EXTRACTION_SCHEMA);
            if (!validated.ok) {
              console.warn('Expense data failed schema validation:', validated.errors.join('; '));
            }
            const expenseData = validated.ok ? validated.value : parsed;
            expenses[index] = {
              ...expenseData,
              sourceFile: file.filename
            };
          } catch (parseError) {
            console.error('Failed to parse expense data:', parseError);
            console.error('Raw response:', response);
            expenses[index] = {
              date: null,
              vendor: 'Parse Error',
              description: `Failed to extract structured data from ${file.filename}`,
              amount: null,
              category: 'Error',
              sourceFile: file.filename,
              confidence: 'low',
              notes: `Parse error: ${parseError.message}`
            };
          }
        }

      } catch (fileError) {
        console.error(`Error processing file ${file.filename}:`, fileError);
        expenses[index] = {
          date: null,
          vendor: 'Processing Error',
          description: `Error processing ${file.filename}`,
          amount: null,
          category: 'Error',
          sourceFile: file.filename,
          confidence: 'low',
          notes: fileError.message
        };
      }
    };

    let nextIndex = 0;
    let stopped = false;
    const worker = async () => {
      while (!stopped && nextIndex < inputFiles.length) {
        const index = nextIndex++;
        try {
          await processReceipt(inputFiles[index], index);
        } catch (error) {
          stopped = true;
          throw error;
        }
      }
    };
    // Exactly two receipt pipelines. Drain both before ending the stream,
    // including unexpected failures outside the per-file error handling.
    const outcomes = await Promise.allSettled([worker(), worker()]);
    const failed = outcomes.find(outcome => outcome.status === 'rejected');
    if (failed) throw failed.reason;

    // Sort expenses by date
    expenses.sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return new Date(a.date) - new Date(b.date);
    });

    // Calculate summary statistics
    const summary = `Processed ${files.length} file(s). Extracted ${expenses.filter(e => e.confidence !== 'low').length} valid expense(s). ${expenses.filter(e => e.confidence === 'low').length} file(s) had processing issues.`;

    // Send final results
    sendData({
      type: 'result',
      expenses,
      summary,
      processedFiles: files.length,
      timestamp: new Date().toISOString()
    });

    res.write('data: [DONE]\n\n');
    res.end();

  } catch (error) {
    console.error('Processing error:', error);
    const unavailable = toolPromptUnavailable(error);

    if (!res.headersSent) {
      // Failed before streaming started (e.g. prompt row unavailable): plain JSON.
      if (unavailable) return res.status(503).json(unavailable);
      return res.status(500).json({
        error: BASE_CONFIG.ERROR_MESSAGES.PROCESSING_FAILED,
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
        timestamp: new Date().toISOString()
      });
    } else {
      sendError(unavailable ? unavailable.error : BASE_CONFIG.ERROR_MESSAGES.PROCESSING_FAILED, unavailable?.code);
      res.end();
    }
  }
}