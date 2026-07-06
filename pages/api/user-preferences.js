/**
 * API Route: /api/user-preferences
 *
 * Manages user preferences (API keys, settings) for profiles.
 *
 * GET: Get preferences for a profile (sensitive values masked)
 * POST: Set one or more preferences
 * DELETE: Delete one or more preferences
 */

import { DatabaseService } from '../../lib/services/database-service';
import { requireAuthWithProfile } from '../../lib/utils/auth';
import { withDalContext } from '../../lib/dataverse/core/context';
import { PREFERENCE_KEYS } from '../../shared/config/reviewerFinderPreferences';

// Keys that this generic endpoint must NOT write — they have a dedicated,
// grant-gated + validating write path. PROMPT_OVERRIDES (reviewer-finder prompt
// edits) is only writable via /api/reviewer-finder/prompt-override, which
// enforces the `reviewers` app grant and validates the body (S222). Blocking it
// here keeps the gated endpoint the sole write path even though this endpoint is
// only auth-gated (any signed-in profile).
const RESERVED_WRITE_KEYS = new Set([PREFERENCE_KEYS.PROMPT_OVERRIDES]);

export default async function handler(req, res) {
  // Require authentication and extract profile ID from session
  const profileId = await requireAuthWithProfile(req, res);
  if (profileId === null) return;

  switch (req.method) {
    case 'GET':
      return withDalContext('user-preferences', () => handleGet(req, res, profileId));
    case 'POST':
      return withDalContext('user-preferences', () => handlePost(req, res, profileId));
    case 'DELETE':
      return withDalContext('user-preferences', () => handleDelete(req, res, profileId));
    default:
      return res.status(405).json({ error: 'Method not allowed' });
  }
}

async function handleGet(req, res, profileId) {
  // Decrypted credential values are intentionally NEVER returned over the
  // wire (security pass 2026-04-26). Encrypted preference values are always
  // returned masked; the previous includeDecrypted=true branch was removed.
  try {
    const { key } = req.query;

    if (key) {
      const preferences = await DatabaseService.getUserPreferences(profileId, false);
      const isEncrypted = DatabaseService.ENCRYPTED_PREFERENCE_KEYS.includes(key);
      return res.status(200).json({
        success: true,
        key,
        value: preferences[key] || null,
        isEncrypted,
        masked: isEncrypted,
      });
    }

    const preferences = await DatabaseService.getUserPreferences(profileId, false);
    const encryptedKeys = DatabaseService.ENCRYPTED_PREFERENCE_KEYS;

    return res.status(200).json({
      success: true,
      profileId,
      preferences,
      encryptedKeys,
    });
  } catch (error) {
    console.error('Get user preferences error:', error);
    return res.status(500).json({
      error: 'Failed to fetch preferences'
    });
  }
}

async function handlePost(req, res, profileId) {
  try {
    const { preferences, key, value } = req.body;

    // Reject reserved keys (dedicated gated write path only).
    const attemptedKeys = key !== undefined ? [key] : (preferences && typeof preferences === 'object' ? Object.keys(preferences) : []);
    const reservedHit = attemptedKeys.find((k) => RESERVED_WRITE_KEYS.has(k));
    if (reservedHit) {
      return res.status(403).json({ error: `Preference key "${reservedHit}" cannot be written through this endpoint; use its dedicated route.` });
    }

    // Handle single key-value pair
    if (key !== undefined) {
      const success = await DatabaseService.setUserPreference(profileId, key, value);
      if (!success) {
        return res.status(500).json({ error: 'Failed to save preference' });
      }
      return res.status(200).json({
        success: true,
        message: 'Preference saved',
        key
      });
    }

    // Handle multiple preferences
    if (preferences && typeof preferences === 'object') {
      const success = await DatabaseService.setUserPreferences(profileId, preferences);
      if (!success) {
        return res.status(500).json({ error: 'Failed to save preferences' });
      }
      return res.status(200).json({
        success: true,
        message: 'Preferences saved',
        count: Object.keys(preferences).length
      });
    }

    return res.status(400).json({ error: 'Either key/value or preferences object is required' });
  } catch (error) {
    console.error('Set user preferences error:', error);
    return res.status(500).json({
      error: 'Failed to save preferences'
    });
  }
}

async function handleDelete(req, res, profileId) {
  try {
    const { key, keys } = req.body;

    // Reject reserved keys (dedicated gated write path only).
    const attemptedKeys = key ? [key] : (Array.isArray(keys) ? keys : []);
    const reservedHit = attemptedKeys.find((k) => RESERVED_WRITE_KEYS.has(k));
    if (reservedHit) {
      return res.status(403).json({ error: `Preference key "${reservedHit}" cannot be deleted through this endpoint; use its dedicated route.` });
    }

    // Handle single key deletion
    if (key) {
      const success = await DatabaseService.deleteUserPreference(profileId, key);
      return res.status(200).json({
        success,
        message: success ? 'Preference deleted' : 'Failed to delete preference',
        key
      });
    }

    // Handle multiple key deletion
    if (keys && Array.isArray(keys)) {
      let deletedCount = 0;
      for (const k of keys) {
        const success = await DatabaseService.deleteUserPreference(profileId, k);
        if (success) deletedCount++;
      }
      return res.status(200).json({
        success: true,
        message: `Deleted ${deletedCount} preferences`,
        deletedCount
      });
    }

    return res.status(400).json({ error: 'Either key or keys array is required' });
  } catch (error) {
    console.error('Delete user preferences error:', error);
    return res.status(500).json({
      error: 'Failed to delete preferences'
    });
  }
}
