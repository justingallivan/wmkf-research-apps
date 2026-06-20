/**
 * Grantee edited-title service.
 *
 * Distills an applicant's project title + abstract into a single house-style
 * one-line objective ("To [verb] …") for the Board Book / award summary
 * (Grantee Deliverables Portal, S269). Thin wrapper over the shared Executor
 * (docs/EXECUTOR_CONTRACT.md): an all-override prompt (`grantee-title.generate`),
 * so it runs from the source title + abstract text alone — no requestId, no
 * Dataverse writeback (output kind:'none' → the one-liner is RETURNED).
 *
 * The CALLER persists the result to `akoya_request.wmkf_wmkfprojectdescription`
 * ONLY when that field is empty (chunk-7 cron, write-when-empty, ETag-conditional
 * — see docs/GRANTEE_PORTAL_BUILD_PLAN.md). This service stays text-only and
 * unit-testable.
 */

import { executePrompt } from './execute-prompt.js';

export const GRANTEE_TITLE_PROMPT_NAME = 'grantee-title.generate';

// Input floors. Reject obviously-empty source so we don't burn a paid call on
// nothing: an abstract is a paragraph (mirrors the grantee-abstract guard), a
// title is at least a few characters.
const MIN_ABSTRACT_CHARS = 50;
const MIN_TITLE_CHARS = 3;

// Output floor. A one-line objective like "To investigate non-reciprocal matter"
// is short; require a sane minimum so a refusal / empty block fails loud.
const MIN_OUTPUT_CHARS = 8;

/**
 * Clean the model's one-line output: strip a stray ```/```text fence (raw
 * parseMode does NOT strip fences), take the first non-empty line (defend against
 * an accidental trailing line), and remove surrounding quotes / a trailing period
 * the prompt says to omit.
 */
function cleanTitle(text) {
  let t = String(text).trim();
  const fence = t.match(/^```(?:\w+)?\s*\n([\s\S]*?)\n```$/);
  if (fence) t = fence[1].trim();
  t = (t.split('\n').map((l) => l.trim()).find((l) => l.length > 0) || '').trim();
  t = t.replace(/^["'“”]+|["'“”]+$/g, '').trim();
  t = t.replace(/\.+$/, '').trim();
  return t;
}

/**
 * Generate a house-style one-line objective from an applicant title + abstract.
 *
 * @param {Object} args
 * @param {string} args.sourceTitle - The applicant-authored project title
 *   (akoya_request.akoya_title). Untrusted — the Executor wraps it. Required.
 * @param {string} args.sourceAbstract - The applicant-authored abstract
 *   (akoya_request.wmkf_abstract). Untrusted — the Executor wraps it. Required.
 * @param {string} [args.runSource='Vercel User'] - wmkf_ai_runsource picklist value.
 * @returns {Promise<{ editedTitle: string, runId: string, model: string|null, promptName: string|null, promptVersion: (string|number|null), usage: Object|null }>}
 */
export async function generateGranteeTitle({ sourceTitle, sourceAbstract, runSource = 'Vercel User' } = {}) {
  if (!sourceTitle || typeof sourceTitle !== 'string' || sourceTitle.trim().length < MIN_TITLE_CHARS) {
    throw new Error(`generateGranteeTitle: sourceTitle is required (min ${MIN_TITLE_CHARS} chars).`);
  }
  if (!sourceAbstract || typeof sourceAbstract !== 'string' || sourceAbstract.trim().length < MIN_ABSTRACT_CHARS) {
    throw new Error(`generateGranteeTitle: sourceAbstract is required (min ~${MIN_ABSTRACT_CHARS} chars).`);
  }

  let result;
  try {
    result = await executePrompt({
      promptName: GRANTEE_TITLE_PROMPT_NAME,
      overrideVariables: { source_title: sourceTitle, source_abstract: sourceAbstract },
      runSource,
      // Output kind:'none' (no guarded writeback target), so blocking is a no-op;
      // set true so a future targeted output never silently blocks.
      forceOverwrite: true,
    });
  } catch (e) {
    // The Executor throws "Claude returned empty/short text" for a <20-char raw
    // output (refusal / empty block). Re-surface with context.
    throw new Error(`generateGranteeTitle: generation failed — ${e.message}`);
  }

  if (result.blocked) {
    throw new Error('Grantee title run blocked unexpectedly (a guarded target was populated).');
  }

  // Raw mode always yields a string, but guard defensively: a non-string here
  // (schema drift) would otherwise stringify to garbage instead of failing loud.
  const rawOut = result.parsed?.edited_title;
  if (rawOut != null && typeof rawOut !== 'string') {
    throw new Error('generateGranteeTitle: model output was not text (expected a string).');
  }

  const editedTitle = cleanTitle(rawOut || '');
  if (!editedTitle || editedTitle.length < MIN_OUTPUT_CHARS) {
    throw new Error('generateGranteeTitle: model returned an empty/too-short title.');
  }

  return {
    editedTitle,
    runId: result.runId,
    model: result.meta?.modelUsed ?? null,
    promptName: result.meta?.promptName ?? null,
    promptVersion: result.meta?.promptVersion ?? null,
    usage: result.usage ?? null,
  };
}
