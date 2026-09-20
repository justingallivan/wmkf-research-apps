/**
 * Per-user reviewer-finder prompt overrides — client store (S222).
 *
 * Talks to the grant-gated /api/reviewer-finder/prompt-override (the ONLY write
 * path for the override key). Names/labels are duplicated here as literals to
 * keep this browser-safe (the server-side REVIEWER_PROMPT_NAMES lives in a module
 * that imports DynamicsService).
 */

import { requestJson, requestEnvelope } from '../../utils/api-request';

export const REVIEWER_PROMPT_OPTIONS = [
  { name: 'reviewer-finder.analyze', label: 'Proposal analysis (reviewer suggestions + search queries)' },
  { name: 'reviewer-finder.score-candidates', label: 'Candidate scoring (database-discovered relevance)' },
];

/** @returns {Promise<{name,version,templateBody,userOverride,staleOverride}>} */
export async function loadPromptOverride(name) {
  return requestJson(`/api/reviewer-finder/prompt-override?name=${encodeURIComponent(name)}`, {
    fallbackMessage: 'Failed to load prompt',
  });
}

export async function savePromptOverride(name, body) {
  const { ok, data } = await requestEnvelope('/api/reviewer-finder/prompt-override', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, body }),
    tolerantBody: true,
  });
  if (!ok) throw new Error(data.error || (data.issues ? data.issues.join('; ') : 'Save failed'));
  return data;
}

/** Reset to the shared template (removes the user's override). */
export async function deletePromptOverride(name) {
  return requestJson('/api/reviewer-finder/prompt-override', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
    fallbackMessage: 'Reset failed',
  });
}
