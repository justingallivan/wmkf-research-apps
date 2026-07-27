/**
 * API Route: /api/app-access
 *
 * CRUD for per-user app access grants.
 * GET:    Returns caller's allowed apps (or all grants when ?all=true for superusers)
 * POST:   Grant apps to a user (superuser only)
 * DELETE: Revoke apps from a user (superuser only)
 */

import { requireAuthWithProfile, isAuthRequired, clearAppAccessCache, getUserRole } from '../../lib/utils/auth';
import { withDalContext } from '../../lib/dataverse/core/context';
import { ALL_APP_KEYS } from '../../shared/config/appRegistry';
import {
  listAppKeysForUser,
  listAllGrantsForAdmin,
  grantApps,
  revokeApps,
} from '../../lib/services/app-access-service';

export default async function handler(req, res) {
  // When auth is disabled (dev mode), return all apps
  if (!isAuthRequired()) {
    if (req.method === 'GET') {
      return res.json({ apps: ALL_APP_KEYS, isSuperuser: true });
    }
    return res.json({ success: true });
  }

  const profileId = await requireAuthWithProfile(req, res);
  if (profileId === null) return;

  const isSuperuser = (await getUserRole(profileId)) === 'superuser';

  switch (req.method) {
    case 'GET':
      return withDalContext('app-access-admin', () =>
        handleGet(req, res, profileId, isSuperuser));
    case 'POST':
      return withDalContext('app-access-admin', () =>
        handlePost(req, res, profileId, isSuperuser));
    case 'DELETE':
      return withDalContext('app-access-admin', () =>
        handleDelete(req, res, profileId, isSuperuser));
    default:
      return res.status(405).json({ error: 'Method not allowed' });
  }
}

async function handleGet(req, res, profileId, isSuperuser) {
  // Superusers see all apps
  if (isSuperuser && !req.query.all) {
    return res.json({ apps: ALL_APP_KEYS, isSuperuser: true });
  }

  // ?all=true — superuser admin view: all users and their grants
  if (req.query.all === 'true') {
    if (!isSuperuser) {
      return res.status(403).json({ error: 'Superuser access required' });
    }

    try {
      const grants = await listAllGrantsForAdmin({ throwOnError: true });
      return res.json({
        grants,
        allApps: ALL_APP_KEYS,
      });
    } catch (error) {
      console.error('[app-access] failed to load admin grant snapshot:', error.message);
      return res.status(502).json({
        error: 'Unable to load app access grants',
      });
    }
  }

  // Regular user: return their own grants
  return res.json({
    apps: await listAppKeysForUser(profileId),
    isSuperuser: false,
  });
}

async function handlePost(req, res, profileId, isSuperuser) {
  if (!isSuperuser) {
    return res.status(403).json({ error: 'Only superusers can grant app access' });
  }

  const { userProfileId, apps } = req.body;

  if (!userProfileId || !Array.isArray(apps) || apps.length === 0) {
    return res.status(400).json({ error: 'userProfileId and apps[] are required' });
  }

  // Validate app keys
  const invalid = apps.filter(k => !ALL_APP_KEYS.includes(k));
  if (invalid.length > 0) {
    return res.status(400).json({ error: `Invalid app keys: ${invalid.join(', ')}` });
  }

  const result = await grantApps(userProfileId, apps, profileId);
  clearAppAccessCache(userProfileId);
  if (result.error) {
    console.error('[app-access] grant operation failed:', result.error);
    return res.status(502).json({
      error: 'Unable to grant all requested app access',
      granted: result.granted,
    });
  }
  return res.json({ success: true, granted: result.granted });
}

async function handleDelete(req, res, profileId, isSuperuser) {
  if (!isSuperuser) {
    return res.status(403).json({ error: 'Only superusers can revoke app access' });
  }

  const { userProfileId, apps } = req.body;

  if (!userProfileId || !Array.isArray(apps) || apps.length === 0) {
    return res.status(400).json({ error: 'userProfileId and apps[] are required' });
  }

  const result = await revokeApps(userProfileId, apps);
  clearAppAccessCache(userProfileId);
  if (result.error) {
    console.error('[app-access] revoke operation failed:', result.error);
    return res.status(502).json({
      error: 'Unable to revoke all requested app access',
      revoked: result.revoked,
    });
  }
  return res.json({ success: true, revoked: result.revoked });
}
