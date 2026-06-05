/**
 * Per-user reviewer-finder prompt overrides — client store (S222).
 *
 * Talks to the grant-gated /api/reviewer-finder/prompt-override (the ONLY write
 * path for the override key). Names/labels are duplicated here as literals to
 * keep this browser-safe (the server-side REVIEWER_PROMPT_NAMES lives in a module
 * that imports DynamicsService).
 */

export const REVIEWER_PROMPT_OPTIONS = [
  { name: 'reviewer-finder.analyze', label: 'Proposal analysis (reviewer suggestions + search queries)' },
  { name: 'reviewer-finder.score-candidates', label: 'Candidate scoring (database-discovered relevance)' },
];

/** @returns {Promise<{name,version,templateBody,userOverride,staleOverride}>} */
export async function loadPromptOverride(name) {
  const res = await fetch(`/api/reviewer-finder/prompt-override?name=${encodeURIComponent(name)}`);
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error || 'Failed to load prompt');
  }
  return res.json();
}

export async function savePromptOverride(name, body) {
  const res = await fetch('/api/reviewer-finder/prompt-override', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || (data.issues ? data.issues.join('; ') : 'Save failed'));
  return data;
}

/** Reset to the shared template (removes the user's override). */
export async function deletePromptOverride(name) {
  const res = await fetch('/api/reviewer-finder/prompt-override', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error || 'Reset failed');
  }
  return res.json();
}
