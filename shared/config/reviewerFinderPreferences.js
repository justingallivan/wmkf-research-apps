/**
 * Preference keys for Reviewer Finder settings stored in Dataverse
 * `wmkf_appuserpreferences` (via the database-service dispatcher; the
 * Postgres `user_preferences` table was retired 2026-05-12). These settings
 * are per-user and persisted when a profile is selected.
 */
/**
 * Default candidate count for a reviewer-finder analyze draw.
 *
 * S249: raised 12 → 15. This is the recall lever — a single deeper draw walks
 * further down Claude's ranked list and surfaces tail names in one call;
 * re-drawing at temp 0.3 just returns the same head (wasted call). It replaces
 * the recall Track B used to add (now archived off). The UI slider range stays
 * 1–25. Canonical rationale + the "watch the padding ceiling; validate that 15
 * returns real names before going higher" caveat live in
 * docs/REVIEWER_FINDER_D26_PIPELINE_FLOWCHART.md §2. Single source of truth —
 * every analyze default (prompt, composer, service, route, both UI sliders)
 * imports this rather than re-hardcoding the number.
 */
export const DEFAULT_REVIEWER_COUNT = 15;

export const PREFERENCE_KEYS = {
  EMAIL_SIGNATURE: 'email_signature',
  SENDER_INFO: 'reviewer_finder_sender_info',
  GRANT_CYCLE_SETTINGS: 'reviewer_finder_grant_cycle_settings',
  EMAIL_TEMPLATE: 'reviewer_finder_email_template',
  CURRENT_CYCLE_ID: 'reviewer_finder_current_cycle_id',
  // Sticky review-process dates last used when inviting reviewers (the
  // two-phase proposal timeline shown in the invitation email). Stored as a
  // JSON string { respondByDate, proposalSendDate, reviewDueDate } (YYYY-MM-DD).
  // Per-user "last used" defaults — not template text. See InviteEmailModal.
  INVITE_TIMING: 'reviewer_invite_timing',
  // Per-user reviewer email templates, keyed by type:
  //   { invitation, materials, followup, thankyou } → { subject, body }.
  // Distinct from the legacy single-template EMAIL_TEMPLATE key above (which the
  // standalone Reviewer Finder still uses) so the two shapes never collide.
  EMAIL_TEMPLATES: 'reviewer_email_templates',
  // Per-user reviewer-finder PROMPT overrides (S222), keyed by prompt name:
  //   { 'reviewer-finder.analyze': { body, basePromptId, baseVersion, updatedAt },
  //     'reviewer-finder.score-candidates': { ... } }
  // The override `body` layers over the shared Dataverse template; `baseVersion`
  // drives stale-override detection. WRITE PATH IS GATED: only
  // /api/reviewer-finder/prompt-override may write this key (the generic
  // /api/user-preferences endpoint blocks it). See the migration plan.
  PROMPT_OVERRIDES: 'reviewer_finder_prompt_overrides',
};

/**
 * Legacy localStorage keys used before database storage.
 * These keys are used for fallback when no profile is selected,
 * and for migration when a user first selects a profile.
 */
export const STORAGE_KEYS = {
  SENDER_INFO: 'email_sender_info',
  GRANT_CYCLE: 'email_grant_cycle',
  EMAIL_TEMPLATE: 'email_reviewer_template',
  CURRENT_CYCLE: 'reviewer_finder_current_cycle',
};

/**
 * Resolve a stored cycle preference value (either legacy integer-shape from
 * pre-W3 Postgres `grant_cycles.id` OR new shortcode-shape like `"J26"`)
 * against a list of cycle objects.
 *
 * Returns:
 *   { cycle, needsWriteback }
 *     cycle           — the matched cycle object, or null if neither shape resolves
 *     needsWriteback  — true if the stored value was in the legacy integer shape
 *                       AND a matching cycle was found. Callers should
 *                       opportunistically rewrite storage to the shortcode shape
 *                       (`cycle.shortCode`) on next access.
 *
 * Tolerant-reader pattern for the preference-shape migration documented in
 * `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md` § "Rollout-safety policy for
 * the preference-shape migration". The tolerant branch is intended to be
 * removed ≥1 week post-deploy once telemetry confirms no integer-shaped
 * values remain in stored prefs.
 */
