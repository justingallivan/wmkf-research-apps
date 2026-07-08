/**
 * Unified configuration exports
 * Single entry point for all configuration and prompts
 *
 * Usage:
 * import { BASE_CONFIG, KECK_GUIDELINES, createSummarizationPrompt } from '../../shared/config';
 */

// Base configuration
export { BASE_CONFIG, getEnvironmentConfig, mergeConfig, validateConfig, getModelForApp, getFallbackModelForApp } from './baseConfig';

// Server-only loader (keeps settings-service chain out of client bundles)
export { loadModelOverrides, clearModelOverridesCache } from '../../lib/services/model-override-loader';

// Keck Foundation guidelines
export { KECK_GUIDELINES } from './keck-guidelines';

// Prompt functions - Phase II Writeup Draft
export {
  createSummarizationPrompt,
  createStructuredDataExtractionPrompt,
  createRefinementPrompt,
  createQAPrompt,
  extractInstitutionFromFilename,
  enhanceFormatting
} from './prompts/proposal-summarizer';

// Prompt functions - Phase I Summaries
export {
  createPhaseISummarizationPrompt,
  getPhaseITextLimit
} from './prompts/phase-i-summaries';

// Prompt functions - Phase I Writeup
export {
  createPhaseIWriteupPrompt,
  getPhaseIWriteupTextLimit
} from './prompts/phase-i-writeup';

// Prompt functions - Peer Review Analysis
export {
  createPeerReviewAnalysisPrompt,
  createPeerReviewQuestionsPrompt,
  extractReviewerInfo
} from './prompts/peer-reviewer';

// Prompt functions - Funding Gap Analyzer
export {
  createFundingExtractionPrompt,
  createFundingAnalysisPrompt,
  createBatchFundingSummaryPrompt,
  getFundingExtractionLimit
} from './prompts/funding-gap-analyzer';

// Common utilities
export {
  truncateText,
  cleanText,
  validatePromptParameters,
  TEXT_LIMITS,
  TEMPERATURE_SETTINGS
} from './prompts/common';
