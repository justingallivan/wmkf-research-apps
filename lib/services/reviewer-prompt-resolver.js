/**
 * Reviewer-finder prompt resolver (S222, Path A seam).
 *
 * Resolves the EFFECTIVE editable body for a reviewer-finder prompt via a
 * three-tier chain, returning the body plus provenance. The caller
 * (`ClaudeReviewerService`) composes the code-owned A7 preamble + interpolates
 * the body; this module only decides WHICH body to use.
 *
 *   per-user override (user-preferences)  →  Dataverse `iscurrent` row  →  code template
 *
 * Fallback policy (reconciled with the fail-loud rule):
 *   - TRANSIENT / unreachable Dataverse errors → fall through to the next tier
 *     (an override if present, else the in-repo code template). Analysis never
 *     hard-fails on a network blip.
 *   - STRUCTURAL corruption — 0 current rows (`PROMPT_NOT_FOUND`) or ≥2 current
 *     rows (`PROMPT_DUPLICATE_CURRENT`) — is NOT transient and FAILS LOUD. We do
 *     not silently degrade to the code template, which would hide an
 *     admin/versioning data-integrity failure.
 *
 * The resolver owns the `bypassDynamicsRestrictions` wrap for its Dataverse
 * fetch (service-layer concern, not the API route's), matching the Executor.
 */
import { bypassDynamicsRestrictions } from './dynamics-context.js';
import { fetchCurrentPrompt, PROMPT_STORE_ERROR_CODES } from './prompt-store.js';
import { DatabaseService } from './database-service.js';
import { PREFERENCE_KEYS } from '../../shared/config/reviewerFinderPreferences.js';
import {
  ANALYZE_USER_PROMPT_TEMPLATE,
  SCORE_CANDIDATES_USER_PROMPT_TEMPLATE,
} from '../../shared/config/prompts/reviewer-finder-dynamics.js';

export const REVIEWER_PROMPT_NAMES = {
  ANALYZE: 'reviewer-finder.analyze',
  SCORE_CANDIDATES: 'reviewer-finder.score-candidates',
};

// In-repo last-resort bodies, kept byte-in-sync with the code generators in
// `reviewer-finder.js` (a parity test guards the drift). Used ONLY when the
// Dataverse row is transiently unreachable and the user has no override.
const CODE_FALLBACK_BODIES = {
  [REVIEWER_PROMPT_NAMES.ANALYZE]: ANALYZE_USER_PROMPT_TEMPLATE,
  [REVIEWER_PROMPT_NAMES.SCORE_CANDIDATES]: SCORE_CANDIDATES_USER_PROMPT_TEMPLATE,
};

const STRUCTURAL_ERROR_CODES = new Set([
  PROMPT_STORE_ERROR_CODES.NOT_FOUND,
  PROMPT_STORE_ERROR_CODES.DUPLICATE_CURRENT,
]);

/**
 * Read the per-user override entry for a prompt (best-effort; any error or
 * malformed value yields null so a broken pref never blocks analysis).
 */
async function readUserOverride(userProfileId, promptName) {
  if (!userProfileId) return null;
  try {
    const prefs = await DatabaseService.getUserPreferences(userProfileId, false);
    const raw = prefs?.[PREFERENCE_KEYS.PROMPT_OVERRIDES];
    if (!raw) return null;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const entry = parsed?.[promptName];
    if (entry && typeof entry.body === 'string' && entry.body.length > 0) return entry;
    return null;
  } catch {
    return null;
  }
}

/**
 * @param {string} promptName  one of REVIEWER_PROMPT_NAMES
 * @param {{ userProfileId?: string|null }} [opts]
 * @returns {Promise<{
 *   body: string, source: 'override'|'dataverse'|'code-fallback',
 *   promptId: string|null, version: number|null, overrideUsed: boolean,
 *   fallbackReason: string|null,
 *   staleOverride: { baseVersion: number|null, currentVersion: number }|null,
 * }>}
 * @throws on structural store corruption (typed PROMPT_NOT_FOUND / PROMPT_DUPLICATE_CURRENT)
 */
export async function resolveReviewerPrompt(promptName, { userProfileId = null } = {}) {
  if (!CODE_FALLBACK_BODIES[promptName]) {
    throw new Error(`resolveReviewerPrompt: unknown prompt name "${promptName}"`);
  }

  // Tier 2: Dataverse current row. Typed corruption → rethrow (fail loud).
  // Transient/unreachable → remember the reason and continue to fallback tiers.
  let dvRow = null;
  let dvError = null;
  try {
    dvRow = await bypassDynamicsRestrictions('reviewer-prompt-resolve', () =>
      fetchCurrentPrompt(promptName));
  } catch (err) {
    if (STRUCTURAL_ERROR_CODES.has(err?.code)) throw err;
    dvError = err;
  }
  const currentVersion = dvRow?.wmkf_promptversion ?? null;

  // Tier 1: per-user override wins when present.
  const override = await readUserOverride(userProfileId, promptName);
  if (override) {
    const baseVersion = override.baseVersion ?? null;
    const staleOverride =
      currentVersion != null && baseVersion != null && Number(baseVersion) < Number(currentVersion)
        ? { baseVersion, currentVersion }
        : null;
    return {
      body: override.body,
      source: 'override',
      promptId: override.basePromptId ?? dvRow?.wmkf_ai_promptid ?? null,
      version: baseVersion,
      overrideUsed: true,
      fallbackReason: dvError ? `dataverse-unreachable: ${dvError.message}` : null,
      staleOverride,
    };
  }

  // Tier 2 result.
  if (dvRow && typeof dvRow.wmkf_ai_promptbody === 'string' && dvRow.wmkf_ai_promptbody.length > 0) {
    return {
      body: dvRow.wmkf_ai_promptbody,
      source: 'dataverse',
      promptId: dvRow.wmkf_ai_promptid ?? null,
      version: currentVersion,
      overrideUsed: false,
      fallbackReason: null,
      staleOverride: null,
    };
  }

  // Tier 3: in-repo code template (transient Dataverse error, or empty body).
  return {
    body: CODE_FALLBACK_BODIES[promptName],
    source: 'code-fallback',
    promptId: null,
    version: null,
    overrideUsed: false,
    fallbackReason: dvError ? `dataverse-unreachable: ${dvError.message}` : 'dataverse-empty-body',
    staleOverride: null,
  };
}