export function resolveStoredCycle(storedValue, allCycles) {
  if (storedValue === null || storedValue === undefined || storedValue === '') {
    return { cycle: null, needsWriteback: false };
  }
  if (!Array.isArray(allCycles) || allCycles.length === 0) {
    return { cycle: null, needsWriteback: false };
  }

  const raw = String(storedValue).trim();
  if (!raw) return { cycle: null, needsWriteback: false };
  const asInt = parseInt(raw, 10);
  const isPureInteger = !Number.isNaN(asInt) && String(asInt) === raw;

  if (isPureInteger) {
    const cycle = allCycles.find(c => c.id === asInt);
    return { cycle: cycle || null, needsWriteback: !!cycle };
  }

  const cycle = allCycles.find(c => c.shortCode === raw);
  return { cycle: cycle || null, needsWriteback: false };
}

/**
 * Format a cycle for storage in the preference. Always returns the shortcode
 * string. Writers must call this — never store `cycle.id` directly.
 */
export function formatCycleForStorage(cycle) {
  return cycle?.shortCode || '';
}

/**
 * Default values for settings
 */
export const DEFAULT_VALUES = {
  EMAIL_SIGNATURE: {
    name: '',
    email: '',
    signature: '',
  },
  SENDER_INFO: {
    name: '',
    email: '',
    signature: '',
  },
  GRANT_CYCLE_SETTINGS: {
    programName: 'W. M. Keck Foundation',
    reviewDeadline: '',
    summaryPages: '2',
    customFields: [],
    attachments: {
      reviewTemplate: null,
      additionalFiles: [],
    },
  },
  EMAIL_TEMPLATE: {
    subject: 'Invitation to Review {{programName}} Research Grant Proposal',
    body: `{{greeting}},

I am reaching out on behalf of the {{programName}} to invite you to serve as an external reviewer for a research grant proposal.

{{investigatorTeam}} submitted a proposal titled "{{proposalTitle}}" which falls within your area of expertise.

{{#if reviewDeadline}}
We would need your review by {{reviewDeadline}}.
{{/if}}

Please let me know at your earliest convenience if you are available and willing to serve as a reviewer.

Thank you for considering this invitation.

{{signature}}`,
  },
};

export function normalizeEmailSignatureValue(value) {
  if (value === null || value === undefined || value === '') {
    return { ...DEFAULT_VALUES.EMAIL_SIGNATURE };
  }

  let decoded = value;
  if (typeof value === 'string') {
    try {
      decoded = JSON.parse(value);
    } catch {
      decoded = { signature: value };
    }
  }

  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
    return { ...DEFAULT_VALUES.EMAIL_SIGNATURE };
  }

  return {
    signature: typeof decoded.signature === 'string' ? decoded.signature : '',
    name: typeof decoded.name === 'string' ? decoded.name : '',
    email: typeof decoded.email === 'string' ? decoded.email : '',
  };
}

export function readEmailSignaturePreference(preferences = {}) {
  const hasUnified = Object.prototype.hasOwnProperty.call(preferences, PREFERENCE_KEYS.EMAIL_SIGNATURE);
  const raw = hasUnified
    ? preferences[PREFERENCE_KEYS.EMAIL_SIGNATURE]
    : preferences[PREFERENCE_KEYS.SENDER_INFO];
  return normalizeEmailSignatureValue(raw);
}

export function serializeEmailSignaturePreference(value) {
  return JSON.stringify(normalizeEmailSignatureValue(value));
}
