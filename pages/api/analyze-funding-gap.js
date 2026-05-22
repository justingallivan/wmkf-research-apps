import { LLMClient } from '../../lib/services/llm-client';
import { createFileProcessor } from '../../shared/api/handlers/fileProcessor';
import { nextRateLimiter } from '../../shared/api/middleware/rateLimiter';
import { createFundingExtractionPrompt, createFundingAnalysisPrompt } from '../../shared/config/prompts/funding-gap-analyzer';
import { queryNSFforPI, queryNSFforKeywords, queryNIHforPI, queryNIHforKeywords, queryUSASpending, formatCurrency, formatDate } from '../../lib/fundingApis';
import { BASE_CONFIG, getModelForApp } from '../../shared/config/baseConfig';
import { loadModelOverrides } from '../../lib/services/model-override-loader';
import { requireAppAccess } from '../../lib/utils/auth';
import { safeFetch } from '../../lib/utils/safe-fetch';
import {
  DATA_CLASSES,
  FUNDING_GAP_PROPOSAL_MAX_CHARS,
  wrapUntrustedContent,
} from '../../lib/utils/ai-payload-boundary';
import { validateAiJson } from '../../lib/utils/ai-output-schema';
import { FUNDING_EXTRACTION_SCHEMA } from '../../shared/config/funding-extraction-output-schema';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb', // Only for JSON payload with blob URLs
    },
  },
};

// Create rate limiter for this endpoint (more lenient due to external API calls)
const rateLimiter = nextRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 3, // 3 requests per minute (slower due to NSF API queries)
});

