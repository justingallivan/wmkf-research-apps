/**
 * API Route: /api/reviewer-finder/prompt-override
 *
 * Per-user prompt overrides for the two reviewer-finder prompts (S222). This is
 * the ONLY write path for PREFERENCE_KEYS.PROMPT_OVERRIDES — the generic
 * /api/user-preferences endpoint blocks that key. Gated by the `reviewers` app
 * grant and validates the body with the same validators the admin path uses.
 *
 *   GET    ?name=<promptName>  → { name, version, templateBody, userOverride, staleOverride }
 *   PUT    { name, body }      → save/replace this user's override (with base metadata)
 *   DELETE { name }            → remove this user's override ("reset to template")
 *
 * Override value shape (per prompt name), stored as JSON under PROMPT_OVERRIDES:
 *   { body, basePromptId, baseVersion, updatedAt }
 */
import { requireAppAccess } from '../../../lib/utils/auth';
import { DatabaseService } from '../../../lib/services/database-service';
import { bypassDynamicsRestrictions } from '../../../lib/services/dynamics-context';
import { fetchCurrentPrompt } from '../../../lib/services/prompt-store';
import { PREFERENCE_KEYS } from '../../../shared/config/reviewerFinderPreferences';
import { validatePromptForSave } from '../../../lib/utils/prompt-validators';
import { REVIEWER_PROMPT_NAMES } from '../../../lib/services/reviewer-prompt-resolver';
import {
  ANALYZE_USER_PROMPT_TEMPLATE,
  SCORE_CANDIDATES_USER_PROMPT_TEMPLATE,
} from '../../../shared/config/prompts/reviewer-finder-dynamics';

const CODE_TEMPLATES = {
  [REVIEWER_PROMPT_NAMES.ANALYZE]: ANALYZE_USER_PROMPT_TEMPLATE,
  [REVIEWER_PROMPT_NAMES.SCORE_CANDIDATES]: SCORE_CANDIDATES_USER_PROMPT_TEMPLATE,
};
const VALID_NAMES = new Set(Object.values(REVIEWER_PROMPT_NAMES));
const MAX_BODY_LEN = 64 * 1024;

export default async function handler(req, res) {
  const access = await requireAppAccess(req, res, 'reviewer-finder', 'reviewers');
  if (!access) return;
  const { profileId } = access;

  try {
    if (req.method === 'GET') return await handleGet(req, res, profileId);
    if (req.method === 'PUT') return await handlePut(req, res, profileId);
    if (req.method === 'DELETE') return await handleDelete(req, res, profileId);
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[reviewer-finder/prompt-override] error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}

/** Fetch the current Dataverse template (base) + version; fall back to the code template. */
async function loadBase(name) {
  try {
    const row = await bypassDynamicsRestrictions('prompt-override-base', () => fetchCurrentPrompt(name));
    return {
      templateBody: row.wmkf_ai_promptbody || CODE_TEMPLATES[name],
      version: row.wmkf_promptversion ?? null,
      promptId: row.wmkf_ai_promptid ?? null,
    };
  } catch {
    return { templateBody: CODE_TEMPLATES[name], version: null, promptId: null };
  }
}

async function readOverrides(profileId) {
  const prefs = await DatabaseService.getUserPreferences(profileId, false);
  const raw = prefs?.[PREFERENCE_KEYS.PROMPT_OVERRIDES];
  if (!raw) return {};
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return {}; }
}

async function handleGet(req, res, profileId) {
  const name = String(req.query.name || '');
  if (!VALID_NAMES.has(name)) return res.status(400).json({ error: `Unknown prompt name "${name}"` });

  const base = await loadBase(name);
  const overrides = await readOverrides(profileId);
  const userOverride = overrides[name] || null;
  const staleOverride =
    userOverride && base.version != null && userOverride.baseVersion != null &&
    Number(userOverride.baseVersion) < Number(base.version)
      ? { baseVersion: userOverride.baseVersion, currentVersion: base.version }
      : null;

  return res.json({ name, version: base.version, templateBody: base.templateBody, userOverride, staleOverride });
}

async function handlePut(req, res, profileId) {
  const { name, body } = req.body || {};
  if (!VALID_NAMES.has(name)) return res.status(400).json({ error: `Unknown prompt name "${name}"` });
  if (typeof body !== 'string' || body.length === 0 || body.length > MAX_BODY_LEN) {
    return res.status(400).json({ status: 'invalid_input', error: `body must be 1..${MAX_BODY_LEN} chars` });
  }
  const v = validatePromptForSave(name, body);
  if (!v.valid) return res.status(400).json({ status: 'invalid_body', error: 'Prompt body failed validation.', issues: v.issues });

  const base = await loadBase(name);
  const overrides = await readOverrides(profileId);
  overrides[name] = {
    body,
    basePromptId: base.promptId,
    baseVersion: base.version,
    updatedAt: new Date().toISOString(),
  };
  const ok = await DatabaseService.setUserPreference(profileId, PREFERENCE_KEYS.PROMPT_OVERRIDES, JSON.stringify(overrides));
  if (!ok) return res.status(500).json({ error: 'Failed to save override' });
  return res.json({ success: true, override: overrides[name] });
}

async function handleDelete(req, res, profileId) {
  const { name } = req.body || {};
  if (!VALID_NAMES.has(name)) return res.status(400).json({ error: `Unknown prompt name "${name}"` });
  const overrides = await readOverrides(profileId);
  if (overrides[name]) {
    delete overrides[name];
    const ok = await DatabaseService.setUserPreference(profileId, PREFERENCE_KEYS.PROMPT_OVERRIDES, JSON.stringify(overrides));
    if (!ok) return res.status(500).json({ error: 'Failed to remove override' });
  }
  return res.json({ success: true });
}
