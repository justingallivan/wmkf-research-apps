/**
 * Server-side reader for the per-PD scheduled-email review-all override.
 *
 * The Dataverse `wmkf_appuserpreferences` row is authoritative. Absence means
 * the system default (VIP-only review) and returns null; malformed persisted
 * state throws so a read/shape failure can never silently weaken a PD's
 * review posture.
 */

import * as userPreferenceAdapter from '../dataverse/adapters/user-preference.js';
import { PREFERENCE_KEYS } from '../../shared/config/reviewerFinderPreferences.js';
import { normalizeEmailAutomationPreference } from '../../shared/config/emailAutomation.js';

export async function getEmailAutomationPreferenceForSystemUser(systemUserId) {
  if (!systemUserId) return null;
  const row = await userPreferenceAdapter.findByOwnerAndKey(
    systemUserId,
    PREFERENCE_KEYS.EMAIL_AUTOMATION,
  );
  if (!row) return null;
  const preference = normalizeEmailAutomationPreference(row.wmkf_preferencevalue);
  if (!preference) {
    throw new Error('Stored email automation preference is invalid');
  }
  return preference;
}