export default async function handler(req, res) {
  console.log('Funding Gap Analyzer API called:', new Date().toISOString());

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Require authentication + app access
  const access = await requireAppAccess(req, res, 'funding-gap-analyzer');
  if (!access) return;
  await loadModelOverrides();

  // Apply rate limiting
  const rateLimitResult = await rateLimiter(req, res);
  if (!rateLimitResult) {
    console.log('Rate limit exceeded for request');
    return; // Response already sent by rate limiter
  }

  try {
    const { files, searchYears = 5, includeCoPIs = false, includeUSASpending = false } = req.body;

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files provided' });
    }

    // Use server-side API key
    const apiKey = process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      console.error('CLAUDE_API_KEY environment variable is not set');
      return res.status(500).json({ error: 'Server configuration error: Claude API key not available.' });
    }

    const userProfileId = access.profileId;

    // Set headers for streaming response
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendProgress = (message, progress = null) => {
      const data = { message };
      if (progress !== null) {
        data.progress = progress;
      }
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      console.log('Progress:', message);
    };

    const claudeClient = new LLMClient({
      apiKey,
      model: getModelForApp('funding-analysis'),
      appName: 'funding-analysis',
      userProfileId,
    });
    const fileProcessor = createFileProcessor();

    const allProposals = [];

    // Process each proposal
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const baseProgress = Math.round((i / files.length) * 90);

      sendProgress(`Processing proposal ${i + 1}/${files.length}: ${file.filename}`, baseProgress);

      try {
        // Step 1: Extract text from PDF
        sendProgress(`Extracting text from ${file.filename}...`, baseProgress + 1);
        const fileResponse = await safeFetch(file.url);
        if (!fileResponse.ok) {
          throw new Error(`Failed to fetch file from blob storage: ${fileResponse.statusText}`);
        }

        const fileBuffer = Buffer.from(await fileResponse.arrayBuffer());
        const { text: proposalText, metadata } = await fileProcessor.processFile(
          fileBuffer,
          file.filename || 'proposal.pdf'
        );

        if (!proposalText || proposalText.length < 100) {
          throw new Error('Could not extract sufficient text from the PDF');
        }

        // Step 2: Use Claude to extract PI, institution, keywords
        sendProgress(`Extracting PI information and keywords from ${file.filename}...`, baseProgress + 5);

        const extractionPayload = wrapUntrustedContent({
          text: proposalText,
          source: 'funding-gap.extraction.proposalText',
          dataClass: DATA_CLASSES.PROPOSAL_TEXT,
          maxChars: FUNDING_GAP_PROPOSAL_MAX_CHARS,
          label: 'research proposal',
        });
        const extractionPrompt = createFundingExtractionPrompt(
          extractionPayload.text,
          [extractionPayload.nonce],
        );
        let extractionResponse;

        try {
          ({ text: extractionResponse } = await claudeClient.complete({
            messages: [{ role: 'user', content: extractionPrompt }],
            maxTokens: 1000,
            temperature: 0.3,
          }));
        } catch (claudeError) {
          console.error('Claude API error during extraction:', claudeError);
          throw new Error(`Claude API error: ${claudeError.message}`);
        }

        // Parse the JSON response
        let extraction;
        try {
          // Clean the response - remove markdown code blocks if present
          let cleanedResponse = extractionResponse.trim();
          if (cleanedResponse.startsWith('```json')) {
            cleanedResponse = cleanedResponse.replace(/```json\n?/g, '').replace(/```\n?$/g, '');
          } else if (cleanedResponse.startsWith('```')) {
            cleanedResponse = cleanedResponse.replace(/```\n?/g, '');
          }
          const parsedExtraction = JSON.parse(cleanedResponse);
          // Validate against the per-app schema (A7 Part 6) — drop any keys an
          // injected model added before the values drive federal-API queries.
          const validatedExtraction = validateAiJson(parsedExtraction, FUNDING_EXTRACTION_SCHEMA);
          if (!validatedExtraction.ok) {
            throw new Error(
              `Extraction failed schema validation: ${validatedExtraction.errors.join('; ')}`,
            );
          }
          extraction = validatedExtraction.value;

          if (!extraction.pi || !extraction.institution || !extraction.keywords?.length) {
            throw new Error('Missing required fields in extraction');
          }

          if (!extraction.state) {
            sendProgress(`Warning: State not extracted, NSF results may be less accurate`, baseProgress + 10);
          }

          sendProgress(`Found PI: ${extraction.pi} at ${extraction.institution}${extraction.state ? ` (${extraction.state})` : ''}`, baseProgress + 10);
          sendProgress(`Identified ${extraction.keywords.length} research keywords`, baseProgress + 12);
        } catch (parseError) {
          console.error('Error parsing extraction response:', parseError);
          throw new Error('Failed to extract structured data from proposal. Please ensure the proposal contains PI and institution information.');
        }

        // Step 3: Query NSF for PI's awards (using state for better matching)
        sendProgress(`Querying NSF for ${extraction.pi}'s awards${includeCoPIs ? ' (including Co-PI roles)' : ''} in ${extraction.state || 'all states'}...`, baseProgress + 15);

        // Try full name with all awards (not just active)
        let nsfPIAwards = await queryNSFforPI(extraction.pi, extraction.state, false, includeCoPIs);

        // If no results with full name, try just last name
        if (nsfPIAwards.totalCount === 0 && extraction.pi.includes(' ')) {
          const lastName = extraction.pi.split(' ').pop();
          sendProgress(`Trying last name only: ${lastName}...`, baseProgress + 17);
          nsfPIAwards = await queryNSFforPI(lastName, extraction.state, false, includeCoPIs);
        }

        if (nsfPIAwards.error) {
          sendProgress(`Warning: NSF API error for PI query: ${nsfPIAwards.error}`, baseProgress + 20);
        } else if (nsfPIAwards.totalCount > 0) {
          const roleText = includeCoPIs ? ' (as PI or Co-PI)' : '';
          sendProgress(`Found ${nsfPIAwards.totalCount} NSF award(s)${roleText} (${formatCurrency(nsfPIAwards.totalFunding)} total)`, baseProgress + 20);
        } else {
          sendProgress(`No NSF awards found for ${extraction.pi} in ${extraction.state || 'any state'}`, baseProgress + 20);
        }

        // Step 4: Query NSF for research area keywords
        sendProgress(`Analyzing NSF funding landscape for research keywords...`, baseProgress + 25);

        const nsfKeywordResults = await queryNSFforKeywords(extraction.keywords, searchYears);

        const keywordSummaries = [];
        for (const [keyword, data] of Object.entries(nsfKeywordResults)) {
          if (data.error) {
            keywordSummaries.push(`${keyword}: Error`);
          } else {
            keywordSummaries.push(`${keyword}: ${data.totalCount} awards, ${formatCurrency(data.totalFunding)}`);
          }
        }

        sendProgress(`NSF landscape analysis complete`, baseProgress + 30);

        // Step 5: Query NIH for PI's projects (with institution + keyword filtering)
        sendProgress(`Querying NIH RePORTER for ${extraction.pi}'s projects...`, baseProgress + 35);

        const nihPIProjects = await queryNIHforPI(extraction.pi, searchYears, extraction.institution, extraction.keywords);

        if (nihPIProjects.error) {
          sendProgress(`Warning: NIH API error for PI query: ${nihPIProjects.error}`, baseProgress + 40);
        } else if (nihPIProjects.totalCount > 0) {
          const warningText = nihPIProjects.warnings.length > 0 ? ` (${nihPIProjects.warnings.join('; ')})` : '';
          sendProgress(`Found ${nihPIProjects.totalCount} NIH project(s) (${formatCurrency(nihPIProjects.totalFunding)} total)${warningText}`, baseProgress + 40);

          // Log warnings separately for visibility
          if (nihPIProjects.warnings.length > 0) {
            nihPIProjects.warnings.forEach(warning => {
              console.log(`NIH WARNING for ${extraction.pi}: ${warning}`);
            });
          }
        } else {
          sendProgress(`No NIH projects found for ${extraction.pi}`, baseProgress + 40);
        }

        // Step 6: Query NIH for research area keywords
        sendProgress(`Analyzing NIH funding landscape for research keywords...`, baseProgress + 45);

        const nihKeywordResults = await queryNIHforKeywords(extraction.keywords, searchYears);

        sendProgress(`NIH landscape analysis complete`, baseProgress + 55);

        // Step 7: Query USAspending for institution awards (DOE, DOD, etc.) - OPTIONAL
        let usaSpendingResults;
        if (includeUSASpending) {
          sendProgress(`Querying USAspending.gov for ${extraction.institution} awards...`, baseProgress + 60);

          usaSpendingResults = await queryUSASpending(extraction.institution, searchYears);

          if (usaSpendingResults.error) {
            sendProgress(`Warning: USAspending API error: ${usaSpendingResults.error}`, baseProgress + 65);
          } else if (usaSpendingResults.totalCount > 0) {
            const agencyCount = Object.keys(usaSpendingResults.byAgency).length;
            sendProgress(`Found ${usaSpendingResults.totalCount} award(s) from ${agencyCount} agencies (${formatCurrency(usaSpendingResults.totalFunding)} total)`, baseProgress + 65);
          } else {
            sendProgress(`No USAspending awards found for ${extraction.institution}`, baseProgress + 65);
          }
        } else {
          // USAspending disabled - provide empty results
          usaSpendingResults = {
            awards: [],
            totalCount: 0,
            totalFunding: 0,
            byAgency: {},
            disabled: true
          };
          sendProgress(`USAspending.gov query skipped (disabled in settings)`, baseProgress + 65);
        }

        // Step 8: Generate comprehensive analysis with Claude
        sendProgress(`Generating federal funding gap analysis for ${file.filename}...`, baseProgress + 70);

        // Truncate data to avoid token limits while including all agencies
        const truncatedNSFData = {
          piAwards: {
            awards: nsfPIAwards.awards.slice(0, 10).map(a => ({
              id: a.id,
              title: a.title,
              fundProgramName: a.fundProgramName,
              fundsObligatedAmt: a.fundsObligatedAmt,
              startDate: a.startDate,
              expDate: a.expDate
            })),
            totalCount: nsfPIAwards.totalCount,
            totalFunding: nsfPIAwards.totalFunding
          },
          keywordResults: {}
        };

        // For each keyword, keep only top 5 NSF awards and summary stats
        for (const [keyword, data] of Object.entries(nsfKeywordResults)) {
          if (data.error) {
            truncatedNSFData.keywordResults[keyword] = { error: data.error };
          } else {
            truncatedNSFData.keywordResults[keyword] = {
              awards: data.awards.slice(0, 5).map(a => ({
                id: a.id,
                title: a.title,
                fundProgramName: a.fundProgramName,
                fundsObligatedAmt: a.fundsObligatedAmt,
                startDate: a.startDate
              })),
              totalCount: data.totalCount,
              totalFunding: data.totalFunding,
              averageAward: data.averageAward
            };
          }
        }

        // Truncate NIH data
        const truncatedNIHData = {
          piProjects: {
            projects: nihPIProjects.projects.slice(0, 10).map(p => ({
              project_title: p.project_title,
              organization: p.organization?.org_name,
              award_amount: p.award_amount,
              fiscal_year: p.fiscal_year,
              project_start_date: p.project_start_date,
              project_end_date: p.project_end_date
            })),
            totalCount: nihPIProjects.totalCount,
            totalFunding: nihPIProjects.totalFunding
          },
          keywordResults: {}
        };

        // For each keyword, keep only top 5 NIH projects and summary stats
        for (const [keyword, data] of Object.entries(nihKeywordResults)) {
          if (data.error) {
            truncatedNIHData.keywordResults[keyword] = { error: data.error };
          } else {
            truncatedNIHData.keywordResults[keyword] = {
              projects: data.projects.slice(0, 5).map(p => ({
                project_title: p.project_title,
                organization: p.organization?.org_name,
                award_amount: p.award_amount,
                fiscal_year: p.fiscal_year
              })),
              totalCount: data.totalCount,
              totalFunding: data.totalFunding,
              averageAward: data.averageAward
            };
          }
        }

        // Truncate USAspending data
        const truncatedUSASpendingData = {
          awards: usaSpendingResults.awards.slice(0, 10).map(a => ({
            award_id: a['Award ID'],
            amount: a['Award Amount'],
            description: a.Description,
            start_date: a['Start Date'],
            end_date: a['End Date'],
            agency: a['Awarding Agency']
          })),
          totalCount: usaSpendingResults.totalCount,
          totalFunding: usaSpendingResults.totalFunding,
          byAgency: {}
        };

        // Include agency summaries
        for (const [agency, data] of Object.entries(usaSpendingResults.byAgency)) {
          truncatedUSASpendingData.byAgency[agency] = {
            count: data.count,
            totalFunding: data.totalFunding,
            topAwards: data.awards.slice(0, 3).map(a => ({
              award_id: a['Award ID'],
              amount: a['Award Amount'],
              description: a.Description
            }))
          };
        }

        const analysisData = {
          pi: extraction.pi,
          institution: extraction.institution,
          keywords: extraction.keywords,
          nsfData: truncatedNSFData,
          nihData: truncatedNIHData,
          usaSpendingData: truncatedUSASpendingData,
          searchYears: searchYears
        };

        const analysisPrompt = createFundingAnalysisPrompt(analysisData);

        let analysisResponse;
        try {
          ({ text: analysisResponse } = await claudeClient.complete({
            messages: [{ role: 'user', content: analysisPrompt }],
            maxTokens: 4000,
            temperature: 0.4,
          }));
          sendProgress(`Analysis complete for ${file.filename}`, baseProgress + 75);
        } catch (claudeError) {
          console.error('Claude API error during analysis:', claudeError);
          throw new Error(`Claude API error: ${claudeError.message}`);
        }

        // Store proposal result
        allProposals.push({
          filename: file.filename,
          pi: extraction.pi,
          institution: extraction.institution,
          state: extraction.state,
          keywords: extraction.keywords,
          nsfTotalFunding: formatCurrency(nsfPIAwards.totalFunding),
          nsfAwardCount: nsfPIAwards.totalCount,
          nihTotalFunding: formatCurrency(nihPIProjects.totalFunding),
          nihProjectCount: nihPIProjects.totalCount,
          usaSpendingTotalFunding: formatCurrency(usaSpendingResults.totalFunding),
          usaSpendingAwardCount: usaSpendingResults.totalCount,
          analysis: analysisResponse,
          metadata: {
            processedAt: new Date().toISOString(),
            searchYears: searchYears,
            proposalLength: proposalText.length,
            ...metadata,
            aiPayloadBoundary: extractionPayload.metadata,
          }
        });

      } catch (fileError) {
        console.error(`Error processing ${file.filename}:`, fileError);

        // Create error result
        const errorMarkdown = `# Error Processing ${file.filename}\n\n**Error:** ${fileError.message}\n\nPlease check the file and try again.`;

        allProposals.push({
          filename: file.filename,
          pi: 'Error',
          institution: 'Error',
          keywords: [],
          nsfTotalFunding: '$0',
          nsfAwardCount: 0,
          analysis: errorMarkdown,
          metadata: {
            error: true,
            errorMessage: fileError.message,
            processedAt: new Date().toISOString()
          }
        });

        sendProgress(`Error processing ${file.filename}: ${fileError.message}`, baseProgress + 75);
      }
    }

    // Send final results - individual reports for each proposal
    sendProgress('Complete! Analysis ready.', 100);

    // Convert allProposals array to object keyed by filename
    const resultsObject = {};
    for (const proposal of allProposals) {
      resultsObject[proposal.filename] = {
        formatted: proposal.analysis,
        structured: {
          pi: proposal.pi,
          institution: proposal.institution,
          state: proposal.state,
          keywords: proposal.keywords,
          nsfTotalFunding: proposal.nsfTotalFunding,
          nsfAwardCount: proposal.nsfAwardCount,
          nihTotalFunding: proposal.nihTotalFunding,
          nihProjectCount: proposal.nihProjectCount,
          usaSpendingTotalFunding: proposal.usaSpendingTotalFunding,
          usaSpendingAwardCount: proposal.usaSpendingAwardCount
        },
        metadata: proposal.metadata
      };
    }

    res.write(`data: ${JSON.stringify({
      complete: true,
      results: resultsObject,
      metadata: {
        proposalCount: files.length,
        searchYears: searchYears,
        generatedAt: new Date().toISOString()
      }
    })}\n\n`);

    res.end();

  } catch (error) {
    console.error('Error in funding gap analyzer API:', error);
    res.write(`data: ${JSON.stringify({
      error: BASE_CONFIG.ERROR_MESSAGES.PROCESSING_FAILED,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      complete: true
    })}\n\n`);
    res.end();
  }
}
