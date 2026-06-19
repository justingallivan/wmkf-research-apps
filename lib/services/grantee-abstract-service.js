/**
 * Grantee abstract service.
 *
 * Rewrites an applicant-authored grant abstract into the W. M. Keck Foundation
 * house style (third person, tense-zoned) for the Grantee Deliverables Portal.
 * Thin wrapper over the shared Executor (docs/EXECUTOR_CONTRACT.md): an
 * all-override prompt (`grantee-abstract.generate`), so it runs from the source
 * abstract text alone — no requestId, no Dataverse writeback (output
 * kind:'none' → the rewritten text is RETURNED).
 *
 * The CALLER persists the result to `akoya_request.wmkf_abstractformatted` with
 * an idempotent ETag/lease (chunk 3 — Awardee-tab trigger), so this service
 * stays text-only and unit-testable. See docs/GRANTEE_PORTAL_BUILD_PLAN.md.
 */

import { executePrompt } from './execute-prompt.js';

export const GRANTEE_ABSTRACT_PROMPT_NAME = 'grantee-abstract.generate';

// Floors. Input: an abstract is a paragraph; reject obviously-empty source so we
// don't burn a paid call on nothing (mirrors field-primer's min-length guard).
// Output: the Executor's raw parser already throws under 20 chars; we guard the
// input and re-surface any short-output failure with a clear message.
const MIN_SOURCE_CHARS = 50;

/**
 * Strip a stray ```/```text fence the model may wrap the prose in. Raw parseMode
 * does NOT strip fences (only json mode does), and the prompt asks for bare prose,
 * but defend against an occasional fenced response.
 */
function stripFence(text) {
  const m = String(text).trim().match(/^```(?:\w+)?\s*\n([\s\S]*?)\n```$/);
  return (m ? m[1] : text).trim();
}

/**
 * Generate a house-style rewrite of an applicant abstract.
 *
 * @param {Object} args
 * @param {string} args.sourceAbstract - The applicant-authored abstract
 *   (akoya_request.wmkf_abstract). Untrusted — the Executor wraps it. Required.
 * @param {string} [args.runSource='Vercel User'] - wmkf_ai_runsource picklist value.
 * @returns {Promise<{ abstractFormatted: string, runId: string, model: string|null, promptName: string|null, promptVersion: (string|number|null), usage: Object|null }>}
 */
export async function generateGranteeAbstract({ sourceAbstract, runSource = 'Vercel User' } = {}) {
  if (!sourceAbstract || typeof sourceAbstract !== 'string' || sourceAbstract.trim().length < MIN_SOURCE_CHARS) {
    throw new Error(`generateGranteeAbstract: sourceAbstract is required (min ~${MIN_SOURCE_CHARS} chars).`);
  }

  let result;
  try {
    result = await executePrompt({
      promptName: GRANTEE_ABSTRACT_PROMPT_NAME,
      overrideVariables: { source_abstract: sourceAbstract },
      runSource,
      // Output kind:'none' (no guarded writeback target), so blocking is a no-op;
      // set true so a future targeted output never silently blocks.
      forceOverwrite: true,
    });
  } catch (e) {
    // The Executor throws "Claude returned empty/short text" for a <20-char raw
    // output (refusal / empty block). Re-surface with context rather than leaking
    // the raw Executor message.
    throw new Error(`generateGranteeAbstract: generation failed — ${e.message}`);
  }

  if (result.blocked) {
    // Should not happen with kind:'none', but fail loud if the schema changes.
    throw new Error('Grantee abstract run blocked unexpectedly (a guarded target was populated).');
  }

  // Raw mode always yields a string, but guard defensively: a non-string here
  // (schema drift) would otherwise stringify to garbage like "[object Object]"
  // instead of failing loudly.
  const rawOut = result.parsed?.abstract_formatted;
  if (rawOut != null && typeof rawOut !== 'string') {
    throw new Error('generateGranteeAbstract: model output was not text (expected a string).');
  }

  const abstractFormatted = stripFence(rawOut || '');
  if (!abstractFormatted || abstractFormatted.length < 20) {
    throw new Error('generateGranteeAbstract: model returned an empty/too-short abstract.');
  }

  return {
    abstractFormatted,
    runId: result.runId,
    model: result.meta?.modelUsed ?? null,
    promptName: result.meta?.promptName ?? null,
    promptVersion: result.meta?.promptVersion ?? null,
    usage: result.usage ?? null,
  };
}
