/**
 * API Route: /api/admin/users
 *
 * Superuser-only management of staff user profiles. Currently supports:
 *   DELETE { id } — soft-archive a profile (sets is_active=false). The row
 *     remains for audit-trail integrity (every FK from policy_publish_audit
 *     / api_usage_log / etc. stays valid). Auth blocks the user at login
 *     because the JWT lookup filters by `is_active = true`.
 *
 * Refuses to archive the calling superuser to prevent self-lockout.
 *
 * Sibling endpoints `/api/user-profiles` (PATCH/DELETE) are restricted to
 * the caller's own row; this endpoint is the operator-on-someone-else path.
 */

import { requireSuperuser, clearAppAccessCache } from '../../../lib/utils/auth';
import { DatabaseService } from '../../../lib/services/database-service';

export default async function handler(req, res) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const gate = await requireSuperuser(req, res);
  if (!gate) return;

  const id = parseInt(req.query.id || req.body?.id, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: 'Profile id required' });
  }
  if (id === gate.profileId) {
    return res.status(400).json({ error: 'Refusing to archive your own profile' });
  }

  try {
    const profile = await DatabaseService.getUserProfileById(id);
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    const ok = await DatabaseService.archiveUserProfile(id);
    if (!ok) {
      return res.status(500).json({ error: 'Archive failed' });
    }
    clearAppAccessCache(id);
    return res.status(200).json({
      success: true,
      profileId: id,
      name: profile.name || profile.displayName || null,
    });
  } catch (err) {
    console.error('[admin/users] DELETE error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
