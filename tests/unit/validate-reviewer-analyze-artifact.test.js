/**
 * @jest-environment node
 */

import {
  buildReplayArtifact,
  computeReplayQualitySignals,
  parseArgs,
} from '../../scripts/validate-reviewer-analyze.mjs';

describe('validate-reviewer-analyze replay artifact helpers', () => {
  it('parses json-out and replay options', () => {
    expect(parseArgs([
      '--request', '1002836',
      '--file-key', 'Docs::Folder::Narrative.pdf',
      '--reviewer-count', '8',
      '--temperature', '0.2',
      '--excluded', 'Ada Lovelace, Grace Hopper',
      '--json-out', 'artifacts/replay.json',
    ])).toEqual({
      request: '1002836',
      fileKey: 'Docs::Folder::Narrative.pdf',
      reviewerCount: 8,
      temperature: 0.2,
      excluded: ['Ada Lovelace', 'Grace Hopper'],
      jsonOut: 'artifacts/replay.json',
    });
  });

  it('computes machine-readable success and quality signals without pretending human review passed', () => {
    const result = {
      success: true,
      proposalInfo: { principalInvestigator: 'Dr. PI' },
      reviewerSuggestions: [
        {
          name: 'Reviewer One',
          suggestedInstitution: 'University A',
          seniorityEstimate: 'Mid-career',
          expertiseAreas: ['liver regeneration'],
          reasoning: 'Strong topical fit.',
        },
        {
          name: 'Reviewer Two',
          suggestedInstitution: 'University B',
          seniorityEstimate: 'Senior',
          expertiseAreas: ['bioengineering'],
          reasoning: 'Possible collaborator language should be reviewed.',
        },
      ],
      validation: { valid: true, issues: [] },
      usedFallback: false,
      model: 'claude-opus-4-8',
      stopReason: 'end_turn',
      attempt: 1,
      maxTokens: 8192,
      promptProvenance: { source: 'code-fallback', version: null },
    };

    const artifact = buildReplayArtifact({
      args: {
        request: '1002836',
        reviewerCount: 2,
        temperature: 0.3,
        excluded: [],
      },
      request: { id: 'req-guid', requestNumber: '1002836', title: 'Proposal' },
      files: [
        { name: 'Narrative.pdf', library: 'Docs', folder: 'Folder', classification: 'proposal' },
      ],
      selectedFile: { name: 'Narrative.pdf', library: 'Docs', folder: 'Folder', classification: 'proposal' },
      extraction: { isPdf: true, textChars: 12345 },
      progressEvents: [{ stage: 'analysis', status: 'complete', message: 'Found 2 suggestions' }],
      result,
      failure: null,
    });

    expect(artifact).toMatchObject({
      schemaVersion: 1,
      status: 'completed',
      command: {
        request: '1002836',
        reviewerCount: 2,
        temperature: 0.3,
      },
      request: { id: 'req-guid', requestNumber: '1002836' },
      selectedFile: { key: 'Docs::Folder::Narrative.pdf' },
      model: {
        actual: 'claude-opus-4-8',
        usedFallback: false,
        stopReason: 'end_turn',
      },
      parse: {
        success: true,
        proposalInfoPresent: true,
        suggestionCount: 2,
      },
      qualitySignals: {
        analyzeSuccess: true,
        suggestionCountMatchesRequested: true,
        reasoningConcernWordCount: 1,
        reasoningConcernNames: ['Reviewer Two'],
      },
      humanReview: {
        pass: null,
      },
      sideEffects: {
        reviewerGrantBlobWrites: false,
      },
    });
  });

  it('keeps failed runs explicit and machine-readable', () => {
    const signals = computeReplayQualitySignals({
      result: {
        success: false,
        proposalInfo: {},
        reviewerSuggestions: [],
        validation: {
          issues: [{ code: 'empty_parse_failure', severity: 'error', message: 'No reviewers parsed' }],
        },
        usedFallback: true,
        stopReason: 'max_tokens',
      },
      suggestionCount: 0,
      reviewerCount: 12,
      reasoningWithConcernWords: [],
    });

    expect(signals).toMatchObject({
      analyzeSuccess: false,
      parsedProposalInfo: false,
      suggestionCountMatchesRequested: false,
      usedFallback: true,
      stopReason: 'max_tokens',
      validationIssueCount: 1,
      validationIssues: [{ code: 'empty_parse_failure', severity: 'error' }],
    });
  });
});
