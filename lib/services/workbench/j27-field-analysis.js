/**
 * Trusted First Cut callers search for leads, check sources, then generate P8.
 * Search results carry abstracts and identifiers for discovery. Only the
 * caller's checked source records are passed to the governed writer.
 */

import { executePrompt } from '../execute-prompt.js';
import { OpenAlexService } from '../openalex-service.js';
import { PubMedService } from '../pubmed-service.js';
import { isGuid } from '../../utils/guid.js';
import { validateAiJson } from '../../utils/ai-output-schema.js';
import {
  PROMPT_NAME, PROMPT_OUTPUT_SCHEMA, PROMPT_VARIABLES,
} from '../../../shared/config/prompts/j27-field-analysis.js';

const SEARCH_LIMIT = 5;
const compact = (value) => typeof value === 'string' ? value.trim() : '';

/** Send only focused search terms to the providers. Returns leads, not verified citations. */
export async function searchJ27FieldAnalysisLiterature(queries, { signal } = {}) {
  if (!Array.isArray(queries) || queries.length < 1 || queries.length > 6
    || queries.some((query) => !compact(query) || compact(query).length > 240)) {
    throw new Error('P8 literature search requires one to six focused queries of at most 240 characters.');
  }

  const searches = [];
  for (const query of new Set(queries.map(compact))) {
    signal?.throwIfAborted();
    const timeout = AbortSignal.timeout(20_000);
    const searchSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const results = await Promise.allSettled([
      OpenAlexService.searchWorks(query, { limit: SEARCH_LIMIT, signal: searchSignal }),
      PubMedService.searchWithCount(query, SEARCH_LIMIT, { throwOnError: true, signal: searchSignal }),
    ]);
    signal?.throwIfAborted();
    searches.push(...results.map((result, index) => {
      const provider = index === 0 ? 'openalex' : 'pubmed';
      if (result.status === 'rejected') return { query, provider, status: 'unavailable', records: [] };
      const { totalCount, records } = result.value;
      return {
        query, provider, totalCount,
        status: records.length ? 'found' : totalCount === 0 ? 'no_results' : 'unavailable',
        records: records.slice(0, SEARCH_LIMIT).map(({ title, doi, pmid, openAlexId, abstract }) => ({
          title, doi, pmid, openAlexId, abstract,
        })),
      };
    }));
  }
  return searches;
}

function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function checkedSourceMap(checkedSources) {
  if (!Array.isArray(checkedSources) || checkedSources.length < 1 || checkedSources.length > 30) {
    throw new Error('P8 requires one to thirty checked sources.');
  }
  const sources = new Map();
  for (const source of checkedSources) {
    const { sourceId, title, firstAuthor, leadAuthor, institution, url, doi, journal, volume, pages,
      firstPublicDate, type, evidenceLevel, passage } = source ?? {};
    let sourceUrl;
    try { sourceUrl = new URL(url); } catch { /* invalid source URL */ }
    if (!compact(sourceId) || sourceId.length > 150 || sources.has(sourceId)
      || !compact(title) || !compact(firstAuthor) || !compact(passage)
      || sourceUrl?.protocol !== 'https:' || sourceUrl.username || sourceUrl.password
      || !['article', 'preprint', 'conference abstract'].includes(type)
      || !['abstract', 'full_text'].includes(evidenceLevel)
      || (firstPublicDate != null && !isCalendarDate(firstPublicDate))) {
      throw new Error('P8 checked sources require unique IDs, bibliographic details, and a checked passage.');
    }
    sources.set(sourceId, {
      sourceId, title, firstAuthor, leadAuthor, institution, url: sourceUrl.href, doi, journal, volume, pages,
      firstPublicDate: firstPublicDate ?? null, type, evidenceLevel, passage,
    });
  }
  return sources;
}

/** Draft a source-checked brief. The Executor records its run and returns the separate review signals. */
export async function generateJ27FieldAnalysis({
  requestId, proposalText, bibliography, summaryFields, submissionDate,
  intakeOpenQuestions, checkedSources, searchNotes = '', runSource = 'Vercel Interactive', signal,
}) {
  if (!isGuid(requestId) || !isCalendarDate(submissionDate) || !Array.isArray(intakeOpenQuestions)) {
    throw new Error('P8 requires a request, a verified submission date, and an intake questions list.');
  }
  signal?.throwIfAborted();
  const sources = checkedSourceMap(checkedSources);
  const overrideVariables = {
    proposal_text: proposalText,
    bibliography,
    summary_fields: summaryFields,
    submission_date: submissionDate,
    intake_open_questions: JSON.stringify(intakeOpenQuestions),
    checked_sources: JSON.stringify([...sources.values()]),
    search_notes: searchNotes,
  };
  for (const { name, required, maxChars } of PROMPT_VARIABLES.variables) {
    const value = overrideVariables[name];
    if (typeof value !== 'string' || (required && !compact(value)) || value.length > maxChars) {
      throw new Error(`P8 input ${name} is missing or exceeds its limit.`);
    }
  }

  const result = await executePrompt({
    promptName: PROMPT_NAME, requestId, runSource, overrideVariables,
    requireNoPersistence: true, signal,
  });
  signal?.throwIfAborted();
  const parsed = validateAiJson(result.parsed, PROMPT_OUTPUT_SCHEMA.validationSchema);
  if (result.blocked || !result.writeResults?.allOk || !parsed.ok) {
    throw new Error('P8 did not return a valid draft.');
  }

  const { state_of_play, novelty, claims_checked, reference_source_ids, open_questions, pd_notes } = parsed.value;
  const brief = [state_of_play, novelty, claims_checked].join('\n');
  const wordCount = brief.replace(/<\/?i>/gi, '').replace(/\[\d+\]/g, ' ').trim().split(/\s+/).length;
  const citations = [...new Set([...brief.matchAll(/\[(\d+)\]/g)].map(([, number]) => number))];
  if (wordCount > 600 || !reference_source_ids.length
    || new Set(reference_source_ids).size !== reference_source_ids.length
    || reference_source_ids.some((id) => !sources.has(id))
    || citations.length !== reference_source_ids.length
    || citations.some((number, index) => number !== String(index + 1))) {
    throw new Error('P8 returned an oversized brief or invalid source citations.');
  }
  return {
    fieldAnalysis: {
      stateOfPlay: state_of_play, novelty, claimsChecked: claims_checked, wordCount,
      references: reference_source_ids.map((id, index) => ({ n: index + 1, ...sources.get(id) })),
    },
    openQuestions: open_questions,
    pdNotes: pd_notes,
    runId: result.runId,
    promptVersion: result.meta?.promptVersion,
    model: result.meta?.modelUsed,
  };
}
